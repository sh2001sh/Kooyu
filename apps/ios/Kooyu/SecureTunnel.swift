import Foundation
import CryptoKit

enum SecureTunnel {
    private static let xPrefix = Data([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x03,0x21,0])
    private static let edPrefix = Data([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0])
    static let invalid = APIError(message: "无法验证 Host 加密通道。", status: 0)
    static func verify(_ identity: JSONValue, base: URL) throws -> Data {
        let encoded = identity["encryptionKey"].string
        guard let signing = Data(base64Encoded: identity["publicKey"].string), signing.count == 44, signing.starts(with: edPrefix),
              let agreement = Data(base64Encoded: encoded), agreement.count == 44, agreement.starts(with: xPrefix),
              let signature = Data(base64Encoded: identity["signature"].string),
              SHA256.hash(data: signing).map({ String(format:"%02x",$0) }).joined() == base.lastPathComponent else { throw invalid }
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: signing.suffix(32))
        guard key.isValidSignature(signature, for: Data(("kooyu-tunnel-v2:" + encoded).utf8)) else { throw invalid }
        return Data(agreement.suffix(32))
    }

    static func mail(_ connection: Connection, session: String, text: String, command: String) throws -> JSONValue {
        guard let seed = connection.mailboxSeed, let peerKey = connection.tunnelKey else { throw invalid }
        let base = try HostAPI.origin(connection.url)
        let expires = Int64(Date().timeIntervalSince1970*1000) + 12*3600000
        var fields: [Any] = ["kooyu-mailbox-v2",base.lastPathComponent,connection.deviceId,command,expires]
        let aad = try JSONSerialization.data(withJSONObject:fields)
        let payload = try JSONEncoder().encode(["sessionId":session,"text":text])
        guard text.utf16.count <= 16000, payload.count <= 23500 else { throw APIError(message:"离线消息超过长度限制。",status:413) }
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation:peerKey)
        let secret = try ephemeral.sharedSecretFromKeyAgreement(with:peer)
        let nonce = AES.GCM.Nonce()
        let salt = nonce.withUnsafeBytes { Data($0) }
        let key = secret.hkdfDerivedSymmetricKey(using:SHA256.self,salt:salt,sharedInfo:aad,outputByteCount:32)
        let box = try AES.GCM.seal(payload,using:key,nonce:nonce,authenticating:aad)
        func url64(_ data: Data) -> String {
            data.base64EncodedString().replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"=",with:"")
        }
        let packet = url64(xPrefix + ephemeral.publicKey.rawRepresentation + salt + box.ciphertext + box.tag)
        fields.append(packet)
        let signing = try Curve25519.Signing.PrivateKey(rawRepresentation:seed)
        let signature = try signing.signature(for:JSONSerialization.data(withJSONObject:fields))
        return .object(["deviceId":.string(connection.deviceId),"commandId":.string(command),"expiresAt":.number(Double(expires)),
                        "ciphertext":.string(packet),"signature":.string(url64(signature))])
    }

    static func send(_ request: URLRequest, hostKey: Data, session: URLSession, account:CloudDevice?=nil, maxBytes: Int = 32*1024*1024) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let prefix = parts.percentEncodedPath.range(of: "/api/") else { throw invalid }
        let path = String(parts.percentEncodedPath[prefix.lowerBound...]) + (parts.percentEncodedQuery.map { "?" + $0 } ?? "")
        var outerURL = parts
        outerURL.percentEncodedPath = String(parts.percentEncodedPath[..<prefix.lowerBound]) + "/api/secure/channel"
        outerURL.query = nil
        guard let destination = outerURL.url else { throw invalid }
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let publicValue = (xPrefix + ephemeral.publicKey.rawRepresentation).base64EncodedString()
        let nonce = AES.GCM.Nonce()
        let salt = nonce.withUnsafeBytes { Data($0) }
        let expires = Int64(Date().timeIntervalSince1970*1000) + 60000
        let aad = Data("kooyu-tunnel-v2:\(publicValue):\(salt.base64EncodedString()):\(expires)".utf8)
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: hostKey)
        let secret = try ephemeral.sharedSecretFromKeyAgreement(with: peer)
        let material = secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: aad, outputByteCount: 64).withUnsafeBytes { Data($0) }
        var inner = ["method": request.httpMethod ?? "GET", "path":path, "protocol":String(HostAPI.protocolVersion)]
        if let bearer = request.value(forHTTPHeaderField: "Authorization") { inner["token"] = String(bearer.dropFirst(7)) }
        if let body = request.httpBody { inner["body"] = body.base64EncodedString(); inner["contentType"] = request.value(forHTTPHeaderField: "Content-Type") }
        let box = try AES.GCM.seal(JSONEncoder().encode(inner), using: SymmetricKey(data: material.prefix(32)), nonce: nonce, authenticating: aad)
        var outer = URLRequest(url: destination)
        outer.httpMethod = "POST"; outer.timeoutInterval = request.timeoutInterval
        outer.setValue("application/json", forHTTPHeaderField: "Content-Type")
        outer.httpBody = try JSONSerialization.data(withJSONObject: ["ephemeral":publicValue,"nonce":salt.base64EncodedString(),
            "expires":expires,"ciphertext":(box.ciphertext + box.tag).base64EncodedString()])
        if let account {outer=try await account.authorize(outer)}
        let (stream, response) = try await session.bytes(for: outer)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw invalid }
        var it = stream.makeAsyncIterator()
        var seq: UInt64 = 0
        var result = Data(), head: HTTPURLResponse?
        let replyKey = SymmetricKey(data: material.suffix(32))
        while let type = try await it.next() {
            var header = Data([type]), length = 0
            for _ in 0..<4 {
                guard let byte = try await it.next() else { throw invalid }
                header.append(byte); length = length*256 + Int(byte)
            }
            guard (16...65552).contains(length) else { throw invalid }
            var frame = Data(capacity:length)
            for _ in 0..<length { guard let byte = try await it.next() else { throw invalid }; frame.append(byte) }
            let iv = Data(repeating:0,count:4) + withUnsafeBytes(of: seq.bigEndian) { Data($0) }
            seq += 1
            let sealed = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data:iv), ciphertext:frame.dropLast(16), tag:frame.suffix(16))
            let clear = try AES.GCM.open(sealed, using:replyKey, authenticating:aad + header)
            switch type {
            case 1 where seq == 1:
                let value = try JSONDecoder().decode(JSONValue.self, from:clear)
                guard let status = value["status"].number, (200...599).contains(status) else { throw invalid }
                head = HTTPURLResponse(url:url,statusCode:Int(status),httpVersion:"HTTP/1.1",headerFields:["Content-Type":value["contentType"].string])
            case 2 where head != nil:
                guard result.count + clear.count <= maxBytes else { throw invalid }
                result.append(clear)
            case 3 where clear.isEmpty:
                guard let head else { throw invalid }
                return (result,head)
            default: throw invalid
            }
        }
        throw invalid
    }
}


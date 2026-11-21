import Foundation
import CryptoKit
import Security
import JOSESwift

struct CloudCredential: Codable, Sendable {
    let hostId: String
    let key: Data
    var directOrigin: String? = nil
    var renewal: String
}

actor CloudDevice {
    private var stored: CloudCredential
    private var invitation: [String:String]?
    private let issuer: URL
    private let relay: URL
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
    private var ticket = ""
    private var until = Date.distantPast
    private static func configured(_ key: String) throws -> URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              let url = URL(string: value), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.path.isEmpty,
              url.query == nil, url.fragment == nil else { throw SecureTunnel.invalid }
        return url
    }
    init(base: URL, stored: CloudCredential, invitation: [String:String]? = nil) throws {
        self.issuer=try Self.configured("KooyuAccountOrigin")
        let relay=try Self.configured("KooyuRelayOrigin")
        guard let components=URLComponents(url:base,resolvingAgainstBaseURL:false), let host=components.host,components.scheme=="https" else {throw SecureTunnel.invalid}
        var direct=URLComponents();direct.scheme="https";direct.host=host;direct.port=components.port
        guard let target=direct.url,invitation != nil || target==relay || stored.directOrigin==target.absoluteString else {throw SecureTunnel.invalid}
        self.relay=target
        self.stored=stored
        self.invitation=invitation
    }
    static func start(base:URL, fields:[String:String]) async throws -> CloudDevice {
        guard let host=fields["host"],UUID(uuidString:host) != nil else {throw SecureTunnel.invalid}
        let d=try CloudDevice(base:base,stored:.init(hostId:host,key:P256.Signing.PrivateKey().x963Representation,renewal:""),invitation:fields)
        let deadline = Date().addingTimeInterval(300)
        var result = try await d.pair("claim")
        while result["state"]?.string == "approval_required" {
            guard Date() < deadline else { throw APIError(message: "电脑批准请求已过期。", status: 410) }
            try await Task.sleep(nanoseconds: 5_000_000_000)
            result = try await d.pair("claim")
        }
        if d.relay != (try Self.configured("KooyuRelayOrigin")) {
            guard let direct=result["directOrigin"]?.string, direct == d.relay.absoluteString, result["relayHostId"]?.string == base.lastPathComponent else {throw SecureTunnel.invalid}
            await d.setDirectOrigin(direct)
        }
        return d
    }
    private func setDirectOrigin(_ value:String) { stored.directOrigin=value }
    private var discoveryToken = ""
    static func discovery() throws -> CloudDevice {
        try CloudDevice(base: Self.configured("KooyuRelayOrigin"),
                        stored: .init(hostId: "", key: P256.Signing.PrivateKey().x963Representation, renewal: ""))
    }
    private func endpoint(_ path: String) -> URL { issuer.appendingPathComponent("api/device-auth/v1/" + path) }
    func beginLogin() async throws -> (String, String, URL) {
        let point = try P256.Signing.PrivateKey(x963Representation: stored.key).publicKey.x963Representation
        let jwk = ["crv": "P-256", "kty": "EC", "x": b64(Data(point[1..<33])), "y": b64(Data(point[33..<65]))]
        let canonical = try JSONSerialization.data(withJSONObject: jwk, options: [.sortedKeys])
        let result = try await call(endpoint("discovery/start"), ["name": "Kooyu iOS", "jkt": b64(Data(SHA256.hash(data: canonical)))])
        guard let device = result["deviceCode"]?.string, let code = result["userCode"]?.string else { throw SecureTunnel.invalid }
        var components = URLComponents(url: issuer.appendingPathComponent("activate"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "code", value: code)]
        let activationURL = components?.url ?? issuer.appendingPathComponent("activate")
        return (device, code, activationURL)
    }
    private func nonce() async throws -> String {
        let response = try await call(endpoint("nonce"), [:])
        guard let value = response["nonce"]?.string else { throw SecureTunnel.invalid }
        return value
    }
    func hosts(deviceCode: String) async throws -> [JSONValue] {
        let deadline = Date().addingTimeInterval(300)
        while Date() < deadline {
            try await Task.sleep(nanoseconds: 5_000_000_000)
            let r = try await call(endpoint("discovery/poll"), ["deviceCode": deviceCode], deviceCode, hash(deviceCode))
            if let token = r["token"]?.string {
                discoveryToken = token
                var hosts: [JSONValue] = []
                var cursor = ""
                repeat {
                    let challenge = try await nonce()
                    var body = ["nonce": challenge]
                    if !cursor.isEmpty { body["cursor"] = cursor }
                    let page = try await call(endpoint("discovery/hosts"), body, token, challenge)
                    hosts += page["items"]?.array.filter { $0["enabled"].boolean } ?? []
                    cursor = page["nextCursor"]?.string ?? ""
                } while !cursor.isEmpty
                return hosts
            }
        }
        throw APIError(message: "账号登录请求已过期。", status: 410)
    }
    func requestHost(_ host: JSONValue) async throws -> PairingInvitation {
        let challenge = try await nonce()
        let id = host["id"].string
        let r = try await call(endpoint("discovery/request"), ["name": "Kooyu iOS", "hostId": id, "nonce": challenge], discoveryToken, challenge)
        guard let transaction = r["transactionId"]?.string, let secret = r["secret"]?.string else { throw SecureTunnel.invalid }
        return PairingInvitation(address: relay.appendingPathComponent("h").appendingPathComponent(host["relay_id"].string).absoluteString,
                                 code: "V2-REQUEST&transaction=" + transaction + "&claim=" + secret + "&host=" + id)
    }
    private func b64(_ value:Data)->String {value.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")}
    private func hash(_ text:String)->String {b64(Data(SHA256.hash(data:Data(text.utf8))))}
    private func proof(_ url:URL,_ method:String,_ nonce:String,_ token:String)throws->String {
        let privateKey=try P256.Signing.PrivateKey(x963Representation:stored.key)
        let point=privateKey.publicKey.x963Representation
        let jwk=["kty":"EC","crv":"P-256","x":b64(Data(point[1..<33])),"y":b64(Data(point[33..<65]))]
        let attrs:[CFString:Any]=[kSecAttrKeyType:kSecAttrKeyTypeECSECPrimeRandom,kSecAttrKeyClass:kSecAttrKeyClassPrivate]
        guard let secKey=SecKeyCreateWithData(stored.key as CFData,attrs as CFDictionary,nil),
              let signer=Signer(signatureAlgorithm:.ES256,key:secKey) else {throw SecureTunnel.invalid}
        let header=try JWSHeader(parameters:["alg":"ES256","typ":"dpop+jwt","jwk":jwk])
        let claims:[String:Any]=["htu":url.absoluteString,"htm":method,"iat":Int(Date().timeIntervalSince1970),"jti":UUID().uuidString,"nonce":nonce,"ath":hash(token)]
        return try JWS(header:header,payload:Payload(JSONSerialization.data(withJSONObject:claims)),signer:signer).compactSerializedString
    }
    private func call(_ url:URL,_ body:[String:String],_ token:String?=nil,_ nonce:String="",rotate:Bool=false)async throws->[String:JSONValue]{
        var req=URLRequest(url:url);req.httpMethod="POST";req.timeoutInterval=10
        req.setValue("application/json",forHTTPHeaderField:"Content-Type")
        var payload:[String:Any]=body; if rotate {payload["rotate"]=true}; req.httpBody=try JSONSerialization.data(withJSONObject:payload)
        if let token {req.setValue("DPoP "+token,forHTTPHeaderField:"Authorization");req.setValue(try proof(url,"POST",nonce,token),forHTTPHeaderField:"DPoP")}
        let(data,response)=try await session.data(for:req)
        guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode) else {throw APIError(message:"设备授权失败，请核对账号和配对状态。",status:403)}
        return try JSONDecoder().decode([String:JSONValue].self,from:data)
    }
    private func pair(_ step:String)async throws->[String:JSONValue]{
        guard let inv=invitation,let secret=inv["claim"],let transaction=inv["transaction"] else {throw SecureTunnel.invalid}
        return try await call(issuer.appendingPathComponent("api/device-auth/v1/pairing/"+step),["secret":secret,"transactionId":transaction,"name":"Kooyu iOS"],secret,hash(secret))
    }
    func finish()async throws->CloudCredential{
        let result=try await pair("finish")
        guard result["state"]?.string=="active",let renewal=result["renewal"]?.string else {throw SecureTunnel.invalid}
        stored.renewal=renewal;invitation=nil;until = .distantPast
        return stored
    }
    static func clearLocalRenewal(_ credential: CloudCredential) async {
        let keyId = Data(SHA256.hash(data: credential.key))
        try? await ConnectionVault.removeRenewal(keyId)
    }
    func logout() async throws {
        let challenge=try await nonce()
        let keyId=Data(SHA256.hash(data:stored.key))
        let token=try await ConnectionVault.renewal(keyId) ?? stored.renewal
        _ = try await call(endpoint("logout"),["nonce":challenge],token,challenge)
        try await ConnectionVault.removeRenewal(keyId)
    }
    func authorize(_ request:URLRequest)async throws->URLRequest{
        guard let url=request.url,url.scheme==relay.scheme,url.host==relay.host,url.port==relay.port,
              var parts=URLComponents(url:url,resolvingAgainstBaseURL:false) else {throw SecureTunnel.invalid}
        if Date()>=until {
            let value=try await call(issuer.appendingPathComponent("api/device-auth/v1/nonce"),[:])
            guard let nonce=value["nonce"]?.string else {throw SecureTunnel.invalid}
            let keyId=Data(SHA256.hash(data:stored.key))
            let saved=try await ConnectionVault.renewal(keyId)
            let token=invitation?["claim"] ?? saved ?? stored.renewal
            let result=try await call(issuer.appendingPathComponent("api/device-auth/v1/ticket"),["role":invitation==nil ? "device":"pair","hostId":stored.hostId,"nonce":nonce],token,nonce,rotate:invitation==nil)
            if let renewed=result["renewal"]?.string { _ = try await ConnectionVault.renewal(keyId,replace:renewed); stored.renewal=renewed }
            guard let issued=result["ticket"]?.string else {throw SecureTunnel.invalid}
            ticket=issued;until=Date().addingTimeInterval(540)
        }
        let value=try await call(relay.appendingPathComponent("v1/nonce"),[:])
        parts.query=nil;parts.fragment=nil
        guard let nonce=value["nonce"]?.string,let target=parts.url else {throw SecureTunnel.invalid}
        var req=request
        req.setValue(ticket,forHTTPHeaderField:"X-Kooyu-Ticket");req.setValue(invitation==nil ? "access":"pair",forHTTPHeaderField:"X-Kooyu-Purpose")
        req.setValue(try proof(target,req.httpMethod ?? "GET",nonce,ticket),forHTTPHeaderField:"DPoP")
        return req
    }
}

import Foundation

/// Parse locally and display the destination before consuming the single-use invitation.
struct PairingInvitation: Equatable, Sendable {
    let address: String
    let code: String

    static func parse(_ raw: String) throws -> PairingInvitation {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = "配对二维码无效。请在桌面「设置 → 手机连接」重新生成。"
        guard raw.utf8.count <= 2048,
              let components = URLComponents(string: text),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil,
              components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/" ||
                components.percentEncodedPath.range(of: "^/h/[a-f0-9]{64}/?$", options: .regularExpression) != nil,
              let fragment = components.percentEncodedFragment,
              fragment.range(of: "^pair=(V2-)?[a-fA-F0-9]{32}(&transaction=[a-f0-9-]{36}&claim=[A-Za-z0-9_-]{43}&host=[a-f0-9-]{36})?$", options: .regularExpression) != nil,
              let separator = text.firstIndex(of: "#") else {
            throw APIError(message: message, status: 0)
        }
        let address: URL
        do { address = try HostAPI.origin(String(text[..<separator])) }
        catch { throw APIError(message: message, status: 0) }
        return PairingInvitation(address: address.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                                 code: fragment.dropFirst(5).split(separator:"&").enumerated().map { $0.offset==0 ? $0.element.uppercased() : String($0.element) }.joined(separator:"&"))
    }
}


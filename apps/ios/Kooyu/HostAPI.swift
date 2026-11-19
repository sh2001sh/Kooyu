import Foundation
import CryptoKit

final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct HostAPI: Sendable {
    static let protocolVersion = 2
    let connection: Connection
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.httpShouldSetCookies = false
        config.urlCache = nil
        return URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }()

    static func origin(_ text: String) throws -> URL {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" || url.path.range(of: "^/h/[a-f0-9]{64}/?$", options: .regularExpression) != nil else {
            throw APIError(message: "请输入桌面显示的 HTTPS 连接地址（保留 /h/ 后的设备路径）。", status: 0)
        }
        return url
    }
    static func pair(url text: String, code: String, name: String) async throws -> Connection {
        let url = try origin(text)
        // Check compatibility before consuming the single-use invitation.
        let health: JSONValue = try await request(url: url.appendingPathComponent("api/health"))
        guard case .number(let version) = health["protocolVersion"], Int(version) == protocolVersion else {
            throw APIError(message: "Host 版本不兼容，请升级桌面 Host。", status: 409)
        }
        let result: PairResult = try await request(url: url.appendingPathComponent("api/pair/native"), method: "POST",
            body: .object(["code": .string(code.trimmingCharacters(in: .whitespacesAndNewlines)), "name": .string(name)]))
        guard result.protocolVersion == protocolVersion, result.hostId == health["hostId"].string else {
            throw APIError(message: "Host 身份或版本变化，请重新配对。", status: 409)
        }
        return Connection(url: url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                          hostId: result.hostId, deviceId: result.device.id, token: result.token, expiresAt: result.device.expiresAt)
    }
    func get<T: Decodable & Sendable>(_ path: String) async throws -> T { try await perform(path) }
    func artifactFile(_ artifact: JSONValue) async throws -> URL {
        let base = try Self.origin(connection.url)
        let url = base.appendingPathComponent("api/files/\(artifact["fileId"].string)/content")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "X-Kooyu-Protocol")
        let (stream, response) = try await Self.session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError(message: "文件不可用，请刷新成果列表。", status: 0) }
        var data = Data()
        for try await byte in stream {
            guard data.count < 32 * 1024 * 1024 else { throw APIError(message: "手机单个文件最多读取 32 MiB。", status: 0) }
            data.append(byte)
        }
        guard SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == artifact["sha256"].string else { throw APIError(message: "文件校验失败，请重新读取。", status: 0) }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("kooyu-artifacts/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = String((artifact["displayName"].string.replacingOccurrences(of: "\\", with: "_") as NSString).lastPathComponent.prefix(120))
        let file = folder.appendingPathComponent(name.isEmpty ? "artifact" : name)
        try data.write(to: file, options: [.atomic, .completeFileProtection])
        return file
    }
    func upload(name: String, mediaType: String, data: Data, sessionId: String?) async throws -> JSONValue {
        guard data.count <= 32 * 1024 * 1024 else { throw APIError(message: "单个附件最多 32 MiB。", status: 0) }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let upload: JSONValue = try await perform("/files/uploads", method: "POST", body: .object([
            "requestId": .string(UUID().uuidString.lowercased()), "displayName": .string(name), "mediaType": .string(mediaType),
            "size": .number(Double(data.count)), "sha256": .string(digest), "sessionId": sessionId.map { .string($0) } ?? .null
        ]))
        let id = upload["id"].string
        guard !id.isEmpty, case .number(let received) = upload["received"] else { throw APIError(message: "附件上传响应无效。", status: 0) }
        var offset = Int(received)
        while offset < data.count {
            let end = min(offset + 512 * 1024, data.count)
            let url = try Self.apiURL(Self.origin(connection.url), path: "/files/uploads/\(id)/chunks?offset=\(offset)")
            let result: JSONValue = try await Self.request(url: url, token: connection.token, method: "PUT", binary: data.subdata(in: offset..<end))
            guard case .number(let next) = result["received"], Int(next) == end else { throw APIError(message: "附件上传进度无效，请重新添加。", status: 0) }
            offset = end
        }
        return try await perform("/files/uploads/\(id)/complete", method: "POST", body: .object([:]))
    }
    static func apiURL(_ base: URL, path: String) throws -> URL {
        let prefix = base.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let apiPrefix = (prefix.isEmpty ? "" : "/" + prefix) + "/api"
        let pathOnly = String(path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        guard let decodedPath = pathOnly.removingPercentEncoding,
              !decodedPath.contains("\\"),
              !decodedPath.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
              path.hasPrefix("/"), let url = URL(string: apiPrefix + path, relativeTo: base)?.absoluteURL,
              url.host == base.host, url.scheme == base.scheme, url.port == base.port,
              url.path.hasPrefix(apiPrefix + "/"), url.fragment == nil else {
            throw APIError(message: "连接地址无效。", status: 0)
        }
        return url
    }
    func perform<T: Decodable & Sendable>(_ path: String, method: String = "GET", body: JSONValue? = nil, timeout: TimeInterval = 20) async throws -> T {
        let base = try Self.origin(connection.url)
        let url = try Self.apiURL(base, path: path)
        return try await Self.request(url: url, token: connection.token, method: method, body: body, timeout: timeout)
    }
    private static func request<T: Decodable & Sendable>(url: URL, token: String? = nil, method: String = "GET", body: JSONValue? = nil, timeout: TimeInterval = 20, binary: Data? = nil) async throws -> T {
        var req = URLRequest(url: url); req.httpMethod = method; req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(String(protocolVersion), forHTTPHeaderField: "X-Kooyu-Protocol")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        if let binary { req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type"); req.httpBody = binary }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await readRecoveringConnection(req) }
        catch {
            if Task.isCancelled { throw CancellationError() }
            throw APIError(message: "无法连接此设备，请检查设备是否在线以及网络是否可用。", status: 0)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "无法读取 Host 响应。", status: 0) }
        guard (200..<300).contains(http.statusCode) else {
            let value = try? JSONDecoder().decode(JSONValue.self, from: data)
            let detail = (value?["error"]["message"].string ?? "").replacingOccurrences(of: "https?://[^\\s]+", with: "[连接信息已隐藏]", options: .regularExpression)
            throw APIError(message: detail.isEmpty ? "Host 请求失败（\(http.statusCode)），请检查连接。" : detail, status: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    static func canRecoverRead(_ method: String?, _ error: Error) -> Bool {
        guard method == "GET", let network = error as? URLError else { return false }
        return [.networkConnectionLost, .cannotConnectToHost].contains(network.code)
    }
    private static func readRecoveringConnection(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do { return try await session.data(for: request) }
        catch {
            guard !Task.isCancelled, canRecoverRead(request.httpMethod, error) else { throw error }
            // One recovery only, for reads. Never replay an ambiguous mutation.
            try await Task.sleep(for: .milliseconds(200))
            return try await session.data(for: request)
        }
    }
}

import Foundation

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
    func perform<T: Decodable & Sendable>(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> T {
        let base = try Self.origin(connection.url)
        let url = try Self.apiURL(base, path: path)
        return try await Self.request(url: url, token: connection.token, method: method, body: body)
    }
    private static func request<T: Decodable & Sendable>(url: URL, token: String? = nil, method: String = "GET", body: JSONValue? = nil) async throws -> T {
        var req = URLRequest(url: url); req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(String(protocolVersion), forHTTPHeaderField: "X-Kooyu-Protocol")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch {
            if Task.isCancelled { throw CancellationError() }
            throw APIError(message: "无法连接此电脑，请检查电脑是否在线以及网络是否可用。", status: 0)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "无法读取 Host 响应。", status: 0) }
        guard (200..<300).contains(http.statusCode) else {
            let value = try? JSONDecoder().decode(JSONValue.self, from: data)
            let detail = (value?["error"]["message"].string ?? "").replacingOccurrences(of: "https?://[^\\s]+", with: "[连接信息已隐藏]", options: .regularExpression)
            throw APIError(message: detail.isEmpty ? "Host 请求失败（\(http.statusCode)），请检查连接。" : detail, status: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

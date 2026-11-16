import Foundation
import CryptoKit

/** Local, protected drafts; host and session identity are part of every key. */
enum LocalDrafts {
    private static func url(_ host: String, _ session: String) throws -> URL {
        let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("KooyuDrafts", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = SHA256.hash(data: Data((host + ":" + session).utf8)).map { String(format: "%02x", $0) }.joined()
        return folder.appendingPathComponent(name)
    }
    static func read(_ host: String, _ session: String) -> String {
        guard let location = try? url(host, session), let data = try? Data(contentsOf: location), data.count <= 1024 * 1024 else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func save(_ host: String, _ session: String, _ text: String) throws {
        let location = try url(host, session)
        if text.isEmpty { if FileManager.default.fileExists(atPath: location.path) { try FileManager.default.removeItem(at: location) }; return }
        try Data(text.prefix(200000).utf8).write(to: location, options: [.atomic, .completeFileProtection])
    }
}

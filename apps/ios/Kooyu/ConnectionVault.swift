import Foundation
import Security

@MainActor enum ConnectionVault {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "app.kooyu.connection", kSecAttrAccount as String: "current"]
    static func load() throws -> ConnectionBook {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &value)
        if status == errSecItemNotFound { return ConnectionBook() }
        guard status == errSecSuccess, let data = value as? Data else { throw VaultError() }
        return try JSONDecoder().decode(ConnectionBook.self, from: data)
    }
    static func save(_ book: ConnectionBook) throws {
        let data = try JSONEncoder().encode(book)
        let attrs: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attrs) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw VaultError() }
        } else if status != errSecSuccess { throw VaultError() }
    }
    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError() }
    }
    struct VaultError: LocalizedError { var errorDescription: String? { "无法访问系统凭据库，请解锁设备后重试。" } }
}

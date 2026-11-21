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
    static func renewal(_ key: Data, replace: String? = nil) throws -> String? {
        let label = key.base64EncodedString()
        var q: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"app.kooyu.renewal",kSecAttrAccount as String:label]
        if let replace {
            let attrs:[String:Any]=[kSecValueData as String:Data(replace.utf8),kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            let status=SecItemUpdate(q as CFDictionary,attrs as CFDictionary)
            if status==errSecItemNotFound {
                guard SecItemAdd(q.merging(attrs){_,v in v} as CFDictionary,nil)==errSecSuccess else {throw VaultError()}
            } else if status != errSecSuccess { throw VaultError() }
            return replace
        }
        q[kSecReturnData as String]=true
        var value:CFTypeRef?
        let status=SecItemCopyMatching(q as CFDictionary,&value)
        if status==errSecItemNotFound{return nil}
        guard status==errSecSuccess,let bytes=value as? Data else {throw VaultError()}
        return String(data:bytes,encoding:.utf8)
    }
    static func removeRenewal(_ key: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.kooyu.renewal",
            kSecAttrAccount as String: key.base64EncodedString()
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError() }
    }
    static func clear() throws {
        let tokens=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"app.kooyu.renewal"] as [String:Any]
        let cleared=SecItemDelete(tokens as CFDictionary)
        guard cleared==errSecSuccess || cleared==errSecItemNotFound else {throw VaultError()}
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError() }
    }
    struct VaultError: LocalizedError { var errorDescription: String? { "无法访问系统凭据库，请解锁设备后重试。" } }
}

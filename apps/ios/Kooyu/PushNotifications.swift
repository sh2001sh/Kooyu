import Foundation
import Observation
import UIKit
import UserNotifications

/// A push supplies identifiers only. The saved Host remains the authority for the destination.
struct NotificationTarget: Hashable, Sendable {
    let hostId: String
    let notificationId: String
    init?(hostId: String, notificationId: String) {
        guard UUID(uuidString: hostId) != nil, !notificationId.isEmpty, notificationId.utf8.count <= 1000,
              !notificationId.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        self.hostId = hostId; self.notificationId = notificationId
    }
    init?(payload: [AnyHashable: Any]) {
        guard let value = payload["kooyu"] as? [String: Any],
              let hostId = value["hostId"] as? String, let id = value["notificationId"] as? String else { return nil }
        self.init(hostId: hostId, notificationId: id)
    }
    var path: String { "/notifications/" + (notificationId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "") }
}

@MainActor @Observable final class PushNotifications {
    static let shared = PushNotifications()
    var pending: NotificationTarget?
    var messages: [String: String] = [:]
    var working = false
    var isVisible: (@MainActor @Sendable (NotificationTarget) async -> Bool)?
    private var token: String?
    private var connections: [Connection] = []
    private var explicitRegistrations = Set<String>()
    private var needsRegistration = false
    private var pendingRevocations: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "kooyu.apns.pending-revocations") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "kooyu.apns.pending-revocations") }
    }
    private var optedIn: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "kooyu.apns.opted-in") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "kooyu.apns.opted-in") }
    }
    func key(_ c: Connection) -> String { c.hostId + ":" + c.deviceId }
    private func saved(_ c: Connection) -> Bool { connections.contains { $0.hostId == c.hostId && $0.deviceId == c.deviceId && $0.token == c.token } }
    func sync(_ savedConnections: [Connection]) async {
        connections = savedConnections
        guard !working else { return }
        for c in connections where pendingRevocations.contains(key(c)) { await disable(c) }
        guard !optedIn.isEmpty else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            for c in connections where optedIn.contains(key(c)) { messages[key(c)] = "系统通知未获允许，请在 iOS 设置中开启。" }
            return
        }
        UIApplication.shared.registerForRemoteNotifications()
        if token != nil { await registerSaved() }
    }
    func enable(_ c: Connection) async {
        guard !working, saved(c) else { return }
        do {
            guard try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) else {
                messages[key(c)] = "请在 iOS 设置中允许 Kooyu 通知。"; return
            }
            guard saved(c) else { return }
            pendingRevocations.remove(key(c))
            optedIn.insert(key(c)); explicitRegistrations.insert(key(c))
            messages[key(c)] = "正在向 Apple 注册此设备…"
            UIApplication.shared.registerForRemoteNotifications()
            if token != nil { await registerSaved() }
        } catch { messages[key(c)] = "无法请求系统通知权限，请稍后重试。" }
    }
    func registered(_ deviceToken: Data) async {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        await registerSaved()
    }
    func registrationFailed() {
        for c in connections where optedIn.contains(key(c)) {
            messages[key(c)] = "Apple 推送注册失败，请检查网络、签名与 Push Notifications 能力。"
        }
    }
    private func registerSaved() async {
        guard let token else { return }
        guard !working else { needsRegistration = true; return }
        working = true
        defer {
            working = false
            if needsRegistration { needsRegistration = false; Task { await self.registerSaved() } }
        }
        for c in connections where optedIn.contains(key(c)) {
            guard saved(c) else { continue }
            let id = key(c), explicit = explicitRegistrations.contains(id)
            do {
                let api = HostAPI(connection: c)
                let provider: JSONValue = try await api.get("/notification-providers/apns")
                let environment = Bundle.main.object(forInfoDictionaryKey: "KooyuAPNSEnvironment") as? String
                guard provider["enabled"].boolean, provider["topic"].string == Bundle.main.bundleIdentifier,
                      provider["environment"].string == environment else {
                    messages[id] = "请在 Host 配置与当前应用标识、签名环境一致的 APNs 服务。"; continue
                }
                let channels: [JSONValue] = try await api.get("/notification-channels")
                let old = channels.first { $0["kind"].string == "apns" && $0["deviceId"].string == c.deviceId }
                if !explicit, let old, !old["enabled"].boolean {
                    messages[id] = !old["unavailableReason"].string.isEmpty ? old["unavailableReason"].string : "Host 提醒已关闭，请点击重新启用。"; continue
                }
                guard saved(c), optedIn.contains(id) else { continue }
                let _: JSONValue = try await api.perform("/notification-channels", method: "PUT", body: .object([
                    "kind": .string("apns"), "enabled": .bool(true), "preview": .bool(old?["preview"].boolean ?? false),
                    "deviceToken": .string(token), "expectedRevision": .number(old?["revision"].number ?? 0),
                    "expectedProviderRevision": provider["revision"], "topic": provider["topic"], "environment": provider["environment"]
                ]))
                explicitRegistrations.remove(id)
                if saved(c) { messages[id] = "此 Host 的后台提醒已启用。" }
            } catch { if saved(c) { messages[id] = "推送注册未确认，请刷新或重新启用；不会重复执行任何事项。" } }
        }
    }
    func disable(_ c: Connection) async {
        guard !working else { return }
        working = true; defer { working = false }
        optedIn.remove(key(c)); explicitRegistrations.remove(key(c))
        pendingRevocations.insert(key(c))
        do {
            let id = c.deviceId + ":apns"
            let path = "/notification-channels/" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
            let _: JSONValue = try await HostAPI(connection: c).perform(path, method: "DELETE")
            pendingRevocations.remove(key(c))
            messages[key(c)] = "此 Host 的推送令牌已撤销。"
        } catch { messages[key(c)] = "Host 尚未确认关闭，请保持连接重试，或在 Host 撤销此设备。" }
    }
}

@MainActor final class KooyuAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await PushNotifications.shared.registered(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        Task { @MainActor in PushNotifications.shared.registrationFailed() }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier, let target = NotificationTarget(payload: response.notification.request.content.userInfo) else { return }
        await MainActor.run { PushNotifications.shared.pending = target }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        guard let target = NotificationTarget(payload: notification.request.content.userInfo) else { return [] }
        let visible = await PushNotifications.shared.isVisible?(target) ?? false
        return visible ? [] : [.banner, .sound]
    }
}

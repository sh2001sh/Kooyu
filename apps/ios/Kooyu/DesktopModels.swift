import Foundation

struct ConnectionBook: Codable, Sendable {
    var devices: [Connection] = []
    var activeHostId: String?
    var active: Connection? { devices.first { $0.hostId == activeHostId } }
    init(devices: [Connection] = [], activeHostId: String? = nil) { self.devices = devices; self.activeHostId = activeHostId }
    private enum CodingKeys: String, CodingKey { case devices, activeHostId }
    init(from decoder: any Decoder) throws {
        if let legacy = try? decoder.singleValueContainer().decode(Connection.self) {
            devices = [legacy]; activeHostId = legacy.hostId; return
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let decoded = try values.decode([Connection].self, forKey: .devices)
        var seen = Set<String>()
        devices = decoded.filter { seen.insert($0.hostId).inserted }
        let requested = try values.decodeIfPresent(String.self, forKey: .activeHostId)
        activeHostId = devices.contains { $0.hostId == requested } ? requested : devices.first?.hostId
    }
    mutating func put(_ value: Connection, activate: Bool = false) {
        if let index = devices.firstIndex(where: { $0.hostId == value.hostId }) { devices[index] = value } else { devices.append(value) }
        if activate || activeHostId == nil { activeHostId = value.hostId }
    }
    mutating func remove(_ id: String) {
        devices.removeAll { $0.hostId == id }
        if activeHostId == id { activeHostId = devices.first?.hostId }
    }
}
struct HostWorkspace: Codable, Identifiable, Sendable { let id, rootPath: String; let projectId: String? }
struct HostHarness: Codable, Identifiable, Sendable { let id, name: String; var modelSupport: String?; var health: JSONValue?; var nativeDefaults: JSONValue? }
struct UsageRecord: Codable, Identifiable, Sendable {
    let id, sessionId, source, scope, costKind, createdAt: String
    let projectId: String?
    let bindingId: String?
    let model: String?
    let input, output, cacheRead, cacheWrite, costUsd: Double?
    var tokens: Double { [input, output, cacheRead, cacheWrite].compactMap { $0 }.reduce(0, +) }
}
struct UsageReport: Decodable, Sendable { let records: [UsageRecord]; let budgets: [JSONValue] }
func usageDayKey(_ value: String, calendar: Calendar = .current) -> String? {
    let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return nil }
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
    return String(format: "%04d-%02d-%02d", year, month, day)
}
func filteredUsage(_ records: [UsageRecord], days: Int = 14, project: String = "", source: String = "", session: String? = nil, scope: String = "all", now: Date = Date()) -> [UsageRecord] {
    let turnSessions = Set(records.filter { $0.scope == "turn" }.map(\.sessionId))
    let cutoff = days > 0 ? Calendar.current.date(byAdding: .day, value: -(days - 1), to: Calendar.current.startOfDay(for: now)) : nil
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fallback = ISO8601DateFormatter()
    return records.filter { record in
        if !project.isEmpty && record.projectId != project { return false }
        if !source.isEmpty && record.source != source { return false }
        if let session, record.sessionId != session { return false }
        if scope != "all" && record.scope != scope { return false }
        if scope == "all" && record.scope == "session" && turnSessions.contains(record.sessionId) { return false }
        if let cutoff, let date = formatter.date(from: record.createdAt) ?? fallback.date(from: record.createdAt), date < cutoff { return false }
        return true
    }
}
struct SessionDraft: Sendable {
    var title = "", harnessId = "kodo", kind = "supervisor", projectId = "", workspaceId = "", choice = "inherit", model = "", reasoning = "", permission = "", firstMessage = ""
    var body: JSONValue {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstLine = String(firstMessage.split(separator: "\n").first?.prefix(48) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var value: [String: JSONValue] = ["title": .string(trimmed.isEmpty ? (firstLine.isEmpty ? "新对话" : firstLine) : trimmed),
            "harnessId": .string(harnessId), "kind": .string(harnessId == "kodo" ? kind : "direct"),
            "projectId": projectId.isEmpty ? .null : .string(projectId), "workspaceId": workspaceId.isEmpty ? .null : .string(workspaceId)]
        if choice == "native" { value["bindingId"] = .null; value["model"] = .null }
        else if choice.hasPrefix("binding:") { value["bindingId"] = .string(String(choice.dropFirst(8))); value["model"] = model.isEmpty ? .null : .string(model) }
        else if choice == "model" { value["bindingId"] = .null; value["model"] = .string(model) }
        if !reasoning.isEmpty { value["reasoning"] = .string(reasoning) }
        if !permission.isEmpty { value["permissionMode"] = .string(permission) }
        return .object(value)
    }
    func validation(_ snapshot: Snapshot?) -> String? {
        guard let snapshot, let harness = snapshot.harnesses?.first(where: { $0.id == harnessId }) else { return "请选择可用引擎。" }
        if title.count > 200 || firstMessage.count > 200000 { return "标题或首条消息过长。" }
        if (harnessId != "kodo" && harnessId != "pi" || !projectId.isEmpty) && workspaceId.isEmpty { return "请选择工作位置。" }
        if !workspaceId.isEmpty && snapshot.workspaces?.contains(where: { $0.id == workspaceId && (projectId.isEmpty || $0.projectId == projectId) }) != true { return "工作位置与项目不匹配。" }
        let projectBinding = snapshot.projects.first { $0.id == projectId }?.bindingDefaults?[harnessId].string ?? ""
        let inherited = projectBinding.isEmpty ? snapshot.bindingDefaults?["harnessBindingIds"][harnessId].string ?? "" : projectBinding
        if harness.modelSupport == "binding-required" && !(choice.hasPrefix("binding:") || choice == "inherit" && !inherited.isEmpty) { return "此引擎需要选择可用的模型绑定。" }
        if choice == "model" && model.isEmpty { return "请选择模型。" }
        return nil
    }
}
func nativeModelID(_ harness: String, _ model: JSONValue) -> String {
    let provider = model["provider"].string
    return ["kodo", "pi", "opencode", "zcode"].contains(harness) && !provider.isEmpty && !provider.hasPrefix("kodo-") ? provider + "/" + model["id"].string : model["id"].string
}
func permissionOptions(_ harness: String) -> [(String, String)] {
    switch harness {
    case "codex": return [("read-only", "只读"), ("workspace-write", "工作区写入"), ("full-access", "完全访问")]
    case "claude-code": return [("accept-edits", "自动接受编辑"), ("bypass-permissions", "跳过审批")]
    case "kodo", "pi": return [("kodo-tools-read", "仅阅读工具"), ("kodo-tools-none", "禁用工具")]
    case "zcode": return [("plan", "Plan"), ("build", "Build"), ("edit", "Edit"), ("guarded", "Guarded"), ("yolo", "YOLO")]
    case "kimi-code": return [("kimi:manual", "逐项审批"), ("kimi:auto", "自动判断"), ("kimi:yolo", "跳过审批")]
    case "opencode": return [("opencode-ask", "逐次审批"), ("opencode-deny", "禁用工具"), ("opencode-allow", "允许工具")]
    default: return []
    }
}

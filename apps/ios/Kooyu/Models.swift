import Foundation

enum JSONValue: Codable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    subscript(_ key: String) -> JSONValue { if case .object(let v) = self { v[key] ?? .null } else { .null } }
    var string: String { if case .string(let v) = self { v } else { "" } }
    var array: [JSONValue] { if case .array(let v) = self { v } else { [] } }
    var object: [String: JSONValue] { if case .object(let v) = self { v } else { [:] } }
    var number: Double? { if case .number(let v) = self { v } else { nil } }
    var boolean: Bool { if case .bool(let v) = self { v } else { false } }
    var text: String {
        if case .string(let v) = self { return v }
        if !self["text"].string.isEmpty { return self["text"].string }
        if !self["content"].string.isEmpty { return self["content"].string }
        if case .array(let parts) = self["content"] {
            return parts.filter { ["text", "output_text"].contains($0["type"].string) }
                .map { $0["text"].string }.filter { !$0.isEmpty }.joined(separator: "\n")
        }
        if case .null = self["message"] { return "" }
        return self["message"].text
    }
    var formatted: String {
        let e = JSONEncoder(); e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? String(decoding: e.encode(self), as: UTF8.self)) ?? ""
    }
}

struct HostSession: Codable, Identifiable, Hashable, Sendable {
    let id, title, harnessId, runState: String
    let projectId: String?
    let archived: Bool
    var workspaceId: String?
    var model: String?
    var reasoning: String?
    var permissionMode: String?
    var bindingId: String?
    var bindingUnavailable: Bool?
    var settingsRevision: Int?
    var pinned: Bool?
    var kind: String?
    var phase: String?
    var connectionState: String?
    var nativeCapabilities: [String: String]?
    var nativeSessionId: String?
    var stateLabel: String {
        if runState == "waiting-input" { return "等待输入" }
        if kind == "supervisor" { return projectId == nil ? "全局主对话" : "项目主对话" }
        if phase == "draft" { return "尚未启动" }
        if connectionState == "offline" { return "原生未连接" }
        if connectionState == "reconnecting" { return "原生重连中" }
        switch runState {
        case "running": return "正在运行"
        case "idle": return "空闲"
        case "waiting-input": return "等待输入"
        default: return "待核对"
        }
    }
}
struct HostProject: Codable, Identifiable, Sendable { let id, name: String; var bindingDefaults: JSONValue?; var configRevision: Int? }
struct NativeAction: Codable, Sendable { let label: String; let answer: JSONValue; let destructive: Bool? }
struct InboxItem: Codable, Identifiable, Sendable {
    let id, sessionId, type: String
    let payload: JSONValue
    let resolved: Bool
    let actions: [NativeAction]?
}
struct HostGoal: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String
    let controllerSessionId: String?
    let sessionIds: [String]?
    let verificationStatus: String?
}
struct GoalIdentifiable: Identifiable { let id: String }

struct Snapshot: Decodable, Sendable {
    let protocolVersion: Int
    let hostId: String
    let sessions: [HostSession]
    let projects: [HostProject]
    let inbox: [InboxItem]
    let workspaces: [HostWorkspace]?
    let harnesses: [HostHarness]?
    let bindings: [JSONValue]?
    let bindingDefaults: JSONValue?
    let supervisions: [JSONValue]?
    let goals: [HostGoal]?
}
struct RuntimeEvent: Codable, Identifiable, Sendable {
    let id, type: String
    let sequence: Int
    let payload: JSONValue
    var createdAt: String? = nil
    var text: String {
        if type == "text-delta" { return payload["delta"].string.isEmpty ? payload["text"].string : payload["delta"].string }
        return payload.text
    }
    var role: String { payload["role"].string == "user" ? "你" : type == "error" ? "运行错误" : "助手" }
}
struct SessionPage: Decodable, Sendable {
    let session: HostSession
    let events: [RuntimeEvent]
    let olderCursor: Int?
    var commands: [JSONValue]?
    /// Built once per page so SwiftUI body passes do not re-parse the event log.
    let transcript: Transcript
    var rows: [TranscriptRow] { transcript.rows }
    enum CodingKeys: String, CodingKey { case session, events, olderCursor, commands }
    init(session: HostSession, events: [RuntimeEvent], olderCursor: Int?, commands: [JSONValue]? = nil) {
        self.session = session; self.events = events; self.olderCursor = olderCursor; self.commands = commands
        transcript = buildTranscript(events)
    }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        session = try c.decode(HostSession.self, forKey: .session)
        events = try c.decode([RuntimeEvent].self, forKey: .events)
        olderCursor = try c.decodeIfPresent(Int.self, forKey: .olderCursor)
        commands = try c.decodeIfPresent([JSONValue].self, forKey: .commands)
        transcript = buildTranscript(events)
    }
}
struct PendingOperation: Codable, Sendable {
    let id, path: String
    let body: JSONValue
    var method: String? = nil
    var management: Bool? = nil
}
struct Connection: Codable, Identifiable, Sendable {
    let url, hostId, deviceId, token, expiresAt: String
    var pending: PendingOperation?
    var name: String? = nil
    var id: String { hostId }
    var displayName: String {
        let value = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if value.isEmpty || value == "我的电脑" { return "我的设备" }
        if value.range(of: #"^电脑\s*\d+$"#, options: .regularExpression) != nil { return value.replacingOccurrences(of: "电脑", with: "设备") }
        return value
    }
}
struct PairResult: Decodable, Sendable {
    struct Device: Decodable, Sendable { let id, expiresAt: String }
    let device: Device
    let token, hostId: String
    let protocolVersion: Int
}
struct APIError: Error, LocalizedError {
    let message: String
    let status: Int
    var errorDescription: String? { message }
}

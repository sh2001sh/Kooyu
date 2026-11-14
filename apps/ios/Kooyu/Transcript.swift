import Foundation

/*
 Mirrors apps/web/src/components/TranscriptView.tsx (buildTranscriptRows, toolSummary, toolOutput)
 and the Android Transcript.kt, so every client shows the same intermediate process: thinking,
 tool calls, sub-agents and turn failures, not only the final answer.
 */

enum RowRole: String, Sendable { case user, assistant, thinking, tool, subagent, error }

struct ChildTranscript: Sendable, Hashable {
    let agentId: String
    var name: String?
    var parentAgentId: String?
    var status: String?
    var events: [RuntimeEvent]
    static func == (a: ChildTranscript, b: ChildTranscript) -> Bool { a.agentId == b.agentId && a.status == b.status && a.events.count == b.events.count && a.name == b.name }
    func hash(into h: inout Hasher) { h.combine(agentId) }
}

struct TranscriptRow: Identifiable, Sendable {
    let id: String
    let role: RowRole
    let text: String
    var eventIds: [String] = []
    var payload: JSONValue = .null
    var origin: String? = nil
    var child: ChildTranscript? = nil
}

struct Transcript: Sendable {
    let rows: [TranscriptRow]
    let thinkingPending: Bool
    static let empty = Transcript(rows: [], thinkingPending: false)
}

/// A run of consecutive tool calls collapses into one group, like the desktop.
enum TranscriptBlock: Identifiable, Sendable {
    case single(TranscriptRow)
    case tools([TranscriptRow])
    var id: String {
        switch self { case .single(let r): r.id; case .tools(let rows): "tools:" + (rows.first?.id ?? "") }
    }
}

func transcriptBlocks(_ rows: [TranscriptRow]) -> [TranscriptBlock] {
    var blocks: [TranscriptBlock] = []
    for row in rows {
        if row.role == .tool, case .tools(let group)? = blocks.last { blocks[blocks.count - 1] = .tools(group + [row]) }
        else { blocks.append(row.role == .tool ? .tools([row]) : .single(row)) }
    }
    return blocks
}

/// Assistant rows after the first in a turn drop the header, like desktop `is-cont`.
func continuationFlags(_ blocks: [TranscriptBlock]) -> [Bool] {
    var seen = false
    return blocks.map { block in
        guard case .single(let row) = block else { return false }
        switch row.role {
        case .user, .error: seen = false; return false
        case .assistant: let cont = seen; seen = true; return cont
        default: return false
        }
    }
}

extension JSONValue {
    var isNull: Bool { if case .null = self { true } else { false } }
    /// String or number rendered as text; nil for null/empty.
    var key: String? {
        switch self {
        case .string(let v): v.isEmpty ? nil : v
        case .number(let v): v == v.rounded() ? String(Int(v)) : String(v)
        case .bool(let v): String(v)
        default: nil
        }
    }
    var truthy: Bool {
        switch self {
        case .null: false
        case .bool(let v): v
        case .string(let v): !v.isEmpty
        case .number(let v): v != 0
        default: true
        }
    }
    func firstText(_ keys: String...) -> String { keys.lazy.compactMap { self[$0].key }.first ?? "" }
    func merging(_ other: JSONValue) -> JSONValue {
        var base = object
        for (k, v) in other.object { base[k] = v }
        return .object(base)
    }
}

func buildTranscript(_ events: [RuntimeEvent]) -> Transcript {
    var rows: [TranscriptRow] = []
    var children: [String: ChildTranscript] = [:]
    var stream = "", streamKey = ""
    var streamIds: [String] = []
    var thought = "", thoughtKey = ""
    var thoughtItem: String? = nil

    func upsert(_ row: TranscriptRow, merge: (TranscriptRow) -> TranscriptRow) {
        if let i = rows.firstIndex(where: { $0.id == row.id }) { rows[i] = merge(rows[i]) } else { rows.append(row) }
    }
    func flushThought() {
        let trimmed = thought.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let id = thoughtItem.map { "thought:\($0)" } ?? thoughtKey
            let row = TranscriptRow(id: id, role: .thinking, text: trimmed)
            upsert(row) { _ in row }
        }
        thought = ""; thoughtItem = nil
    }
    func flush() {
        flushThought()
        if !stream.isEmpty {
            rows.append(TranscriptRow(id: streamKey, role: .assistant, text: stream, eventIds: streamIds))
            stream = ""; streamIds = []
        }
    }
    func addError(_ id: String, _ text: String, _ payload: JSONValue) {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty, !rows.contains(where: { $0.role == .error && $0.text == text }) else { return }
        rows.append(TranscriptRow(id: id, role: .error, text: text, eventIds: [id], payload: payload))
    }

    for e in events {
        let p = e.payload
        switch e.type {
        case "subagent":
            let agentId = p["agentId"].string
            guard !agentId.isEmpty else { continue }
            if children[agentId] == nil {
                flush()
                children[agentId] = ChildTranscript(agentId: agentId, events: [])
                rows.append(TranscriptRow(id: "subagent:\(agentId)", role: .subagent, text: "", eventIds: [e.id]))
            }
            var child = children[agentId]!
            if !p["name"].string.isEmpty { child.name = p["name"].string }
            if !p["parentAgentId"].string.isEmpty { child.parentAgentId = p["parentAgentId"].string }
            if !p["status"].string.isEmpty { child.status = p["status"].string }
            let inner = p["event"], innerType = inner["type"].string
            if !innerType.isEmpty, innerType != "subagent" {
                let value = inner["payload"]
                if innerType == "turn-ended", !value["outcome"].string.isEmpty { child.status = value["outcome"].string }
                else if innerType == "state", !value["runState"].string.isEmpty { child.status = value["runState"].string }
                child.events.append(RuntimeEvent(id: "\(e.id):\(child.events.count)", type: innerType, sequence: e.sequence, payload: value))
            }
            children[agentId] = child
        case "text-delta":
            let text = p["text"].string.isEmpty ? p["delta"].string : p["text"].string
            if p["channel"].string == "thought" {
                let item = p["itemId"].key
                if !thought.isEmpty, let item, item != thoughtItem { flushThought() }
                if thought.isEmpty { thoughtKey = "thought:\(e.id)" }
                thoughtItem = item
                thought += text
            } else {
                flushThought()
                if stream.isEmpty { streamKey = e.id }
                stream += text; streamIds.append(e.id)
            }
        case "message":
            let text = p.text
            if text.isEmpty { continue }
            if p["channel"].string == "thought" || p["type"].string == "reasoning" {
                let item = p["id"].key
                if !thought.isEmpty, item != thoughtItem { flushThought() }
                thoughtItem = item ?? e.id
                thoughtKey = "thought:\(thoughtItem!)"
                thought = text
                continue
            }
            let role: RowRole = p["role"].string == "user" ? .user : .assistant
            flushThought()
            if role == .user { flush() } else { stream = ""; streamIds = [] }
            let id = p["id"].key.map { "message:\($0)" } ?? e.id
            let origin: String? = switch p["origin"].string { case "supervisor": "由主对话发送"; case "wake": "持久事件唤醒"; default: nil }
            let row = TranscriptRow(id: id, role: role, text: text, eventIds: [e.id], origin: origin)
            upsert(row) { old in var next = row; next.eventIds = old.eventIds + [e.id]; return next }
        case "tool":
            if ["userMessage", "reasoning"].contains(p["type"].string) { continue }
            flush()
            let key = p["toolCallId"].key ?? p["id"].key ?? p["part"]["id"].key
            let id = key.map { "tool:\($0)" } ?? e.id
            let row = TranscriptRow(id: id, role: .tool, text: "", eventIds: [e.id], payload: p)
            upsert(row) { old in var next = row; next.payload = old.payload.merging(p); next.eventIds = old.eventIds + [e.id]; return next }
        case "turn-ended", "settled":
            flush()
            let reasoned = e.type == "turn-ended" || p["error"].truthy || p["message"].truthy
            if let message = failureText(p), reasoned { addError(e.id, message, p) }
        case "state":
            if p["message"].truthy || p["error"].truthy {
                flush()
                let message = !p["message"].string.isEmpty ? p["message"].string : (!p["error"]["message"].string.isEmpty ? p["error"]["message"].string : (p["error"].key ?? p["error"].formatted))
                addError(e.id, message, p)
            }
        case "error", "disconnected":
            flush()
            var message = p["message"].string
            if message.isEmpty { message = p.text.isEmpty ? "运行出现错误，请在桌面核对。" : p.text }
            let text = e.type == "disconnected" ? "原生连接已断开：\(message)" : message
            if rows.last?.text != text { rows.append(TranscriptRow(id: e.id, role: .error, text: text, eventIds: [e.id], payload: p)) }
        default: break
        }
    }
    let thinkingPending = !thought.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && stream.isEmpty
    flush()
    let frozen = rows.map { row -> TranscriptRow in
        guard row.role == .subagent, let child = children[String(row.id.dropFirst("subagent:".count))] else { return row }
        var next = row; next.child = child; return next
    }
    return Transcript(rows: frozen, thinkingPending: thinkingPending)
}

/// Compatibility helper: rows only.
func transcript(_ events: [RuntimeEvent]) -> [TranscriptRow] { buildTranscript(events).rows }

/// Readable reason for a failed native turn; nil for successful or cancelled turns.
func failureText(_ p: JSONValue) -> String? {
    guard p["outcome"].string == "failed" else { return nil }
    let error = p["error"].isNull ? p["reason"] : p["error"]
    var text = error.string
    if text.isEmpty { text = error["underlyingErrorMessage"].string }
    if text.isEmpty { text = error["message"].string }
    if text.isEmpty { text = p["message"].string }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "本轮执行失败，原生未提供原因。" : trimmed
}

enum ToolStatus: String, Sendable { case running = "进行中", done = "完成", failed = "失败" }
struct ToolSummary: Sendable { let title, detail: String; let status: ToolStatus? }

/// Drop the shell wrapper Codex adds on Windows so the command itself is visible.
func bareCommand(_ value: JSONValue) -> String {
    var text = (value.key ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if let range = text.range(of: #"powershell\.exe"?\s+-Command\s+"#, options: [.regularExpression, .caseInsensitive]) {
        text = String(text[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if text.count > 1, text.hasPrefix("'"), text.hasSuffix("'") { text = String(text.dropFirst().dropLast()) }
    return text
}

func toolSummary(_ p: JSONValue) -> ToolSummary {
    let exit = p["exitCode"].number
    let failed = p["status"].string == "failed" || p["is_error"].boolean || p["isError"].boolean || (exit != nil && exit != 0)
    let done = p["status"].string == "completed" || p["lifecycle"].string == "completed" || exit != nil
    let status: ToolStatus? = failed ? .failed : done ? .done : p["lifecycle"].string == "started" ? .running : nil
    switch p["type"].string {
    case "commandExecution": return ToolSummary(title: "运行命令", detail: bareCommand(p["command"]), status: status)
    case "fileChange": return ToolSummary(title: "修改文件", detail: p["changes"].array.map { $0["path"].string }.joined(separator: ", "), status: status)
    case "mcpToolCall": return ToolSummary(title: "\(p["server"].string).\(p["tool"].string)", detail: "", status: status)
    case "webSearch": return ToolSummary(title: "网页搜索", detail: p["query"].string, status: status)
    case "tool_use":
        let name = p["name"].string
        return ToolSummary(title: name.isEmpty ? "工具" : name, detail: p["input"].firstText("command", "file_path", "path", "pattern", "url", "description"), status: status)
    default:
        if p["role"].string == "toolResult" {
            let name = p["toolName"].string
            return ToolSummary(title: (name.isEmpty ? "工具" : name) + " 结果", detail: "", status: status)
        }
        if p["content"].array.contains(where: { $0["type"].string == "tool_result" }) { return ToolSummary(title: "工具结果", detail: "", status: status) }
        let name = p.firstText("title", "toolName", "name", "tool", "type")
        let input = ["input", "rawInput", "args", "arguments"].lazy.map { p[$0] }.first { !$0.object.isEmpty } ?? p["state"]["input"]
        return ToolSummary(title: name.isEmpty ? "工具调用" : name, detail: input.firstText("command", "path", "filePath"), status: status)
    }
}

func toolOutput(_ p: JSONValue) -> String {
    if !p["aggregatedOutput"].string.isEmpty { return p["aggregatedOutput"].string }
    if case .string(let v) = p["state"]["output"] { return v }
    if case .array(let content) = p["content"] {
        let text = content.map { c -> String in
            if case .string(let v) = c["text"] { return v }
            if case .string(let v) = c["content"] { return v }
            if case .string(let v) = c["content"]["text"] { return v }
            if case .array(let parts) = c["content"] { return parts.map { $0["text"].string }.joined(separator: "\n") }
            return ""
        }.filter { !$0.isEmpty }.joined(separator: "\n")
        if !text.isEmpty { return text }
    }
    if case .string(let v) = p["rawOutput"] { return v }
    return p.formatted
}

let subagentStatusLabels: [String: String] = ["running": "进行中", "busy": "进行中", "pendingInit": "启动中", "completed": "完成", "idle": "空闲",
    "failed": "失败", "errored": "失败", "cancelled": "已取消", "stopped": "已停止", "shutdown": "已停止"]

/// Text attachments travel inline in the user message; split them out so the phone can show file chips.
struct UserMessageParts: Sendable { let text: String; let files: [(name: String, content: String)] }
func splitAttachments(_ text: String) -> UserMessageParts {
    let pattern = #"--- 附加文本文件：(.+?) ---\n([\s\S]*?)\n--- 文件结束 ---"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return UserMessageParts(text: text, files: []) }
    let ns = text as NSString
    let matches = regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
    guard !matches.isEmpty else { return UserMessageParts(text: text, files: []) }
    let files = matches.map { (name: ns.substring(with: $0.range(at: 1)), content: ns.substring(with: $0.range(at: 2))) }
    let rest = regex.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: ns.length), withTemplate: "")
    return UserMessageParts(text: rest.trimmingCharacters(in: .whitespacesAndNewlines), files: files)
}

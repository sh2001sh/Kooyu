import Foundation
import Observation

@MainActor @Observable final class Workbench {
    var book = ConnectionBook()
    var connection: Connection? { book.active }
    var snapshot: Snapshot?
    var page: SessionPage?
    var selected: String?
    var selectedTab = "sessions"
    var readingAnchors: [String: String] = [:]
    let push = PushNotifications.shared
    var usage: UsageReport?
    var appSettings: JSONValue?
    var usageError = ""
    var composerDraft = ""
    var composerAttachments: [ManagedAttachment] = []
    var usageLoading = false
    var loadingHistory = false
    var addingDevice = false
    var error = ""
    var notice = ""
    var online = false
    var busy = false
    var canWrite: Bool { connection != nil && online && !busy && connection?.pending == nil }
    private var refreshing = false
    private var epoch = 0
    private var settingsRefreshedAt = Date.distantPast
    private var settingsRefresh: Task<Void, Never>?
    init() { do { book = try ConnectionVault.load() } catch { self.error = error.localizedDescription } }
    private func current(_ c: Connection, _ generation: Int) -> Bool { epoch == generation && connection?.token == c.token && connection?.hostId == c.hostId }
    private func commit(_ next: ConnectionBook) throws { try ConnectionVault.save(next); book = next }
    private func reset(_ next: ConnectionBook) {
        settingsRefresh?.cancel(); settingsRefresh = nil
        epoch += 1; book = next; snapshot = nil; page = nil; selected = nil; usage = nil; appSettings = nil
        settingsRefreshedAt = .distantPast
        online = false; busy = false; error = ""; notice = ""; usageError = ""; composerDraft = ""
        composerAttachments = []
        usageLoading = false; loadingHistory = false; addingDevice = false
    }
    func switchDevice(_ id: String) {
        guard !busy, id != book.activeHostId, book.devices.contains(where: { $0.hostId == id }) else { return }
        do { var next = book; next.activeHostId = id; try commit(next); reset(next) } catch { self.error = error.localizedDescription }
    }
    func renameDevice(_ id: String, name: String) {
        guard !busy, let index = book.devices.firstIndex(where: { $0.hostId == id }), !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do { var next = book; next.devices[index].name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60)); try commit(next) } catch { self.error = error.localizedDescription }
    }
    func removeDevice(_ id: String) {
        guard !busy else { return }
        do { let active = book.activeHostId == id; var next = book; next.remove(id); try commit(next); if active { reset(next) } } catch { self.error = error.localizedDescription }
    }
    func pair(url: String, code: String, name: String = "") async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            var c = try await HostAPI.pair(url: url, code: code, name: "Kooyu iOS")
            let previous = book.devices.first { $0.hostId == c.hostId }
            c.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? previous?.displayName ?? "设备 \(book.devices.count + 1)" : String(name.prefix(60))
            c.pending = previous?.pending
            var next = book; next.put(c, activate: true); try commit(next); reset(next); busy = true
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    func refresh() async {
        guard let c = connection, !refreshing else { return }
        let generation = epoch; refreshing = true; defer { refreshing = false }
        do {
            let api = HostAPI(connection: c)
            let next: Snapshot = try await api.get("/native/snapshot")
            guard next.hostId == c.hostId, next.protocolVersion == HostAPI.protocolVersion else { throw APIError(message: "设备身份或版本发生变化，请重新连接。", status: 409) }
            guard current(c, generation) else { return }
            let reconnecting = !online && snapshot != nil
            snapshot = next; if !online { error = "" }; online = true
            if reconnecting { notice = "连接已恢复 · \(next.inbox.filter { !$0.resolved }.count) 项待处理，可在「待办」查看。" }
            refreshSettings(c, generation)
            if let id = selected {
                let cursor = page?.events.map(\.sequence).max()
                let path = "/sessions/\(id)" + (cursor.map { "?after=\($0)" } ?? "?tail=300")
                let detail: SessionPage = try await api.get(path)
                if selected == id && current(c, generation) {
                    page = SessionPage(session: detail.session, events: mergedEvents(page?.events ?? [], detail.events), olderCursor: cursor == nil ? detail.olderCursor : page?.olderCursor, commands: detail.commands ?? page?.commands)
                }
            }
            if let op = c.pending {
                let path: String? = op.management == true ? "/client/operations/\(op.id)" : op.path.hasSuffix("/send") || op.path.hasSuffix("/stop") ? "/commands/\(op.id)" : op.path.hasSuffix("/settings") || op.path.contains("/commands/") && op.method == "PATCH" ? op.path + "?requestId=\(op.id)" : nil
                if let path, let receipt: JSONValue = try? await api.get(path), current(c, generation), connection?.pending?.id == op.id, op.management != true || ["confirmed", "failed"].contains(receipt["status"].string) { try clearPending(); notice = receipt["status"].string == "failed" ? receipt["error"]["message"].string : "已从设备核对操作回执。" }
            }
        } catch is CancellationError { }
        catch {
            guard current(c, generation) else { return }; online = false; self.error = error.localizedDescription
            if (error as? APIError)?.status == 401 { snapshot = nil; page = nil; usage = nil }
        }
    }
    private func refreshSettings(_ c: Connection, _ generation: Int) {
        guard settingsRefresh == nil, Date().timeIntervalSince(settingsRefreshedAt) >= 30 else { return }
        settingsRefreshedAt = Date()
        settingsRefresh = Task { [weak self] in
            let settings: JSONValue? = try? await HostAPI(connection: c).get("/app-settings")
            guard let self, !Task.isCancelled, self.current(c, generation) else { return }
            if let settings { self.appSettings = settings }
            // Optional preferences never block messages or decide connection/auth state.
            self.settingsRefresh = nil
        }
    }
    func refreshUsage() async {
        guard let c = connection, !usageLoading else { return }; let generation = epoch
        usageLoading = true; defer { if current(c, generation) { usageLoading = false } }
        do { let next: UsageReport = try await HostAPI(connection: c).get("/usage"); if current(c, generation) { usage = next; usageError = "" } }
        catch is CancellationError { }
        catch { if current(c, generation) { usageError = error.localizedDescription } }
    }
    func read(_ path: String) async -> JSONValue? {
        guard let c = connection else { return nil }; let generation = epoch
        do { let value: JSONValue = try await HostAPI(connection: c).get(path); return current(c, generation) ? value : nil }
        catch is CancellationError { return nil }
        catch { if current(c, generation) { self.error = error.localizedDescription }; return nil }
    }
    func loadOlder() async {
        guard let c = connection, let id = selected, let before = page?.olderCursor, !loadingHistory else { return }
        let generation = epoch; loadingHistory = true; defer { if current(c, generation) { loadingHistory = false } }
        do {
            let older: SessionPage = try await HostAPI(connection: c).get("/sessions/\(id)?before=\(before)")
            if current(c, generation), selected == id, let present = page { page = SessionPage(session: present.session, events: mergedEvents(present.events, older.events), olderCursor: older.olderCursor, commands: present.commands) }
        } catch { if current(c, generation) { self.error = error.localizedDescription } }
    }
    func select(_ id: String) async { if selected != id || page?.session.id != id { selected = id; page = nil; composerDraft = ""; composerAttachments = [] }; await refresh() }
    func openSearchHit(_ sessionID: String, eventID: String) async -> Bool {
        guard let c = connection else { return false }; let generation = epoch
        do {
            let id = eventID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? eventID
            let detail: SessionPage = try await HostAPI(connection: c).get("/sessions/\(sessionID)?event=\(id)")
            guard current(c, generation) else { return false }; selected = sessionID; page = detail; return true
        } catch { if current(c, generation) { self.error = error.localizedDescription }; return false }
    }
    func send(_ text: String, mode: String? = nil, attachmentIds: [String] = []) async -> Bool {
        guard let id = selected, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachmentIds.isEmpty, text.count <= 200000 else { return false }
        let sent = await execute("/sessions/\(id)/send", values: ["text": .string(text), "mode": .string(mode ?? composerSendMode(snapshot?.sessions.first { $0.id == id }?.runState ?? "unknown")), "attachmentIds": .array(attachmentIds.map { .string($0) })]) != nil
        if sent && selected == id { composerDraft = ""; composerAttachments = [] }
        return sent
    }
    func branch(_ row: TranscriptRow, edit: Bool) async -> Bool {
        guard let owner = selected, let event = row.eventIds.first else { return false }
        guard let result = await execute("/sessions/\(owner)/branch", values: ["eventId": .string(event), "edit": .bool(edit)], refreshAfter: false) else { return false }
        await select(result["id"].string)
        if edit { composerDraft = row.text }
        return true
    }
    func cancelTurn() async { if let id = selected { _ = await execute("/sessions/\(id)/stop", values: ["pause": .bool(false)]) } }
    func stop() async { if let id = selected { _ = await execute("/sessions/\(id)/stop", values: ["pause": .bool(true)]) } }
    func answer(_ item: InboxItem, action: NativeAction) async {
        let id = item.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? item.id
        _ = await execute("/interactions/\(id)", values: ["answer": action.answer])
    }
    func execute(_ path: String, method: String = "POST", values: [String: JSONValue] = [:], refreshAfter: Bool = true) async -> JSONValue? {
        guard var c = connection, canWrite else { return nil }; let generation = epoch
        busy = true; defer { if current(c, generation) { busy = false } }
        let id = UUID().uuidString.lowercased(); var fields = values
        let management = path.hasPrefix("/automations") && path != "/automations/preview" || path.hasPrefix("/memory") || path.hasPrefix("/goals/") && path.hasSuffix("/review")
        if path.hasSuffix("/send") || path.hasSuffix("/stop") || path.hasSuffix("/settings") || path.hasSuffix("/branch") || path.hasPrefix("/interactions/") || path.contains("/commands/") && method == "PATCH" { fields["requestId"] = .string(id) }
        let body = JSONValue.object(fields)
        c.pending = PendingOperation(id: id, path: path, body: body, method: method, management: management)
        do {
            var next = book; next.put(c); try commit(next)
            var result: JSONValue = try await HostAPI(connection: c).perform(management ? "/client/operations" : path, method: management ? "POST" : method, body: management ? .object(["requestId": .string(id), "path": .string("/api" + path), "method": .string(method), "body": body]) : method == "DELETE" ? nil : body)
            guard current(c, generation) else { return nil }
            if management {
                if result["status"].string != "confirmed" {
                    if result["status"].string == "failed" { try clearPending() }
                    self.error = result["error"]["message"].string.isEmpty ? "操作结果待核对，不会自动重发。" : result["error"]["message"].string
                    return nil
                }
                result = result["result"]
            }
            try clearPending(); notice = "设备已保存操作。"
            if path == "/app-settings" && method == "PATCH" { appSettings = result }
            if refreshAfter { await refresh() }; return result
        } catch {
            guard current(c, generation) else { return nil }
            if let failure = error as? APIError, (400..<500).contains(failure.status) { try? clearPending() }
            self.error = "\(error.localizedDescription)\n结果未知时请先核对，应用不会自动重发。"; return nil
        }
    }
    func clearPending() throws { guard var c = connection else { return }; c.pending = nil; var next = book; next.put(c); try commit(next) }
    func createSession(_ draft: SessionDraft, attachments: [ManagedAttachment] = []) async -> Bool {
        let generation = epoch
        var effective = draft
        if snapshot?.harnesses?.first(where: { $0.id == draft.harnessId })?.modelSupport == "native-only" { effective.choice = "native" }
        if !draft.customPath.isEmpty {
            guard let workspace = await execute("/workspaces", values: ["projectId": draft.projectId.isEmpty ? .null : .string(draft.projectId), "rootPath": .string(draft.customPath)]) else { return false }
            effective.workspaceId = workspace["id"].string
        }
        guard let c = connection, let result = await execute("/sessions", values: effective.body.object, refreshAfter: false), current(c, generation) else { return false }
        let id = result["id"].string; guard !id.isEmpty else { return false }
        selected = id; page = nil; await refresh()
        if !draft.firstMessage.isEmpty || !attachments.isEmpty {
            let sent = await send(draft.firstMessage, mode: "new", attachmentIds: attachments.map(\.id))
            if !sent { composerDraft = draft.firstMessage; composerAttachments = attachments }
        }
        return true
    }
    func createSession(title: String, projectId: String?) async -> Bool { var draft = SessionDraft(); draft.title = title; draft.projectId = projectId ?? ""; return await createSession(draft) }
    func updateSession(_ id: String, values: [String: JSONValue]) async -> Bool { await execute("/sessions/\(id)", method: "PATCH", values: values) != nil }
    func deleteSession(_ id: String) async {
        if await execute("/sessions/\(id)", method: "DELETE", refreshAfter: false) != nil { if selected == id { selected = nil; page = nil }; await refresh() }
    }
    func disconnect() { if let c = connection { removeDevice(c.hostId) } }
    func notificationIsVisible(_ target: NotificationTarget) async -> Bool {
        guard let c = connection, c.hostId == target.hostId else { return false }
        let generation = epoch
        do {
            let api = HostAPI(connection: c)
            let item: JSONValue = try await api.perform(target.path, timeout: 2)
            guard current(c, generation), item["id"].string == target.notificationId, item["link"]["hostId"].string == c.hostId,
                  selectedTab == "sessions", !item["sessionId"].string.isEmpty, item["sessionId"].string == selected else { return false }
            let _: JSONValue = try await api.perform(target.path + "/ack", method: "POST", body: .object(["sessionId": item["sessionId"]]), timeout: 2)
            return current(c, generation) && selectedTab == "sessions" && selected == item["sessionId"].string
        } catch { return false }
    }
    func openNotification(_ target: NotificationTarget) async -> Bool {
        guard !busy, let c = book.devices.first(where: { $0.hostId == target.hostId }) else {
            notice = "此通知的 Host 未配对，或当前操作尚未完成。"; return false
        }
        let generation = epoch
        do {
            let api = HostAPI(connection: c)
            let item: JSONValue = try await api.get(target.path)
            let state: Snapshot = try await api.get("/native/snapshot")
            guard !busy, epoch == generation, book.devices.contains(where: { $0.hostId == c.hostId && $0.token == c.token }),
                  state.hostId == c.hostId, state.protocolVersion == HostAPI.protocolVersion, item["id"].string == target.notificationId,
                  item["link"]["hostId"].string == c.hostId else { return false }
            switchDevice(c.hostId)
            snapshot = state
            let sessionId = item["sessionId"].string
            if !sessionId.isEmpty, state.sessions.contains(where: { $0.id == sessionId }) {
                selectedTab = "sessions"; await select(sessionId)
            } else { selectedTab = "inbox"; notice = item["title"].string }
            guard connection?.hostId == c.hostId, connection?.token == c.token else { return false }
            let _: JSONValue = try await api.perform(target.path + "/read", method: "POST", body: .object([:]))
            return true
        } catch { if epoch == generation { self.error = "无法打开此通知，请检查 Host 连接或事项是否已过期。" }; return false }
    }
}
func mergedEvents(_ current: [RuntimeEvent], _ incoming: [RuntimeEvent]) -> [RuntimeEvent] {
    var events: [String: RuntimeEvent] = [:]; for event in current + incoming { events[event.id] = event }; return events.values.sorted { $0.sequence < $1.sequence }
}

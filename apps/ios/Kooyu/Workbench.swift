import Foundation
import Observation

@MainActor @Observable final class Workbench {
    var book = ConnectionBook()
    var connection: Connection? { book.active }
    var snapshot: Snapshot?
    var page: SessionPage?
    var selected: String?
    var usage: UsageReport?
    var appSettings: JSONValue?
    var usageError = ""
    var composerDraft = ""
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
    init() { do { book = try ConnectionVault.load() } catch { self.error = error.localizedDescription } }
    private func current(_ c: Connection, _ generation: Int) -> Bool { epoch == generation && connection?.token == c.token && connection?.hostId == c.hostId }
    private func commit(_ next: ConnectionBook) throws { try ConnectionVault.save(next); book = next }
    private func reset(_ next: ConnectionBook) {
        epoch += 1; book = next; snapshot = nil; page = nil; selected = nil; usage = nil; appSettings = nil
        settingsRefreshedAt = .distantPast
        online = false; busy = false; error = ""; notice = ""; usageError = ""; composerDraft = ""
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
            c.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? previous?.displayName ?? "电脑 \(book.devices.count + 1)" : String(name.prefix(60))
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
            guard next.hostId == c.hostId, next.protocolVersion == HostAPI.protocolVersion else { throw APIError(message: "电脑身份或版本发生变化，请重新连接。", status: 409) }
            guard current(c, generation) else { return }
            snapshot = next; if !online { error = "" }; online = true
            if appSettings == nil || Date().timeIntervalSince(settingsRefreshedAt) > 10 {
                let settings: JSONValue = try await api.get("/app-settings")
                guard current(c, generation) else { return }; appSettings = settings; settingsRefreshedAt = Date()
            }
            if let id = selected {
                let cursor = page?.events.map(\.sequence).max()
                let path = "/sessions/\(id)" + (cursor.map { "?after=\($0)" } ?? "?tail=300")
                let detail: SessionPage = try await api.get(path)
                if selected == id && current(c, generation) {
                    page = SessionPage(session: detail.session, events: mergedEvents(page?.events ?? [], detail.events), olderCursor: cursor == nil ? detail.olderCursor : page?.olderCursor, commands: detail.commands ?? page?.commands)
                }
            }
            if let op = c.pending {
                let path: String? = op.path.hasSuffix("/send") || op.path.hasSuffix("/stop") ? "/commands/\(op.id)" : op.path.hasSuffix("/settings") || op.path.contains("/commands/") && op.method == "PATCH" ? op.path + "?requestId=\(op.id)" : nil
                if let path, let _: JSONValue = try? await api.get(path), current(c, generation), connection?.pending?.id == op.id { try clearPending(); notice = "已从电脑核对操作回执。" }
            }
        } catch is CancellationError { }
        catch {
            guard current(c, generation) else { return }; online = false; self.error = error.localizedDescription
            if (error as? APIError)?.status == 401 { snapshot = nil; page = nil; usage = nil }
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
    func select(_ id: String) async { if selected != id || page?.session.id != id { selected = id; page = nil; composerDraft = "" }; await refresh() }
    func openSearchHit(_ sessionID: String, eventID: String) async -> Bool {
        guard let c = connection else { return false }; let generation = epoch
        do {
            let id = eventID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? eventID
            let detail: SessionPage = try await HostAPI(connection: c).get("/sessions/\(sessionID)?event=\(id)")
            guard current(c, generation) else { return false }; selected = sessionID; page = detail; return true
        } catch { if current(c, generation) { self.error = error.localizedDescription }; return false }
    }
    func send(_ text: String, mode: String = "queue") async -> Bool {
        guard let id = selected, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.count <= 200000 else { return false }
        return await execute("/sessions/\(id)/send", values: ["text": .string(text), "mode": .string(mode)]) != nil
    }
    func stop() async { if let id = selected { _ = await execute("/sessions/\(id)/stop", values: ["pause": .bool(true)]) } }
    func answer(_ item: InboxItem, action: NativeAction) async {
        let id = item.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? item.id
        _ = await execute("/interactions/\(id)", values: ["answer": action.answer])
    }
    func execute(_ path: String, method: String = "POST", values: [String: JSONValue] = [:], refreshAfter: Bool = true) async -> JSONValue? {
        guard var c = connection, canWrite else { return nil }; let generation = epoch
        busy = true; defer { if current(c, generation) { busy = false } }
        let id = UUID().uuidString.lowercased(); var fields = values
        if path.hasSuffix("/send") || path.hasSuffix("/stop") || path.hasSuffix("/settings") || path.contains("/commands/") && method == "PATCH" { fields["requestId"] = .string(id) }
        let body = JSONValue.object(fields)
        c.pending = PendingOperation(id: id, path: path, body: body, method: method)
        do {
            var next = book; next.put(c); try commit(next)
            let result: JSONValue = try await HostAPI(connection: c).perform(path, method: method, body: method == "DELETE" ? nil : body)
            guard current(c, generation) else { return nil }
            try clearPending(); notice = "电脑已保存操作。"
            if path == "/app-settings" && method == "PATCH" { appSettings = result }
            if refreshAfter { await refresh() }; return result
        } catch {
            guard current(c, generation) else { return nil }
            if let failure = error as? APIError, (400..<500).contains(failure.status) { try? clearPending() }
            self.error = "\(error.localizedDescription)\n结果未知时请先核对，应用不会自动重发。"; return nil
        }
    }
    func clearPending() throws { guard var c = connection else { return }; c.pending = nil; var next = book; next.put(c); try commit(next) }
    func createSession(_ draft: SessionDraft) async -> Bool {
        let generation = epoch
        var effective = draft
        if snapshot?.harnesses?.first(where: { $0.id == draft.harnessId })?.modelSupport == "native-only" { effective.choice = "native" }
        guard let c = connection, let result = await execute("/sessions", values: effective.body.object, refreshAfter: false), current(c, generation) else { return false }
        let id = result["id"].string; guard !id.isEmpty else { return false }
        selected = id; page = nil; await refresh()
        if !draft.firstMessage.isEmpty {
            let sent = await send(draft.firstMessage, mode: "new")
            if !sent { composerDraft = draft.firstMessage }
        }
        return true
    }
    func createSession(title: String, projectId: String?) async -> Bool { var draft = SessionDraft(); draft.title = title; draft.projectId = projectId ?? ""; return await createSession(draft) }
    func updateSession(_ id: String, values: [String: JSONValue]) async -> Bool { await execute("/sessions/\(id)", method: "PATCH", values: values) != nil }
    func deleteSession(_ id: String) async {
        if await execute("/sessions/\(id)", method: "DELETE", refreshAfter: false) != nil { if selected == id { selected = nil; page = nil }; await refresh() }
    }
    func disconnect() { if let c = connection { removeDevice(c.hostId) } }
}
func mergedEvents(_ current: [RuntimeEvent], _ incoming: [RuntimeEvent]) -> [RuntimeEvent] {
    var events: [String: RuntimeEvent] = [:]; for event in current + incoming { events[event.id] = event }; return events.values.sorted { $0.sequence < $1.sequence }
}

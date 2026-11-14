package app.kooyu.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

data class WorkbenchState(
    val book: ConnectionBook = ConnectionBook(), val snapshot: JSONObject = JSONObject(), val appSettings: JSONObject? = null,
    val sessions: List<HostSession> = emptyList(), val projects: List<Pair<String, String>> = emptyList(),
    val workspaces: List<HostWorkspace> = emptyList(), val harnesses: List<HostHarness> = emptyList(),
    val bindings: List<JSONObject> = emptyList(), val inbox: List<InboxItem> = emptyList(),
    val transcript: Transcript = Transcript(emptyList(), false), val events: List<JSONObject> = emptyList(), val commands: List<JSONObject> = emptyList(),
    val selected: String? = null, val olderCursor: Int? = null, val loadingHistory: Boolean = false,
    val usage: UsageReport? = null, val usageLoading: Boolean = false, val usageError: String = "",
    val addingDevice: Boolean = false, val composerDraft: String = "", val online: Boolean = false,
    val busy: Boolean = false, val error: String = "", val notice: String = "",
) {
    val connection: Connection? get() = book.active
    val connections: List<Connection> get() = book.devices
    val older: Boolean get() = olderCursor != null
    val canWrite: Boolean get() = online && !busy && connection?.pending == null
}
class Workbench(app: Application) : AndroidViewModel(app) {
    private val vault = ConnectionVault(app)
    private val mutable = MutableStateFlow(WorkbenchState())
    val state = mutable.asStateFlow()
    private val refreshing = Mutex()
    private var epoch = 0
    private var settingsRefreshedAt = 0L
    init {
        try { mutable.update { it.copy(book = vault.load()) } }
        catch (_: Exception) { mutable.update { it.copy(error = "无法读取设备凭据，请重试或清除损坏的本机连接。") } }
    }
    private fun commit(book: ConnectionBook) { vault.save(book); mutable.update { it.copy(book = book) } }
    private fun current(c: Connection, generation: Int) = epoch == generation && mutable.value.connection?.token == c.token && mutable.value.connection?.hostId == c.hostId
    private fun reset(book: ConnectionBook) { epoch++; settingsRefreshedAt = 0L; mutable.value = WorkbenchState(book = book) }
    fun addDevice(show: Boolean) { if (!mutable.value.busy) mutable.update { it.copy(addingDevice = show, error = "") } }
    fun switchDevice(id: String) {
        if (mutable.value.busy || mutable.value.book.activeHostId == id) return
        runCatching { val next = mutable.value.book.select(id); commit(next); reset(next) }.onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法切换电脑。") } }
    }
    fun renameDevice(id: String, name: String) {
        if (mutable.value.busy || name.trim().isEmpty()) return
        runCatching { val c = mutable.value.connections.first { it.hostId == id }; commit(mutable.value.book.put(c.copy(name = name.trim().take(60)))) }
            .onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法保存设备名称。") } }
    }
    fun removeDevice(id: String) {
        if (mutable.value.busy) return
        runCatching { val active = mutable.value.book.activeHostId == id; val next = mutable.value.book.remove(id); commit(next); if (active) reset(next) }
            .onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法移除本机连接。") } }
    }
    fun clearDamagedConnections() {
        if (mutable.value.busy) return
        runCatching { vault.clear(); reset(ConnectionBook()) }.onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法清除凭据。") } }
    }
    suspend fun pair(address: String, code: String, name: String = "我的电脑") {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true) }
        try {
            val paired = HostAPI.pair(address, code)
            val old = mutable.value.connections.firstOrNull { it.hostId == paired.hostId }
            val c = paired.copy(name = name.trim().ifEmpty { old?.name ?: "电脑 " + (mutable.value.connections.size + 1) }.take(60), pending = old?.pending)
            val next = mutable.value.book.put(c, activate = true); commit(next); reset(next)
            mutable.update { it.copy(busy = true) }; refresh()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "配对失败，请重新生成二维码。") } }
        finally { mutable.update { it.copy(busy = false) } }
    }
    suspend fun refresh() {
        val c = mutable.value.connection ?: return
        val generation = epoch
        if (!refreshing.tryLock()) return
        try {
            val api = HostAPI(c)
            val snapshot = api.get("/native/snapshot")
            if (snapshot.optInt("protocolVersion") != HostAPI.PROTOCOL_VERSION || snapshot.optString("hostId") != c.hostId) throw HostError(409, "电脑身份或版本发生变化，请重新连接。")
            if (!current(c, generation)) return
            mutable.update { it.copy(snapshot = snapshot,
                sessions = snapshot.getJSONArray("sessions").objects().map(HostSession::parse),
                projects = snapshot.getJSONArray("projects").objects().map { p -> p.getString("id") to p.getString("name") },
                workspaces = snapshot.optJSONArray("workspaces")?.objects()?.map(HostWorkspace::parse) ?: emptyList(),
                harnesses = snapshot.optJSONArray("harnesses")?.objects()?.map(HostHarness::parse) ?: emptyList(),
                bindings = snapshot.optJSONArray("bindings")?.objects() ?: emptyList(),
                inbox = snapshot.getJSONArray("inbox").objects().filter { p -> !p.optBoolean("resolved") }.map(InboxItem::parse), online = true, error = if (it.online) it.error else "") }
            if (mutable.value.appSettings == null || System.nanoTime() - settingsRefreshedAt > 10_000_000_000L) {
                val settings = api.get("/app-settings")
                if (!current(c, generation)) return
                mutable.update { it.copy(appSettings = settings) }
                settingsRefreshedAt = System.nanoTime()
            }
            val selected = mutable.value.selected
            if (selected != null) {
                val last = mutable.value.events.maxOfOrNull { it.optInt("sequence") }
                val page = api.get("/sessions/" + selected + if (last == null) "?tail=300" else "?after=" + last)
                if (mutable.value.selected == selected && current(c, generation)) {
                    val events = mergeEvents(mutable.value.events, page.optJSONArray("events")?.objects() ?: emptyList())
                    mutable.update { it.copy(events = events, transcript = buildTranscript(events), commands = page.optJSONArray("commands")?.objects() ?: it.commands,
                        olderCursor = if (last == null) page.nullableNumber("olderCursor")?.toInt() else it.olderCursor) }
                }
            }
            c.pending?.let { op ->
                val path = op.getString("path")
                val receiptPath = when {
                    path.endsWith("/send") || path.endsWith("/stop") -> "/commands/" + op.getString("id")
                    path.endsWith("/settings") -> path + "?requestId=" + op.getString("id")
                    path.contains("/commands/") && op.optString("method") == "PATCH" -> path + "?requestId=" + op.getString("id")
                    else -> null
                }
                if (receiptPath != null) {
                    val receipt = try { api.get(receiptPath) } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                    if (receipt != null && current(c, generation) && mutable.value.connection?.pending?.optString("id") == op.getString("id")) {
                        clearPending(); mutable.update { it.copy(notice = "已从电脑核对操作回执。") }
                    }
                }
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) mutable.update {
                if (e is HostError && e.status == 401) WorkbenchState(book = it.book, error = "此电脑授权已失效，请重新扫码连接。")
                else it.copy(online = false, error = e.message ?: "连接中断，请检查电脑是否在线。")
            }
        } finally { refreshing.unlock() }
    }
    suspend fun refreshUsage() {
        val c = mutable.value.connection ?: return
        val generation = epoch
        if (mutable.value.usageLoading) return
        mutable.update { it.copy(usageLoading = true) }
        try { val value = UsageReport.parse(HostAPI(c).get("/usage")); if (current(c, generation)) mutable.update { it.copy(usage = value, usageError = "") } }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (current(c, generation)) mutable.update { it.copy(usageError = e.message ?: "无法读取用量。") } }
        finally { if (current(c, generation)) mutable.update { it.copy(usageLoading = false) } }
    }
    suspend fun loadOlder() {
        val c = mutable.value.connection ?: return
        val id = mutable.value.selected ?: return
        val before = mutable.value.olderCursor ?: return
        val generation = epoch
        if (mutable.value.loadingHistory) return
        mutable.update { it.copy(loadingHistory = true) }
        try {
            val value = HostAPI(c).get("/sessions/" + id + "?before=" + before)
            if (current(c, generation) && mutable.value.selected == id) {
                val events = mergeEvents(mutable.value.events, value.getJSONArray("events").objects())
                mutable.update { it.copy(events = events, transcript = buildTranscript(events), olderCursor = value.nullableNumber("olderCursor")?.toInt()) }
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (current(c, generation)) mutable.update { it.copy(error = e.message ?: "无法加载历史。") } }
        finally { if (current(c, generation)) mutable.update { it.copy(loadingHistory = false) } }
    }
    suspend fun read(path: String): JSONObject? {
        val c = mutable.value.connection ?: return null
        val generation = epoch
        return try { val value = HostAPI(c).get(path); if (current(c, generation)) value else null }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (current(c, generation)) mutable.update { it.copy(error = e.message ?: "读取失败，请重试。") }; null }
    }
    fun select(id: String?) { mutable.update { it.copy(selected = id, transcript = Transcript(emptyList(), false), events = emptyList(), commands = emptyList(), olderCursor = null, composerDraft = "") } }
    suspend fun openSearchHit(sessionId: String, eventId: String): Boolean {
        val c = mutable.value.connection ?: return false; val generation = epoch
        val page = read("/sessions/" + encoded(sessionId) + "?event=" + encoded(eventId)) ?: return false
        if (!current(c, generation)) return false
        val events = page.optJSONArray("events")?.objects() ?: emptyList()
        mutable.update { it.copy(selected = sessionId, events = events, transcript = buildTranscript(events), olderCursor = page.nullableNumber("olderCursor")?.toInt(), commands = page.optJSONArray("commands")?.objects() ?: emptyList()) }
        return true
    }
    fun suspended(token: String? = mutable.value.connection?.token) { if (mutable.value.connection?.token == token) mutable.update { it.copy(online = false) } }
    suspend fun send(text: String, mode: String = "queue"): Boolean {
        val id = mutable.value.selected ?: return false
        if (text.isBlank() || text.length > 200000) return false
        return execute("/sessions/" + id + "/send", body = JSONObject().put("text", text).put("mode", mode)) != null
    }
    suspend fun stop() { mutable.value.selected?.let { execute("/sessions/" + it + "/stop", body = JSONObject().put("pause", true)) } }
    suspend fun answer(item: InboxItem, action: NativeAction) { execute("/interactions/" + encoded(item.id), body = JSONObject().put("answer", action.answer)) }
    suspend fun execute(path: String, method: String = "POST", body: JSONObject? = JSONObject(), refreshAfter: Boolean = true): JSONObject? {
        val state = mutable.value
        val c = state.connection ?: return null
        val generation = epoch
        if (!state.canWrite) return null
        mutable.update { it.copy(busy = true, error = "") }
        val id = UUID.randomUUID().toString()
        if (path.endsWith("/send") || path.endsWith("/stop") || path.endsWith("/settings") || path.contains("/commands/") && method == "PATCH") body?.put("requestId", id)
        try {
            val pending = JSONObject().put("id", id).put("path", path).put("method", method).put("body", body)
            commit(mutable.value.book.put(c.copy(pending = pending)))
            val result = HostAPI(c).perform(path, method, if (method == "DELETE") null else body)
            if (!current(c, generation)) return null
            clearPending()
            if (path == "/app-settings" && method == "PATCH") mutable.update { it.copy(appSettings = result) }
            mutable.update { it.copy(notice = if (result.has("cancel")) "停止回执：" + result.optString("cancel") else "电脑已保存操作。") }
            if (refreshAfter) refresh()
            return result
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) {
                if (e is HostError && e.status in 400..499) runCatching { clearPending() }
                mutable.update { it.copy(error = (e.message ?: "连接中断") + "\n结果未知时请先核对，应用不会自动重发。") }
            }
            return null
        } finally { if (current(c, generation)) mutable.update { it.copy(busy = false) } }
    }
    fun clearPending() { val c = mutable.value.connection ?: return; commit(mutable.value.book.put(c.copy(pending = null))) }
    fun dismissNotice(value: String) { mutable.update { if (it.notice == value) it.copy(notice = "") else it } }
    fun dismissError() { mutable.update { it.copy(error = "") } }
    suspend fun create(draft: SessionDraft): Boolean {
        val c = mutable.value.connection ?: return false
        val effective = if (mutable.value.harnesses.firstOrNull { it.id == draft.harnessId }?.modelSupport == "native-only") draft.copy(choice = "native") else draft
        val result = execute("/sessions", body = effective.body(), refreshAfter = false) ?: return false
        if (mutable.value.connection?.token != c.token) return false
        select(result.getString("id")); refresh()
        if (draft.firstMessage.isNotBlank() && !send(draft.firstMessage, "new")) mutable.update { it.copy(composerDraft = draft.firstMessage) }
        return true
    }
    suspend fun create(title: String, projectId: String?) = create(SessionDraft(title = title, projectId = projectId))
    suspend fun updateSession(id: String, values: JSONObject) = execute("/sessions/" + id, "PATCH", values)
    suspend fun deleteSession(id: String): Boolean {
        if (execute("/sessions/" + id, "DELETE", null, refreshAfter = false) == null) return false
        if (mutable.value.selected == id) select(null)
        refresh(); return true
    }
    suspend fun saveBudget(projectId: String?, usd: Double): Boolean {
        if (projectId.isNullOrBlank() || !usd.isFinite() || usd <= 0) return false
        val body = JSONObject().put("usd", usd).put("projectId", projectId)
        if (execute("/budgets", body = body) == null) return false
        refreshUsage(); return true
    }
    fun disconnect() { mutable.value.connection?.let { removeDevice(it.hostId) } }
}
fun encoded(value: String): String = URLEncoder.encode(value, "UTF-8")
fun mergeEvents(current: List<JSONObject>, incoming: List<JSONObject>): List<JSONObject> = (current + incoming).associateBy { it.getString("id") }.values.sortedBy { it.optInt("sequence") }

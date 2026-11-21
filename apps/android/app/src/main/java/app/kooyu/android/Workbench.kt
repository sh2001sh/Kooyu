package app.kooyu.android

import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
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
    val conversation: JSONObject? = null,
    val selected: String? = null, val olderCursor: Int? = null, val loadingHistory: Boolean = false,
    val usage: UsageReport? = null, val usageLoading: Boolean = false, val usageError: String = "",
    val requestedCloudHost: String? = null, val addingDevice: Boolean = false, val composerDraft: String = "", val composerAttachments: List<ManagedAttachment> = emptyList(), val online: Boolean = false,
    val busy: Boolean = false, val error: String = "", val notice: String = "",
) {
    val connection: Connection? get() = book.active
    val connections: List<Connection> get() = book.devices
    val older: Boolean get() = olderCursor != null
    val canMail: Boolean get() = !online && !busy && connection?.mailboxSeed != null && connection?.pending == null
    val canWrite: Boolean get() = online && !busy && connection?.pending == null
}
class Workbench(app: Application) : AndroidViewModel(app) {
    val readingPositions = mutableMapOf<String, Pair<Int, Int>>()
    private val vault = ConnectionVault(app)
    private val mutable = MutableStateFlow(WorkbenchState())
    val state = mutable.asStateFlow()
    private val refreshing = Mutex()
    fun savedDraft(host: String?, session: String?): String = if (host == null || session == null) "" else runCatching { vault.draft(host, session) }.getOrElse { mutable.update { state -> state.copy(error = "无法恢复此对话的本机草稿。") }; "" }
    fun saveDraft(host: String?, session: String?, text: String) { if (host != null && session != null) runCatching { vault.saveDraft(host, session, text) }.onFailure { mutable.update { state -> state.copy(error = "无法保存此对话的本机草稿。") } } }
    private var epoch = 0
    private var settingsRefreshedAt = 0L
    private var settingsRefresh: Job? = null
    init {
        CloudDevice.vault = vault
        try { mutable.update { it.copy(book = vault.load()) } }
        catch (_: Exception) { mutable.update { it.copy(error = "无法读取设备凭据，请重试或清除损坏的本机连接。") } }
    }
    private fun commit(book: ConnectionBook) { vault.save(book); mutable.update { it.copy(book = book) } }
    private fun current(c: Connection, generation: Int) = epoch == generation && mutable.value.connection?.token == c.token && mutable.value.connection?.hostId == c.hostId
    private fun reset(book: ConnectionBook) { epoch++; settingsRefresh?.cancel(); settingsRefresh = null; settingsRefreshedAt = 0L; mutable.value = WorkbenchState(book = book) }
    private fun refreshSettings(c: Connection, generation: Int) {
        if (settingsRefresh?.isActive == true || (settingsRefreshedAt != 0L && System.nanoTime() - settingsRefreshedAt < 30_000_000_000L)) return
        settingsRefreshedAt = System.nanoTime()
        settingsRefresh = viewModelScope.launch {
            try {
                val settings = HostAPI(c).get("/app-settings")
                if (current(c, generation)) mutable.update { it.copy(appSettings = settings) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) {
                // Preferences are optional. Their timeout must not mark a healthy Host offline.
                // The authenticated snapshot remains the authority for connection/auth state.
            }
        }
    }
    fun addDevice(show: Boolean, requestedCloudHost: String? = null) { if (!mutable.value.busy) mutable.update { it.copy(addingDevice = show, requestedCloudHost = requestedCloudHost, error = "") } }
    fun switchDevice(id: String) {
        if (mutable.value.busy || mutable.value.book.activeHostId == id) return
        runCatching { val next = mutable.value.book.select(id); commit(next); reset(next) }.onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法切换设备。") } }
    }
    fun renameDevice(id: String, name: String) {
        if (mutable.value.busy || name.trim().isEmpty()) return
        runCatching { val c = mutable.value.connections.first { it.hostId == id }; commit(mutable.value.book.put(c.copy(name = name.trim().take(60)))) }
            .onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法保存设备名称。") } }
    }
    fun removeDevice(id: String) {
        if (mutable.value.busy) return
        val connection = mutable.value.connections.firstOrNull { it.hostId == id } ?: return
        mutable.update { it.copy(busy=true) }
        viewModelScope.launch {
            try {
                CloudDevice.logout(connection)
                BackgroundReminders.stopHost(getApplication(), connection, "连接已移除，后台提醒已停止。")
                val active=mutable.value.book.activeHostId==id
                val next=mutable.value.book.remove(id)
                commit(next)
                if(active)reset(next)
            } catch(e:Exception) {mutable.update {it.copy(error=e.message ?: "无法撤销设备。")}}
            finally {mutable.update {it.copy(busy=false)}}
        }
    }
    fun clearDamagedConnections() {
        if (mutable.value.busy) return
        BackgroundReminders.updateSet(getApplication(), "enabled") { emptySet() }
        runCatching { vault.clear(); reset(ConnectionBook()) }.onFailure { e -> mutable.update { it.copy(error = e.message ?: "无法清除凭据。") } }
    }
    suspend fun pair(address: String, code: String, name: String = "我的设备") {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true) }
        try {
            val paired = HostAPI.pair(address, code)
            val old = mutable.value.connections.firstOrNull { it.hostId == paired.hostId }
            val c = paired.copy(name = name.trim().ifEmpty { old?.name ?: "设备 " + (mutable.value.connections.size + 1) }.take(60), pending = old?.pending)
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
            if (snapshot.optInt("protocolVersion") != HostAPI.PROTOCOL_VERSION || snapshot.optString("hostId") != c.hostId) throw HostError(409, "设备身份或版本发生变化，请重新连接。")
            if (!current(c, generation)) return
            val reconnecting = !mutable.value.online && mutable.value.snapshot.has("hostId")
            mutable.update { it.copy(snapshot = snapshot,
                sessions = snapshot.getJSONArray("sessions").objects().map(HostSession::parse),
                projects = snapshot.getJSONArray("projects").objects().map { p -> p.getString("id") to p.getString("name") },
                workspaces = snapshot.optJSONArray("workspaces")?.objects()?.map(HostWorkspace::parse) ?: emptyList(),
                harnesses = snapshot.optJSONArray("harnesses")?.objects()?.map(HostHarness::parse) ?: emptyList(),
                bindings = snapshot.optJSONArray("bindings")?.objects() ?: emptyList(),
                inbox = snapshot.getJSONArray("inbox").objects().filter { p -> !p.optBoolean("resolved") && !p.optBoolean("read") }.map(InboxItem::parse), online = true, error = if (it.online) it.error else "") }
            if (reconnecting) mutable.update { it.copy(notice = "连接已恢复 · ${it.inbox.size} 项待处理，可在「待办」查看。") }
            refreshSettings(c, generation)
            val selected = mutable.value.selected
            if (selected != null) {
                val last = mutable.value.events.maxOfOrNull { it.optInt("sequence") }
                val page = api.get("/sessions/" + selected + if (last == null) "?tail=300" else "?after=" + last)
                if (mutable.value.selected == selected && current(c, generation)) {
                    val events = mergeEvents(mutable.value.events, page.optJSONArray("events")?.objects() ?: emptyList())
                    val conv = page.optJSONObject("session")?.optJSONObject("conversation")
                        ?: mutable.value.sessions.firstOrNull { it.id == selected }?.raw?.optJSONObject("conversation")
                        ?: mutable.value.conversation
                    mutable.update { it.copy(events = events, conversation = conv, transcript = buildTranscript(conversationEvents(events, conv)), commands = page.optJSONArray("commands")?.objects() ?: it.commands,
                        olderCursor = if (last == null) page.nullableNumber("olderCursor")?.toInt() else it.olderCursor) }
                }
            }
            c.pending?.let { op ->
                val path = op.getString("path")
                val receiptPath = when {
                    op.optBoolean("management") -> "/client/operations/" + op.getString("id")
                    path.endsWith("/send") || path.endsWith("/stop") -> "/commands/" + op.getString("id")
                    path.endsWith("/settings") -> path + "?requestId=" + op.getString("id")
                    path.contains("/commands/") && op.optString("method") == "PATCH" -> path + "?requestId=" + op.getString("id")
                    else -> null
                }
                if (receiptPath == null) {
                    // Operations without a Host receipt endpoint must not permanently write-lock the app.
                    if (current(c, generation) && mutable.value.connection?.pending?.optString("id") == op.getString("id")) {
                        clearPending()
                    }
                } else {
                    var notFound = false
                    val receipt = try { api.get(receiptPath) }
                    catch (e: CancellationException) { throw e }
                    catch (e: HostError) { if (e.status == 404) notFound = true; null }
                    catch (_: Exception) { null }
                    if (current(c, generation) && mutable.value.connection?.pending?.optString("id") == op.getString("id")) {
                        if (notFound) {
                            clearPending()
                        } else if (receipt != null && (!op.optBoolean("management") || receipt.optString("status") in listOf("confirmed", "failed", "unknown"))) {
                            clearPending()
                            val status = receipt.optString("status")
                            mutable.update {
                                it.copy(
                                    notice = if (status == "failed" || status == "unknown")
                                        receipt.optJSONObject("error")?.optString("message")?.ifBlank { "操作未完成，请核对后重试。" } ?: "操作未完成。"
                                    else "已从设备核对操作回执。"
                                )
                            }
                        }
                    }
                }
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) mutable.update {
                if (e is HostError && e.status == 401) WorkbenchState(book = it.book, error = "此设备授权已失效，请重新扫码连接。")
                else it.copy(online = false, error = e.message ?: "连接中断，请检查设备是否在线。")
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
                val conv = value.optJSONObject("session")?.optJSONObject("conversation") ?: mutable.value.conversation
                mutable.update { it.copy(events = events, conversation = conv, transcript = buildTranscript(conversationEvents(events, conv)), olderCursor = value.nullableNumber("olderCursor")?.toInt()) }
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
    suspend fun readArray(path: String): List<JSONObject> {
        val c = mutable.value.connection ?: return emptyList()
        val generation = epoch
        return try { val value = HostAPI(c).array(path); if (current(c, generation)) value else emptyList() }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (current(c, generation)) mutable.update { it.copy(error = e.message ?: "读取失败") }; emptyList() }
    }
    fun select(id: String?) { mutable.update { it.copy(selected = id, transcript = Transcript(emptyList(), false), events = emptyList(), commands = emptyList(), conversation = null, olderCursor = null, composerDraft = "", composerAttachments = emptyList()) } }
    suspend fun openSearchHit(sessionId: String, eventId: String): Boolean {
        val c = mutable.value.connection ?: return false; val generation = epoch
        val page = read("/sessions/" + encoded(sessionId) + "?event=" + encoded(eventId)) ?: return false
        if (!current(c, generation)) return false
        val events = page.optJSONArray("events")?.objects() ?: emptyList()
        val conv = page.optJSONObject("session")?.optJSONObject("conversation")
        mutable.update { it.copy(selected = sessionId, events = events, conversation = conv, transcript = buildTranscript(conversationEvents(events, conv)), olderCursor = page.nullableNumber("olderCursor")?.toInt(), commands = page.optJSONArray("commands")?.objects() ?: emptyList()) }
        return true
    }
    fun suspended(token: String? = mutable.value.connection?.token) { if (mutable.value.connection?.token == token) mutable.update { it.copy(online = false) } }
    suspend fun send(text: String, mode: String? = null, attachmentIds: List<String> = emptyList()): Boolean {
        val id = mutable.value.selected ?: return false
        if ((text.isBlank() && attachmentIds.isEmpty()) || text.length > 200000) return false
        if (mutable.value.canMail && attachmentIds.isEmpty()) {
            val c = mutable.value.connection ?: return false
            val generation = epoch
            mutable.update { it.copy(busy = true) }
            try {
                val host = HostAPI.origin(c.url).pathSegments.last { it.isNotEmpty() }
                val envelope = SecureTunnel.mail(c,host,id,text)
                val pending = JSONObject().put("id",envelope.getString("commandId")).put("path","/sessions/$id/send")
                commit(mutable.value.book.put(c.copy(pending=pending)))
                HostAPI(c).postMail(envelope)
                if (!current(c,generation)) return false
                clearPending()
                mutable.update { it.copy(composerDraft="",notice="已投递离线信箱，设备上线后接收。") }
                return true
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (current(c,generation)) {
                    if (e is HostError && e.status in 400..499) clearPending()
                    mutable.update { it.copy(error=e.message ?: "无法确认离线投递结果。") }
                }
                return false
            } finally { if (current(c,generation)) mutable.update { it.copy(busy=false) } }
        }
        val runState = mutable.value.sessions.firstOrNull { it.id == id }?.runState ?: "unknown"
        val sent = execute("/sessions/" + id + "/send", body = JSONObject().put("text", text).put("mode", mode ?: composerSendMode(runState)).put("attachmentIds", org.json.JSONArray(attachmentIds))) != null
        if (sent && mutable.value.selected == id) mutable.update { it.copy(composerDraft = "", composerAttachments = emptyList()) }
        return sent
    }
    suspend fun editMessage(row: TranscriptRow, text: String): Boolean {
        val owner = mutable.value.selected ?: return false
        val event = row.eventIds.firstOrNull() ?: return false
        val trimmed = text.trim()
        if (trimmed.isEmpty() || trimmed.length > 200000) return false
        val body = JSONObject().put("action", "edit").put("eventId", event).put("text", text)
        val result = execute("/sessions/$owner/message-branches", body = body, refreshAfter = false) ?: return false
        val conv = result.optJSONObject("conversation")
        if (mutable.value.selected == owner) {
            mutable.update { it.copy(conversation = conv, transcript = buildTranscript(conversationEvents(it.events, conv))) }
        }
        refresh()
        return true
    }
    suspend fun selectMessageBranch(branchId: String): Boolean {
        val owner = mutable.value.selected ?: return false
        val body = JSONObject().put("action", "select").put("branchId", branchId)
        val result = execute("/sessions/$owner/message-branches", body = body, refreshAfter = false) ?: return false
        val conv = result.optJSONObject("conversation")
        if (mutable.value.selected == owner) {
            mutable.update { it.copy(conversation = conv, transcript = buildTranscript(conversationEvents(it.events, conv))) }
        }
        refresh()
        return true
    }
    suspend fun branch(row: TranscriptRow, edit: Boolean): Boolean {
        val owner = mutable.value.selected ?: return false
        val event = row.eventIds.firstOrNull() ?: return false
        val result = execute("/sessions/$owner/branch", body = JSONObject().put("eventId", event).put("edit", edit), refreshAfter = false) ?: return false
        select(result.getString("id")); refresh()
        if (edit) mutable.update { it.copy(composerDraft = row.text) }
        return true
    }
    suspend fun cancelTurn() { mutable.value.selected?.let { execute("/sessions/$it/stop", body = JSONObject().put("pause", false)) } }
    suspend fun stop() { mutable.value.selected?.let { execute("/sessions/" + it + "/stop", body = JSONObject().put("pause", true)) } }
    suspend fun answer(item: InboxItem, action: NativeAction) { execute("/interactions/" + encoded(item.id), body = JSONObject().put("answer", action.answer)) }
    suspend fun markInboxRead(id: String): Boolean {
        val c = mutable.value.connection ?: return false
        val generation = epoch
        return try {
            HostAPI(c).post("/inbox/" + encoded(id) + "/read", JSONObject())
            if (current(c, generation)) {
                mutable.update { it.copy(inbox = it.inbox.filterNot { item -> item.id == id }, notice = "已标为已读。") }
                refresh()
            }
            true
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) mutable.update { it.copy(error = e.message ?: "标记已读失败，请重试。") }
            false
        }
    }
    suspend fun markAllInboxRead(): Boolean {
        val c = mutable.value.connection ?: return false
        val generation = epoch
        return try {
            HostAPI(c).post("/inbox/read-all", JSONObject())
            if (current(c, generation)) {
                mutable.update { it.copy(inbox = it.inbox.filter { item -> item.type == "interaction" && item.actions.isNotEmpty() }, notice = "已全部标为已读。") }
                refresh()
            }
            true
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) mutable.update { it.copy(error = e.message ?: "全部已读失败，请重试。") }
            false
        }
    }
    suspend fun deleteInboxItem(id: String): Boolean {
        val c = mutable.value.connection ?: return false
        val generation = epoch
        return try {
            HostAPI(c).perform("/inbox/" + encoded(id), "DELETE", null)
            if (current(c, generation)) {
                mutable.update { it.copy(inbox = it.inbox.filterNot { item -> item.id == id }, notice = "已删除消息。") }
                refresh()
            }
            true
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) mutable.update { it.copy(error = e.message ?: "删除消息失败，请重试。") }
            false
        }
    }
    suspend fun execute(path: String, method: String = "POST", body: JSONObject? = JSONObject(), refreshAfter: Boolean = true): JSONObject? {
        val state = mutable.value
        val c = state.connection ?: return null
        val generation = epoch
        if (!state.canWrite) return null
        mutable.update { it.copy(busy = true, error = "") }
        val id = UUID.randomUUID().toString()
        val management = path.startsWith("/automations") && path != "/automations/preview" || path.startsWith("/memory") || Regex("/goals/[^/]+/review").matches(path)
        val hasReceipt = management || path.endsWith("/send") || path.endsWith("/stop") || path.endsWith("/settings") || (path.contains("/commands/") && method == "PATCH")
        if (path.endsWith("/send") || path.endsWith("/stop") || path.endsWith("/settings") || path.endsWith("/branch") || path.endsWith("/message-branches") || path.startsWith("/interactions/") || (path.contains("/commands/") && method == "PATCH") || path == "/providers" || path == "/provider-models" || path == "/harness-bindings" || path == "/harness-provider-bindings") {
            if (body != null && !body.has("requestId")) body.put("requestId", id)
        }
        try {
            if (hasReceipt) {
                val pending = JSONObject().put("id", id).put("path", path).put("method", method).put("body", body).put("management", management)
                commit(mutable.value.book.put(c.copy(pending = pending)))
            }
            var result = if (management) HostAPI(c).post("/client/operations", JSONObject().put("requestId", id).put("path", "/api$path").put("method", method).put("body", body ?: JSONObject()))
                else HostAPI(c).perform(path, method, if (method == "DELETE") null else body)
            if (!current(c, generation)) return null
            if (management) {
                val status = result.optString("status")
                if (status != "confirmed") {
                    if (status == "failed" || status == "unknown") clearPending()
                    mutable.update { it.copy(error = result.optJSONObject("error")?.optString("message") ?: "操作未完成，请核对后重试。") }
                    return null
                }
                result = result.optJSONObject("result") ?: JSONObject()
            }
            if (hasReceipt) clearPending()
            if (path == "/app-settings" && method == "PATCH") mutable.update { it.copy(appSettings = result) }
            mutable.update { it.copy(notice = if (result.has("cancel")) "停止回执：" + result.optString("cancel") else "设备已保存操作。") }
            if (refreshAfter) refresh()
            return result
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current(c, generation)) {
                if (!hasReceipt || (e is HostError && e.status in 400..499)) runCatching { clearPending() }
                val suffix = if (hasReceipt && !(e is HostError && e.status in 400..499)) "\n结果未知时请先核对，应用不会自动重发。" else ""
                mutable.update { it.copy(error = (e.message ?: "连接中断") + suffix) }
            }
            return null
        } finally { if (current(c, generation)) mutable.update { it.copy(busy = false) } }
    }
    fun clearPending() { val c = mutable.value.connection ?: return; commit(mutable.value.book.put(c.copy(pending = null))) }
    fun dismissNotice(value: String) { mutable.update { if (it.notice == value) it.copy(notice = "") else it } }
    fun dismissError() { mutable.update { it.copy(error = "") } }
    suspend fun create(draft: SessionDraft, attachments: List<ManagedAttachment> = emptyList()): Boolean {
        val c = mutable.value.connection ?: return false
        var effective = if (mutable.value.harnesses.firstOrNull { it.id == draft.harnessId }?.modelSupport == "native-only") draft.copy(choice = "native") else draft
        if (draft.customPath.isNotBlank()) {
            val workspace = execute("/workspaces", body = JSONObject().put("projectId", draft.projectId ?: JSONObject.NULL).put("rootPath", draft.customPath.trim())) ?: return false
            if (mutable.value.connection?.token != c.token) return false
            effective = effective.copy(workspaceId = workspace.getString("id"))
        }
        val result = execute("/sessions", body = effective.body(), refreshAfter = false) ?: return false
        if (mutable.value.connection?.token != c.token) return false
        select(result.getString("id")); refresh()
        if ((draft.firstMessage.isNotBlank() || attachments.isNotEmpty()) && !send(draft.firstMessage, "new", attachments.map { it.id }))
            mutable.update { it.copy(composerDraft = draft.firstMessage, composerAttachments = attachments) }
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
    suspend fun openNotification(target: NotificationTarget): Int? {
        if (mutable.value.busy) return null
        val c = mutable.value.connections.firstOrNull { it.hostId == target.hostId } ?: run {
            mutable.update { it.copy(error = "此通知的设备未保存，请重新配对。") }; return null
        }
        val generation = epoch
        try {
            val api = HostAPI(c)
            val item = api.get(target.path)
            val snapshot = api.get("/native/snapshot")
            if (mutable.value.busy || epoch != generation || mutable.value.connections.none { it.hostId == c.hostId && it.deviceId == c.deviceId && it.token == c.token } || snapshot.optString("hostId") != c.hostId || snapshot.optInt("protocolVersion") != HostAPI.PROTOCOL_VERSION || item.optString("id") != target.notificationId || item.optJSONObject("link")?.optString("hostId") != c.hostId) return null
            switchDevice(c.hostId)
            if (mutable.value.connection?.token != c.token) return null
            val sessionId = item.nullableString("sessionId")?.takeIf { id -> snapshot.getJSONArray("sessions").objects().any { it.optString("id") == id } }
            select(sessionId); refresh()
            if (mutable.value.connection?.token != c.token || mutable.value.connection?.hostId != c.hostId) return null
            viewModelScope.launch {
                try { api.post(target.path + "/read", JSONObject()) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { /* Navigation succeeds even if the idempotent read receipt is offline. */ }
            }
            return if (sessionId == null) 4 else 0
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { if (epoch == generation) mutable.update { it.copy(error = "无法打开通知，请检查设备连接或事项是否已过期。") }; return null }
    }
    fun disconnect() { mutable.value.connection?.let { removeDevice(it.hostId) } }
}
fun encoded(value: String): String = URLEncoder.encode(value, "UTF-8")
fun mergeEvents(current: List<JSONObject>, incoming: List<JSONObject>): List<JSONObject> = (current + incoming).associateBy { it.getString("id") }.values.sortedBy { it.optInt("sequence") }

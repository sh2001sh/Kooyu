package app.kooyu.android

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
fun JSONObject.nullableNumber(key: String): Double? = if (isNull(key)) null else (opt(key) as? Number)?.toDouble()

/** One encrypted document, including independent uncertain operations for every computer. */
data class ConnectionBook(val devices: List<Connection> = emptyList(), val activeHostId: String? = null) {
    val active: Connection? get() = devices.firstOrNull { it.hostId == activeHostId }
    fun select(id: String) = copy(activeHostId = devices.first { it.hostId == id }.hostId)
    fun put(connection: Connection, activate: Boolean = false): ConnectionBook = copy(
        devices = if (devices.any { it.hostId == connection.hostId }) devices.map { if (it.hostId == connection.hostId) connection else it } else devices + connection,
        activeHostId = if (activate || activeHostId == null) connection.hostId else activeHostId)
    fun remove(id: String): ConnectionBook {
        val remaining = devices.filterNot { it.hostId == id }
        return ConnectionBook(remaining, if (activeHostId == id) remaining.firstOrNull()?.hostId else activeHostId)
    }
    fun json() = JSONObject().put("version", 2).put("devices", JSONArray(devices.map { it.json() })).put("activeHostId", activeHostId)
    companion object {
        fun parse(value: JSONObject): ConnectionBook {
            if (value.has("url")) { val legacy = Connection.parse(value); return ConnectionBook(listOf(legacy), legacy.hostId) }
            val devices = value.optJSONArray("devices")?.objects()?.map(Connection::parse)?.distinctBy { it.hostId } ?: emptyList()
            val active = value.nullableString("activeHostId")?.takeIf { id -> devices.any { it.hostId == id } } ?: devices.firstOrNull()?.hostId
            return ConnectionBook(devices, active)
        }
    }
}

data class HostWorkspace(val id: String, val projectId: String?, val path: String) {
    companion object { fun parse(o: JSONObject) = HostWorkspace(o.getString("id"), o.nullableString("projectId"), o.getString("rootPath")) }
}
data class HostHarness(val id: String, val name: String, val modelSupport: String, val raw: JSONObject) {
    companion object { fun parse(o: JSONObject) = HostHarness(o.getString("id"), o.optString("name", o.getString("id")), o.optString("modelSupport", "native-only"), o) }
}
data class UsageRecord(val id: String, val sessionId: String, val projectId: String?, val source: String,
    val scope: String, val input: Double?, val output: Double?, val cacheRead: Double?, val cacheWrite: Double?,
    val costUsd: Double?, val costKind: String, val model: String?, val createdAt: String, val bindingId: String? = null) {
    val tokens get() = listOfNotNull(input, output, cacheRead, cacheWrite).sum()
    companion object { fun parse(o: JSONObject) = UsageRecord(o.getString("id"), o.getString("sessionId"), o.nullableString("projectId"),
        o.optString("source"), o.optString("scope"), o.nullableNumber("input"), o.nullableNumber("output"), o.nullableNumber("cacheRead"),
        o.nullableNumber("cacheWrite"), o.nullableNumber("costUsd"), o.optString("costKind", "unknown"), o.nullableString("model"), o.optString("createdAt"), o.nullableString("bindingId")) }
}
data class UsageReport(val records: List<UsageRecord>, val budgets: List<JSONObject>) {
    companion object { fun parse(o: JSONObject) = UsageReport(o.getJSONArray("records").objects().map(UsageRecord::parse), o.optJSONArray("budgets")?.objects() ?: emptyList()) }
}
data class UsageFilter(val days: Int? = 14, val projectId: String? = null, val source: String? = null, val sessionId: String? = null, val scope: String = "all")
fun usageDayKey(value: String, zone: ZoneId = ZoneId.systemDefault()): String? = runCatching { Instant.parse(value).atZone(zone).toLocalDate().toString() }.getOrNull()
/** Match desktop: discard cumulative session snapshots when turn records exist, BEFORE date filtering. */
fun filterUsage(records: List<UsageRecord>, filter: UsageFilter, today: LocalDate = LocalDate.now()): List<UsageRecord> {
    val turnSessions = records.filter { it.scope == "turn" }.map { it.sessionId }.toSet()
    val cutoff = filter.days?.let { today.minusDays((it - 1).toLong()).atStartOfDay(ZoneId.systemDefault()).toInstant() }
    return records.filter { r ->
        (filter.projectId == null || r.projectId == filter.projectId) && (filter.source == null || r.source == filter.source) &&
        (filter.sessionId == null || r.sessionId == filter.sessionId) && (filter.scope == "all" || r.scope == filter.scope) &&
        !(filter.scope == "all" && r.scope == "session" && r.sessionId in turnSessions) &&
        (cutoff == null || runCatching { !Instant.parse(r.createdAt).isBefore(cutoff) }.getOrDefault(true))
    }
}

data class SessionDraft(val title: String = "", val harnessId: String = "kodo", val kind: String = "supervisor",
    val projectId: String? = null, val workspaceId: String? = null, val choice: String = "inherit", val model: String = "",
    val reasoning: String = "", val permission: String = "", val firstMessage: String = "") {
    fun body(): JSONObject {
        val body = JSONObject().put("title", title.trim().ifEmpty { firstMessage.lineSequence().firstOrNull()?.take(48)?.ifBlank { null } ?: "新对话" })
            .put("harnessId", harnessId).put("kind", if (harnessId == "kodo") kind else "direct")
            .put("projectId", projectId ?: JSONObject.NULL).put("workspaceId", workspaceId ?: JSONObject.NULL)
        when {
            choice == "native" -> body.put("bindingId", JSONObject.NULL).put("model", JSONObject.NULL)
            choice.startsWith("binding:") -> body.put("bindingId", choice.removePrefix("binding:")).put("model", model.trim().ifEmpty { null } ?: JSONObject.NULL)
            choice == "model" && model.isNotBlank() -> body.put("bindingId", JSONObject.NULL).put("model", model.trim())
        }
        if (reasoning.isNotBlank()) body.put("reasoning", reasoning)
        if (permission.isNotBlank()) body.put("permissionMode", permission)
        return body
    }
    fun validation(harness: HostHarness?, workspaces: List<HostWorkspace>, hasInheritedBinding: Boolean): String? = when {
        harness == null -> "请选择可用引擎。"
        firstMessage.length > 200000 -> "首条消息不能超过 200,000 字符。"
        title.trim().length > 200 -> "标题不能超过 200 字符。"
        workspaceId != null && workspaces.none { it.id == workspaceId && (projectId == null || it.projectId == projectId) } -> "请选择当前项目的工作位置。"
        (harnessId !in listOf("kodo", "pi") || projectId != null) && workspaceId == null -> "此对话需要选择工作位置。"
        harness.modelSupport == "binding-required" && (choice == "native" || choice == "model" || (choice == "inherit" && !hasInheritedBinding)) -> "此引擎需要选择可用的模型绑定。"
        choice == "model" && model.isBlank() -> "请选择或输入模型。"
        else -> null
    }
}

fun modelOptionId(harnessId: String, model: JSONObject): String {
    val provider = model.nullableString("provider")
    return if (harnessId in listOf("kodo", "pi", "opencode", "zcode") && provider != null && !provider.startsWith("kodo-")) provider + "/" + model.getString("id") else model.getString("id")
}

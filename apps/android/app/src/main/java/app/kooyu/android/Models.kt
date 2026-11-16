package app.kooyu.android

import org.json.JSONArray
import org.json.JSONObject

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
data class HostSession(val id: String, val title: String, val harnessId: String, val runState: String, val archived: Boolean,
    val projectId: String? = null, val workspaceId: String? = null, val pinned: Boolean = false, val model: String? = null,
    val raw: JSONObject = JSONObject()) {
    val phase: String get() = raw.optString("phase", "native")
    val connectionState: String get() = raw.optString("connectionState", "connected")
    val kind: String get() = raw.optString("kind", "chat")

    val stateLabel: String get() {
        if (runState == "waiting-input") return "等待输入"
        if (kind == "supervisor") return if (projectId == null) "全局主对话" else "项目主对话"
        if (phase == "draft") return "尚未启动"
        if (connectionState == "offline") return "原生未连接"
        if (connectionState == "reconnecting") return "原生重连中"
        return when (runState) {
            "running" -> "正在运行"
            "idle" -> "空闲"
            "waiting-input" -> "等待输入"
            else -> "待核对"
        }
    }
    companion object { fun parse(o: JSONObject) = HostSession(o.getString("id"), o.getString("title"), o.getString("harnessId"), o.getString("runState"), o.optBoolean("archived"), o.nullableString("projectId"), o.nullableString("workspaceId"), o.optBoolean("pinned"), o.nullableString("model"), o) }
}
data class NativeAction(val label: String, val answer: JSONObject, val destructive: Boolean)
data class InboxItem(val id: String, val sessionId: String, val type: String, val payload: JSONObject, val actions: List<NativeAction>) {
    companion object {
        fun parse(o: JSONObject) = InboxItem(o.getString("id"), o.getString("sessionId"), o.getString("type"), o.optJSONObject("payload") ?: JSONObject(),
            o.optJSONArray("actions")?.objects()?.map { NativeAction(it.getString("label"), it.getJSONObject("answer"), it.optBoolean("destructive")) } ?: emptyList())
    }
}
fun messageText(value: Any?): String {
    if (value is String) return value
    if (value !is JSONObject) return ""
    if (value.opt("text") is String) return value.getString("text")
    if (value.opt("content") is String) return value.getString("content")
    value.optJSONArray("content")?.let { return it.objects().filter { p -> p.optString("type") in listOf("text", "output_text") }.joinToString("\n") { p -> p.optString("text") } }
    return if (value.has("message")) messageText(value.opt("message")) else ""
}
data class Connection(val url: String, val hostId: String, val deviceId: String, val token: String, val expiresAt: String, val pending: JSONObject? = null, val name: String = "我的设备") {
    fun json(): JSONObject = JSONObject().put("url", url).put("hostId", hostId).put("deviceId", deviceId).put("token", token).put("expiresAt", expiresAt).put("pending", pending).put("name", name)
    companion object { fun parse(o: JSONObject) = Connection(o.getString("url"), o.getString("hostId"), o.getString("deviceId"), o.getString("token"), o.getString("expiresAt"), o.optJSONObject("pending"), o.optString("name", "我的设备").ifBlank { "我的设备" }.let { if (it == "我的电脑") "我的设备" else if (Regex("^电脑\\s*\\d+$").matches(it)) "设备" + it.removePrefix("电脑") else it }) }
}

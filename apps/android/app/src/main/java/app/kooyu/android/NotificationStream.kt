package app.kooyu.android

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Identifiers only. A tap always resolves the current fact from a saved, authenticated Host. */
data class NotificationTarget(val hostId: String, val notificationId: String) {
    val path: String get() = "/notifications/" + URLEncoder.encode(notificationId, "UTF-8").replace("+", "%20")
    companion object {
        fun parse(hostId: String?, notificationId: String?): NotificationTarget? {
            if (hostId == null || notificationId == null || notificationId.isEmpty() || notificationId in listOf(".", "..") || notificationId.toByteArray(Charsets.UTF_8).size > 1000 || notificationId.any { it.isISOControl() }) return null
            if (runCatching { UUID.fromString(hostId).toString().equals(hostId, ignoreCase = true) }.getOrDefault(false).not()) return null
            return NotificationTarget(hostId, notificationId)
        }
    }
}

internal data class NotificationFrame(val event: String, val data: String)

/** No unbounded readLine/data concatenation, including comments and unknown SSE fields. */
internal class NotificationFrameParser {
    private var event = "message"
    private val data = StringBuilder()
    private var bytes = 0
    fun line(line: String): NotificationFrame? {
        bytes += line.toByteArray(Charsets.UTF_8).size + 1
        require(bytes <= 65536) { "通知事件超过限制。" }
        if (line.isEmpty()) {
            val frame = if (data.isEmpty()) null else NotificationFrame(event, data.toString().removeSuffix("\n"))
            event = "message"; data.clear(); bytes = 0
            return frame
        }
        if (line.startsWith(":")) return null
        val name = line.substringBefore(':')
        val value = line.substringAfter(':', "").removePrefix(" ")
        when (name) { "event" -> event = value; "data" -> data.append(value).append('\n') }
        return null
    }
}

internal fun notificationCursor(frame: NotificationFrame, hostId: String): Long? {
    val value = JSONObject(frame.data)
    fun sequence(key: String, minimum: Long): Long? {
        val raw = (value.opt(key) as? Number)?.toDouble() ?: return null
        return raw.toLong().takeIf { raw.isFinite() && raw == it.toDouble() && it in minimum..9007199254740991L }
    }
    if (frame.event == "reset") return sequence("cursor", 0)
    if (frame.event != "notification" || value.optJSONObject("link")?.optString("hostId") != hostId || NotificationTarget.parse(hostId, value.optString("id")) == null) return null
    return sequence("sequence", 1)
}

/** Uses platform TLS validation, keeps Relay prefixes and never follows a redirect. */
internal class NotificationStream(private val client: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .connectTimeout(10, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS).callTimeout(0, TimeUnit.SECONDS).build()) {
    fun events(connection: Connection, after: Long?): Flow<NotificationFrame> = callbackFlow {
        val path = "/notifications/events" + (after?.let { "?after=$it" } ?: "")
        val request = Request.Builder().url(HostAPI.apiUrl(HostAPI.origin(connection.url), path))
            .header("Authorization", "Bearer " + connection.token)
            .header("X-Kooyu-Protocol", HostAPI.PROTOCOL_VERSION.toString())
            .header("Accept", "text/event-stream").build()
        val call = client.newCall(request)
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { close(HostError(0, "后台连接中断，正在等待重连。")) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        if (!response.isSuccessful) throw HostError(response.code, "后台连接未获 Host 确认。")
                        if (response.header("Content-Type")?.substringBefore(';')?.trim() != "text/event-stream") throw HostError(0, "Host 不支持通知流。")
                        val source = response.body?.source() ?: throw IOException("empty stream")
                        val parser = NotificationFrameParser()
                        while (!source.exhausted()) {
                            val frame = parser.line(source.readUtf8LineStrict(65536)) ?: continue
                            if (frame.event == "auth-expired") throw HostError(401, "设备已撤销或过期。")
                            if (!trySend(frame).isSuccess) throw IOException("notification stream consumer unavailable")
                        }
                        close(HostError(0, "后台连接中断，正在等待重连。"))
                    } catch (e: Exception) { close(if (e is HostError) e else HostError(0, "后台连接中断，正在等待重连。")) }
                }
            }
        })
        awaitClose { call.cancel() }
    }
}

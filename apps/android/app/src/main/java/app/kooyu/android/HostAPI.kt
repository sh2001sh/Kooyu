package app.kooyu.android

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class HostError(val status: Int, message: String) : IOException(message)
internal fun responseObject(text: String, allowNull: Boolean = false): JSONObject {
    if (allowNull && text.trim() == "null") return JSONObject()
    return try { JSONObject(text) }
    catch (_: Exception) {
        throw HostError(0, "电脑返回的内容格式无效，请检查连接；已提交的操作请先核对结果。")
    }
}
class HostAPI(private val connection: Connection) {
    suspend fun get(path: String) = request(apiUrl(origin(connection.url), path), connection.token)
    suspend fun post(path: String, body: JSONObject) = request(apiUrl(origin(connection.url), path), connection.token, body)
    suspend fun perform(path: String, method: String, body: JSONObject? = null) = request(apiUrl(origin(connection.url), path), connection.token, body, method)
    companion object {
        const val PROTOCOL_VERSION = 2
        private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .connectTimeout(10, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS).build()
        fun origin(text: String): HttpUrl {
            val url = text.trim().toHttpUrlOrNull()
            require(url != null && url.isHttps && url.username.isEmpty() && url.password.isEmpty() && (url.encodedPath == "/" || Regex("/h/[a-f0-9]{64}/?").matches(url.encodedPath)) && url.query == null && url.fragment == null) {
                "请输入桌面显示的 HTTPS 连接地址（保留 /h/ 后的设备路径）。"
            }
            return url
        }
        suspend fun pair(address: String, code: String): Connection {
            val url = origin(address)
            val health = request(apiUrl(url, "/health"))
            if (health.optInt("protocolVersion") != PROTOCOL_VERSION) throw HostError(409, "Host 版本不兼容，请升级桌面 Host。")
            val value = request(apiUrl(url, "/pair/native"), body = JSONObject().put("code", code.trim()).put("name", "Kooyu Android"))
            if (value.optInt("protocolVersion") != PROTOCOL_VERSION || value.getString("hostId") != health.getString("hostId")) throw HostError(409, "Host 身份或版本变化，请重新配对。")
            val device = value.getJSONObject("device")
            return Connection(url.toString().trimEnd('/'), value.getString("hostId"), device.getString("id"), value.getString("token"), device.getString("expiresAt"))
        }
        fun apiUrl(base: HttpUrl, path: String): HttpUrl {
            val prefix = base.encodedPath.trimEnd('/') + "/api"
            val url = base.resolve(prefix + path)
            require(path.startsWith("/") && url != null && url.host == base.host && url.port == base.port && url.scheme == base.scheme && url.encodedPath.startsWith(prefix + "/") && url.fragment == null) { "连接地址无效。" }
            return url
        }
        private suspend fun request(url: HttpUrl, token: String? = null, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject = suspendCancellableCoroutine { continuation ->
            val builder = Request.Builder().url(url).header("Accept", "application/json").header("X-Kooyu-Protocol", PROTOCOL_VERSION.toString())
            if (token != null) builder.header("Authorization", "Bearer $token")
            builder.method(method, body?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType()))
            val call = client.newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(HostError(0, "无法连接此电脑，请检查电脑是否在线以及网络是否可用。")) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            val text = it.body?.string() ?: ""
                            val value = if (it.isSuccessful) responseObject(text, method == "GET") else runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                            if (!it.isSuccessful) throw HostError(it.code, (value.optJSONObject("error")?.optString("message")?.ifEmpty { null } ?: "Host 请求失败（${it.code}），请检查连接。").replace(Regex("https?://[^\\s]+"), "[连接信息已隐藏]"))
                            continuation.resume(value)
                        } catch (e: Exception) { continuation.resumeWithException(e) }
                    }
                }
            })
        }
    }
}

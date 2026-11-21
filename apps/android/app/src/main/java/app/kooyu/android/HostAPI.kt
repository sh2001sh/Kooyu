package app.kooyu.android

import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

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
import org.json.JSONArray
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class HostError(val status: Int, message: String) : IOException(message)
internal fun responseObject(text: String, allowNull: Boolean = false): JSONObject {
    if (allowNull && text.trim() == "null") return JSONObject()
    return try { JSONObject(text) }
    catch (_: Exception) {
        throw HostError(0, "设备返回的内容格式无效，请检查连接；已提交的操作请先核对结果。")
    }
}
class HostAPI(private val connection: Connection) {
    init {
        requireAccountPairing(origin(connection.url), connection.cloud != null)
        CloudDevice.restore(connection)
    }
    suspend fun file(id: String): ByteArray = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(Request.Builder().tag(TunnelKey::class.java,connection.tunnelKey?.let(::TunnelKey)).url(apiUrl(origin(connection.url), "/files/${encoded(id)}/content"))
            .header("Authorization", "Bearer ${connection.token}").header("X-Kooyu-Protocol", PROTOCOL_VERSION.toString()).build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(HostError(0, "无法读取文件，请检查设备连接。")) }
            override fun onResponse(call: Call, response: Response) { response.use {
                try {
                    if (!it.isSuccessful) throw HostError(it.code, "文件不可用，请刷新成果列表。")
                    val source = it.body?.source() ?: throw IOException("文件内容为空。")
                    if (source.request(32L * 1024 * 1024 + 1)) throw IOException("手机单个文件最多读取 32 MiB。")
                    continuation.resume(source.readByteArray())
                } catch (e: Exception) { if (!continuation.isCancelled) continuation.resumeWithException(e) }
            } }
        })
    }
    suspend fun get(path: String) = request(apiUrl(origin(connection.url), path), connection.token, tunnelKey=connection.tunnelKey)
    suspend fun array(path: String): List<JSONObject> = request(apiUrl(origin(connection.url), path), connection.token, array = true,tunnelKey=connection.tunnelKey).getJSONArray("items").objects()
    suspend fun post(path: String, body: JSONObject) = request(apiUrl(origin(connection.url), path), connection.token, body, tunnelKey=connection.tunnelKey)
    suspend fun perform(path: String, method: String, body: JSONObject? = null) = request(apiUrl(origin(connection.url), path), connection.token, body, method, tunnelKey=connection.tunnelKey)
    suspend fun postMail(envelope: JSONObject) {
        val base = origin(connection.url)
        val fingerprint = base.pathSegments.last { it.isNotEmpty() }
        request(base.newBuilder().encodedPath("/v2/mailbox/"+fingerprint).build(), body=envelope)
    }
    suspend fun upload(name: String, mediaType: String, bytes: ByteArray, sessionId: String?): JSONObject {
        require(bytes.size <= 32 * 1024 * 1024) { "单个附件最多 32 MiB。" }
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val upload = post("/files/uploads", JSONObject().put("requestId", java.util.UUID.randomUUID().toString())
            .put("displayName", name).put("mediaType", mediaType).put("size", bytes.size).put("sha256", digest).put("sessionId", sessionId ?: JSONObject.NULL))
        var offset = upload.getInt("received")
        while (offset < bytes.size) {
            val end = minOf(offset + 512 * 1024, bytes.size)
            val next = request(apiUrl(origin(connection.url), "/files/uploads/${upload.getString("id")}/chunks?offset=$offset"),
                connection.token, method = "PUT", binary = bytes.copyOfRange(offset, end), tunnelKey=connection.tunnelKey).getInt("received")
            require(next == end) { "附件上传进度无效，请重新添加。" }
            offset = next
        }
        return post("/files/uploads/${upload.getString("id")}/complete", JSONObject())
    }
    companion object {
        const val PROTOCOL_VERSION = 2
        private val client = OkHttpClient.Builder().addInterceptor(SecureTunnel).addInterceptor(CloudDevice).followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .connectTimeout(10, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS).build()
        // GETs may safely recover a stale pooled socket or try another resolved IP.
        // Mutations retain their no-replay policy; both clients share the connection pool.
        private val readClient = client.newBuilder().retryOnConnectionFailure(true).build()
        internal fun clientFor(method: String): OkHttpClient = if (method == "GET") readClient else client
        internal fun requireAccountPairing(base: HttpUrl, paired: Boolean, relay: String = BuildConfig.RELAY_ORIGIN) {
            if (paired || relay.isEmpty()) return
            val origin = base.newBuilder().encodedPath("/").query(null).build().toString().trimEnd('/')
            if (origin == relay) throw HostError(401, "请在已登录 Kooyu 的电脑上生成新二维码，重新授权这台手机。")
        }
        fun origin(text: String): HttpUrl {
            val url = text.trim().toHttpUrlOrNull()
            require(url != null && url.isHttps && url.username.isEmpty() && url.password.isEmpty() && (url.encodedPath == "/" || Regex("/h/[a-f0-9]{64}/?").matches(url.encodedPath)) && url.query == null && url.fragment == null) {
                "请输入桌面显示的 HTTPS 连接地址（保留 /h/ 后的设备路径）。"
            }
            return url
        }
        suspend fun pair(address: String, code: String): Connection {
            val url = origin(address)
            val params=code.substringAfter("&","").split("&").filter { it.contains("=") }.associate { it.substringBefore("=") to it.substringAfter("=") }
            requireAccountPairing(url, params.isNotEmpty())
            val account=if(params.isNotEmpty())CloudDevice.start(url,params) else null
            val health = request(apiUrl(url, "/health"))
            if (health.optInt("protocolVersion") != PROTOCOL_VERSION) throw HostError(409, "Host 版本不兼容，请升级桌面 Host。")
            val secure = code.trim().startsWith("V2-",ignoreCase=true)
            val key = if (secure) SecureTunnel.verify(url,request(apiUrl(url,"/secure/key"))).publicKey else null
            val pairingCode = if (secure) code.substringBefore("&").trim().drop(3) else code.trim()
            val signing = if (secure) SecureTunnel.mailboxKeys() else null
            val body = JSONObject().put("code",pairingCode).put("name","Kooyu Android")
            signing?.let { body.put("mailboxVerifyPubKey",it.second) }
            val value = request(apiUrl(url, "/pair/native"), body = body,tunnelKey=key)
            if (value.optInt("protocolVersion") != PROTOCOL_VERSION || value.getString("hostId") != health.getString("hostId")) throw HostError(409, "Host 身份或版本变化，请重新配对。")
            val device = value.getJSONObject("device")
            account?.finish()
            return Connection(url.toString().trimEnd('/'), value.getString("hostId"), device.getString("id"), value.getString("token"), device.getString("expiresAt"),tunnelKey=key,cloud=account?.data,mailboxSeed=signing?.first?.takeIf { value.optString("mailboxEncryptionKey") == key })
        }
        fun apiUrl(base: HttpUrl, path: String): HttpUrl {
            val prefix = base.encodedPath.trimEnd('/') + "/api"
            val url = base.resolve(prefix + path)
            require(path.startsWith("/") && url != null && url.host == base.host && url.port == base.port && url.scheme == base.scheme && url.encodedPath.startsWith(prefix + "/") && url.fragment == null) { "连接地址无效。" }
            return url
        }
        private suspend fun request(url: HttpUrl, token: String? = null, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST", array: Boolean = false, binary: ByteArray? = null, tunnelKey: String? = null): JSONObject = suspendCancellableCoroutine { continuation ->
            val builder = Request.Builder().tag(TunnelKey::class.java,tunnelKey?.let(::TunnelKey)).url(url).header("Accept", "application/json").header("X-Kooyu-Protocol", PROTOCOL_VERSION.toString())
            if (token != null) builder.header("Authorization", "Bearer $token")
            builder.method(method, binary?.toRequestBody("application/octet-stream".toMediaType()) ?: body?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType()))
            val call = clientFor(method).newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(HostError(0, "无法连接此设备，请检查设备是否在线以及网络是否可用。")) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            val source = it.body?.source()
                            if (source?.request(2L * 1024 * 1024 + 1) == true) throw HostError(0, "Host 响应超过限制。")
                            val text = source?.readUtf8() ?: ""
                            val value = if (it.isSuccessful && array) JSONObject().put("items", JSONArray(text)) else if (it.isSuccessful) responseObject(text, method == "GET") else runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                            if (!it.isSuccessful) throw HostError(it.code, (value.optJSONObject("error")?.optString("message")?.ifEmpty { null } ?: "Host 请求失败（${it.code}），请检查连接。").replace(Regex("https?://[^\\s]+"), "[连接信息已隐藏]"))
                            continuation.resume(value)
                        } catch (e: Exception) { continuation.resumeWithException(e) }
                    }
                }
            })
        }
    }
}


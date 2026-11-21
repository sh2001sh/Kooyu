package app.kooyu.android

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.asResponseBody
import okio.Buffer
import okio.Source
import okio.buffer
import org.bouncycastle.math.ec.rfc7748.X25519
import org.bouncycastle.math.ec.rfc8032.Ed25519
import org.json.JSONObject
import java.io.IOException
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A pinned key tag selects the encrypted transport for one request, including SSE. */
internal data class TunnelKey(val publicKey: String)
internal object SecureTunnel : Interceptor {
    private val random = SecureRandom()
    private val spki = byteArrayOf(48,42,48,5,6,3,43,101,110,3,33,0)
    private fun enc(data: ByteArray) = Base64.getEncoder().encodeToString(data)
    private fun dec(text: String) = Base64.getDecoder().decode(text)
    private fun fail(): Nothing = throw IOException("Host 加密通道校验失败。")

    fun verify(base: HttpUrl, descriptor: JSONObject): TunnelKey {
        val signing = dec(descriptor.getString("publicKey"))
        val hash = MessageDigest.getInstance("SHA-256").digest(signing).joinToString("") { "%02x".format(it) }
        if (signing.size != 44 || hash != base.pathSegments.lastOrNull { it.isNotEmpty() }) fail()
        val key = descriptor.getString("encryptionKey")
        val agreement = dec(key)
        if (agreement.size != 44 || !agreement.copyOf(12).contentEquals(spki)) fail()
        val msg = ("kooyu-tunnel-v2:" + key).toByteArray()
        if (!Ed25519.verify(dec(descriptor.getString("signature")),0,signing,12,msg,0,msg.size)) fail()
        return TunnelKey(key)
    }
    private fun mac(key: ByteArray, bytes: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key,"HmacSHA256")) }.doFinal(bytes)
    private fun crypt(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray, bytes: ByteArray) =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode,SecretKeySpec(key,"AES"), GCMParameterSpec(128,iv)); updateAAD(aad)
        }.doFinal(bytes)

    fun mailboxKeys(): Pair<String,String> {
        val seed = ByteArray(32).also(random::nextBytes)
        val pub = ByteArray(32)
        Ed25519.generatePublicKey(seed,0,pub,0)
        val prefix = spki.copyOf().also { it[8] = 112 }
        return enc(seed) to enc(prefix + pub)
    }

    fun mail(connection: Connection, host: String, session: String, text: String): JSONObject {
        val payload = JSONObject().put("sessionId",session).put("text",text).toString().toByteArray()
        require(text.isNotBlank() && text.length <= 16000 && payload.size <= 23500) { "离线消息超过长度限制。" }
        val command = java.util.UUID.randomUUID().toString()
        val expires = System.currentTimeMillis() + 12*3600000L
        val fields = org.json.JSONArray(listOf("kooyu-mailbox-v2",host,connection.deviceId,command,expires))
        val aad = fields.toString().toByteArray()
        val privateBytes = ByteArray(32)
        X25519.generatePrivateKey(random,privateBytes)
        val publicBytes = ByteArray(32)
        X25519.generatePublicKey(privateBytes,0,publicBytes,0)
        val shared = ByteArray(32)
        if (!X25519.calculateAgreement(privateBytes,0,dec(requireNotNull(connection.tunnelKey)),12,shared,0)) fail()
        val nonce = ByteArray(12).also(random::nextBytes)
        val key = mac(mac(nonce,shared),aad + byteArrayOf(1))
        val url64 = Base64.getUrlEncoder().withoutPadding()
        val packet = url64.encodeToString(spki + publicBytes + nonce + crypt(Cipher.ENCRYPT_MODE,key,nonce,aad,payload))
        val signed = fields.put(packet).toString().toByteArray()
        val signature = ByteArray(64)
        Ed25519.sign(dec(requireNotNull(connection.mailboxSeed)),0,signed,0,signed.size,signature,0)
        return JSONObject().put("deviceId",connection.deviceId).put("commandId",command).put("expiresAt",expires)
            .put("ciphertext",packet).put("signature",url64.encodeToString(signature))
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val hostKey = req.tag(TunnelKey::class.java) ?: return chain.proceed(req)
        try { return sealed(chain, req, hostKey) }
        catch (e: IOException) { throw e }
        catch (e: Exception) { throw IOException("Host 加密通道校验失败。",e) }
    }
    private fun sealed(chain: Interceptor.Chain, req: Request, host: TunnelKey): Response {
        val privateBytes = ByteArray(32); X25519.generatePrivateKey(random, privateBytes)
        val publicBytes = ByteArray(32); X25519.generatePublicKey(privateBytes,0,publicBytes,0)
        val shared = ByteArray(32)
        if (!X25519.calculateAgreement(privateBytes,0,dec(host.publicKey),12,shared,0)) fail()
        val nonce = ByteArray(12).also(random::nextBytes)
        val ephemeral = enc(spki + publicBytes)
        val expires = System.currentTimeMillis() + 60000
        val aad = "kooyu-tunnel-v2:$ephemeral:${enc(nonce)}:$expires".toByteArray()
        val prk = mac(nonce,shared)
        val key = mac(prk,aad + byteArrayOf(1))
        val replyKey = mac(prk,key + aad + byteArrayOf(2))
        val apiIndex = req.url.encodedPath.indexOf("/api/")
        if (apiIndex < 0) fail()
        val path = req.url.encodedPath.substring(apiIndex) + (req.url.encodedQuery?.let { "?$it" } ?: "")
        val inner = JSONObject().put("method",req.method).put("path",path).put("protocol",HostAPI.PROTOCOL_VERSION.toString())
        req.header("Authorization")?.removePrefix("Bearer ")?.let { inner.put("token",it) }
        req.body?.let {
            val buffer = Buffer(); it.writeTo(buffer)
            inner.put("body",enc(buffer.readByteArray())).put("contentType",it.contentType().toString().substringBefore(';'))
        }
        val ciphertext = crypt(Cipher.ENCRYPT_MODE,key,nonce,aad,inner.toString().toByteArray())
        val outer = JSONObject().put("ephemeral",ephemeral).put("nonce",enc(nonce)).put("expires",expires).put("ciphertext",enc(ciphertext))
        val url = req.url.newBuilder().encodedPath(req.url.encodedPath.substring(0,apiIndex)+"/api/secure/channel").query(null).build()
        val response = chain.proceed(Request.Builder().url(url).post(outer.toString().toRequestBody("application/json".toMediaType())).build())
        try {
            if (response.code != 200) throw HostError(response.code,"Host 加密请求未获确认。")
            val source = response.body?.source() ?: fail()
            var sequence = 0L
            fun record(): Pair<Int,ByteArray> {
                val header = source.readByteArray(5)
                val length = ByteBuffer.wrap(header,1,4).int
                if (length !in 16..65552) fail()
                val iv = ByteBuffer.allocate(12).putInt(0).putLong(sequence++).array()
                return header[0].toInt() to crypt(Cipher.DECRYPT_MODE,replyKey,iv,aad+header,source.readByteArray(length.toLong()))
            }
            val (tag,payload) = record()
            if (tag != 1) fail()
            val head = JSONObject(payload.toString(Charsets.UTF_8))
            val media = head.getString("contentType").toMediaType()
            val decoded = object : Source {
                private val pending = Buffer()
                private var ended = false
                override fun read(sink: Buffer, byteCount: Long): Long {
                    if (byteCount == 0L) return 0
                    while (pending.size == 0L && !ended) {
                        try {
                            val (kind,bytes) = record()
                            when { kind == 2 -> pending.write(bytes); kind == 3 && bytes.isEmpty() -> ended = true; else -> fail() }
                        } catch (e: Exception) { throw IOException("Host 加密响应中断。",e) }
                    }
                    return if (pending.size > 0) pending.read(sink,byteCount) else -1
                }
                override fun timeout() = source.timeout()
                override fun close() = response.close()
            }.buffer()
            return response.newBuilder().request(req).headers(Headers.Builder().add("Content-Type",media.toString()).build())
                .code(head.getInt("status")).body(decoded.asResponseBody(media)).build()
        } catch (e: Exception) { response.close(); throw e }
    }
}

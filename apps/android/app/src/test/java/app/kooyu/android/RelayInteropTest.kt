package app.kooyu.android

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeNotNull
import org.junit.Test
import java.io.File

class RelayInteropTest {
    @Test fun pairAndReadEncryptedSnapshot() {
        val path = System.getenv("KOOYU_TEST_PAIR")
        assumeNotNull(path)
        val invitation = JSONObject(File(path!!).readText())
        val base = invitation.getString("base").toHttpUrl()
        val client = OkHttpClient.Builder().addInterceptor(SecureTunnel).build()
        val key = client.newCall(Request.Builder().url(base.resolve("api/secure/key")!!).build()).execute().use {
            SecureTunnel.verify(base, JSONObject(it.body!!.string()))
        }
        val (seed,verifyKey) = SecureTunnel.mailboxKeys()
        val pair = Request.Builder().url(base.resolve("api/pair/native")!!).tag(TunnelKey::class.java,key)
            .post(JSONObject().put("code",invitation.getString("code")).put("name","Android interop").put("mailboxVerifyPubKey",verifyKey).toString().toRequestBody("application/json".toMediaType())).build()
        val result = client.newCall(pair).execute().use {
            assertEquals(201,it.code)
            JSONObject(it.body!!.string())
        }
        val token = result.getString("token")
        val snapshot = Request.Builder().url(base.resolve("api/native/snapshot")!!).tag(TunnelKey::class.java,key)
            .header("Authorization","Bearer "+token).build()
        client.newCall(snapshot).execute().use {
            assertEquals(200,it.code)
            JSONObject(it.body!!.string())
        }
        val device = result.getJSONObject("device")
        val c = Connection(base.toString(),result.getString("hostId"),device.getString("id"),token,
            device.getString("expiresAt"),tunnelKey=key.publicKey,mailboxSeed=seed)
        val fingerprint = base.pathSegments.last { it.isNotEmpty() }
        val mail = SecureTunnel.mail(c,fingerprint,java.util.UUID.randomUUID().toString(),"offline delivery")
        val request = Request.Builder().url(base.resolve("/v2/mailbox/"+fingerprint)!!)
            .post(mail.toString().toRequestBody("application/json".toMediaType())).build()
        for (expected in listOf(201,200)) client.newCall(request).execute().use { assertEquals(expected,it.code) }
    }
}

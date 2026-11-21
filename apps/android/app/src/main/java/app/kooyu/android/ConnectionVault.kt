package app.kooyu.android

import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Android Keystore holds the AES key; no plaintext token is written to preferences. */
class ConnectionVault(context: Context) {
    private val prefs = context.getSharedPreferences("kooyu.connection", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("kooyu.connection", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("kooyu.connection", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(book: ConnectionBook) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(book.json().toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "无法保存设备凭据。" }
    }
    fun load(): ConnectionBook {
        val data = prefs.getString("data", null) ?: return ConnectionBook()
        val iv = prefs.getString("iv", null) ?: error("设备凭据损坏，请重新连接。")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))) }
        return ConnectionBook.parse(JSONObject(String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)))
    }
    fun clear() { check(prefs.edit().clear().commit()) { "无法清除本机凭据。" } }
    fun saveDraft(host: String, session: String, text: String) = saveEncrypted("draft:$host:$session", text)
    fun saveRenewal(id: String, value: String) = saveEncrypted("renewal:$id", value)
    fun renewal(id: String) = readEncrypted("renewal:$id")
    private fun saveEncrypted(label:String,text:String) {
        if (text.isEmpty()) { prefs.edit().remove(label).apply(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(text.take(200000).toByteArray(Charsets.UTF_8))
        prefs.edit().putString(label, JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP)).toString()).apply()
    }
    fun draft(host: String, session: String) = readEncrypted("draft:$host:$session")
    private fun readEncrypted(label:String): String {
        val value = prefs.getString(label, null) ?: return ""
        val blob = JSONObject(value)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(blob.getString("iv"), Base64.NO_WRAP))) }
        return String(cipher.doFinal(Base64.decode(blob.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8)
    }
}

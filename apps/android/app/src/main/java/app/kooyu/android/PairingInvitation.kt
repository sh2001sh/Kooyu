package app.kooyu.android

import java.net.URI
import java.util.Locale

/** Parsing is offline: an arbitrary QR must never launch a URL or send a request. */
data class PairingInvitation(val address: String, val code: String) {
    companion object {
        fun parse(raw: String): PairingInvitation {
            val message = "配对二维码无效。请在桌面「设置 → 手机连接」重新生成。"
            require(raw.length <= 2048) { message }
            val uri = try { URI(raw.trim()) } catch (_: Exception) { throw IllegalArgumentException(message) }
            require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null && uri.rawQuery == null &&
                (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/" || Regex("/h/[a-f0-9]{64}/?").matches(uri.rawPath))) { message }
            val match = Regex("pair=([a-fA-F0-9]{32})").matchEntire(uri.rawFragment ?: "")
            require(match != null) { message }
            val address = try { HostAPI.origin(raw.trim().substringBefore('#')).toString().trimEnd('/') }
                catch (_: Exception) { throw IllegalArgumentException(message) }
            return PairingInvitation(address, match.groupValues[1].uppercase(Locale.ROOT))
        }
    }
}

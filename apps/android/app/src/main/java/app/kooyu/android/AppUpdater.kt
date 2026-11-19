package app.kooyu.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class AndroidUpdateRelease(
    val tag: String,
    val version: String,
    val prerelease: Boolean,
    val title: String,
    val notes: String,
    val htmlUrl: String,
    val apkName: String?,
    val apkUrl: String?,
    val apkSize: Long,
    val apkSha256: String?,
)

fun compareSemver(a: String, b: String): Int {
    val pa = a.removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val pb = b.removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until 3) {
        val diff = (pa.getOrElse(i) { 0 }) - (pb.getOrElse(i) { 0 })
        if (diff != 0) return if (diff > 0) 1 else -1
    }
    return 0
}

fun parseSha256SumsText(text: String): Map<String, String> {
    val map = mutableMapOf<String, String>()
    val regex = Regex("""^([a-fA-F0-9]{64})\s+\*?(.+)$""")
    text.lineSequence().forEach { line ->
        val m = regex.matchEntire(line.trim()) ?: return@forEach
        val name = m.groupValues[2].trim().substringAfterLast('/')
        map[name] = m.groupValues[1].lowercase()
    }
    return map
}

private fun extractVersionFromTag(tag: String): String? {
    Regex("""^v?(\d+\.\d+\.\d+)$""").matchEntire(tag.trim())?.let { return it.groupValues[1] }
    Regex("""^preview-(\d+\.\d+\.\d+)-\d+$""").matchEntire(tag.trim())?.let { return it.groupValues[1] }
    return null
}

private val updateHttp = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .followRedirects(true)
    .build()

suspend fun fetchLatestAndroidRelease(
    channel: String = "stable",
    repository: String = "sh2001sh/kodo",
): AndroidUpdateRelease? = withContext(Dispatchers.IO) {
    val req = Request.Builder()
        .url("https://api.github.com/repos/$repository/releases?per_page=15")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Kooyu-Android")
        .build()
    val body = updateHttp.newCall(req).execute().use { res ->
        if (!res.isSuccessful) throw IllegalStateException("GitHub API HTTP ${res.code}")
        res.body?.string().orEmpty()
    }
    val arr = JSONArray(body)
    var best: AndroidUpdateRelease? = null
    var bestSumUrl: String? = null
    for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        if (obj.optBoolean("draft")) continue
        val tag = obj.optString("tag_name").trim()
        val version = extractVersionFromTag(tag) ?: continue
        val prerelease = obj.optBoolean("prerelease") || tag.startsWith("preview-")
        if (channel == "stable" && prerelease) continue
        val assets = obj.optJSONArray("assets") ?: JSONArray()
        var apkName: String? = null
        var apkUrl: String? = null
        var apkSize = 0L
        var sumUrl: String? = null
        for (j in 0 until assets.length()) {
            val a = assets.optJSONObject(j) ?: continue
            val name = a.optString("name")
            val url = a.optString("browser_download_url")
            if (name == "SHA256SUMS.txt" && url.startsWith("https://")) sumUrl = url
            if (name.endsWith(".apk", ignoreCase = true) && url.startsWith("https://")) {
                apkName = name
                apkUrl = url
                apkSize = a.optLong("size", 0L)
            }
        }
        val cand = AndroidUpdateRelease(
            tag = tag,
            version = version,
            prerelease = prerelease,
            title = obj.optString("name").ifBlank { "Kooyu $version" },
            notes = obj.optString("body").trim(),
            htmlUrl = obj.optString("html_url").ifBlank { "https://github.com/$repository/releases/tag/$tag" },
            apkName = apkName,
            apkUrl = apkUrl,
            apkSize = apkSize,
            apkSha256 = null,
        )
        if (best == null || compareSemver(cand.version, best.version) > 0) {
            best = cand
            bestSumUrl = sumUrl
        }
    }
    if (best != null && best.apkName != null && bestSumUrl != null) {
        val sha = runCatching {
            val sumReq = Request.Builder().url(bestSumUrl).header("User-Agent", "Kooyu-Android").build()
            updateHttp.newCall(sumReq).execute().use { r ->
                if (r.isSuccessful) parseSha256SumsText(r.body?.string().orEmpty())[best.apkName] else null
            }
        }.getOrNull()
        best = best.copy(apkSha256 = sha)
    }
    best
}

suspend fun downloadAndVerifyAndroidApk(
    context: Context,
    release: AndroidUpdateRelease,
    onProgress: (downloaded: Long, total: Long) -> Unit,
): File = withContext(Dispatchers.IO) {
    val url = release.apkUrl ?: throw IllegalStateException("该版本未提供 Android APK 安装包。")
    require(url.startsWith("https://")) { "仅支持 HTTPS 安全下载。" }
    val safeName = (release.apkName ?: "Kooyu-${release.version}.apk").replace(Regex("[^A-Za-z0-9._-]"), "_")
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    val finalFile = File(dir, safeName)
    val partFile = File(dir, "$safeName.part")

    val req = Request.Builder().url(url).header("User-Agent", "Kooyu-Android").build()
    updateHttp.newCall(req).execute().use { res ->
        if (!res.isSuccessful) throw IllegalStateException("APK 下载失败（HTTP ${res.code}）")
        val body = res.body ?: throw IllegalStateException("下载响应为空")
        val total = body.contentLength().takeIf { it > 0 } ?: release.apkSize
        val md = MessageDigest.getInstance("SHA-256")
        var readTotal = 0L
        body.byteStream().use { input ->
            FileOutputStream(partFile).use { output ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    md.update(buf, 0, n)
                    output.write(buf, 0, n)
                    readTotal += n
                    onProgress(readTotal, total)
                }
            }
        }
        val actualSha = md.digest().joinToString("") { "%02x".format(it) }
        if (release.apkSha256 != null && !actualSha.equals(release.apkSha256, ignoreCase = true)) {
            partFile.delete()
            throw IllegalStateException("APK SHA-256 校验失败，已自动删除损坏文件。")
        }
        if (finalFile.exists()) finalFile.delete()
        if (!partFile.renameTo(finalFile)) {
            partFile.copyTo(finalFile, overwrite = true)
            partFile.delete()
        }
    }
    finalFile
}

/** Returns true if system installer was launched, false if user was sent to unknown-sources permission first. */
fun launchAndroidApkInstall(context: Context, apkFile: File): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        val permIntent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(permIntent)
        return false
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.artifacts", apkFile)
    val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(installIntent)
    return true
}

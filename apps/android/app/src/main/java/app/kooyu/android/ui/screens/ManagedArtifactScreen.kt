package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import android.content.Intent
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

@Composable fun ManagedArtifactScreen(artifact: JSONObject, state: WorkbenchState, close: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bytes by remember { mutableStateOf<ByteArray?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var exported by remember { mutableStateOf<File?>(null) }
    val name = artifact.optString("displayName", "成果文件").replace(Regex("[\\\\/\\x00-\\x1f]"), "_").take(120)
    val mime = artifact.optString("mediaType", "application/octet-stream")
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mime)) { uri ->
        if (uri != null) scope.launch {
            try { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes ?: error("文件尚未读取")) } ?: error("无法保存到所选位置") } }
            catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "保存失败。" }
        }
    }
    LaunchedEffect(artifact.optString("fileId"), state.connection?.hostId) {
        loading = true; bytes = null; exported = null
        try {
            val c = state.connection ?: error("设备未连接。")
            val result = HostAPI(c).file(artifact.getString("fileId"))
            val file = withContext(Dispatchers.IO) {
                val sha = java.security.MessageDigest.getInstance("SHA-256").digest(result).joinToString("") { "%02x".format(it) }
                require(sha == artifact.optString("sha256")) { "文件校验失败，请重新读取。" }
                val folder = File(context.cacheDir, "artifacts/${UUID.randomUUID()}").apply { mkdirs() }
                File(folder, name.ifBlank { "artifact" }).apply { writeBytes(result) }
            }
            bytes = result; exported = file
        } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "读取失败。" }
        finally { loading = false }
    }
    val bitmap = remember(bytes) {
        if (mime.startsWith("image/") && bytes != null) runCatching {
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true; inSampleSize = 1 }
            BitmapFactory.decodeByteArray(bytes, 0, bytes!!.size, options)
            while (options.outWidth / options.inSampleSize > 2048 || options.outHeight / options.inSampleSize > 2048) options.inSampleSize *= 2
            options.inJustDecodeBounds = false
            BitmapFactory.decodeByteArray(bytes, 0, bytes!!.size, options)?.asImageBitmap()
        }.getOrNull() else null
    }
    fun external(share: Boolean) {
        try {
            val file = exported ?: return
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.artifacts", file)
            val intent = if (share) Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri) else Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            context.startActivity(Intent.createChooser(intent, if (share) "分享成果" else "打开成果"))
        } catch (e: Exception) { error = "没有可打开此文件的应用，可先保存文件。" }
    }
    FullScreenPage(name, close) { padding -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("不可变成果快照 · v${artifact.optInt("version", 1)}", color = Kooyu.colors.textSecondary)
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = Kooyu.colors.destructive)
        if (bytes != null) {
            if (bitmap != null) Image(bitmap, name, modifier = Modifier.fillMaxWidth())
            else if (mime.startsWith("text/") || mime == "application/json") {
                val text = bytes!!.copyOfRange(0, minOf(bytes!!.size, 128 * 1024)).toString(Charsets.UTF_8)
                SelectionContainer { Text(text) }
                if (bytes!!.size > 128 * 1024) Text("预览前 128 KiB，保存可获取完整文件。", color = Kooyu.colors.textSecondary)
            } else Text("使用系统应用打开此文件。", color = Kooyu.colors.textSecondary)
            Button(onClick = { saver.launch(name) }, modifier = Modifier.fillMaxWidth()) { Text("保存文件") }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { external(false) }) { Text("用应用打开") }
                OutlinedButton(onClick = { external(true) }) { Text("分享成果") }
            }
        }
    } }
}

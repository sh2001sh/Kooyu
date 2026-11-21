package app.kooyu.android.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kooyu.android.*
import app.kooyu.android.ui.components.FullScreenPage
import app.kooyu.android.ui.theme.*
import kotlinx.coroutines.launch
import java.io.File

@Composable
fun AppUpdateScreen(
    currentVersion: String,
    onClose: () -> Unit,
) {
    val c = Kooyu.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var channel by remember { mutableStateOf("stable") }
    var checking by remember { mutableStateOf(false) }
    var release by remember { mutableStateOf<AndroidUpdateRelease?>(null) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var downloading by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var downloadedApk by remember { mutableStateOf<File?>(null) }

    fun check() {
        if (checking) return
        checking = true
        error = ""
        notice = ""
        scope.launch {
            try {
                release = fetchLatestAndroidRelease(channel = channel)
            } catch (e: Throwable) {
                error = e.message ?: "检查更新失败"
            } finally {
                checking = false
            }
        }
    }

    LaunchedEffect(channel) { check() }

    val updateAvailable = release != null && (
        compareSemver(release!!.version, currentVersion) > 0 ||
            (channel == "preview" && release!!.prerelease && compareSemver(release!!.version, currentVersion) >= 0)
        )
    val allowUnknownMsg = kooyuT("update.allowUnknown")

    FullScreenPage(kooyuT("update.title"), onClose) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .background(c.navigator)
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Card(
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = c.raised),
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Kooyu V$currentVersion", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = c.text)
                            Text(
                                when {
                                    checking -> kooyuT("update.checking")
                                    updateAvailable -> "${kooyuT("update.available")} V${release!!.version}"
                                    release != null -> kooyuT("update.upToDate")
                                    else -> "github.com/sh2001sh/Kooyu"
                                },
                                fontSize = 13.sp,
                                color = if (updateAvailable) c.brandCoral else c.textSecondary
                            )
                        }
                        FilledTonalButton(
                            onClick = { check() },
                            enabled = !checking && !downloading,
                            colors = ButtonDefaults.filledTonalButtonColors(containerColor = c.sunken, contentColor = c.text)
                        ) {
                            Text(if (checking) kooyuT("update.checking") else kooyuT("update.check"), fontSize = 12.5.sp)
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = channel == "stable",
                            onClick = { channel = "stable"; downloadedApk = null },
                            label = { Text(kooyuT("update.channel.stable")) }
                        )
                        FilterChip(
                            selected = channel == "preview",
                            onClick = { channel = "preview"; downloadedApk = null },
                            label = { Text(kooyuT("update.channel.preview")) }
                        )
                    }
                }
            }

            if (error.isNotBlank()) {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = c.destructiveTint),
                    border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.25f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(error, color = c.destructive, fontSize = 12.5.sp, modifier = Modifier.padding(12.dp))
                }
            }

            if (notice.isNotBlank()) {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = c.successTint),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(notice, color = c.doneText, fontSize = 12.5.sp, modifier = Modifier.padding(12.dp))
                }
            }

            if (updateAvailable && release != null) {
                val rel = release!!
                Card(
                    shape = RoundedCornerShape(18.dp),
                    colors = CardDefaults.cardColors(containerColor = c.raised),
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(rel.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                        if (rel.notes.isNotBlank()) {
                            Text(rel.notes, fontSize = 12.5.sp, color = c.textSecondary, lineHeight = 19.sp)
                        }
                        if (downloading) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    "${kooyuT("update.downloading")} ${(progress * 100).toInt()}%",
                                    fontSize = 12.sp,
                                    color = c.textSecondary
                                )
                                LinearProgressIndicator(
                                    progress = { progress.coerceIn(0f, 1f) },
                                    modifier = Modifier.fillMaxWidth(),
                                    color = c.accent,
                                    trackColor = c.borderSubtle
                                )
                            }
                        }
                        if (downloadedApk != null && rel.apkSha256 != null) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.Outlined.VerifiedUser, null, Modifier.size(15.dp), tint = c.doneText)
                                Text(kooyuT("update.verified"), fontSize = 12.sp, color = c.doneText, fontWeight = FontWeight.Medium)
                            }
                        }
                        if (rel.apkUrl != null) {
                            Button(
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !downloading,
                                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                                onClick = {
                                    error = ""
                                    notice = ""
                                    val ready = downloadedApk
                                    if (ready != null && ready.exists()) {
                                        if (!launchAndroidApkInstall(context, ready)) {
                                            notice = allowUnknownMsg
                                        }
                                        return@Button
                                    }
                                    downloading = true
                                    progress = 0f
                                    scope.launch {
                                        try {
                                            val file = downloadAndVerifyAndroidApk(context, rel) { dl, total ->
                                                if (total > 0) progress = dl.toFloat() / total.toFloat()
                                            }
                                            downloadedApk = file
                                            if (!launchAndroidApkInstall(context, file)) {
                                                notice = allowUnknownMsg
                                            }
                                        } catch (e: Throwable) {
                                            error = e.message ?: "下载失败"
                                        } finally {
                                            downloading = false
                                        }
                                    }
                                }
                            ) {
                                Icon(Icons.Outlined.SystemUpdate, null, Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(if (downloadedApk != null) kooyuT("update.installNow") else kooyuT("update.downloadInstall"))
                            }
                        }
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(rel.htmlUrl)))
                            }
                        ) {
                            Text(kooyuT("update.openRelease"), color = c.text)
                        }
                    }
                }
            }
        }
    }
}

package app.kooyu.android.ui.screens

import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import app.kooyu.android.Connection
import app.kooyu.android.HostAPI
import app.kooyu.android.ui.theme.Kooyu
import app.kooyu.android.ui.theme.KooyuType
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject

@Composable
internal fun WorkspaceTerminal(connection: Connection, workspaceId: String) {
    val c = Kooyu.colors
    var opened by remember(connection, workspaceId) { mutableStateOf(false) }
    val inputs = remember(connection, workspaceId) { Channel<String>(64) }
    var screen by remember { mutableStateOf<WebView?>(null) }
    var error by remember { mutableStateOf("") }

    Surface(
        shape = RoundedCornerShape(14.dp),
        color = c.raised,
        border = BorderStroke(0.5.dp, c.border),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        error = ""
                        opened = !opened
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Outlined.Terminal, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                Text(
                    if (opened) "关闭交互式终端" else "打开交互式终端",
                    style = KooyuType.label,
                    fontWeight = FontWeight.SemiBold,
                    color = c.text,
                    modifier = Modifier.weight(1f)
                )
            }

            if (opened) {
                // Mobile hardware-key shortcut bar for interactive PTY control
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        "Ctrl+C" to "\u0003",
                        "Tab" to "\t",
                        "↑" to "\u001b[A",
                        "↓" to "\u001b[B",
                        "Esc" to "\u001b",
                    ).forEach { (label, seq) ->
                        Surface(
                            shape = RoundedCornerShape(7.dp),
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier.clickable { inputs.trySend(seq) }
                        ) {
                            Text(
                                label,
                                style = KooyuType.mono,
                                fontSize = 11.5.sp,
                                color = c.text,
                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)
                            )
                        }
                    }
                }

                AndroidView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(285.dp)
                        .clip(RoundedCornerShape(10.dp)),
                    factory = { context ->
                        WebView(context).apply {
                            settings.javaScriptEnabled = true
                            settings.blockNetworkLoads = true
                            settings.allowContentAccess = false
                            addJavascriptInterface(object {
                                @JavascriptInterface fun send(value: String) {
                                    if (inputs.trySend(value).isFailure) post { error = "输入过快，请核对终端后重试。" }
                                }
                            }, "TerminalInput")
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                                override fun onPageFinished(view: WebView, url: String) { screen = view }
                            }
                            loadUrl("file:///android_asset/terminal/index.html")
                        }
                    },
                    onRelease = {
                        it.removeJavascriptInterface("TerminalInput")
                        it.destroy()
                    }
                )

                LaunchedEffect(screen, connection, workspaceId) {
                    val view = screen ?: return@LaunchedEffect
                    val api = HostAPI(connection)
                    var path: String? = null
                    try {
                        val id = api.post("/terminals", JSONObject().put("workspaceId", workspaceId)).getString("id")
                        val endpoint = "/terminals/" + id
                        path = endpoint
                        api.post(endpoint, JSONObject().put("cols", 44).put("rows", 18))
                        coroutineScope {
                            val writer = launch {
                                for (input in inputs) {
                                    val batch = StringBuilder(input)
                                    while (batch.length < 16384) {
                                        val next = inputs.tryReceive().getOrNull() ?: break
                                        batch.append(next)
                                    }
                                    for (part in batch.toString().chunked(16384)) {
                                        api.post(endpoint, JSONObject().put("data", part))
                                    }
                                }
                            }
                            var cursor = 0
                            try {
                                while (isActive) {
                                    val update = api.get(endpoint + "?cursor=" + cursor)
                                    cursor = update.getInt("cursor")
                                    val text = update.getString("text")
                                    if (text.isNotEmpty() || update.getBoolean("reset"))
                                        view.evaluateJavascript(
                                            "renderTerminal(" + JSONObject.quote(text) + "," + update.getBoolean("reset") + ")",
                                            null
                                        )
                                    if (update.getBoolean("closed")) break
                                    delay(200)
                                }
                            } finally { writer.cancel() }
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        error = e.message ?: "终端连接失败。"
                    } finally {
                        path?.let {
                            withContext(NonCancellable) {
                                runCatching { withTimeout(3000) { api.perform(it, "DELETE") } }
                            }
                        }
                    }
                }

                if (error.isNotEmpty()) {
                    Text(error, fontSize = 12.sp, color = c.destructive)
                }
            }
        }
    }
}

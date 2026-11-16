package app.kooyu.android

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** Browses the connected computer, never the phone's filesystem. */
@Composable fun DirectoryPicker(model: Workbench, initial: String = "", close: () -> Unit, choose: (String) -> Unit) {
    var path by remember { mutableStateOf(initial) }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var retry by remember { mutableIntStateOf(0) }
    val c = Kooyu.colors
    LaunchedEffect(path, retry) {
        loading = true; data = null
        data = model.read("/directories" + if (path.isBlank()) "" else "?path=${encoded(path)}")
        loading = false
    }
    FullScreenPage("选择设备目录", close, actions = {
        Button(
            onClick = { data?.nullableString("path")?.let(choose) },
            enabled = !loading && data?.nullableString("path") != null,
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
        ) {
            Text("选择此目录", fontWeight = FontWeight.SemiBold)
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.height(32.dp).clickable { path = "" }
                ) {
                    Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                        Text("主目录", fontSize = 12.sp, color = c.textSecondary, fontWeight = FontWeight.Medium)
                    }
                }
                data?.nullableString("parent")?.let { parent ->
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = c.sunken,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.height(32.dp).clickable { path = parent }
                    ) {
                        Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                            Text("上级目录", fontSize = 12.sp, color = c.textSecondary, fontWeight = FontWeight.Medium)
                        }
                    }
                }
                data?.optJSONArray("roots")?.let { roots ->
                    (0 until roots.length()).forEach { i ->
                        val root = roots.getString(i)
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier.height(32.dp).clickable { path = root }
                        ) {
                            Box(Modifier.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                                Text(root, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = c.textSecondary, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
            Surface(shape = RoundedCornerShape(10.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                Text(data?.optString("path") ?: path, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = c.text, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.accent)
            if (!loading && data == null) TextButton(onClick = { retry++ }) { Text("读取失败，重试", color = c.destructive) }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp), contentPadding = PaddingValues(bottom = 16.dp)) {
                items(data?.optJSONArray("directories")?.objects().orEmpty(), key = { it.getString("path") }) { dir ->
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = c.raised,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.fillMaxWidth().clickable { path = dir.getString("path") }
                    ) {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Folder, null, tint = c.textSecondary, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(10.dp))
                            Text(dir.getString("name"), fontSize = 14.sp, color = c.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }
}

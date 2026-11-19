package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun GlobalMemorySettingsScreen(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var settings by remember(state.connection?.hostId) { mutableStateOf<JSONObject?>(null) }
    var entries by remember(state.connection?.hostId) { mutableStateOf(emptyList<JSONObject>()) }
    var loading by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var notice by remember { mutableStateOf("") }
    suspend fun reload() {
        loading = true
        settings = model.read("/memory/settings")
        entries = model.readArray("/memory").filter { it.optString("scope") == "user" }
        loading = false
    }
    suspend fun save(enabled: Boolean, automatic: Boolean) {
        val original = settings ?: return
        saving = true
        val result = model.execute("/memory/settings", "PATCH", JSONObject()
            .put("expectedRevision", original.optInt("revision"))
            .put("enabled", enabled).put("automaticSaving", automatic))
        if (result != null) { settings = result; notice = "已保存，下轮生效。" }
        saving = false
    }
    LaunchedEffect(state.connection?.hostId) { reload() }
    FullScreenPage("全局记忆", close) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            WorkRecovery(state, model)
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (notice.isNotBlank()) Text(notice, color = Kooyu.colors.textSecondary)
            settings?.let { config ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("启用全局记忆", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Switch(modifier = Modifier.semantics { contentDescription = "启用全局记忆" }, checked = config.optBoolean("enabled"), onCheckedChange = { value -> scope.launch { save(value, config.optBoolean("automaticSaving")) } }, enabled = state.canWrite && !saving && !loading)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("自动保存对话记忆", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Switch(modifier = Modifier.semantics { contentDescription = "自动保存对话记忆" }, checked = config.optBoolean("automaticSaving"), onCheckedChange = { value -> scope.launch { save(config.optBoolean("enabled"), value) } }, enabled = state.canWrite && config.optBoolean("enabled") && !saving && !loading)
                }
            }
            TextButton(onClick = { scope.launch { reload() } }, enabled = !loading && !saving) { Text("刷新全局记忆") }
            HorizontalDivider(color = Kooyu.colors.borderSubtle)
            Text("已保存的全局记忆", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Button(onClick = { editing = JSONObject() }, enabled = state.canWrite && !loading && !saving) { Text("新增记忆") }
            if (!loading && settings != null && entries.isEmpty()) Text("还没有全局记忆。", color = Kooyu.colors.textSecondary)
            entries.forEach { entry ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(entry.optString("subject"), fontWeight = FontWeight.SemiBold)
                    Text(if (entry.optString("status") == "confirmed") "已确认 · 下轮使用" else "待确认 · 尚未使用", color = Kooyu.colors.textSecondary, style = MaterialTheme.typography.bodySmall)
                    Text(entry.optString("content"))
                    var sources by remember(entry.optString("id")) { mutableStateOf(false) }
                    TextButton(onClick = { sources = !sources }) { Text(if (sources) "收起来源" else "查看来源") }
                    if (sources) entry.optJSONArray("sourceRefs")?.let { refs ->
                        for (i in 0 until refs.length()) Text(refs.optString(i), style = MaterialTheme.typography.bodySmall, color = Kooyu.colors.textSecondary)
                    }
                    TextButton(onClick = { editing = entry }, enabled = state.canWrite && !saving) { Text(if (entry.optString("status") == "confirmed") "编辑记忆" else "查看并确认") }
                    HorizontalDivider(color = Kooyu.colors.borderSubtle)
                }
            }
            if (state.error.isNotBlank()) Text(state.error, color = Kooyu.colors.destructive)
        }
    }
    editing?.let { entry -> NativeMemoryEditor(entry, "", state, model) { editing = null; scope.launch { reload() } } }
}

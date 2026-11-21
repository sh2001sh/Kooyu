package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun GlobalMemorySettingsScreen(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    val c = Kooyu.colors
    val scope = rememberCoroutineScope()
    var settings by remember(state.connection?.hostId) { mutableStateOf<JSONObject?>(null) }
    var entries by remember(state.connection?.hostId) { mutableStateOf(emptyList<JSONObject>()) }
    var docs by remember(state.connection?.hostId) { mutableStateOf(emptyList<JSONObject>()) }
    var activeDocName by remember(state.connection?.hostId) { mutableStateOf("SOUL.md") }
    var docDraft by remember(state.connection?.hostId) { mutableStateOf("") }
    var docDirty by remember(state.connection?.hostId) { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var notice by remember { mutableStateOf("") }
    var loadError by remember { mutableStateOf("") }

    suspend fun reload() {
        loading = true
        loadError = ""
        model.dismissError()
        val loadedSettings = model.read("/memory/settings")
        settings = loadedSettings
        if (loadedSettings == null) {
            loadError = model.state.value.error.ifBlank { "无法读取全局记忆配置，请检查桌面 Host 连接与版本。" }
        } else {
            entries = model.readArray("/memory").filter { it.optString("scope") == "user" }
            val loadedDocs = model.readArray("/memory/docs")
            docs = loadedDocs
            if (!docDirty) {
                docDraft = loadedDocs.firstOrNull { it.optString("name") == activeDocName }?.optString("content").orEmpty()
            }
        }
        loading = false
    }

    suspend fun save(enabled: Boolean, automatic: Boolean) {
        val original = settings ?: return
        saving = true
        loadError = ""
        val result = model.execute("/memory/settings", "PATCH", JSONObject()
            .put("expectedRevision", original.optInt("revision"))
            .put("enabled", enabled).put("automaticSaving", automatic))
        if (result != null) {
            settings = result
            notice = "已保存，下轮生效。"
        } else {
            loadError = model.state.value.error
        }
        saving = false
    }

    suspend fun saveActiveDoc() {
        val doc = docs.firstOrNull { it.optString("name") == activeDocName } ?: return
        saving = true
        loadError = ""
        val result = model.execute(
            "/memory/docs/$activeDocName",
            "PATCH",
            JSONObject()
                .put("expectedRevision", doc.optString("revision"))
                .put("content", docDraft)
        )
        if (result != null) {
            docDirty = false
            notice = "$activeDocName 已保存，下轮生效。"
            reload()
        } else {
            loadError = model.state.value.error
        }
        saving = false
    }

    LaunchedEffect(state.connection?.hostId) { reload() }
    FullScreenPage("人格与记忆", close, actions = {
        IconButton(onClick = { scope.launch { reload() } }, enabled = !loading && !saving) {
            Icon(Icons.Outlined.Refresh, "刷新记忆与人格文档", tint = c.textSecondary, modifier = Modifier.size(19.dp))
        }
    }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .background(c.navigator)
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            WorkRecovery(state, model)
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.brandCoral)
            if (notice.isNotBlank()) {
                Text(notice, fontSize = 12.5.sp, color = c.doneText, modifier = Modifier.padding(horizontal = 4.dp))
            }
            if (loadError.isNotBlank()) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = c.destructiveTint,
                    border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.35f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(loadError, fontSize = 13.sp, color = c.destructive, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { reload() } }, enabled = !loading) {
                            Text("重试", color = c.destructive, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            if (docs.isNotEmpty()) {
                val activeDoc = docs.firstOrNull { it.optString("name") == activeDocName }
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Icon(Icons.Outlined.Description, null, tint = c.brandCoral, modifier = Modifier.size(17.dp))
                            Text("主代理文档 · SOUL / RULES / HEARTBEAT", style = KooyuType.rowTitle, color = c.text)
                        }
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState())
                                .clip(RoundedCornerShape(10.dp))
                                .background(c.sunken)
                                .padding(3.dp),
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            listOf("SOUL.md", "USER.md", "MEMORY.md", "RULES.md", "HEARTBEAT.md", "AGENTS.md", "ROUTING.md").forEach { name ->
                                val selected = activeDocName == name
                                Box(
                                    Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(if (selected) c.paper else c.sunken)
                                        .clickable {
                                            activeDocName = name
                                            docDraft = docs.firstOrNull { it.optString("name") == name }?.optString("content").orEmpty()
                                            docDirty = false
                                        }
                                        .padding(horizontal = 10.dp, vertical = 7.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        name,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 11.5.sp,
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                                        color = if (selected) c.text else c.textSecondary
                                    )
                                }
                            }
                        }
                        OutlinedTextField(
                            value = docDraft,
                            onValueChange = {
                                docDraft = it.take(32000)
                                docDirty = docDraft != activeDoc?.optString("content").orEmpty()
                            },
                            enabled = state.canWrite && !saving && !loading,
                            minLines = 7,
                            maxLines = 14,
                            textStyle = KooyuType.mono.copy(color = c.text),
                            shape = RoundedCornerShape(12.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = c.borderStrong,
                                unfocusedBorderColor = c.border,
                                focusedContainerColor = c.paper,
                                unfocusedContainerColor = c.sunken,
                                cursorColor = c.brandCoral,
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                if (docDirty) "有未保存修改" else "与本机文档同步",
                                style = KooyuType.caption,
                                color = c.textTertiary
                            )
                            Button(
                                onClick = { scope.launch { saveActiveDoc() } },
                                enabled = state.canWrite && !saving && !loading && docDirty,
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 7.dp)
                            ) {
                                Text("保存 $activeDocName", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }

            settings?.let { config ->
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("启用全局记忆", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                Text("跨项目共享你的偏好与约定", fontSize = 12.sp, color = c.textSecondary)
                            }
                            Switch(
                                modifier = Modifier.semantics { contentDescription = "启用全局记忆" },
                                checked = config.optBoolean("enabled"),
                                onCheckedChange = { value -> scope.launch { save(value, config.optBoolean("automaticSaving")) } },
                                enabled = state.canWrite && !saving && !loading
                            )
                        }
                        HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("自动保存对话记忆", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                Text("关闭后新记忆仅作为待确认建议", fontSize = 12.sp, color = c.textSecondary)
                            }
                            Switch(
                                modifier = Modifier.semantics { contentDescription = "自动保存对话记忆" },
                                checked = config.optBoolean("automaticSaving"),
                                onCheckedChange = { value -> scope.launch { save(config.optBoolean("enabled"), value) } },
                                enabled = state.canWrite && config.optBoolean("enabled") && !saving && !loading
                            )
                        }
                    }
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("已保存的全局记忆", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.text)
                Button(
                    onClick = { editing = JSONObject() },
                    enabled = state.canWrite && !loading && !saving && settings != null,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Outlined.Add, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("新增记忆", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            if (!loading && settings != null && entries.isEmpty()) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "还没有全局记忆，点击右上角「新增记忆」添加你的长期偏好与工作规范。",
                        fontSize = 13.sp,
                        color = c.textSecondary,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }

            entries.forEach { entry ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(entry.optString("subject"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                        Text(
                            if (entry.optString("status") == "confirmed") "已确认 · 下轮使用" else "待确认 · 尚未使用",
                            color = c.textSecondary,
                            fontSize = 12.sp
                        )
                        Text(entry.optString("content"), fontSize = 13.5.sp, lineHeight = 20.sp, color = c.text)
                        var sources by remember(entry.optString("id")) { mutableStateOf(false) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { sources = !sources }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                                Text(if (sources) "收起来源" else "查看来源", fontSize = 12.sp, color = c.textSecondary)
                            }
                            TextButton(
                                onClick = { editing = entry },
                                enabled = state.canWrite && !saving,
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                            ) {
                                Text(if (entry.optString("status") == "confirmed") "编辑记忆" else "查看并确认", fontSize = 12.sp, color = c.brandCoral)
                            }
                        }
                        if (sources) entry.optJSONArray("sourceRefs")?.let { refs ->
                            for (i in 0 until refs.length()) {
                                Text(refs.optString(i), fontSize = 11.5.sp, color = c.textTertiary)
                            }
                        }
                    }
                }
            }
        }
    }
    editing?.let { entry -> NativeMemoryEditor(entry, "", state, model) { editing = null; scope.launch { reload() } } }
}

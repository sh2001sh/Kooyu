package app.kooyu.android.ui.conversation

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.screens.*

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

private enum class InspectorTab { OVERVIEW, FILES, BRANCHES }

/** Apple-style 88% height inspector with instant-saving inset key-value rows, files and branches. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun InspectorSheet(state: WorkbenchState, model: Workbench, session: HostSession, onUsage: () -> Unit, close: () -> Unit) {
    val c = Kooyu.colors
    var tab by rememberSaveable { mutableStateOf(InspectorTab.OVERVIEW) }
    var browsing by remember { mutableStateOf(false) }
    var editingCommand by remember { mutableStateOf<JSONObject?>(null) }
    var editingText by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        onDismissRequest = close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.navigator,
        dragHandle = { KooyuSheetHandle() },
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.88f)) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("会话检查器", style = KooyuType.pageTitle, color = c.text)
                    Text(session.title.ifBlank { "未命名会话" }, style = KooyuType.caption, fontSize = 12.sp, color = c.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = close, modifier = Modifier.size(44.dp)) { Icon(Icons.Outlined.Close, "关闭检查器", tint = c.textSecondary) }
            }
            KooyuSegmentedControl(
                options = listOf(SegmentOption(InspectorTab.OVERVIEW, "概览与参数"), SegmentOption(InspectorTab.FILES, "文件与工具"), SegmentOption(InspectorTab.BRANCHES, "消息分支")),
                selected = tab,
                onSelect = { tab = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)
            )
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                when (tab) {
                    InspectorTab.OVERVIEW -> overviewTab(state, model, session, onUsage, close) { command, text -> editingCommand = command; editingText = text }
                    InspectorTab.FILES -> filesTab(state, model, session) { browsing = true }
                    InspectorTab.BRANCHES -> branchesTab(
                        state, session,
                        fork = { row -> scope.launch { if (model.branch(row, false)) close() } },
                        edit = { row -> scope.launch { if (model.branch(row, true)) close() } }
                    )
                }
            }
        }
    }

    if (browsing) {
        val workspace = state.workspaces.firstOrNull { it.id == session.workspaceId }
        FullScreenPage("工作区文件", { browsing = false }) { padding ->
            Box(Modifier.padding(padding)) {
                if (workspace == null) Text("当前会话未绑定工作目录。", color = c.textSecondary, modifier = Modifier.padding(24.dp))
                else WorkspaceBrowser(workspace, state, model)
            }
        }
    }

    editingCommand?.let { command ->
        Dialog(onDismissRequest = { editingCommand = null }) {
            Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = c.raised), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("编辑指令", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text)
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 90.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.sunken)
                            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                            .padding(12.dp)
                    ) {
                        BasicTextField(
                            value = editingText,
                            onValueChange = { editingText = it },
                            textStyle = KooyuType.body.copy(color = c.text),
                            cursorBrush = SolidColor(c.brandCoral),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { editingCommand = null }) { Text("取消", color = c.textSecondary) }
                        Button(
                            onClick = {
                                scope.launch {
                                    val body = JSONObject().put("input", JSONObject().put("text", editingText))
                                    model.execute("/sessions/" + session.id + "/commands/" + command.getString("id"), "PATCH", body)
                                    editingCommand = null
                                }
                            },
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                        ) { Text("保存") }
                    }
                }
            }
        }
    }
}

@Composable private fun InspectorGroup(title: String, badge: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = KooyuType.sectionHeader, color = Kooyu.colors.textTertiary, modifier = Modifier.weight(1f))
            badge?.invoke()
        }
        InsetGroupCard(content = content)
    }
}

@Composable private fun KeyValue(label: String, value: String, mono: Boolean = false) {
    val c = Kooyu.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = KooyuType.label, color = c.textSecondary, modifier = Modifier.width(84.dp))
        Text(value, style = if (mono) KooyuType.mono else KooyuType.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    }
}

@Composable private fun InspectorActionRow(label: String, value: String, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Kooyu.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = KooyuType.label, color = c.textSecondary, modifier = Modifier.width(84.dp))
        Text(value, style = KooyuType.label, fontWeight = FontWeight.Medium, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = c.textTertiary, modifier = Modifier.size(12.dp))
    }
}

private fun LazyListScope.overviewTab(
    state: WorkbenchState,
    model: Workbench,
    session: HostSession,
    onUsage: () -> Unit,
    closeInspector: () -> Unit,
    editCommand: (JSONObject, String) -> Unit
) {
    item("context") {
        val c = Kooyu.colors
        InspectorGroup("运行环境") {
            KeyValue("引擎", state.harnesses.firstOrNull { it.id == session.harnessId }?.name ?: harnessVisual(session.harnessId).name)
            InsetDivider(14)
            KeyValue("状态", sessionStatus(session).label)
            InsetDivider(14)
            KeyValue("项目", state.projects.firstOrNull { it.first == session.projectId }?.second ?: "全局会话")
            InsetDivider(14)
            KeyValue("工作目录", formatWorkspaceLabel(state.workspaces.firstOrNull { it.id == session.workspaceId }?.path).ifBlank { "未绑定" }, mono = true)
            session.raw.nullableString("executorId")?.takeIf { it != "local" }?.let {
                InsetDivider(14)
                KeyValue("执行节点", it, mono = true)
            }
            session.raw.nullableString("nativeSessionId")?.let {
                InsetDivider(14)
                KeyValue("原生会话", it, mono = true)
            }
            InsetDivider(14)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 46.dp).clickable(onClick = onUsage).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Outlined.BarChart, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                Text("查看会话用量与费用", style = KooyuType.label, color = c.text, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
            }
        }
    }
    item("settings") { OverviewSettings(state, model, session, closeInspector) }
    item("queue") {
        val c = Kooyu.colors
        val scope = rememberCoroutineScope()
        InspectorGroup("指令队列") {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.commands.isEmpty()) Text("队列为空。", style = KooyuType.label, color = c.textSecondary)
                state.commands.forEach { command ->
                    val status = command.optString("state", command.optString("status"))
                    val cmdText = command.optJSONObject("input")?.optString("text") ?: command.optJSONObject("payload")?.optString("text") ?: command.optString("type")
                    val queued = status in listOf("queued", "pending", "accepted")
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusBadge(SessionStatus(status, if (queued) StatusTone.RUNNING else StatusTone.DONE), Modifier.weight(1f))
                            if (queued) {
                                TextButton(onClick = { scope.launch { model.execute("/sessions/" + session.id + "/commands/" + command.getString("id") + "/send") } }, enabled = state.canWrite) { Text("发送", color = c.text) }
                                TextButton(onClick = { editCommand(command, cmdText) }, enabled = state.canWrite) { Text("编辑", color = c.text) }
                                TextButton(onClick = { scope.launch { model.execute("/sessions/" + session.id + "/commands/" + command.getString("id"), "DELETE", null) } }, enabled = state.canWrite) { Text("撤回", color = c.destructive) }
                            }
                        }
                        Text(cmdText, style = KooyuType.label, color = c.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable private fun OverviewSettings(state: WorkbenchState, model: Workbench, session: HostSession, closeInspector: () -> Unit) {
    val c = Kooyu.colors
    var sheet by remember { mutableStateOf("") }
    var renameDraft by rememberSaveable(session.id) { mutableStateOf(session.title) }
    var settings by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var savedPulse by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId, session.id) {
        loading = true
        settings = model.read("/sessions/" + session.id + "/settings")
        loading = false
    }

    fun flashSaved() {
        savedPulse = true
        scope.launch { delay(1800); savedPulse = false }
    }

    val projectLabel = state.projects.firstOrNull { it.first == session.projectId }?.second ?: "全局会话"
    val wsLabel = state.workspaces.firstOrNull { it.id == session.workspaceId }?.let { formatWorkspaceLabel(it.path).ifBlank { it.path } } ?: "无工作目录"
    val permChoices = listOf("" to "引擎默认") + permissionChoices(session.harnessId)
    val curPerm = session.raw.nullableString("permissionMode").orEmpty()
    val permLabel = permChoices.firstOrNull { it.first == curPerm }?.second ?: "引擎默认"

    val curModel = session.model.orEmpty()
    val models = settings?.optJSONArray("models")?.objects() ?: emptyList()
    val modelLabel = models.firstOrNull { modelOptionId(session.harnessId, it) == curModel || it.optString("id") == curModel }?.optString("name")
        ?: curModel.substringAfterLast('/').ifBlank { "默认模型" }
    val curReasoning = session.raw.nullableString("reasoning").orEmpty()
    val levels = models.firstOrNull { modelOptionId(session.harnessId, it) == curModel || it.optString("id") == curModel }
        ?.optJSONArray("reasoning")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        InspectorGroup(
            title = "会话属性与参数",
            badge = {
                AnimatedVisibility(savedPulse, enter = fadeIn(KooyuMotion.snap()), exit = fadeOut(KooyuMotion.snap())) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        Icon(Icons.Outlined.Check, null, tint = c.doneText, modifier = Modifier.size(13.dp))
                        Text("已保存", style = KooyuType.caption, color = c.doneText)
                    }
                }
            }
        ) {
            InspectorActionRow("对话标题", session.title.ifBlank { "未命名会话" }, enabled = state.canWrite) {
                renameDraft = session.title
                sheet = "title"
            }
            InsetDivider(14)
            InspectorActionRow("项目范围", projectLabel, enabled = state.canWrite) { sheet = "project" }
            InsetDivider(14)
            InspectorActionRow("工作目录", wsLabel, enabled = state.canWrite) { sheet = "workspace" }
            InsetDivider(14)
            InspectorActionRow("工具权限", permLabel, enabled = state.canWrite) { sheet = "permission" }
            if (!loading && settings != null && settings!!.optString("modelSupport") != "native-only") {
                InsetDivider(14)
                InspectorActionRow("指定模型", modelLabel, enabled = state.canWrite) { sheet = "model" }
                if (levels.isNotEmpty()) {
                    InsetDivider(14)
                    InspectorActionRow("思考强度", curReasoning.ifBlank { "默认" }, enabled = state.canWrite) { sheet = "reasoning" }
                }
            }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)), color = c.brandCoral, trackColor = c.borderSubtle)
        if (state.error.isNotBlank()) Text(state.error, color = c.destructive, style = KooyuType.caption, modifier = Modifier.padding(horizontal = 4.dp))

        InspectorGroup("会话操作") {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = state.canWrite) {
                    scope.launch {
                        if (model.updateSession(session.id, JSONObject().put("archived", !session.archived)) != null) {
                            flashSaved()
                        }
                    }
                }.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(if (session.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, null, tint = c.textSecondary, modifier = Modifier.size(18.dp))
                Text(if (session.archived) "恢复会话" else "归档会话", style = KooyuType.rowTitle, fontWeight = FontWeight.Medium, color = c.text)
            }
            InsetDivider(42)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = state.canWrite) { deleting = true }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(Icons.Outlined.Delete, null, tint = c.destructive, modifier = Modifier.size(18.dp))
                Text("删除会话", style = KooyuType.rowTitle, fontWeight = FontWeight.Medium, color = c.destructive)
            }
        }
    }

    if (sheet == "title") {
        AlertDialog(
            onDismissRequest = { sheet = "" },
            shape = RoundedCornerShape(20.dp),
            containerColor = c.raised,
            title = { Text("重命名对话", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text) },
            text = {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart
                ) {
                    BasicTextField(
                        value = renameDraft,
                        onValueChange = { renameDraft = it.take(200) },
                        singleLine = true,
                        textStyle = KooyuType.body.copy(color = c.text),
                        cursorBrush = SolidColor(c.brandCoral),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            if (model.updateSession(session.id, JSONObject().put("title", renameDraft.trim())) != null) {
                                sheet = ""; flashSaved()
                            }
                        }
                    },
                    enabled = renameDraft.isNotBlank() && state.canWrite,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { sheet = "" }) { Text("取消", color = c.textSecondary) } }
        )
    }

    if (sheet == "project") {
        ComposerPicker(
            "项目范围",
            listOf(ComposerOption("", "全局会话")) + state.projects.map { ComposerOption(it.first, it.second) },
            session.projectId ?: "",
            { sheet = "" }
        ) { nextProj ->
            scope.launch {
                val body = JSONObject().put("projectId", nextProj.ifEmpty { null } ?: JSONObject.NULL)
                    .put("workspaceId", JSONObject.NULL)
                if (model.updateSession(session.id, body) != null) flashSaved()
                sheet = ""
            }
        }
    }

    if (sheet == "workspace") {
        val projFilter = session.projectId.orEmpty()
        val wsOptions = listOf(ComposerOption("", "无工作目录")) +
            state.workspaces.filter { projFilter.isEmpty() || it.projectId == projFilter }
                .map { ComposerOption(it.id, formatWorkspaceLabel(it.path), it.path) }
        ComposerPicker("工作目录", wsOptions, session.workspaceId ?: "", { sheet = "" }) { nextWs ->
            scope.launch {
                if (model.updateSession(session.id, JSONObject().put("workspaceId", nextWs.ifEmpty { null } ?: JSONObject.NULL)) != null) flashSaved()
                sheet = ""
            }
        }
    }

    if (sheet == "permission") {
        ComposerPicker(
            "工具权限模式",
            permChoices.map { ComposerOption(it.first, it.second) },
            curPerm,
            { sheet = "" }
        ) { nextPerm ->
            scope.launch {
                if (model.updateSession(session.id, JSONObject().put("permissionMode", nextPerm.ifEmpty { null } ?: JSONObject.NULL)) != null) flashSaved()
                sheet = ""
            }
        }
    }

    if (sheet == "model") {
        val mOptions = listOf(ComposerOption("", "默认模型")) +
            models.map { ComposerOption(modelOptionId(session.harnessId, it), it.optString("name", it.getString("id")), modelOptionId(session.harnessId, it)) }
        ComposerPicker("指定模型", mOptions, curModel, { sheet = "" }, searchable = true, custom = true) { nextModel ->
            scope.launch {
                val revision = settings?.optJSONObject("session")?.optInt("settingsRevision") ?: session.raw.optInt("settingsRevision")
                val body = JSONObject().put("expectedRevision", revision).put("model", nextModel.ifEmpty { null } ?: JSONObject.NULL).put("reasoning", JSONObject.NULL)
                if (model.execute("/sessions/" + session.id + "/settings", body = body) != null) {
                    settings = model.read("/sessions/" + session.id + "/settings")
                    flashSaved()
                }
                sheet = ""
            }
        }
    }

    if (sheet == "reasoning") {
        ComposerPicker(
            "思考强度",
            listOf(ComposerOption("", "默认")) + levels.map { ComposerOption(it, it) },
            curReasoning,
            { sheet = "" }
        ) { nextLevel ->
            scope.launch {
                val revision = settings?.optJSONObject("session")?.optInt("settingsRevision") ?: session.raw.optInt("settingsRevision")
                val body = JSONObject().put("expectedRevision", revision).put("model", curModel.ifEmpty { null } ?: JSONObject.NULL).put("reasoning", nextLevel.ifEmpty { null } ?: JSONObject.NULL)
                if (model.execute("/sessions/" + session.id + "/settings", body = body) != null) {
                    settings = model.read("/sessions/" + session.id + "/settings")
                    flashSaved()
                }
                sheet = ""
            }
        }
    }

    if (deleting) {
        ConfirmDialog("删除会话", "确认删除「" + session.title + "」？此操作无法撤销。", "删除", { deleting = false }) {
            scope.launch {
                if (model.deleteSession(session.id)) {
                    deleting = false
                    closeInspector()
                }
            }
        }
    }
}

private fun LazyListScope.filesTab(state: WorkbenchState, model: Workbench, session: HostSession, browse: () -> Unit) {
    val tools = state.transcript.rows.filter { it.role == RowRole.TOOL }
    val workspace = state.workspaces.firstOrNull { it.id == session.workspaceId }
    item("workspace") {
        val c = Kooyu.colors
        InspectorGroup("工作区") {
            KeyValue("目录", formatWorkspaceLabel(workspace?.path).ifBlank { "未绑定" }, mono = true)
            if (workspace != null) {
                InsetDivider(14)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 46.dp).clickable(onClick = browse).padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(Icons.Outlined.FolderOpen, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                    Text("浏览文件与 Git 变更", style = KooyuType.label, color = c.text, modifier = Modifier.weight(1f))
                    Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
    if (workspace != null) {
        item("git-delivery") {
            GitDeliveryInspector(workspace, state, model)
        }
    }
    item("tools-header") {
        Text("工具调用 · ${tools.size}", style = KooyuType.sectionHeader, color = Kooyu.colors.textTertiary, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
    }
    if (tools.isEmpty()) item("tools-empty") { Text("本次已加载的记录中没有工具调用。", style = KooyuType.label, color = Kooyu.colors.textSecondary, modifier = Modifier.padding(start = 4.dp)) }
    items(tools.reversed(), key = { "tool:" + it.id }) { row -> ToolCard(row) }
}

@Composable private fun GitDeliveryInspector(workspace: HostWorkspace, state: WorkbenchState, model: Workbench) {
    val c = Kooyu.colors
    val scope = rememberCoroutineScope()
    val base = "/workspaces/" + workspace.id
    var expanded by remember(workspace.id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }
    var message by remember(workspace.id) { mutableStateOf("") }
    var files by remember(workspace.id) { mutableStateOf(emptyList<JSONObject>()) }
    var branches by remember(workspace.id) { mutableStateOf(emptyList<JSONObject>()) }
    var isGit by remember(workspace.id) { mutableStateOf(true) }
    var confirmDiscardPath by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        val changes = model.read("$base/changes")
        isGit = changes?.optBoolean("git", false) ?: false
        files = changes?.optJSONArray("files")?.objects().orEmpty()
        branches = model.readArray("$base/git/branches")
    }

    LaunchedEffect(expanded, workspace.id) {
        if (expanded) reload()
    }

    fun runGit(action: String, body: JSONObject = JSONObject()) {
        scope.launch {
            busy = true
            feedback = ""
            isError = false
            try {
                val res = model.execute("$base/git/$action", "POST", body)
                if (res == null) {
                    isError = true
                    feedback = model.state.value.error.ifBlank { "Git 操作失败" }
                } else if (action == "suggest-message") {
                    message = res.optString("message", message)
                } else if (action == "pr") {
                    feedback = res.optString("url", "PR 已创建")
                    reload()
                } else {
                    feedback = "操作已完成"
                    reload()
                }
            } finally {
                busy = false
            }
        }
    }

    InspectorGroup("Git 交付") {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 46.dp)
                .clickable { expanded = !expanded }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(Icons.Outlined.AccountTree, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
            Text(
                if (expanded) "收起 Git 交付面板" else "暂存 · 提交 · Worktree 合入 · PR",
                style = KooyuType.label,
                color = c.text,
                modifier = Modifier.weight(1f)
            )
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                null,
                tint = c.textTertiary,
                modifier = Modifier.size(18.dp)
            )
        }
        AnimatedVisibility(expanded) {
            Column(
                Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                InsetDivider(0)
                if (!isGit) {
                    Text("当前目录不是可读取的 Git 仓库。", style = KooyuType.caption, color = c.textSecondary)
                } else {
                    if (branches.isNotEmpty()) {
                        Text("可合入分支", style = KooyuType.sectionHeader, color = c.textTertiary)
                        branches.forEach { wt ->
                            val wtId = wt.optString("workspaceId")
                            val branchName = wt.optString("branchName")
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(branchName, style = KooyuType.mono, fontSize = 11.5.sp, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                OutlinedButton(
                                    enabled = state.canWrite && !busy,
                                    onClick = { runGit("merge", JSONObject().put("worktreeId", wtId).put("mode", "ff")) },
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                ) { Text("快进", fontSize = 11.sp, color = c.text) }
                                OutlinedButton(
                                    enabled = state.canWrite && !busy,
                                    onClick = { runGit("merge", JSONObject().put("worktreeId", wtId).put("mode", "squash")) },
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                ) { Text("压缩", fontSize = 11.sp, color = c.text) }
                            }
                        }
                    }

                    if (files.isNotEmpty()) {
                        Text("变更文件 (${files.size})", style = KooyuType.sectionHeader, color = c.textTertiary)
                        files.take(12).forEach { f ->
                            val filePath = f.optString("path")
                            val status = f.optString("status")
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(c.sunken)
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text("$status · $filePath", style = KooyuType.mono, fontSize = 11.5.sp, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Row(
                                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    TextButton(
                                        enabled = state.canWrite && !busy,
                                        onClick = { runGit("stage", JSONObject().put("path", filePath)) },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                    ) { Text("暂存", fontSize = 11.5.sp, color = c.text) }
                                    TextButton(
                                        enabled = state.canWrite && !busy,
                                        onClick = { runGit("unstage", JSONObject().put("path", filePath)) },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                    ) { Text("取消暂存", fontSize = 11.5.sp, color = c.textSecondary) }
                                    if (status != "untracked") {
                                        TextButton(
                                            enabled = state.canWrite && !busy,
                                            onClick = { confirmDiscardPath = filePath },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                        ) { Text("丢弃", fontSize = 11.5.sp, color = c.destructive) }
                                    }
                                }
                            }
                        }
                    } else {
                        Text("当前没有未提交改动。", style = KooyuType.caption, color = c.textSecondary)
                    }

                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("提交说明 / PR 标题", style = KooyuType.sectionHeader, color = c.textTertiary, modifier = Modifier.weight(1f))
                        TextButton(
                            enabled = state.canWrite && !busy,
                            onClick = { runGit("suggest-message") },
                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
                        ) { Text("智能生成", fontSize = 11.5.sp, color = c.brandCoral) }
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(c.sunken)
                            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(10.dp))
                            .padding(horizontal = 10.dp, vertical = 10.dp)
                    ) {
                        if (message.isEmpty()) Text("输入提交说明或 PR 标题…", style = KooyuType.label, color = c.textTertiary)
                        BasicTextField(
                            value = message,
                            onValueChange = { message = it },
                            textStyle = KooyuType.label.copy(color = c.text),
                            cursorBrush = SolidColor(c.brandCoral),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            enabled = state.canWrite && !busy && message.isNotBlank(),
                            onClick = { runGit("commit", JSONObject().put("message", message.trim())) },
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                            modifier = Modifier.weight(1f)
                        ) { Text("提交暂存", fontSize = 12.5.sp) }
                        OutlinedButton(
                            enabled = state.canWrite && !busy && message.isNotBlank(),
                            onClick = { runGit("pr", JSONObject().put("title", message.trim()).put("body", "")) },
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.weight(1f)
                        ) { Text("推送建 PR", fontSize = 12.5.sp, color = c.text) }
                    }
                    if (feedback.isNotBlank()) {
                        Text(feedback, fontSize = 12.sp, color = if (isError) c.destructive else c.doneText)
                    }
                }
            }
        }
    }

    confirmDiscardPath?.let { target ->
        ConfirmDialog(
            "丢弃文件改动？",
            "将还原「$target」到上次提交状态，未提交内容会丢失。",
            "确认丢弃",
            { confirmDiscardPath = null }
        ) {
            confirmDiscardPath = null
            runGit("discard-file", JSONObject().put("path", target).put("confirmed", true))
        }
    }
}

private fun LazyListScope.branchesTab(state: WorkbenchState, session: HostSession, fork: (TranscriptRow) -> Unit, edit: (TranscriptRow) -> Unit) {
    val conversation = session.raw.optJSONObject("conversation")
    val branches = conversation?.optJSONArray("branches")?.objects().orEmpty()
    val messages = state.transcript.rows.filter { it.role == RowRole.USER && it.eventIds.isNotEmpty() }
    item("branch-summary") {
        InspectorGroup("分支") {
            KeyValue("消息分支", if (branches.isEmpty()) "仅主线" else "${branches.size} 个分支")
            conversation?.nullableString("activeId")?.let {
                InsetDivider(14)
                KeyValue("当前分支", it.take(12), mono = true)
            }
            InsetDivider(14)
            Text(
                "从任意一条你发送的消息分叉，会在新会话中保留此前的上下文；编辑重发会替换该条消息。",
                style = KooyuType.caption,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = Kooyu.colors.textTertiary,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
            )
        }
    }
    item("branch-header") {
        Text("你的消息 · ${messages.size}", style = KooyuType.sectionHeader, color = Kooyu.colors.textTertiary, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
    }
    if (messages.isEmpty()) item("branch-empty") { Text("暂无可分叉的消息。", style = KooyuType.label, color = Kooyu.colors.textSecondary, modifier = Modifier.padding(start = 4.dp)) }
    items(messages.reversed(), key = { "branch:" + it.id }) { row ->
        val c = Kooyu.colors
        InsetGroupCard {
            Column(Modifier.padding(start = 14.dp, end = 6.dp, top = 12.dp, bottom = 4.dp)) {
                Text(row.text, style = KooyuType.label, color = c.text, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(relativeTime(row.createdAt), style = KooyuType.caption, color = c.textTertiary, modifier = Modifier.weight(1f))
                    TextButton(onClick = { fork(row) }, enabled = state.canWrite) { Text("从此处分叉", color = c.text) }
                    TextButton(onClick = { edit(row) }, enabled = state.canWrite) { Text("编辑重发", color = c.text) }
                }
            }
        }
    }
}

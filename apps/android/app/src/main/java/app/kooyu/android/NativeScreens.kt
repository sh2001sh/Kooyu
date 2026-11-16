package app.kooyu.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ChoiceField(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    enabled: Boolean = true,
    choose: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val displayValue = options.firstOrNull { it.first == value }?.second ?: value.ifBlank { "未选择" }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        if (label.isNotBlank()) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { if (enabled) expanded = it },
            modifier = Modifier.fillMaxWidth()
        ) {
            Surface(
                shape = RoundedCornerShape(9.dp),
                color = if (expanded) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceContainerLow,
                border = androidx.compose.foundation.BorderStroke(
                    if (expanded) 1.5.dp else 1.dp,
                    if (expanded) MaterialTheme.colorScheme.outline.copy(alpha = 0.8f)
                    else MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)
                ),
                modifier = Modifier
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = enabled)
                    .fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 38.dp)
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = displayValue,
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.Normal
                        ),
                        color = if (displayValue == "未选择" || displayValue.isEmpty())
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        else MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    Spacer(Modifier.width(8.dp))
                    Icon(
                        imageVector = Icons.Outlined.ExpandMore,
                        contentDescription = null,
                        modifier = Modifier
                            .size(15.dp)
                            .rotate(if (expanded) 180f else 0f),
                        tint = if (expanded) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f)
                    )
                }
            }
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                modifier = Modifier
                    .exposedDropdownSize()
                    .background(
                        color = MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(12.dp)
                    )
                    .border(
                        1.dp,
                        MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
                        RoundedCornerShape(12.dp)
                    )
            ) {
                Column(
                    modifier = Modifier
                        .padding(5.dp)
                        .fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    options.forEach { (id, name) ->
                        val isSelected = id == value
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSelected) MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { choose(id); expanded = false }
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 10.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = name,
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontSize = 13.sp,
                                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal
                                    ),
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false)
                                )
                                if (isSelected) {
                                    Spacer(Modifier.width(8.dp))
                                    Icon(
                                        imageVector = Icons.Outlined.Check,
                                        contentDescription = null,
                                        modifier = Modifier.size(14.dp),
                                        tint = MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun FullScreenPage(
    title: String,
    close: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit
) {
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Text(title, fontWeight = FontWeight.Bold) },
                        navigationIcon = {
                            IconButton(onClick = close) {
                                Icon(Icons.Outlined.Close, "关闭")
                            }
                        },
                        actions = actions,
                        colors = TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface
                        )
                    )
                },
                content = content
            )
        }
    }
}

@Composable fun DevicesScreen(state: WorkbenchState, model: Workbench) {
    var renaming by remember { mutableStateOf<Connection?>(null) }
    var removing by remember { mutableStateOf<Connection?>(null) }
    var name by remember { mutableStateOf("") }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Button(
            onClick = { model.addDevice(true) },
            enabled = !state.busy,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Outlined.Add, null)
            Spacer(Modifier.width(8.dp))
            Text("添加设备")
        }

        Text("已保存设备", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)

        state.connections.forEach { c ->
            val isCurrent = c.hostId == state.connection?.hostId
            Card(
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (isCurrent) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f)
                                     else MaterialTheme.colorScheme.surfaceContainer
                ),
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.Computer, null, tint = MaterialTheme.colorScheme.primary)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(if (isCurrent && state.online) Color(0xFF30A46C) else Color(0xFF888890))
                                )
                                Text(
                                    if (isCurrent) (if (state.online) "当前设备 · 在线" else "当前设备 · 离线") else "已保存",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                if (c.pending != null) {
                                    Text("· 操作待核对", style = MaterialTheme.typography.bodySmall, color = Color(0xFFF76808))
                                }
                            }
                        }
                        if (!isCurrent) {
                            FilledTonalButton(
                                onClick = { model.switchDevice(c.hostId) },
                                enabled = !state.busy,
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Text("切换")
                            }
                        }
                    }

                    BackgroundReminderSettings(c)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
                    ) {
                        TextButton(onClick = { renaming = c; name = c.name }, enabled = !state.busy) {
                            Text("重命名")
                        }
                        TextButton(
                            onClick = { removing = c },
                            enabled = !state.busy,
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                        ) {
                            Text("移除连接")
                        }
                    }
                }
            }
        }


    }

    if (renaming != null) {
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("重命名设备") },
            text = {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(60) },
                    label = { Text("设备名称") },
                    placeholder = { Text("例如：工作站、MacBook") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp)
                )
            },
            confirmButton = {
                Button(
                    onClick = { model.renameDevice(renaming!!.hostId, name); renaming = null },
                    enabled = name.isNotBlank()
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("取消") } }
        )
    }

    removing?.let { c ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("移除「${c.name}」？") },
            text = {
                Text(if (c.pending != null) "这台设备还有结果待核对的操作。移除后将失去本机核对标记，运行中的任务不会停止。" else "从手机中清除此设备连接，设备上的任务不会停止。")
            },
            confirmButton = {
                Button(
                    onClick = { model.removeDevice(c.hostId); removing = null },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("移除") }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("取消") } }
        )
    }
}

@Composable private fun BackgroundReminderSettings(connection: Connection) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val statuses by BackgroundReminders.status.collectAsStateWithLifecycle()
    val status = statuses[BackgroundReminders.key(connection)]
    var enabled by remember(connection.hostId, connection.deviceId, status) { mutableStateOf(BackgroundReminders.isEnabled(context, connection)) }
    var working by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { BackgroundReminders.enable(context, connection); enabled = BackgroundReminders.isEnabled(context, connection) }
        else BackgroundReminders.message(BackgroundReminders.key(connection), "通知权限未获允许，请在系统设置中开启。")
    }
    HorizontalDivider()
    Text("后台事项提醒", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
    if (status != null) {
        Text(status!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = {
            if (android.os.Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) permission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            else { BackgroundReminders.enable(context, connection); enabled = BackgroundReminders.isEnabled(context, connection) }
        }, enabled = !working) { Text(if (enabled) "重新连接" else "开启后台提醒") }
        if (enabled) TextButton(onClick = { working = true; scope.launch { try { BackgroundReminders.disable(context, connection); enabled = false } finally { working = false } } }, enabled = !working) { Text("关闭提醒") }
        if (working) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
    }
}

@Composable fun SessionComposer(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var first by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf("") }
    var workspace by rememberSaveable { mutableStateOf("") }
    var harness by rememberSaveable { mutableStateOf(state.harnesses.firstOrNull { it.id == "kodo" }?.id ?: state.harnesses.firstOrNull()?.id ?: "kodo") }
    var kind by rememberSaveable { mutableStateOf("supervisor") }
    var choice by rememberSaveable { mutableStateOf("inherit") }
    var customModel by rememberSaveable { mutableStateOf("") }
    var reasoning by rememberSaveable { mutableStateOf("") }
    var permission by rememberSaveable { mutableStateOf("") }
    var catalog by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(false) }

    var showAdvanced by rememberSaveable { mutableStateOf(false) }

    val descriptor = state.harnesses.firstOrNull { it.id == harness }
    val profiles = state.bindings.filter { it.optString("harnessId") == harness && !it.optBoolean("archived") }
    val projectRaw = state.snapshot.optJSONArray("projects")?.objects()?.firstOrNull { it.optString("id") == project }
    val projectDefault = projectRaw?.optJSONObject("bindingDefaults")?.nullableString(harness)
    val inherited = projectDefault ?: state.snapshot.optJSONObject("bindingDefaults")?.optJSONObject("harnessBindingIds")?.nullableString(harness)
    val draft = SessionDraft(title, harness, kind, project.ifEmpty { null }, workspace.ifEmpty { null }, choice, customModel, reasoning, permission, first)
    val validation = draft.validation(descriptor, state.workspaces, inherited != null)

    LaunchedEffect(state.connection?.hostId, harness) {
        loading = true
        catalog = null
        catalog = model.read("/harnesses/" + encoded(harness) + "/models")
        loading = false
    }

    FullScreenPage("新建对话", close, actions = {
        Button(
            onClick = { scope.launch { if (model.create(draft)) close() } },
            enabled = state.canWrite && validation == null,
            shape = RoundedCornerShape(10.dp)
        ) {
            Text(if (first.isBlank()) "创建" else "发送")
        }
    }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            OutlinedTextField(
                value = first,
                onValueChange = { first = it },
                label = { Text("消息") },
                minLines = 4,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = title,
                onValueChange = { title = it.take(200) },
                label = { Text("对话标题") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )

            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surfaceContainer,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showAdvanced = !showAdvanced }
            ) {
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("环境与模型配置", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Icon(if (showAdvanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null)
                }
            }

            AnimatedVisibility(visible = showAdvanced) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("项目与目录", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                            ChoiceField("所属项目", project, listOf("" to "全局会话") + state.projects) { project = it; workspace = "" }
                            ChoiceField("工作目录", workspace, listOf("" to "未绑定目录") + state.workspaces.filter { project.isEmpty() || it.projectId == project }.map { it.id to it.path }) { workspace = it }
                        }
                    }

                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("执行引擎与模型", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                            ChoiceField("执行引擎", harness, state.harnesses.map { it.id to it.name }) {
                                harness = it; choice = "inherit"; customModel = ""; reasoning = ""; permission = ""
                            }
                            if (harness == "kodo") {
                                ChoiceField("对话类型", kind, listOf("supervisor" to "Kooyu 主对话", "direct" to "直接对话")) { kind = it }
                            }

                            if (descriptor?.modelSupport != "native-only") {
                                val choices = listOf("inherit" to "默认配置") +
                                        (if (descriptor?.modelSupport == "binding-required") emptyList() else listOf("native" to "原生默认", "model" to "指定模型")) +
                                        profiles.map { "binding:" + it.getString("id") to it.optString("name", it.optString("model")) }
                                ChoiceField("模型来源", choice, choices) { choice = it; reasoning = "" }

                                if (choice == "model") {
                                    val models = catalog?.optJSONArray("models")?.objects() ?: descriptor?.raw?.optJSONArray("models")?.objects() ?: emptyList()
                                    if (models.isNotEmpty()) {
                                        ChoiceField("可用模型", customModel, listOf("" to "选择模型") + models.map { modelOptionId(harness, it) to it.optString("name", it.getString("id")) }) {
                                            customModel = it; reasoning = ""
                                        }
                                    }
                                    OutlinedTextField(
                                        value = customModel,
                                        onValueChange = { customModel = it },
                                        label = { Text("Model ID") },
                                        singleLine = true,
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.fillMaxWidth()
                                    )
                                    val levels = models.firstOrNull { modelOptionId(harness, it) == customModel || it.optString("id") == customModel }?.optJSONArray("reasoning")?.let { array -> (0 until array.length()).map { array.getString(it) } } ?: emptyList()
                                    if (levels.isNotEmpty()) {
                                        ChoiceField("思考强度", reasoning, listOf("" to "默认") + levels.map { it to it }) { reasoning = it }
                                    }
                                }
                            }

                            val permissions = permissionChoices(harness)
                            if (permissions.isNotEmpty()) {
                                ChoiceField("权限模式", permission, listOf("" to "默认权限") + permissions) { permission = it }
                            }
                        }
                    }
                }
            }

            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

            if (validation != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(validation, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }
            if (state.error.isNotBlank()) {
                Text(state.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

fun permissionChoices(harness: String): List<Pair<String, String>> = when (harness) {
    "codex" -> listOf("read-only" to "只读", "workspace-write" to "工作区写入", "full-access" to "完全访问")
    "claude-code" -> listOf("accept-edits" to "自动接受编辑", "bypass-permissions" to "跳过审批")
    "kodo", "pi" -> listOf("kodo-tools-read" to "仅阅读工具", "kodo-tools-none" to "禁用工具")
    "zcode" -> listOf("plan" to "Plan", "build" to "Build", "edit" to "Edit", "guarded" to "Guarded", "yolo" to "YOLO")
    "kimi-code" -> listOf("kimi:manual" to "逐项审批", "kimi:auto" to "自动判断", "kimi:yolo" to "跳过审批")
    "opencode" -> listOf("opencode-ask" to "逐次审批", "opencode-deny" to "禁用工具", "opencode-allow" to "允许工具")
    else -> emptyList()
}

fun number(value: Double) = String.format(Locale.US, "%,.0f", value)
fun money(value: Double?) = value?.let { String.format(Locale.US, "$%.4f", it) } ?: "—"

@Composable fun MetricCard(title: String, value: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable fun UsageScreen(state: WorkbenchState, model: Workbench, sessionId: String? = null) {
    var days by rememberSaveable(state.connection?.hostId) { mutableIntStateOf(14) }
    var project by rememberSaveable(state.connection?.hostId) { mutableStateOf("") }
    var source by rememberSaveable(state.connection?.hostId) { mutableStateOf("") }
    var scopeFilter by rememberSaveable { mutableStateOf("all") }
    var limit by rememberSaveable { mutableIntStateOf(50) }
    var budget by remember { mutableStateOf(false) }
    var usd by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId) {
        while (true) { model.refreshUsage(); delay(10000) }
    }

    val records = filterUsage(state.usage?.records ?: emptyList(), UsageFilter(days.takeIf { it > 0 }, project.ifEmpty { null }, source.ifEmpty { null }, sessionId, scopeFilter))
    val known = records.mapNotNull { it.costUsd }
    val input = records.mapNotNull { it.input }.sum()
    val output = records.mapNotNull { it.output }.sum()
    val read = records.mapNotNull { it.cacheRead }.sum()
    val write = records.mapNotNull { it.cacheWrite }.sum()

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("用量与预算", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(Modifier.weight(1f)) {
                        ChoiceField("时间范围", days.toString(), listOf("7" to "最近 7 天", "14" to "最近 14 天", "30" to "最近 30 天", "0" to "全部")) { days = it.toInt() }
                    }
                    Box(Modifier.weight(1f)) {
                        ChoiceField("项目", project, listOf("" to "全部项目") + state.projects) { project = it }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(Modifier.weight(1f)) {
                        ChoiceField("执行引擎", source, listOf("" to "全部引擎") + (state.usage?.records?.map { it.source }?.distinct()?.map { it to (state.harnesses.firstOrNull { h -> h.id == it }?.name ?: it) } ?: emptyList())) { source = it }
                    }
                    Box(Modifier.weight(1f)) {
                        ChoiceField("统计口径", scopeFilter, listOf("all" to "全部 (去重)", "turn" to "按轮次", "session" to "会话快照")) { scopeFilter = it }
                    }
                }
            }
        }

        if (state.usageLoading && state.usage == null) {
            item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        }

        if (state.usageError.isNotEmpty()) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(state.usageError, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { model.refreshUsage() } }) { Text("重试") }
                    }
                }
            }
        }

        if (state.usage != null) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        MetricCard(
                            title = "已报告总费用",
                            value = if (known.isEmpty()) "未报告" else money(known.sum()) + " USD",
                            subtitle = "实际 ${records.count { it.costKind == "actual" }} 笔 · 估算 ${records.count { it.costKind == "estimate" }} 笔",
                            modifier = Modifier.weight(1f)
                        )
                        MetricCard(
                            title = "Token 总消耗",
                            value = number(input + output + read + write),
                            subtitle = "输入 ${number(input)} · 输出 ${number(output)}",
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        MetricCard(
                            title = "缓存读取",
                            value = number(read),
                            subtitle = "已省去推理输入",
                            modifier = Modifier.weight(1f)
                        )
                        MetricCard(
                            title = "缓存写入",
                            value = number(write),
                            subtitle = "已建立上下文缓存",
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            item {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("每日费用趋势", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        val buckets = records.filter { it.costUsd != null }.groupBy { it.createdAt.take(10) }.toSortedMap().values.map { day -> day.mapNotNull { it.costUsd }.sum() }
                        val primaryColor = MaterialTheme.colorScheme.primary

                        if (buckets.isEmpty()) {
                            Text("无记录", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Canvas(Modifier.fillMaxWidth().height(120.dp).padding(vertical = 8.dp)) {
                                val max = buckets.maxOrNull()?.takeIf { it > 0 } ?: 1.0
                                val step = size.width / buckets.size
                                val barWidth = (step * 0.65f).coerceAtMost(28.dp.toPx())
                                buckets.forEachIndexed { i, value ->
                                    val height = ((size.height - 10.dp.toPx()) * (value / max)).toFloat().coerceAtLeast(4.dp.toPx())
                                    val left = i * step + (step - barWidth) / 2
                                    val top = size.height - height
                                    drawRoundRect(
                                        color = primaryColor,
                                        topLeft = Offset(left, top),
                                        size = Size(barWidth, height),
                                        cornerRadius = CornerRadius(4.dp.toPx(), 4.dp.toPx())
                                    )
                                }
                            }
                        }
                    }
                }
            }

            item {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("项目与绑定预算", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            FilledTonalButton(
                                onClick = { budget = true },
                                enabled = state.canWrite,
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Text("设置预算")
                            }
                        }

                        if (state.usage.budgets.isEmpty()) {
                            Text("暂未配置项目预算。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            state.usage.budgets.forEach { b ->
                                val projectId = b.nullableString("projectId")
                                val spent = filterUsage(state.usage.records, UsageFilter(days = null, projectId = projectId)).mapNotNull { it.costUsd }.sum()
                                val budgetUsd = b.nullableNumber("usd") ?: 0.0
                                val ratio = if (budgetUsd > 0) (spent / budgetUsd).toFloat().coerceIn(0f, 1f) else 0f

                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text(
                                            state.projects.firstOrNull { it.first == projectId }?.second ?: if (projectId == null) "全局预算" else "项目预算",
                                            fontWeight = FontWeight.SemiBold
                                        )
                                        Text("${money(spent)} / ${money(budgetUsd)} USD", style = MaterialTheme.typography.bodySmall)
                                    }
                                    LinearProgressIndicator(
                                        progress = { ratio },
                                        color = if (ratio > 0.9f) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp))
                                    )
                                }
                            }
                        }
                    }
                }
            }

            item {
                Text("用量明细 (${records.size} 笔)", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }

            items(records.sortedByDescending { it.createdAt }.take(limit), key = { "usage-" + it.id }) { r ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(r.model ?: r.source, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleSmall)
                            Text(money(r.costUsd), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(r.createdAt.take(19).replace('T', ' '), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                "输入 ${r.input?.let(::number) ?: "—"} / 输出 ${r.output?.let(::number) ?: "—"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            if (records.size > limit) {
                item {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        TextButton(onClick = { limit += 100 }) {
                            Text("加载更多明细…")
                        }
                    }
                }
            }
        }
    }

    if (budget) {
        AlertDialog(
            onDismissRequest = { budget = false },
            title = { Text("设置预算 (USD)") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ChoiceField("选择项目", project, listOf("" to "请选择项目") + state.projects) { project = it }
                    OutlinedTextField(
                        value = usd,
                        onValueChange = { usd = it },
                        label = { Text("限额 (USD)") },
                        placeholder = { Text("例如：50.00") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            if (model.saveBudget(project.ifEmpty { null }, usd.toDouble())) {
                                budget = false; usd = ""
                            }
                        }
                    },
                    enabled = state.canWrite && project.isNotEmpty() && (usd.toDoubleOrNull() ?: 0.0) > 0
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { budget = false }) { Text("取消") } }
        )
    }
}

@Composable fun ProjectsScreen(state: WorkbenchState, model: Workbench) {
    val scope = rememberCoroutineScope()
    var adding by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var root by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<Pair<String, String>?>(null) }
    var deleting by remember { mutableStateOf<Pair<String, String>?>(null) }
    var addWorkspace by remember { mutableStateOf<String?>(null) }
    var browser by remember { mutableStateOf<HostWorkspace?>(null) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("项目与工作目录", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                FilledTonalButton(
                    onClick = { name = ""; root = ""; adding = true },
                    enabled = state.canWrite,
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(Icons.Outlined.CreateNewFolder, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("新建项目")
                }
            }
        }

        if (state.projects.isEmpty()) {
            item {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Outlined.Folder, null, modifier = Modifier.size(44.dp), tint = MaterialTheme.colorScheme.outline)
                        Text("暂无项目", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        items(state.projects, key = { it.first }) { project ->
            val projectWorkspaces = state.workspaces.filter { it.projectId == project.first }
            val count = state.sessions.count { it.projectId == project.first && !it.archived }

            Card(
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Folder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(project.second, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("$count 个进行中会话", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    if (projectWorkspaces.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            projectWorkspaces.forEach { workspace ->
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { browser = workspace }
                                ) {
                                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Outlined.FolderOpen, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.secondary)
                                        Spacer(Modifier.width(8.dp))
                                        Text(workspace.path, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                        Icon(Icons.Outlined.ChevronRight, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.outline)
                                    }
                                }
                            }
                        }
                    }

                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                        TextButton(onClick = { addWorkspace = project.first; root = "" }, enabled = state.canWrite) {
                            Text("添加目录")
                        }
                        TextButton(onClick = { editing = project; name = project.second }, enabled = state.canWrite) {
                            Text("重命名")
                        }
                        TextButton(
                            onClick = { deleting = project },
                            enabled = state.canWrite,
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                        ) {
                            Text("删除")
                        }
                    }
                }
            }
        }

        item {
            Text("全局工作位置", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
        }

        items(state.workspaces.filter { it.projectId == null }, key = { it.id }) { workspace ->
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.surfaceContainer,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { browser = workspace }
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.FolderOpen, null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(workspace.path, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(18.dp))
                }
            }
        }

        item {
            OutlinedButton(
                onClick = { addWorkspace = ""; root = "" },
                enabled = state.canWrite,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Outlined.Add, null)
                Spacer(Modifier.width(6.dp))
                Text("添加全局目录")
            }
        }
    }

    if (adding || editing != null || addWorkspace != null) {
        AlertDialog(
            onDismissRequest = { adding = false; editing = null; addWorkspace = null },
            title = { Text(if (addWorkspace != null) "添加设备上的工作目录" else if (editing != null) "重命名项目" else "新建项目") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (addWorkspace == null) {
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it.take(100) },
                            label = { Text("项目名称") },
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    if (editing == null) {
                        OutlinedTextField(
                            value = root,
                            onValueChange = { root = it },
                            label = { Text("设备绝对路径") },
                            placeholder = { Text("/workspace/project") },
                            supportingText = { Text(if (addWorkspace == null) "可留空，稍后添加工作位置" else "目录必须在当前设备上已存在") },
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            val result = when {
                                addWorkspace != null -> model.execute("/workspaces", body = JSONObject().put("projectId", addWorkspace?.ifEmpty { null } ?: JSONObject.NULL).put("rootPath", root.trim()))
                                editing != null -> model.execute("/projects/" + editing!!.first, "PATCH", JSONObject().put("name", name.trim()))
                                else -> model.execute("/projects", body = JSONObject().put("name", name.trim()).apply { if (root.isNotBlank()) put("rootPath", root.trim()) })
                            }
                            if (result != null) { adding = false; editing = null; addWorkspace = null }
                        }
                    },
                    enabled = state.canWrite && if (addWorkspace != null) root.isNotBlank() else name.isNotBlank()
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { adding = false; editing = null; addWorkspace = null }) { Text("取消") } }
        )
    }

    deleting?.let { project ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除项目「${project.second}」？") },
            text = { Text("关联会话将移至全局。") },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            if (model.execute("/projects/" + project.first + "?sessions=keep", "DELETE", null) != null) deleting = null
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("删除项目") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }
        )
    }

    browser?.let { workspace ->
        FullScreenPage("工作区文件", { browser = null }) { padding ->
            Box(Modifier.padding(padding)) { WorkspaceBrowser(workspace, state, model) }
        }
    }
}

@Composable fun WorkspaceBrowser(workspace: HostWorkspace, state: WorkbenchState, model: Workbench) {
    var path by remember { mutableStateOf("") }
    var changes by remember { mutableStateOf(false) }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var requestedFile by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    LaunchedEffect(state.connection?.hostId, workspace.id, path, changes, requestedFile) {
        loading = true
        data = null
        preview = null
        val base = "/workspaces/" + workspace.id
        if (requestedFile != null) {
            preview = model.read(base + if (changes) "/changes/diff?path=" + encoded(requestedFile!!) else "/files/preview?path=" + encoded(requestedFile!!))
        } else {
            data = model.read(base + if (changes) "/changes" else "/files?path=" + encoded(path))
        }
        loading = false
    }

    Column(Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainer,
            border = androidx.compose.foundation.BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(workspace.path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = !changes,
                        onClick = { changes = false; requestedFile = null },
                        label = { Text("文件列表") },
                        shape = RoundedCornerShape(8.dp)
                    )
                    FilterChip(
                        selected = changes,
                        onClick = { changes = true; requestedFile = null },
                        label = { Text("Git 变更") },
                        shape = RoundedCornerShape(8.dp)
                    )
                }
            }
        }

        if (requestedFile != null) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { requestedFile = null }) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回列表")
                    }
                    Text(requestedFile!!, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        } else if (path.isNotEmpty() && !changes) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp)
            ) {
                TextButton(onClick = { path = path.substringBeforeLast('/', "") }) {
                    Icon(Icons.Outlined.ArrowUpward, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("返回上一级目录")
                }
            }
        }

        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            preview?.let { value ->
                item {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        SelectionContainer {
                            Text(
                                value.nullableString("text") ?: value.nullableString("reason") ?: "此文件为二进制内容，暂不能作为文本查看。",
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }
                }
            }

            val entries = (data?.optJSONArray(if (changes) "files" else "entries")?.objects() ?: emptyList())
            if (!loading && requestedFile == null && entries.isEmpty()) {
                item {
                    Text(data?.nullableString("error") ?: "暂无文件或变更。", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
                }
            }

            items(entries, key = { it.getString("path") }) { entry ->
                val isDir = entry.optString("kind") == "directory"
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (isDir) path = entry.getString("path")
                            else requestedFile = entry.getString("path")
                        }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (isDir) Icons.Outlined.Folder else Icons.AutoMirrored.Outlined.InsertDriveFile,
                            null,
                            tint = if (isDir) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            entry.optString("name", entry.getString("path")),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (isDir) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (changes) {
                            val status = entry.optString("status")
                            Surface(
                                color = MaterialTheme.colorScheme.primaryContainer,
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    status,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TagChip(text: String) {
    Surface(
        color = if (Kooyu.colors.dark) Color(0xFF2A2320) else Color(0xFFFBF2EE),
        shape = RoundedCornerShape(6.dp)
    ) {
        Text(
            text = text,
            color = if (Kooyu.colors.dark) Color(0xFFFFB29D) else Color(0xFF9E543C),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String? = null,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = Kooyu.colors.text,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(14.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = Kooyu.colors.text,
            fontWeight = FontWeight.Normal,
            modifier = Modifier.weight(1f)
        )
        if (detail != null) {
            Text(
                text = detail,
                style = MaterialTheme.typography.bodyMedium,
                color = Kooyu.colors.textSecondary
            )
            Spacer(modifier = Modifier.width(6.dp))
        }
        Icon(
            imageVector = Icons.Outlined.ChevronRight,
            contentDescription = null,
            tint = Kooyu.colors.textTertiary,
            modifier = Modifier.size(16.dp)
        )
    }
}

@Composable fun SettingsScreen(state: WorkbenchState, model: Workbench) {
    val context = LocalContext.current
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    var showDeleteDeviceDialog by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf<JSONObject?>(null) }
    var instructions by remember { mutableStateOf("") }
    var defaultHarness by remember { mutableStateOf("kodo") }
    var failure by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId, detail) {
        if (detail == "general") {
            settings = null
            failure = false
            settings = model.read("/app-settings")
            instructions = settings?.optString("personalInstructions") ?: ""
            defaultHarness = settings?.optString("defaultHarnessId", "kodo") ?: "kodo"
            failure = settings == null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Kooyu.colors.paper)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // 当前设备卡片（点击查看并切换设备）
        val currentDevice = state.connection
        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier
                .fillMaxWidth()
                .clickable { detail = "devices" }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(18.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(76.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (state.online) Kooyu.colors.brandCoral else Color(0xFF6B7280)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Laptop,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(42.dp)
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    val rawName = currentDevice?.name ?: "我的设备"
                    val displayName = if (rawName.length > 16 && rawName.matches(Regex("^[0-9a-fA-F]+$"))) {
                        rawName.take(6) + "…" + rawName.takeLast(4)
                    } else rawName
                    Text(
                        text = displayName,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = Kooyu.colors.text
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(if (state.online) Kooyu.colors.success else Color(0xFF9CA3AF))
                        )
                        Text(
                            text = if (state.online) "在线" else "离线",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (state.online) Kooyu.colors.success else Kooyu.colors.textSecondary,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TagChip(if (state.online) "低延迟" else "未连接")
                        val deviceCount = state.connections.size
                        TagChip("已保存 ${deviceCount} 台")
                    }
                }
                Icon(
                    imageVector = Icons.Outlined.ChevronRight,
                    contentDescription = null,
                    tint = Kooyu.colors.textTertiary,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        // 功能分组卡片（托管管理、通用与外观、帮助与反馈、关于）
        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                SettingsRow(
                    icon = Icons.Outlined.Security,
                    title = "托管管理",
                    onClick = { detail = "host" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 50.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.Outlined.Palette,
                    title = "通用与外观",
                    onClick = { detail = "general" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 50.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.AutoMirrored.Outlined.HelpOutline,
                    title = "帮助与反馈",
                    onClick = { detail = "help" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 50.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.Outlined.Info,
                    title = "关于",
                    detail = "V1.2.1",
                    onClick = { detail = "about" }
                )
            }
        }

        // 危险操作：删除设备
        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier
                .fillMaxWidth()
                .clickable { showDeleteDeviceDialog = true }
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 15.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "删除设备",
                    color = Kooyu.colors.destructive,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
    }

    if (showDeleteDeviceDialog) {
        val targetName = state.connection?.name ?: "当前设备"
        AlertDialog(
            onDismissRequest = { showDeleteDeviceDialog = false },
            title = { Text("删除设备", fontWeight = FontWeight.Bold) },
            text = { Text("确定要删除设备【${targetName}】？设备端上的任务仍将继续运行。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteDeviceDialog = false
                        model.disconnect()
                    }
                ) {
                    Text("删除", color = Kooyu.colors.destructive, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDeviceDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    if (detail == "devices") {
        FullScreenPage("设备切换与管理", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                DevicesScreen(state, model)
            }
        }
    }

    if (detail == "host") {
        HostControlsScreen(state, model) { detail = null }
    }

    if (detail == "general") {
        FullScreenPage("通用与外观", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("外观主题", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (mode, label) ->
                                FilterChip(
                                    selected = ThemeManager.themePreference == mode,
                                    onClick = { ThemeManager.update(context, mode) },
                                    label = { Text(label) },
                                    shape = RoundedCornerShape(10.dp)
                                )
                            }
                        }
                    }
                }

                if (settings == null) {
                    if (failure) {
                        Text("读取失败", color = Kooyu.colors.destructive)
                    } else {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                } else {
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            ChoiceField("默认引擎", defaultHarness, state.harnesses.map { it.id to it.name }) { defaultHarness = it }
                            OutlinedTextField(
                                value = instructions,
                                onValueChange = { instructions = it.take(16000) },
                                label = { Text("全局个人指令") },
                                minLines = 5,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Button(
                                onClick = {
                                    scope.launch {
                                        val body = JSONObject(settings.toString()).put("personalInstructions", instructions).put("defaultHarnessId", defaultHarness)
                                        if (model.execute("/app-settings", "PATCH", body) != null) {
                                            settings = model.read("/app-settings")
                                        }
                                    }
                                },
                                enabled = state.canWrite,
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text("保存设置")
                            }
                        }
                    }
                }
            }
        }
    }

    if (detail == "help") {
        FullScreenPage("帮助与反馈", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("常见问题", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
                        Text("1. 如何连接设备？\n在桌面端打开 Kooyu 并显示二维码，点击当前设备卡片扫描二维码配对即可。\n\n2. 离线状态如何处理？\n请确认桌面客户端正在运行且处于同一局域网或内网穿透已建立。", style = MaterialTheme.typography.bodyMedium, color = Kooyu.colors.textSecondary, lineHeight = 20.sp)
                    }
                }
            }
        }
    }

    if (detail == "about") {
        FullScreenPage("关于", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Spacer(Modifier.height(16.dp))
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(Kooyu.colors.brandCoral),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        painter = painterResource(R.drawable.kooyu_mark_white),
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(50.dp)
                    )
                }
                Text("Kooyu", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
                Text("Version 1.2.1", style = MaterialTheme.typography.bodyMedium, color = Kooyu.colors.textSecondary)
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("客户端版本", color = Kooyu.colors.textSecondary)
                            Text("1.2.1", color = Kooyu.colors.text, fontWeight = FontWeight.Medium)
                        }
                        HorizontalDivider(color = Kooyu.colors.borderSubtle, thickness = 0.5.dp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("构建协议", color = Kooyu.colors.textSecondary)
                            Text("v4", color = Kooyu.colors.text, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

@Composable fun SessionDetails(state: WorkbenchState, model: Workbench, session: HostSession, close: () -> Unit) {
    var section by rememberSaveable { mutableStateOf("settings") }
    var title by rememberSaveable { mutableStateOf(session.title) }
    var project by rememberSaveable { mutableStateOf(session.projectId ?: "") }
    var workspace by rememberSaveable { mutableStateOf(session.workspaceId ?: "") }
    var settings by remember { mutableStateOf<JSONObject?>(null) }
    var chosenModel by remember { mutableStateOf(session.model ?: "") }
    var reasoning by remember { mutableStateOf(session.raw.nullableString("reasoning") ?: "") }
    var permission by remember { mutableStateOf(session.raw.nullableString("permissionMode") ?: "") }
    var loading by remember { mutableStateOf(true) }
    var editingCommand by remember { mutableStateOf<JSONObject?>(null) }
    var editingText by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId, session.id) {
        loading = true
        settings = model.read("/sessions/" + session.id + "/settings")
        loading = false
    }

    FullScreenPage("对话详情与配置", close) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("settings" to "基础配置", "tools" to "事件记录", "queue" to "指令队列", "files" to "工作区文件").forEach { (id, label) ->
                        FilterChip(
                            selected = section == id,
                            onClick = { section = id },
                            label = { Text(label) },
                            shape = RoundedCornerShape(8.dp)
                        )
                    }
                }
            }

            if (section == "files") {
                val selected = state.workspaces.firstOrNull { it.id == session.workspaceId }
                if (selected == null) {
                    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                        Text("当前会话未绑定工作目录。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    Box(Modifier.weight(1f)) { WorkspaceBrowser(selected, state, model) }
                }
            } else {
                LazyColumn(
                    Modifier.weight(1f),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    when (section) {
                        "settings" -> {
                            item {
                                Card(
                                    shape = RoundedCornerShape(14.dp),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text("会话属性", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                        OutlinedTextField(
                                            value = title,
                                            onValueChange = { title = it.take(200) },
                                            label = { Text("对话标题") },
                                            singleLine = true,
                                            shape = RoundedCornerShape(10.dp),
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                        ChoiceField("项目范围", project, listOf("" to "全局会话") + state.projects) { project = it; workspace = "" }
                                        ChoiceField("工作目录", workspace, listOf("" to "无工作目录") + state.workspaces.filter { project.isEmpty() || it.projectId == project }.map { it.id to it.path }) { workspace = it }
                                        ChoiceField("工具权限模式", permission, listOf("" to "引擎默认") + permissionChoices(session.harnessId)) { permission = it }

                                        Button(
                                            onClick = {
                                                scope.launch {
                                                    model.updateSession(
                                                        session.id,
                                                        JSONObject().put("title", title.trim())
                                                            .put("projectId", project.ifEmpty { null } ?: JSONObject.NULL)
                                                            .put("workspaceId", workspace.ifEmpty { null } ?: JSONObject.NULL)
                                                            .apply { if (permission.isNotEmpty()) put("permissionMode", permission) }
                                                    )
                                                }
                                            },
                                            enabled = state.canWrite && title.isNotBlank(),
                                            shape = RoundedCornerShape(10.dp)
                                        ) { Text("保存基础配置") }
                                    }
                                }
                            }

                            item {
                                Card(
                                    shape = RoundedCornerShape(14.dp),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text("模型与思考强度", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                                        else if (settings == null) Text("读取失败")
                                        else if (settings!!.optString("modelSupport") == "native-only") Text("配置文件托管")
                                        else {
                                            val models = settings!!.optJSONArray("models")?.objects() ?: emptyList()
                                            ChoiceField("指定模型", chosenModel, listOf("" to "默认模型") + models.map { modelOptionId(session.harnessId, it) to it.optString("name", it.getString("id")) }) {
                                                chosenModel = it; reasoning = ""
                                            }
                                            val levels = models.firstOrNull { modelOptionId(session.harnessId, it) == chosenModel || it.optString("id") == chosenModel }?.optJSONArray("reasoning")?.let { array -> (0 until array.length()).map { array.getString(it) } } ?: emptyList()
                                            if (levels.isNotEmpty()) {
                                                ChoiceField("思考强度 (Reasoning)", reasoning, listOf("" to "默认") + levels.map { it to it }) { reasoning = it }
                                            }
                                            Button(
                                                onClick = {
                                                    scope.launch {
                                                        val revision = settings!!.optJSONObject("session")?.optInt("settingsRevision") ?: session.raw.optInt("settingsRevision")
                                                        val body = JSONObject().put("expectedRevision", revision).put("model", chosenModel.ifEmpty { null } ?: JSONObject.NULL).put("reasoning", reasoning.ifEmpty { null } ?: JSONObject.NULL)
                                                        if (model.execute("/sessions/" + session.id + "/settings", body = body) != null) {
                                                            settings = model.read("/sessions/" + session.id + "/settings")
                                                        }
                                                    }
                                                },
                                                enabled = state.canWrite,
                                                shape = RoundedCornerShape(10.dp)
                                            ) { Text("应用模型更新") }
                                        }
                                        if (state.error.isNotBlank()) Text(state.error, color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                        "tools" -> {
                            item { Text("事件记录", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                            val events = state.events.filter { it.optString("type") !in listOf("message", "text-delta") }
                            if (events.isEmpty()) {
                                item { Text("暂无运行事件。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            items(events, key = { it.getString("id") }) { event ->
                                var expanded by remember { mutableStateOf(false) }
                                val payload = event.optJSONObject("payload") ?: JSONObject()
                                val tool = payload.optString("tool", payload.optString("name", event.optString("type")))
                                val action = payload.optString("action", payload.optString("status", ""))
                                val summary = payload.optString("summary", payload.optString("text", ""))

                                Card(
                                    shape = RoundedCornerShape(10.dp),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded }
                                ) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                                Text(tool, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleSmall)
                                                if (action.isNotBlank()) {
                                                    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(4.dp)) {
                                                        Text(action, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                                    }
                                                }
                                            }
                                            Text(event.optString("createdAt").take(19).replace('T', ' '), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        if (summary.isNotBlank()) {
                                            Text(summary, style = MaterialTheme.typography.bodySmall, maxLines = if (expanded) Int.MAX_VALUE else 2)
                                        }
                                        if (expanded) {
                                            Surface(
                                                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                                shape = RoundedCornerShape(6.dp),
                                                modifier = Modifier.fillMaxWidth()
                                            ) {
                                                SelectionContainer {
                                                    Text(
                                                        payload.toString(2),
                                                        fontFamily = FontFamily.Monospace,
                                                        fontSize = 11.sp,
                                                        modifier = Modifier.padding(8.dp)
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        else -> {
                            item { Text("指令队列", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                            if (state.commands.isEmpty()) {
                                item { Text("队列为空。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            items(state.commands, key = { it.getString("id") }) { command ->
                                val status = command.optString("state", command.optString("status"))
                                val cmdText = command.optJSONObject("input")?.optString("text") ?: command.optJSONObject("payload")?.optString("text") ?: command.optString("type")
                                Card(
                                    shape = RoundedCornerShape(10.dp),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                            Surface(
                                                color = if (status in listOf("queued", "pending", "accepted")) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
                                                shape = RoundedCornerShape(4.dp)
                                            ) {
                                                Text(status, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                            }
                                            if (status in listOf("queued", "pending", "accepted")) {
                                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                                    TextButton(
                                                        onClick = {
                                                            scope.launch {
                                                                model.execute("/sessions/" + session.id + "/commands/" + command.getString("id") + "/send")
                                                            }
                                                        },
                                                        enabled = state.canWrite
                                                    ) { Text("发送") }
                                                    TextButton(
                                                        onClick = {
                                                            editingCommand = command
                                                            editingText = cmdText
                                                        },
                                                        enabled = state.canWrite
                                                    ) { Text("编辑") }
                                                    TextButton(
                                                        onClick = { scope.launch { model.execute("/sessions/" + session.id + "/commands/" + command.getString("id"), "DELETE", null) } },
                                                        enabled = state.canWrite,
                                                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                                                    ) { Text("撤回") }
                                                }
                                            }
                                        }
                                        Text(cmdText, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (editingCommand != null) {
        Dialog(onDismissRequest = { editingCommand = null }) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("编辑指令", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = editingText,
                        onValueChange = { editingText = it },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { editingCommand = null }) { Text("取消") }
                        Button(onClick = {
                            scope.launch {
                                val cmdId = editingCommand!!.getString("id")
                                val body = JSONObject().put("input", JSONObject().put("text", editingText))
                                model.execute("/sessions/" + session.id + "/commands/" + cmdId, "PATCH", body)
                                editingCommand = null
                            }
                        }) { Text("保存") }
                    }
                }
            }
        }
    }
}

@Composable fun GoalDetailScreen(
    goalId: String,
    state: WorkbenchState,
    model: Workbench,
    openSession: ((String) -> Unit)? = null,
    close: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var note by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf("") }

    LaunchedEffect(goalId, state.connection?.hostId) {
        loading = true
        detail = model.read("/goals/$goalId/detail")
        loading = false
    }

    val goal = detail?.optJSONObject("goal")
    val title = goal?.optString("title") ?: "目标详情"
    val status = goal?.optString("status") ?: "draft"
    val verifyStatus = goal?.optString("verificationStatus") ?: "unverified"
    val artifacts = detail?.optJSONArray("artifacts")?.objects() ?: emptyList()
    val verifications = detail?.optJSONArray("verifications")?.objects() ?: emptyList()
    val criteria = goal?.optJSONArray("acceptanceCriteria")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()

    val statusLabel = when (status) {
        "active" -> "进行中"
        "blocked" -> "受阻"
        "awaiting-review" -> "待验收"
        "completed" -> "已完成"
        "cancelled" -> "已取消"
        else -> "草稿"
    }

    val verifyLabel = when (verifyStatus) {
        "passed" -> "检查通过"
        "failed" -> "检查失败"
        "not-applicable" -> "无需验证"
        else -> "未验证"
    }

    FullScreenPage(title, close) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(
                    color = when (status) {
                        "completed" -> MaterialTheme.colorScheme.primaryContainer
                        "awaiting-review" -> MaterialTheme.colorScheme.tertiaryContainer
                        "blocked" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceContainerHigh
                    },
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(statusLabel, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
                Surface(
                    color = when (verifyStatus) {
                        "passed" -> MaterialTheme.colorScheme.primaryContainer
                        "failed" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceContainerHigh
                    },
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(verifyLabel, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }

            if (criteria.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("验收标准", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        criteria.forEach { item ->
                            Text("• $item", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }

            if (artifacts.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("交付成果", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        artifacts.forEach { item ->
                            val art = item.optJSONObject("artifact") ?: item
                            val name = art.optString("displayName", art.optString("title", "成果文件"))
                            val version = art.optInt("version", 1)
                            Text("$name · v$version", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }

            if (verifications.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("验证记录", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        verifications.forEach { v ->
                            val outcome = v.optString("outcome", "unverified")
                            val method = v.optString("method", "验证")
                            val outcomeLabel = if (outcome == "passed") "通过" else if (outcome == "failed") "失败" else "无结论"
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(method, style = MaterialTheme.typography.bodyMedium)
                                Text(outcomeLabel, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            if (status == "awaiting-review") {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("验收确认", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        OutlinedTextField(
                            value = note,
                            onValueChange = { note = it },
                            label = { Text("意见") },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        val body = JSONObject().put("action", "accept").apply {
                                            if (note.isNotBlank()) put("remainingUncertainty", note)
                                        }
                                        if (model.execute("/goals/$goalId/decision", body = body) != null ||
                                            model.execute("/goals/$goalId/review", body = body) != null) {
                                            close()
                                        }
                                    }
                                },
                                enabled = state.canWrite,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("接受成果")
                            }
                            OutlinedButton(
                                onClick = {
                                    scope.launch {
                                        val body = JSONObject().put("action", "request-changes").put("note", note)
                                        if (model.execute("/goals/$goalId/decision", body = body) != null ||
                                            model.execute("/goals/$goalId/review", body = body) != null) {
                                            close()
                                        }
                                    }
                                },
                                enabled = state.canWrite && note.isNotBlank(),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("退回修改")
                            }
                        }
                    }
                }
            }

            if (errorText.isNotBlank()) {
                Text(errorText, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

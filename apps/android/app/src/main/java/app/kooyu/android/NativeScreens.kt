package app.kooyu.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import org.json.JSONObject
import java.util.Locale

@Composable fun ChoiceField(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    enabled: Boolean = true,
    choose: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val displayValue = options.firstOrNull { it.first == value }?.second ?: value.ifBlank { "未选择" }

    Box(Modifier.fillMaxWidth()) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = enabled) { expanded = true }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(displayValue, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(Icons.Outlined.ArrowDropDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        DropdownMenu(expanded, { expanded = false }, modifier = Modifier.heightIn(max = 360.dp)) {
            options.forEach { (id, name) ->
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(name, fontWeight = if (id == value) FontWeight.Bold else FontWeight.Normal)
                            if (id == value) {
                                Icon(Icons.Outlined.Check, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                    },
                    onClick = { choose(id); expanded = false }
                )
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
        Text("已保存电脑", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("支持同时连接与保存多台电脑工作台，随时切换查看专属会话与任务。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

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
                                    if (isCurrent) (if (state.online) "当前电脑 · 在线" else "当前电脑 · 离线") else "已保存",
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

        Button(
            onClick = { model.addDevice(true) },
            enabled = !state.busy,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Outlined.Add, null)
            Spacer(Modifier.width(8.dp))
            Text("添加另一台电脑")
        }

        Text(
            "提示：移除仅清除本机保存的授权凭据；电脑上的任务将继续运行。若需彻底撤销连接授权，请在对应电脑端操作。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    if (renaming != null) {
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("重命名电脑") },
            text = {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(60) },
                    label = { Text("电脑名称") },
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
                Text(if (c.pending != null) "这台电脑还有结果待核对的操作。移除后将失去本机核对标记，运行中的任务不会停止。" else "从手机中清除此电脑连接，电脑上的任务不会停止。")
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
            Text(if (first.isBlank()) "创建" else "创建并发送")
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
                value = title,
                onValueChange = { title = it.take(200) },
                label = { Text("对话标题（可选）") },
                placeholder = { Text("例如：重构前端架构") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )

            Card(
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("项目与目录上下文", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    ChoiceField("所属项目", project, listOf("" to "全局 · 无所属项目") + state.projects) { project = it; workspace = "" }
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
                        ChoiceField("对话类型", kind, listOf("supervisor" to "Kooyu 主对话（自动监督）", "direct" to "直接对话")) { kind = it }
                    }

                    if (descriptor?.modelSupport != "native-only") {
                        val choices = listOf("inherit" to "继承项目 / 电脑默认配置") +
                                (if (descriptor?.modelSupport == "binding-required") emptyList() else listOf("native" to "引擎原生默认", "model" to "手动指定模型")) +
                                profiles.map { "binding:" + it.getString("id") to it.optString("name", it.optString("model")) }
                        ChoiceField("模型来源", choice, choices) { choice = it; reasoning = "" }

                        if (choice == "model") {
                            val models = catalog?.optJSONArray("models")?.objects() ?: descriptor?.raw?.optJSONArray("models")?.objects() ?: emptyList()
                            if (models.isNotEmpty()) {
                                ChoiceField("可用模型", customModel, listOf("" to "请选择模型") + models.map { it.getString("id") to it.optString("name", it.getString("id")) }) {
                                    customModel = it; reasoning = ""
                                }
                            }
                            OutlinedTextField(
                                value = customModel,
                                onValueChange = { customModel = it },
                                label = { Text("模型标识 (Model ID)") },
                                singleLine = true,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                            val levels = models.firstOrNull { it.optString("id") == customModel }?.optJSONArray("reasoning")?.let { array -> (0 until array.length()).map { array.getString(it) } } ?: emptyList()
                            if (levels.isNotEmpty()) {
                                ChoiceField("思考强度 (Reasoning)", reasoning, listOf("" to "引擎默认") + levels.map { it to it }) { reasoning = it }
                            }
                        }
                    }

                    val permissions = permissionChoices(harness)
                    if (permissions.isNotEmpty()) {
                        ChoiceField("工具权限模式", permission, listOf("" to "继承电脑默认权限") + permissions) { permission = it }
                    }
                }
            }

            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

            OutlinedTextField(
                value = first,
                onValueChange = { first = it },
                label = { Text("首条消息（创建后自动发送，可留空）") },
                placeholder = { Text("描述你的初始任务需求…") },
                minLines = 4,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )

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
                            Text("当前选定时间与范围内暂无已知费用记录。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        Text("创建项目以组织电脑上的工作区源码和对话会话。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            title = { Text(if (addWorkspace != null) "添加电脑上的工作目录" else if (editing != null) "重命名项目" else "新建项目") },
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
                            label = { Text("电脑绝对路径") },
                            placeholder = { Text("例如：/Users/dev/project") },
                            supportingText = { Text(if (addWorkspace == null) "可留空，稍后添加工作位置" else "目录必须在当前电脑上已存在") },
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
            text = { Text("将保留会话与电脑源码文件，关联会话将移至全局。") },
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

@Composable fun SettingsScreen(state: WorkbenchState, model: Workbench) {
    var section by rememberSaveable { mutableStateOf("devices") }
    var settings by remember { mutableStateOf<JSONObject?>(null) }
    var instructions by remember { mutableStateOf("") }
    var defaultHarness by remember { mutableStateOf("kodo") }
    var failure by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId, section) {
        if (section == "general") {
            settings = null
            failure = false
            settings = model.read("/app-settings")
            instructions = settings?.optString("personalInstructions") ?: ""
            defaultHarness = settings?.optString("defaultHarnessId", "kodo") ?: "kodo"
            failure = settings == null
        }
    }

    Column(Modifier.fillMaxSize()) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            border = androidx.compose.foundation.BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("devices" to "已配对电脑", "engines" to "执行引擎", "general" to "通用设置").forEach { (id, label) ->
                    FilterChip(
                        selected = section == id,
                        onClick = { section = id },
                        label = { Text(label) },
                        shape = RoundedCornerShape(10.dp)
                    )
                }
            }
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            when (section) {
                "devices" -> DevicesScreen(state, model)
                "engines" -> {
                    Text("已注册执行引擎", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("当前宿主识别到的原生 Harness 及其默认绑定状态：", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

                    state.harnesses.forEach { h ->
                        Card(
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text(h.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                    val health = h.raw.optJSONObject("health")
                                    val isReady = health?.optBoolean("launchable", health.optBoolean("installed")) == true
                                    Surface(
                                        color = if (isReady) Color(0xFFE6F4EA) else Color(0xFFFCE8E6),
                                        shape = RoundedCornerShape(6.dp)
                                    ) {
                                        Text(
                                            if (isReady) "就绪" else (health?.nullableString("error") ?: "未安装"),
                                            color = if (isReady) Color(0xFF137333) else Color(0xFFC5221F),
                                            style = MaterialTheme.typography.labelSmall,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                        )
                                    }
                                }
                                h.raw.optJSONObject("nativeDefaults")?.let { defaults ->
                                    Text("默认模型: " + (defaults.nullableString("model") ?: "由引擎原生决定"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                val engineBindings = state.bindings.filter { it.optString("harnessId") == h.id }
                                if (engineBindings.isNotEmpty()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text("可用绑定配置：", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                                        engineBindings.forEach { binding ->
                                            Text("• " + binding.optString("name") + " (" + binding.optString("model") + ")", style = MaterialTheme.typography.bodySmall)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Text("提示：引擎的安装、升级、登录凭据绑定和命令行系统入口修改均在电脑宿主端完成。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> {
                    Text("电脑宿主通用设置", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    if (settings == null) {
                        if (failure) {
                            Text("读取设置失败，请检查电脑连接后重试。", color = MaterialTheme.colorScheme.error)
                        } else {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                        }
                    } else {
                        Card(
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                ChoiceField("新对话默认引擎", defaultHarness, state.harnesses.map { it.id to it.name }) { defaultHarness = it }
                                OutlinedTextField(
                                    value = instructions,
                                    onValueChange = { instructions = it.take(16000) },
                                    label = { Text("全局个人指令 (System Prompt)") },
                                    placeholder = { Text("写入适合你的编程偏好与语言风格…") },
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
                                    Text("保存通用设置")
                                }
                            }
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
                                        else if (settings == null) Text("读取模型设置失败，请稍后重试。")
                                        else if (settings!!.optString("modelSupport") == "native-only") Text("此引擎由宿主原生配置文件指定模型。")
                                        else {
                                            val models = settings!!.optJSONArray("models")?.objects() ?: emptyList()
                                            ChoiceField("指定模型", chosenModel, listOf("" to "默认模型") + models.map { it.getString("id") to it.optString("name", it.getString("id")) }) {
                                                chosenModel = it; reasoning = ""
                                            }
                                            val levels = models.firstOrNull { it.optString("id") == chosenModel }?.optJSONArray("reasoning")?.let { array -> (0 until array.length()).map { array.getString(it) } } ?: emptyList()
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
                            item { Text("事件与运行记录", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                            val events = state.events.filter { it.optString("type") !in listOf("message", "text-delta") }
                            if (events.isEmpty()) {
                                item { Text("暂无工具调用或系统运行事件。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            items(events, key = { it.getString("id") }) { event ->
                                var expanded by remember { mutableStateOf(false) }
                                Card(
                                    shape = RoundedCornerShape(10.dp),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded }
                                ) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(event.optString("type"), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleSmall)
                                            Text(event.optString("createdAt").take(19).replace('T', ' '), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        if (expanded) {
                                            Surface(
                                                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                                shape = RoundedCornerShape(6.dp),
                                                modifier = Modifier.fillMaxWidth()
                                            ) {
                                                SelectionContainer {
                                                    Text(
                                                        (event.optJSONObject("payload") ?: JSONObject()).toString(2),
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
                            item { Text("指令队列 (Command Queue)", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                            if (state.commands.isEmpty()) {
                                item { Text("当前队列中暂无待派发或执行中的指令。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            items(state.commands, key = { it.getString("id") }) { command ->
                                val status = command.optString("state", command.optString("status"))
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
                                                TextButton(
                                                    onClick = { scope.launch { model.execute("/sessions/" + session.id + "/commands/" + command.getString("id"), "DELETE", null) } },
                                                    enabled = state.canWrite,
                                                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                                                ) { Text("撤回指令") }
                                            }
                                        }
                                        Text(
                                            command.optJSONObject("input")?.optString("text") ?: command.optJSONObject("payload")?.optString("text") ?: command.optString("type"),
                                            style = MaterialTheme.typography.bodySmall
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
}

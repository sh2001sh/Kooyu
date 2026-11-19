package app.kooyu.android.ui.home

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

val QUICK_PROMPTS = listOf(
    "检查项目" to "检查当前工作区 git 改动与最近失败点，给出简短结论。",
    "修复并验证" to "定位问题并修改代码，完成后运行相关测试验证。",
    "整理成果" to "汇总当前项目的进行中目标、最近产出和待办风险。",
    "安排计划" to "为本项目创建定时巡检或汇总计划。"
)

/**
 * Full-height HIG Draft Canvas (`[✕]` + centered `[✦ Harness ▾]` & `📁 dir · branch` + `[⋯]`),
 * centered hero + quick template chips fading on typing/IME, and 3-anchor composer (`[＋] [模型·思考 ▾] (↑)`).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable fun DraftSessionSheet(
    state: WorkbenchState,
    model: Workbench,
    initialProject: String = "",
    initialText: String = "",
    initialHarness: String? = null,
    close: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val density = LocalDensity.current
    var first by rememberSaveable { mutableStateOf(initialText) }
    var title by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf(initialProject) }
    var workspace by rememberSaveable {
        mutableStateOf(
            state.workspaces.firstOrNull {
                it.projectId == initialProject && (it.hostId == null || it.hostId == state.connection?.hostId)
            }?.id ?: ""
        )
    }
    var customPath by rememberSaveable { mutableStateOf("") }
    var executor by rememberSaveable { mutableStateOf("local") }
    var harness by rememberSaveable { mutableStateOf(initialHarness ?: "kodo") }
    var kind by rememberSaveable { mutableStateOf("supervisor") }
    var choice by rememberSaveable { mutableStateOf("inherit") }
    var customModel by rememberSaveable { mutableStateOf("") }
    var reasoning by rememberSaveable { mutableStateOf("") }
    var permission by rememberSaveable { mutableStateOf("") }
    var menu by rememberSaveable { mutableStateOf("") }
    var modelTab by rememberSaveable { mutableStateOf("model") }
    var catalog by remember { mutableStateOf<JSONObject?>(null) }
    var executors by remember { mutableStateOf(emptyList<JSONObject>()) }
    var loading by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf("") }
    var files by remember { mutableStateOf(emptyList<ManagedAttachment>()) }
    var uploading by remember { mutableStateOf(false) }
    var fileError by remember { mutableStateOf("") }

    val descriptor = state.harnesses.firstOrNull { it.id == harness }
    val shortEngineName = if (harness == "kodo") "Kooyu 主对话" else (descriptor?.name?.substringBefore(" · ") ?: harnessVisual(harness).name)
    val harnessTitle = shortEngineName
    val profiles = state.bindings.filter { it.optString("harnessId") == harness && !it.optBoolean("archived") }
    val projectRaw = state.snapshot.optJSONArray("projects")?.objects()?.firstOrNull { it.optString("id") == project }
    val inherited = projectRaw?.optJSONObject("bindingDefaults")?.nullableString(harness)
        ?: state.snapshot.optJSONObject("bindingDefaults")?.optJSONObject("harnessBindingIds")?.nullableString(harness)
    val binding = profiles.firstOrNull { it.optString("id") == if (choice.startsWith("binding:")) choice.removePrefix("binding:") else if (choice == "inherit") inherited else null }
    val provider = binding?.takeIf { it.optString("selectionMode") == "provider" }
    val nativeModels = catalog?.optJSONArray("models")?.objects().orEmpty()
    val models = provider?.optJSONArray("availableModels")?.objects()?.map { item ->
        JSONObject(item.optJSONObject("effective")?.toString() ?: "{}").put("id", item.getString("model"))
            .put("name", item.optString("model")).put("reasoning", org.json.JSONArray(providerReasoningLevels(item.optJSONObject("effective") ?: JSONObject(), harness)))
    } ?: binding?.let {
        listOf(
            JSONObject().put("id", it.optString("model")).put("name", it.optString("model"))
                .put("reasoning", org.json.JSONArray(providerReasoningLevels(it.optJSONObject("parameters") ?: JSONObject(), harness)))
        )
    } ?: nativeModels

    fun modelId(item: JSONObject) = if (binding != null) item.getString("id") else modelOptionId(harness, item)
    val harnessPreset = state.appSettings?.optJSONObject("harnessDefaults")?.optJSONObject(harness)
    val presetModel = harnessPreset?.nullableString("model")?.takeIf { m ->
        executor == "local" && choice == "inherit" && (
            (provider != null && provider.optJSONArray("availableModels")?.objects()?.any { it.optString("model") == m } == true) ||
            binding == null
        )
    }
    val presetReasoning = harnessPreset?.nullableString("reasoning")?.takeIf { executor == "local" && choice == "inherit" }
    val presetPermission = harnessPreset?.nullableString("permissionMode")?.takeIf { p -> permissionChoices(harness).any { it.first == p } }
    val effectiveReasoning = reasoning.ifBlank { presetReasoning.orEmpty() }
    val effectivePermission = permission.ifBlank { presetPermission.orEmpty() }
    val current = customModel.ifBlank {
        presetModel ?: binding?.nullableString("model") ?: composerDefaultModel(catalog?.optJSONObject("defaultModel"))
            ?: descriptor?.raw?.optJSONObject("nativeDefaults")?.nullableString("model") ?: ""
    }
    val selected = selectComposerModel(models, current, customModel.isBlank())
    val levels = composerReasoningLevels(selected, binding, current, harness)
    val targetModel = reasoningModelTarget(current, selected, harness, binding != null)

    suspend fun loadCatalog(discover: Boolean) {
        loading = true
        val result = model.read("/harnesses/${encoded(harness)}/models" + if (discover) "?discover=1" else "")
        if (result != null) { catalog = result; loadError = "" } else loadError = "读取模型失败，请刷新重试。"
        loading = false
    }

    val draft = SessionDraft(
        title, harness, kind, project.ifEmpty { null }, workspace.ifEmpty { null },
        choice, customModel, reasoning, permission, first, executorId = executor, customPath = customPath
    )
    val validation = draft.validation(descriptor, state.workspaces, profiles.any { it.optString("id") == inherited })

    LaunchedEffect(state.connection?.hostId) {
        executors = model.readArray("/executors")
        val preferred = state.appSettings?.nullableString("defaultHarnessId")
        if (initialHarness == null && state.harnesses.any { it.id == preferred }) harness = preferred!!
    }
    LaunchedEffect(state.connection?.hostId, harness) {
        catalog = null
        loadCatalog(false)
    }
    LaunchedEffect(menu) { if (menu == "model_unified") loadCatalog(true) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            val connection = state.connection ?: return@launch
            uploading = true
            try {
                for (uri in uris) {
                    require(files.size < 10) { "一次最多附加 10 个文件。" }
                    val name = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "附件"
                    val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)!!.use { readAttachmentBytes(it) } }
                    require(bytes.size <= 32 * 1024 * 1024) { "单个附件最多 32 MiB。" }
                    val file = HostAPI(connection).upload(name, context.contentResolver.getType(uri) ?: "application/octet-stream", bytes, null)
                    if (model.state.value.connection?.token == connection.token) files = files + ManagedAttachment(file.getString("id"), name)
                }
                fileError = ""
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { fileError = e.message ?: "附件上传失败，请重新添加。" }
            finally { uploading = false }
        }
    }

    val submit = { scope.launch { if (model.create(draft, files)) close() }; Unit }
    val c = Kooyu.colors
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(300); runCatching { focus.requestFocus() } }
    val imeOpen = WindowInsets.ime.getBottom(density) > 0
    val sendable = state.canWrite && validation == null && !uploading && fileError.isBlank() && (first.isNotBlank() || files.isNotEmpty())

    val selectedWs = state.workspaces.firstOrNull { it.id == workspace }
    val wsLabel = when {
        selectedWs != null -> formatWorkspaceLabel(selectedWs.path).ifBlank { selectedWs.path }
        customPath.isNotBlank() -> formatWorkspaceLabel(customPath).ifBlank { customPath }
        else -> "未绑定目录"
    }
    val wsBranch = state.snapshot.optJSONArray("workspaces")?.objects()
        ?.firstOrNull { it.optString("id") == workspace }
        ?.nullableString("branch")
        ?.takeIf { it.isNotBlank() }
    val modelShort = if (executor != "local") "节点配置" else selected?.nullableString("name") ?: current.substringAfterLast('/').ifBlank { "原生默认" }
    val unifiedModelSummary = if (effectiveReasoning.isBlank()) modelShort else "$modelShort · $effectiveReasoning"
    val permLabel = permissionChoices(harness).firstOrNull { it.first == effectivePermission }?.second ?: defaultPermissionLabel(harness)
    val projLabel = state.projects.firstOrNull { it.first == project }?.second ?: "全局会话"

    ModalBottomSheet(
        onDismissRequest = close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.paper,
        dragHandle = { KooyuSheetHandle() },
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.95f)
                .navigationBarsPadding()
                .imePadding()
        ) {
            // Minimal centered draft header: [✕] + [✦ Harness ▾ / 📁 dir · branch] + [⋯]
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = close, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Outlined.Close, "关闭", tint = c.textSecondary)
                }
                Column(
                    Modifier
                        .weight(1f)
                        .padding(horizontal = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Surface(
                        shape = CircleShape,
                        color = c.sunken,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable(onClickLabel = "切换对话引擎") { menu = "harness" }
                            .semantics { contentDescription = "切换对话引擎" }
                    ) {
                        Row(
                            Modifier.padding(start = 8.dp, end = 9.dp, top = 5.dp, bottom = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            EngineBadge(harness, 16.dp, circle = false)
                            Text(harnessTitle, style = KooyuType.rowTitle, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Icon(Icons.Outlined.ExpandMore, null, tint = c.textTertiary, modifier = Modifier.size(14.dp))
                        }
                    }
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .clickable(onClickLabel = "选择工作位置") { menu = "workspace" }
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(Icons.Outlined.Folder, null, tint = c.textTertiary, modifier = Modifier.size(12.dp))
                        Text(
                            if (wsBranch != null) "$wsLabel · $wsBranch" else wsLabel,
                            style = KooyuType.caption,
                            color = c.textSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                IconButton(onClick = { menu = "context" }, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Outlined.MoreHoriz, "新对话设置", tint = c.textSecondary)
                }
            }
            HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)

            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center
            ) {
                ComposerWelcome(
                    title = if (harness == "kodo") "今天想推进什么？" else "与 $shortEngineName 开启新对话",
                    harnessId = harness,
                    onBadgeClick = { menu = "harness" },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (validation != null || state.error.isNotBlank()) {
                Column(Modifier.padding(horizontal = 18.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (validation != null) Text(validation, color = c.textSecondary, style = KooyuType.caption, fontSize = 12.sp)
                    if (state.error.isNotBlank()) Text(state.error, color = c.destructive, style = KooyuType.caption, fontSize = 12.sp)
                }
            }

            Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                MobileComposer(
                    text = first,
                    change = { first = it },
                    placeholder = if (harness == "kodo") "输入任务或目标…" else "发送消息给 $shortEngineName…",
                    enabled = !state.busy,
                    sendEnabled = sendable,
                    submit = submit,
                    attachments = files,
                    remove = { id -> files = files.filterNot { it.id == id }; fileError = "" },
                    uploading = uploading,
                    error = fileError,
                    focusRequester = focus,
                    minLines = 2,
                    onPlus = { menu = "plus" },
                    plusCount = files.size,
                    modelSummary = modelShort,
                    modelEnabled = executor == "local",
                    reasoningSummary = if (effectiveReasoning.isBlank()) "默认思考" else "思考:$effectiveReasoning",
                    onReasoningClick = { modelTab = "reasoning"; menu = "model_unified" },
                    permissionSummary = permLabel,
                    onPermissionClick = { menu = "permission" },
                    leadingBadge = { EngineBadge(harness, 14.dp, circle = false) },
                    onModelSummaryClick = { modelTab = "model"; menu = "model_unified" }
                )
            }
        }
    }

    if (menu == "plus") {
        ModalBottomSheet(onDismissRequest = { menu = "" }, containerColor = c.raised, dragHandle = { KooyuSheetHandle() }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("添加到对话", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text, modifier = Modifier.padding(horizontal = 4.dp))
                InsetGroupCard {
                    InsetLinkRow(Icons.Outlined.AttachFile, if (files.isEmpty()) "添加附件" else "添加附件（已选 ${files.size}/10）") {
                        menu = ""
                        if (state.canWrite && !uploading && files.size < 10) picker.launch(arrayOf("*/*"))
                    }
                    if (permissionChoices(harness).isNotEmpty()) {
                        InsetDivider()
                        InsetLinkRow(Icons.Outlined.Shield, "工具权限 · $permLabel") { menu = "permission" }
                    }
                    InsetDivider()
                    InsetLinkRow(Icons.Outlined.FolderOpen, "所属项目 · $projLabel") { menu = "project" }
                    InsetDivider()
                    InsetLinkRow(Icons.Outlined.Folder, "工作目录 · $wsLabel") { menu = "workspace" }
                    InsetDivider()
                    InsetLinkRow(Icons.Outlined.Tune, "更多对话设置") { menu = "context" }
                }
            }
        }
    }

    if (menu == "model_unified") {
        val options = if (modelTab == "reasoning") {
            listOf(ComposerOption("", "默认思考", leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })) +
                levels.map { ComposerOption(it, it, leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = c.accent, modifier = Modifier.size(20.dp)) }) }
        } else {
            listOf(ComposerOption("inherit", "继承项目 / 设备配置", leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = c.accent, modifier = Modifier.size(20.dp)) })) +
                (if (descriptor?.modelSupport != "binding-required") listOf(ComposerOption("native", "原生配置与登录", leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })) else emptyList()) +
                profiles.map { ComposerOption("binding:" + it.getString("id"), it.optString("name"), it.optString("model"), leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = c.accent, modifier = Modifier.size(20.dp)) }) } +
                (if (descriptor?.modelSupport != "binding-required" || provider != null) models.map {
                    ComposerOption("model:" + modelId(it), it.nullableString("name") ?: it.getString("id"), modelId(it), leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = c.accent, modifier = Modifier.size(20.dp)) })
                } else emptyList())
        }
        ComposerPicker(
            title = if (modelTab == "reasoning") "思考强度" else "模型与思考配置",
            options = options,
            current = if (modelTab == "reasoning") reasoning else (if (customModel.isNotBlank()) "model:$customModel" else choice),
            close = { menu = "" },
            searchable = modelTab == "model",
            custom = modelTab == "model" && (descriptor?.modelSupport != "binding-required" || provider != null),
            loading = loading,
            error = loadError,
            message = if (modelTab == "reasoning" && !loading && levels.isEmpty()) "当前模型未提供可选思考档位。" else "",
            refresh = { scope.launch { loadCatalog(true) } },
            headerExtra = {
                KooyuSegmentedControl(
                    options = listOf(
                        SegmentOption("model", "模型 ($modelShort)"),
                        SegmentOption("reasoning", if (reasoning.isBlank()) "思考 (默认)" else "思考 ($reasoning)")
                    ),
                    selected = modelTab,
                    onSelect = { modelTab = it }
                )
            }
        ) { chosen ->
            if (modelTab == "reasoning") {
                reasoning = chosen
                if (chosen.isNotBlank() && targetModel != null) {
                    customModel = targetModel
                    choice = if (binding != null) "binding:" + binding.getString("id") else "model"
                }
                menu = ""
            } else {
                if (chosen in listOf("inherit", "native") || chosen.startsWith("binding:")) { choice = chosen; customModel = "" }
                else { customModel = chosen.removePrefix("model:"); if (provider == null) choice = "model" else choice = "binding:" + binding!!.getString("id") }
                reasoning = ""
                if (levels.isNotEmpty()) modelTab = "reasoning" else menu = ""
            }
        }
    }

    if (menu == "directory") DirectoryPicker(model, customPath, { menu = "context" }) { customPath = it; workspace = ""; menu = "context" }
    if (menu == "project") ComposerPicker("所属项目", listOf(ComposerOption("", "全局会话", leadingIcon = { Icon(Icons.Outlined.FolderOpen, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })) + state.projects.map { ComposerOption(it.first, it.second, leadingIcon = { Icon(Icons.Outlined.FolderOpen, null, tint = c.accent, modifier = Modifier.size(20.dp)) }) }, project, { menu = "" }) {
        project = it; workspace = state.workspaces.firstOrNull { w -> w.projectId == it }?.id ?: ""; menu = ""
    }
    if (menu == "workspace") ComposerPicker("工作目录", listOf(ComposerOption("", "未绑定目录", leadingIcon = { Icon(Icons.Outlined.Folder, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })) + state.workspaces.filter { (project.isEmpty() || it.projectId == project) && (if (executor == "local") (it.hostId == null || it.hostId == state.connection?.hostId) else it.hostId == executors.firstOrNull { e -> e.optString("id") == executor }?.optString("hostId")) }.map { ComposerOption(it.id, formatWorkspaceLabel(it.path), it.path, leadingIcon = { Icon(Icons.Outlined.Folder, null, tint = c.accent, modifier = Modifier.size(20.dp)) }) }, workspace, { menu = "" }) { workspace = it; customPath = ""; menu = "" }
    if (menu == "harness") ComposerPicker("执行引擎", state.harnesses.map { ComposerOption(it.id, if (it.id == "kodo") "Kooyu · 主对话" else it.name, leadingIcon = { EngineBadge(it.id, 24.dp, circle = false) }) }, harness, { menu = "" }) {
        harness = it
        kind = if (it == "kodo") "supervisor" else "direct"
        if (it != "kodo" && workspace.isEmpty()) {
            val firstWs = state.workspaces.firstOrNull { w -> w.hostId == null || w.hostId == state.connection?.hostId }
            if (firstWs != null) { workspace = firstWs.id; project = firstWs.projectId ?: project }
        }
        choice = "inherit"; customModel = ""; reasoning = ""; permission = ""; menu = ""
    }
    if (menu == "permission") ComposerPicker("工具权限", listOf(ComposerOption("", defaultPermissionLabel(harness), leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })) + permissionChoices(harness).map { ComposerOption(it.first, it.second, leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = c.accent, modifier = Modifier.size(20.dp)) }) }, permission, { menu = "" }) { permission = it; menu = "" }
    if (menu == "context") {
        FullScreenPage("新对话设置", { menu = "" }) { padding ->
            Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("对话标题（可选）", style = KooyuType.sectionHeader, color = c.textTertiary)
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 46.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.sunken)
                            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        BasicTextField(
                            value = title,
                            onValueChange = { title = it.take(200) },
                            singleLine = true,
                            textStyle = KooyuType.body.copy(color = c.text),
                            cursorBrush = SolidColor(c.brandCoral),
                            modifier = Modifier.fillMaxWidth(),
                            decorationBox = { inner ->
                                if (title.isEmpty()) Text("默认根据首条消息生成", style = KooyuType.body, color = c.textTertiary)
                                inner()
                            }
                        )
                    }
                }
                ChoiceField("所属项目", project, listOf("" to "全局会话") + state.projects) { project = it; workspace = "" }
                ChoiceField("工作目录", workspace, listOf("" to "未绑定目录") + state.workspaces.filter { (project.isEmpty() || it.projectId == project) && (if (executor == "local") (it.hostId == null || it.hostId == state.connection?.hostId) else it.hostId == executors.firstOrNull { e -> e.optString("id") == executor }?.optString("hostId")) }.map { it.id to formatWorkspaceLabel(it.path) }) { workspace = it; customPath = "" }
                TextButton(onClick = { menu = "directory" }, enabled = executor == "local") { Icon(Icons.Outlined.FolderOpen, null); Spacer(Modifier.width(6.dp)); Text(customPath.ifBlank { "浏览设备目录…" }) }
                if (executors.isNotEmpty()) ChoiceField("执行节点", executor, listOf("local" to "当前设备") + executors.filter { it.optString("id") != "local" }.map { it.getString("id") to it.getString("name") }) { executor = it; workspace = ""; customPath = "" }
                if (harness == "kodo") ChoiceField("对话类型", kind, listOf("supervisor" to "Kooyu 主对话", "direct" to "直接对话")) { kind = it }
            }
        }
    }
}

/** Harness engine chip with its HARNESS_VISUALS badge; selection uses ink, not coral. */
@Composable fun HarnessChip(id: String, name: String, selected: Boolean, onClick: () -> Unit) {
    val c = Kooyu.colors
    Row(
        Modifier
            .height(36.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) c.accentTint else c.sunken)
            .border(if (selected) 1.dp else 0.5.dp, if (selected) c.text.copy(alpha = 0.5f) else c.borderSubtle, RoundedCornerShape(18.dp))
            .kooyuPressable(onClickLabel = "选择 $name") { onClick() }
            .semantics { this.selected = selected; contentDescription = name }
            .padding(start = 6.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        EngineBadge(id, 24.dp, circle = false)
        Text(name, style = KooyuType.label, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium, color = if (selected) c.text else c.textSecondary, maxLines = 1)
    }
}

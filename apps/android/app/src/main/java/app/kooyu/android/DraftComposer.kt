package app.kooyu.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable fun SessionComposer(state: WorkbenchState, model: Workbench, initialProject: String = "", initialText: String = "", close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var first by rememberSaveable { mutableStateOf(initialText) }
    var title by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf(initialProject) }
    var workspace by rememberSaveable { mutableStateOf(state.workspaces.firstOrNull { it.projectId == initialProject && (it.hostId == null || it.hostId == state.connection?.hostId) }?.id ?: "") }
    var customPath by rememberSaveable { mutableStateOf("") }
    var executor by rememberSaveable { mutableStateOf("local") }
    var harness by rememberSaveable { mutableStateOf("kodo") }
    var kind by rememberSaveable { mutableStateOf("supervisor") }
    var choice by rememberSaveable { mutableStateOf("inherit") }
    var customModel by rememberSaveable { mutableStateOf("") }
    var reasoning by rememberSaveable { mutableStateOf("") }
    var permission by rememberSaveable { mutableStateOf("") }
    var menu by rememberSaveable { mutableStateOf("") }
    var catalog by remember { mutableStateOf<JSONObject?>(null) }
    var executors by remember { mutableStateOf(emptyList<JSONObject>()) }
    var loading by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf("") }
    var files by remember { mutableStateOf(emptyList<ManagedAttachment>()) }
    var uploading by remember { mutableStateOf(false) }
    var fileError by remember { mutableStateOf("") }
    val descriptor = state.harnesses.firstOrNull { it.id == harness }
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
    } ?: binding?.let { listOf(JSONObject().put("id", it.optString("model")).put("name", it.optString("model"))
        .put("reasoning", org.json.JSONArray(providerReasoningLevels(it.optJSONObject("parameters") ?: JSONObject(), harness)))) } ?: nativeModels
    fun modelId(item: JSONObject) = if (binding != null) item.getString("id") else modelOptionId(harness, item)
    val current = customModel.ifBlank { binding?.nullableString("model") ?: composerDefaultModel(catalog?.optJSONObject("defaultModel"))
        ?: descriptor?.raw?.optJSONObject("nativeDefaults")?.nullableString("model") ?: "" }
    val selected = selectComposerModel(models, current, customModel.isBlank())
    val levels = composerReasoningLevels(selected, binding, current, harness)
    val targetModel = reasoningModelTarget(current, selected, harness, binding != null)
    suspend fun loadCatalog(discover: Boolean) {
        loading = true
        val result = model.read("/harnesses/${encoded(harness)}/models" + if (discover) "?discover=1" else "")
        if (result != null) { catalog = result; loadError = "" } else loadError = "读取模型失败，请刷新重试。"
        loading = false
    }
    val draft = SessionDraft(title, harness, kind, project.ifEmpty { null }, workspace.ifEmpty { null }, choice, customModel, reasoning, permission, first,
        executorId = executor, customPath = customPath)
    val validation = draft.validation(descriptor, state.workspaces, profiles.any { it.optString("id") == inherited })
    LaunchedEffect(state.connection?.hostId) {
        executors = model.readArray("/executors")
        val preferred = state.appSettings?.nullableString("defaultHarnessId")
        if (state.harnesses.any { it.id == preferred }) harness = preferred!!
    }
    LaunchedEffect(state.connection?.hostId, harness) {
        catalog = null
        loadCatalog(false)
    }
    LaunchedEffect(menu) { if (menu == "model" || menu == "reasoning") loadCatalog(true) }
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
    FullScreenPage("新建对话", close, actions = {
        IconButton(onClick = { menu = "context" }) { Icon(Icons.Outlined.Tune, "对话设置", tint = Kooyu.colors.textSecondary) }
        Button(onClick = submit, enabled = state.canWrite && validation == null && !uploading,
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Kooyu.colors.accent, contentColor = Kooyu.colors.onAccent)) {
            Text("创建会话", fontWeight = FontWeight.SemiBold)
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ComposerPill(state.projects.firstOrNull { it.first == project }?.second ?: "全局会话", Icons.Outlined.FolderOpen, onClick = { menu = "project" })
                ComposerPill(state.workspaces.firstOrNull { it.id == workspace }?.path?.substringAfterLast('\\')?.substringAfterLast('/') ?: "选择目录", Icons.Outlined.Folder, onClick = { menu = "workspace" })
            }
            val projectName = state.projects.firstOrNull { it.first == project }?.second
            ComposerWelcome(if (projectName != null) "在 $projectName 中做什么？" else "今天想做些什么？", Modifier.weight(1f).fillMaxWidth())
            if (validation != null) Text(validation, color = Kooyu.colors.textSecondary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
            if (state.error.isNotBlank()) Text(state.error, color = Kooyu.colors.destructive, style = MaterialTheme.typography.bodySmall)
            WorkbenchComposer(first, { first = it }, if (harness == "kodo") "问问 Kooyu 主对话，或输入任务说明…" else "发送消息给 ${descriptor?.name ?: harness}…",
                enabled = !state.busy, sendEnabled = state.canWrite && validation == null && !uploading && fileError.isBlank() && (first.isNotBlank() || files.isNotEmpty()),
                submit = submit, attachments = files, remove = { id -> files = files.filterNot { it.id == id }; fileError = "" }, uploading = uploading, error = fileError,
                left = {
                    IconButton(onClick = { picker.launch(arrayOf("*/*")) }, enabled = state.canWrite && !uploading && files.size < 10, modifier = Modifier.size(32.dp)) {
                        Box(Modifier.size(28.dp).clip(CircleShape).background(Kooyu.colors.sunken), contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Add, "添加附件", Modifier.size(14.dp), tint = Kooyu.colors.textSecondary)
                        }
                    }
                    ComposerPill(
                        label = if (harness == "kodo" && kind == "supervisor") "Kooyu · 主对话" else descriptor?.name ?: harness,
                        leadingIcon = { EngineBadge(harness, size = 16.dp, circle = false) },
                        selected = true,
                        onClick = { menu = "harness" }
                    )
                    ComposerPill(permissionChoices(harness).firstOrNull { it.first == permission }?.second ?: defaultPermissionLabel(harness), Icons.Outlined.Shield,
                        enabled = permissionChoices(harness).isNotEmpty(), onClick = { menu = "permission" })
                }, right = {
                    ComposerPill(if (executor != "local") "节点原生配置" else selected?.nullableString("name") ?: current.substringAfterLast('/').ifBlank { "原生默认" }, Icons.Outlined.Memory,
                        modifier = Modifier.weight(1f, fill = false), accessibilityLabel = "模型配置", enabled = executor == "local" && descriptor?.modelSupport != "native-only", onClick = { menu = "model" })
                    ComposerPill(reasoning.ifBlank { "默认思考" }, Icons.Outlined.Psychology, accessibilityLabel = "思考强度", enabled = executor == "local", onClick = { menu = "reasoning" })
                })
            Spacer(Modifier.height(12.dp))
        }
    }
    if (menu == "directory") DirectoryPicker(model, customPath, { menu = "context" }) { customPath = it; workspace = ""; menu = "context" }
    if (menu == "project") ComposerPicker("所属项目", listOf(ComposerOption("", "全局会话", leadingIcon = { Icon(Icons.Outlined.FolderOpen, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) + state.projects.map { ComposerOption(it.first, it.second, leadingIcon = { Icon(Icons.Outlined.FolderOpen, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) }, project, { menu = "" }) {
        project = it; workspace = state.workspaces.firstOrNull { w -> w.projectId == it }?.id ?: ""; menu = ""
    }
    if (menu == "workspace") ComposerPicker("工作目录", listOf(ComposerOption("", "未绑定目录", leadingIcon = { Icon(Icons.Outlined.Folder, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) + state.workspaces.filter { (project.isEmpty() || it.projectId == project) && (if (executor == "local") (it.hostId == null || it.hostId == state.connection?.hostId) else it.hostId == executors.firstOrNull { e -> e.optString("id") == executor }?.optString("hostId")) }.map { ComposerOption(it.id, it.path, leadingIcon = { Icon(Icons.Outlined.Folder, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) }, workspace, { menu = "" }) { workspace = it; customPath = ""; menu = "" }
    if (menu == "harness") ComposerPicker("执行引擎", state.harnesses.map { ComposerOption(it.id, if (it.id == "kodo") "Kooyu · 主对话" else it.name, leadingIcon = { EngineBadge(it.id, 24.dp, circle = false) }) }, harness, { menu = "" }) {
        harness = it; choice = "inherit"; customModel = ""; reasoning = ""; permission = ""; menu = ""
    }
    if (menu == "permission") ComposerPicker("工具权限", listOf(ComposerOption("", defaultPermissionLabel(harness), leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) + permissionChoices(harness).map { ComposerOption(it.first, it.second, leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) }, permission, { menu = "" }) { permission = it; menu = "" }
    if (menu == "model") ComposerPicker("模型配置", listOf(ComposerOption("inherit", "继承项目 / 设备配置", leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) })) +
        (if (descriptor?.modelSupport != "binding-required") listOf(ComposerOption("native", "原生配置与登录", leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) else emptyList()) +
        profiles.map { ComposerOption("binding:" + it.getString("id"), it.optString("name"), it.optString("model"), leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) } +
        (if (descriptor?.modelSupport != "binding-required" || provider != null) models.map { ComposerOption("model:" + modelId(it), it.nullableString("name") ?: it.getString("id"), modelId(it), leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) } else emptyList()),
        if (customModel.isNotBlank()) "model:$customModel" else choice, { menu = "" }, searchable = true, custom = descriptor?.modelSupport != "binding-required" || provider != null, loading = loading, error = loadError, refresh = { scope.launch { loadCatalog(true) } }) {
        if (it in listOf("inherit", "native") || it.startsWith("binding:")) { choice = it; customModel = "" }
        else { customModel = it.removePrefix("model:"); if (provider == null) choice = "model" else choice = "binding:" + binding!!.getString("id") }
        reasoning = ""; menu = ""
    }
    if (menu == "reasoning") ComposerPicker("思考强度", listOf(ComposerOption("", "默认思考", leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) + levels.map { ComposerOption(it, it, leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) }, reasoning, { menu = "" }, loading = loading, error = loadError,
        message = if (!loading && levels.isEmpty()) "当前模型未提供可选思考档位。可刷新选项，或在模型配置中选择支持的模型。" else "思考强度随首条消息一同应用。",
        refresh = { scope.launch { loadCatalog(true) } }) {
        reasoning = it
        if (it.isNotBlank() && targetModel != null) {
            customModel = targetModel
            choice = if (binding != null) "binding:" + binding.getString("id") else "model"
        }
        menu = ""
    }
    if (menu == "context") {
        FullScreenPage("对话设置", { menu = "" }) { padding ->
            Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedTextField(title, { title = it.take(200) }, label = { Text("对话标题（可选）") }, modifier = Modifier.fillMaxWidth())
                ChoiceField("所属项目", project, listOf("" to "全局会话") + state.projects) { project = it; workspace = "" }
                ChoiceField("工作目录", workspace, listOf("" to "未绑定目录") + state.workspaces.filter { (project.isEmpty() || it.projectId == project) && (if (executor == "local") (it.hostId == null || it.hostId == state.connection?.hostId) else it.hostId == executors.firstOrNull { e -> e.optString("id") == executor }?.optString("hostId")) }.map { it.id to it.path }) { workspace = it; customPath = "" }
                TextButton(onClick = { menu = "directory" }, enabled = executor == "local") { Icon(Icons.Outlined.FolderOpen, null); Text(customPath.ifBlank { "浏览设备目录…" }) }
                if (executors.isNotEmpty()) ChoiceField("执行节点", executor, listOf("local" to "当前设备") + executors.filter { it.optString("id") != "local" }.map { it.getString("id") to it.optString("name") }) { executor = it; workspace = ""; customPath = "" }
                if (harness == "kodo") ChoiceField("对话类型", kind, listOf("supervisor" to "Kooyu 主对话", "direct" to "直接对话")) { kind = it }
            }
        }
    }
}

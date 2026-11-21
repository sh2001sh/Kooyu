package app.kooyu.android.ui.conversation

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

data class ManagedAttachment(val id: String, val name: String)

fun readAttachmentBytes(input: java.io.InputStream, limit: Int = 32 * 1024 * 1024): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val chunk = ByteArray(16 * 1024)
    while (true) {
        val count = input.read(chunk)
        if (count < 0) break
        require(output.size() + count <= limit) { "单个附件最多 32 MiB。" }
        output.write(chunk, 0, count)
    }
    return output.toByteArray()
}

fun sessionModelOptionId(session: HostSession, model: JSONObject): String =
    if (session.raw.nullableString("bindingId") != null) model.getString("id") else modelOptionId(session.harnessId, model)

fun defaultPermissionLabel(harness: String): String = when (harness) {
    "kodo", "pi" -> "默认工具"
    "opencode" -> "原生代理规则"
    else -> "原生默认"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun NativeComposerControls(
    state: WorkbenchState,
    model: Workbench,
    session: HostSession,
    text: String,
    change: (String) -> Unit,
    attachments: List<ManagedAttachment>,
    remove: (String) -> Unit,
    uploading: Boolean,
    error: String,
    attach: () -> Unit,
    submit: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val c = Kooyu.colors
    var options by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var permissions by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var menu by remember(session.id) { mutableStateOf("") }
    var modelTab by rememberSaveable(session.id) { mutableStateOf("model") }
    var stopSheetOpen by remember(session.id) { mutableStateOf(false) }
    var loading by remember(session.id) { mutableStateOf(false) }
    var loadError by remember(session.id) { mutableStateOf("") }

    suspend fun load(discover: Boolean) {
        loading = true
        val query = if (!discover) "" else if (session.phase == "native" && session.connectionState == "connected") "?refresh=1" else "?discover=1"
        val result = model.read("/sessions/${session.id}/settings$query")
        if (result != null) { options = result; loadError = "" } else loadError = "读取模型失败，请重试。"
        loading = false
    }
    LaunchedEffect(state.connection?.hostId, session.id, session.raw.optInt("settingsRevision")) { load(false) }
    LaunchedEffect(menu) {
        if (menu == "model_unified") load(true)
        if (menu == "permission" || menu == "plus") permissions = model.read("/sessions/${session.id}/permissions")
    }

    val descriptor = state.harnesses.firstOrNull { it.id == session.harnessId }
    val defaults = descriptor?.raw?.optJSONObject("nativeDefaults")
    val models = options?.optJSONArray("models")?.objects().orEmpty()
    val binding = options?.optJSONObject("binding") ?: state.bindings.firstOrNull { it.optString("id") == session.raw.optString("bindingId") }
    val default = composerDefaultModel(options?.optJSONObject("defaultModel"))
    val current = session.model ?: options?.nullableString("effectiveModel") ?: binding?.nullableString("model") ?: default ?: defaults?.nullableString("model")
    val selected = selectComposerModel(models, current, session.model == null)
    val modelLabel = selected?.nullableString("name") ?: current?.substringAfterLast('/') ?: "原生默认"
    val levels = composerReasoningLevels(selected, binding, current, session.harnessId)
    val effort = session.raw.nullableString("reasoning") ?: (if (binding != null) binding.nullableString("reasoning") else defaults?.nullableString("reasoning"))
    val effortLabel = effort?.takeIf { it.isNotBlank() } ?: "默认"
    val targetModel = reasoningModelTarget(current, selected, session.harnessId, binding != null)

    fun commit(choice: String?, level: String?, dismissOnDone: Boolean = true) {
        scope.launch {
            val revision = maxOf(session.raw.optInt("settingsRevision"), options?.optJSONObject("session")?.optInt("settingsRevision") ?: 0)
            if (model.execute("/sessions/${session.id}/settings", body = JSONObject().put("expectedRevision", revision)
                    .put("model", choice ?: JSONObject.NULL).put("reasoning", level ?: JSONObject.NULL)) != null && dismissOnDone) {
                menu = ""
            }
            load(false)
        }
    }

    val dynamic = session.harnessId in listOf("gemini", "cursor", "kimi-code", "grok-build")
    val native = permissions?.optJSONArray("options")?.objects()?.map { it.optString("value") to it.optString("label") }.orEmpty()
    val acp = session.harnessId == "kimi-code" && (session.raw.optString("permissionMode").startsWith("acp:") || session.raw.nullableString("nativeSessionId")?.let { !it.startsWith("session_") } == true)
    val choices = if (dynamic && (session.harnessId != "kimi-code" || acp || native.isNotEmpty())) native else permissionChoices(session.harnessId)
    val permission = if (dynamic) permissions?.nullableString("current") ?: session.raw.nullableString("permissionMode") else session.raw.nullableString("permissionMode")
    val permissionLabel = choices.firstOrNull { it.first == permission }?.second ?: defaults?.nullableString("permission") ?: defaultPermissionLabel(session.harnessId)
    val blocked = session.raw.optBoolean("bindingUnavailable")

    val supervised = remember(state.snapshot, session.id) {
        state.snapshot.optJSONArray("supervisions")?.objects()?.any {
            it.optString("targetSessionId") == session.id &&
                it.optString("state") == "active" &&
                it.optString("mode") == "continue"
        } == true
    }
    val running = session.runState == "running"
    val cancelSupported = descriptor?.raw?.optJSONObject("capabilities")?.optString("cancel") != "unsupported"
    val showStop = (running || supervised) && text.isBlank() && attachments.isEmpty()
    val reasoningChipLabel = if (effort.isNullOrBlank()) "默认思考" else "思考:$effort"

    MobileComposer(
        text = text,
        change = change,
        placeholder = if (blocked) "会话配置不可用" else if (state.canMail) "发送到离线信箱…" else "发送消息给 ${descriptor?.name ?: session.harnessId}…",
        enabled = !blocked,
        sendEnabled = (state.canWrite || (state.canMail && attachments.isEmpty() && text.length <= 16000)) && !blocked && !uploading && error.isBlank() && (text.isNotBlank() || attachments.isNotEmpty()) && text.length <= 200000,
        stop = showStop,
        stopEnabled = state.canWrite && (supervised || cancelSupported),
        stopAccessibilityLabel = if (supervised) "停止或暂停托管" else "中断当前回合",
        submit = submit,
        cancel = {
            if (supervised) stopSheetOpen = true
            else scope.launch { model.cancelTurn() }
        },
        attachments = attachments,
        remove = remove,
        uploading = uploading,
        error = error,
        onPlus = { menu = "plus" },
        plusCount = attachments.size,
        modelSummary = modelLabel,
        modelEnabled = state.canWrite,
        reasoningSummary = reasoningChipLabel,
        onReasoningClick = { modelTab = "reasoning"; menu = "model_unified" },
        permissionSummary = permissionLabel,
        onPermissionClick = { menu = "permission" },
        leadingBadge = { EngineBadge(session.harnessId, size = 14.dp, circle = false) },
        onModelSummaryClick = { modelTab = "model"; menu = "model_unified" }
    )

    if (menu == "call") ConversationCall(state,model) { menu = "" }
    if (menu == "plus") {
        ModalBottomSheet(onDismissRequest = { menu = "" }, containerColor = c.raised, dragHandle = { KooyuSheetHandle() }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("添加到对话", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text, modifier = Modifier.padding(horizontal = 4.dp))
                InsetGroupCard {
                    InsetLinkRow(Icons.Outlined.AttachFile, if (attachments.isEmpty()) "添加附件" else "添加附件（已选 ${attachments.size}/10）") {
                        menu = ""
                        if (state.canWrite && !uploading && attachments.size < 10) attach()
                    }
                    InsetDivider()
                    InsetLinkRow(Icons.Outlined.Mic, "语音通话") { menu = "call" }
                    InsetDivider()
                    InsetLinkRow(Icons.Outlined.Shield, "工具权限 · $permissionLabel") { menu = "permission" }
                }
            }
        }
    }

    if (menu == "model_unified") {
        val modelOptions = listOf(
            ComposerOption("inherit", if (binding != null) "绑定默认模型" else "原生配置与登录", leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })
        ) + models.map {
            ComposerOption(sessionModelOptionId(session, it), it.nullableString("name") ?: it.getString("id"), sessionModelOptionId(session, it), leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = c.accent, modifier = Modifier.size(20.dp)) })
        }
        val reasoningOptions = listOf(
            ComposerOption("", "默认思考", leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })
        ) + levels.map {
            ComposerOption(it, it, leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = c.accent, modifier = Modifier.size(20.dp)) })
        }
        ComposerPicker(
            title = if (modelTab == "reasoning") "思考强度" else "模型与思考配置",
            options = if (modelTab == "reasoning") reasoningOptions else modelOptions,
            current = if (modelTab == "reasoning") session.raw.nullableString("reasoning").orEmpty() else current.orEmpty(),
            close = { menu = "" },
            searchable = modelTab == "model",
            custom = modelTab == "model",
            loading = loading,
            error = if (modelTab == "reasoning") loadError.ifBlank { state.error } else loadError,
            message = when {
                modelTab == "model" && descriptor?.modelSupport == "native-only" && models.isEmpty() ->
                    "此引擎的模型由其原生 CLI / 客户端管理；你也可在上方切换到思考强度或刷新检测。"
                modelTab == "reasoning" && !loading && levels.isEmpty() ->
                    "当前模型未提供可选思考档位。"
                else -> ""
            },
            refresh = { scope.launch { load(true) } },
            headerExtra = {
                KooyuSegmentedControl(
                    options = listOf(
                        SegmentOption("model", "模型 ($modelLabel)"),
                        SegmentOption("reasoning", "思考 ($effortLabel)")
                    ),
                    selected = modelTab,
                    onSelect = { modelTab = it }
                )
            }
        ) { chosen ->
            if (modelTab == "reasoning") {
                commit(if (chosen.isBlank()) session.model else targetModel, chosen.ifBlank { null }, dismissOnDone = true)
            } else {
                val target = if (chosen == "inherit") null else chosen.ifBlank { null }
                commit(target, null, dismissOnDone = levels.isEmpty())
                if (levels.isNotEmpty()) modelTab = "reasoning"
            }
        }
    }

    if (menu == "permission") {
        ComposerPicker(
            "工具权限",
            (if (!dynamic || !acp && session.harnessId == "kimi-code") listOf(ComposerOption("", defaultPermissionLabel(session.harnessId), leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) })) else emptyList()) +
                choices.map { ComposerOption(it.first, it.second, leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = c.accent, modifier = Modifier.size(20.dp)) }) },
            permission.orEmpty(),
            { menu = "" },
            error = if (choices.isEmpty()) "此引擎的权限由原生配置管理，当前没有可选模式。" else ""
        ) {
            scope.launch { if (model.updateSession(session.id, JSONObject().put("permissionMode", it.ifBlank { null } ?: JSONObject.NULL)) != null) menu = "" }
        }
    }

    if (stopSheetOpen) {
        ModalBottomSheet(
            onDismissRequest = { stopSheetOpen = false },
            containerColor = c.raised,
            dragHandle = { KooyuSheetHandle() },
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("停止当前运行", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text)
                    Text("此对话已开启自动托管；请选择仅中断本轮或同时暂停托管", style = KooyuType.caption, fontSize = 12.sp, color = c.textSecondary)
                }
                Surface(shape = RoundedCornerShape(16.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = state.canWrite) {
                                stopSheetOpen = false
                                scope.launch { model.stop() }
                            }.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(Icons.Outlined.PauseCircleOutline, null, tint = c.destructive, modifier = Modifier.size(20.dp))
                            Text("停止并暂停托管（推荐）", style = KooyuType.rowTitle, color = c.destructive)
                        }
                        if (cancelSupported) {
                            InsetDivider(48)
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = state.canWrite) {
                                    stopSheetOpen = false
                                    scope.launch { model.cancelTurn() }
                                }.padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Icon(Icons.Outlined.StopCircle, null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
                                Text("仅中断本轮（保留托管）", style = KooyuType.rowTitle, color = c.text)
                            }
                        }
                    }
                }
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth().height(48.dp).clickable { stopSheetOpen = false }
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("继续运行", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                    }
                }
            }
        }
    }
}

package app.kooyu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
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

@Composable fun NativeComposerControls(state: WorkbenchState, model: Workbench, session: HostSession,
    text: String, change: (String) -> Unit, attachments: List<ManagedAttachment>, remove: (String) -> Unit,
    uploading: Boolean, error: String, attach: () -> Unit, submit: () -> Unit) {
    val scope = rememberCoroutineScope()
    var options by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var permissions by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var menu by remember(session.id) { mutableStateOf("") }
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
        if (menu == "model" || menu == "reasoning") load(true)
        if (menu == "permission") permissions = model.read("/sessions/${session.id}/permissions")
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
    val effort = session.raw.nullableString("reasoning") ?: (if (binding != null) binding.nullableString("reasoning") else defaults?.nullableString("reasoning")) ?: "默认思考"
    val targetModel = reasoningModelTarget(current, selected, session.harnessId, binding != null)
    fun commit(choice: String?, level: String?) {
        scope.launch {
            val revision = maxOf(session.raw.optInt("settingsRevision"), options?.optJSONObject("session")?.optInt("settingsRevision") ?: 0)
            if (model.execute("/sessions/${session.id}/settings", body = JSONObject().put("expectedRevision", revision)
                .put("model", choice ?: JSONObject.NULL).put("reasoning", level ?: JSONObject.NULL)) != null) menu = ""
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
    WorkbenchComposer(text, change, if (blocked) "会话配置不可用" else "发送消息给 ${descriptor?.name ?: session.harnessId}…",
        enabled = !blocked, sendEnabled = state.canWrite && !blocked && !uploading && error.isBlank() && (text.isNotBlank() || attachments.isNotEmpty()) && text.length <= 200000,
        stop = session.runState == "running" && text.isBlank() && attachments.isEmpty(),
        stopEnabled = state.canWrite && descriptor?.raw?.optJSONObject("capabilities")?.optString("cancel") != "unsupported",
        submit = submit, cancel = { scope.launch { model.cancelTurn() } }, attachments = attachments, remove = remove, uploading = uploading, error = error,
        left = {
            IconButton(onClick = attach, enabled = state.canWrite && !uploading && attachments.size < 10, modifier = Modifier.size(32.dp)) {
                Box(Modifier.size(28.dp).clip(CircleShape).background(Kooyu.colors.sunken), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Add, "添加附件", Modifier.size(14.dp), tint = Kooyu.colors.textSecondary)
                }
            }
            ComposerPill(
                label = descriptor?.name ?: session.harnessId,
                leadingIcon = { EngineBadge(session.harnessId, size = 16.dp, circle = false) },
                expandable = false,
                enabled = false
            )
            ComposerPill(permissionLabel, Icons.Outlined.Shield, enabled = state.canWrite, onClick = { menu = "permission" })
        }, right = {
            ComposerPill(modelLabel, Icons.Outlined.Memory, modifier = Modifier.weight(1f, fill = false), accessibilityLabel = "模型配置", enabled = state.canWrite && descriptor?.modelSupport != "native-only", onClick = { menu = "model" })
            ComposerPill(effort, Icons.Outlined.Psychology, accessibilityLabel = "思考强度", enabled = state.canWrite, onClick = { menu = "reasoning" })
        })
    if (menu == "model") ComposerPicker("模型配置", listOf(ComposerOption("", if (binding != null) "绑定默认模型" else "原生配置与登录", leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) +
        models.map { ComposerOption(sessionModelOptionId(session, it), it.nullableString("name") ?: it.getString("id"), sessionModelOptionId(session, it), leadingIcon = { Icon(Icons.Outlined.Memory, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) },
        current.orEmpty(), { menu = "" }, searchable = true, custom = true, loading = loading, error = loadError,
        refresh = { scope.launch { load(true) } }) { commit(it.ifBlank { null }, null) }
    if (menu == "reasoning") ComposerPicker("思考强度", listOf(ComposerOption("", "默认思考", leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) + levels.map { ComposerOption(it, it, leadingIcon = { Icon(Icons.Outlined.Psychology, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) },
        session.raw.nullableString("reasoning").orEmpty(), { menu = "" }, loading = loading, error = loadError.ifBlank { state.error },
        message = if (!loading && levels.isEmpty()) "当前模型未提供可选思考档位。可刷新选项，或在模型配置中选择支持的模型。" else "此设置将在下一回合生效。",
        refresh = { scope.launch { load(true) } }) { commit(if (it.isBlank()) session.model else targetModel, it.ifBlank { null }) }
    if (menu == "permission") ComposerPicker("工具权限", (if (!dynamic || !acp && session.harnessId == "kimi-code") listOf(ComposerOption("", defaultPermissionLabel(session.harnessId), leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = Kooyu.colors.textSecondary, modifier = Modifier.size(20.dp)) })) else emptyList()) +
        choices.map { ComposerOption(it.first, it.second, leadingIcon = { Icon(Icons.Outlined.Shield, null, tint = Kooyu.colors.accent, modifier = Modifier.size(20.dp)) }) }, permission.orEmpty(), { menu = "" },
        error = if (choices.isEmpty()) "此引擎的权限由原生配置管理，当前没有可选模式。" else "") {
        scope.launch { if (model.updateSession(session.id, JSONObject().put("permissionMode", it.ifBlank { null } ?: JSONObject.NULL)) != null) menu = "" }
    }
}

package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

val endpointProtocols = listOf("openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai")
private val harnessNativeProtocols: Map<String, Set<String>> = mapOf(
    "kodo" to setOf("openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"),
    "pi" to setOf("openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"),
    "codex" to setOf("openai-responses"),
    "claude-code" to setOf("anthropic-messages"),
    "deepseek-harness" to setOf("openai-completions", "openai-responses", "anthropic-messages"),
    "zcode" to setOf("openai-completions", "openai-responses", "anthropic-messages"),
    "opencode" to setOf("openai-completions", "openai-responses", "anthropic-messages"),
    "gemini" to setOf("google-generative-ai"),
    "cursor" to emptySet(),
    "kimi-code" to setOf("openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"),
    "grok-build" to setOf("openai-completions", "openai-responses", "anthropic-messages"),
)
private fun isHarnessProtocolCompatible(harnessId: String, protocol: String): Boolean {
    val native = harnessNativeProtocols[harnessId] ?: emptySet()
    return protocol in native || (harnessId in listOf("claude-code", "gemini") && protocol == "openai-completions")
}
private fun protocolShortName(protocol: String): String = when (protocol) {
    "openai-completions" -> "Chat Completions"
    "openai-responses" -> "OpenAI Responses"
    "anthropic-messages" -> "Anthropic Messages"
    "google-generative-ai" -> "Gemini API"
    else -> protocol
}
fun providerSaveBody(original: JSONObject?, name: String, endpoints: List<JSONObject>): JSONObject = JSONObject().put("name", name.trim()).put("endpoints", JSONArray(endpoints)).apply {
    original?.nullableString("id")?.let { put("id", it); put("expectedRevision", original.getInt("revision")) }
    original?.nullableString("catalogProvider")?.let { put("catalogProvider", it) }
}
fun editableEndpoint(value: JSONObject): JSONObject = JSONObject().apply {
    listOf("id", "name", "protocol", "baseUrl", "modelsUrl").forEach { key -> if (!value.isNull(key)) put(key, value.get(key)) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ModelConfigurationScreen(state: WorkbenchState, model: Workbench, embedded: Boolean = false, close: () -> Unit) {
    var section by remember { mutableStateOf("providers") }; var data by remember { mutableStateOf<JSONObject?>(null) }
    var revision by remember { mutableIntStateOf(0) }; var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf("") }
    var editor by remember { mutableStateOf<String?>(null) }; var original by remember { mutableStateOf<JSONObject?>(null) }
    var deleting by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }
    var applyingProvider by remember { mutableStateOf<JSONObject?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.connection?.hostId, revision) {
        loading = true
        loadError = ""
        model.dismissError()
        val fetched = model.read("/provider-configuration")
        data = fetched
        if (fetched == null) loadError = model.state.value.error.ifBlank { "读取模型配置失败，请重试。" }
        loading = false
    }
    val allModels = data?.optJSONArray("models")?.objects().orEmpty()
    val allBindings = state.bindings.ifEmpty { data?.optJSONArray("bindings")?.objects().orEmpty() }
    val defaultBindingIds = state.snapshot.optJSONObject("bindingDefaults")?.optJSONObject("harnessBindingIds")
    fun activeBindingFor(harnessId: String): JSONObject? {
        val bid = defaultBindingIds?.nullableString(harnessId) ?: return null
        return allBindings.firstOrNull { it.optString("id") == bid }
    }
    fun appliedHarnessesFor(providerId: String): List<HostHarness> {
        return state.harnesses.filter { h -> activeBindingFor(h.id)?.optString("providerId") == providerId }
    }

    val content: @Composable (PaddingValues) -> Unit = { padding ->
        val c = Kooyu.colors
        Column(Modifier.fillMaxSize().background(c.navigator).padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            WorkRecovery(state, model)
            ChoiceField("管理内容", section, listOf("providers" to "模型来源", "models" to "模型", "bindings" to "引擎绑定", "defaults" to "默认配置")) { section = it }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.brandCoral)
            val displayError = loadError.ifBlank { state.error }
            if (displayError.isNotBlank()) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = c.destructiveTint,
                    border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.35f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(displayError, fontSize = 12.5.sp, color = c.destructive, modifier = Modifier.weight(1f))
                        TextButton(onClick = { model.dismissError(); loadError = ""; revision++ }) {
                            Text("重试", color = c.destructive, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                        }
                    }
                }
            }
            if (data != null && section != "defaults") {
                Button(
                    onClick = { original = null; editor = section },
                    enabled = state.canWrite,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                ) {
                    Icon(Icons.Outlined.Add, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("添加" + when (section) { "providers" -> "模型来源"; "models" -> "模型"; else -> "绑定" }, fontWeight = FontWeight.SemiBold)
                }
                val rows = data!!.optJSONArray(section)?.objects() ?: emptyList()
                if (rows.isEmpty()) Text("暂无配置。", color = c.textSecondary, modifier = Modifier.padding(vertical = 12.dp))
                rows.forEach { row ->
                    val rowId = row.optString("id")
                    val providerModels = if (section == "providers") allModels.filter { it.optString("providerId") == rowId } else emptyList()
                    val appliedHarnesses = if (section == "providers") appliedHarnessesFor(rowId) else emptyList()
                    var modelsExpanded by remember(rowId) { mutableStateOf(false) }

                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = c.raised,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(row.optString("name", row.optString("model")), fontSize = 15.5.sp, fontWeight = FontWeight.Bold, color = c.text)
                                    Text(
                                        if (section == "providers") "${row.optJSONArray("endpoints")?.length() ?: 0} 个端点 · ${providerModels.size} 个模型"
                                        else "${row.optString("harnessId")} · ${row.optString("model")}",
                                        fontSize = 12.sp,
                                        color = c.textSecondary,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                    if (section == "providers") {
                                        TextButton(
                                            onClick = { applyingProvider = row },
                                            enabled = state.canWrite,
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                                        ) { Text("应用到", color = c.brandCoral, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                                    }
                                    TextButton(
                                        onClick = { original = row; editor = section },
                                        enabled = state.canWrite,
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                                    ) { Text("编辑", color = c.text, fontSize = 13.sp) }
                                    if (section != "bindings") {
                                        TextButton(
                                            onClick = { deleting = section to row },
                                            enabled = state.canWrite,
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                                        ) { Text("删除", color = c.destructive, fontSize = 13.sp) }
                                    }
                                }
                            }
                            if (section == "providers") {
                                // Show exact applied harnesses directly on the provider card
                                Row(
                                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    if (appliedHarnesses.isEmpty()) {
                                        Surface(
                                            shape = RoundedCornerShape(999.dp),
                                            color = c.sunken,
                                            border = BorderStroke(0.5.dp, c.borderSubtle),
                                            modifier = Modifier.clickable(enabled = state.canWrite) { applyingProvider = row }
                                        ) {
                                            Text("尚未应用到引擎", fontSize = 11.5.sp, color = c.textSecondary, modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp))
                                        }
                                    } else {
                                        appliedHarnesses.forEach { h ->
                                            Surface(
                                                shape = RoundedCornerShape(999.dp),
                                                color = c.accentTint,
                                                border = BorderStroke(0.5.dp, c.accent.copy(alpha = 0.35f)),
                                                modifier = Modifier.clickable(enabled = state.canWrite) { applyingProvider = row }
                                            ) {
                                                Row(
                                                    Modifier.padding(start = 5.dp, end = 9.dp, top = 3.dp, bottom = 3.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                                                ) {
                                                    EngineBadge(h.id, 16.dp, circle = false)
                                                    Text(if (h.id == "kodo") "Kooyu" else h.name, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = c.text, maxLines = 1)
                                                }
                                            }
                                        }
                                    }
                                }

                                // Endpoints list with protocol badge & refresh
                                row.optJSONArray("endpoints")?.objects()?.forEach { endpoint ->
                                    Surface(shape = RoundedCornerShape(10.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                                        Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(
                                                    protocolShortName(endpoint.optString("protocol")),
                                                    fontSize = 11.5.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    color = c.text
                                                )
                                                Text(
                                                    endpoint.optString("baseUrl").ifBlank { endpoint.optString("name") },
                                                    fontSize = 11.sp,
                                                    fontFamily = FontFamily.Monospace,
                                                    color = c.textSecondary,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                            }
                                            TextButton(
                                                onClick = { scope.launch { if (model.execute("/providers/" + row.getString("id") + "/endpoints/" + endpoint.getString("id") + "/models/refresh") != null) revision++ } },
                                                enabled = state.canWrite,
                                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                                            ) { Text("获取模型", fontSize = 11.5.sp, color = c.text) }
                                        }
                                    }
                                }

                                // Default-collapsed model list accordion
                                Surface(
                                    shape = RoundedCornerShape(10.dp),
                                    color = c.sunken,
                                    border = BorderStroke(0.5.dp, c.borderSubtle),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column {
                                        Row(
                                            Modifier
                                                .fillMaxWidth()
                                                .clickable { modelsExpanded = !modelsExpanded }
                                                .padding(horizontal = 11.dp, vertical = 9.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            Icon(
                                                if (modelsExpanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,
                                                null,
                                                tint = c.textSecondary,
                                                modifier = Modifier.size(16.dp)
                                            )
                                            Text("模型列表", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                            Text("${providerModels.size}", fontSize = 11.5.sp, fontFamily = FontFamily.Monospace, color = c.textTertiary)
                                        }
                                        AnimatedVisibility(modelsExpanded) {
                                            Column(Modifier.padding(start = 11.dp, end = 11.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                                if (providerModels.isEmpty()) {
                                                    Text("暂无模型，点击上方「获取模型」或在「模型」分页手动添加。", fontSize = 12.sp, color = c.textTertiary)
                                                } else {
                                                    providerModels.distinctBy { it.optString("model") }.forEach { m ->
                                                        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                                            Text(
                                                                m.optString("model"),
                                                                fontSize = 12.sp,
                                                                fontFamily = FontFamily.Monospace,
                                                                color = c.text,
                                                                maxLines = 1,
                                                                overflow = TextOverflow.Ellipsis,
                                                                modifier = Modifier.weight(1f)
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
                }
            }
            if (section == "defaults") BindingDefaultsEditor(state, model)
        }
    }
    if (embedded) content(PaddingValues()) else FullScreenPage("模型来源与绑定", close, content = content)

    applyingProvider?.let { prov ->
        val c = Kooyu.colors
        val provId = prov.optString("id")
        val provName = prov.optString("name")
        val provEndpoints = prov.optJSONArray("endpoints")?.objects().orEmpty()
        val provModels = allModels.filter { it.optString("providerId") == provId }
        val compatHarnesses = state.harnesses.filter { h ->
            provEndpoints.any { ep -> isHarnessProtocolCompatible(h.id, ep.optString("protocol")) }
        }
        var sheetError by remember(provId) { mutableStateOf("") }
        var busyHarness by remember(provId) { mutableStateOf<String?>(null) }

        ModalBottomSheet(
            onDismissRequest = { applyingProvider = null },
            containerColor = c.raised,
            dragHandle = { KooyuSheetHandle() },
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 18.dp)
                    .padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("将「$provName」应用到引擎", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text)
                if (provModels.isEmpty()) {
                    Text("此来源暂无可用模型，请先点击「获取模型」或手动添加模型。", fontSize = 13.sp, color = c.textSecondary)
                } else if (compatHarnesses.isEmpty()) {
                    Text("当前没有与此来源协议兼容的执行引擎。", fontSize = 13.sp, color = c.textSecondary)
                } else {
                    Column(
                        Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        compatHarnesses.forEach { h ->
                            val currentBinding = activeBindingFor(h.id)
                            val isApplied = currentBinding?.optString("providerId") == provId
                            val compatEps = provEndpoints.filter { ep -> isHarnessProtocolCompatible(h.id, ep.optString("protocol")) }
                            val chosenEp = compatEps.firstOrNull { ep -> ep.optString("id") == currentBinding?.optString("endpointId") }
                                ?: compatEps.firstOrNull { ep -> ep.optString("protocol") in (harnessNativeProtocols[h.id] ?: emptySet()) }
                                ?: compatEps.firstOrNull()
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = if (isApplied) c.accentTint else c.sunken,
                                border = BorderStroke(0.5.dp, if (isApplied) c.accent.copy(alpha = 0.4f) else c.borderSubtle),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    EngineBadge(h.id, 28.dp, circle = false)
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(if (h.id == "kodo") "Kooyu" else h.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                        Text(
                                            if (isApplied) "已应用 · ${protocolShortName(chosenEp?.optString("protocol").orEmpty())}"
                                            else "原生配置 · ${protocolShortName(chosenEp?.optString("protocol").orEmpty())}",
                                            fontSize = 11.5.sp,
                                            color = c.textSecondary
                                        )
                                    }
                                    Switch(
                                        checked = isApplied,
                                        enabled = state.canWrite && busyHarness == null && chosenEp != null,
                                        onCheckedChange = { enable ->
                                            val ep = chosenEp ?: return@Switch
                                            scope.launch {
                                                busyHarness = h.id
                                                sheetError = ""
                                                try {
                                                    val defaultsObj = model.state.value.snapshot.optJSONObject("bindingDefaults")
                                                    val rev = defaultsObj?.optInt("revision") ?: 0
                                                    val ok = if (!enable) {
                                                        val map = JSONObject(defaultsObj?.optJSONObject("harnessBindingIds")?.toString() ?: "{}")
                                                        map.put(h.id, JSONObject.NULL)
                                                        model.execute(
                                                            "/binding-defaults",
                                                            "PATCH",
                                                            JSONObject().put("expectedRevision", rev).put("harnessBindingIds", map)
                                                        ) != null
                                                    } else {
                                                        model.execute(
                                                            "/harness-provider-bindings",
                                                            "POST",
                                                            JSONObject()
                                                                .put("harnessId", h.id)
                                                                .put("providerId", provId)
                                                                .put("endpointId", ep.getString("id"))
                                                                .put("expectedDefaultsRevision", rev)
                                                        ) != null
                                                    }
                                                    if (ok) revision++ else sheetError = model.state.value.error
                                                } finally {
                                                    busyHarness = null
                                                }
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
                if (sheetError.isNotBlank()) Text(sheetError, fontSize = 12.sp, color = c.destructive)
            }
        }
    }

    editor?.let { kind -> ConfigurationEditor(kind, original, data ?: JSONObject(), state, model, { editor = null }) { editor = null; revision++ } }
    deleting?.let { (kind, row) -> ConfirmDialog("删除此配置？", row.optString("name", row.optString("model")) + "，正在使用的配置以设备检查结果为准。", "删除", { deleting = null }) { scope.launch {
        val path = if (kind == "providers") "/providers/" else "/provider-models/"
        if (model.execute(path + row.getString("id"), "DELETE", null) != null) { deleting = null; revision++ }
    } } }
}

@Composable private fun ConfigurationEditor(kind: String, original: JSONObject?, config: JSONObject, state: WorkbenchState, model: Workbench, close: () -> Unit, saved: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(original?.optString("name") ?: "") }
    var endpoints by remember { mutableStateOf(original?.optJSONArray("endpoints")?.objects()?.map(::editableEndpoint) ?: listOf(JSONObject().put("name", "API").put("protocol", "openai-completions").put("baseUrl", ""))) }
    val providers = config.optJSONArray("providers")?.objects() ?: emptyList()
    var provider by remember { mutableStateOf(original?.optString("providerId") ?: providers.firstOrNull()?.optString("id") ?: "") }
    var endpoint by remember { mutableStateOf(original?.optString("endpointId") ?: "") }
    var modelId by remember { mutableStateOf(original?.optString(if (kind == "bindings") "modelId" else "model") ?: "") }
    var harness by remember { mutableStateOf(original?.optString("harnessId") ?: "kodo") }
    var reasoning by remember { mutableStateOf(original?.nullableString("reasoning") ?: "") }
    var route by remember { mutableStateOf(original?.optString("route", "auto") ?: "auto") }; var selection by remember { mutableStateOf(original?.optString("selectionMode", "fixed") ?: "fixed") }
    var asDefault by remember { mutableStateOf(false) }
    val defaultsRevision = remember { state.snapshot.optJSONObject("bindingDefaults")?.optInt("revision") ?: 0 }
    var context by remember { mutableStateOf(original?.optJSONObject("overrides")?.nullableNumber("contextWindow")?.toLong()?.toString() ?: "") }
    var maxOutput by remember { mutableStateOf(original?.optJSONObject("overrides")?.nullableNumber("maxOutputTokens")?.toLong()?.toString() ?: "") }
    var thinking by remember { mutableStateOf(original?.optJSONObject("overrides")?.opt("reasoning")?.toString()?.takeIf { it in listOf("true", "false") } ?: "auto") }
    var inputKind by remember { mutableStateOf(original?.optJSONObject("overrides")?.optJSONArray("input")?.let { if (it.toString().contains("image")) "image" else "text" } ?: "auto") }
    var inputPrice by remember { mutableStateOf(original?.optJSONObject("overrides")?.optJSONObject("pricing")?.nullableNumber("input")?.toString() ?: "") }
    var outputPrice by remember { mutableStateOf(original?.optJSONObject("overrides")?.optJSONObject("pricing")?.nullableNumber("output")?.toString() ?: "") }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    fun bindingBody() = JSONObject().put("name", name.trim()).put("harnessId", harness).put("modelId", modelId).put("reasoning", reasoning.ifEmpty { null } ?: JSONObject.NULL).put("route", route).put("selectionMode", selection).apply {
        original?.let { put("id", it.getString("id")); put("expectedRevision", it.getInt("revision")) }
        if (asDefault) { put("applyAsDefault", true); put("expectedDefaultsRevision", defaultsRevision) }
    }
    val valid = name.isNotBlank() && name.trim().length <= (if (kind == "models") 200 else 100) && when (kind) {
        "providers" -> endpoints.isNotEmpty() && endpoints.all { e -> e.optString("name").isNotBlank() && runCatching { val uri = java.net.URI(e.optString("baseUrl")); uri.scheme in listOf("http", "https") && uri.host != null && uri.userInfo == null }.getOrDefault(false) }
        "models" -> provider.isNotBlank() && endpoint.isNotBlank() && modelId.isNotBlank() && listOf(context, maxOutput).all { it.isBlank() || (it.toLongOrNull() ?: 0) > 0 } && listOf(inputPrice, outputPrice).all { it.isBlank() || it.toDoubleOrNull()?.let { n -> n.isFinite() && n >= 0 } == true }
        else -> modelId.isNotBlank()
    }
    FullScreenPage(if (original == null) "添加配置" else "编辑配置", close, actions = { TextButton(onClick = { scope.launch {
        val path: String; val body: JSONObject
        when (kind) {
            "providers" -> { path = "/providers"; body = providerSaveBody(original, name, endpoints) }
            "models" -> {
                path = "/provider-models"
                val overrides = JSONObject(original?.optJSONObject("overrides")?.toString() ?: "{}")
                if (context.isBlank()) overrides.remove("contextWindow") else overrides.put("contextWindow", context.toLong())
                if (maxOutput.isBlank()) overrides.remove("maxOutputTokens") else overrides.put("maxOutputTokens", maxOutput.toLong())
                if (thinking == "auto") overrides.remove("reasoning") else overrides.put("reasoning", thinking == "true")
                if (inputKind == "auto") overrides.remove("input") else overrides.put("input", JSONArray(if (inputKind == "image") listOf("text", "image") else listOf("text")))
                val pricing = JSONObject(overrides.optJSONObject("pricing")?.toString() ?: "{}")
                if (inputPrice.isBlank()) pricing.remove("input") else pricing.put("input", inputPrice.toDouble())
                if (outputPrice.isBlank()) pricing.remove("output") else pricing.put("output", outputPrice.toDouble())
                if (pricing.length() > 0) overrides.put("pricing", pricing) else overrides.remove("pricing")
                body = JSONObject().put("name", name.trim()).put("providerId", provider).put("endpointId", endpoint).put("model", modelId.trim()).put("overrides", overrides)
                original?.let { body.put("id", it.getString("id")).put("expectedRevision", it.getInt("revision")) }
            }
            else -> { path = "/harness-bindings"; body = bindingBody() }
        }
        if (model.execute(path, body = body) != null) saved()
    } }, enabled = state.canWrite && valid) { Text("保存") } }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("名称") }, modifier = Modifier.fillMaxWidth())
            when (kind) {
                "providers" -> {
                    endpoints.forEachIndexed { index, value ->
                        fun set(key: String, text: String) { endpoints = endpoints.mapIndexed { i, e -> if (i == index) JSONObject(e.toString()).apply { if (text.isEmpty() && key in listOf("apiKey", "modelsUrl")) remove(key) else put(key, text) } else e } }
                        Text("端点 " + (index + 1), style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(value.optString("name"), { set("name", it) }, label = { Text("端点名称") })
                        ChoiceField("API 协议", value.optString("protocol"), endpointProtocols.map { it to it }) { set("protocol", it) }
                        OutlinedTextField(value.optString("baseUrl"), { set("baseUrl", it.trim()) }, label = { Text("模型 API Base URL") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value.optString("modelsUrl"), { set("modelsUrl", it.trim()) }, label = { Text("模型发现地址（可选）") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value.optString("apiKey"), { set("apiKey", it) }, label = { Text(if (value.has("id")) "新 API Key（留空保留）" else "API Key") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                        Row { Checkbox(value.optBoolean("clearCredential"), { clear -> endpoints = endpoints.mapIndexed { i, e -> if (i == index) JSONObject(e.toString()).put("clearCredential", clear) else e } }); Text("清除已保存的 API Key", Modifier.padding(top = 12.dp)) }
                        if (endpoints.size > 1) TextButton(onClick = { endpoints = endpoints.filterIndexed { i, _ -> i != index } }) { Text("移除此端点") }
                        HorizontalDivider()
                    }
                    TextButton(onClick = { endpoints = endpoints + JSONObject().put("name", "API").put("protocol", "openai-completions").put("baseUrl", "") }, enabled = endpoints.size < 12) { Text("添加端点") }
                }
                "models" -> {
                    ChoiceField("模型来源", provider, providers.map { it.getString("id") to it.getString("name") }) { provider = it; endpoint = "" }
                    val options = providers.firstOrNull { it.optString("id") == provider }?.optJSONArray("endpoints")?.objects() ?: emptyList()
                    ChoiceField("端点", endpoint, options.map { it.getString("id") to it.getString("name") }) { endpoint = it }
                    OutlinedTextField(modelId, { modelId = it }, label = { Text("模型 ID") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(context, { context = it }, label = { Text("上下文 Token（留空自动）") })
                    OutlinedTextField(maxOutput, { maxOutput = it }, label = { Text("最大输出 Token（留空自动）") })
                    ChoiceField("输入能力", inputKind, listOf("auto" to "跟随目录或端点", "text" to "文本", "image" to "文本与图像")) { inputKind = it }
                    ChoiceField("思考能力", thinking, listOf("auto" to "跟随目录或端点", "true" to "支持思考", "false" to "不支持思考")) { thinking = it }
                    OutlinedTextField(inputPrice, { inputPrice = it }, label = { Text("输入 USD / 百万 Token（可选）") })
                    OutlinedTextField(outputPrice, { outputPrice = it }, label = { Text("输出 USD / 百万 Token（可选）") })
                }
                else -> {
                    ChoiceField("执行引擎", harness, state.harnesses.map { it.id to it.name }) { harness = it; preview = null }
                    val models = config.optJSONArray("models")?.objects() ?: emptyList()
                    ChoiceField("模型", modelId, models.map { it.getString("id") to (it.optString("name") + " · " + it.optString("model")) }) { modelId = it; preview = null }
                    ChoiceField("选择方式", selection, listOf("fixed" to "固定模型", "provider" to "此来源下选择模型")) { selection = it }
                    ChoiceField("接入路由", route, listOf("auto" to "自动", "direct" to "直连", "gateway" to "网关")) { route = it; preview = null }
                    OutlinedTextField(reasoning, { reasoning = it }, label = { Text("思考强度（可选）") })
                    Row { Checkbox(asDefault, { asDefault = it }); Text("设为此设备的引擎默认绑定", Modifier.padding(top = 12.dp)) }
                    TextButton(onClick = { scope.launch { preview = model.execute("/harness-bindings/preview", body = bindingBody(), refreshAfter = false) } }, enabled = state.canWrite && valid) { Text("检查兼容性") }
                    preview?.let { plan -> Text(if (plan.optBoolean("supported")) "兼容 · " + plan.optString("route") else "此配置尚不能使用"); plan.optJSONArray("issues")?.let { issues -> (0 until issues.length()).forEach { Text(issues.getString(it), color = MaterialTheme.colorScheme.error) } } }
                }
            }
            if (state.error.isNotBlank()) Text(state.error, color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable private fun BindingDefaultsEditor(state: WorkbenchState, model: Workbench) {
    var project by remember { mutableStateOf("") }; var mapping by remember { mutableStateOf(JSONObject()) }
    var expectedRevision by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val rawProject = state.snapshot.optJSONArray("projects")?.objects()?.firstOrNull { it.optString("id") == project }
    val defaults = if (project.isEmpty()) state.snapshot.optJSONObject("bindingDefaults")?.optJSONObject("harnessBindingIds") else rawProject?.optJSONObject("bindingDefaults")
    fun loadDefaults() {
        mapping = JSONObject(defaults?.toString() ?: "{}")
        expectedRevision = if (project.isEmpty()) state.snapshot.optJSONObject("bindingDefaults")?.optInt("revision") ?: 0 else rawProject?.optInt("configRevision") ?: 0
    }
    LaunchedEffect(project) { loadDefaults() }
    ChoiceField("默认值范围", project, listOf("" to "当前设备") + state.projects) { project = it }
    state.harnesses.forEach { h -> ChoiceField(h.name, mapping.nullableString(h.id) ?: "", listOf("" to if (project.isEmpty()) "引擎原生默认" else "继承设备默认") + state.bindings.filter { it.optString("harnessId") == h.id }.map { it.getString("id") to it.getString("name") }) { value -> mapping = JSONObject(mapping.toString()).put(h.id, value.ifEmpty { null } ?: JSONObject.NULL) } }
    Button(onClick = { scope.launch {
        val body = JSONObject().put("expectedRevision", expectedRevision).put(if (project.isEmpty()) "harnessBindingIds" else "bindingDefaults", mapping)
        model.execute(if (project.isEmpty()) "/binding-defaults" else "/projects/" + project + "/binding-defaults", "PATCH", body)?.let { result ->
            expectedRevision = result.optInt(if (project.isEmpty()) "revision" else "configRevision", expectedRevision)
        }
    } }, enabled = state.canWrite, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = Kooyu.colors.accent, contentColor = Kooyu.colors.onAccent)) { Text("保存默认绑定", fontWeight = FontWeight.SemiBold) }
    TextButton(onClick = { loadDefaults() }, enabled = !state.busy) { Text("重新读取默认值") }
}

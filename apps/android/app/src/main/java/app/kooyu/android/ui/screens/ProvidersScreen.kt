package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

val endpointProtocols = listOf("openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai")
fun providerSaveBody(original: JSONObject?, name: String, endpoints: List<JSONObject>): JSONObject = JSONObject().put("name", name.trim()).put("endpoints", JSONArray(endpoints)).apply {
    original?.nullableString("id")?.let { put("id", it); put("expectedRevision", original.getInt("revision")) }
    original?.nullableString("catalogProvider")?.let { put("catalogProvider", it) }
}
fun editableEndpoint(value: JSONObject): JSONObject = JSONObject().apply {
    listOf("id", "name", "protocol", "baseUrl", "modelsUrl").forEach { key -> if (!value.isNull(key)) put(key, value.get(key)) }
}

@Composable fun ModelConfigurationScreen(state: WorkbenchState, model: Workbench, embedded: Boolean = false, close: () -> Unit) {
    var section by remember { mutableStateOf("providers") }; var data by remember { mutableStateOf<JSONObject?>(null) }
    var revision by remember { mutableIntStateOf(0) }; var loading by remember { mutableStateOf(true) }
    var editor by remember { mutableStateOf<String?>(null) }; var original by remember { mutableStateOf<JSONObject?>(null) }
    var deleting by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.connection?.hostId, revision) { loading = true; data = model.read("/provider-configuration"); loading = false }
    val content: @Composable (PaddingValues) -> Unit = { padding ->
        val c = Kooyu.colors
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            ChoiceField("管理内容", section, listOf("providers" to "模型来源", "models" to "模型", "bindings" to "引擎绑定", "defaults" to "默认配置")) { section = it }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.accent)
            if (state.error.isNotBlank()) Text(state.error, color = c.destructive)
            if (!loading && data == null) TextButton(onClick = { revision++ }) { Text("读取失败，重试", color = c.destructive) }
            if (data != null && section != "defaults") {
                Button(
                    onClick = { original = null; editor = section },
                    enabled = state.canWrite,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                ) {
                    Icon(Icons.Outlined.Add, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("添加" + when (section) { "providers" -> "模型来源"; "models" -> "模型"; else -> "绑定" }, fontWeight = FontWeight.SemiBold)
                }
                val rows = data!!.optJSONArray(section)?.objects() ?: emptyList()
                if (rows.isEmpty()) Text("暂无配置。", color = c.textSecondary, modifier = Modifier.padding(vertical = 12.dp))
                rows.forEach { row ->
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = c.raised,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(row.optString("name", row.optString("model")), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.text)
                                    Text(if (section == "providers") "${row.optJSONArray("endpoints")?.length() ?: 0} 个 API 端点" else "${row.optString("harnessId")} · ${row.optString("model")}", fontSize = 12.sp, color = c.textSecondary, fontFamily = FontFamily.Monospace)
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    TextButton(onClick = { original = row; editor = section }, enabled = state.canWrite) { Text("编辑", color = c.text) }
                                    if (section != "bindings") TextButton(onClick = { deleting = section to row }, enabled = state.canWrite) { Text("删除", color = c.destructive) }
                                }
                            }
                            if (section == "providers") row.optJSONArray("endpoints")?.objects()?.forEach { endpoint ->
                                Surface(shape = RoundedCornerShape(8.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                                    Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(endpoint.optString("name"), fontSize = 12.sp, color = c.textSecondary, modifier = Modifier.weight(1f))
                                        TextButton(onClick = { scope.launch { if (model.execute("/providers/" + row.getString("id") + "/endpoints/" + endpoint.getString("id") + "/models/refresh") != null) revision++ } }, enabled = state.canWrite) { Text("发现模型", fontSize = 11.5.sp, color = c.text) }
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

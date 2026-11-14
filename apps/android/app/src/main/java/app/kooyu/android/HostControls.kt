package app.kooyu.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun HistorySearchScreen(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    var query by remember { mutableStateOf("") }; var data by remember { mutableStateOf<JSONObject?>(null) }; var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(query, state.connection?.hostId) { data = null; if (query.isNotBlank()) { loading = true; delay(300); data = model.read("/search?q=" + encoded(query.trim())); loading = false } else loading = false }
    FullScreenPage("搜索会话与历史", close) { padding -> LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { OutlinedTextField(query, { query = it.take(1000) }, label = { Text("搜索当前电脑的历史内容") }, modifier = Modifier.fillMaxWidth()); if (loading) LinearProgressIndicator(Modifier.fillMaxWidth()) }
        val sessions = data?.optJSONArray("sessions")?.objects() ?: emptyList()
        val hits = data?.optJSONArray("hits")?.objects() ?: emptyList()
        if (query.isNotBlank() && !loading && data != null && sessions.isEmpty() && hits.isEmpty()) item { Text("没有匹配结果。") }
        items(sessions, key = { "session-" + it.getString("id") }) { session -> TextButton(onClick = { model.select(session.getString("id")); close() }) { Text(session.getString("title")) } }
        items(hits, key = { "hit-" + it.getString("sessionId") + it.getString("eventId") }) { hit ->
            TextButton(onClick = { scope.launch { if (model.openSearchHit(hit.getString("sessionId"), hit.getString("eventId"))) close() } }) { Text(state.sessions.firstOrNull { it.id == hit.optString("sessionId") }?.title ?: "历史消息") }
            SelectionContainer { Text(hit.optString("snippet"), style = MaterialTheme.typography.bodySmall) }; HorizontalDivider()
        }
        if (state.error.isNotEmpty()) item { Text(state.error, color = MaterialTheme.colorScheme.error) }
    } }
}

@Composable fun HostControlsScreen(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    var controller by remember { mutableStateOf("") }; var target by remember { mutableStateOf("") }; var mode by remember { mutableStateOf("observe") }
    var goal by remember { mutableStateOf("") }; var continuous by remember { mutableStateOf(false) }; var trigger by remember { mutableStateOf("turn-ended") }
    var continuations by remember { mutableStateOf("") }; var failures by remember { mutableStateOf("") }; var budget by remember { mutableStateOf("") }; var endAt by remember { mutableStateOf("") }
    var project by remember { mutableStateOf("") }; var grantMode by remember { mutableStateOf("create-only") }; var confirm by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val limitsValid = listOf(continuations, failures).all { it.isBlank() || (it.toIntOrNull() ?: 0) > 0 } && (budget.isBlank() || budget.toDoubleOrNull()?.let { it.isFinite() && it > 0 } == true) && (endAt.isBlank() || runCatching { java.time.Instant.parse(endAt) }.isSuccess)
    fun limits() = JSONObject().apply { continuations.toIntOrNull()?.let { put("maxContinuations", it) }; failures.toIntOrNull()?.let { put("maxFailures", it) }; budget.toDoubleOrNull()?.let { put("budgetUsd", it) }; if (endAt.isNotBlank()) put("endAt", endAt) }
    fun body() = JSONObject().put("controllerSessionId", controller).put("targetSessionId", target).put("mode", mode).put("goal", goal).put("continuous", continuous).put("trigger", trigger).put("limits", limits())
    FullScreenPage("托管与项目授权", close) { padding -> LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("当前托管", style = MaterialTheme.typography.titleLarge) }
        val watches = state.snapshot.optJSONArray("supervisions")?.objects() ?: emptyList()
        if (watches.isEmpty()) item { Text("暂无托管关系。") }
        items(watches, key = { it.getString("id") }) { watch ->
            Text((state.sessions.firstOrNull { it.id == watch.optString("controllerSessionId") }?.title ?: "控制会话") + " → " + (state.sessions.firstOrNull { it.id == watch.optString("targetSessionId") }?.title ?: "目标会话"))
            Text(watch.optString("mode") + " · " + watch.optString("state") + " · 已继续 " + watch.optInt("continuations") + " 次", style = MaterialTheme.typography.bodySmall)
            Row {
                if (watch.optString("state") == "active") TextButton(onClick = { scope.launch { model.execute("/watches/" + watch.getString("id"), "PATCH", JSONObject().put("state", "paused")) } }, enabled = state.canWrite) { Text("暂停") }
                if (watch.optString("state") != "revoked") TextButton(onClick = { confirm = "revoke:" + watch.getString("id") }, enabled = state.canWrite) { Text("撤销托管") }
            }; HorizontalDivider()
        }
        item {
            Text("创建托管", style = MaterialTheme.typography.titleLarge)
            ChoiceField("控制会话", controller, listOf("" to "请选择主对话") + state.sessions.filter { !it.archived && it.raw.optString("kind") == "supervisor" }.map { it.id to it.title }) { controller = it; if (target == it) target = "" }
            ChoiceField("目标会话", target, listOf("" to "请选择") + state.sessions.filter { !it.archived && it.id != controller }.map { it.id to it.title }) { target = it }
            ChoiceField("托管模式", mode, listOf("observe" to "仅观察", "notify" to "通知", "continue" to "自动继续")) { mode = it }
            OutlinedTextField(goal, { goal = it.take(10000) }, label = { Text("目标与边界") }, modifier = Modifier.fillMaxWidth())
            Row { Checkbox(continuous, { continuous = it }); Text("持续托管", Modifier.padding(top = 12.dp)) }
            ChoiceField("触发时机", trigger, listOf("turn-ended" to "回合结束", "settled" to "任务稳定结束")) { trigger = it }
            OutlinedTextField(continuations, { continuations = it }, label = { Text("最大继续次数（可选）") })
            OutlinedTextField(failures, { failures = it }, label = { Text("最大连续失败（可选）") })
            OutlinedTextField(budget, { budget = it }, label = { Text("费用上限 USD（可选）") })
            OutlinedTextField(endAt, { endAt = it }, label = { Text("截止时间 ISO 8601（可选）") })
            Button(onClick = { confirm = "create" }, enabled = state.canWrite && controller.isNotEmpty() && target.isNotEmpty() && limitsValid) { Text("创建托管") }
            if (mode == "continue") OutlinedButton(onClick = { confirm = "transfer" }, enabled = state.canWrite && controller.isNotEmpty() && target.isNotEmpty() && limitsValid) { Text("转交目标的控制权") }
            HorizontalDivider(Modifier.padding(vertical = 12.dp))
            Text("项目授权", style = MaterialTheme.typography.titleLarge)
            ChoiceField("授权项目", project, listOf("" to "请选择项目") + state.projects) { project = it }
            ChoiceField("授权能力", grantMode, listOf("create-only" to "只可创建", "create-and-control" to "可创建与控制", "revoke" to "撤销授权")) { grantMode = it }
            Button(onClick = { confirm = "grant" }, enabled = state.canWrite && controller.isNotEmpty() && project.isNotEmpty() && limitsValid) { Text("提交项目授权") }
            if (state.error.isNotEmpty()) Text(state.error, color = MaterialTheme.colorScheme.error)
        }
    } }
    confirm?.let { action -> ConfirmDialog("确认提交到当前电脑？", when { action == "transfer" -> "旧控制者的待发操作将失去控制权。"; action == "create" -> if (mode == "continue") "允许主对话按上述边界自动继续目标会话。" else "按所选模式建立托管关系。"; action == "grant" -> "将以所选能力更新此主对话的项目授权。"; else -> "撤销当前托管关系。" }, "确认", { confirm = null }) { confirm = null; scope.launch {
        when {
            action.startsWith("revoke:") -> model.execute("/watches/" + action.removePrefix("revoke:"), "PATCH", JSONObject().put("state", "revoked"))
            action == "grant" -> model.execute("/sessions/" + controller + "/grant", body = JSONObject().put("projectId", project).put("mode", grantMode).put("goal", goal).put("limits", limits()))
            else -> model.execute(if (action == "transfer") "/watches/transfer" else "/watches", body = body())
        }
    } } }
}

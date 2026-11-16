package app.kooyu.android

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun HistorySearchScreen(state: WorkbenchState, model: Workbench, close: () -> Unit) {
    var query by remember { mutableStateOf("") }; var data by remember { mutableStateOf<JSONObject?>(null) }; var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(query, state.connection?.hostId) { data = null; if (query.isNotBlank()) { loading = true; delay(300); data = model.read("/search?q=" + encoded(query.trim())); loading = false } else loading = false }
    FullScreenPage("搜索会话与历史", close) { padding -> LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { OutlinedTextField(query, { query = it.take(1000) }, label = { Text("搜索当前设备的历史内容") }, modifier = Modifier.fillMaxWidth()); if (loading) LinearProgressIndicator(Modifier.fillMaxWidth()) }
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
    var controller by remember { mutableStateOf("") }
    var target by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("observe") }
    var goal by remember { mutableStateOf("") }
    var continuous by remember { mutableStateOf(false) }
    var trigger by remember { mutableStateOf("turn-ended") }
    var continuations by remember { mutableStateOf("0") }
    var failures by remember { mutableStateOf("0") }
    var budget by remember { mutableStateOf("0") }
    var endAt by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val c = Kooyu.colors

    val limitsValid = listOf(continuations, failures).all { it.isBlank() || (it.toIntOrNull() ?: -1) >= 0 } &&
        (budget.isBlank() || budget.toDoubleOrNull()?.let { it.isFinite() && it >= 0 } == true) &&
        (endAt.isBlank() || runCatching { java.time.Instant.parse(endAt) }.isSuccess)

    fun limits() = JSONObject().apply {
        put("maxContinuations", continuations.toIntOrNull() ?: 0)
        put("maxFailures", failures.toIntOrNull() ?: 0)
        put("budgetUsd", budget.toDoubleOrNull() ?: 0.0)
        if (endAt.isNotBlank()) put("endAt", endAt)
    }

    fun body() = JSONObject()
        .put("controllerSessionId", controller)
        .put("targetSessionId", target)
        .put("mode", mode)
        .put("goal", goal)
        .put("continuous", continuous)
        .put("trigger", trigger)
        .put("limits", limits())

    FullScreenPage("会话托管", close) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("当前托管", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.text)
                }
            }

            val watches = state.snapshot.optJSONArray("supervisions")?.objects() ?: emptyList()
            if (watches.isEmpty()) {
                item {
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = c.raised,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 28.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("暂无托管关系。", fontSize = 13.5.sp, color = c.textTertiary)
                        }
                    }
                }
            }

            items(watches, key = { it.getString("id") }) { watch ->
                val controllerTitle = state.sessions.firstOrNull { it.id == watch.optString("controllerSessionId") }?.title ?: "控制会话"
                val targetTitle = state.sessions.firstOrNull { it.id == watch.optString("targetSessionId") }?.title ?: "目标会话"
                val watchState = watch.optString("state")
                val watchMode = watch.optString("mode")

                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Surface(shape = CircleShape, color = c.accentTint) {
                                    Text(
                                        when (watchMode) {
                                            "continue" -> "自动继续"
                                            "notify" -> "通知"
                                            else -> "仅观察"
                                        },
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = c.accent,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                    )
                                }
                                Surface(
                                    shape = CircleShape,
                                    color = when (watchState) {
                                        "active" -> c.successTint
                                        "paused" -> c.infoTint
                                        else -> c.sunken
                                    }
                                ) {
                                    Text(
                                        when (watchState) {
                                            "active" -> "运行中"
                                            "paused" -> "已暂停"
                                            "revoked" -> "已撤销"
                                            else -> watchState
                                        },
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = when (watchState) {
                                            "active" -> c.success
                                            "paused" -> c.info
                                            else -> c.textTertiary
                                        },
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                    )
                                }
                            }
                            Text(
                                "已继续 ${watch.optInt("continuations")} 次",
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                color = c.textSecondary
                            )
                        }

                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(controllerTitle, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text)
                            Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, Modifier.size(14.dp), tint = c.textTertiary)
                            Text(targetTitle, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text)
                        }

                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (watchState == "active") {
                                FilledTonalButton(
                                    onClick = {
                                        scope.launch {
                                            model.execute("/watches/" + watch.getString("id"), "PATCH", JSONObject().put("state", "paused"))
                                        }
                                    },
                                    enabled = state.canWrite,
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                    Text("暂停", fontSize = 12.sp)
                                }
                                Spacer(Modifier.width(8.dp))
                            }
                            if (watchState != "revoked") {
                                OutlinedButton(
                                    onClick = { confirm = "revoke:" + watch.getString("id") },
                                    enabled = state.canWrite,
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = c.destructive),
                                    border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.5f)),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                    Text("撤销托管", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }

            item {
                Text("创建托管", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.padding(top = 8.dp, start = 4.dp))
            }

            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        ChoiceField("控制会话", controller, listOf("" to "请选择主对话") + state.sessions.filter { !it.archived && it.raw.optString("kind") == "supervisor" }.map { it.id to it.title }) { controller = it; if (target == it) target = "" }
                        ChoiceField("目标会话", target, listOf("" to "请选择") + state.sessions.filter { !it.archived && it.id != controller }.map { it.id to it.title }) { target = it }
                        ChoiceField("托管模式", mode, listOf("observe" to "仅观察", "notify" to "通知", "continue" to "自动继续")) { mode = it }
                    }
                }
            }

            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp)
                        ) {
                            TextField(
                                value = goal,
                                onValueChange = { goal = it.take(10000) },
                                placeholder = { Text("目标与边界", fontSize = 13.5.sp, color = c.textTertiary) },
                                textStyle = TextStyle(fontSize = 13.5.sp, color = c.text),
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = Color.Transparent,
                                    unfocusedContainerColor = Color.Transparent,
                                    focusedIndicatorColor = Color.Transparent,
                                    unfocusedIndicatorColor = Color.Transparent,
                                    disabledIndicatorColor = Color.Transparent
                                ),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("持续托管", fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                            Switch(
                                checked = continuous,
                                onCheckedChange = { continuous = it },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = c.onAccent,
                                    checkedTrackColor = c.accent,
                                    uncheckedTrackColor = c.sunken,
                                    uncheckedBorderColor = c.borderSubtle
                                )
                            )
                        }
                        ChoiceField("触发时机", trigger, listOf("turn-ended" to "回合结束", "settled" to "任务稳定结束")) { trigger = it }
                    }
                }
            }

            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = c.sunken,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.weight(1f).heightIn(min = 56.dp)
                            ) {
                                TextField(
                                    value = continuations,
                                    onValueChange = { continuations = it },
                                    label = { Text("最大继续次数", fontSize = 12.sp, color = c.textSecondary) },
                                    singleLine = true,
                                    textStyle = TextStyle(fontSize = 13.sp, color = c.text),
                                    colors = TextFieldDefaults.colors(
                                        focusedContainerColor = Color.Transparent,
                                        unfocusedContainerColor = Color.Transparent,
                                        focusedIndicatorColor = Color.Transparent,
                                        unfocusedIndicatorColor = Color.Transparent,
                                        disabledIndicatorColor = Color.Transparent
                                    ),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = c.sunken,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.weight(1f).heightIn(min = 56.dp)
                            ) {
                                TextField(
                                    value = failures,
                                    onValueChange = { failures = it },
                                    label = { Text("最大连续失败", fontSize = 12.sp, color = c.textSecondary) },
                                    singleLine = true,
                                    textStyle = TextStyle(fontSize = 13.sp, color = c.text),
                                    colors = TextFieldDefaults.colors(
                                        focusedContainerColor = Color.Transparent,
                                        unfocusedContainerColor = Color.Transparent,
                                        focusedIndicatorColor = Color.Transparent,
                                        unfocusedIndicatorColor = Color.Transparent,
                                        disabledIndicatorColor = Color.Transparent
                                    ),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = c.sunken,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.weight(1f).heightIn(min = 56.dp)
                            ) {
                                TextField(
                                    value = budget,
                                    onValueChange = { budget = it },
                                    label = { Text("费用上限 USD", fontSize = 12.sp, color = c.textSecondary) },
                                    singleLine = true,
                                    textStyle = TextStyle(fontSize = 13.sp, color = c.text),
                                    colors = TextFieldDefaults.colors(
                                        focusedContainerColor = Color.Transparent,
                                        unfocusedContainerColor = Color.Transparent,
                                        focusedIndicatorColor = Color.Transparent,
                                        unfocusedIndicatorColor = Color.Transparent,
                                        disabledIndicatorColor = Color.Transparent
                                    ),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }

                        }
                        Text("0 表示不限制；留空保存时按 0 处理。", fontSize = 12.sp, color = c.textSecondary)
                        DeadlinePicker(endAt) { endAt = it }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { confirm = "create" },
                        enabled = state.canWrite && controller.isNotEmpty() && target.isNotEmpty() && limitsValid,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                        modifier = Modifier.fillMaxWidth().height(50.dp)
                    ) {
                        Text("创建托管", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }

                    if (mode == "continue") {
                        OutlinedButton(
                            onClick = { confirm = "transfer" },
                            enabled = state.canWrite && controller.isNotEmpty() && target.isNotEmpty() && limitsValid,
                            shape = CircleShape,
                            modifier = Modifier.fillMaxWidth().height(44.dp)
                        ) {
                            Text("转交目标的控制权", fontWeight = FontWeight.SemiBold)
                        }
                    }

                    if (state.error.isNotEmpty()) {
                        Text(state.error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }

    confirm?.let { action ->
        ConfirmDialog(
            "确认提交到当前设备？",
            when {
                action == "transfer" -> "旧控制者的待发操作将失去控制权。"
                action == "create" -> if (mode == "continue") "允许主对话按上述边界自动继续目标会话。" else "按所选模式建立托管关系。"
                else -> "撤销当前托管关系。"
            },
            "确认",
            { confirm = null }
        ) {
            confirm = null
            scope.launch {
                when {
                    action.startsWith("revoke:") -> model.execute("/watches/" + action.removePrefix("revoke:"), "PATCH", JSONObject().put("state", "revoked"))
                    else -> model.execute(if (action == "transfer") "/watches/transfer" else "/watches", body = body())
                }
            }
        }
    }
}

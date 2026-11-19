package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray

internal val workTemplates = listOf(
    "检查项目" to "请检查当前项目的结构和运行方式，指出需要优先处理的问题，并给出依据。",
    "修复并验证" to "请定位并修复以下问题，运行相关检查，并交付修改说明、验证结果和剩余限制：\n",
    "整理成果" to "请整理本项目当前工作的成果、实际验证记录和待处理事项，并关联来源对话。",
    "安排计划" to "请帮我创建一个自动计划。先与我确认工作内容、执行时间、时区、执行设备和次数或预算边界，再请求必要授权。"
)
internal fun workStatus(value: String) = when (value) {
    "draft" -> "草稿"; "active" -> "进行中"; "blocked" -> "等你处理"; "awaiting-review" -> "待验收"
    "completed" -> "已完成"; "cancelled" -> "已取消"; "passed" -> "检查通过"; "failed" -> "检查失败"
    "not-applicable" -> "无需验证"; "accepted" -> "已接收"; "deferred" -> "已延后"; "dispatched" -> "执行中"
    "confirmed" -> "已确认"; "observed" -> "已观察"; "unknown" -> "待核对"; else -> "未验证"
}
internal fun JSONObject.rows(key: String) = optJSONArray(key)?.objects().orEmpty()

internal fun planSchedule(trigger: JSONObject): String {
    if (trigger.optString("kind") == "webhook") return "收到事件时执行"
    if (trigger.optString("kind") == "interval") return "每隔 ${trigger.optInt("every")} " + when(trigger.optString("unit")) { "minutes" -> "分钟"; "days" -> "天"; else -> "小时" }
    if (trigger.optString("kind") == "calendar") { val timing=PlanTiming.from(trigger); return (when(timing.mode) { "once" -> timing.date; "daily" -> "每天"; "weekdays" -> "周一至周五"; "weekly" -> "每"+timing.weekdays.sorted().joinToString("、"){ listOf("周日","周一","周二","周三","周四","周五","周六")[it] }; else -> "每月 ${timing.day} 日" })+" "+timing.time }
    if (trigger.optString("kind") != "cron") return trigger.optString("at")
    val fields = trigger.optString("expression").trim().split(Regex("\\s+"))
    if (fields.size != 5 || fields[0].toIntOrNull() == null || fields[1].toIntOrNull() == null || fields[2] != "*" || fields[3] != "*") return "自定义时间 · ${trigger.optString("expression")}"
    val days = when (fields[4]) { "*" -> "每天"; "1-5" -> "每个工作日"; "0,6", "6,0" -> "每个周末"; "0", "7" -> "每周日"; "1" -> "每周一"; "2" -> "每周二"; "3" -> "每周三"; "4" -> "每周四"; "5" -> "每周五"; "6" -> "每周六"; else -> return "自定义时间 · ${trigger.optString("expression")}" }
    return "$days ${fields[1].padStart(2, '0')}:${fields[0].padStart(2, '0')}"
}

@Composable internal fun WorkRecovery(state: WorkbenchState, model: Workbench) {
    if (state.connection?.pending == null) return
    val scope = rememberCoroutineScope()
    var clearing by remember { mutableStateOf(false) }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = Kooyu.colors.raised,
        border = BorderStroke(0.5.dp, Kooyu.colors.borderSubtle),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(Modifier.size(6.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Kooyu.colors.info))
            Text("待核对事项", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Kooyu.colors.text, modifier = Modifier.weight(1f))
            Button(
                onClick = { scope.launch { model.refresh() } },
                enabled = !state.busy,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Kooyu.colors.sunken, contentColor = Kooyu.colors.text),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text("查询", fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
            Button(
                onClick = { clearing = true },
                enabled = !state.busy,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Kooyu.colors.accent, contentColor = Kooyu.colors.onAccent),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text("核对", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
    if (clearing) AlertDialog(
        onDismissRequest = { clearing = false },
        title = { Text("清除待核对标记") },
        text = { Text("核对完成并确认清除？") },
        confirmButton = { TextButton(onClick = { model.clearPending(); clearing = false }) { Text("确认") } },
        dismissButton = { TextButton(onClick = { clearing = false }) { Text("取消") } }
    )
}

@Composable fun WorkHubScreen(
    state: WorkbenchState,
    model: Workbench,
    initialProject: String = "",
    initialTab: String = "进行中与目标",
    embedded: Boolean = false,
    close: () -> Unit = {}
) {
    val scope = rememberCoroutineScope()
    var project by rememberSaveable(state.connection?.hostId) { mutableStateOf(initialProject) }
    val normalizedInitial = when (initialTab) {
        "交付成果", "成果" -> "交付成果"
        "自动计划" -> "自动计划"
        else -> "进行中与目标"
    }
    var tab by rememberSaveable { mutableStateOf(normalizedInitial) }
    var data by remember(state.connection?.hostId) { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var revision by remember { mutableIntStateOf(0) }
    var search by rememberSaveable { mutableStateOf("") }
    var attention by rememberSaveable { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    var goalId by remember { mutableStateOf<String?>(null) }
    var artifact by remember { mutableStateOf<JSONObject?>(null) }
    var plan by remember { mutableStateOf<JSONObject?>(null) }
    var composing by remember { mutableStateOf<String?>(null) }
    val c = Kooyu.colors
    suspend fun load() {
        loading = true; error = ""
        val value = model.read("/workbench" + if (project.isNotBlank()) "?projectId=${encoded(project)}" else "")
        data = value; if (value == null) error = "加载失败"
        loading = false
    }
    LaunchedEffect(state.connection?.hostId, project, revision) { data = null; load() }
    val tabs = listOf("进行中与目标", "交付成果", "自动计划")
    fun open(id: String) { if (state.sessions.any { it.id == id }) { model.select(id); close() } else error = "会话已移除" }

    val hubBody: @Composable (Modifier) -> Unit = { containerMod ->
        Column(containerMod.background(if (embedded) c.navigator else c.paper)) {
            if (embedded) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 18.dp, end = 16.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "工作",
                        fontSize = 30.sp,
                        lineHeight = 35.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.6).sp,
                        color = c.text
                    )
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = c.accent,
                        modifier = Modifier.clickable(enabled = state.canWrite) { composing = "" }
                    ) {
                        Row(Modifier.padding(horizontal = 11.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Outlined.Add, null, tint = c.onAccent, modifier = Modifier.size(14.dp))
                            Text("派发任务", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = c.onAccent)
                        }
                    }
                }
            }
            WorkRecovery(state, model)
            if (embedded) {
                val goalCount = data?.rows("goals")?.size ?: 0
                val artifactCount = data?.rows("artifacts")?.size ?: 0
                val planCount = data?.rows("plans")?.size ?: 0
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf(
                        Triple("进行中与目标", "进行中目标", goalCount),
                        Triple("交付成果", "交付成果", artifactCount),
                        Triple("自动计划", "自动计划", planCount)
                    ).forEach { (targetTab, label, cnt) ->
                        val active = tab == targetTab
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = c.raised,
                            border = BorderStroke(if (active) 1.dp else 0.5.dp, if (active) c.borderStrong else c.borderSubtle),
                            shadowElevation = if (c.dark || !active) 0.dp else 1.dp,
                            modifier = Modifier.weight(1f).clickable { tab = targetTab }
                        ) {
                            Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(cnt.toString(), fontSize = 19.sp, fontWeight = FontWeight.Bold, color = c.text)
                                Text(label, fontSize = 11.5.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium, color = c.textSecondary, maxLines = 1)
                            }
                        }
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = if (embedded) c.raised else c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.weight(1f).heightIn(min = 44.dp).clickable { choosing = true }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(if (project.isBlank()) "全部项目" else state.projects.firstOrNull { it.first == project }?.second ?: "选择项目", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                        Icon(Icons.Outlined.ExpandMore, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                    }
                    DropdownMenu(choosing, { choosing = false }) {
                        DropdownMenuItem(text = { Text("全部项目") }, onClick = { project = ""; choosing = false })
                        state.projects.forEach { p -> DropdownMenuItem(text = { Text(p.second) }, onClick = { project = p.first; choosing = false }) }
                    }
                }
                IconButton(onClick = { revision++ }, enabled = !loading, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Outlined.Refresh, "刷新", tint = c.textSecondary, modifier = Modifier.size(18.dp))
                }
            }
            KooyuSegmentedControl(
                options = tabs.map { SegmentOption(it, it) },
                selected = tab,
                onSelect = { tab = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
            )
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.brandCoral)
            if (error.isNotBlank()) Text(error, color = c.destructive, modifier = Modifier.padding(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = if (embedded) c.raised else c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.weight(1f)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.Search, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        TextField(
                            value = search,
                            onValueChange = { search = it },
                            placeholder = { Text("搜索工作、成果或计划", fontSize = 13.sp, color = c.textTertiary) },
                            singleLine = true,
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = Color.Transparent,
                                unfocusedContainerColor = Color.Transparent,
                                disabledContainerColor = Color.Transparent,
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent,
                                cursorColor = c.brandCoral
                            ),
                            modifier = Modifier.weight(1f)
                        )
                        if (search.isNotEmpty()) {
                            IconButton(onClick = { search = "" }, modifier = Modifier.size(28.dp)) {
                                Icon(Icons.Outlined.Close, null, tint = c.textTertiary, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                }
                if (tab == "进行中与目标") {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (attention) c.brandCoralTint else c.sunken,
                        border = BorderStroke(0.5.dp, if (attention) c.brandCoral.copy(alpha = 0.45f) else c.borderSubtle),
                        modifier = Modifier.heightIn(min = 44.dp).clickable { attention = !attention }
                    ) {
                        Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
                            Text("等你处理", fontSize = 12.sp, fontWeight = if (attention) FontWeight.Bold else FontWeight.Medium, color = if (attention) c.brandCoral else c.textSecondary)
                        }
                    }
                }
            }
            val info = data
            if (info != null) LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (tab) {
                    "进行中与目标" -> {
                        val inbox = info.rows("inbox").filter { item -> state.sessions.firstOrNull { it.id == item.optString("sessionId") }?.title?.contains(search, true) == true }
                        val goals = info.rows("goals").filter { (it.optString("title") + it.optString("description")).contains(search, true) && (!attention || it.optString("status") in listOf("blocked", "awaiting-review")) }
                        val running = info.rows("sessions").filter { session -> session.optString("runState") in listOf("running", "waiting-input") && session.optString("title").contains(search, true) && (!attention || session.optString("runState") == "waiting-input") && info.rows("inbox").none { it.optString("sessionId") == session.optString("id") } && info.rows("goals").none { g -> g.optString("controllerSessionId") == session.optString("id") || g.optJSONArray("sessionIds")?.let { ids -> (0 until ids.length()).any { ids.getString(it) == session.optString("id") } } == true } }
                        items(inbox, key = { "inbox:" + it.optString("id") }) { item -> WorkRow(state.sessions.firstOrNull { it.id == item.optString("sessionId") }?.title ?: "对话", "待处理请求", { open(item.optString("sessionId")) }, Icons.Outlined.Inbox) }
                        items(goals, key = { it.optString("id") }) { item -> WorkRow(item.optString("title"), workStatus(item.optString("status")) + " · " + workStatus(item.optString("verificationStatus")), { goalId = item.optString("id") }, Icons.Outlined.Flag) }
                        items(running, key = { "session:" + it.optString("id") }) { item -> WorkRow(item.optString("title"), if (item.optString("runState") == "running") "执行中" else "等待输入", { open(item.optString("id")) }, Icons.Outlined.ChatBubbleOutline) }
                        if (inbox.isEmpty() && goals.isEmpty() && running.isEmpty()) item { WorkEmpty("暂无进行中的工作或目标") { composing = "" } }
                    }
                    "交付成果" -> {
                        val entries = info.rows("artifacts").filter { val a = it.optJSONObject("artifact") ?: it; (a.optString("title") + a.optString("displayName")).contains(search, true) }
                        items(entries, key = { it.optJSONObject("artifact")!!.optString("id") }) { entry ->
                            val a = entry.getJSONObject("artifact")
                            val goal = info.rows("goals").firstOrNull { it.optString("id") == a.optString("goalId") }
                            val sub = a.optString("displayName") + " · v${a.optInt("version")} · ${kotlin.math.ceil(a.optDouble("size") / 1024).toInt()} KB" + (if (goal != null) " · " + workStatus(goal.optString("verificationStatus")) else "")
                            WorkRow(a.optString("title"), sub, if (entry.optBoolean("available")) ({ artifact = a }) else null, Icons.Outlined.Description)
                        }
                        if (entries.isEmpty()) item { WorkEmpty("暂无交付成果") }
                    }
                    "自动计划" -> {
                        item {
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = if (embedded) c.raised else c.sunken,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.fillMaxWidth().clickable { composing = workTemplates.last().second }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Icon(Icons.Outlined.AddCircleOutline, null, tint = c.brandCoral, modifier = Modifier.size(18.dp))
                                    Text("新建计划", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                }
                            }
                        }
                        val plans = info.rows("plans").filter { (it.optString("name") + it.optString("promptTemplate")).contains(search, true) }
                        items(plans, key = { it.optString("id") }) { item ->
                            val trigger = item.optJSONObject("trigger") ?: JSONObject()
                            val sub = (if (item.optBoolean("enabled")) "已启用" else "已暂停") + " · " + item.optString("timeZone") + " · " + planSchedule(trigger)
                            WorkRow(item.optString("name"), sub, { plan = item }, Icons.Outlined.Schedule)
                        }
                        if (plans.isEmpty()) item { WorkEmpty("暂无自动计划") }
                    }
                }
            }
        }
    }

    if (embedded) {
        hubBody(Modifier.fillMaxSize())
    } else {
        FullScreenPage(if (project.isEmpty()) "工作台" else state.projects.firstOrNull { it.first == project }?.second ?: "项目工作", close) { padding ->
            hubBody(Modifier.fillMaxSize().padding(padding))
        }
    }

    if (goalId != null) GoalDetailScreen(goalId!!, state, model, openSession = { open(it) }) { goalId = null; revision++ }
    if (artifact != null) ManagedArtifactScreen(artifact!!, state) { artifact = null }
    if (plan != null) NativePlanEditor(plan!!, data?.rows("activations").orEmpty().filter { it.optString("automationId") == plan!!.optString("id") }, data?.optJSONObject("actions")?.optJSONObject("automations.run")?.optBoolean("available") == true, state, model, { open(it) }) { plan = null; revision++ }
    if (composing != null) {
        val previousSession = remember(composing) { state.selected }
        DraftSessionSheet(state, model, project, initialText = composing!!) { composing = null; if (model.state.value.selected != previousSession) close() }
    }
}

@Composable internal fun WorkRow(
    title: String,
    subtitle: String,
    open: (() -> Unit)? = null,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    leading: (@Composable () -> Unit)? = null
) {
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = c.raised,
        border = BorderStroke(0.5.dp, c.borderSubtle),
        modifier = Modifier
            .fillMaxWidth()
            .then(if (open != null) Modifier.clickable(onClick = open) else Modifier)
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (leading != null) {
                leading()
            } else {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(c.sunken),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(icon ?: Icons.Outlined.Layers, null, tint = c.accent, modifier = Modifier.size(17.dp))
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, color = c.text, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, letterSpacing = (-0.2).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle.isNotBlank()) {
                    Text(subtitle, color = c.textSecondary, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (open != null) {
                Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = c.textTertiary, modifier = Modifier.size(13.dp))
            }
        }
    }
}

@Composable private fun WorkEmpty(title: String, action: (() -> Unit)? = null) {
    val c = Kooyu.colors
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(c.sunken),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Outlined.Layers, null, tint = c.textTertiary, modifier = Modifier.size(22.dp))
        }
        Text(title, color = c.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        if (action != null) {
            Button(
                onClick = action,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text("开始对话", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable private fun NativePlanEditor(plan: JSONObject, runs: List<JSONObject>, canRun: Boolean, state: WorkbenchState, model: Workbench, openSession: (String) -> Unit, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(plan.optString("name")) }
    var prompt by remember { mutableStateOf(plan.optString("promptTemplate")) }
    var zone by remember { mutableStateOf(plan.optString("timeZone")) }
    val trigger = plan.optJSONObject("trigger") ?: JSONObject()
    var timing by remember { mutableStateOf(PlanTiming.from(trigger)) }
    var advanced by remember { mutableStateOf(false) }
    var maxRuns by remember { mutableStateOf(plan.optJSONObject("limits")?.nullableNumber("maxRuns")?.toInt()?.toString() ?: "0") }
    var maxCost by remember { mutableStateOf(plan.optJSONObject("limits")?.nullableNumber("maxCostUsd")?.toString() ?: "0") }
    var error by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<List<String>>(emptyList()) }
    fun body(): JSONObject {
        require(name.isNotBlank() && prompt.isNotBlank() && zone.isNotBlank()) { "请填写名称、工作内容和时区。" }
        require(maxRuns.isBlank() || (maxRuns.toIntOrNull() ?: -1) >= 0) { "执行次数须为非负整数，0 表示不限制。" }
        require(maxCost.isBlank() || maxCost.toDoubleOrNull()?.let { it.isFinite() && it >= 0 } == true) { "预算须为非负数，0 表示不限制。" }
        val body = JSONObject(plan.toString())
        listOf("id", "revision", "dispatchGeneration", "effectiveAt", "nextDueAt", "createdAt", "updatedAt").forEach { body.remove(it) }
        return body.put("expectedRevision", plan.optInt("revision")).put("name", name).put("promptTemplate", prompt).put("timeZone", zone).put("enabled", true)
            .put("limits", JSONObject().apply { if (maxRuns.isNotBlank()) put("maxRuns", maxRuns.toInt()); if (maxCost.isNotBlank()) put("maxCostUsd", maxCost.toDouble()) })
            .put("trigger", timing.trigger())
    }
    FullScreenPage("计划详情", close) { padding -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        WorkRecovery(state, model)
        Text(if (plan.optBoolean("enabled")) "已启用" else "已暂停", color = Kooyu.colors.textSecondary)
        Text("执行节点：" + if (plan.optString("executorId") == "local") state.connection?.name else plan.optString("executorId"))
        OutlinedTextField(name, { name = it }, label = { Text("计划名称") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(prompt, { prompt = it }, label = { Text("工作内容") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        PlanScheduleFields(timing) { timing = it; preview = emptyList() }
        TextButton(onClick={advanced=!advanced}) { Text(if(advanced) "收起高级设置" else "高级设置 · 时区与执行限制") }
        if(advanced) {
        OutlinedTextField(zone, { zone = it; preview=emptyList() }, label = { Text("执行时区") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(maxRuns, { maxRuns = it }, label = { Text("最多执行次数（0 不限制）") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(maxCost, { maxCost = it }, label = { Text("最高费用 USD（0 不限制）") }, modifier = Modifier.fillMaxWidth())
        }
        Button(onClick = { scope.launch { try { if (model.execute("/automations/${plan.optString("id")}", "PATCH", body()) != null) close() } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "保存失败" } } }, enabled = state.canWrite, modifier = Modifier.fillMaxWidth()) { Text("保存并启用") }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { scope.launch { if (model.execute("/automations/${plan.optString("id")}/pause", body = JSONObject().put("expectedRevision", plan.optInt("revision"))) != null) close() } }, enabled = state.canWrite) { Text("暂停计划") }
            OutlinedButton(onClick = { scope.launch { if (model.execute("/automations/${plan.optString("id")}/run") != null) close() } }, enabled = state.canWrite && canRun && plan.optBoolean("enabled")) { Text("立即执行") }
        }
        TextButton(onClick = { scope.launch { try { val c = state.connection ?: return@launch; val result = HostAPI(c).post("/automations/preview", body().put("requestId", java.util.UUID.randomUUID().toString())); val dates = result.optJSONArray("occurrences") ?: JSONArray(); preview = (0 until dates.length()).map { dates.getString(it) }; error = "" } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "时间无效" } } }, enabled = state.online && !state.busy) { Text("预览接下来执行时间") }
        preview.forEach { Text("$it · $zone", fontSize = 13.sp) }
        if (error.isNotBlank()) Text(error, color = Kooyu.colors.destructive)
        if (state.error.isNotBlank()) Text(state.error, color = Kooyu.colors.destructive)
        Text("运行记录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
        if (runs.isEmpty()) Text("暂无运行记录", color = Kooyu.colors.textSecondary, fontSize = 13.sp)
        runs.forEach { run -> WorkRow(run.optString("receivedAt"), workStatus(run.optString("status")) + (run.nullableString("lastError")?.let { " · $it" } ?: ""), run.nullableString("sessionId")?.let { id -> ({ openSession(id) }) }, Icons.Outlined.History) }
    } }
}

@Composable internal fun NativeMemoryEditor(memory: JSONObject, project: String, state: WorkbenchState, model: Workbench, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var subject by remember { mutableStateOf(memory.optString("subject")) }
    var content by remember { mutableStateOf(memory.optString("content")) }
    var deleting by remember { mutableStateOf(false) }
    val existing = memory.has("id")
    suspend fun save(status: String) {
        val body = JSONObject().put("subject", subject).put("content", content).put("status", status)
            .put("scope", if (existing) memory.optString("scope") else if (project.isEmpty()) "user" else "project")
            .put("projectId", if (existing) memory.opt("projectId") ?: JSONObject.NULL else project.ifEmpty { null } ?: JSONObject.NULL)
            .put("sourceRefs", memory.optJSONArray("sourceRefs") ?: JSONArray().put("user:mobile"))
        if (existing) body.put("expectedRevision", memory.optInt("revision"))
        if (model.execute(if (existing) "/memory/${memory.optString("id")}" else "/memory", if (existing) "PATCH" else "POST", body) != null) close()
    }
    FullScreenPage(if (existing) "编辑约定" else "新增约定", close) { padding -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        WorkRecovery(state, model)
        Text(if ((if (existing) memory.optString("scope") else if (project.isEmpty()) "user" else "project") == "user") "全局约定" else "项目约定", fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
        OutlinedTextField(subject, { subject = it }, label = { Text("约定主题") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(content, { content = it }, label = { Text("约定内容") }, minLines = 5, modifier = Modifier.fillMaxWidth())
        Button(onClick = { scope.launch { save("confirmed") } }, enabled = state.canWrite && subject.isNotBlank() && content.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("保存并确认") }
        if (existing) TextButton(onClick = { deleting = true }, enabled = state.canWrite) { Text("删除约定", color = Kooyu.colors.destructive) }
        if (state.error.isNotBlank()) Text(state.error, color = Kooyu.colors.destructive)
    } }
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("删除约定") }, text = { Text("确认删除此约定？") }, confirmButton = { TextButton(onClick = { scope.launch { save("deleted") } }, enabled = state.canWrite) { Text("删除") } }, dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } })
}

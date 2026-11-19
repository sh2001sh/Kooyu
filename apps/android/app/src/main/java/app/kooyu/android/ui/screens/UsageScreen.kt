package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

fun number(value: Double): String = String.format(Locale.US, "%,.0f", value)
fun money(value: Double?): String = value?.let {
    when {
        it >= 100.0 -> String.format(Locale.US, "$%.2f", it)
        it >= 1.0 -> String.format(Locale.US, "$%.3f", it)
        else -> String.format(Locale.US, "$%.4f", it)
    }
} ?: "—"

private fun compactTokens(value: Double): String = when {
    value >= 1_000_000_000 -> String.format(Locale.US, "%.2fB", value / 1_000_000_000)
    value >= 1_000_000 -> String.format(Locale.US, "%.2fM", value / 1_000_000)
    value >= 1_000 -> String.format(Locale.US, "%.1fk", value / 1_000)
    else -> String.format(Locale.US, "%.0f", value)
}

private fun formatDurationMs(ms: Double?): String {
    if (ms == null || !ms.isFinite() || ms < 0) return "—"
    if (ms < 1000) return String.format(Locale.US, "%.0fms", ms)
    if (ms < 10_000) return String.format(Locale.US, "%.2fs", ms / 1000.0)
    if (ms < 60_000) return String.format(Locale.US, "%.1fs", ms / 1000.0)
    val totalSec = Math.round(ms / 1000.0)
    val mins = totalSec / 60
    val secs = totalSec % 60
    if (mins < 60) return if (secs > 0) "${mins}m ${secs}s" else "${mins}m"
    val hours = mins / 60
    val remMins = mins % 60
    return if (remMins > 0) "${hours}h ${remMins}m" else "${hours}h"
}

@Composable fun MetricCard(
    title: String,
    value: String,
    subtitle: String? = null,
    indexTag: String? = null,
    modifier: Modifier = Modifier
) {
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = c.raised,
        border = BorderStroke(0.5.dp, c.borderSubtle),
        shadowElevation = if (c.dark) 0.dp else 0.5.dp,
        modifier = modifier
    ) {
        Column(
            Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    title,
                    style = KooyuType.caption,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = c.textSecondary,
                    maxLines = 1
                )
                if (indexTag != null) {
                    Text(
                        indexTag,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        color = c.textTertiary
                    )
                }
            }
            Text(
                value,
                fontSize = 21.sp,
                lineHeight = 26.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = c.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = KooyuType.caption,
                    fontSize = 11.sp,
                    color = c.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable private fun UsageFilterChip(
    label: String,
    valueLabel: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit
) {
    val c = Kooyu.colors
    var expanded by remember { mutableStateOf(false) }
    Box {
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.borderSubtle),
            shadowElevation = if (c.dark) 0.dp else 0.5.dp,
            modifier = Modifier.kooyuPressable(onClickLabel = "筛选$label") { expanded = true }
        ) {
            Row(
                Modifier.height(34.dp).padding(start = 11.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    valueLabel,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = c.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 124.dp)
                )
                Icon(Icons.Outlined.ExpandMore, null, tint = c.textTertiary, modifier = Modifier.size(14.dp))
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.background(c.raised)
        ) {
            options.forEach { (key, text) ->
                DropdownMenuItem(
                    text = { Text(text, fontSize = 13.5.sp, color = c.text) },
                    onClick = { expanded = false; onSelect(key) }
                )
            }
        }
    }
}

private data class DailySlot(
    val dayKey: String,
    val shortLabel: String,
    val cost: Double,
    val tokens: Double,
    val count: Int
)

@Composable fun UsageScreen(
    state: WorkbenchState,
    model: Workbench,
    sessionId: String? = null,
    embedded: Boolean = false
) {
    val c = Kooyu.colors
    var days by rememberSaveable(state.connection?.hostId) { mutableIntStateOf(14) }
    var project by rememberSaveable(state.connection?.hostId) { mutableStateOf("") }
    var source by rememberSaveable(state.connection?.hostId) { mutableStateOf("") }
    var scopeFilter by rememberSaveable { mutableStateOf("all") }
    var chartMode by rememberSaveable { mutableStateOf("cost") }
    var selectedSlotIdx by remember { mutableStateOf<Int?>(null) }
    var limit by rememberSaveable { mutableIntStateOf(30) }
    var budget by remember { mutableStateOf(false) }
    var budgetProject by remember { mutableStateOf("") }
    var usd by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId) {
        while (true) { model.refreshUsage(); delay(10000) }
    }

    val records = remember(state.usage?.records, days, project, source, sessionId, scopeFilter) {
        filterUsage(
            state.usage?.records ?: emptyList(),
            UsageFilter(days.takeIf { it > 0 }, project.ifEmpty { null }, source.ifEmpty { null }, sessionId, scopeFilter)
        )
    }

    val known = remember(records) { records.mapNotNull { it.costUsd } }
    val input = remember(records) { records.mapNotNull { it.input }.sum() }
    val output = remember(records) { records.mapNotNull { it.output }.sum() }
    val read = remember(records) { records.mapNotNull { it.cacheRead }.sum() }
    val write = remember(records) { records.mapNotNull { it.cacheWrite }.sum() }
    val totalTokens = input + output + read + write
    val cacheHitPct = if (input + read > 0) ((read / (input + read)) * 100.0).toInt() else 0

    // Build continuous daily slots so even sparse or empty windows render a crisp architectural timeline.
    val dailySlots = remember(records, days) {
        val slotCount = when (days) {
            7 -> 7
            30 -> 30
            else -> 14
        }
        val today = LocalDate.now()
        val fmt = DateTimeFormatter.ofPattern("MM/dd")
        val grouped = records.groupBy { it.createdAt.take(10) }
        (slotCount - 1 downTo 0).map { delta ->
            val date = today.minusDays(delta.toLong())
            val key = date.toString()
            val dayItems = grouped[key].orEmpty()
            DailySlot(
                dayKey = key,
                shortLabel = date.format(fmt),
                cost = dayItems.mapNotNull { it.costUsd }.sum(),
                tokens = dayItems.sumOf { (it.input ?: 0.0) + (it.output ?: 0.0) + (it.cacheRead ?: 0.0) + (it.cacheWrite ?: 0.0) },
                count = dayItems.size
            )
        }
    }

    val byEngine = remember(records) {
        records.groupBy { it.source }.map { (engineId, list) ->
            val engineUsd = list.mapNotNull { it.costUsd }.sum()
            val engineTokens = list.sumOf { (it.input ?: 0.0) + (it.output ?: 0.0) + (it.cacheRead ?: 0.0) + (it.cacheWrite ?: 0.0) }
            Triple(engineId, engineUsd, engineTokens to list.size)
        }.sortedWith(compareByDescending<Triple<String, Double, Pair<Double, Int>>> { it.second }.thenByDescending { it.third.first })
    }

    val sortedRecords = remember(records, limit) {
        records.sortedByDescending { it.createdAt }.take(limit)
    }

    LazyColumn(
        Modifier.fillMaxSize().background(c.navigator),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = if (embedded) 6.dp else 12.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (embedded) {
            item("summary-pill") {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Token 吞吐、费用趋势与项目预算",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = c.textSecondary
                    )
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = c.raised,
                        border = BorderStroke(0.5.dp, c.borderSubtle)
                    ) {
                        Text(
                            if (records.isNotEmpty()) "${records.size} 笔计量记录" else "实时计量就绪",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = c.textSecondary,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }

        item("filters") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                KooyuSegmentedControl(
                    options = listOf(
                        SegmentOption(7, "7D"),
                        SegmentOption(14, "14D"),
                        SegmentOption(30, "30D"),
                        SegmentOption(0, "全部")
                    ),
                    selected = days,
                    onSelect = { days = it; selectedSlotIdx = null },
                    modifier = Modifier.fillMaxWidth()
                )
                if (sessionId == null) {
                    val projectOptions = listOf("" to "全部项目") + state.projects
                    val engineOptions = listOf("" to "全部引擎") + state.harnesses.map { h ->
                        h.id to (if (h.id == "kodo") "Kooyu" else h.name.substringBefore(" · "))
                    }
                    val scopeOptions = listOf("all" to "口径 · 去重", "turn" to "口径 · 按轮次", "session" to "口径 · 快照")
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        UsageFilterChip(
                            label = "项目",
                            valueLabel = projectOptions.firstOrNull { it.first == project }?.second ?: "全部项目",
                            options = projectOptions,
                            onSelect = { project = it }
                        )
                        UsageFilterChip(
                            label = "引擎",
                            valueLabel = engineOptions.firstOrNull { it.first == source }?.second ?: "全部引擎",
                            options = engineOptions,
                            onSelect = { source = it }
                        )
                        UsageFilterChip(
                            label = "口径",
                            valueLabel = scopeOptions.firstOrNull { it.first == scopeFilter }?.second ?: "口径 · 去重",
                            options = scopeOptions,
                            onSelect = { scopeFilter = it }
                        )
                    }
                }
            }
        }

        if (state.usageLoading && state.usage == null) {
            item("loading") {
                LinearProgressIndicator(
                    color = c.accent,
                    trackColor = c.sunken,
                    modifier = Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(999.dp))
                )
            }
        }

        if (state.usageError.isNotEmpty()) {
            item("error") {
                Surface(
                    color = c.destructiveTint,
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.25f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(state.usageError, fontSize = 12.5.sp, color = c.destructive, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { model.refreshUsage() } }) {
                            Text("重试", fontWeight = FontWeight.SemiBold, color = c.destructive)
                        }
                    }
                }
            }
        }

        item("bento-metrics") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MetricCard(
                        title = "已知总费用",
                        value = if (known.isEmpty()) "$0.00" else money(known.sum()),
                        subtitle = if (records.isEmpty()) "等待引擎产生消耗" else "实际 ${records.count { it.costKind == "actual" }} · 估算 ${records.count { it.costKind == "estimate" }}",
                        indexTag = "01",
                        modifier = Modifier.weight(1f)
                    )
                    MetricCard(
                        title = "总吞吐 Token",
                        value = compactTokens(totalTokens),
                        subtitle = "输入 ${compactTokens(input)} · 输出 ${compactTokens(output)}",
                        indexTag = "02",
                        modifier = Modifier.weight(1f)
                    )
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MetricCard(
                        title = "缓存命中率",
                        value = "$cacheHitPct%",
                        subtitle = "读取 ${compactTokens(read)} · 写入 ${compactTokens(write)}",
                        indexTag = "03",
                        modifier = Modifier.weight(1f)
                    )
                    MetricCard(
                        title = "活跃调用",
                        value = "${records.size} 次",
                        subtitle = if (byEngine.isEmpty()) "全引擎待命" else "覆盖 ${byEngine.size} 个引擎",
                        indexTag = "04",
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        item("daily-chart") {
            val activeSlot = selectedSlotIdx?.let { dailySlots.getOrNull(it) }
            val values = dailySlots.map { if (chartMode == "cost") it.cost else it.tokens }
            val maxVal = (values.maxOrNull()?.takeIf { it > 0.0 } ?: 1.0) * 1.12
            val hasAny = values.any { it > 0.0 }
            val peakIdx = if (hasAny) values.indices.maxByOrNull { values[it] } else null

            Surface(
                shape = RoundedCornerShape(20.dp),
                color = c.raised,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                shadowElevation = if (c.dark) 0.dp else 0.5.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                if (chartMode == "cost") "每日费用趋势" else "每日 Token 吞吐",
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = c.text
                            )
                            Text(
                                if (activeSlot != null) {
                                    "${activeSlot.dayKey} · ${if (chartMode == "cost") money(activeSlot.cost) else compactTokens(activeSlot.tokens)} (${activeSlot.count} 次)"
                                } else if (dailySlots.isNotEmpty()) {
                                    "${dailySlots.first().shortLabel} – ${dailySlots.last().shortLabel}" + if (!hasAny) " · 暂无消耗" else ""
                                } else "—",
                                fontSize = 11.5.sp,
                                color = if (activeSlot != null) c.text else c.textTertiary
                            )
                        }
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle)
                        ) {
                            Row(Modifier.padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                listOf("cost" to "费用", "tokens" to "Token").forEach { (id, lbl) ->
                                    val selected = chartMode == id
                                    Box(
                                        Modifier
                                            .clip(RoundedCornerShape(999.dp))
                                            .background(if (selected) c.paper else androidx.compose.ui.graphics.Color.Transparent)
                                            .clickable { chartMode = id }
                                            .padding(horizontal = 10.dp, vertical = 5.dp)
                                    ) {
                                        Text(
                                            lbl,
                                            fontSize = 11.sp,
                                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                            color = if (selected) c.text else c.textSecondary
                                        )
                                    }
                                }
                            }
                        }
                    }

                    val barActiveColor = c.accent
                    val barPeakCoral = c.brandCoral
                    val barNormalColor = c.text.copy(alpha = if (c.dark) 0.72f else 0.78f)
                    val slotBgColor = c.sunken
                    val gridColor = c.borderSubtle

                    Canvas(
                        Modifier
                            .fillMaxWidth()
                            .height(136.dp)
                            .pointerInput(dailySlots.size) {
                                detectTapGestures { offset ->
                                    if (dailySlots.isNotEmpty() && size.width > 0) {
                                        val idx = ((offset.x / size.width) * dailySlots.size).toInt().coerceIn(0, dailySlots.lastIndex)
                                        selectedSlotIdx = if (selectedSlotIdx == idx) null else idx
                                    }
                                }
                            }
                    ) {
                        val dash = PathEffect.dashPathEffect(floatArrayOf(6f, 6f), 0f)
                        listOf(0.15f, 0.55f, 0.95f).forEachIndexed { idx, ratio ->
                            val y = size.height * ratio
                            drawLine(
                                color = gridColor,
                                start = Offset(0f, y),
                                end = Offset(size.width, y),
                                strokeWidth = 1f,
                                pathEffect = if (idx == 2) null else dash
                            )
                        }
                        val n = dailySlots.size.coerceAtLeast(1)
                        val step = size.width / n
                        val barW = (step * 0.56f).coerceIn(6.dp.toPx(), 18.dp.toPx())
                        val plotBottom = size.height * 0.95f
                        val maxBarH = size.height * 0.80f

                        values.forEachIndexed { i, v ->
                            val left = i * step + (step - barW) / 2f
                            // Background architectural capsule slot
                            drawRoundRect(
                                color = slotBgColor,
                                topLeft = Offset(left, plotBottom - maxBarH),
                                size = Size(barW, maxBarH),
                                cornerRadius = CornerRadius(barW / 2f, barW / 2f)
                            )
                            if (v > 0.0) {
                                val h = (maxBarH * (v / maxVal)).toFloat().coerceAtLeast(barW)
                                val fill = when {
                                    selectedSlotIdx == i -> barPeakCoral
                                    peakIdx == i -> barActiveColor
                                    else -> barNormalColor
                                }
                                drawRoundRect(
                                    color = fill,
                                    topLeft = Offset(left, plotBottom - h),
                                    size = Size(barW, h),
                                    cornerRadius = CornerRadius(barW / 2f, barW / 2f)
                                )
                            }
                        }
                    }

                    if (dailySlots.size >= 2) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(dailySlots.first().shortLabel, fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = c.textTertiary)
                            Text(dailySlots[dailySlots.size / 2].shortLabel, fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = c.textTertiary)
                            Text(dailySlots.last().shortLabel, fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = c.textTertiary)
                        }
                    }
                }
            }
        }

        if (byEngine.isNotEmpty()) {
            item("engine-share") {
                val maxEngineMetric = byEngine.maxOf { (_, eUsd, pair) ->
                    if (chartMode == "cost" && known.isNotEmpty()) eUsd else pair.first
                }.coerceAtLeast(0.0001)

                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    shadowElevation = if (c.dark) 0.dp else 0.5.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("引擎消耗分布", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.text)
                        byEngine.forEach { (engineId, engineUsd, pair) ->
                            val (engineTokens, calls) = pair
                            val engineName = state.harnesses.firstOrNull { it.id == engineId }?.name?.let {
                                if (engineId == "kodo") "Kooyu" else it.substringBefore(" · ")
                            } ?: harnessVisual(engineId).name
                            val weight = if (chartMode == "cost" && known.isNotEmpty()) engineUsd else engineTokens
                            val ratio = (weight / maxEngineMetric).toFloat().coerceIn(0.04f, 1f)

                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    EngineBadge(engineId, 24.dp, circle = false)
                                    Text(engineName, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text, modifier = Modifier.weight(1f))
                                    Text(
                                        if (engineUsd > 0) "${money(engineUsd)} · ${compactTokens(engineTokens)}" else "${compactTokens(engineTokens)} · ${calls}次",
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 11.5.sp,
                                        color = c.textSecondary
                                    )
                                }
                                Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(999.dp)).background(c.sunken)) {
                                    Box(Modifier.fillMaxWidth(ratio).fillMaxHeight().clip(RoundedCornerShape(999.dp)).background(c.accent))
                                }
                            }
                        }
                    }
                }
            }
        }

        if (sessionId == null) {
            item("budgets") {
                val budgets = state.usage?.budgets.orEmpty()
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    shadowElevation = if (c.dark) 0.dp else 0.5.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("项目预算护栏", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.text)
                                Text("达到 80% 软提醒，超额高亮预警", fontSize = 11.5.sp, color = c.textTertiary)
                            }
                            Surface(
                                shape = RoundedCornerShape(999.dp),
                                color = c.sunken,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.kooyuPressable(enabled = state.canWrite && state.projects.isNotEmpty(), onClickLabel = "设置预算") {
                                    budgetProject = project.ifEmpty { state.projects.firstOrNull()?.first.orEmpty() }
                                    budget = true
                                }
                            ) {
                                Row(
                                    Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Icon(Icons.Outlined.Add, null, tint = c.text, modifier = Modifier.size(14.dp))
                                    Text("设置预算", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                }
                            }
                        }

                        if (budgets.isEmpty()) {
                            Box(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.sunken).padding(horizontal = 14.dp, vertical = 12.dp)
                            ) {
                                Text(
                                    if (state.projects.isEmpty()) "创建项目后可按项目配置月度或累计费用上限。" else "暂未设置预算上限，点击右上角可为项目添加费用护栏。",
                                    fontSize = 12.sp,
                                    color = c.textSecondary
                                )
                            }
                        } else {
                            budgets.forEach { b ->
                                val pid = b.nullableString("projectId")
                                val spent = filterUsage(state.usage?.records.orEmpty(), UsageFilter(days = null, projectId = pid)).mapNotNull { it.costUsd }.sum()
                                val budgetUsd = b.nullableNumber("usd") ?: 0.0
                                val ratio = if (budgetUsd > 0) (spent / budgetUsd).toFloat().coerceIn(0f, 1f) else 0f
                                val barColor = when {
                                    ratio >= 1f -> c.destructive
                                    ratio >= 0.8f -> c.brandCoral
                                    else -> c.success
                                }
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            state.projects.firstOrNull { it.first == pid }?.second ?: if (pid == null) "全局预算" else "项目预算",
                                            fontSize = 13.5.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = c.text
                                        )
                                        Text(
                                            "${money(spent)} / ${money(budgetUsd)}",
                                            fontFamily = FontFamily.Monospace,
                                            fontSize = 12.sp,
                                            color = c.textSecondary
                                        )
                                    }
                                    Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(999.dp)).background(c.sunken)) {
                                        Box(Modifier.fillMaxWidth(ratio).fillMaxHeight().clip(RoundedCornerShape(999.dp)).background(barColor))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (sortedRecords.isNotEmpty()) {
            val ttftList = records.mapNotNull { it.firstTokenMs?.takeIf { v -> v.isFinite() && v >= 0 } }
            val durList = records.mapNotNull { it.durationMs?.takeIf { v -> v.isFinite() && v >= 0 } }
            item("ledger-header") {
                Row(
                    Modifier.fillMaxWidth().padding(start = 4.dp, end = 2.dp, top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "使用明细 · ${records.size} 条",
                        style = KooyuType.sectionHeader,
                        fontSize = 12.sp,
                        color = c.textTertiary
                    )
                    if (ttftList.isNotEmpty() || durList.isNotEmpty()) {
                        Text(
                            buildList {
                                if (ttftList.isNotEmpty()) add("首字 ${formatDurationMs(ttftList.average())}")
                                if (durList.isNotEmpty()) add("耗时 ${formatDurationMs(durList.average())}")
                            }.joinToString(" · "),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            color = c.textSecondary
                        )
                    }
                }
            }
            itemsIndexed(sortedRecords, key = { _, r -> "usage-" + r.id }) { _, r ->
                Surface(
                    shape = RoundedCornerShape(15.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            EngineBadge(r.source, 30.dp, circle = false)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    (r.model ?: r.source).substringAfterLast('/'),
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = c.text,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    "${r.createdAt.take(16).replace('T', ' ')} · ${if (r.scope == "session") "累计快照" else "本轮增量"}",
                                    fontSize = 11.sp,
                                    color = c.textTertiary
                                )
                            }
                            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    money(r.costUsd),
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = c.text
                                )
                                Text(
                                    if (r.costUsd == null) "未知" else if (r.costKind == "estimate") "估算" else "实际",
                                    fontSize = 10.5.sp,
                                    color = c.textTertiary
                                )
                            }
                        }
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(c.sunken)
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "入 ${r.input?.let(::compactTokens) ?: "—"} / 出 ${r.output?.let(::compactTokens) ?: "—"}",
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = c.textSecondary
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(
                                    "首字 ${formatDurationMs(r.firstTokenMs)}",
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    color = if (r.firstTokenMs != null) c.text else c.textTertiary
                                )
                                Text(
                                    "总 ${formatDurationMs(r.durationMs)}",
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    color = if (r.durationMs != null) c.text else c.textTertiary
                                )
                            }
                        }
                    }
                }
            }
            if (records.size > limit) {
                item("load-more") {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        TextButton(onClick = { limit += 50 }) {
                            Text("加载更多明细…", color = c.textSecondary)
                        }
                    }
                }
            }
        }
    }

    if (budget) {
        AlertDialog(
            onDismissRequest = { budget = false },
            containerColor = c.raised,
            title = { Text("设置项目预算", fontWeight = FontWeight.Bold, color = c.text) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ChoiceField("选择项目", budgetProject, state.projects) { budgetProject = it }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.sunken)
                            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        BasicTextField(
                            value = usd,
                            onValueChange = { usd = it.take(16) },
                            singleLine = true,
                            textStyle = KooyuType.body.copy(color = c.text),
                            cursorBrush = SolidColor(c.brandCoral),
                            modifier = Modifier.fillMaxWidth(),
                            decorationBox = { inner ->
                                if (usd.isEmpty()) Text("限额 USD（例如 50.00）", style = KooyuType.body, color = c.textTertiary)
                                inner()
                            }
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            if (model.saveBudget(budgetProject.ifEmpty { null }, usd.toDouble())) {
                                budget = false; usd = ""
                            }
                        }
                    },
                    enabled = state.canWrite && budgetProject.isNotEmpty() && (usd.toDoubleOrNull() ?: 0.0) > 0,
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                ) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { budget = false }) { Text("取消", color = c.textSecondary) }
            }
        )
    }
}

package app.kooyu.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Desktop-style squircle/circle engine badge with the engine's tint and ink. */
@Composable fun EngineBadge(harnessId: String?, size: Dp = 20.dp, circle: Boolean = true) {
    val v = harnessVisual(harnessId)
    val dark = Kooyu.colors.dark
    Box(
        Modifier.size(size).clip(if (circle) CircleShape else RoundedCornerShape(size * 0.3f)).background(if (dark) v.darkTint else v.tint),
        contentAlignment = Alignment.Center,
    ) {
        Text(v.monogram, color = if (dark) v.darkInk else v.ink, fontWeight = FontWeight.Bold,
            fontSize = (size.value * if (v.monogram.length > 1) 0.36f else 0.5f).sp, maxLines = 1)
    }
}

private fun Modifier.capsule(colors: KooyuColors, tone: ToolStatus? = null) = this
    .clip(RoundedCornerShape(10.dp))
    .background(when (tone) { ToolStatus.FAILED -> colors.destructiveTint; ToolStatus.RUNNING -> colors.accentTint; else -> colors.capsule })
    .border(1.dp, when (tone) { ToolStatus.FAILED -> colors.destructive.copy(alpha = 0.28f); ToolStatus.RUNNING -> colors.accent.copy(alpha = 0.22f); else -> colors.borderSubtle }, RoundedCornerShape(10.dp))

@Composable private fun pulseAlpha(active: Boolean): Float {
    if (!active) return 1f
    val t = rememberInfiniteTransition(label = "pulse")
    val a by t.animateFloat(1f, 0.45f, infiniteRepeatable(tween(800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "alpha")
    return a
}

@Composable private fun StatusIcon(icon: ImageVector, tone: ToolStatus?) {
    val c = Kooyu.colors
    val (bg, fg) = when (tone) {
        ToolStatus.FAILED -> c.destructiveTint to c.destructive
        ToolStatus.RUNNING -> c.accentTint to c.text
        else -> c.paper to c.textTertiary
    }
    Box(Modifier.size(20.dp).alpha(pulseAlpha(tone == ToolStatus.RUNNING)).clip(RoundedCornerShape(6.dp)).background(bg)
        .border(1.dp, if (tone == null || tone == ToolStatus.DONE) c.borderSubtle else Color.Transparent, RoundedCornerShape(6.dp)),
        contentAlignment = Alignment.Center) { Icon(icon, null, tint = fg, modifier = Modifier.size(12.dp)) }
}

@Composable fun StatusChip(text: String, tone: ToolStatus?) {
    val c = Kooyu.colors
    val (bg, fg) = when (tone) {
        ToolStatus.FAILED -> c.destructiveTint to c.destructive
        ToolStatus.RUNNING -> c.accentTint to c.text
        ToolStatus.DONE -> c.successTint to c.doneText
        null -> c.paper.copy(alpha = 0.78f) to c.textTertiary
    }
    Text(text, fontSize = 10.5.sp, fontWeight = FontWeight.Medium, color = fg, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 7.dp, vertical = 1.5.dp))
}

@Composable private fun Chevron(open: Boolean) {
    val angle by animateFloatAsState(if (open) 90f else 0f, spring(stiffness = Spring.StiffnessMediumLow), label = "chevron")
    Icon(Icons.Outlined.ChevronRight, if (open) "收起" else "展开", tint = Kooyu.colors.textTertiary, modifier = Modifier.size(16.dp).rotate(angle))
}

@Composable private fun Expandable(open: Boolean, content: @Composable () -> Unit) =
    AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) { content() }

@Composable private fun SummaryRow(onClick: () -> Unit, content: @Composable RowScope.() -> Unit) =
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 36.dp).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)

@Composable private fun OutputWell(text: String) {
    val c = Kooyu.colors
    val shown = if (text.length > 20000) text.take(20000) + "\n…（已截断）" else text
    Box(Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(8.dp)).background(c.sunken)
        .verticalScroll(rememberScrollState())) {
        SelectionContainer {
            Text(shown, fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, lineHeight = 17.sp, color = c.textSecondary, softWrap = false,
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(10.dp))
        }
    }
}

@Composable fun ToolCard(row: TranscriptRow, grouped: Boolean = false) {
    val c = Kooyu.colors
    val p = row.payload ?: org.json.JSONObject()
    val summary = remember(p.toString()) { toolSummary(p) }
    var open by rememberSaveable(row.id) { mutableStateOf(false) }
    val container = if (grouped) Modifier else Modifier.capsule(c, summary.status.takeIf { it != ToolStatus.DONE })
    Column(container.fillMaxWidth()) {
        SummaryRow({ open = !open }) {
            StatusIcon(Icons.Outlined.Build, summary.status)
            Text(summary.title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 160.dp))
            Text(summary.detail, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = c.textSecondary, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            summary.status?.let { StatusChip(it.label, it) }
            Chevron(open)
        }
        Expandable(open) {
            val output = remember(p.toString()) { toolOutput(p) }
            Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { CopyIconButton(output, "复制输出", 28) }
                OutputWell(output)
            }
        }
    }
}

@Composable fun ToolGroup(rows: List<TranscriptRow>, collapse: Boolean = true) {
    if (rows.size == 1 || !collapse) { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { rows.forEach { ToolCard(it) } }; return }
    val c = Kooyu.colors
    val summaries = rows.map { toolSummary(it.payload ?: org.json.JSONObject()) }
    val failed = summaries.count { it.status == ToolStatus.FAILED }
    val active = summaries.count { it.status == ToolStatus.RUNNING }
    val names = summaries.map { it.title }.distinct()
    val tone = when { failed > 0 -> ToolStatus.FAILED; active > 0 -> ToolStatus.RUNNING; else -> null }
    var open by rememberSaveable(rows.first().id) { mutableStateOf(false) }
    Column(Modifier.capsule(c, tone).fillMaxWidth()) {
        SummaryRow({ open = !open }) {
            StatusIcon(Icons.Outlined.Build, tone)
            Text("${rows.size} 次工具调用", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text, maxLines = 1)
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                names.take(2).forEach { name ->
                    Text(name, fontSize = 10.5.sp, fontFamily = FontFamily.Monospace, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false).clip(RoundedCornerShape(6.dp)).background(c.paper)
                            .border(1.dp, c.borderSubtle, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.5.dp))
                }
                if (names.size > 2) Text("+${names.size - 2}", fontSize = 10.5.sp, color = c.textTertiary)
            }
            if (active > 0) StatusChip("$active 进行中", ToolStatus.RUNNING)
            if (failed > 0) StatusChip("$failed 失败", ToolStatus.FAILED)
            Chevron(open)
        }
        Expandable(open) {
            Column { rows.forEach { HorizontalDivider(color = c.borderSubtle); ToolCard(it, grouped = true) } }
        }
    }
}

@Composable fun ThinkingBlock(row: TranscriptRow, live: Boolean) {
    val c = Kooyu.colors
    var open by rememberSaveable(row.id) { mutableStateOf(live) }
    LaunchedEffect(live) { if (live) open = true }
    Column(Modifier.capsule(c).fillMaxWidth()) {
        SummaryRow({ open = !open }) {
            Box(Modifier.alpha(pulseAlpha(live))) { Icon(Icons.Outlined.Psychology, null, tint = c.textTertiary, modifier = Modifier.size(15.dp)) }
            Text(if (live) "正在思考…" else "思考过程", fontSize = 12.sp, color = c.textSecondary, modifier = Modifier.weight(1f))
            Chevron(open)
        }
        Expandable(open) {
            SelectionContainer {
                Text(row.text, fontSize = 13.sp, lineHeight = 20.sp, color = c.textSecondary,
                    modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp))
            }
        }
    }
}

@Composable fun SubagentCard(child: ChildTranscript, harnessId: String?) {
    val c = Kooyu.colors
    var open by rememberSaveable(child.agentId) { mutableStateOf(false) }
    val status = SUBAGENT_STATUS[child.status.orEmpty()] ?: child.status ?: "状态未知"
    val tone = when (status) { "进行中", "启动中" -> ToolStatus.RUNNING; "失败" -> ToolStatus.FAILED; "完成" -> ToolStatus.DONE; else -> null }
    val inner = remember(child.events) { buildTranscript(child.events) }
    Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, c.border), RoundedCornerShape(0.dp))) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = 40.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chevron(open)
            Icon(Icons.Outlined.AccountTree, null, tint = c.textTertiary, modifier = Modifier.size(14.dp))
            Text("子代理 · " + (child.name ?: child.agentId), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.text,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            StatusChip(status, tone)
        }
        Expandable(open) {
            Column(Modifier.padding(start = 12.dp, end = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(child.agentId, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = c.textTertiary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val all = inner.rows.joinToString("\n") { if (it.role == RowRole.TOOL) toolOutput(it.payload ?: org.json.JSONObject()) else it.text }
                    CopyIconButton(all, "复制子代理输出", 28)
                }
                child.parentAgentId?.let { Text("父代理：$it", fontSize = 11.sp, color = c.textTertiary) }
                if (inner.rows.isEmpty()) Text("尚未收到原生子代理输出；当前仅有状态通知。", fontSize = 12.sp, color = c.textTertiary)
                else TranscriptColumn(inner, harnessId, running = tone == ToolStatus.RUNNING, subagent = true)
            }
        }
    }
}

@Composable fun ErrorTurn(row: TranscriptRow, title: String) {
    val c = Kooyu.colors
    var open by remember { mutableStateOf(false) }
    val detail = row.payload?.optJSONObject("error")?.optString("detail")?.takeIf { it.isNotBlank() }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.destructiveTint)
        .border(1.dp, c.destructive.copy(alpha = 0.24f), RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Outlined.WarningAmber, null, tint = c.destructive, modifier = Modifier.size(16.dp).padding(top = 2.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.destructive)
            SelectionContainer { Text(row.text, fontSize = 13.sp, lineHeight = 19.sp, color = c.destructive) }
            if (detail != null) {
                Text(if (open) "收起详细信息" else "详细信息", fontSize = 12.sp, color = c.destructive.copy(alpha = 0.8f), modifier = Modifier.clickable { open = !open }.padding(top = 4.dp))
                if (open) SelectionContainer { Text(detail, fontSize = 11.5.sp, fontFamily = FontFamily.Monospace, color = c.destructive) }
            }
        }
    }
}

@Composable fun UserTurn(row: TranscriptRow) {
    val c = Kooyu.colors
    val parts = remember(row.text) { splitAttachments(row.text) }
    var preview by remember { mutableStateOf<Pair<String, String>?>(null) }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.fillMaxWidth(0.86f).wrapContentWidth(Alignment.End)
                .clip(RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)).background(c.bubble)
                .border(1.dp, c.borderSubtle, RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp))
                .padding(horizontal = 15.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            row.origin?.let { Text(it, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary) }
            if (parts.text.isNotBlank()) MessageMarkdown(parts.text)
            parts.files.forEach { file ->
                Row(Modifier.clip(RoundedCornerShape(8.dp)).background(c.paper).border(1.dp, c.borderSubtle, RoundedCornerShape(8.dp))
                    .clickable { preview = file }.padding(horizontal = 8.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = c.textSecondary, modifier = Modifier.size(14.dp))
                    Text(file.first, fontSize = 12.sp, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    preview?.let { (name, content) ->
        AlertDialog(onDismissRequest = { preview = null }, confirmButton = { TextButton({ preview = null }) { Text("关闭") } },
            title = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) }, text = { OutputWell(content) })
    }
}

@Composable fun AssistantTurn(row: TranscriptRow, harnessId: String?, continuation: Boolean) {
    val c = Kooyu.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!continuation) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EngineBadge(harnessId, 20.dp)
            Text(harnessVisual(harnessId).name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, modifier = Modifier.weight(1f))
            CopyIconButton(row.text)
        }
        MessageMarkdown(row.text)
        if (continuation) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { CopyIconButton(row.text, size = 26) }
    }
}

@Composable fun RunIndicator(label: String = "原生执行中") {
    val c = Kooyu.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = c.text, trackColor = c.borderSubtle)
        Text(label, fontSize = 12.5.sp, color = c.textSecondary)
    }
}

/** One transcript block rendered in desktop order and style. */
@Composable fun TranscriptBlockView(block: TranscriptBlock, harnessId: String?, live: Boolean, continuation: Boolean, subagent: Boolean = false, collapseTools: Boolean = true) {
    when (block) {
        is TranscriptBlock.Tools -> ToolGroup(block.rows, collapseTools)
        is TranscriptBlock.Single -> {
            val row = block.row
            when (row.role) {
                RowRole.THINKING -> ThinkingBlock(row, live)
                RowRole.SUBAGENT -> row.child?.let { SubagentCard(it, harnessId) }
                RowRole.USER -> UserTurn(row)
                RowRole.ERROR -> ErrorTurn(row, if (subagent) "子代理本轮失败" else harnessVisual(harnessId).name + " 本轮失败")
                else -> AssistantTurn(row, harnessId, continuation)
            }
        }
    }
}

/** Assistant rows after the first in a turn drop the header, like desktop `is-cont`. */
fun continuationFlags(blocks: List<TranscriptBlock>): List<Boolean> {
    var seen = false
    return blocks.map { b ->
        val row = (b as? TranscriptBlock.Single)?.row
        when (row?.role) {
            RowRole.USER, RowRole.ERROR -> { seen = false; false }
            RowRole.ASSISTANT -> { val cont = seen; seen = true; cont }
            else -> false
        }
    }
}

/** Non-lazy transcript for nested sub-agent output. */
@Composable fun TranscriptColumn(t: Transcript, harnessId: String?, running: Boolean, subagent: Boolean) {
    val blocks = remember(t) { transcriptBlocks(t.rows) }
    val cont = remember(blocks) { continuationFlags(blocks) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        blocks.forEachIndexed { i, b -> TranscriptBlockView(b, harnessId, running && t.thinkingPending && i == blocks.lastIndex, cont[i], subagent) }
    }
}

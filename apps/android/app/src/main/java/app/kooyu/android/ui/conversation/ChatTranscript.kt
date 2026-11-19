package app.kooyu.android.ui.conversation

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.screens.*

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
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private fun Modifier.capsule(colors: KooyuColors, tone: ToolStatus? = null) = this
    .clip(RoundedCornerShape(12.dp))
    .background(when (tone) { ToolStatus.FAILED -> colors.destructiveTint; else -> colors.sunken.copy(alpha = 0.65f) })
    .border(0.5.dp, when (tone) { ToolStatus.FAILED -> colors.destructive.copy(alpha = 0.28f); ToolStatus.RUNNING -> colors.info.copy(alpha = 0.35f); else -> colors.borderSubtle }, RoundedCornerShape(12.dp))

@Composable private fun pulseAlpha(active: Boolean): Float {
    if (!active) return 1f
    val t = rememberInfiniteTransition(label = "pulse")
    val a by t.animateFloat(1f, 0.45f, KooyuMotion.pulse(), label = "alpha")
    return a
}

@Composable private fun StatusIcon(icon: ImageVector, tone: ToolStatus?) {
    val c = Kooyu.colors
    val (bg, fg) = when (tone) {
        ToolStatus.FAILED -> c.destructiveTint to c.destructive
        ToolStatus.RUNNING -> c.infoTint to c.info
        else -> c.paper to c.textSecondary
    }
    Box(
        Modifier
            .size(22.dp)
            .alpha(pulseAlpha(tone == ToolStatus.RUNNING))
            .clip(RoundedCornerShape(7.dp))
            .background(bg)
            .border(0.5.dp, if (tone == null || tone == ToolStatus.DONE) c.borderSubtle else Color.Transparent, RoundedCornerShape(7.dp)),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(13.dp))
    }
}

@Composable fun StatusChip(text: String, tone: ToolStatus?) {
    val c = Kooyu.colors
    val (bg, fg) = when (tone) {
        ToolStatus.FAILED -> c.destructiveTint to c.destructive
        ToolStatus.RUNNING -> c.infoTint to c.info
        ToolStatus.DONE -> c.successTint to c.doneText
        null -> c.paper.copy(alpha = 0.78f) to c.textTertiary
    }
    Text(
        text,
        fontSize = 10.5.sp,
        fontWeight = FontWeight.SemiBold,
        color = fg,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 7.dp, vertical = 2.dp)
    )
}

@Composable private fun Chevron(open: Boolean) {
    val angle by animateFloatAsState(if (open) 90f else 0f, KooyuMotion.BaseFloat, label = "chevron")
    Icon(Icons.Outlined.ChevronRight, if (open) "收起" else "展开", tint = Kooyu.colors.textTertiary, modifier = Modifier.size(16.dp).rotate(angle))
}

@Composable private fun Expandable(open: Boolean, content: @Composable () -> Unit) =
    AnimatedVisibility(open, enter = expandVertically(KooyuMotion.BaseIntSize) + fadeIn(KooyuMotion.base()),
        exit = shrinkVertically(KooyuMotion.BaseIntSize) + fadeOut(KooyuMotion.snap())) { content() }

@Composable private fun SummaryRow(onClick: () -> Unit, content: @Composable RowScope.() -> Unit) =
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 38.dp).padding(horizontal = 11.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        content = content
    )

@Composable private fun OutputWell(text: String) {
    val c = Kooyu.colors
    val shown = if (text.length > 20000) text.take(20000) + "\n…（已截断）" else text
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(max = 320.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (c.dark) Color(0xFF111318) else c.paper)
            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(10.dp))
            .verticalScroll(rememberScrollState())
    ) {
        SelectionContainer {
            Text(
                shown,
                style = KooyuType.mono,
                fontSize = 11.5.sp,
                lineHeight = 17.sp,
                color = c.textSecondary,
                softWrap = false,
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(11.dp)
            )
        }
    }
}

private fun toolIcon(title: String, payload: org.json.JSONObject? = null): ImageVector {
    val raw = "$title ${payload?.optString("type").orEmpty()} ${payload?.optString("name").orEmpty()}".lowercase()
    return when {
        raw.contains("命令") || raw.contains("command") || raw.contains("bash") || raw.contains("shell") || raw.contains("exec") -> Icons.Outlined.Terminal
        raw.contains("修改") || raw.contains("write") || raw.contains("edit") || raw.contains("patch") || raw.contains("filechange") -> Icons.Outlined.EditNote
        raw.contains("网页") || raw.contains("web") || raw.contains("url") || raw.contains("fetch") -> Icons.Outlined.Public
        raw.contains("搜索") || raw.contains("search") || raw.contains("grep") || raw.contains("glob") -> Icons.Outlined.Search
        raw.contains("读取") || raw.contains("read") || raw.contains("文件") -> Icons.Outlined.Description
        raw.contains("mcp") || raw.contains(".") -> Icons.Outlined.Memory
        else -> Icons.Outlined.Build
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
            StatusIcon(toolIcon(summary.title, p), summary.status)
            Text(
                summary.title,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = c.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 150.dp)
            )
            Text(
                summary.detail,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                color = c.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            summary.status?.let { StatusChip(it.label, it) }
            Chevron(open)
        }
        Expandable(open) {
            val output = remember(p.toString()) { toolOutput(p) }
            Column(Modifier.padding(start = 11.dp, end = 11.dp, bottom = 11.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { CopyPillButton(output, "复制输出") }
                OutputWell(output)
            }
        }
    }
}

@Composable fun ToolGroup(rows: List<TranscriptRow>, collapse: Boolean = true) {
    if (rows.size == 1 || !collapse) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { rows.forEach { ToolCard(it) } }
        return
    }
    val c = Kooyu.colors
    val summaries = rows.map { toolSummary(it.payload ?: org.json.JSONObject()) }
    val failed = summaries.count { it.status == ToolStatus.FAILED }
    val active = summaries.count { it.status == ToolStatus.RUNNING }
    val names = summaries.map { it.title }.distinct()
    val tone = when { failed > 0 -> ToolStatus.FAILED; active > 0 -> ToolStatus.RUNNING; else -> null }
    var open by rememberSaveable(rows.first().id) { mutableStateOf(false) }
    Column(Modifier.capsule(c, tone).fillMaxWidth()) {
        SummaryRow({ open = !open }) {
            StatusIcon(Icons.Outlined.Layers, tone)
            Text("${rows.size} 次工具调用", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text, maxLines = 1)
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                names.take(2).forEach { name ->
                    Text(
                        name,
                        fontSize = 10.5.sp,
                        fontFamily = FontFamily.Monospace,
                        color = c.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .clip(RoundedCornerShape(6.dp))
                            .background(c.paper)
                            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 1.5.dp)
                    )
                }
                if (names.size > 2) Text("+${names.size - 2}", fontSize = 10.5.sp, color = c.textTertiary)
            }
            if (active > 0) StatusChip("$active 进行中", ToolStatus.RUNNING)
            if (failed > 0) StatusChip("$failed 失败", ToolStatus.FAILED)
            Chevron(open)
        }
        Expandable(open) {
            Column {
                rows.forEach {
                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)
                    ToolCard(it, grouped = true)
                }
            }
        }
    }
}

@Composable fun ThinkingBlock(row: TranscriptRow, live: Boolean) {
    val c = Kooyu.colors
    var open by rememberSaveable(row.id) { mutableStateOf(false) }
    var wasLive by remember(row.id) { mutableStateOf(live) }
    LaunchedEffect(live) { if (wasLive && !live) open = false; wasLive = live }
    val latest = remember(row.text) { row.text.lineSequence().map { it.trim() }.lastOrNull { it.isNotEmpty() }.orEmpty() }
    val shimmer = if (live) rememberShimmerBrush() else null
    val cardModifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(12.dp))
        .then(if (shimmer != null) Modifier.background(shimmer) else Modifier.background(c.sunken.copy(alpha = 0.55f)))
        .border(0.5.dp, if (live) c.info.copy(alpha = 0.42f) else c.borderSubtle, RoundedCornerShape(12.dp))
    Column(cardModifier) {
        SummaryRow({ open = !open }) {
            Box(
                Modifier
                    .size(22.dp)
                    .alpha(pulseAlpha(live))
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (live) c.infoTint else c.paper)
                    .border(0.5.dp, if (live) Color.Transparent else c.borderSubtle, RoundedCornerShape(7.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Outlined.Psychology, null, tint = if (live) c.info else c.textSecondary, modifier = Modifier.size(14.dp))
            }
            Text(
                if (live) "正在思考…" else "已思考",
                style = KooyuType.label,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = c.text
            )
            Text(
                if (!open) latest else "",
                style = KooyuType.caption,
                fontSize = 11.5.sp,
                color = c.textTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            Chevron(open)
        }
        AnimatedVisibility(
            open,
            enter = expandVertically(KooyuMotion.BaseIntSize) + fadeIn(KooyuMotion.base()),
            exit = shrinkVertically(KooyuMotion.BaseIntSize) + fadeOut(KooyuMotion.base())
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 14.dp, bottom = 12.dp, top = 2.dp)
            ) {
                Box(Modifier.width(2.dp).height(IntrinsicSize.Max).background(c.border))
                SelectionContainer {
                    Text(
                        row.text,
                        style = KooyuType.body,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                        color = c.textSecondary,
                        modifier = Modifier.padding(start = 12.dp)
                    )
                }
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
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.sunken.copy(alpha = 0.65f))
            .border(BorderStroke(0.5.dp, c.borderSubtle), RoundedCornerShape(14.dp))
    ) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = 42.dp).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(Modifier.size(22.dp).clip(RoundedCornerShape(7.dp)).background(c.paper).border(0.5.dp, c.borderSubtle, RoundedCornerShape(7.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.AccountTree, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
            }
            Text("子代理 · " + (child.name ?: child.agentId), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.text,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            StatusChip(status, tone)
            Chevron(open)
        }
        Expandable(open) {
            Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(child.agentId, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = c.textTertiary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val all = inner.rows.joinToString("\n") { if (it.role == RowRole.TOOL) toolOutput(it.payload ?: org.json.JSONObject()) else it.text }
                    CopyPillButton(all, "复制")
                }
                child.parentAgentId?.let { Text("父代理：$it", fontSize = 11.sp, color = c.textTertiary) }
                if (inner.rows.isEmpty()) Text("状态通知", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = c.textTertiary)
                else TranscriptColumn(inner, harnessId, running = tone == ToolStatus.RUNNING, subagent = true)
            }
        }
    }
}

@Composable fun ErrorTurn(row: TranscriptRow, title: String) {
    val c = Kooyu.colors
    var open by remember { mutableStateOf(false) }
    val detail = row.payload?.optJSONObject("error")?.optString("detail")?.takeIf { it.isNotBlank() }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.destructiveTint)
            .border(0.5.dp, c.destructive.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Icon(Icons.Outlined.WarningAmber, null, tint = c.destructive, modifier = Modifier.size(17.dp).padding(top = 2.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.destructive)
            SelectionContainer { Text(row.text, fontSize = 13.sp, lineHeight = 19.sp, color = c.destructive) }
            if (detail != null) {
                Text(
                    if (open) "收起详细信息" else "查看详细报错 ▾",
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = c.destructive.copy(alpha = 0.85f),
                    modifier = Modifier.clickable { open = !open }.padding(top = 4.dp)
                )
                if (open) SelectionContainer {
                    Text(detail, fontSize = 11.5.sp, fontFamily = FontFamily.Monospace, color = c.destructive, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
    }
}

private val UserBubbleShape = RoundedCornerShape(20.dp, 20.dp, 5.dp, 20.dp)

@Composable private fun MessageVariantsPill(variants: MessageVariantState) {
    val c = Kooyu.colors
    val canPrev = !variants.disabled && variants.index > 0
    val canNext = !variants.disabled && variants.index < variants.count - 1
    Row(
        Modifier
            .height(26.dp)
            .clip(CircleShape)
            .background(c.sunken.copy(alpha = 0.85f))
            .border(0.5.dp, c.borderSubtle, CircleShape)
            .padding(horizontal = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Box(
            Modifier
                .size(20.dp)
                .clip(CircleShape)
                .clickable(enabled = canPrev, onClickLabel = "上一个消息分支") { variants.selectOffset(-1) }
                .semantics { contentDescription = "上一个消息分支" },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Outlined.ChevronLeft,
                null,
                tint = if (canPrev) c.textSecondary else c.textTertiary.copy(alpha = 0.35f),
                modifier = Modifier.size(14.dp)
            )
        }
        Text(
            "${variants.index + 1} / ${variants.count}",
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = c.textSecondary,
            modifier = Modifier.padding(horizontal = 3.dp)
        )
        Box(
            Modifier
                .size(20.dp)
                .clip(CircleShape)
                .clickable(enabled = canNext, onClickLabel = "下一个消息分支") { variants.selectOffset(1) }
                .semantics { contentDescription = "下一个消息分支" },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Outlined.ChevronRight,
                null,
                tint = if (canNext) c.textSecondary else c.textTertiary.copy(alpha = 0.35f),
                modifier = Modifier.size(14.dp)
            )
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable fun UserTurn(
    row: TranscriptRow,
    timeLabel: String = "",
    onEdit: ((TranscriptRow) -> Unit)? = null,
    onEditSave: (suspend (TranscriptRow, String) -> Boolean)? = null,
    onBranch: ((TranscriptRow) -> Unit)? = null,
    variants: MessageVariantState? = null,
) {
    val c = Kooyu.colors
    val scope = rememberCoroutineScope()
    val parts = remember(row.text) { splitAttachments(row.text) }
    var preview by remember { mutableStateOf<Pair<String, String>?>(null) }
    var menu by remember { mutableStateOf(false) }
    var editing by remember(row.id) { mutableStateOf(false) }
    var draft by remember(row.id, row.text) { mutableStateOf(row.text) }
    var saving by remember(row.id) { mutableStateOf(false) }
    val editFocus = remember { FocusRequester() }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val bubbleBg = if (c.dark) Color(0xFF20232B) else Color(0xFFEFEFF3)
    val canEdit = onEditSave != null || onEdit != null

    LaunchedEffect(editing) {
        if (editing) runCatching { editFocus.requestFocus() }
    }

    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        if (editing) {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = c.raised,
                border = BorderStroke(1.dp, c.borderStrong),
                shadowElevation = if (c.dark) 0.dp else 3.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    Modifier.padding(start = 15.dp, end = 15.dp, top = 13.dp, bottom = 11.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    BasicTextField(
                        value = draft,
                        onValueChange = { if (!saving) draft = it.take(200000) },
                        enabled = !saving,
                        minLines = 2,
                        maxLines = 8,
                        textStyle = KooyuType.body.copy(color = c.text, fontSize = 14.5.sp, lineHeight = 22.sp),
                        cursorBrush = SolidColor(c.accent),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(editFocus)
                            .semantics { contentDescription = "消息内容" }
                    )
                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier
                                .height(34.dp)
                                .clip(CircleShape)
                                .clickable(enabled = !saving, onClickLabel = "取消") { editing = false }
                                .semantics { contentDescription = "取消" }
                        ) {
                            Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                                Text("取消", fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                            }
                        }
                        val submitEnabled = !saving && draft.trim().isNotEmpty()
                        Surface(
                            shape = CircleShape,
                            color = if (submitEnabled) c.accent else c.sunken,
                            modifier = Modifier
                                .height(34.dp)
                                .clip(CircleShape)
                                .clickable(enabled = submitEnabled, onClickLabel = "保存并继续") {
                                    if (onEditSave != null) {
                                        saving = true
                                        scope.launch {
                                            try {
                                                if (onEditSave(row, draft)) editing = false
                                            } finally {
                                                saving = false
                                            }
                                        }
                                    } else if (onEdit != null) {
                                        editing = false
                                        onEdit(row.copy(text = draft))
                                    }
                                }
                                .semantics { contentDescription = "保存并继续" }
                        ) {
                            Box(Modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    if (saving) "正在发送…" else "保存并继续",
                                    fontSize = 12.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (submitEnabled) c.onAccent else c.textTertiary
                                )
                            }
                        }
                    }
                }
            }
        } else {
            Box {
                Column(
                    Modifier
                        .fillMaxWidth(0.86f)
                        .wrapContentWidth(Alignment.End)
                        .clip(UserBubbleShape)
                        .background(bubbleBg)
                        .border(0.5.dp, c.borderSubtle, UserBubbleShape)
                        .combinedClickable(
                            onClickLabel = null,
                            onLongClickLabel = "消息操作",
                            onClick = {},
                            onLongClick = {
                                haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                                menu = true
                            }
                        )
                        .padding(horizontal = 15.dp, vertical = 11.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    row.origin?.let { Text(it, style = KooyuType.caption, fontWeight = FontWeight.SemiBold, color = c.textSecondary) }
                    if (parts.text.isNotBlank()) MessageMarkdown(parts.text, fontSize = 14.5f, color = c.text)
                    parts.files.forEach { file ->
                        Row(
                            Modifier
                                .clip(RoundedCornerShape(9.dp))
                                .background(c.paper)
                                .border(0.5.dp, c.borderSubtle, RoundedCornerShape(9.dp))
                                .clickable { preview = file }
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = c.textSecondary, modifier = Modifier.size(15.dp))
                            Text(file.first, style = KooyuType.label, fontSize = 12.sp, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                DropdownMenu(menu, { menu = false }, shape = RoundedCornerShape(14.dp), containerColor = c.raised) {
                    DropdownMenuItem(
                        { Text("复制全文", color = c.text) },
                        { menu = false; clipboard.setText(androidx.compose.ui.text.AnnotatedString(row.text)) },
                        leadingIcon = { Icon(Icons.Outlined.ContentCopy, null, tint = c.textSecondary, modifier = Modifier.size(18.dp)) }
                    )
                    if (canEdit) DropdownMenuItem(
                        { Text("编辑消息", color = c.text) },
                        { menu = false; draft = row.text; editing = true },
                        leadingIcon = { Icon(Icons.Outlined.Edit, null, tint = c.textSecondary, modifier = Modifier.size(18.dp)) }
                    )
                    if (onBranch != null) DropdownMenuItem(
                        { Text("分支到新聊天", color = c.text) },
                        { menu = false; onBranch(row) },
                        leadingIcon = { Icon(Icons.Outlined.CallSplit, null, tint = c.textSecondary, modifier = Modifier.size(18.dp)) }
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (timeLabel.isNotBlank()) {
                    Text(timeLabel, fontSize = 11.sp, color = c.textTertiary)
                }
                if (variants != null && variants.count > 1) {
                    MessageVariantsPill(variants)
                }
                CopyIconButton(row.text, size = 26)
                if (canEdit) {
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(c.sunken.copy(alpha = 0.72f))
                            .border(0.5.dp, c.borderSubtle, CircleShape)
                            .clickable(onClickLabel = "编辑消息") {
                                draft = row.text
                                editing = true
                            }
                            .semantics { contentDescription = "编辑消息" },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Outlined.Edit, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
                    }
                }
            }
        }
    }
    preview?.let { (name, content) ->
        AlertDialog(
            onDismissRequest = { preview = null },
            containerColor = c.raised,
            confirmButton = { TextButton({ preview = null }) { Text("关闭", color = c.text) } },
            title = { Text(name, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            text = { OutputWell(content) }
        )
    }
}

@Composable fun AssistantTurn(
    row: TranscriptRow,
    harnessId: String?,
    continuation: Boolean,
    modelName: String? = null,
    timeLabel: String = "",
    onBranch: ((TranscriptRow) -> Unit)? = null
) {
    val c = Kooyu.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!continuation) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                EngineBadge(harnessId, 26.dp, circle = false)
                Text(
                    if (harnessId == "kodo" || harnessId == "kooyu" || harnessId == null) "Kooyu" else harnessVisual(harnessId).name,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.text
                )
                if (!modelName.isNullOrBlank()) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = c.sunken,
                        border = BorderStroke(0.5.dp, c.borderSubtle)
                    ) {
                        Text(
                            modelName.substringAfterLast('/'),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.5.sp,
                            color = c.textSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 128.dp).padding(horizontal = 6.dp, vertical = 1.5.dp)
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                if (timeLabel.isNotBlank()) {
                    Text(timeLabel, fontSize = 11.sp, color = c.textTertiary)
                }
            }
        }
        MessageMarkdown(row.text)
        Row(
            Modifier.fillMaxWidth().padding(top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            CopyPillButton(row.text, "复制")
            if (onBranch != null && row.createdAt != null) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(c.sunken.copy(alpha = 0.8f))
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(999.dp))
                        .clickable { onBranch(row) }
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Outlined.CallSplit, null, tint = c.textSecondary, modifier = Modifier.size(12.dp))
                    Text("分支对话", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                }
            }
        }
    }
}

@Composable fun RunIndicator(label: String = "原生执行中") {
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = c.raised,
        border = BorderStroke(0.5.dp, c.borderSubtle),
        modifier = Modifier
            .padding(vertical = 4.dp)
            .then(if (c.dark) Modifier else Modifier.shadow(3.dp, RoundedCornerShape(999.dp), ambientColor = Color.Black.copy(alpha = 0.06f)))
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 7.dp)
        ) {
            PulsingDot(c.brandCoral, pulsing = true, size = 7.dp)
            Text(label, style = KooyuType.label, fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = c.text)
        }
    }
}

/** One transcript block rendered in desktop order and style. */
@Composable fun TranscriptBlockView(
    block: TranscriptBlock,
    harnessId: String?,
    live: Boolean,
    continuation: Boolean,
    subagent: Boolean = false,
    collapseTools: Boolean = true,
    modelName: String? = null,
    onEdit: ((TranscriptRow) -> Unit)? = null,
    onEditSave: (suspend (TranscriptRow, String) -> Boolean)? = null,
    onBranch: ((TranscriptRow) -> Unit)? = null,
    variants: MessageVariantState? = null,
) {
    when (block) {
        is TranscriptBlock.Tools -> ToolGroup(block.rows, collapseTools)
        is TranscriptBlock.Single -> {
            val row = block.row
            val timeLabel = remember(row.createdAt) {
                row.createdAt?.let { stamp ->
                    runCatching {
                        java.time.Instant.parse(stamp)
                            .atZone(java.time.ZoneId.systemDefault())
                            .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
                    }.getOrDefault("")
                }.orEmpty()
            }
            when (row.role) {
                RowRole.THINKING -> ThinkingBlock(row, live)
                RowRole.SUBAGENT -> row.child?.let { SubagentCard(it, harnessId) }
                RowRole.USER -> UserTurn(
                    row = row,
                    timeLabel = timeLabel,
                    onEdit = if (subagent) null else onEdit,
                    onEditSave = if (subagent) null else onEditSave,
                    onBranch = if (subagent || row.createdAt == null) null else onBranch,
                    variants = if (subagent) null else variants,
                )
                RowRole.ERROR -> ErrorTurn(row, if (subagent) "子代理本轮失败" else harnessVisual(harnessId).name + " 本轮失败")
                else -> AssistantTurn(
                    row = row,
                    harnessId = harnessId,
                    continuation = continuation,
                    modelName = modelName,
                    timeLabel = timeLabel,
                    onBranch = if (subagent) null else onBranch
                )
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
        blocks.forEachIndexed { i, b ->
            TranscriptBlockView(b, harnessId, running && t.thinkingPending && i == blocks.lastIndex, cont[i], subagent)
        }
    }
}

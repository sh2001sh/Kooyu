package app.kooyu.android.ui.home

import app.kooyu.android.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.roundToInt

/** 刚刚 / N 分钟前 / HH:mm / 昨天 / M月d日 — matches the desktop sidebar's relative stamps. */
fun relativeTime(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
    val time = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return ""
    val seconds = now.epochSecond - time.epochSecond
    if (seconds < 60) return "刚刚"
    if (seconds < 3600) return "${seconds / 60} 分钟前"
    val day = time.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    return when {
        day == today -> time.atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm"))
        day == today.minusDays(1) -> "昨天"
        day.year == today.year -> time.atZone(zone).format(DateTimeFormatter.ofPattern("M月d日"))
        else -> time.atZone(zone).format(DateTimeFormatter.ofPattern("yyyy/M/d"))
    }
}

val HostSession.createdAt: String? get() = raw.nullableString("createdAt")

/** Plan §5.1 A.4: one raised 16dp container per group; rows are separated by inset hairlines. */
@Composable fun InsetGroupCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = c.raised,
        border = BorderStroke(0.5.dp, c.borderSubtle),
        shadowElevation = if (c.dark) 0.dp else 0.5.dp,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(Modifier.animateContentSize(KooyuMotion.BaseIntSize), content = content)
    }
}

@Composable fun InsetDivider(start: Int = 52) {
    HorizontalDivider(color = Kooyu.colors.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = start.dp))
}

/** Group header shared by project and harness grouping. */
@Composable fun SessionGroupHeader(
    title: String,
    count: Int,
    collapsed: Boolean,
    onToggle: () -> Unit,
    leading: (@Composable () -> Unit)? = null,
    meta: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = Kooyu.colors
    val angle by animateFloatAsState(if (collapsed) -90f else 0f, KooyuMotion.SnapFloat, label = "groupChevron")
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 10.dp, top = 10.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = if (collapsed) "展开分组" else "折叠分组") { onToggle() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(Icons.Outlined.ExpandMore, null, tint = c.textTertiary, modifier = Modifier.size(15.dp).rotate(angle))
            leading?.invoke()
            Text(
                title,
                style = KooyuType.sectionHeader,
                fontSize = 13.sp,
                color = c.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )
            Text("$count", style = KooyuType.caption, color = c.textTertiary)
            if (meta != null) Text(meta, style = KooyuType.caption, color = c.info)
        }
        actions()
    }
}

/**
 * Two-line session row: badge + title + relative time, then status dot + word + short detail.
 * A 3dp coral bar marks the active or most recent session.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable fun SessionRow(
    session: HostSession,
    detail: String?,
    marked: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by rememberPressScale(interaction, 0.985f)
    val background by animateColorAsState(
        targetValue = when {
            pressed -> c.sunken
            selected -> c.accentTint
            else -> c.raised
        },
        animationSpec = KooyuMotion.snap(),
        label = "rowBg"
    )
    Box(
        Modifier
            .fillMaxWidth()
            .background(c.raised)
            .background(background)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                onClickLabel = "打开对话",
                onLongClickLabel = "会话操作",
                onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onLongClick() },
                onClick = onClick
            )
            .semantics { customActions = listOf(CustomAccessibilityAction("会话操作") { onLongClick(); true }) }
    ) {
        if (marked || selected) Box(
            Modifier.align(Alignment.CenterStart).padding(start = 4.dp).width(3.dp).height(30.dp)
                .clip(RoundedCornerShape(2.dp)).background(c.brandCoral)
        )
        Row(
            Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            EngineBadge(session.harnessId, 34.dp, circle = false)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (session.pinned) Icon(Icons.Filled.PushPin, "置顶", tint = c.textTertiary, modifier = Modifier.size(12.dp))
                    Text(
                        session.title.ifBlank { "未命名会话" },
                        style = KooyuType.rowTitle,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = c.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Text(relativeTime(session.createdAt), style = KooyuType.caption, fontSize = 11.5.sp, color = c.textTertiary, maxLines = 1)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusBadge(sessionStatus(session))
                    if (!detail.isNullOrBlank()) {
                        Text("·", style = KooyuType.caption, color = c.textTertiary)
                        Text(detail, style = KooyuType.caption, fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

/**
 * Right swipe (StartToEnd): Pin/Unpin with threshold bounce (1.22x) + LongPress haptic.
 * Left swipe (EndToStart): Reveals Archive + Delete action tray cleanly without accidental deletes.
 */
@Composable fun SwipeableSessionRow(
    session: HostSession,
    enabled: Boolean,
    onPin: () -> Unit,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    content: @Composable () -> Unit,
) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val pinThresholdPx = with(density) { 74.dp.toPx() }
    val actionTrayWidthDp = 128.dp
    val actionTrayPx = with(density) { actionTrayWidthDp.toPx() }
    val offsetX = remember(session.id) { Animatable(0f) }
    var crossedPin by remember(session.id) { mutableStateOf(false) }
    var crossedTray by remember(session.id) { mutableStateOf(false) }

    val pinBounce by animateFloatAsState(
        targetValue = if (offsetX.value >= pinThresholdPx) 1.08f else 1f,
        animationSpec = KooyuMotion.GlideFloat,
        label = "pinBounce"
    )
    val trayBounce by animateFloatAsState(
        targetValue = if (offsetX.value <= -actionTrayPx * 0.55f) 1.05f else 0.98f,
        animationSpec = KooyuMotion.GlideFloat,
        label = "trayBounce"
    )

    Box(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(0.dp))
    ) {
        if (offsetX.value > 2f) {
            Row(
                Modifier
                    .matchParentSize()
                    .background(if (session.pinned) c.sunken else c.brandCoral)
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Start
            ) {
                Icon(
                    Icons.Filled.PushPin,
                    null,
                    tint = if (session.pinned) c.text else Color.White,
                    modifier = Modifier
                        .size(18.dp)
                        .graphicsLayer { scaleX = pinBounce; scaleY = pinBounce }
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    if (session.pinned) "取消置顶" else "置顶",
                    style = KooyuType.label,
                    fontWeight = FontWeight.SemiBold,
                    color = if (session.pinned) c.text else Color.White
                )
            }
        } else if (offsetX.value < -2f) {
            Row(
                Modifier
                    .align(Alignment.CenterEnd)
                    .width(actionTrayWidthDp)
                    .fillMaxHeight()
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .background(c.info)
                        .clickable(enabled = enabled) {
                            scope.launch { offsetX.animateTo(0f, KooyuMotion.SnapFloat) }
                            onArchive()
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                        modifier = Modifier.graphicsLayer { scaleX = trayBounce; scaleY = trayBounce }
                    ) {
                        Icon(if (session.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, null, tint = Color.White, modifier = Modifier.size(18.dp))
                        Text(if (session.archived) "恢复" else "归档", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                }
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .background(c.destructive)
                        .clickable(enabled = enabled) {
                            scope.launch { offsetX.animateTo(0f, KooyuMotion.SnapFloat) }
                            onDelete()
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                        modifier = Modifier.graphicsLayer { scaleX = trayBounce; scaleY = trayBounce }
                    ) {
                        Icon(Icons.Outlined.Delete, null, tint = Color.White, modifier = Modifier.size(18.dp))
                        Text("删除", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                }
            }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .draggable(
                    enabled = enabled,
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { delta ->
                        val next = (offsetX.value + delta).coerceIn(-actionTrayPx - 28f, pinThresholdPx + 34f)
                        if (next >= pinThresholdPx && !crossedPin) {
                            crossedPin = true
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        } else if (next < pinThresholdPx * 0.7f) {
                            crossedPin = false
                        }
                        if (next <= -actionTrayPx * 0.5f && !crossedTray) {
                            crossedTray = true
                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        } else if (next > -actionTrayPx * 0.35f) {
                            crossedTray = false
                        }
                        scope.launch { offsetX.snapTo(next) }
                    },
                    onDragStopped = {
                        val cur = offsetX.value
                        scope.launch {
                            when {
                                cur >= pinThresholdPx -> {
                                    onPin()
                                    offsetX.animateTo(0f, KooyuMotion.SnapFloat)
                                }
                                cur <= -actionTrayPx * 0.45f -> {
                                    offsetX.animateTo(-actionTrayPx, KooyuMotion.BaseFloat)
                                }
                                else -> {
                                    offsetX.animateTo(0f, KooyuMotion.SnapFloat)
                                }
                            }
                            crossedPin = false
                        }
                    }
                )
        ) {
            content()
        }
    }
}

/** Pinned L0 Bento Hero card for the global Kooyu supervisor with Ambient Commander Aura & Quick Dispatch. */
@Composable fun CommanderCard(
    session: HostSession?,
    onQuickPrompt: ((String) -> Unit)? = null,
    onOpen: () -> Unit,
) {
    val c = Kooyu.colors
    val active = session != null && (session.runState == "running" || session.runState == "waiting-input")
    val auraRotation = if (active) {
        val transition = rememberInfiniteTransition(label = "commanderAura")
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(4200, easing = LinearEasing), RepeatMode.Restart),
            label = "auraAngle"
        ).value
    } else 0f

    val shape = RoundedCornerShape(20.dp)
    Surface(
        shape = shape,
        color = c.raised,
        border = if (active) null else BorderStroke(0.5.dp, c.border),
        shadowElevation = if (c.dark) 0.dp else 1.5.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .then(
                if (active) Modifier.drawBehind {
                    val rad = Math.toRadians(auraRotation.toDouble())
                    val cx = size.width * 0.5f
                    val cy = size.height * 0.5f
                    val dx = kotlin.math.cos(rad).toFloat() * cx
                    val dy = kotlin.math.sin(rad).toFloat() * cy
                    val strokePx = 1.4.dp.toPx()
                    val r = 20.dp.toPx()
                    drawRoundRect(
                        brush = Brush.linearGradient(
                            colors = listOf(
                                c.brandCoral,
                                c.borderStrong,
                                c.brandCoral.copy(alpha = 0.25f),
                                c.brandCoral
                            ),
                            start = Offset(cx - dx, cy - dy),
                            end = Offset(cx + dx, cy + dy)
                        ),
                        cornerRadius = CornerRadius(r, r),
                        style = Stroke(width = strokePx)
                    )
                } else Modifier
            )
            .kooyuPressable(onClickLabel = "打开 Kooyu 主对话") { onOpen() }
    ) {
        Column(
            Modifier.padding(horizontal = 15.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                EngineBadge("kodo", 40.dp, circle = false)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Kooyu 主对话", style = KooyuType.rowTitle, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.weight(1f), maxLines = 1)
                        if (session != null) {
                            StatusBadge(sessionStatus(session))
                            Text(relativeTime(session.createdAt), style = KooyuType.caption, color = c.textTertiary)
                        } else {
                            Surface(shape = RoundedCornerShape(999.dp), color = c.sunken) {
                                Text("点击开启", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                            }
                        }
                    }
                    Text(
                        "统筹本机所有项目、定时任务与全局记忆的智能中枢",
                        style = KooyuType.caption,
                        fontSize = 12.5.sp,
                        lineHeight = 17.sp,
                        color = c.textSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            if (onQuickPrompt != null) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf(
                        "汇报进展" to "按项目汇报我所有会话的进展：哪些在运行、卡住、失败或等待我处理。",
                        "巡检项目" to "检查当前活跃项目的 Git 改动与风险点，给出简短结论。",
                        "自动计划" to "帮我创建一个自动巡检或汇总计划，先与我确认执行时间与边界。"
                    ).forEach { (chipLabel, promptText) ->
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier.clickable {
                                if (session != null) onOpen() else onQuickPrompt(promptText)
                            }
                        ) {
                            Text(
                                chipLabel,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = c.text,
                                modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Small navigation row inside an inset group. */
@Composable fun InsetLinkRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, onClick: () -> Unit) {
    val c = Kooyu.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 46.dp).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(Modifier.size(26.dp).clip(RoundedCornerShape(7.dp)).background(c.sunken), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.textSecondary, modifier = Modifier.size(15.dp))
        }
        Text(title, style = KooyuType.rowTitle, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = c.textTertiary, modifier = Modifier.size(12.dp))
    }
}

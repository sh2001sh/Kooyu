package app.kooyu.android.ui.components

import app.kooyu.android.ui.theme.*

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin

/** Long hex host ids read as noise; keep the head and tail. */
fun displayDeviceName(raw: String): String =
    if (raw.length > 16 && raw.matches(Regex("^[0-9a-fA-F]+$"))) raw.take(6) + "…" + raw.takeLast(4) else raw

/**
 * Compact single-row frosted header:
 * Left: Bold page title (`对话` / `项目` / `用量` / `设置`) + compact `[🟢 设备 ▾]` status pill
 * Right: `[📥 收件箱(badge)]` + `[📝 新建]`
 */
@Composable fun KooyuTopBar(
    deviceName: String?,
    online: Boolean,
    title: String? = null,
    inboxCount: Int = 0,
    onOpenInbox: (() -> Unit)? = null,
    showCreate: Boolean,
    canCreate: Boolean,
    onDevice: () -> Unit,
    onCreate: () -> Unit,
) {
    val c = Kooyu.colors
    Box(Modifier.fillMaxWidth()) {
        Box(Modifier.matchParentSize().kooyuGlassSurface(topHighlight = false))
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(54.dp)
                .padding(start = 16.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (!title.isNullOrBlank()) {
                Text(
                    title,
                    fontSize = 21.sp,
                    lineHeight = 25.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.5).sp,
                    color = c.text,
                    maxLines = 1,
                )
            }
            if (deviceName != null) {
                DeviceStatusPill(deviceName, online, onDevice)
            }
            Spacer(Modifier.weight(1f))
            if (onOpenInbox != null) {
                InboxTopButton(inboxCount = inboxCount, onClick = onOpenInbox)
            }
            if (showCreate) CreateButton(canCreate, onCreate)
        }
    }
}

@Composable fun InboxTopButton(inboxCount: Int, onClick: () -> Unit) {
    val c = Kooyu.colors
    val label = if (inboxCount > 0) "待办收件箱，$inboxCount 项待处理" else "待办收件箱"
    Box(
        Modifier
            .sizeIn(minWidth = 40.dp, minHeight = 44.dp)
            .kooyuPressable(onClickLabel = "打开收件箱") { onClick() }
            .semantics { contentDescription = label; role = Role.Button },
        contentAlignment = Alignment.Center
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(c.raised.copy(alpha = 0.92f))
                    .border(0.5.dp, c.border, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Outlined.Inbox,
                    contentDescription = null,
                    tint = c.text,
                    modifier = Modifier.size(16.dp)
                )
            }
            if (inboxCount > 0) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 3.dp, y = (-3).dp)
                        .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(c.brandCoral)
                        .padding(horizontal = 4.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        if (inboxCount > 99) "99+" else inboxCount.toString(),
                        fontSize = 9.5.sp,
                        lineHeight = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }
        }
    }
}

@Composable fun DeviceStatusPill(name: String, online: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Kooyu.colors
    val label = if (online) displayDeviceName(name) else "离线 · 重连"
    Box(
        modifier
            .heightIn(min = 44.dp)
            .kooyuPressable(onClickLabel = if (online) "切换设备" else "重新连接") { onClick() }
            .semantics { contentDescription = if (online) "已连接 $name，切换设备" else "离线，点击重连" },
        contentAlignment = Alignment.CenterStart
    ) {
        Row(
            Modifier
                .height(28.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(if (online) c.raised.copy(alpha = 0.85f) else c.infoTint)
                .border(0.5.dp, if (online) c.borderSubtle else c.info.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
                .padding(start = 8.dp, end = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            PulsingDot(if (online) c.success else c.info, pulsing = !online, size = 5.5.dp)
            Text(
                label,
                style = KooyuType.caption,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = if (online) c.textSecondary else c.info,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 108.dp)
            )
            Icon(Icons.Outlined.ExpandMore, null, modifier = Modifier.size(12.dp), tint = if (online) c.textTertiary else c.info)
        }
    }
}

/** Monochrome / Accent primary compose trigger (>=44dp touch box, 34dp visual capsule). */
@Composable fun CreateButton(enabled: Boolean, onClick: () -> Unit) {
    val c = Kooyu.colors
    Box(
        Modifier
            .heightIn(min = 44.dp)
            .kooyuPressable(enabled = enabled, onClickLabel = "新建对话") { onClick() }
            .semantics { contentDescription = "新建对话"; role = Role.Button },
        contentAlignment = Alignment.Center
    ) {
        Row(
            Modifier
                .height(34.dp)
                .then(
                    if (enabled && !c.dark) Modifier.shadow(3.dp, RoundedCornerShape(17.dp), ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.12f))
                    else Modifier
                )
                .clip(RoundedCornerShape(17.dp))
                .background(if (enabled) c.accent else c.sunken)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(Icons.Outlined.Add, null, tint = if (enabled) c.onAccent else c.textTertiary, modifier = Modifier.size(15.dp))
            Text("新建", style = KooyuType.label, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = if (enabled) c.onAccent else c.textTertiary)
        }
    }
}

private val destinationLabels = listOf("对话", "项目", "用量", "设置")
private val destinationDescriptions = listOf("对话", "项目", "用量", "设置")

@Composable private fun DestinationIcon(index: Int, active: Boolean) {
    val c = Kooyu.colors
    val tint by animateColorAsState(if (active) c.text else c.textSecondary, KooyuMotion.snap(), label = "tabIconTint")
    val iconScale by animateFloatAsState(
        targetValue = if (active) 1.03f else 0.96f,
        animationSpec = KooyuMotion.SnapFloat,
        label = "tabIconScale"
    )

    val icon = when (index) {
        0 -> if (active) Icons.AutoMirrored.Filled.Chat else Icons.Outlined.ChatBubbleOutline
        1 -> if (active) Icons.Filled.Folder else Icons.Outlined.FolderOpen
        2 -> if (active) Icons.Filled.BarChart else Icons.Outlined.BarChart
        else -> if (active) Icons.Filled.Settings else Icons.Outlined.Settings
    }

    Icon(
        icon,
        null,
        tint = tint,
        modifier = Modifier
            .size(21.dp)
            .graphicsLayer {
                scaleX = iconScale
                scaleY = iconScale
            }
    )
}

@Composable private fun localizedDestinationLabels(): List<String> = listOf(
    kooyuT("dock.chats"),
    kooyuT("dock.projects"),
    kooyuT("dock.usage"),
    kooyuT("dock.settings"),
)

/** Navigation rail for >= 600dp layouts, or balanced 4-tab Liquid-Glass Dock on phones. */
@Composable internal fun Destinations(tab: Int, rail: Boolean, select: (Int) -> Unit) {
    val labels = localizedDestinationLabels()
    if (rail) {
        val haptic = LocalHapticFeedback.current
        labels.forEachIndexed { i, label ->
            NavigationRailItem(
                selected = tab == i,
                onClick = {
                    if (tab != i) {
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        select(i)
                    }
                },
                icon = { DestinationIcon(i, tab == i) },
                label = { Text(label, style = KooyuType.label) },
                colors = NavigationRailItemDefaults.colors(indicatorColor = Kooyu.colors.sunken)
            )
        }
    } else {
        KooyuDock(tab, select)
    }
}

/**
 * Floating Liquid-Glass 4-Tab Capsule (`对话 | 项目 | 用量 | 设置`):
 * - Balanced 368dp max-width floating capsule (Linear / GitHub Mobile / iOS Liquid Glass proportion)
 * - Velocity/distance-reactive Liquid Droplet pill (`scaleX` stretches mid-flight & settles on ζ=0.68 spring)
 * - Outlined-to-filled icon morph, upward spring lift, gear spin, and luminous 4dp brand-coral micro-dot
 */
@Composable fun KooyuDock(tab: Int, select: (Int) -> Unit) {
    val c = Kooyu.colors
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    var widthPx by remember { mutableIntStateOf(0) }
    val pad = 5.dp
    val padPx = with(density) { pad.toPx() }
    val itemPx = ((widthPx - padPx * 2) / destinationLabels.size).coerceAtLeast(0f)
    val targetOffset = itemPx * tab
    val offset by animateFloatAsState(
        targetValue = targetOffset,
        animationSpec = KooyuMotion.GlideFloat,
        label = "dockLiquidThumb"
    )
    val travelFraction = if (itemPx > 1f) (abs(offset - targetOffset) / itemPx).coerceIn(0f, 1f) else 0f
    val liquidPulse = sin(travelFraction * PI.toFloat())
    val shape = RoundedCornerShape(31.dp)
    val thumbShape = RoundedCornerShape(26.dp)

    Box(
        Modifier
            .widthIn(max = 368.dp)
            .fillMaxWidth()
            .height(62.dp)
            .then(
                if (c.dark) Modifier.shadow(16.dp, shape, ambientColor = Color.Black.copy(alpha = 0.55f), spotColor = Color.Black.copy(alpha = 0.55f))
                else Modifier.shadow(14.dp, shape, ambientColor = Color.Black.copy(alpha = 0.14f), spotColor = Color.Black.copy(alpha = 0.12f))
            )
            .onSizeChanged { widthPx = it.width }
    ) {
        Box(Modifier.matchParentSize().kooyuGlassSurface(shape, topHighlight = true))
        Box(
            Modifier
                .matchParentSize()
                .clip(shape)
                .background(
                    Brush.verticalGradient(
                        if (c.dark) listOf(Color.White.copy(alpha = 0.06f), Color.Transparent)
                        else listOf(Color.White.copy(alpha = 0.55f), Color.Transparent)
                    )
                )
        )
        Box(Modifier.fillMaxSize().padding(pad)) {
            if (widthPx > 0) {
                Box(
                    Modifier
                        .offset { IntOffset(offset.roundToInt(), 0) }
                        .width(with(density) { itemPx.toDp() })
                        .fillMaxHeight()
                        .graphicsLayer {
                            scaleX = 1f + 0.04f * liquidPulse
                            scaleY = 1f - 0.015f * liquidPulse
                        }
                        .then(
                            if (!c.dark) Modifier.shadow(4.dp, thumbShape, ambientColor = Color.Black.copy(alpha = 0.09f), spotColor = Color.Black.copy(alpha = 0.09f))
                            else Modifier
                        )
                        .clip(thumbShape)
                        .background(
                            Brush.verticalGradient(
                                if (c.dark) listOf(Color.White.copy(alpha = 0.13f), Color.White.copy(alpha = 0.06f))
                                else listOf(Color.White, c.paper.copy(alpha = 0.96f))
                            )
                        )
                        .border(
                            0.6.dp,
                            if (c.dark) Color.White.copy(alpha = 0.16f) else Color.Black.copy(alpha = 0.06f),
                            thumbShape
                        )
                )
            }
            val labels = localizedDestinationLabels()
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                labels.forEachIndexed { i, label ->
                    val active = tab == i
                    val textTint by animateColorAsState(if (active) c.text else c.textSecondary, KooyuMotion.snap(), label = "tabText")
                    Column(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(thumbShape)
                            .kooyuPressable(onClickLabel = label) {
                                if (!active) {
                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    select(i)
                                }
                            }
                            .semantics { contentDescription = label; role = Role.Tab; selected = active },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        DestinationIcon(i, active)
                        Spacer(Modifier.height(2.dp))
                        Text(
                            label,
                            fontSize = 10.5.sp,
                            lineHeight = 12.5.sp,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                            color = textTint,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}

package app.kooyu.android.ui.components

import app.kooyu.android.ui.theme.*

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

data class SegmentOption<T>(
    val value: T,
    val label: String,
    val badgeCount: Int? = null
)

/**
 * Sliding pill segmented control (plan §3.2.2): a raised thumb follows the selection on the Snap
 * spring instead of the background flashing.
 */
@Composable
fun <T> KooyuSegmentedControl(
    options: List<SegmentOption<T>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 36.dp
) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    var containerWidthPx by remember { mutableIntStateOf(0) }
    val selectedIndex = options.indexOfFirst { it.value == selected }.coerceAtLeast(0)
    val count = options.size.coerceAtLeast(1)
    val padDp = 3.dp
    val padPx = with(density) { padDp.toPx() }
    val innerWidthPx = (containerWidthPx - padPx * 2f).coerceAtLeast(0f)
    val itemWidthPx = innerWidthPx / count
    val animatedOffsetPx by animateFloatAsState(itemWidthPx * selectedIndex, KooyuMotion.GlideFloat, label = "segmentThumbOffset")

    Box(
        modifier = modifier
            .height(height)
            .clip(RoundedCornerShape(12.dp))
            .background(c.sunken)
            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
            .onSizeChanged { containerWidthPx = it.width }
            .padding(padDp)
    ) {
        if (containerWidthPx > 0) {
            Box(
                Modifier
                    .offset { IntOffset(animatedOffsetPx.roundToInt(), 0) }
                    .width(with(density) { itemWidthPx.toDp() })
                    .fillMaxHeight()
                    .shadow(if (c.dark) 0.dp else 1.5.dp, RoundedCornerShape(9.dp), clip = false)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (c.dark) c.raised else c.paper)
                    .border(0.5.dp, c.border, RoundedCornerShape(9.dp))
            )
        }
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            options.forEach { option ->
                val isSelected = option.value == selected
                val textColor by animateColorAsState(if (isSelected) c.text else c.textSecondary, KooyuMotion.snap(), label = "segmentText")
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(9.dp))
                        .selectable(
                            selected = isSelected,
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            role = Role.Tab
                        ) {
                            if (!isSelected) {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSelect(option.value)
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier.padding(horizontal = 6.dp)
                    ) {
                        Text(
                            option.label,
                            color = textColor,
                            fontSize = 13.sp,
                            lineHeight = 18.sp,
                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (option.badgeCount != null && option.badgeCount > 0) {
                            Surface(shape = CircleShape, color = if (isSelected) c.accentTint else c.borderSubtle) {
                                Text(
                                    option.badgeCount.toString(),
                                    color = if (isSelected) c.text else c.textTertiary,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

package app.kooyu.android.ui.theme

import androidx.compose.animation.core.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.delay

/**
 * Motion System 2.0 ("Fluid, Inevitable, Unnoticed") — 1:1 aligned with Web CSS linear() & iOS SwiftUI.
 * - Snap  ζ 1.00 / k 780: press feedback, switches, chevrons, micro-controls (zero bounce).
 * - Glide ζ 0.90 / k 540: floating dock capsule pill, segmented thumb, swipe snap.
 * - Base  ζ 0.94 / k 460: card disclosure, reasoning collapse, list reflow.
 * - Panel ζ 0.96 / k 360: screen push/pop, sheets, inspector.
 * - Morph ζ 0.80 / k 620: composer send ↔ stop button morph (crisp ~1.5% settle).
 * - Exit  160ms FastIn: clean dismissal without lingering spring tails.
 * - Pulse 1400 ms sine loop: running dots and streaming cursors.
 */
object KooyuMotion {
    fun <T> snap(): SpringSpec<T> = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 780f)
    fun <T> glide(): SpringSpec<T> = spring(dampingRatio = 0.90f, stiffness = 540f)
    fun <T> tabIndicator(): SpringSpec<T> = glide()
    fun <T> base(): SpringSpec<T> = spring(dampingRatio = 0.94f, stiffness = 460f)
    fun <T> panel(): SpringSpec<T> = spring(dampingRatio = 0.96f, stiffness = 360f)
    fun <T> morph(): SpringSpec<T> = spring(dampingRatio = 0.80f, stiffness = 620f)
    fun <T> exit(): TweenSpec<T> = tween(160, easing = CubicBezierEasing(0.32f, 0f, 0.67f, 0f))

    const val PULSE_MILLIS = 1400
    fun <T> pulse(): InfiniteRepeatableSpec<T> =
        infiniteRepeatable(tween(PULSE_MILLIS, easing = FastOutSlowInEasing), RepeatMode.Reverse)

    val SnapFloat: SpringSpec<Float> = snap()
    val GlideFloat: SpringSpec<Float> = glide()
    val TabIndicatorFloat: SpringSpec<Float> = glide()
    val BaseFloat: SpringSpec<Float> = base()
    val PanelFloat: SpringSpec<Float> = panel()
    val MorphFloat: SpringSpec<Float> = morph()
    val SnapDp: SpringSpec<Dp> = snap()
    val BaseDp: SpringSpec<Dp> = base()
    val PanelIntOffset: SpringSpec<IntOffset> = panel()
    val BaseIntOffset: SpringSpec<IntOffset> = base()
    val SnapIntSize: SpringSpec<IntSize> = snap()
    val BaseIntSize: SpringSpec<IntSize> = base()
}

/** Plan §5.2 names for the three springs. */
val SpringSnap get() = KooyuMotion.SnapFloat
val SpringBase get() = KooyuMotion.BaseFloat
val SpringPanel get() = KooyuMotion.PanelFloat

/**
 * Tactile press: Snap spring to [pressedScale] while pressed, haptic tick on click (§3.2.1).
 */
fun Modifier.kooyuPressable(
    enabled: Boolean = true,
    pressedScale: Float = 0.96f,
    haptic: Boolean = true,
    onClickLabel: String? = null,
    onClick: () -> Unit
): Modifier = composed {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val hapticFeedback = LocalHapticFeedback.current
    val scale by animateFloatAsState(
        targetValue = if (isPressed && enabled) pressedScale else 1f,
        animationSpec = KooyuMotion.SnapFloat,
        label = "kooyuPressScale"
    )
    this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .clickable(
            interactionSource = interactionSource,
            indication = null,
            enabled = enabled,
            onClickLabel = onClickLabel,
            onClick = {
                if (haptic) hapticFeedback.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }
        )
}

/** Visual-only press scale for children that already own a clickable/Surface handler. */
@Composable
fun rememberPressScale(
    interactionSource: MutableInteractionSource,
    pressedScale: Float = 0.96f
): State<Float> {
    val isPressed by interactionSource.collectIsPressedAsState()
    return animateFloatAsState(
        targetValue = if (isPressed) pressedScale else 1f,
        animationSpec = KooyuMotion.SnapFloat,
        label = "rememberPressScale"
    )
}

/** Smooth staggered entrance glide for list cards without hiding initial frame content. */
fun Modifier.staggeredCascade(index: Int, visible: Boolean = true): Modifier = composed {
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(visible, index) {
        if (visible) {
            delay(index.coerceIn(0, 8) * 26L)
            settled = true
        } else {
            settled = false
        }
    }
    val offsetY by animateFloatAsState(if (settled) 0f else 14f, KooyuMotion.BaseFloat, label = "cascadeY")
    val alpha by animateFloatAsState(if (settled) 1f else 0.72f, KooyuMotion.BaseFloat, label = "cascadeAlpha")
    this.graphicsLayer {
        translationY = offsetY
        this.alpha = alpha
    }
}

/** Continuous warm shimmer sweep for streaming thinking cards and pending states. */
@Composable
fun rememberShimmerBrush(): Brush {
    val c = Kooyu.colors
    val transition = rememberInfiniteTransition(label = "kooyuShimmer")
    val shift by transition.animateFloat(
        initialValue = 0f,
        targetValue = 900f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmerShift"
    )
    val base = if (c.dark) c.sunken else c.navigator
    val highlight = if (c.dark) Color(0xFF282D37) else Color(0xFFFFFFFF)
    return Brush.linearGradient(
        colors = listOf(base, highlight, base),
        start = androidx.compose.ui.geometry.Offset(shift - 320f, 0f),
        end = androidx.compose.ui.geometry.Offset(shift, 120f)
    )
}

package app.kooyu.android.ui.components

import app.kooyu.android.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.R

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Plan §2.3: every status is a dot plus a word. */
enum class StatusTone { RUNNING, NEEDS_INPUT, READY, DONE, ERROR }

data class SessionStatus(val label: String, val tone: StatusTone)

fun sessionStatus(s: HostSession): SessionStatus = when {
    s.runState == "waiting-input" -> SessionStatus("需确认", StatusTone.NEEDS_INPUT)
    s.runState == "running" -> SessionStatus("运行中", StatusTone.RUNNING)
    s.connectionState == "reconnecting" -> SessionStatus("重连中", StatusTone.RUNNING)
    s.connectionState == "offline" && s.phase != "draft" -> SessionStatus("未连接", StatusTone.ERROR)
    s.runState == "idle" && (s.phase == "draft" || s.kind == "supervisor") -> SessionStatus("就绪", StatusTone.READY)
    s.runState == "idle" -> SessionStatus("已完成", StatusTone.DONE)
    else -> SessionStatus("异常", StatusTone.ERROR)
}

@Composable fun statusColor(tone: StatusTone): Color {
    val c = Kooyu.colors
    return when (tone) {
        StatusTone.RUNNING -> c.info
        StatusTone.NEEDS_INPUT -> c.brandCoral
        StatusTone.READY -> c.success
        StatusTone.DONE -> c.textTertiary
        StatusTone.ERROR -> c.destructive
    }
}

/** 6dp dot + word; the dot breathes on the 1400 ms pulse while running. */
@Composable fun StatusBadge(status: SessionStatus, modifier: Modifier = Modifier, emphasize: Boolean = true) {
    val color = statusColor(status.tone)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        PulsingDot(color, pulsing = status.tone == StatusTone.RUNNING)
        Text(
            status.label,
            style = KooyuType.caption,
            fontWeight = FontWeight.SemiBold,
            color = if (emphasize && status.tone != StatusTone.DONE) color else Kooyu.colors.textSecondary,
            maxLines = 1
        )
    }
}

/** Breathing pulse dot (plan §3.1 Pulse: 1400 ms sine loop). */
@Composable fun PulsingDot(color: Color, pulsing: Boolean, size: Dp = 6.dp) {
    if (pulsing) {
        val transition = rememberInfiniteTransition(label = "kooyuPulse")
        val alpha by transition.animateFloat(1f, 0.35f, KooyuMotion.pulse(), label = "pulseAlpha")
        val scale by transition.animateFloat(1f, 1.3f, KooyuMotion.pulse(), label = "pulseScale")
        Box(
            Modifier.size(size).graphicsLayer { scaleX = scale; scaleY = scale; this.alpha = alpha }
                .clip(CircleShape).background(color)
        )
    } else {
        Box(Modifier.size(size).clip(CircleShape).background(color))
    }
}

@Composable fun HarnessBadge(harnessId: String, name: String? = null) {
    val c = Kooyu.colors
    val v = harnessVisual(harnessId)
    Row(
        Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(c.sunken)
            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(7.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        EngineBadge(harnessId, 14.dp, circle = false)
        Text(name ?: v.name, color = c.text, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Unified Desktop-parity squircle engine badge: monochrome neutral plate + crisp vector glyph (only Kooyu uses signature coral). */
@Composable fun EngineBadge(harnessId: String?, size: Dp = 20.dp, circle: Boolean = false) {
    val c = Kooyu.colors
    val isKooyu = harnessId == null || harnessId == "kodo" || harnessId == "kooyu"
    val v = harnessVisual(harnessId)
    val drawableRes = when (harnessId) {
        null, "kodo", "kooyu" -> R.drawable.kooyu_mark_coral
        "codex" -> R.drawable.harness_codex
        "pi" -> R.drawable.harness_pi
        "claude-code" -> R.drawable.harness_claude_code
        "deepseek-harness" -> R.drawable.harness_deepseek
        "zcode" -> R.drawable.harness_zcode
        "opencode" -> R.drawable.harness_opencode
        "gemini" -> R.drawable.harness_gemini
        "cursor" -> R.drawable.harness_cursor
        "kimi-code" -> R.drawable.harness_kimi_code
        "grok-build" -> R.drawable.harness_grok_build
        else -> null
    }
    val shape = if (circle) CircleShape else RoundedCornerShape(size * 0.28f)
    Box(
        Modifier
            .size(size)
            .clip(shape)
            .background(c.sunken)
            .border(0.5.dp, c.borderSubtle, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (drawableRes != null) {
            Image(
                painter = painterResource(drawableRes),
                contentDescription = v.name,
                contentScale = ContentScale.Fit,
                colorFilter = ColorFilter.tint(if (isKooyu) c.brandCoral else c.text),
                modifier = Modifier.size(size * if (isKooyu) 0.64f else 0.56f)
            )
        } else {
            Text(
                v.monogram,
                color = c.text,
                fontFamily = if (v.monogram.contains("<") || v.monogram.length > 1) FontFamily.Monospace else FontFamily.Default,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * if (v.monogram.length > 2) 0.32f else if (v.monogram.length > 1) 0.36f else 0.48f).sp,
                maxLines = 1
            )
        }
    }
}

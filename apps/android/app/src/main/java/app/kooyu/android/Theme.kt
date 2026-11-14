package app.kooyu.android

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Desktop design tokens (apps/web/src/styles/app.css `:root` / `.dark`), so the phone reads as the
 * same product: monochrome accent, paper/navigator/sunken surfaces, hairline borders.
 */
@Immutable
data class KooyuColors(
    val dark: Boolean,
    val paper: Color, val navigator: Color, val raised: Color, val sunken: Color, val bubble: Color,
    val text: Color, val textSecondary: Color, val textTertiary: Color,
    val borderSubtle: Color, val border: Color, val borderStrong: Color,
    val accent: Color, val onAccent: Color, val accentTint: Color,
    val success: Color, val successTint: Color, val doneText: Color,
    val info: Color, val infoTint: Color,
    val destructive: Color, val destructiveTint: Color,
    val capsule: Color,
)

val LightKooyu = KooyuColors(
    dark = false,
    paper = Color(0xFFFFFFFF), navigator = Color(0xFFF7F7F9), raised = Color(0xFFFFFFFF), sunken = Color(0xFFF1F2F4), bubble = Color(0xFFF2F3F6),
    text = Color(0xFF111317), textSecondary = Color(0xFF525866), textTertiary = Color(0xFF848B98),
    borderSubtle = Color(0x12111317), border = Color(0x1C111317), borderStrong = Color(0x2E111317),
    accent = Color(0xFF18191D), onAccent = Color.White, accentTint = Color(0x0E111317),
    success = Color(0xFF15803D), successTint = Color(0x1A16A34A), doneText = Color(0xFF218056),
    info = Color(0xFFB45309), infoTint = Color(0x1AD97706),
    destructive = Color(0xFFB91C1C), destructiveTint = Color(0x17DC2626),
    capsule = Color(0xFFF8F8FA),
)

val DarkKooyu = KooyuColors(
    dark = true,
    paper = Color(0xFF18191D), navigator = Color(0xFF121316), raised = Color(0xFF1E2026), sunken = Color(0xFF23252C), bubble = Color(0xFF262932),
    text = Color(0xFFF4F4F6), textSecondary = Color(0xFFB0B5C0), textTertiary = Color(0xFF79808E),
    borderSubtle = Color(0x13FFFFFF), border = Color(0x1FFFFFFF), borderStrong = Color(0x30FFFFFF),
    accent = Color(0xFFF4F4F6), onAccent = Color(0xFF141518), accentTint = Color(0x14FFFFFF),
    success = Color(0xFF4ADE80), successTint = Color(0x1F4ADE80), doneText = Color(0xFF5FD39E),
    info = Color(0xFFFBBF24), infoTint = Color(0x1FF59E0B),
    destructive = Color(0xFFF87171), destructiveTint = Color(0x24EF4444),
    capsule = Color(0xFF1D1F24),
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF18191D), onPrimary = Color.White,
    primaryContainer = Color(0xFFEBECEF), onPrimaryContainer = Color(0xFF111317),
    secondary = Color(0xFF525866), onSecondary = Color.White,
    secondaryContainer = Color(0xFFF1F2F4), onSecondaryContainer = Color(0xFF111317),
    tertiary = Color(0xFF16A34A), onTertiary = Color.White,
    background = Color.White, onBackground = Color(0xFF111317),
    surface = Color.White, onSurface = Color(0xFF111317),
    surfaceVariant = Color(0xFFF1F2F4), onSurfaceVariant = Color(0xFF525866),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFFAFAFB),
    surfaceContainer = Color(0xFFF7F7F9), surfaceContainerHigh = Color(0xFFF1F2F4), surfaceContainerHighest = Color(0xFFE9EAED),
    outline = Color(0xFFA1A7B3), outlineVariant = Color(0xFFE4E5E8),
    error = Color(0xFFDC2626), onError = Color.White,
    errorContainer = Color(0xFFFCEBEB), onErrorContainer = Color(0xFFB91C1C),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFF4F4F6), onPrimary = Color(0xFF141518),
    primaryContainer = Color(0xFF2C2E35), onPrimaryContainer = Color(0xFFF4F4F6),
    secondary = Color(0xFFB0B5C0), onSecondary = Color(0xFF141518),
    secondaryContainer = Color(0xFF262932), onSecondaryContainer = Color(0xFFF4F4F6),
    tertiary = Color(0xFF4ADE80), onTertiary = Color(0xFF052E16),
    background = Color(0xFF18191D), onBackground = Color(0xFFF4F4F6),
    surface = Color(0xFF18191D), onSurface = Color(0xFFF4F4F6),
    surfaceVariant = Color(0xFF23252C), onSurfaceVariant = Color(0xFFB0B5C0),
    surfaceContainerLowest = Color(0xFF121316), surfaceContainerLow = Color(0xFF1B1C20),
    surfaceContainer = Color(0xFF1E2026), surfaceContainerHigh = Color(0xFF23252C), surfaceContainerHighest = Color(0xFF2A2C33),
    outline = Color(0xFF6A707C), outlineVariant = Color(0xFF33353B),
    error = Color(0xFFF87171), onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF3A1D1F), onErrorContainer = Color(0xFFFECACA),
)

val LocalKooyu = staticCompositionLocalOf { LightKooyu }

object Kooyu { val colors: KooyuColors @Composable get() = LocalKooyu.current }

@Composable fun KooyuTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    CompositionLocalProvider(LocalKooyu provides if (dark) DarkKooyu else LightKooyu) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, content = content)
    }
}

/** Desktop HARNESS_VISUALS (apps/web/src/lib/harnesses.ts): one tinted plate + ink per engine. */
data class HarnessVisual(val name: String, val monogram: String, val tint: Color, val ink: Color, val darkTint: Color, val darkInk: Color)

val HARNESS_VISUALS = mapOf(
    "kodo" to HarnessVisual("Kooyu", "K", Color(0x24F17561), Color(0xFFC2422F), Color(0x38F17561), Color(0xFFFF9B8A)),
    "pi" to HarnessVisual("pi", "π", Color(0x21745ED4), Color(0xFF5640B8), Color(0x389382F0), Color(0xFFC4B9FF)),
    "codex" to HarnessVisual("Codex", "</>", Color(0x2126805C), Color(0xFF166B48), Color(0x333EBA86), Color(0xFF7AE0B3)),
    "claude-code" to HarnessVisual("Claude Code", "✦", Color(0x24D97745), Color(0xFFB35221), Color(0x38EB8C58), Color(0xFFFFB28A)),
    "deepseek-harness" to HarnessVisual("DeepSeek Harness", "DS", Color(0x213470E0), Color(0xFF2257B8), Color(0x385C94FA), Color(0xFF9CC2FF)),
    "zcode" to HarnessVisual("ZCode", "Z", Color(0x21B85CA8), Color(0xFF8F3C81), Color(0x38D87AC8), Color(0xFFF0A8E3)),
    "opencode" to HarnessVisual("OpenCode", "OC", Color(0x21486C82), Color(0xFF32566D), Color(0x3876A4C0), Color(0xFFA8D0E8)),
    "gemini" to HarnessVisual("Gemini CLI", "◆", Color(0x21388AD4), Color(0xFF1E66A8), Color(0x3862AEF5), Color(0xFF9AD0FF)),
    "cursor" to HarnessVisual("Cursor", "▸", Color(0x215C5C66), Color(0xFF3E3E48), Color(0x38A8A8B8), Color(0xFFD6D6E2)),
    "kimi-code" to HarnessVisual("Kimi Code", "K·", Color(0x212C8EA8), Color(0xFF1A6B82), Color(0x3852B8D4), Color(0xFF94DCF0)),
    "grok-build" to HarnessVisual("Grok Build", "Ø", Color(0x24806848), Color(0xFF664E2E), Color(0x38B8986C), Color(0xFFE0C498)),
)

fun harnessVisual(id: String?): HarnessVisual = HARNESS_VISUALS[id ?: "kodo"]
    ?: HarnessVisual(id ?: "引擎", (id ?: "?").take(2).uppercase(), Color(0x215C5C66), Color(0xFF3E3E48), Color(0x38A8A8B8), Color(0xFFD6D6E2))

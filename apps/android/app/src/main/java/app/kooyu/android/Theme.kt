package app.kooyu.android

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Kooyu design system tokens calibrated directly to Desktop workbench (apps/web/src/styles/app.css).
 * High-contrast monochrome actions (Obsidian & Alabaster Craft Tokens) with Sunset Coral brand identity.
 */
@Immutable
data class KooyuColors(
    val dark: Boolean,
    val paper: Color,
    val navigator: Color,
    val raised: Color,
    val sunken: Color,
    val bubble: Color,
    val text: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val borderSubtle: Color,
    val border: Color,
    val borderStrong: Color,
    val accent: Color,
    val onAccent: Color,
    val accentTint: Color,
    val brandCoral: Color,
    val brandCoralTint: Color,
    val success: Color,
    val successTint: Color,
    val doneText: Color,
    val info: Color,
    val infoTint: Color,
    val destructive: Color,
    val destructiveTint: Color,
    val capsule: Color,
    val glassSurface: Color,
    val glassBorder: Color,
    val glowBrush: Brush,
)

val DarkKooyu = KooyuColors(
    dark = true,
    paper = Color(0xFF0C0E14),       // Desktop .dark --surface-paper: #0c0e14
    navigator = Color(0xFF08090D),   // Desktop .dark --surface-navigator: #08090d
    raised = Color(0xFF12151F),      // Desktop .dark --surface-raised: #12151f
    sunken = Color(0xFF06070A),      // Desktop .dark --surface-sunken: #06070a
    bubble = Color(0xFF1A1D26),      // Desktop .dark --fill-bubble: #1a1d26
    text = Color(0xFFF4F4F6),        // Desktop .dark --text: #f4f4f6
    textSecondary = Color(0xFFB0B5C0),// Desktop .dark --text-secondary: #b0b5c0
    textTertiary = Color(0xFF79808E), // Desktop .dark --text-tertiary: #79808e
    borderSubtle = Color(0x0FFFFFFF), // rgba(255, 255, 255, 0.06)
    border = Color(0x1CFFFFFF),       // rgba(255, 255, 255, 0.11)
    borderStrong = Color(0x38FFFFFF), // rgba(255, 255, 255, 0.22)
    accent = Color(0xFFF4F4F6),       // Desktop .dark --accent-solid: #f4f4f6 (monochrome)
    onAccent = Color(0xFF141518),     // Desktop .dark --on-accent: #141518
    accentTint = Color(0x14FFFFFF),   // rgba(255, 255, 255, 0.08)
    brandCoral = Color(0xFFF17561),   // Kooyu Sunset Coral identity
    brandCoralTint = Color(0x38F17561),
    success = Color(0xFF4ADE80),
    successTint = Color(0x244ADE80),
    doneText = Color(0xFF5FD39E),
    info = Color(0xFFFBBF24),
    infoTint = Color(0x24F59E0B),
    destructive = Color(0xFFF87171),
    destructiveTint = Color(0x26F87171),
    capsule = Color(0xFF161922),
    glassSurface = Color(0xE60C0E14),
    glassBorder = Color(0x1FFFFFFF),
    glowBrush = Brush.radialGradient(
        listOf(Color(0x1AFFFFFF), Color.Transparent)
    ),
)

val LightKooyu = KooyuColors(
    dark = false,
    paper = Color(0xFFFFFFFF),       // Desktop :root --surface-paper: #ffffff
    navigator = Color(0xFFF7F7F9),   // Desktop :root --surface-navigator: #f7f7f9
    raised = Color(0xFFFFFFFF),      // Desktop :root --surface-raised: #ffffff
    sunken = Color(0xFFF1F2F4),      // Desktop :root --surface-sunken: #f1f2f4
    bubble = Color(0xFFF2F3F6),      // Desktop :root --fill-bubble: #f2f3f6
    text = Color(0xFF111317),        // Desktop :root --text: #111317
    textSecondary = Color(0xFF525866),// Desktop :root --text-secondary: #525866
    textTertiary = Color(0xFF848B98), // Desktop :root --text-tertiary: #848b98
    borderSubtle = Color(0x12111317), // rgba(17, 19, 23, 0.07)
    border = Color(0x1C111317),       // rgba(17, 19, 23, 0.11)
    borderStrong = Color(0x2E111317), // rgba(17, 19, 23, 0.18)
    accent = Color(0xFF18191D),       // Desktop :root --accent-solid: #18191d (monochrome)
    onAccent = Color.White,
    accentTint = Color(0x1218191D),
    brandCoral = Color(0xFFF17561),
    brandCoralTint = Color(0x1AF17561),
    success = Color(0xFF15803D),
    successTint = Color(0x1A16A34A),
    doneText = Color(0xFF218056),
    info = Color(0xFFB45309),
    infoTint = Color(0x1AD97706),
    destructive = Color(0xFFB91C1C),
    destructiveTint = Color(0x18DC2626),
    capsule = Color(0xFFF8F8FA),
    glassSurface = Color(0xF2FFFFFF),
    glassBorder = Color(0x1F111317),
    glowBrush = Brush.radialGradient(
        listOf(Color(0x1418191D), Color.Transparent)
    ),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFF4F4F6),      // Titanium White monochrome action
    onPrimary = Color(0xFF141518),
    primaryContainer = Color(0xFF1E212B),
    onPrimaryContainer = Color(0xFFF4F4F6),
    secondary = Color(0xFFB0B5C0),
    onSecondary = Color(0xFF0C0E14),
    secondaryContainer = Color(0xFF1A1D26),
    onSecondaryContainer = Color(0xFFF4F4F6),
    tertiary = Color(0xFF4ADE80),
    onTertiary = Color(0xFF022C22),
    background = Color(0xFF0C0E14),
    onBackground = Color(0xFFF4F4F6),
    surface = Color(0xFF0C0E14),
    onSurface = Color(0xFFF4F4F6),
    surfaceVariant = Color(0xFF12151F),
    onSurfaceVariant = Color(0xFFB0B5C0),
    surfaceContainerLowest = Color(0xFF06070A),
    surfaceContainerLow = Color(0xFF08090D),
    surfaceContainer = Color(0xFF0C0E14),
    surfaceContainerHigh = Color(0xFF12151F),
    surfaceContainerHighest = Color(0xFF1A1D26),
    outline = Color(0xFF6A707C),
    outlineVariant = Color(0x1FFFFFFF),
    error = Color(0xFFF87171),
    onError = Color(0xFF4C0519),
    errorContainer = Color(0xFF3B1219),
    onErrorContainer = Color(0xFFFECDD3),
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF18191D),      // Dark obsidian monochrome action
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF1F2F4),
    onPrimaryContainer = Color(0xFF111317),
    secondary = Color(0xFF525866),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF7F7F9),
    onSecondaryContainer = Color(0xFF111317),
    tertiary = Color(0xFF15803D),
    onTertiary = Color.White,
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF111317),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF111317),
    surfaceVariant = Color(0xFFF7F7F9),
    onSurfaceVariant = Color(0xFF525866),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFAF8F4),
    surfaceContainer = Color(0xFFF7F7F9),
    surfaceContainerHigh = Color(0xFFF1F2F4),
    surfaceContainerHighest = Color(0xFFE2E4E8),
    outline = Color(0xFF9B959E),
    outlineVariant = Color(0x1C111317),
    error = Color(0xFFB91C1C),
    onError = Color.White,
    errorContainer = Color(0xFFFFE4E6),
    onErrorContainer = Color(0xFF9F1239),
)

val LocalKooyu = staticCompositionLocalOf { DarkKooyu }

object ThemeManager {
    var themePreference by mutableStateOf("dark")

    fun init(context: Context) {
        val pref = context.getSharedPreferences("kooyu_settings", Context.MODE_PRIVATE)
            .getString("theme_mode", "dark") ?: "dark"
        themePreference = pref
    }

    fun update(context: Context, mode: String) {
        themePreference = mode
        context.getSharedPreferences("kooyu_settings", Context.MODE_PRIVATE)
            .edit()
            .putString("theme_mode", mode)
            .apply()
    }
}

object Kooyu {
    val colors: KooyuColors @Composable get() = LocalKooyu.current
}

val KooyuTypography = Typography(
    headlineSmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        letterSpacing = (-0.4).sp
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        letterSpacing = (-0.4).sp
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        letterSpacing = (-0.2).sp
    ),
    titleSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        letterSpacing = (-0.2).sp
    ),
    bodyLarge = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        letterSpacing = (-0.2).sp
    ),
    bodyMedium = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 13.5.sp,
        lineHeight = 19.sp,
        letterSpacing = (-0.15).sp
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = (-0.1).sp
    ),
    labelSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = (-0.1).sp
    )
)

@Composable
fun KooyuTheme(content: @Composable () -> Unit) {
    val systemDark = isSystemInDarkTheme()
    val dark = when (ThemeManager.themePreference) {
        "dark" -> true
        "light" -> false
        else -> systemDark
    }
    CompositionLocalProvider(LocalKooyu provides if (dark) DarkKooyu else LightKooyu) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = KooyuTypography,
            shapes = Shapes(
                extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(4.dp),
                small = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                medium = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                large = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
                extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
            ),
            content = content
        )
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

fun harnessVisual(id: String?): HarnessVisual = HARNESS_VISUALS[if (id == "kooyu") "kodo" else (id ?: "kodo")]
    ?: HarnessVisual(id ?: "引擎", (id ?: "?").take(2).uppercase(), Color(0x215C5C66), Color(0xFF3E3E48), Color(0x38A8A8B8), Color(0xFFD6D6E2))

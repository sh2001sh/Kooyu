package app.kooyu.android.ui.theme

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import android.app.Activity
import android.content.Context
import android.graphics.RenderEffect as AndroidRenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Kooyu Unified Design System Tokens (Warm Daylight & Obsidian Carbon).
 * Calibrated 1:1 with Desktop workbench (`apps/web/src/styles/tokens.css`).
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
    paper = Color(0xFF121316),        // Neutral Obsidian Paper
    navigator = Color(0xFF0B0C0E),    // Neutral Deep Carbon Canvas
    raised = Color(0xFF181A1F),       // Elevated Card Surface
    sunken = Color(0xFF0F1115),       // Sunken Input / Pill Surface
    bubble = Color(0xFF20232B),       // Neutral Slate User Bubble (no orange tint)
    text = Color(0xFFF3F4F6),         // Crisp White Ink
    textSecondary = Color(0xFFA6AAB3),
    textTertiary = Color(0xFF737882),
    borderSubtle = Color(0x11F3F4F6),
    border = Color(0x1BF3F4F6),
    borderStrong = Color(0x30F3F4F6),
    accent = Color(0xFFF3F4F6),       // Monochrome Primary Control Ink
    onAccent = Color(0xFF121316),
    accentTint = Color(0x14F3F4F6),
    brandCoral = Color(0xFFF17561),   // Reserved for micro-accents only
    brandCoralTint = Color(0x24F17561),
    success = Color(0xFF34D399),
    successTint = Color(0x2434D399),
    doneText = Color(0xFF4ADE80),
    info = Color(0xFFF59E0B),
    infoTint = Color(0x24F59E0B),
    destructive = Color(0xFFF87171),
    destructiveTint = Color(0x26F87171),
    capsule = Color(0xFF15171C),
    glassSurface = Color(0xD916181D),
    glassBorder = Color(0x20F3F4F6),
    glowBrush = Brush.radialGradient(
        listOf(Color(0x14F3F4F6), Color.Transparent)
    ),
)

val LightKooyu = KooyuColors(
    dark = false,
    paper = Color(0xFFFFFFFF),        // Crisp Pure White Paper
    navigator = Color(0xFFF5F5F7),    // Apple Neutral Grouped Grey Canvas
    raised = Color(0xFFFFFFFF),       // Pure White Elevated Card
    sunken = Color(0xFFEFF0F3),       // Neutral Sunken Control
    bubble = Color(0xFFF2F3F6),       // Clean Neutral Grey User Bubble (no peach tint)
    text = Color(0xFF141518),         // Crisp Deep Black Ink
    textSecondary = Color(0xFF52555C),
    textTertiary = Color(0xFF80848E),
    borderSubtle = Color(0x11141518),
    border = Color(0x1A141518),
    borderStrong = Color(0x2E141518),
    accent = Color(0xFF141518),       // Monochrome Primary Control Ink
    onAccent = Color.White,
    accentTint = Color(0x10141518),
    brandCoral = Color(0xFFE6533C),   // Reserved for micro-accents only
    brandCoralTint = Color(0x1AE6533C),
    success = Color(0xFF16A34A),
    successTint = Color(0x1C16A34A),
    doneText = Color(0xFF15803D),
    info = Color(0xFFD97706),
    infoTint = Color(0x1CD97706),
    destructive = Color(0xFFDC2626),
    destructiveTint = Color(0x1ADC2626),
    capsule = Color(0xFFF4F5F7),
    glassSurface = Color(0xDEFFFFFF),
    glassBorder = Color(0x18141518),
    glowBrush = Brush.radialGradient(
        listOf(Color(0x0D141518), Color.Transparent)
    ),
)

// Apple Monochrome Material 3 schemes (zero stale warm peach/taupe leakage into Switch / Dropdown / Dialogs).
private val DarkScheme = darkColorScheme(
    primary = Color(0xFFF3F4F6),
    onPrimary = Color(0xFF121316),
    primaryContainer = Color(0xFF20232B),
    onPrimaryContainer = Color(0xFFF3F4F6),
    secondary = Color(0xFFA6AAB3),
    onSecondary = Color(0xFF121316),
    secondaryContainer = Color(0xFF181A1F),
    onSecondaryContainer = Color(0xFFF3F4F6),
    tertiary = Color(0xFF34D399),
    onTertiary = Color(0xFF022C22),
    background = Color(0xFF0B0C0E),
    onBackground = Color(0xFFF3F4F6),
    surface = Color(0xFF121316),
    onSurface = Color(0xFFF3F4F6),
    surfaceVariant = Color(0xFF181A1F),
    onSurfaceVariant = Color(0xFFA6AAB3),
    surfaceContainerLowest = Color(0xFF0B0C0E),
    surfaceContainerLow = Color(0xFF0F1115),
    surfaceContainer = Color(0xFF121316),
    surfaceContainerHigh = Color(0xFF181A1F),
    surfaceContainerHighest = Color(0xFF20232B),
    outline = Color(0xFF646873),
    outlineVariant = Color(0x1BF3F4F6),
    error = Color(0xFFF87171),
    onError = Color(0xFF4C0519),
    errorContainer = Color(0xFF3B1219),
    onErrorContainer = Color(0xFFFECDD3),
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF141518),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEFF0F3),
    onPrimaryContainer = Color(0xFF141518),
    secondary = Color(0xFF52555C),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF2F3F6),
    onSecondaryContainer = Color(0xFF141518),
    tertiary = Color(0xFF16A34A),
    onTertiary = Color.White,
    background = Color(0xFFF5F5F7),
    onBackground = Color(0xFF141518),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF141518),
    surfaceVariant = Color(0xFFEFF0F3),
    onSurfaceVariant = Color(0xFF52555C),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF8F9FA),
    surfaceContainer = Color(0xFFF5F5F7),
    surfaceContainerHigh = Color(0xFFEFF0F3),
    surfaceContainerHighest = Color(0xFFE5E7EC),
    outline = Color(0xFF9498A2),
    outlineVariant = Color(0x1A141518),
    error = Color(0xFFDC2626),
    onError = Color.White,
    errorContainer = Color(0xFFFFE4E6),
    onErrorContainer = Color(0xFF9F1239),
)

val LocalKooyu = compositionLocalOf { DarkKooyu }

data class AndroidThemePreset(
    val id: String,
    val label: String,
    val lightBg: String,
    val lightFg: String,
    val darkBg: String,
    val darkFg: String,
    val accentId: String,
)

val ANDROID_THEME_PRESETS = listOf(
    AndroidThemePreset("kooyu", "极简墨白", "#FFFFFF", "#141518", "#121316", "#F3F4F6", "default"),
    AndroidThemePreset("chatgpt", "澄澈素白", "#FFFFFF", "#1A1C1F", "#212121", "#ECECEC", "default"),
    AndroidThemePreset("graphite", "深空石墨", "#FAFAFC", "#1C1C1E", "#1C1C1E", "#F5F5F7", "blue"),
    AndroidThemePreset("claude", "温润米宣", "#FAF9F5", "#1F1E1D", "#1F1E1B", "#EFECE6", "coral"),
    AndroidThemePreset("nord", "极夜冰川", "#F4F6FA", "#2E3440", "#242933", "#ECEFF4", "indigo"),
)

val ANDROID_ACCENT_OPTIONS = listOf(
    Triple("default", "默认", Color(0xFF141518) to Color(0xFFF3F4F6)),
    Triple("coral", "珊瑚红", Color(0xFFE6533C) to Color(0xFFF17561)),
    Triple("blue", "苹果蓝", Color(0xFF007AFF) to Color(0xFF3B9EFF)),
    Triple("indigo", "靛青紫", Color(0xFF5856D6) to Color(0xFF7D7AFF)),
    Triple("emerald", "翡翠绿", Color(0xFF10A37F) to Color(0xFF34D399)),
    Triple("amber", "琥珀金", Color(0xFFD97706) to Color(0xFFF59E0B)),
)

fun normalizeHexAndroid(raw: String, fallback: String): String {
    val clean = raw.trim().removePrefix("#")
    return when {
        clean.matches(Regex("^[0-9a-fA-F]{6}$")) -> "#${clean.uppercase()}"
        clean.matches(Regex("^[0-9a-fA-F]{3}$")) -> "#${clean.map { "$it$it" }.joinToString("").uppercase()}"
        else -> fallback.uppercase()
    }
}

fun parseHexColor(hex: String, fallback: Color): Color {
    val clean = normalizeHexAndroid(hex, "").removePrefix("#")
    if (clean.length != 6) return fallback
    return runCatching {
        val rgb = clean.toLong(16)
        Color(0xFF000000 or rgb)
    }.getOrDefault(fallback)
}

private fun blendColor(a: Color, b: Color, weightA: Float): Color {
    val w = weightA.coerceIn(0f, 1f)
    return Color(
        red = a.red * w + b.red * (1f - w),
        green = a.green * w + b.green * (1f - w),
        blue = a.blue * w + b.blue * (1f - w),
        alpha = 1f,
    )
}

private fun colorLuminance(c: Color): Float = 0.2126f * c.red + 0.7152f * c.green + 0.0722f * c.blue

object ThemeManager {
    /** "system" | "light" | "dark"; defaults to following the system setting. */
    var themePreference by mutableStateOf("system")
    var preset by mutableStateOf("kooyu")
    var accentId by mutableStateOf("default")
    var lightBgHex by mutableStateOf("#FFFFFF")
    var lightFgHex by mutableStateOf("#141518")
    var darkBgHex by mutableStateOf("#121316")
    var darkFgHex by mutableStateOf("#F3F4F6")
    var glassOpacity by mutableFloatStateOf(0.86f)
    var surfaceOpacity by mutableFloatStateOf(1.0f)
    var glassBlurDp by mutableFloatStateOf(20f)
    /** "clear" | "frosted" | "solid" — visible glass chrome material style. */
    var glassStyle by mutableStateOf("frosted")
    var fontStyle by mutableStateOf("system")
    var highContrast by mutableStateOf(false)

    val THEME_MODES = listOf("system", "light", "dark")
    val GLASS_STYLES = listOf("clear", "frosted", "solid")

    fun init(context: Context) {
        val sp = context.getSharedPreferences("kooyu_settings", Context.MODE_PRIVATE)
        val pref = sp.getString("theme_mode", "system") ?: "system"
        themePreference = if (pref in THEME_MODES) pref else "system"
        preset = sp.getString("ap_preset", "kooyu") ?: "kooyu"
        accentId = sp.getString("ap_accent", "default") ?: "default"
        lightBgHex = normalizeHexAndroid(sp.getString("ap_light_bg", "#FFFFFF") ?: "#FFFFFF", "#FFFFFF")
        lightFgHex = normalizeHexAndroid(sp.getString("ap_light_fg", "#141518") ?: "#141518", "#141518")
        darkBgHex = normalizeHexAndroid(sp.getString("ap_dark_bg", "#121316") ?: "#121316", "#121316")
        darkFgHex = normalizeHexAndroid(sp.getString("ap_dark_fg", "#F3F4F6") ?: "#F3F4F6", "#F3F4F6")
        glassOpacity = sp.getFloat("ap_glass_opacity", 0.86f).coerceIn(0.45f, 0.98f)
        surfaceOpacity = sp.getFloat("ap_surface_opacity", 1.0f).coerceIn(0.60f, 1.0f)
        glassBlurDp = sp.getFloat("ap_glass_blur", 20f).coerceIn(0f, 36f)
        val savedGlassStyle = sp.getString("ap_glass_style", "frosted") ?: "frosted"
        glassStyle = if (savedGlassStyle in GLASS_STYLES) savedGlassStyle else "frosted"
        fontStyle = sp.getString("ap_font", "system") ?: "system"
        highContrast = sp.getBoolean("ap_high_contrast", false)
    }

    private fun savePrefs(context: Context) {
        context.getSharedPreferences("kooyu_settings", Context.MODE_PRIVATE)
            .edit()
            .putString("theme_mode", themePreference)
            .putString("ap_preset", preset)
            .putString("ap_accent", accentId)
            .putString("ap_light_bg", lightBgHex)
            .putString("ap_light_fg", lightFgHex)
            .putString("ap_dark_bg", darkBgHex)
            .putString("ap_dark_fg", darkFgHex)
            .putFloat("ap_glass_opacity", glassOpacity)
            .putFloat("ap_surface_opacity", surfaceOpacity)
            .putFloat("ap_glass_blur", glassBlurDp)
            .putString("ap_glass_style", glassStyle)
            .putString("ap_font", fontStyle)
            .putBoolean("ap_high_contrast", highContrast)
            .apply()
    }

    fun update(context: Context, mode: String) {
        if (mode !in THEME_MODES) return
        themePreference = mode
        savePrefs(context)
    }

    fun applyPreset(context: Context, presetId: String) {
        val p = ANDROID_THEME_PRESETS.firstOrNull { it.id == presetId } ?: return
        preset = p.id
        accentId = p.accentId
        lightBgHex = p.lightBg
        lightFgHex = p.lightFg
        darkBgHex = p.darkBg
        darkFgHex = p.darkFg
        savePrefs(context)
    }

    fun updateCustom(
        context: Context,
        nextAccent: String = accentId,
        nextLightBg: String = lightBgHex,
        nextLightFg: String = lightFgHex,
        nextDarkBg: String = darkBgHex,
        nextDarkFg: String = darkFgHex,
        nextGlassOpacity: Float = glassOpacity,
        nextSurfaceOpacity: Float = surfaceOpacity,
        nextGlassBlur: Float = glassBlurDp,
        nextGlassStyle: String = glassStyle,
        nextFont: String = fontStyle,
        nextHighContrast: Boolean = highContrast,
        markCustomPreset: Boolean = false,
    ) {
        if (markCustomPreset) preset = "custom"
        accentId = nextAccent
        lightBgHex = normalizeHexAndroid(nextLightBg, "#FFFFFF")
        lightFgHex = normalizeHexAndroid(nextLightFg, "#141518")
        darkBgHex = normalizeHexAndroid(nextDarkBg, "#121316")
        darkFgHex = normalizeHexAndroid(nextDarkFg, "#F3F4F6")
        glassOpacity = nextGlassOpacity.coerceIn(0.45f, 0.98f)
        surfaceOpacity = nextSurfaceOpacity.coerceIn(0.60f, 1.0f)
        glassBlurDp = nextGlassBlur.coerceIn(0f, 36f)
        glassStyle = if (nextGlassStyle in GLASS_STYLES) nextGlassStyle else "frosted"
        fontStyle = nextFont
        highContrast = nextHighContrast
        savePrefs(context)
    }

    fun resetAll(context: Context) {
        preset = "kooyu"
        accentId = "default"
        lightBgHex = "#FFFFFF"
        lightFgHex = "#141518"
        darkBgHex = "#121316"
        darkFgHex = "#F3F4F6"
        glassOpacity = 0.86f
        surfaceOpacity = 1.0f
        glassBlurDp = 20f
        glassStyle = "frosted"
        fontStyle = "system"
        highContrast = false
        savePrefs(context)
    }

    val isModified: Boolean
        get() = preset != "kooyu" ||
            accentId != "default" ||
            lightBgHex != "#FFFFFF" ||
            lightFgHex != "#141518" ||
            darkBgHex != "#121316" ||
            darkFgHex != "#F3F4F6" ||
            glassOpacity != 0.86f ||
            surfaceOpacity != 1.0f ||
            glassStyle != "frosted" ||
            fontStyle != "system" ||
            highContrast

    fun buildColors(dark: Boolean): KooyuColors {
        val base = if (dark) DarkKooyu else LightKooyu
        val bgSolid = parseHexColor(if (dark) darkBgHex else lightBgHex, base.paper)
        val fg = parseHexColor(if (dark) darkFgHex else lightFgHex, base.text)
        val navSolid = if (dark) blendColor(bgSolid, Color.Black, 0.64f) else blendColor(bgSolid, fg, 0.962f)
        val raisedSolid = if (dark) blendColor(bgSolid, fg, 0.955f) else bgSolid
        val sunkenSolid = if (dark) blendColor(bgSolid, Color.Black, 0.78f) else blendColor(bgSolid, fg, 0.942f)
        val bubbleSolid = if (dark) blendColor(bgSolid, fg, 0.922f) else blendColor(bgSolid, fg, 0.946f)

        val surfA = surfaceOpacity.coerceIn(0.60f, 1.0f)
        val styleAlphaScale = when (glassStyle) {
            "clear" -> 0.76f
            "solid" -> 1.18f
            else -> 1f
        }
        val glassA = (glassOpacity * styleAlphaScale).coerceIn(0.42f, 0.99f)
        val contrastMult = if (highContrast) 1.6f else 1f

        val accentPair = ANDROID_ACCENT_OPTIONS.firstOrNull { it.first == accentId }?.third
        val resolvedAccent = when {
            accentId == "default" || accentPair == null -> fg
            dark -> accentPair.second
            else -> accentPair.first
        }
        val onAccent = if (colorLuminance(resolvedAccent) > 0.48f) Color(0xFF121316) else Color.White
        val microCoral = if (accentId == "default") base.brandCoral else resolvedAccent

        return base.copy(
            paper = if (surfA < 1f) bgSolid.copy(alpha = surfA) else bgSolid,
            navigator = navSolid,
            raised = if (surfA < 1f) raisedSolid.copy(alpha = (surfA + 0.04f).coerceAtMost(1f)) else raisedSolid,
            sunken = sunkenSolid,
            bubble = bubbleSolid,
            text = fg,
            textSecondary = blendColor(fg, bgSolid, if (dark) 0.68f else 0.64f),
            textTertiary = blendColor(fg, bgSolid, if (dark) 0.46f else 0.48f),
            borderSubtle = fg.copy(alpha = ((if (dark) 0.07f else 0.065f) * contrastMult).coerceAtMost(0.35f)),
            border = fg.copy(alpha = ((if (dark) 0.11f else 0.10f) * contrastMult).coerceAtMost(0.45f)),
            borderStrong = fg.copy(alpha = ((if (dark) 0.19f else 0.18f) * contrastMult).coerceAtMost(0.60f)),
            accent = resolvedAccent,
            onAccent = onAccent,
            accentTint = resolvedAccent.copy(alpha = if (dark) 0.14f else 0.08f),
            brandCoral = microCoral,
            brandCoralTint = microCoral.copy(alpha = if (dark) 0.18f else 0.11f),
            capsule = if (dark) blendColor(bgSolid, fg, 0.965f) else blendColor(bgSolid, fg, 0.97f),
            glassSurface = bgSolid.copy(alpha = glassA),
            glassBorder = fg.copy(alpha = if (dark) 0.13f else 0.09f),
        )
    }
}

object Kooyu {
    val colors: KooyuColors @Composable get() = LocalKooyu.current
}

/**
 * Apple HIG Liquid Glass chrome layer with 0.5.dp top specular highlight rim.
 * Apply [kooyuGlassBackdropBlur] on background-only layers when soft frosted diffusion is desired.
 */
fun Modifier.kooyuGlassSurface(
    shape: Shape = RectangleShape,
    topHighlight: Boolean = true,
): Modifier = composed {
    val c = Kooyu.colors
    val style = ThemeManager.glassStyle
    val rimTop = when (style) {
        "clear" -> if (c.dark) Color.White.copy(alpha = 0.22f) else Color.White.copy(alpha = 0.88f)
        "solid" -> c.borderSubtle
        else -> if (c.dark) Color.White.copy(alpha = 0.14f) else Color.White.copy(alpha = 0.72f)
    }
    val rimBottom = if (style == "clear") c.glassBorder.copy(alpha = (c.glassBorder.alpha * 1.35f).coerceAtMost(0.4f)) else c.glassBorder
    val fill = if (style == "solid") c.raised else c.glassSurface
    this
        .clip(shape)
        .background(fill, shape)
        .then(
            if (shape == RectangleShape) {
                Modifier.drawWithContent {
                    drawContent()
                    val stroke = 0.5.dp.toPx()
                    if (topHighlight) {
                        drawLine(rimTop, Offset(0f, stroke * 0.5f), Offset(size.width, stroke * 0.5f), strokeWidth = stroke)
                    }
                    drawLine(c.borderSubtle, Offset(0f, size.height - stroke * 0.5f), Offset(size.width, size.height - stroke * 0.5f), strokeWidth = stroke)
                }
            } else {
                Modifier.border(
                    width = 0.5.dp,
                    brush = Brush.verticalGradient(listOf(if (topHighlight) rimTop else rimBottom, rimBottom)),
                    shape = shape
                )
            }
        )
}

/** API 31+ RenderEffect background-only blur helper for underlying frosted surfaces (never apply onto crisp foreground text). */
fun Modifier.kooyuGlassBackdropBlur(blurRadius: Dp = ThemeManager.glassBlurDp.dp): Modifier = composed {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && blurRadius > 0.5.dp) {
        val px = with(LocalDensity.current) { blurRadius.toPx().coerceAtLeast(1f) }
        this.graphicsLayer {
            renderEffect = AndroidRenderEffect.createBlurEffect(px, px, Shader.TileMode.CLAMP).asComposeRenderEffect()
        }
    } else {
        this
    }
}

/** Plan §2.2 type scale. Material slots map onto the named roles below. */
object KooyuType {
    /** Page Title: 20 / 26 / Bold — page headers and sheet titles. */
    val pageTitle = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = (-0.3).sp)
    /** Section Header: 12 / 16 / SemiBold — group headers, settings sections. */
    val sectionHeader = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp)
    /** Session Row Title: 14 / 19 / SemiBold — single-line list titles. */
    val rowTitle = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 19.sp, letterSpacing = (-0.15).sp)
    /** Body Copy: 15 / 23 / Normal — assistant prose and user bubbles. */
    val body = TextStyle(fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 23.sp, letterSpacing = (-0.15).sp)
    /** UI Label / Pill: 13 / 18 / Medium — buttons, pills, nav labels. */
    val label = TextStyle(fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp)
    /** Caption / Meta: 11 / 14 / Medium — timestamps, counts, engine short labels. */
    val caption = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp)
    /** Monospace: 12 / 17 — code, diffs, terminal output. */
    val mono = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 17.sp)
}

val KooyuTypography = Typography(
    headlineSmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        letterSpacing = (-0.4).sp
    ),
    titleLarge = KooyuType.pageTitle,
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        letterSpacing = (-0.2).sp
    ),
    titleSmall = KooyuType.rowTitle,
    bodyLarge = KooyuType.body,
    bodyMedium = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 13.5.sp,
        lineHeight = 19.sp,
        letterSpacing = (-0.15).sp
    ),
    labelLarge = KooyuType.label,
    labelMedium = KooyuType.sectionHeader,
    labelSmall = KooyuType.caption,
)

@Composable
fun KooyuTheme(content: @Composable () -> Unit) {
    val systemDark = isSystemInDarkTheme()
    val dark = when (ThemeManager.themePreference) {
        "dark" -> true
        "light" -> false
        else -> systemDark
    }
    val customColors = ThemeManager.buildColors(dark)
    val chosenFamily = when (ThemeManager.fontStyle) {
        "sans" -> FontFamily.SansSerif
        "serif" -> FontFamily.Serif
        "mono" -> FontFamily.Monospace
        else -> FontFamily.Default
    }
    val activeTypography = remember(chosenFamily) {
        if (chosenFamily == FontFamily.Default) KooyuTypography
        else KooyuTypography.copy(
            titleLarge = KooyuTypography.titleLarge.copy(fontFamily = chosenFamily),
            titleMedium = KooyuTypography.titleMedium.copy(fontFamily = chosenFamily),
            titleSmall = KooyuTypography.titleSmall.copy(fontFamily = chosenFamily),
            bodyLarge = KooyuTypography.bodyLarge.copy(fontFamily = chosenFamily),
            bodyMedium = KooyuTypography.bodyMedium.copy(fontFamily = chosenFamily),
            labelLarge = KooyuTypography.labelLarge.copy(fontFamily = chosenFamily),
            labelMedium = KooyuTypography.labelMedium.copy(fontFamily = chosenFamily),
            labelSmall = KooyuTypography.labelSmall.copy(fontFamily = chosenFamily),
        )
    }
    val m3Scheme = (if (dark) DarkScheme else LightScheme).copy(
        primary = customColors.accent,
        onPrimary = customColors.onAccent,
        primaryContainer = customColors.sunken,
        onPrimaryContainer = customColors.text,
        secondaryContainer = customColors.sunken,
        onSecondaryContainer = customColors.text,
        background = customColors.navigator,
        onBackground = customColors.text,
        surface = customColors.paper,
        onSurface = customColors.text,
        surfaceVariant = customColors.sunken,
        onSurfaceVariant = customColors.textSecondary,
        surfaceContainerLowest = customColors.paper,
        surfaceContainerLow = customColors.raised,
        surfaceContainer = customColors.navigator,
        surfaceContainerHigh = customColors.sunken,
        surfaceContainerHighest = customColors.bubble,
        outline = customColors.borderStrong,
        outlineVariant = customColors.border,
    )
    val view = LocalView.current
    if (!view.isInEditMode) SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
    CompositionLocalProvider(LocalKooyu provides customColors) {
        MaterialTheme(
            colorScheme = m3Scheme,
            typography = activeTypography,
            shapes = Shapes(
                extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
                small = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                medium = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                large = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
                extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
            ),
            content = content
        )
    }
}

/** Desktop HARNESS_VISUALS (apps/web/src/lib/harnesses.ts): one tinted plate + ink per engine. */
data class HarnessVisual(val name: String, val monogram: String, val tint: Color, val ink: Color, val darkTint: Color, val darkInk: Color)

val HARNESS_VISUALS = mapOf(
    "kodo" to HarnessVisual("Kooyu", "✦", Color(0x24E6533C), Color(0xFFC2422F), Color(0x38F17561), Color(0xFFFF9B8A)),
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

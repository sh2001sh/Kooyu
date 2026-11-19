package app.kooyu.android.ui.screens

import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.theme.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/**
 * Slim Apple-HIG style slider (4.dp pill track + 20.dp circular white thumb),
 * replacing Material3's thick stretched track bar.
 */
@Composable
private fun KooyuSlimSlider(
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Kooyu.colors
    var widthPx by remember { mutableFloatStateOf(1f) }
    val span = (range.endInclusive - range.start).coerceAtLeast(0.0001f)
    val fraction = ((value - range.start) / span).coerceIn(0f, 1f)
    val currentOnChange by rememberUpdatedState(onValueChange)

    fun updateAt(x: Float) {
        val f = (x / widthPx.coerceAtLeast(1f)).coerceIn(0f, 1f)
        currentOnChange(range.start + f * span)
    }

    Box(
        modifier
            .fillMaxWidth()
            .height(28.dp)
            .onSizeChanged { widthPx = it.width.toFloat().coerceAtLeast(1f) }
            .pointerInput(range) {
                detectTapGestures { offset -> updateAt(offset.x) }
            }
            .pointerInput(range) {
                detectHorizontalDragGestures(
                    onDragStart = { offset -> updateAt(offset.x) },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        updateAt(change.position.x)
                    }
                )
            },
        contentAlignment = Alignment.CenterStart
    ) {
        // Inactive slim track
        Box(
            Modifier
                .fillMaxWidth()
                .height(5.dp)
                .clip(CircleShape)
                .background(c.sunken)
                .border(0.5.dp, c.borderSubtle, CircleShape)
        )
        // Active fill
        Box(
            Modifier
                .fillMaxWidth(fraction)
                .height(5.dp)
                .clip(CircleShape)
                .background(c.accent)
        )
        // Crisp 20.dp circular thumb (strictly 1:1 circle, never stretched)
        val thumbSize = 20.dp
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val travel = (maxWidth - thumbSize).coerceAtLeast(0.dp)
            Box(
                Modifier
                    .offset { IntOffset((travel.toPx() * fraction).roundToInt(), 0) }
                    .size(thumbSize)
                    .shadow(3.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.22f), spotColor = Color.Black.copy(alpha = 0.22f))
                    .clip(CircleShape)
                    .background(Color.White)
                    .border(1.dp, c.border, CircleShape)
            )
        }
    }
}

/** 1:1 Circular Dual-Tone Palette Medallion (mathematically square, never stretched). */
@Composable
private fun PaletteMedallion(bgHex: String, fgHex: String, accentColor: Color) {
    val bg = parseHexColor(bgHex, Color.White)
    val fg = parseHexColor(fgHex, Color.Black)
    Canvas(
        Modifier
            .size(30.dp)
            .clip(CircleShape)
            .border(0.8.dp, Kooyu.colors.border, CircleShape)
    ) {
        drawRect(bg)
        val diag = Path().apply {
            moveTo(size.width, 0f)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        clipPath(diag) {
            drawRect(fg)
        }
        drawCircle(accentColor, radius = 4.5.dp.toPx(), center = Offset(size.width * 0.5f, size.height * 0.5f))
        drawCircle(Color.White.copy(alpha = 0.85f), radius = 5.2.dp.toPx(), center = Offset(size.width * 0.5f, size.height * 0.5f), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx()))
    }
}

/**
 * Original Kooyu Live Conversation Stage Preview:
 * Renders real Compose elements reflecting live colors, glass opacity, font, and accent.
 */
@Composable
private fun LiveAppearancePreviewCard() {
    val context = LocalContext.current
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = c.navigator,
        border = BorderStroke(0.5.dp, c.border),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            // Simulated ambient canvas + floating mini conversation sheet
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.linearGradient(
                            listOf(
                                c.brandCoral.copy(alpha = if (c.dark) 0.10f else 0.07f),
                                c.navigator,
                                c.accent.copy(alpha = 0.05f)
                            )
                        )
                    )
                    .padding(14.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.paper,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        // Frosted mini header responding to glassSurface
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .background(c.glassSurface)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            EngineBadge("kodo", 20.dp, circle = false)
                            Text("Kooyu 质感实时预览", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.text, modifier = Modifier.weight(1f))
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(c.sunken)
                                    .padding(horizontal = 7.dp, vertical = 2.dp)
                            ) {
                                val styleName = when (ThemeManager.glassStyle) {
                                    "clear" -> "清透"
                                    "solid" -> "实体"
                                    else -> "磨砂"
                                }
                                Text("$styleName · ${(ThemeManager.glassOpacity * 100).toInt()}%", fontSize = 10.sp, fontFamily = FontFamily.Monospace, color = c.textSecondary)
                            }
                        }
                        HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)

                        // Mini messages
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(
                                Modifier
                                    .align(Alignment.End)
                                    .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomStart = 14.dp, bottomEnd = 4.dp))
                                    .background(c.bubble)
                                    .border(0.5.dp, c.borderSubtle, RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomStart = 14.dp, bottomEnd = 4.dp))
                                    .padding(horizontal = 11.dp, vertical = 6.dp)
                            ) {
                                Text("保持克制的留白与通透层次。", fontSize = 12.sp, color = c.text)
                            }

                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                EngineBadge("claude-code", 18.dp, circle = false)
                                Text("已同步画布色温、点缀色与毛玻璃通透度。", fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Box(
                                    Modifier
                                        .size(22.dp)
                                        .clip(CircleShape)
                                        .background(c.accent),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Outlined.ArrowUpward, null, tint = c.onAccent, modifier = Modifier.size(13.dp))
                                }
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)

            // 3-Mode Segmented Bar (跟随系统 / 浅色 / 深色) with crisp icons
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(c.raised)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val modes = listOf(
                    Triple("system", "跟随系统", Icons.Outlined.BrightnessAuto),
                    Triple("light", "浅色", Icons.Outlined.WbSunny),
                    Triple("dark", "深色", Icons.Outlined.DarkMode),
                )
                modes.forEach { (id, label, icon) ->
                    val active = ThemeManager.themePreference == id
                    Row(
                        Modifier
                            .weight(1f)
                            .height(36.dp)
                            .clip(RoundedCornerShape(11.dp))
                            .background(if (active) c.accent else c.sunken)
                            .border(0.5.dp, if (active) Color.Transparent else c.borderSubtle, RoundedCornerShape(11.dp))
                            .clickable(onClickLabel = label) { ThemeManager.update(context, id) }
                            .semantics {
                                contentDescription = label
                                role = Role.RadioButton
                                selected = active
                            },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally)
                    ) {
                        Icon(icon, null, tint = if (active) c.onAccent else c.textSecondary, modifier = Modifier.size(14.dp))
                        Text(
                            label,
                            fontSize = 12.5.sp,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                            color = if (active) c.onAccent else c.textSecondary,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ColorHexEditDialog(
    title: String,
    initialHex: String,
    swatches: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val c = Kooyu.colors
    var hexText by remember(initialHex) { mutableStateOf(initialHex.uppercase()) }
    val previewColor = parseHexColor(hexText, parseHexColor(initialHex, Color.White))

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.raised,
        shape = RoundedCornerShape(20.dp),
        title = { Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.text) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    swatches.forEach { sw ->
                        val swColor = parseHexColor(sw, Color.White)
                        val isPicked = normalizeHexAndroid(hexText, "") == sw.uppercase()
                        Box(
                            Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(swColor)
                                .border(
                                    width = if (isPicked) 2.dp else 0.8.dp,
                                    color = if (isPicked) c.accent else c.borderStrong,
                                    shape = CircleShape
                                )
                                .clickable { hexText = sw.uppercase() }
                        )
                    }
                }

                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.sunken)
                        .border(0.5.dp, c.border, RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(
                        Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .background(previewColor)
                            .border(0.8.dp, c.borderStrong, CircleShape)
                    )
                    BasicTextField(
                        value = hexText,
                        onValueChange = { hexText = it.take(7).uppercase() },
                        singleLine = true,
                        textStyle = KooyuType.mono.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.text),
                        cursorBrush = SolidColor(c.accent),
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(normalizeHexAndroid(hexText, initialHex)) },
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
            ) {
                Text("应用", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消", color = c.textSecondary)
            }
        }
    )
}

@Composable
fun AppearanceStudioSection() {
    val context = LocalContext.current
    val c = Kooyu.colors
    var editingColorKind by remember { mutableStateOf<String?>(null) }

    val activeBgHex = if (c.dark) ThemeManager.darkBgHex else ThemeManager.lightBgHex
    val activeFgHex = if (c.dark) ThemeManager.darkFgHex else ThemeManager.lightFgHex

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        // Header + One-Click Reset
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("外观", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
            if (ThemeManager.isModified) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(c.raised)
                        .border(0.5.dp, c.border, RoundedCornerShape(999.dp))
                        .clickable { ThemeManager.resetAll(context) }
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Outlined.Refresh, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
                    Text("恢复默认", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                }
            }
        }

        // 1) Original Kooyu Live Conversation Stage + 3-Segment Mode Bar
        LiveAppearancePreviewCard()

        // 2) Horizontal Visual Palette Cards (预设画板)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("预设画板", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, modifier = Modifier.padding(horizontal = 4.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                ANDROID_THEME_PRESETS.forEach { p ->
                    val selected = ThemeManager.preset == p.id
                    val accentDot = ANDROID_ACCENT_OPTIONS.firstOrNull { it.first == p.accentId }?.third?.first ?: Color(0xFF141518)
                    Surface(
                        shape = RoundedCornerShape(15.dp),
                        color = if (selected) c.raised else c.raised.copy(alpha = 0.72f),
                        border = BorderStroke(if (selected) 1.5.dp else 0.5.dp, if (selected) c.accent else c.borderSubtle),
                        modifier = Modifier
                            .width(92.dp)
                            .clip(RoundedCornerShape(15.dp))
                            .clickable { ThemeManager.applyPreset(context, p.id) }
                    ) {
                        Column(
                            Modifier.padding(vertical = 11.dp, horizontal = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(7.dp)
                        ) {
                            PaletteMedallion(
                                bgHex = if (c.dark) p.darkBg else p.lightBg,
                                fgHex = if (c.dark) p.darkFg else p.lightFg,
                                accentColor = accentDot
                            )
                            Text(
                                p.label,
                                fontSize = 12.sp,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                color = if (selected) c.text else c.textSecondary,
                                maxLines = 1
                            )
                        }
                    }
                }
            }
        }

        // 3) Direct Swatch Strip + Paired Canvas/Ink Cards (色彩调校)
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.borderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("点缀强调色", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text, modifier = Modifier.weight(1f))
                    Text(
                        ANDROID_ACCENT_OPTIONS.firstOrNull { it.first == ThemeManager.accentId }?.second ?: "默认",
                        fontSize = 12.sp,
                        color = c.textTertiary
                    )
                }

                // 1-Tap Circular Swatches Row (strictly 32.dp circles, never stretched)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    ANDROID_ACCENT_OPTIONS.forEach { (id, label, pair) ->
                        val dot = if (c.dark) pair.second else pair.first
                        val isPicked = ThemeManager.accentId == id
                        Box(
                            Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .border(if (isPicked) 2.dp else 0.dp, if (isPicked) c.text else Color.Transparent, CircleShape)
                                .clickable(onClickLabel = label) {
                                    ThemeManager.updateCustom(context, nextAccent = id, markCustomPreset = true)
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Box(
                                Modifier
                                    .size(26.dp)
                                    .clip(CircleShape)
                                    .background(dot)
                                    .border(0.5.dp, Color.Gray.copy(alpha = 0.35f), CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                if (isPicked) {
                                    Icon(
                                        Icons.Outlined.Check,
                                        null,
                                        tint = if (c.dark && id == "default") Color(0xFF121316) else Color.White,
                                        modifier = Modifier.size(13.dp)
                                    )
                                }
                            }
                        }
                    }
                }

                HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)

                // Paired 2-Column Canvas & Ink Cards
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ColorPairTile(
                        title = "画布底色",
                        hex = activeBgHex,
                        modifier = Modifier.weight(1f),
                        onClick = { editingColorKind = "bg" }
                    )
                    ColorPairTile(
                        title = "正文字色",
                        hex = activeFgHex,
                        modifier = Modifier.weight(1f),
                        onClick = { editingColorKind = "fg" }
                    )
                }
            }
        }

        // 4) Liquid Glass & Transparency (Slim Apple Sliders)
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.borderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(vertical = 6.dp)) {
                SlimSliderRow(
                    title = "毛玻璃通透度",
                    badge = "${(ThemeManager.glassOpacity * 100).toInt()}%",
                    value = ThemeManager.glassOpacity,
                    range = 0.45f..0.98f,
                    onValueChange = { ThemeManager.updateCustom(context, nextGlassOpacity = it) }
                )
                HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(horizontal = 16.dp))
                SlimSliderRow(
                    title = "面板不透明度",
                    badge = "${(ThemeManager.surfaceOpacity * 100).toInt()}%",
                    value = ThemeManager.surfaceOpacity,
                    range = 0.60f..1.0f,
                    onValueChange = { ThemeManager.updateCustom(context, nextSurfaceOpacity = it) }
                )
                HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(horizontal = 16.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("玻璃质感", fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = c.text)
                    KooyuSegmentedControl(
                        options = listOf(
                            SegmentOption("clear", "清透"),
                            SegmentOption("frosted", "磨砂"),
                            SegmentOption("solid", "实体")
                        ),
                        selected = ThemeManager.glassStyle,
                        onSelect = { ThemeManager.updateCustom(context, nextGlassStyle = it) },
                        modifier = Modifier.fillMaxWidth(),
                        height = 34.dp
                    )
                }
            }
        }

        // 5) Typography & Border Sharpness
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.borderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("字体", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(
                        "system" to "系统",
                        "sans" to "无衬线",
                        "serif" to "衬线",
                        "mono" to "等宽",
                    ).forEach { (id, label) ->
                        val active = ThemeManager.fontStyle == id
                        Box(
                            Modifier
                                .weight(1f)
                                .height(34.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (active) c.accent else c.sunken)
                                .clickable { ThemeManager.updateCustom(context, nextFont = id) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                label,
                                fontSize = 12.sp,
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                                color = if (active) c.onAccent else c.textSecondary
                            )
                        }
                    }
                }

                HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)

                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("高对比描边", fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
                    Switch(
                        checked = ThemeManager.highContrast,
                        onCheckedChange = { ThemeManager.updateCustom(context, nextHighContrast = it) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = c.onAccent,
                            checkedTrackColor = c.accent,
                            checkedBorderColor = Color.Transparent,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = c.sunken,
                            uncheckedBorderColor = c.border
                        )
                    )
                }
            }
        }
    }

    if (editingColorKind == "bg") {
        val swatches = if (c.dark) {
            listOf("#121316", "#0B0C0E", "#1C1C1E", "#212121", "#242933", "#181614")
        } else {
            listOf("#FFFFFF", "#F5F5F7", "#FAF9F5", "#F4F6FA", "#F9FAFB", "#F2EFE9")
        }
        ColorHexEditDialog(
            title = if (c.dark) "自定义深色画布" else "自定义浅色画布",
            initialHex = activeBgHex,
            swatches = swatches,
            onDismiss = { editingColorKind = null },
            onConfirm = { hex ->
                if (c.dark) ThemeManager.updateCustom(context, nextDarkBg = hex, markCustomPreset = true)
                else ThemeManager.updateCustom(context, nextLightBg = hex, markCustomPreset = true)
                editingColorKind = null
            }
        )
    }

    if (editingColorKind == "fg") {
        val swatches = if (c.dark) {
            listOf("#F3F4F6", "#FFFFFF", "#ECECEC", "#EFECE6", "#E5E9F0", "#D8DEE9")
        } else {
            listOf("#141518", "#1A1C1F", "#000000", "#1F1E1D", "#2E3440", "#334155")
        }
        ColorHexEditDialog(
            title = if (c.dark) "自定义深色字色" else "自定义浅色字色",
            initialHex = activeFgHex,
            swatches = swatches,
            onDismiss = { editingColorKind = null },
            onConfirm = { hex ->
                if (c.dark) ThemeManager.updateCustom(context, nextDarkFg = hex, markCustomPreset = true)
                else ThemeManager.updateCustom(context, nextLightFg = hex, markCustomPreset = true)
                editingColorKind = null
            }
        )
    }
}

@Composable
private fun ColorPairTile(
    title: String,
    hex: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = Kooyu.colors
    val sw = parseHexColor(hex, Color.White)
    Row(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(c.sunken)
            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(sw)
                .border(0.8.dp, Color.Gray.copy(alpha = 0.42f), CircleShape)
        )
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 11.sp, color = c.textTertiary)
            Text(hex.uppercase(), fontSize = 12.5.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, color = c.text)
        }
    }
}

@Composable
private fun SlimSliderRow(
    title: String,
    badge: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit,
) {
    val c = Kooyu.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
            Box(
                Modifier
                    .height(23.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(c.sunken)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(badge, fontFamily = FontFamily.Monospace, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
            }
        }
        KooyuSlimSlider(value = value, range = range, onValueChange = onValueChange)
    }
}

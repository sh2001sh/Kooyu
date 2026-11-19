package app.kooyu.android.ui.components

import app.kooyu.android.ui.theme.*

import android.graphics.Typeface
import android.text.method.LinkMovementMethod
import android.util.TypedValue
import android.widget.TextView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import kotlinx.coroutines.delay

sealed interface MarkdownSegment {
    data class Prose(val text: String) : MarkdownSegment
    data class Code(val language: String, val code: String) : MarkdownSegment
    data class Callout(val kind: String, val body: String) : MarkdownSegment
}

private val fenceOpen = Regex("""^ {0,3}(`{3,}|~{3,})\s*([^`\s]*).*$""")
private val calloutHeader = Regex("""^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$""", RegexOption.IGNORE_CASE)

/**
 * Splits Markdown into Markwon prose blocks, native scrollable IDE/Diff code cards,
 * and GitHub-style `[!NOTE] / [!TIP] / [!WARNING]` callout cards.
 */
fun splitMarkdown(text: String): List<MarkdownSegment> {
    val segments = mutableListOf<MarkdownSegment>()
    val prose = StringBuilder()
    val lines = text.replace("\r\n", "\n").split("\n")
    var i = 0
    fun flushProse() {
        if (prose.isNotBlank()) segments += MarkdownSegment.Prose(prose.toString().trimEnd('\n'))
        prose.setLength(0)
    }
    while (i < lines.size) {
        val open = fenceOpen.matchEntire(lines[i])
        if (open != null) {
            val fence = open.groupValues[1]
            val language = open.groupValues[2]
            val body = mutableListOf<String>()
            i++
            while (i < lines.size) {
                val line = lines[i].trimStart()
                if (line.startsWith(fence.substring(0, 3)) && line.trimEnd().all { it == fence[0] } && line.trimEnd().length >= fence.length) {
                    i++
                    break
                }
                body += lines[i]
                i++
            }
            flushProse()
            segments += MarkdownSegment.Code(language, body.joinToString("\n"))
            continue
        }
        val callout = calloutHeader.matchEntire(lines[i].trim())
        if (callout != null) {
            val kind = callout.groupValues[1].uppercase()
            val bodyLines = mutableListOf<String>()
            if (callout.groupValues[2].isNotBlank()) bodyLines += callout.groupValues[2].trim()
            i++
            while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                bodyLines += lines[i].trimStart().removePrefix(">").trimStart()
                i++
            }
            flushProse()
            segments += MarkdownSegment.Callout(kind, bodyLines.joinToString("\n").trim())
            continue
        }
        prose.append(lines[i]).append('\n')
        i++
    }
    flushProse()
    return segments
}

@Composable private fun rememberMarkwon(colors: KooyuColors, fontSize: Float): Markwon {
    val context = LocalContext.current
    val density = LocalDensity.current
    return remember(context, colors, fontSize) {
        fun px(dp: Int) = with(density) { dp.dp.roundToPx() }
        Markwon.builder(context)
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TaskListPlugin.create(colors.text.toArgb(), colors.textTertiary.toArgb(), colors.paper.toArgb()))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(TablePlugin.create { theme ->
                theme.tableBorderColor(colors.borderSubtle.toArgb())
                    .tableBorderWidth(px(1))
                    .tableCellPadding(px(9))
                    .tableHeaderRowBackgroundColor(colors.sunken.toArgb())
                    .tableOddRowBackgroundColor(Color.Transparent.toArgb())
                    .tableEvenRowBackgroundColor(Color.Transparent.toArgb())
            })
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder
                        .codeTextColor(colors.text.toArgb())
                        .codeBackgroundColor(colors.sunken.toArgb())
                        .codeBlockTextColor(colors.text.toArgb())
                        .codeBlockBackgroundColor(colors.sunken.toArgb())
                        .codeTypeface(Typeface.MONOSPACE)
                        .codeBlockTypeface(Typeface.MONOSPACE)
                        .codeTextSize(with(density) { (fontSize - 2f).sp.roundToPx() })
                        .codeBlockMargin(px(12))
                        .blockQuoteColor(colors.borderStrong.toArgb())
                        .blockQuoteWidth(px(3))
                        .blockMargin(px(16))
                        .linkColor(colors.text.toArgb())
                        .isLinkUnderlined(true)
                        .headingBreakHeight(0)
                        .headingTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD))
                        .headingTextSizeMultipliers(floatArrayOf(1.32f, 1.18f, 1.08f, 1.0f, 0.95f, 0.9f))
                        .thematicBreakColor(colors.borderSubtle.toArgb())
                        .thematicBreakHeight(px(1))
                        .bulletWidth(px(5))
                        .listItemColor(colors.textTertiary.toArgb())
                }
            })
            .build()
    }
}

/** Markwon-backed prose, selectable, with crisp editorial typography (15sp / ~1.62 line height). */
@Composable fun MarkdownProse(text: String, fontSize: Float = 15f, color: Color? = null) {
    val colors = Kooyu.colors
    val markwon = rememberMarkwon(colors, fontSize)
    val foreground = (color ?: colors.text).toArgb()
    AndroidView(
        modifier = Modifier.fillMaxWidth(),
        factory = { ctx ->
            TextView(ctx).apply {
                setTextIsSelectable(true)
                movementMethod = LinkMovementMethod.getInstance()
                setPadding(0, 0, 0, 0)
                includeFontPadding = false
                setLineSpacing(0f, 1.58f)
                letterSpacing = -0.005f
            }
        },
        update = { view ->
            view.setTextColor(foreground)
            view.setLinkTextColor(foreground)
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
            val key = text to System.identityHashCode(markwon)
            if (view.tag != key) {
                view.tag = key
                markwon.setMarkdown(view, text)
            }
        },
    )
}

@Composable fun CopyIconButton(text: String, label: String = "复制", size: Int = 30) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1400); copied = false } }
    IconButton(onClick = { clipboard.setText(AnnotatedString(text)); copied = true }, modifier = Modifier.size(size.dp)) {
        Icon(
            if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
            if (copied) "已复制" else label,
            tint = if (copied) Kooyu.colors.success else Kooyu.colors.textTertiary,
            modifier = Modifier.size((size / 2).dp)
        )
    }
}

@Composable fun CopyPillButton(text: String, label: String = "复制") {
    val c = Kooyu.colors
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (copied) c.successTint else c.sunken.copy(alpha = 0.8f))
            .border(0.5.dp, if (copied) Color.Transparent else c.borderSubtle, RoundedCornerShape(999.dp))
            .clickable { clipboard.setText(AnnotatedString(text)); copied = true }
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Icon(
            if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
            null,
            tint = if (copied) c.doneText else c.textSecondary,
            modifier = Modifier.size(12.dp)
        )
        Text(
            if (copied) "已复制" else label,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            color = if (copied) c.doneText else c.textSecondary
        )
    }
}

@Composable private fun CalloutBlock(kind: String, body: String) {
    val c = Kooyu.colors
    val (label, icon, accent, tintBg) = when (kind) {
        "WARNING", "CAUTION" -> listOf("注意", Icons.Outlined.WarningAmber, c.destructive, c.destructiveTint)
        "TIP" -> listOf("提示", Icons.Outlined.Lightbulb, c.success, c.sunken)
        "IMPORTANT" -> listOf("重要", Icons.Outlined.AutoAwesome, c.text, c.sunken)
        else -> listOf("说明", Icons.Outlined.Info, c.info, c.sunken)
    }
    val barColor = accent as Color
    val bgColor = tintBg as Color
    val vec = icon as androidx.compose.ui.graphics.vector.ImageVector
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(bgColor)
            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
    ) {
        Box(Modifier.width(3.dp).height(IntrinsicSize.Max).background(barColor))
        Column(Modifier.padding(horizontal = 13.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(vec, null, tint = barColor, modifier = Modifier.size(15.dp))
                Text(label as String, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = c.text)
            }
            if (body.isNotBlank()) {
                MarkdownProse(body, fontSize = 14f, color = c.textSecondary)
            }
        }
    }
}

/**
 * Studio IDE Code & Diff Card:
 * - Monochrome header (`[⌘ language]  N 行  ...  [复制代码]`)
 * - Line-by-line unified diff coloring (`+` green, `-` red, `@@` hunk)
 * - Subtle line-number gutter for multi-line code snippets
 */
@Composable fun CodeBlock(language: String, code: String) {
    val c = Kooyu.colors
    val trimmedCode = code.trimEnd('\n')
    val lines = remember(trimmedCode) { trimmedCode.split("\n") }
    val lang = language.lowercase().trim()
    val isDiff = remember(lang, lines) {
        lang in listOf("diff", "patch") ||
            (lang.isEmpty() && lines.size >= 2 && lines.any { it.startsWith("@@ ") } && lines.any { it.startsWith("+") || it.startsWith("-") })
    }
    val isShell = lang in listOf("sh", "bash", "zsh", "shell", "powershell", "ps1", "cmd", "console")
    val displayLang = if (isDiff) "diff" else lang.ifBlank { "code" }
    val cardBg = if (c.dark) Color(0xFF111318) else c.sunken.copy(alpha = 0.72f)
    val headBg = if (c.dark) Color(0xFF171A21) else c.sunken

    Surface(
        color = cardBg,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(0.5.dp, c.borderSubtle),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(headBg)
                    .padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    if (isShell) Icons.Outlined.Terminal else Icons.Outlined.Code,
                    null,
                    tint = c.textSecondary,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    displayLang,
                    fontSize = 11.5.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    color = c.text
                )
                if (lines.size > 1) {
                    Text(
                        "${lines.size} 行",
                        fontSize = 10.5.sp,
                        fontFamily = FontFamily.Monospace,
                        color = c.textTertiary,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(c.paper.copy(alpha = if (c.dark) 0.35f else 0.7f))
                            .padding(horizontal = 6.dp, vertical = 1.dp)
                    )
                }
                Spacer(Modifier.weight(1f))
                CopyPillButton(trimmedCode, "复制代码")
            }
            HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp)

            if (isDiff) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val cardMinWidth = maxWidth
                    SelectionContainer {
                        Column(
                            Modifier
                                .horizontalScroll(rememberScrollState())
                                .width(IntrinsicSize.Max)
                                .widthIn(min = cardMinWidth)
                                .padding(vertical = 8.dp)
                        ) {
                            lines.forEach { line ->
                                val (lineBg, lineFg) = when {
                                    line.startsWith("+++") || line.startsWith("---") -> Color.Transparent to c.textTertiary
                                    line.startsWith("+") -> c.success.copy(alpha = if (c.dark) 0.16f else 0.11f) to (if (c.dark) c.success else c.doneText)
                                    line.startsWith("-") -> c.destructive.copy(alpha = if (c.dark) 0.16f else 0.10f) to c.destructive
                                    line.startsWith("@@") -> c.info.copy(alpha = 0.12f) to c.info
                                    else -> Color.Transparent to c.text
                                }
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .background(lineBg)
                                        .padding(horizontal = 14.dp, vertical = 1.dp)
                                ) {
                                    Text(
                                        line.ifEmpty { " " },
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 12.sp,
                                        lineHeight = 18.sp,
                                        color = lineFg,
                                        softWrap = false
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    if (lines.size >= 3) {
                        Column(
                            Modifier
                                .padding(start = 11.dp, end = 9.dp, top = 11.dp, bottom = 11.dp),
                            horizontalAlignment = Alignment.End
                        ) {
                            lines.indices.forEach { idx ->
                                Text(
                                    "${idx + 1}",
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.5.sp,
                                    lineHeight = 19.sp,
                                    color = c.textTertiary.copy(alpha = 0.65f)
                                )
                            }
                        }
                        Box(Modifier.width(0.5.dp).height((lines.size * 19 + 22).dp).background(c.borderSubtle))
                    }
                    SelectionContainer {
                        Text(
                            trimmedCode,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.5.sp,
                            lineHeight = 19.sp,
                            color = c.text,
                            softWrap = false,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp)
                        )
                    }
                }
            }
        }
    }
}

/** Full Markdown message: prose via Markwon, fenced code/diffs & callouts as native Compose cards. */
@Composable fun MessageMarkdown(text: String, fontSize: Float = 15f, color: Color? = null) {
    val segments = remember(text) { splitMarkdown(text) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        segments.forEach { segment ->
            when (segment) {
                is MarkdownSegment.Prose -> MarkdownProse(segment.text, fontSize, color)
                is MarkdownSegment.Code -> CodeBlock(segment.language, segment.code)
                is MarkdownSegment.Callout -> CalloutBlock(segment.kind, segment.body)
            }
        }
    }
}

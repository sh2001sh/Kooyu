package app.kooyu.android

import android.graphics.Typeface
import android.text.method.LinkMovementMethod
import android.util.TypedValue
import android.widget.TextView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
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
}

private val fenceOpen = Regex("""^ {0,3}(`{3,}|~{3,})\s*([^`\s]*).*$""")

/** Pull fenced code blocks out so they render as scrollable native blocks; an unclosed fence (still streaming) runs to the end. */
fun splitMarkdown(text: String): List<MarkdownSegment> {
    val segments = mutableListOf<MarkdownSegment>()
    val prose = StringBuilder()
    val lines = text.replace("\r\n", "\n").split("\n")
    var i = 0
    fun flushProse() { if (prose.isNotBlank()) segments += MarkdownSegment.Prose(prose.toString().trimEnd('\n')); prose.setLength(0) }
    while (i < lines.size) {
        val open = fenceOpen.matchEntire(lines[i])
        if (open == null) { prose.append(lines[i]).append('\n'); i++; continue }
        val fence = open.groupValues[1]
        val language = open.groupValues[2]
        val body = mutableListOf<String>()
        i++
        while (i < lines.size) {
            val line = lines[i].trimStart()
            if (line.startsWith(fence.substring(0, 3)) && line.trimEnd().all { it == fence[0] } && line.trimEnd().length >= fence.length) { i++; break }
            body += lines[i]; i++
        }
        flushProse()
        segments += MarkdownSegment.Code(language, body.joinToString("\n"))
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
                theme.tableBorderColor(colors.border.toArgb()).tableBorderWidth(px(1)).tableCellPadding(px(8))
                    .tableHeaderRowBackgroundColor(colors.sunken.toArgb()).tableOddRowBackgroundColor(Color.Transparent.toArgb())
                    .tableEvenRowBackgroundColor(Color.Transparent.toArgb())
            })
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder.codeTextColor(colors.text.toArgb()).codeBackgroundColor(colors.sunken.toArgb())
                        .codeBlockTextColor(colors.text.toArgb()).codeBlockBackgroundColor(colors.sunken.toArgb())
                        .codeTypeface(Typeface.MONOSPACE).codeBlockTypeface(Typeface.MONOSPACE)
                        .codeTextSize(with(density) { (fontSize - 2).sp.roundToPx() })
                        .codeBlockMargin(px(12))
                        .blockQuoteColor(colors.borderStrong.toArgb()).blockQuoteWidth(px(3)).blockMargin(px(18))
                        .linkColor(colors.text.toArgb()).isLinkUnderlined(true)
                        .headingBreakHeight(0).headingTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD))
                        .headingTextSizeMultipliers(floatArrayOf(1.4f, 1.25f, 1.12f, 1.0f, 0.95f, 0.9f))
                        .thematicBreakColor(colors.border.toArgb()).thematicBreakHeight(px(1))
                        .bulletWidth(px(5)).listItemColor(colors.textSecondary.toArgb())
                }
            })
            .build()
    }
}

/** Markwon-backed prose, selectable, with desktop typography (15sp / ~1.6 line height). */
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
                setLineSpacing(0f, 1.55f)
                letterSpacing = -0.005f
            }
        },
        update = { view ->
            view.setTextColor(foreground)
            view.setLinkTextColor(foreground)
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
            val key = text to System.identityHashCode(markwon)
            if (view.tag != key) { view.tag = key; markwon.setMarkdown(view, text) }
        },
    )
}

@Composable fun CopyIconButton(text: String, label: String = "复制", size: Int = 30) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1400); copied = false } }
    IconButton(onClick = { clipboard.setText(AnnotatedString(text)); copied = true }, modifier = Modifier.size(size.dp)) {
        Icon(if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy, if (copied) "已复制" else label,
            tint = if (copied) Kooyu.colors.success else Kooyu.colors.textTertiary, modifier = Modifier.size((size / 2).dp))
    }
}

@Composable fun CodeBlock(language: String, code: String) {
    val colors = Kooyu.colors
    Surface(
        color = colors.sunken,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, colors.borderSubtle),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(colors.sunken.copy(alpha = 0.9f))
                    .padding(start = 12.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(colors.destructive.copy(alpha = 0.6f)))
                    Box(Modifier.size(7.dp).clip(CircleShape).background(colors.info.copy(alpha = 0.6f)))
                    Box(Modifier.size(7.dp).clip(CircleShape).background(colors.success.copy(alpha = 0.6f)))
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    language.ifBlank { "code" }.lowercase(),
                    fontSize = 11.5.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textTertiary,
                    modifier = Modifier.weight(1f)
                )
                CopyIconButton(code, "复制代码", 26)
            }
            androidx.compose.material3.HorizontalDivider(color = colors.borderSubtle, thickness = 0.5.dp)
            SelectionContainer {
                Text(
                    code,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.5.sp,
                    lineHeight = 19.sp,
                    color = colors.text,
                    softWrap = false,
                    modifier = Modifier
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                )
            }
        }
    }
}

/** Full Markdown message: prose via Markwon, fenced code as native scrollable blocks. */
@Composable fun MessageMarkdown(text: String, fontSize: Float = 15f, color: Color? = null) {
    val segments = remember(text) { splitMarkdown(text) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        segments.forEach { segment ->
            when (segment) {
                is MarkdownSegment.Prose -> MarkdownProse(segment.text, fontSize, color)
                is MarkdownSegment.Code -> CodeBlock(segment.language, segment.code)
            }
        }
    }
}

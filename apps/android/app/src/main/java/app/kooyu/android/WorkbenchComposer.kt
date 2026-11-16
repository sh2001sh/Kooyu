package app.kooyu.android

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Desktop main.tsx submit: only idle starts a new turn; every other state queues. */
fun composerSendMode(runState: String): String = if (runState == "idle") "new" else "queue"

data class ComposerOption(
    val value: String,
    val label: String,
    val detail: String = "",
    val leadingIcon: (@Composable () -> Unit)? = null
)

@Composable fun ComposerPill(
    label: String,
    icon: ImageVector? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selected: Boolean = false,
    expandable: Boolean = false,
    accessibilityLabel: String = label,
    onClick: () -> Unit = {}
) {
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (selected) c.accentTint else (if (c.dark) c.sunken else Color(0xFFF1F2F5)),
        border = BorderStroke(0.5.dp, if (selected) c.accent.copy(alpha = 0.45f) else (if (c.dark) c.borderSubtle else Color(0x14000000))),
        modifier = modifier
            .height(32.dp)
            .widthIn(max = 160.dp)
            .semantics { contentDescription = accessibilityLabel }
            .clickable(enabled = enabled, onClick = onClick)
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            if (leadingIcon != null) {
                leadingIcon()
            } else if (icon != null) {
                Icon(
                    icon,
                    null,
                    Modifier.size(13.dp),
                    tint = if (selected) c.text else c.textSecondary
                )
            }
            Text(
                label,
                fontSize = 12.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                letterSpacing = (-0.2).sp,
                color = if (selected) c.text else c.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (expandable) {
                Icon(Icons.Outlined.ExpandMore, null, Modifier.size(11.dp), tint = c.textTertiary)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ComposerPicker(title: String, options: List<ComposerOption>, current: String,
    close: () -> Unit, searchable: Boolean = false, custom: Boolean = false, loading: Boolean = false,
    error: String = "", message: String = "", refresh: (() -> Unit)? = null, choose: (String) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val c = Kooyu.colors
    ModalBottomSheet(onDismissRequest = close, containerColor = c.raised, dragHandle = {
        Box(Modifier.padding(vertical = 10.dp).size(width = 36.dp, height = 4.dp).background(c.borderStrong, CircleShape))
    }) {
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).padding(horizontal = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.weight(1f))
                if (refresh != null) IconButton(onClick = refresh, enabled = !loading) { Icon(Icons.Outlined.Refresh, "刷新选项", tint = c.textSecondary) }
                IconButton(onClick = close) { Icon(Icons.Outlined.Close, "关闭", tint = c.textSecondary) }
            }
            if (searchable) OutlinedTextField(query, { query = it }, placeholder = { Text("筛选或输入模型 ID…", fontSize = 14.sp) },
                singleLine = true, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.accent)
            if (error.isNotBlank()) Text(error, color = c.destructive, modifier = Modifier.padding(vertical = 8.dp))
            if (message.isNotBlank()) Text(message, color = c.textSecondary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 8.dp))
            val visible = options.filter { query.isBlank() || (it.label + " " + it.detail + " " + it.value).contains(query.trim(), true) }
            LazyColumn(Modifier.weight(1f, fill = false), contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(visible.distinctBy { it.value }, key = { it.value }) { item ->
                    val isCurrent = item.value == current
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (isCurrent) c.accentTint else androidx.compose.ui.graphics.Color.Transparent,
                        border = if (isCurrent) BorderStroke(0.5.dp, c.accent.copy(alpha = 0.35f)) else null,
                        modifier = Modifier.fillMaxWidth().clickable(enabled = !loading) { choose(item.value) }
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (item.leadingIcon != null) {
                                Box(Modifier.padding(end = 12.dp), contentAlignment = Alignment.Center) {
                                    item.leadingIcon()
                                }
                            }
                            Column(Modifier.weight(1f)) {
                                Text(item.label, color = c.text, fontSize = 14.sp, fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal)
                                if (item.detail.isNotBlank()) Text(item.detail, color = c.textSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                            }
                            if (isCurrent) Icon(Icons.Outlined.Check, "已选择", tint = c.text, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                if (custom && query.isNotBlank() && options.none { it.value == query.trim() }) item {
                    TextButton(onClick = { choose(query.trim()) }, enabled = !loading) { Text("使用模型：${query.trim()}", color = c.accent) }
                }
                if (visible.isEmpty() && !loading && !custom) item { Text("暂无可用选项", color = c.textSecondary, modifier = Modifier.padding(vertical = 20.dp)) }
            }
        }
    }
}

/** Model and effort stay above the input; message actions retain a pinned send button. */
@Composable fun WorkbenchComposer(text: String, change: (String) -> Unit, placeholder: String,
    enabled: Boolean, sendEnabled: Boolean, stop: Boolean = false, stopEnabled: Boolean = enabled,
    submit: () -> Unit, cancel: () -> Unit = {}, attachments: List<ManagedAttachment> = emptyList(),
    remove: (String) -> Unit = {}, uploading: Boolean = false, error: String = "",
    left: @Composable RowScope.() -> Unit, right: @Composable RowScope.() -> Unit) {
    val c = Kooyu.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = right
        )
        Surface(
            shape = RoundedCornerShape(26.dp),
            color = if (c.dark) c.raised else Color(0xFFFAFAFC),
            border = BorderStroke(0.6.dp, if (c.dark) c.borderSubtle else Color(0x18000000)),
            shadowElevation = if (c.dark) 0.dp else 3.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (uploading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.accent)
                if (error.isNotBlank()) Text(error, fontSize = 12.sp, color = c.destructive, modifier = Modifier.padding(8.dp))
                if (attachments.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 6.dp)) {
                    attachments.forEach { file ->
                        InputChip(selected = false, onClick = {}, label = { Text(file.name, maxLines = 1) },
                            trailingIcon = { IconButton(onClick = { remove(file.id) }, enabled = enabled, modifier = Modifier.size(24.dp)) {
                                Icon(Icons.Outlined.Close, "移除 ${file.name}", Modifier.size(14.dp))
                            } }, modifier = Modifier.padding(end = 6.dp))
                    }
                }
                BasicTextField(
                    value = text,
                    onValueChange = change,
                    enabled = enabled,
                    maxLines = 7,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = c.text, fontSize = 15.sp, lineHeight = 22.sp),
                    cursorBrush = SolidColor(c.text),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp, max = 160.dp)
                        .padding(horizontal = 4.dp, vertical = 4.dp)
                        .semantics { contentDescription = "消息" },
                    decorationBox = { input -> Box { if (text.isEmpty()) Text(placeholder, color = c.textTertiary, fontSize = 14.sp); input() } }
                )

                // Message actions scroll independently; send remains reachable.
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        left()
                    }
                    Spacer(Modifier.width(8.dp))
                    val sendActive = if (stop) stopEnabled else sendEnabled
                    val sendColor by animateColorAsState(
                        targetValue = if (sendActive) (if (stop) c.destructive else c.accent) else c.sunken,
                        animationSpec = tween(180),
                        label = "sendColor"
                    )
                    IconButton(
                        onClick = if (stop) cancel else submit,
                        enabled = if (stop) stopEnabled else sendEnabled,
                        modifier = Modifier.size(34.dp)
                    ) {
                        Box(
                            Modifier.size(32.dp).clip(CircleShape).background(sendColor),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                if (stop) Icons.Outlined.Stop else Icons.Outlined.ArrowUpward,
                                contentDescription = if (stop) "停止当前回合" else "发送消息",
                                modifier = Modifier.size(16.dp),
                                tint = if (sendActive) c.onAccent else c.textTertiary
                            )
                        }
                    }
                }
            }
        }
    }

}

@Composable fun ComposerWelcome(title: String, modifier: Modifier = Modifier) {
    val c = Kooyu.colors
    Box(modifier, contentAlignment = Alignment.Center) {
        Image(painterResource(if (c.dark) R.drawable.composer_aura_dark else R.drawable.composer_aura_light), null,
            Modifier.fillMaxWidth().aspectRatio(1f), contentScale = ContentScale.Fit, alpha = if (c.dark) 0.35f else 0.22f)
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(22.dp), modifier = Modifier.padding(24.dp)) {
            Surface(shape = RoundedCornerShape(22.dp), color = c.raised, border = BorderStroke(1.dp, c.borderSubtle)) {
                Image(painterResource(R.drawable.kooyu_mark_coral), "Kooyu", Modifier.padding(16.dp).size(38.dp))
            }
            Text(title, fontFamily = FontFamily.Serif, fontSize = 28.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp, color = c.text, textAlign = TextAlign.Center)
        }
    }
}

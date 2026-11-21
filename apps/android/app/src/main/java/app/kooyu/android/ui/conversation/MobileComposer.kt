package app.kooyu.android.ui.conversation

import app.kooyu.android.*
import app.kooyu.android.ui.components.EngineBadge
import app.kooyu.android.ui.theme.*
import app.kooyu.android.R

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
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
    Box(
        modifier
            .heightIn(min = 34.dp)
            .semantics { contentDescription = accessibilityLabel }
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = if (selected) c.accentTint else c.sunken,
            border = BorderStroke(0.5.dp, if (selected) c.accent.copy(alpha = 0.45f) else c.borderSubtle),
            modifier = Modifier.height(32.dp).widthIn(max = 156.dp)
        ) {
            Row(
                Modifier.padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
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
                    style = KooyuType.label,
                    fontSize = 12.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (selected) c.text else c.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (expandable) {
                    Icon(Icons.Outlined.ExpandMore, null, Modifier.size(12.dp), tint = c.textTertiary)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ComposerPicker(
    title: String,
    options: List<ComposerOption>,
    current: String,
    close: () -> Unit,
    searchable: Boolean = false,
    custom: Boolean = false,
    loading: Boolean = false,
    error: String = "",
    message: String = "",
    refresh: (() -> Unit)? = null,
    headerExtra: (@Composable () -> Unit)? = null,
    choose: (String) -> Unit
) {
    var query by rememberSaveable { mutableStateOf("") }
    val c = Kooyu.colors
    ModalBottomSheet(onDismissRequest = close, containerColor = c.raised, dragHandle = {
        Box(Modifier.padding(vertical = 10.dp).size(width = 36.dp, height = 4.dp).background(c.borderStrong, CircleShape))
    }) {
        Column(Modifier.fillMaxWidth().heightIn(max = 580.dp).padding(horizontal = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.weight(1f))
                if (refresh != null) IconButton(onClick = refresh, enabled = !loading) { Icon(Icons.Outlined.Refresh, "刷新选项", tint = c.textSecondary) }
                IconButton(onClick = close) { Icon(Icons.Outlined.Close, "关闭", tint = c.textSecondary) }
            }
            if (headerExtra != null) {
                headerExtra()
                Spacer(Modifier.height(8.dp))
            }
            if (searchable) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp)
                        .height(42.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(Icons.Outlined.Search, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = KooyuType.label.copy(fontSize = 14.sp, color = c.text),
                        cursorBrush = SolidColor(c.brandCoral),
                        modifier = Modifier.weight(1f),
                        decorationBox = { inner ->
                            if (query.isEmpty()) Text("筛选或输入模型 ID…", fontSize = 14.sp, color = c.textTertiary)
                            inner()
                        }
                    )
                    if (query.isNotEmpty()) IconButton(onClick = { query = "" }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Outlined.Close, "清除搜索", tint = c.textTertiary, modifier = Modifier.size(14.dp))
                    }
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.brandCoral)
            if (error.isNotBlank()) Text(error, color = c.destructive, modifier = Modifier.padding(vertical = 8.dp))
            if (message.isNotBlank()) Text(message, color = c.textSecondary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 8.dp))
            val visible = options.filter { query.isBlank() || (it.label + " " + it.detail + " " + it.value).contains(query.trim(), true) }
            LazyColumn(Modifier.weight(1f, fill = false), contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(visible.distinctBy { it.value }, key = { it.value }) { item ->
                    val isCurrent = item.value == current
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (isCurrent) c.accentTint else Color.Transparent,
                        border = if (isCurrent) BorderStroke(0.5.dp, c.accent.copy(alpha = 0.35f)) else null,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp).clickable(enabled = !loading) { choose(item.value) }
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
                    TextButton(onClick = { choose(query.trim()) }, enabled = !loading) { Text("使用模型：${query.trim()}", color = c.brandCoral) }
                }
                if (visible.isEmpty() && !loading && !custom) item { Text("暂无可用选项", color = c.textSecondary, modifier = Modifier.padding(vertical = 20.dp)) }
            }
        }
    }
}

/**
 * 3-anchor HIG composer: clean growing input surface + bottom `[＋] [模型·思考 ▾] ... (↑)` bar
 * (or optional inline chips row when [onPlus] / [onModelSummaryClick] aren't used).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun MobileComposer(
    text: String,
    change: (String) -> Unit,
    placeholder: String,
    enabled: Boolean,
    sendEnabled: Boolean,
    stop: Boolean = false,
    stopEnabled: Boolean = enabled,
    stopAccessibilityLabel: String = "停止当前回合",
    submit: () -> Unit,
    cancel: () -> Unit = {},
    attachments: List<ManagedAttachment> = emptyList(),
    remove: (String) -> Unit = {},
    uploading: Boolean = false,
    error: String = "",
    focusRequester: FocusRequester? = null,
    minLines: Int = 1,
    onPlus: (() -> Unit)? = null,
    plusCount: Int = 0,
    harnessSummary: String? = null,
    onHarnessClick: (() -> Unit)? = null,
    modelSummary: String? = null,
    onModelSummaryClick: (() -> Unit)? = null,
    modelEnabled: Boolean = true,
    reasoningSummary: String? = null,
    onReasoningClick: (() -> Unit)? = null,
    permissionSummary: String? = null,
    onPermissionClick: (() -> Unit)? = null,
    leadingBadge: (@Composable () -> Unit)? = null,
    chips: (@Composable RowScope.() -> Unit)? = null,
) {
    val c = Kooyu.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val ring by animateColorAsState(if (focused) c.borderStrong else c.border, KooyuMotion.snap(), label = "composerRing")
    val useThreeAnchor = onPlus != null || onModelSummaryClick != null
    val latestText by rememberUpdatedState(text)
    val latestChange by rememberUpdatedState(change)
    val voice = rememberVoiceInputController { spoken ->
        latestChange(appendVoiceTranscript(latestText, spoken))
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!useThreeAnchor && chips != null) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                content = chips
            )
        }
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = c.raised,
            border = BorderStroke(if (focused) 1.5.dp else 0.5.dp, ring),
            shadowElevation = if (c.dark) 0.dp else 2.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 6.dp)) {
                if (uploading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 4.dp), color = c.brandCoral, trackColor = c.borderSubtle)
                if (error.isNotBlank()) Text(error, style = KooyuType.caption, fontSize = 12.sp, color = c.destructive, modifier = Modifier.padding(bottom = 6.dp))
                VoiceListeningStrip(voice)
                if (attachments.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 4.dp)) {
                    attachments.forEach { file ->
                        InputChip(
                            selected = false,
                            onClick = {},
                            label = { Text(file.name, maxLines = 1) },
                            trailingIcon = {
                                IconButton(onClick = { remove(file.id) }, enabled = enabled, modifier = Modifier.size(24.dp)) {
                                    Icon(Icons.Outlined.Close, "移除 ${file.name}", Modifier.size(14.dp))
                                }
                            },
                            modifier = Modifier.padding(end = 6.dp)
                        )
                    }
                }
                if (useThreeAnchor) {
                    BasicTextField(
                        value = text,
                        onValueChange = change,
                        enabled = enabled,
                        minLines = minLines,
                        maxLines = 6,
                        interactionSource = interaction,
                        textStyle = KooyuType.body.copy(color = c.text),
                        cursorBrush = SolidColor(c.brandCoral),
                        modifier = Modifier
                            .fillMaxWidth()
                            .animateContentSize(KooyuMotion.SnapIntSize)
                            .padding(top = 4.dp, bottom = 6.dp, end = 4.dp)
                            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                            .semantics { contentDescription = "消息" },
                        decorationBox = { input ->
                            Box {
                                if (text.isEmpty()) Text(placeholder, style = KooyuType.body, color = c.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                input()
                            }
                        }
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        if (onPlus != null) {
                            Box(
                                Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .kooyuPressable(onClickLabel = "更多选项与附件") { onPlus() }
                                    .semantics { contentDescription = "添加附件与对话设置" },
                                contentAlignment = Alignment.Center
                            ) {
                                BadgedBox(
                                    badge = {
                                        if (plusCount > 0) Badge(containerColor = c.brandCoral, contentColor = Color.White) {
                                            Text(plusCount.toString(), fontSize = 9.sp)
                                        }
                                    }
                                ) {
                                    Box(
                                        Modifier.size(34.dp).clip(CircleShape).background(c.sunken).border(0.5.dp, c.borderSubtle, CircleShape),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(Icons.Outlined.Add, null, tint = c.text, modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                        Row(
                            Modifier
                                .weight(1f)
                                .horizontalScroll(rememberScrollState())
                                .padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            if (onHarnessClick != null && harnessSummary != null) {
                                ComposerPill(
                                    label = harnessSummary,
                                    leadingIcon = leadingBadge,
                                    expandable = true,
                                    accessibilityLabel = "切换执行引擎",
                                    onClick = onHarnessClick
                                )
                            }
                            if (onModelSummaryClick != null) {
                                ComposerPill(
                                    label = modelSummary ?: "原生默认",
                                    icon = if (onHarnessClick != null) Icons.Outlined.Memory else null,
                                    leadingIcon = if (onHarnessClick == null) leadingBadge else null,
                                    expandable = true,
                                    enabled = modelEnabled,
                                    accessibilityLabel = "选择模型",
                                    onClick = onModelSummaryClick
                                )
                            }
                            if (onReasoningClick != null) {
                                ComposerPill(
                                    label = reasoningSummary ?: "默认思考",
                                    icon = Icons.Outlined.Psychology,
                                    expandable = true,
                                    enabled = modelEnabled,
                                    accessibilityLabel = "思考强度",
                                    onClick = onReasoningClick
                                )
                            }
                            if (onPermissionClick != null) {
                                ComposerPill(
                                    label = permissionSummary ?: "默认权限",
                                    icon = Icons.Outlined.Shield,
                                    expandable = true,
                                    enabled = enabled,
                                    accessibilityLabel = "工具权限配置",
                                    onClick = onPermissionClick
                                )
                            }
                        }
                        VoiceMicButton(controller = voice, enabled = enabled)
                        SendMorphButton(
                            stop = stop,
                            active = if (stop) stopEnabled else sendEnabled,
                            accessibilityLabel = stopAccessibilityLabel,
                            onClick = if (stop) cancel else submit
                        )
                    }
                } else {
                    Row(verticalAlignment = Alignment.Bottom) {
                        BasicTextField(
                            value = text,
                            onValueChange = change,
                            enabled = enabled,
                            minLines = minLines,
                            maxLines = 6,
                            interactionSource = interaction,
                            textStyle = KooyuType.body.copy(color = c.text),
                            cursorBrush = SolidColor(c.brandCoral),
                            modifier = Modifier
                                .weight(1f)
                                .animateContentSize(KooyuMotion.SnapIntSize)
                                .padding(top = 6.dp, bottom = 6.dp, end = 8.dp)
                                .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                                .semantics { contentDescription = "消息" },
                            decorationBox = { input ->
                                Box {
                                    if (text.isEmpty()) Text(placeholder, style = KooyuType.body, color = c.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    input()
                                }
                            }
                        )
                        VoiceMicButton(controller = voice, enabled = enabled)
                        SendMorphButton(
                            stop = stop,
                            active = if (stop) stopEnabled else sendEnabled,
                            accessibilityLabel = stopAccessibilityLabel,
                            onClick = if (stop) cancel else submit
                        )
                    }
                }
            }
        }
    }
}

@Composable fun SendMorphButton(
    stop: Boolean,
    active: Boolean,
    accessibilityLabel: String = if (stop) "停止当前回合" else "发送消息",
    onClick: () -> Unit
) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val container by animateColorAsState(if (active) c.accent else c.sunken, KooyuMotion.snap(), label = "sendColor")
    val scale by animateFloatAsState(if (active) 1f else 0.9f, KooyuMotion.MorphFloat, label = "sendScale")
    val corner by animateDpAsState(if (stop) 11.dp else 18.dp, KooyuMotion.morph(), label = "sendCorner")
    val label = if (stop) accessibilityLabel else "发送消息"
    Box(
        Modifier
            .size(44.dp)
            .clickable(enabled = active, role = Role.Button, onClickLabel = label) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center
    ) {
        Box(
            Modifier
                .size(36.dp)
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .clip(RoundedCornerShape(corner))
                .background(container),
            contentAlignment = Alignment.Center
        ) {
            AnimatedContent(stop, transitionSpec = { (fadeIn(KooyuMotion.snap()) + scaleIn(KooyuMotion.morph(), 0.72f)).togetherWith(fadeOut(KooyuMotion.exit())) }, label = "sendIcon") { isStop ->
                Icon(
                    if (isStop) Icons.Filled.Stop else Icons.Outlined.ArrowUpward,
                    null,
                    modifier = Modifier.size(if (isStop) 16.dp else 18.dp),
                    tint = if (active) c.onAccent else c.textTertiary
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun ComposerWelcome(
    title: String,
    modifier: Modifier = Modifier,
    harnessId: String? = null,
    location: String? = null,
    onBadgeClick: (() -> Unit)? = null,
    starters: List<Pair<String, String>> = emptyList(),
    onStarter: ((String) -> Unit)? = null
) {
    val c = Kooyu.colors
    Box(modifier, contentAlignment = Alignment.Center) {
        Image(
            painterResource(if (c.dark) R.drawable.composer_aura_dark else R.drawable.composer_aura_light),
            null,
            Modifier.fillMaxWidth().aspectRatio(1f),
            contentScale = ContentScale.Fit,
            alpha = if (c.dark) 0.22f else 0.12f
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp)
        ) {
            Box(
                Modifier
                    .then(
                        if (onBadgeClick != null) {
                            Modifier
                                .clip(RoundedCornerShape(18.dp))
                                .clickable(onClickLabel = "切换对话引擎", onClick = onBadgeClick)
                        } else Modifier
                    )
            ) {
                EngineBadge(harnessId, 54.dp, circle = false)
            }
            Text(
                title,
                fontSize = 22.sp,
                lineHeight = 29.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.4).sp,
                color = c.text,
                textAlign = TextAlign.Center
            )
            if (!location.isNullOrBlank()) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle)
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        Icon(Icons.Outlined.Folder, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
                        Text(location, fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (starters.isNotEmpty() && onStarter != null) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 4.dp)
                ) {
                    starters.forEach { (label, prompt) ->
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = c.raised,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            shadowElevation = if (c.dark) 0.dp else 0.5.dp,
                            modifier = Modifier.clickable { onStarter(prompt) }
                        ) {
                            Text(
                                label,
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.Medium,
                                color = c.text,
                                modifier = Modifier.padding(horizontal = 13.dp, vertical = 7.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

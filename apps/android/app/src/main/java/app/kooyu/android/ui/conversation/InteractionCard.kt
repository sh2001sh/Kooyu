package app.kooyu.android.ui.conversation

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

private fun inboxPayloadSummary(payload: JSONObject): String {
    val err = payload.opt("error")
    val candidates = listOf(
        payload.optString("message"),
        (err as? JSONObject)?.optString("message") ?: (err as? String ?: ""),
        payload.optString("summary"),
        payload.optString("reason"),
        payload.optString("title"),
    )
    return candidates.firstOrNull { it.isNotBlank() }?.trim().orEmpty()
}

@Composable fun InteractionCard(
    item: InboxItem,
    enabled: Boolean,
    onMarkRead: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
    onApproveIntake: ((String) -> Unit)? = null,
    answer: (NativeAction) -> Unit
) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val isInteraction = item.type == "interaction"
    val form = remember(item.id, item.payload, isInteraction) { if (isInteraction) questionForm(item.payload) else null }
    var confirming by remember(item.id) { mutableStateOf<NativeAction?>(null) }
    var approvedLabel by remember(item.id) { mutableStateOf<String?>(null) }
    var details by remember(item.id) { mutableStateOf(false) }
    var custom by remember(item.id) { mutableStateOf(false) }
    var json by remember(item.id) { mutableStateOf("") }
    var parseError by remember(item.id) { mutableStateOf("") }
    val params = item.payload.optJSONObject("params") ?: item.payload.optJSONObject("input") ?: item.payload
    val command = params.optString("command", params.optString("cmd", ""))
    val path = params.optString("path", params.optString("file", ""))
    val summary = remember(item.id, item.payload) { inboxPayloadSummary(item.payload) }

    val headerIcon = when {
        !isInteraction && item.type == "notification" -> Icons.Outlined.NotificationsNone
        !isInteraction -> Icons.Outlined.ErrorOutline
        form != null -> Icons.AutoMirrored.Outlined.HelpOutline
        else -> Icons.Outlined.Shield
    }
    val headerTint = when {
        approvedLabel != null -> c.doneText
        !isInteraction && item.type != "notification" -> c.destructive
        else -> c.brandCoral
    }
    val headerTitle = when {
        approvedLabel != null -> "已批准 · $approvedLabel"
        !isInteraction && item.type == "limit" -> "托管达到限制"
        !isInteraction && item.type == "notification" -> "会话通知"
        !isInteraction -> "运行需要检查"
        form != null -> params.optString("title").ifBlank { "等待你回答" }
        else -> "等待你确认"
    }

    Surface(
        shape = RoundedCornerShape(18.dp),
        color = c.raised,
        border = BorderStroke(0.5.dp, if (approvedLabel != null) c.doneText.copy(alpha = 0.45f) else c.border),
        shadowElevation = if (c.dark) 0.dp else 1.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(RoundedCornerShape(9.dp))
                        .background(if (approvedLabel != null) c.successTint else if (!isInteraction && item.type != "notification") c.destructiveTint else c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(9.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        headerIcon,
                        null,
                        tint = headerTint,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Text(
                    headerTitle,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (approvedLabel != null) c.doneText else c.text,
                    modifier = Modifier.weight(1f)
                )
            }

            if (command.isNotBlank() || path.isNotBlank()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (c.dark) Color(0xFF111318) else c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 9.dp)
                ) {
                    SelectionContainer {
                        Text(
                            if (command.isNotBlank()) "$ $command" else path,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            lineHeight = 18.sp,
                            color = c.text
                        )
                    }
                }
            }

            if (item.payload.optString("protocol") == "kodo" && form != null && params.optString("detail").isNotBlank()) {
                Text(
                    params.optString("detail"),
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    color = c.textSecondary,
                )
            }

            if (item.payload.optString("protocol") == "kodo" && params.optString("schedule").isNotBlank()) {
                SelectionContainer {
                    Text(
                        params.optString("text"),
                        fontSize = 13.5.sp,
                        lineHeight = 20.sp,
                        color = c.text,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState())
                    )
                }
            }

            if (!isInteraction) {
                if (summary.isNotBlank()) {
                    SelectionContainer {
                        Text(
                            summary,
                            fontSize = 13.5.sp,
                            lineHeight = 20.sp,
                            color = c.text
                        )
                    }
                }
                if (onMarkRead != null || onDelete != null) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (onMarkRead != null) {
                            Button(
                                onClick = onMarkRead,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f).heightIn(min = 42.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = c.sunken, contentColor = c.text)
                            ) {
                                Icon(Icons.Outlined.Done, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("标为已读", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            }
                        }
                        if (onDelete != null) {
                            Button(
                                onClick = onDelete,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f).heightIn(min = 42.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = c.destructiveTint, contentColor = c.destructive)
                            ) {
                                Icon(Icons.Outlined.DeleteOutline, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("删除", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            }
                        }
                    }
                }
            } else if (form != null) {
                NativeQuestionFields(item, form, enabled, answer)
            } else if (item.actions.isEmpty()) {
                if (summary.isNotBlank()) {
                    SelectionContainer {
                        Text(summary, fontSize = 13.5.sp, lineHeight = 20.sp, color = c.text)
                    }
                } else {
                    Text(
                        "此请求没有声明快捷选项，可展开「请求详情」核对后填写结构化回答，或直接标为已读/删除。",
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                        color = c.textSecondary
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val primaryIndex = item.actions.indexOfFirst { !it.destructive }.takeIf { it >= 0 } ?: 0
                    item.actions.forEachIndexed { idx, action ->
                        val isPrimaryAllow = idx == primaryIndex && !action.destructive
                        val isApproved = approvedLabel == action.label
                        Button(
                            onClick = {
                                if (isPrimaryAllow) {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    approvedLabel = action.label
                                    scope.launch {
                                        delay(240)
                                        answer(action)
                                    }
                                } else {
                                    confirming = action
                                }
                            },
                            enabled = enabled && approvedLabel == null,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = when {
                                    isApproved -> c.successTint
                                    action.destructive -> c.destructiveTint
                                    isPrimaryAllow -> c.accent
                                    else -> c.sunken
                                },
                                contentColor = when {
                                    isApproved -> c.doneText
                                    action.destructive -> c.destructive
                                    isPrimaryAllow -> c.onAccent
                                    else -> c.text
                                }
                            )
                        ) {
                            AnimatedContent(
                                isApproved,
                                transitionSpec = { fadeIn(KooyuMotion.snap()).togetherWith(fadeOut(KooyuMotion.snap())) },
                                label = "approveMorph"
                            ) { done ->
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (done || isPrimaryAllow) {
                                        Icon(Icons.Outlined.Check, null, modifier = Modifier.size(16.dp))
                                    }
                                    Text(if (done) "已允许 · ${action.label}" else action.label, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }

            // Compact inline disclosure & quick-dismiss pills (horizontally scrollable so they never wrap awkwardly)
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val intakeEventId = remember(item.id, item.payload) {
                    if (item.payload.optString("type") == "intake-proposal") item.payload.optString("intakeEventId").ifBlank { null } else null
                }
                if (intakeEventId != null && onApproveIntake != null) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = c.brandCoral,
                        modifier = Modifier.clickable(enabled = enabled) { onApproveIntake(intakeEventId) }
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Outlined.PlayArrow, null, tint = Color.White, modifier = Modifier.size(14.dp))
                            Text("批准并派发执行", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                        }
                    }
                }
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (details) c.accentTint else c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.clickable { details = !details }
                ) {
                    Row(Modifier.padding(horizontal = 11.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(Icons.Outlined.Code, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
                        Text(if (details) "收起详情" else "请求详情", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                    }
                }
                if (isInteraction && form == null) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = if (custom) c.accentTint else c.sunken,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.clickable(enabled = enabled) { custom = !custom }
                    ) {
                        Row(Modifier.padding(horizontal = 11.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Outlined.DataObject, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
                            Text("结构化回答", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                        }
                    }
                }
                if (isInteraction && onMarkRead != null) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = c.sunken,
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.clickable { onMarkRead() }
                    ) {
                        Row(Modifier.padding(horizontal = 11.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Outlined.Done, null, tint = c.textSecondary, modifier = Modifier.size(13.dp))
                            Text("标为已读", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                        }
                    }
                }
                if (isInteraction && onDelete != null) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = c.destructiveTint,
                        border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.25f)),
                        modifier = Modifier.clickable { onDelete() }
                    ) {
                        Row(Modifier.padding(horizontal = 11.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Outlined.DeleteOutline, null, tint = c.destructive, modifier = Modifier.size(13.dp))
                            Text("删除", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = c.destructive)
                        }
                    }
                }
            }

            AnimatedVisibility(details) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 200.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (c.dark) Color(0xFF111318) else c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(10.dp))
                        .verticalScroll(rememberScrollState())
                        .padding(11.dp)
                ) {
                    SelectionContainer {
                        Text(item.payload.toString(2), fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, lineHeight = 17.sp, color = c.textSecondary)
                    }
                }
            }

            AnimatedVisibility(custom && form == null) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 72.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.sunken)
                            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                            .padding(12.dp)
                    ) {
                        BasicTextField(
                            value = json,
                            onValueChange = { json = it; parseError = "" },
                            enabled = enabled,
                            textStyle = KooyuType.mono.copy(color = c.text),
                            cursorBrush = SolidColor(c.brandCoral),
                            modifier = Modifier.fillMaxWidth(),
                            decorationBox = { inner ->
                                if (json.isEmpty()) Text("原生回答 JSON…", style = KooyuType.mono, color = c.textTertiary)
                                inner()
                            }
                        )
                    }
                    if (parseError.isNotBlank()) Text(parseError, fontSize = 12.sp, color = c.destructive)
                    Button(
                        onClick = {
                            try { confirming = NativeAction("提交结构化回答", JSONObject(json), false) }
                            catch (_: Exception) { parseError = "JSON 格式无效，请填写原生协议要求的对象。" }
                        },
                        enabled = enabled && json.isNotBlank(),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                    ) { Text("提交回答") }
                }
            }
        }
    }
    confirming?.let { action ->
        ConfirmDialog("确认回应此请求？", "将「${action.label}」提交到当前设备。", action.label, { confirming = null }) {
            confirming = null; answer(action)
        }
    }
}

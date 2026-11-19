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
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
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

@Composable fun InteractionCard(item: InboxItem, enabled: Boolean, answer: (NativeAction) -> Unit) {
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val form = remember(item.id, item.payload) { questionForm(item.payload) }
    var confirming by remember(item.id) { mutableStateOf<NativeAction?>(null) }
    var approvedLabel by remember(item.id) { mutableStateOf<String?>(null) }
    var details by remember(item.id) { mutableStateOf(false) }
    var custom by remember(item.id) { mutableStateOf(false) }
    var json by remember(item.id) { mutableStateOf("") }
    var parseError by remember(item.id) { mutableStateOf("") }
    val params = item.payload.optJSONObject("params") ?: item.payload.optJSONObject("input") ?: item.payload
    val command = params.optString("command", params.optString("cmd", ""))
    val path = params.optString("path", params.optString("file", ""))

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
                        .background(if (approvedLabel != null) c.successTint else c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(9.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (form != null) Icons.Outlined.HelpOutline else Icons.Outlined.Shield,
                        null,
                        tint = if (approvedLabel != null) c.doneText else c.brandCoral,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Text(
                    if (approvedLabel != null) "已批准 · $approvedLabel" else if (form != null) "等待你回答" else "等待你确认",
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

            if (form != null) {
                NativeQuestionFields(item, form, enabled, answer)
            } else if (item.actions.isEmpty()) {
                Text(
                    "此请求没有声明快捷选项，可展开「请求详情」核对后填写结构化回答。",
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    color = c.textSecondary
                )
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

            // Compact inline disclosure pills (replaces clunky stacked unstyled TextButtons!)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
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
                if (form == null) {
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

package app.kooyu.android.ui.home

import app.kooyu.android.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable fun KooyuSheetHandle() {
    Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(width = 36.dp, height = 4.dp).clip(CircleShape).background(Kooyu.colors.textTertiary.copy(alpha = 0.4f)))
    }
}

/**
 * Plan §5.1 A.1: the device pill opens this sheet. Offline it leads with reconnecting; online it
 * is the device switcher. Background polling keeps retrying either way.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ReconnectSheet(state: WorkbenchState, model: Workbench, onDismiss: () -> Unit) {
    val c = Kooyu.colors
    val scope = rememberCoroutineScope()
    var retrying by remember { mutableStateOf(false) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.raised,
        dragHandle = { KooyuSheetHandle() },
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            val connection = state.connection
            Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PulsingDot(if (state.online) c.success else c.info, pulsing = !state.online, size = 8.dp)
                Column(Modifier.weight(1f)) {
                    Text(if (state.online) "已连接" else "离线 · 正在自动重连", style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text)
                    Text(
                        connection?.let { displayDeviceName(it.name) + if (state.online) "" else " 暂时无法访问，请确认电脑端 Kooyu 正在运行。" } ?: "",
                        style = KooyuType.caption, fontSize = 12.sp, color = c.textSecondary
                    )
                }
            }
            if (state.error.isNotBlank()) {
                Text(state.error, style = KooyuType.caption, fontSize = 12.sp, color = c.destructive, modifier = Modifier.padding(horizontal = 4.dp))
            }
            if (!state.online) {
                Button(
                    onClick = { scope.launch { retrying = true; try { model.refresh() } finally { retrying = false } } },
                    enabled = !retrying && !state.busy,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    if (retrying) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = c.onAccent)
                    else Icon(Icons.Outlined.Refresh, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (retrying) "正在重连…" else "立即重连", fontWeight = FontWeight.SemiBold)
                }
            }

            Text("设备", style = KooyuType.sectionHeader, color = c.textTertiary, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
            Surface(shape = RoundedCornerShape(16.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                Column {
                    state.connections.forEachIndexed { idx, item ->
                        val isCurrent = item.hostId == connection?.hostId
                        Row(
                            Modifier.fillMaxWidth().clickable { model.switchDevice(item.hostId); onDismiss() }.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(if (isCurrent) c.accentTint else c.paper), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Computer, null, tint = if (isCurrent) c.text else c.textSecondary, modifier = Modifier.size(18.dp))
                            }
                            Text(displayDeviceName(item.name), style = KooyuType.rowTitle, fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Medium,
                                color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            if (isCurrent) StatusBadge(if (state.online) SessionStatus("当前 · 在线", StatusTone.READY) else SessionStatus("当前 · 离线", StatusTone.RUNNING))
                        }
                        if (idx < state.connections.lastIndex) HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 60.dp))
                    }
                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 60.dp))
                    Row(
                        Modifier.fillMaxWidth().clickable { onDismiss(); model.addDevice(true) }.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(c.paper), contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.QrCodeScanner, null, tint = c.textSecondary, modifier = Modifier.size(18.dp))
                        }
                        Text("配对新设备", style = KooyuType.rowTitle, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
                        Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                    }
                }
            }
            Surface(
                shape = RoundedCornerShape(16.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth().height(48.dp).clickable { onDismiss() }
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("关闭", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                }
            }
        }
    }
}

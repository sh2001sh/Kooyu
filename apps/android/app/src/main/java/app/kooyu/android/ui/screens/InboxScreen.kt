package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.ArrowBackIos
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable internal fun InboxTab(state: WorkbenchState, model: Workbench, showLargeTitle: Boolean = true, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var filter by rememberSaveable { mutableStateOf("pending") }
    var notices by remember { mutableStateOf(emptyList<JSONObject>()) }
    var cursor by remember { mutableIntStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    suspend fun load(after: Int) {
        loading = true
        val page = model.read("/notifications?after=$after&limit=100")
        if (page != null) {
            val next = page.optJSONArray("items")?.objects().orEmpty()
            notices = (if (after == 0) next else notices + next).distinctBy { it.optString("id") }
            cursor = page.optInt("cursor"); hasMore = next.size == 100
        }
        loading = false
    }
    LaunchedEffect(state.connection?.hostId, state.inbox.map { it.id }) { load(0) }
    val c = Kooyu.colors
    val errorSessions = remember(state.sessions) {
        state.sessions.filter { !it.archived && it.runState == "error" }
    }
    val pendingIds = state.inbox.map { it.id }.toSet()
    val resolvedNotices = notices.filter { it.optString("inboxItemId") !in pendingIds }.sortedByDescending { it.optLong("sequence") }

    Column(Modifier.fillMaxSize().background(c.navigator)) {
        if (showLargeTitle) {
            Row(
                Modifier.fillMaxWidth().padding(start = 18.dp, end = 16.dp, top = 6.dp, bottom = 10.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    "待办",
                    fontSize = 30.sp,
                    lineHeight = 35.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.6).sp,
                    color = c.text
                )
                Surface(shape = RoundedCornerShape(999.dp), color = if (state.inbox.isNotEmpty()) c.brandCoralTint else c.raised, border = BorderStroke(0.5.dp, c.borderSubtle)) {
                    Text(
                        if (state.inbox.isNotEmpty()) "${state.inbox.size} 项需处理" else "全部已清空",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (state.inbox.isNotEmpty()) c.brandCoral else c.doneText,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }
        } else {
            Spacer(Modifier.height(10.dp))
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf(
                Triple("pending", "待处理审批", state.inbox.size to if (state.inbox.isNotEmpty()) c.brandCoral else c.text),
                Triple("errors", "运行异常", errorSessions.size to if (errorSessions.isNotEmpty()) c.destructive else c.text),
                Triple("activity", "最近动态", resolvedNotices.size to c.text)
            ).forEach { (key, label, pair) ->
                val (count, accentColor) = pair
                val active = filter == key
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = if (active) c.raised else c.raised.copy(alpha = 0.72f),
                    border = BorderStroke(if (active) 1.dp else 0.5.dp, if (active) c.borderStrong else c.borderSubtle),
                    shadowElevation = if (c.dark || !active) 0.dp else 1.dp,
                    modifier = Modifier.weight(1f).clickable { filter = key }
                ) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(count.toString(), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = accentColor)
                        Text(label, fontSize = 11.5.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium, color = c.textSecondary, maxLines = 1)
                    }
                }
            }
        }
        KooyuSegmentedControl(
            options = listOf(
                SegmentOption("pending", "待处理 (${state.inbox.size})"),
                SegmentOption("errors", "运行异常 (${errorSessions.size})"),
                SegmentOption("activity", "最近动态 (${resolvedNotices.size})")
            ),
            selected = filter,
            onSelect = { filter = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
        )
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            when (filter) {
                "pending" -> {
                    if (state.inbox.isEmpty() && !loading) {
                        item("empty-pending") {
                            InsetGroupCard {
                                Column(
                                    Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 36.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(c.successTint), contentAlignment = Alignment.Center) {
                                        Icon(Icons.Outlined.CheckCircle, null, modifier = Modifier.size(26.dp), tint = c.success)
                                    }
                                    Text("暂无待处理审批", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.text)
                                }
                            }
                        }
                    } else {
                        item("pending-bulk-actions") {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    "共 ${state.inbox.size} 项待处理",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = c.textSecondary
                                )
                                Surface(
                                    shape = RoundedCornerShape(999.dp),
                                    color = c.raised,
                                    border = BorderStroke(0.5.dp, c.borderSubtle),
                                    modifier = Modifier.clickable(enabled = state.online) {
                                        scope.launch { model.markAllInboxRead() }
                                    }
                                ) {
                                    Row(
                                        Modifier.padding(horizontal = 11.dp, vertical = 5.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Icon(Icons.Outlined.DoneAll, null, tint = c.textSecondary, modifier = Modifier.size(14.dp))
                                        Text("全部已读", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                    }
                                }
                            }
                        }
                        items(state.inbox, key = { "pending:" + it.id }) { item ->
                            val session = state.sessions.firstOrNull { it.id == item.sessionId }
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        session?.title ?: "对话请求",
                                        style = KooyuType.sectionHeader,
                                        color = c.textSecondary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    TextButton(onClick = { open(item.sessionId) }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                                        Text("进入对话 →", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.brandCoral)
                                    }
                                }
                                InteractionCard(
                                    item = item,
                                    enabled = state.canWrite,
                                    onMarkRead = { scope.launch { model.markInboxRead(item.id) } },
                                    onDelete = { scope.launch { model.deleteInboxItem(item.id) } },
                                    onApproveIntake = { eventId ->
                                        scope.launch {
                                            model.execute("/intake/$eventId/approve", "POST", JSONObject())
                                        }
                                    },
                                ) { action -> scope.launch { model.answer(item, action) } }
                            }
                        }
                    }
                }
                "errors" -> {
                    if (errorSessions.isEmpty()) {
                        item("empty-errors") {
                            Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Icon(Icons.Outlined.CheckCircleOutline, null, modifier = Modifier.size(52.dp), tint = c.success)
                                    Text("暂无运行异常对话", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = c.text)
                                }
                            }
                        }
                    } else {
                        items(errorSessions, key = { "err:" + it.id }) { session ->
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = c.raised,
                                border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.35f)),
                                modifier = Modifier.fillMaxWidth().clickable { open(session.id) }
                            ) {
                                Row(Modifier.padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(c.destructiveTint), contentAlignment = Alignment.Center) {
                                        Icon(Icons.Outlined.WarningAmber, null, tint = c.destructive, modifier = Modifier.size(18.dp))
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(session.title.ifBlank { "未命名对话" }, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = c.text)
                                        Text("${harnessVisual(session.harnessId).name} · 点击查看失败详情", fontSize = 12.sp, color = c.destructive)
                                    }
                                    Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
                else -> {
                    if (resolvedNotices.isEmpty() && !loading) {
                        item("empty-activity") {
                            Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Icon(Icons.Outlined.NotificationsNone, null, modifier = Modifier.size(52.dp), tint = c.textTertiary)
                                    Text("暂无最近动态", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = c.text)
                                }
                            }
                        }
                    } else {
                        items(resolvedNotices, key = { "notice:" + it.getString("id") }) { notice ->
                            val sessionId = notice.nullableString("sessionId")
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = c.raised,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.fillMaxWidth().clickable(enabled = sessionId != null) {
                                    scope.launch {
                                        model.execute("/notifications/${encoded(notice.getString("id"))}/read")
                                        if (sessionId != null) open(sessionId)
                                    }
                                }
                            ) {
                                Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.NotificationsNone, null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(notice.optString("title"), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.text)
                                        Text(state.sessions.firstOrNull { it.id == sessionId }?.title ?: notice.optString("createdAt"), fontSize = 11.5.sp, color = c.textSecondary)
                                    }
                                    if (sessionId != null) Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
            }
            if (loading) item("loading") { LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.brandCoral) }
            if (hasMore && filter == "activity") item("more") {
                TextButton(onClick = { scope.launch { load(cursor) } }, enabled = !loading) { Text("加载更多通知", color = c.brandCoral) }
            }
        }
    }
}

package app.kooyu.android.ui.home

import app.kooyu.android.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.screens.*

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

enum class HomeGrouping { RECENT, PROJECT, HARNESS }

/** The global Kooyu supervisor shown as the pinned top conversation row. */
fun commanderSession(sessions: List<HostSession>): HostSession? =
    sessions.filter { !it.archived && it.kind == "supervisor" && it.projectId == null && it.harnessId in listOf("kodo", "kooyu") }
        .maxByOrNull { it.createdAt ?: "" }

data class SessionGroup(val key: String, val title: String, val projectId: String?, val harnessId: String?, val sessions: List<HostSession>)

/** Group sessions into a flat chronological list, by project, or by harness engine. */
fun groupSessions(
    visible: List<HostSession>,
    grouping: HomeGrouping,
    projects: List<Pair<String, String>>,
    harnesses: List<HostHarness>,
    includeEmptyProjects: Boolean,
): List<SessionGroup> = when (grouping) {
    HomeGrouping.RECENT -> {
        if (visible.isEmpty()) emptyList()
        else listOf(SessionGroup("recent:all", "全部对话", null, null, visible))
    }
    HomeGrouping.PROJECT -> {
        val known = projects.distinctBy { it.first }
        val orphanIds = visible.mapNotNull { it.projectId }.filter { id -> known.none { it.first == id } }.distinct()
        (listOf("" to "全局对话") + known + orphanIds.map { it to "未归属项目" }).map { (id, name) ->
            SessionGroup("project:$id", name, id, null, visible.filter { (it.projectId ?: "") == id })
        }.filter { it.sessions.isNotEmpty() || (includeEmptyProjects && it.projectId != "") }
    }
    HomeGrouping.HARNESS -> {
        val order = harnesses.map { it.id }
        visible.groupBy { if (it.harnessId == "kooyu") "kodo" else it.harnessId }
            .entries
            .sortedWith(compareBy({ order.indexOf(it.key).let { i -> if (i < 0) Int.MAX_VALUE else i } }, { it.key }))
            .map { (id, list) ->
                SessionGroup("harness:$id", harnesses.firstOrNull { it.id == id }?.name ?: harnessVisual(id).name, null, id, list)
            }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun SessionActionSheet(
    session: HostSession,
    canWrite: Boolean,
    onDismiss: () -> Unit,
    onPin: () -> Unit,
    onRename: () -> Unit,
    onArchive: () -> Unit,
    onDelete: () -> Unit
) {
    val c = Kooyu.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.raised,
        dragHandle = { KooyuSheetHandle() },
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(session.title.ifBlank { "未命名会话" }, style = KooyuType.pageTitle, fontSize = 17.sp, color = c.text, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 4.dp))
            Surface(shape = RoundedCornerShape(16.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                Column {
                    @Composable fun Action(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color, action: () -> Unit) {
                        Row(
                            Modifier.fillMaxWidth().clickable(enabled = canWrite) { action(); onDismiss() }.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
                            Text(label, style = KooyuType.rowTitle, fontWeight = FontWeight.Medium, color = if (tint == c.destructive) c.destructive else c.text, modifier = Modifier.weight(1f))
                        }
                    }
                    Action(Icons.Outlined.PushPin, if (session.pinned) "取消置顶" else "置顶会话", c.textSecondary, onPin)
                    InsetDivider(48)
                    Action(Icons.Outlined.Edit, "重命名", c.textSecondary, onRename)
                    InsetDivider(48)
                    Action(if (session.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, if (session.archived) "恢复会话" else "归档会话", c.textSecondary, onArchive)
                    InsetDivider(48)
                    Action(Icons.Outlined.Delete, "删除会话", c.destructive, onDelete)
                }
            }
            Surface(shape = RoundedCornerShape(16.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth().height(48.dp).clickable { onDismiss() }) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("取消", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text) }
            }
        }
    }
}

/**
 * Compact pinned row for `Kooyu 主对话` (Telegram/Linear/Claude pinned assistant style):
 * replaces the tall 148dp hero banner so actual conversations start right at the top of the screen!
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable private fun PinnedCommanderRow(
    session: HostSession?,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null
) {
    val c = Kooyu.colors
    val status = session?.let(::sessionStatus) ?: SessionStatus("就绪", StatusTone.READY)
    val stamp = relativeTime(session?.createdAt)
    InsetGroupCard(Modifier.padding(horizontal = 16.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClickLabel = "打开 Kooyu 主对话",
                    onClick = onClick,
                    onLongClick = onLongClick
                )
                .padding(horizontal = 13.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp)
        ) {
            EngineBadge("kodo", 36.dp, circle = false)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "Kooyu 主对话",
                        style = KooyuType.rowTitle,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = c.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Surface(
                        shape = RoundedCornerShape(5.dp),
                        color = c.sunken,
                        border = BorderStroke(0.5.dp, c.borderSubtle)
                    ) {
                        Text(
                            "全局主控",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = c.textSecondary,
                            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (stamp.isNotEmpty()) {
                        Text(stamp, style = KooyuType.caption, fontSize = 11.5.sp, color = c.textTertiary)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusBadge(status)
                }
            }
        }
    }
}

/**
 * Conversation-First Home Screen:
 * Compact search + filter pills (`最近对话 | 按项目 | 按引擎 | 归档`), pinned 1-row `Kooyu 主对话`,
 * and immediate high-density conversation list occupying 80%+ of the viewport!
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun HomeScreen(
    state: WorkbenchState,
    model: Workbench,
    create: (projectId: String, harnessId: String?, initialPrompt: String) -> Unit
) {
    var workProject by remember { mutableStateOf<String?>(null) }
    var workTab by remember { mutableStateOf("工作记录") }
    if (workProject != null) WorkHubScreen(state, model, workProject!!, workTab) { workProject = null }
    var search by rememberSaveable { mutableStateOf("") }
    var archived by rememberSaveable { mutableStateOf(false) }
    var activeOnly by rememberSaveable { mutableStateOf(false) }
    var grouping by rememberSaveable { mutableStateOf(HomeGrouping.RECENT) }
    var collapsed by rememberSaveable { mutableStateOf(listOf<String>()) }
    var editing by remember { mutableStateOf<HostSession?>(null) }
    var title by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<HostSession?>(null) }
    var activeActionSession by remember { mutableStateOf<HostSession?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val c = Kooyu.colors

    val commander = commanderSession(state.sessions)
    val query = search.trim()
    val visible = state.sessions
        .filter { it.archived == archived && (archived || it.id != commander?.id) }
        .filter { !activeOnly || it.runState == "running" || it.runState == "waiting-input" }
        .filter { s ->
            query.isEmpty() || s.title.contains(query, true) ||
                (state.projects.firstOrNull { it.first == s.projectId }?.second?.contains(query, true) == true) ||
                (state.harnesses.firstOrNull { it.id == s.harnessId }?.name ?: harnessVisual(s.harnessId).name).contains(query, true)
        }
        .sortedWith(compareByDescending<HostSession> { it.pinned }.thenByDescending { it.createdAt ?: "" })
    val mostRecent = if (archived) null else visible.maxByOrNull { it.createdAt ?: "" }?.id
    val groups = groupSessions(visible, grouping, state.projects, state.harnesses, includeEmptyProjects = query.isEmpty() && !archived)
    val archivedCount = state.sessions.count { it.archived }
    val runningCount = state.sessions.count { !it.archived && (it.runState == "running" || it.runState == "waiting-input") }

    val pullState = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            scope.launch { refreshing = true; try { model.refresh() } finally { refreshing = false } }
        },
        state = pullState,
        modifier = Modifier.fillMaxSize().background(c.navigator),
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pullState,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                color = c.brandCoral,
                containerColor = c.raised
            )
        }
    ) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 6.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item("search-and-filters") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SearchBarCompact(search, { search = it })
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val filterItems = listOf(
                            HomeGrouping.RECENT to "全部对话",
                            HomeGrouping.PROJECT to "按项目",
                            HomeGrouping.HARNESS to "按引擎"
                        )
                        filterItems.forEach { (mode, label) ->
                            val selected = !archived && !activeOnly && grouping == mode
                            Surface(
                                shape = RoundedCornerShape(999.dp),
                                color = if (selected) c.accent else c.raised,
                                border = BorderStroke(0.5.dp, if (selected) c.accent else c.borderSubtle),
                                modifier = Modifier.kooyuPressable(onClickLabel = label) {
                                    archived = false
                                    activeOnly = false
                                    grouping = mode
                                }
                            ) {
                                Text(
                                    label,
                                    fontSize = 12.sp,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                    color = if (selected) c.onAccent else c.textSecondary,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                )
                            }
                        }
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = if (archived) c.accent else c.raised,
                            border = BorderStroke(0.5.dp, if (archived) c.accent else c.borderSubtle),
                            modifier = Modifier.kooyuPressable(onClickLabel = "归档对话") {
                                activeOnly = false
                                archived = !archived
                            }
                        ) {
                            Text(
                                if (archivedCount > 0) "已归档 $archivedCount" else "已归档",
                                fontSize = 12.sp,
                                fontWeight = if (archived) FontWeight.Bold else FontWeight.Medium,
                                color = if (archived) c.onAccent else c.textSecondary,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                            )
                        }
                        if (runningCount > 0 || activeOnly) {
                            Surface(
                                shape = RoundedCornerShape(999.dp),
                                color = if (activeOnly) c.info else c.infoTint,
                                border = BorderStroke(0.5.dp, if (activeOnly) c.info else c.info.copy(alpha = 0.28f)),
                                modifier = Modifier.kooyuPressable(onClickLabel = "仅查看活跃会话") {
                                    archived = false
                                    activeOnly = !activeOnly
                                }
                            ) {
                                Row(
                                    Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                                ) {
                                    PulsingDot(if (activeOnly) Color.White else c.info, pulsing = runningCount > 0)
                                    Text(
                                        "$runningCount 活跃",
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (activeOnly) Color.White else c.info
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (!archived && query.isEmpty()) {
                item("commander-pinned") {
                    Box(Modifier.animateItem(placementSpec = KooyuMotion.BaseIntOffset)) {
                        PinnedCommanderRow(
                            session = commander,
                            onClick = { if (commander != null) model.select(commander.id) else create("", "kodo", "") },
                            onLongClick = commander?.let { cmd -> { activeActionSession = cmd } }
                        )
                    }
                }
            }

            if (visible.isEmpty() && groups.isEmpty()) {
                item("empty") {
                    InsetGroupCard(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Box(
                                Modifier.size(44.dp).clip(RoundedCornerShape(13.dp)).background(c.sunken),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(if (query.isEmpty()) Icons.Outlined.Forum else Icons.Outlined.SearchOff, null, modifier = Modifier.size(22.dp), tint = c.textSecondary)
                            }
                            Text(
                                if (query.isNotEmpty()) "没有匹配「$query」的会话" else if (archived) "暂无已归档会话" else "还没有对话记录",
                                style = KooyuType.rowTitle,
                                fontSize = 15.sp,
                                color = c.text
                            )
                            if (!archived && query.isEmpty()) {
                                Text("点击右上角「新建」选择引擎或项目即可开始对话。", style = KooyuType.caption, fontSize = 12.5.sp, color = c.textSecondary)
                            }
                        }
                    }
                }
            }

            if (grouping == HomeGrouping.RECENT) {
                if (visible.isNotEmpty()) {
                    item("recent-stream-card") {
                        InsetGroupCard(Modifier.padding(horizontal = 16.dp)) {
                            visible.forEachIndexed { index, s ->
                                key(s.id) {
                                    val projLabel = state.projects.firstOrNull { it.first == s.projectId }?.second
                                    val engineOrModel = s.model?.substringAfterLast('/')
                                        ?: (state.harnesses.firstOrNull { it.id == s.harnessId }?.name?.substringBefore(" · ") ?: harnessVisual(s.harnessId).name)
                                    val detail = if (!projLabel.isNullOrBlank()) "$projLabel · $engineOrModel" else engineOrModel
                                    SwipeableSessionRow(
                                        session = s,
                                        enabled = state.canWrite,
                                        onPin = { scope.launch { model.updateSession(s.id, JSONObject().put("pinned", !s.pinned)) } },
                                        onArchive = { scope.launch { model.updateSession(s.id, JSONObject().put("archived", !s.archived)) } },
                                        onDelete = { deleting = s }
                                    ) {
                                        SessionRow(
                                            session = s,
                                            detail = detail,
                                            marked = state.selected == null && s.id == mostRecent,
                                            selected = state.selected == s.id,
                                            onClick = { model.select(s.id) },
                                            onLongClick = { activeActionSession = s }
                                        )
                                    }
                                    if (index < visible.lastIndex) InsetDivider()
                                }
                            }
                        }
                    }
                }
            } else {
                itemsIndexed(groups, key = { _, g -> g.key }) { _, group ->
                    val isCollapsed = group.key in collapsed && query.isEmpty()
                    Column(Modifier.animateItem(placementSpec = KooyuMotion.BaseIntOffset)) {
                        val active = group.sessions.count { it.runState == "running" || it.runState == "waiting-input" }
                        SessionGroupHeader(
                            title = group.title,
                            count = group.sessions.size,
                            collapsed = isCollapsed,
                            onToggle = { collapsed = if (group.key in collapsed) collapsed - group.key else collapsed + group.key },
                            leading = group.harnessId?.let { id -> { EngineBadge(id, 18.dp, circle = false) } },
                            meta = if (group.harnessId != null && active > 0) "$active 活跃" else null,
                        ) {
                            if (group.projectId != null) {
                                if (group.projectId.isNotEmpty()) IconButton(onClick = { workTab = "项目概览"; workProject = group.projectId }, modifier = Modifier.size(40.dp)) {
                                    Icon(Icons.Outlined.Topic, "${group.title} 项目概览", tint = c.textTertiary, modifier = Modifier.size(16.dp))
                                }
                                IconButton(onClick = { create(group.projectId, null, "") }, enabled = state.canWrite, modifier = Modifier.size(40.dp)) {
                                    Icon(Icons.Outlined.Add, "在 ${group.title} 新建对话", tint = c.textSecondary, modifier = Modifier.size(17.dp))
                                }
                            } else if (group.harnessId != null) {
                                IconButton(onClick = { create("", group.harnessId, "") }, enabled = state.canWrite, modifier = Modifier.size(40.dp)) {
                                    Icon(Icons.Outlined.Add, "用 ${group.title} 新建对话", tint = c.textSecondary, modifier = Modifier.size(17.dp))
                                }
                            }
                        }
                        AnimatedVisibility(
                            visible = !isCollapsed && group.sessions.isNotEmpty(),
                            enter = expandVertically(KooyuMotion.BaseIntSize) + fadeIn(KooyuMotion.base()),
                            exit = shrinkVertically(KooyuMotion.BaseIntSize) + fadeOut(KooyuMotion.snap())
                        ) {
                            InsetGroupCard(Modifier.padding(horizontal = 16.dp)) {
                                group.sessions.forEachIndexed { index, s ->
                                    key(s.id) {
                                        val detail = when (grouping) {
                                            HomeGrouping.PROJECT -> s.model?.substringAfterLast('/') ?: (state.harnesses.firstOrNull { it.id == s.harnessId }?.name ?: harnessVisual(s.harnessId).name)
                                            HomeGrouping.HARNESS -> state.projects.firstOrNull { it.first == s.projectId }?.second ?: s.model?.substringAfterLast('/') ?: "全局对话"
                                            HomeGrouping.RECENT -> ""
                                        }
                                        SwipeableSessionRow(
                                            session = s,
                                            enabled = state.canWrite,
                                            onPin = { scope.launch { model.updateSession(s.id, JSONObject().put("pinned", !s.pinned)) } },
                                            onArchive = { scope.launch { model.updateSession(s.id, JSONObject().put("archived", !s.archived)) } },
                                            onDelete = { deleting = s }
                                        ) {
                                            SessionRow(
                                                session = s,
                                                detail = detail,
                                                marked = state.selected == null && s.id == mostRecent,
                                                selected = state.selected == s.id,
                                                onClick = { model.select(s.id) },
                                                onLongClick = { activeActionSession = s }
                                            )
                                        }
                                        if (index < group.sessions.lastIndex) InsetDivider()
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    activeActionSession?.let { s ->
        SessionActionSheet(
            session = s,
            canWrite = state.canWrite,
            onDismiss = { activeActionSession = null },
            onPin = { scope.launch { model.updateSession(s.id, JSONObject().put("pinned", !s.pinned)) } },
            onRename = { editing = s; title = s.title },
            onArchive = { scope.launch { model.updateSession(s.id, JSONObject().put("archived", !s.archived)) } },
            onDelete = { deleting = s }
        )
    }
    editing?.let { s ->
        AlertDialog(
            onDismissRequest = { editing = null },
            shape = RoundedCornerShape(20.dp),
            containerColor = c.raised,
            title = { Text("重命名对话", style = KooyuType.pageTitle, fontSize = 17.sp) },
            text = {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.sunken)
                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart
                ) {
                    BasicTextField(
                        value = title,
                        onValueChange = { title = it.take(200) },
                        singleLine = true,
                        textStyle = KooyuType.body.copy(color = c.text),
                        cursorBrush = SolidColor(c.brandCoral),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { scope.launch { if (model.updateSession(s.id, JSONObject().put("title", title.trim())) != null) editing = null } },
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                    enabled = title.isNotBlank() && state.canWrite
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消", color = c.textSecondary) } }
        )
    }
    deleting?.let { s ->
        ConfirmDialog("删除会话", "确认删除「" + s.title + "」？此操作无法撤销。", "删除", { deleting = null }) {
            scope.launch { if (model.deleteSession(s.id)) deleting = null }
        }
    }
}

/** Slim 38dp Spotlight search bar so conversations stay front and center. */
@Composable private fun SearchBarCompact(value: String, change: (String) -> Unit) {
    val c = Kooyu.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .height(38.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(c.raised)
            .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
            .padding(start = 12.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(Icons.Outlined.Search, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
        BasicTextField(
            value = value,
            onValueChange = change,
            singleLine = true,
            textStyle = KooyuType.label.copy(color = c.text, fontSize = 13.5.sp),
            cursorBrush = SolidColor(c.text),
            modifier = Modifier.weight(1f).semantics { contentDescription = "搜索会话" },
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text("搜索会话、项目或引擎…", style = KooyuType.label, fontSize = 13.5.sp, color = c.textTertiary, maxLines = 1)
                    }
                    inner()
                }
            }
        )
        if (value.isNotEmpty()) {
            IconButton(onClick = { change("") }, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Outlined.Close, "清除搜索", tint = c.textTertiary, modifier = Modifier.size(14.dp))
            }
        }
    }
}

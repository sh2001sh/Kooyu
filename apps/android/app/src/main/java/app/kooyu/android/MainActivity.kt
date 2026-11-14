package app.kooyu.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KooyuTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    KooyuScreen()
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun KooyuScreen(model: Workbench = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var creating by rememberSaveable(state.connection?.hostId) { mutableStateOf(false) }
    var devices by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }

    LaunchedEffect(state.connection?.token, state.selected) {
        val token = state.connection?.token
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            try { while (true) { model.refresh(); delay(2000) } } finally { model.suspended(token) }
        }
    }

    BackHandler(enabled = state.selected != null && tab == 0) { model.select(null) }

    BoxWithConstraints {
        val expanded = maxWidth >= 600.dp
        val split = maxWidth >= 840.dp
        Row(Modifier.fillMaxSize()) {
            if (state.connection != null && expanded) {
                NavigationRail(
                    modifier = Modifier.fillMaxHeight(),
                    containerColor = MaterialTheme.colorScheme.surfaceContainer
                ) {
                    Destinations(tab, state.inbox.size, true) { tab = it }
                }
            }
            Scaffold(
                modifier = Modifier.weight(1f),
                topBar = {
                    TopAppBar(
                        colors = TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                            titleContentColor = MaterialTheme.colorScheme.onSurface
                        ),
                        title = {
                            if (state.connection == null) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(28.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(MaterialTheme.colorScheme.primary),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text("K", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                    }
                                    Spacer(Modifier.width(10.dp))
                                    Text("Kooyu", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                                }
                            } else {
                                Box {
                                    Surface(
                                        shape = RoundedCornerShape(20.dp),
                                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                        modifier = Modifier.clickable(enabled = !state.busy) { devices = true }
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .size(8.dp)
                                                    .clip(CircleShape)
                                                    .background(if (state.online) Color(0xFF30A46C) else Color(0xFFE5484D))
                                            )
                                            Text(
                                                state.connection!!.name,
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.SemiBold,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Icon(Icons.Outlined.ExpandMore, "切换电脑", modifier = Modifier.size(18.dp))
                                        }
                                    }
                                    DropdownMenu(devices, { devices = false }) {
                                        state.connections.forEach { c ->
                                            DropdownMenuItem(
                                                leadingIcon = { Icon(Icons.Outlined.Computer, null) },
                                                text = {
                                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                        Text(c.name)
                                                        if (c.hostId == state.connection?.hostId) {
                                                            Text("· 当前", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                                                        }
                                                    }
                                                },
                                                onClick = { model.switchDevice(c.hostId); devices = false }
                                            )
                                        }
                                        HorizontalDivider()
                                        DropdownMenuItem(
                                            leadingIcon = { Icon(Icons.Outlined.Add, null) },
                                            text = { Text("添加电脑") },
                                            onClick = { devices = false; model.addDevice(true) }
                                        )
                                    }
                                }
                            }
                        },
                        navigationIcon = {
                            if (tab == 0 && state.selected != null && !split) {
                                IconButton(onClick = { model.select(null) }) {
                                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回会话列表")
                                }
                            }
                        },
                        actions = {
                            if (state.connection != null) {
                                IconButton(onClick = { scope.launch { model.refresh(); if (tab == 3) model.refreshUsage() } }) {
                                    Icon(Icons.Outlined.Refresh, "刷新数据")
                                }
                                if (tab == 0) {
                                    FilledTonalIconButton(
                                        onClick = { creating = true },
                                        enabled = state.canWrite
                                    ) {
                                        Icon(Icons.Outlined.Edit, "新建对话")
                                    }
                                }
                            }
                        }
                    )
                },
                bottomBar = {
                    if (state.connection != null && !expanded) {
                        NavigationBar(
                            containerColor = MaterialTheme.colorScheme.surfaceContainer,
                            tonalElevation = 2.dp
                        ) {
                            Destinations(tab, state.inbox.size, false) { tab = it }
                        }
                    }
                }
            ) { padding ->
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .imePadding()
                ) {
                    if (state.error.isNotBlank() || (state.connection != null && !state.online)) {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 6.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(Icons.Outlined.Warning, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                                Text(
                                    state.error.ifEmpty { "电脑暂时离线，新的操作已暂停" },
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                    if (state.connection?.pending != null) {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 4.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Outlined.Info, null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("此电脑有操作结果待核对", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                TextButton(onClick = { clearing = true }) { Text("核对后清除") }
                            }
                        }
                    }
                    if (state.connection == null) {
                        PairScreen(state.busy) { address, code, name -> scope.launch { model.pair(address, code, name) } }
                        if (state.error.isNotBlank()) {
                            TextButton(
                                onClick = model::clearDamagedConnections,
                                modifier = Modifier.align(Alignment.CenterHorizontally)
                            ) {
                                Text("清除损坏的本机连接")
                            }
                        }
                    } else key(state.connection!!.hostId) {
                        when (tab) {
                            1 -> ProjectsScreen(state, model)
                            2 -> InboxTab(state, model)
                            3 -> Box(Modifier.weight(1f)) { UsageScreen(state, model) }
                            4 -> SettingsScreen(state, model)
                            else -> if (split) {
                                Row(Modifier.weight(1f).fillMaxWidth()) {
                                    Box(Modifier.width(340.dp).fillMaxHeight()) { SessionList(state, model) }
                                    VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                    Box(Modifier.weight(1f).fillMaxHeight()) {
                                        if (state.selected == null) {
                                            EmptyConversationPlaceholder()
                                        } else {
                                            Conversation(state, model)
                                        }
                                    }
                                }
                            } else {
                                if (state.selected == null) {
                                    SessionList(state, model)
                                } else {
                                    Conversation(state, model)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating && state.connection != null) SessionComposer(state, model) { creating = false; tab = 0 }
    if (state.addingDevice && state.connection != null) {
        FullScreenPage("添加电脑", { model.addDevice(false) }) { padding ->
            Column(Modifier.padding(padding)) {
                if (state.error.isNotBlank()) {
                    Text(state.error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
                }
                PairScreen(state.busy) { address, code, name -> scope.launch { model.pair(address, code, name) } }
            }
        }
    }
    if (clearing) {
        ConfirmDialog(
            "已核对电脑上的会话？",
            "仅清除此电脑的本机标记，不会撤销或重发原操作。",
            "已核对",
            { clearing = false }
        ) { clearing = false; runCatching { model.clearPending() } }
    }
}

@Composable private fun Destinations(tab: Int, count: Int, rail: Boolean, select: (Int) -> Unit) {
    val labels = listOf("会话", "项目", "待处理", "用量", "设置")
    val icons = listOf(Icons.Outlined.ChatBubbleOutline, Icons.Outlined.FolderOpen, Icons.Outlined.Inbox, Icons.Outlined.BarChart, Icons.Outlined.Settings)
    val selectedIcons = listOf(Icons.AutoMirrored.Outlined.Chat, Icons.Outlined.Folder, Icons.Outlined.MoveToInbox, Icons.Outlined.InsertChart, Icons.Outlined.Settings)

    @Composable fun IconFor(index: Int) {
        BadgedBox(badge = {
            if (index == 2 && count > 0) {
                Badge(containerColor = MaterialTheme.colorScheme.primary) {
                    Text(count.toString(), fontWeight = FontWeight.Bold)
                }
            }
        }) {
            Icon(if (tab == index) selectedIcons[index] else icons[index], labels[index])
        }
    }

    if (rail) {
        labels.forEachIndexed { i, label ->
            NavigationRailItem(
                selected = tab == i,
                onClick = { select(i) },
                icon = { IconFor(i) },
                label = { Text(label) }
            )
        }
    } else {
        Row(Modifier.fillMaxWidth()) {
            labels.forEachIndexed { i, label ->
                NavigationBarItem(
                    selected = tab == i,
                    onClick = { select(i) },
                    icon = { IconFor(i) },
                    label = { Text(label, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Normal) }
                )
            }
        }
    }
}

@Composable private fun InboxTab(state: WorkbenchState, model: Workbench) {
    val scope = rememberCoroutineScope()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        if (state.inbox.isEmpty()) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(top = 64.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.CheckCircle, null, modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.tertiary)
                        Text("暂无待处理事项", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text("所有任务运行顺畅，无需审批或人工交互", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        } else {
            items(state.inbox, key = { it.id }) { item ->
                InteractionCard(item, state.canWrite) { action ->
                    scope.launch { model.answer(item, action) }
                }
            }
        }
    }
}

@Composable private fun EmptyConversationPlaceholder() {
    Box(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Outlined.Forum, null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.outline)
            Text("选择一个会话", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("从左侧选择会话，或点击右上角「新建对话」开启新任务。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable fun HarnessBadge(harnessId: String, name: String? = null) {
    val v = harnessVisual(harnessId)
    val dark = Kooyu.colors.dark
    Row(Modifier.clip(RoundedCornerShape(6.dp)).background(if (dark) v.darkTint else v.tint).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(v.monogram, color = if (dark) v.darkInk else v.ink, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        Text(name ?: v.name, color = if (dark) v.darkInk else v.ink, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable private fun SessionList(state: WorkbenchState, model: Workbench) {
    var search by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf("") }
    var archived by rememberSaveable { mutableStateOf(false) }
    var editing by remember { mutableStateOf<HostSession?>(null) }
    var title by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<HostSession?>(null) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxHeight()) {
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            placeholder = { Text("搜索对话标题…") },
            leadingIcon = { Icon(Icons.Outlined.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
            trailingIcon = {
                if (search.isNotEmpty()) {
                    IconButton(onClick = { search = "" }) {
                        Icon(Icons.Outlined.Close, "清除搜索")
                    }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.weight(1f)) {
                ChoiceField(
                    label = "项目",
                    value = project,
                    options = listOf("" to "全部项目", "global" to "全局会话") + state.projects
                ) { project = it }
            }
            FilterChip(
                selected = !archived,
                onClick = { archived = false },
                label = { Text("进行中") },
                shape = RoundedCornerShape(10.dp)
            )
            FilterChip(
                selected = archived,
                onClick = { archived = true },
                label = { Text("已归档") },
                shape = RoundedCornerShape(10.dp)
            )
        }

        val visible = state.sessions
            .filter {
                it.archived == archived &&
                it.title.contains(search, true) &&
                (project.isEmpty() || if (project == "global") it.projectId == null else it.projectId == project)
            }
            .sortedByDescending { it.pinned }

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            if (visible.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 48.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.SearchOff, null, modifier = Modifier.size(44.dp), tint = MaterialTheme.colorScheme.outline)
                            Text("暂无匹配会话", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text("点击右上角「新建对话」开启新任务", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            items(visible, key = { it.id }) { s ->
                val isSelected = state.selected == s.id
                var menuExpanded by remember { mutableStateOf(false) }

                val c = Kooyu.colors
                Surface(
                    onClick = { model.select(s.id) },
                    shape = RoundedCornerShape(12.dp),
                    color = if (isSelected) c.accentTint else Color.Transparent,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(Modifier.padding(start = 10.dp, end = 2.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box {
                            EngineBadge(s.harnessId, 34.dp, circle = false)
                            if (s.runState != "idle") {
                                val dot = when (s.runState) { "running" -> c.success; "waiting-input" -> c.info; else -> c.destructive }
                                Box(Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(11.dp).clip(CircleShape).background(c.paper).padding(2.dp).clip(CircleShape).background(dot))
                            }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (s.pinned) Icon(Icons.Filled.PushPin, "置顶", tint = c.textTertiary, modifier = Modifier.size(13.dp).padding(end = 3.dp))
                                Text(s.title.ifBlank { "未命名会话" }, fontSize = 14.5.sp, fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                                    color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            }
                            val harnessName = state.harnesses.firstOrNull { it.id == s.harnessId }?.name ?: harnessVisual(s.harnessId).name
                            val projectName = state.projects.firstOrNull { it.first == s.projectId }?.second
                            val stateTint = when (s.runState) { "running" -> c.success; "waiting-input" -> c.info; "idle" -> c.textTertiary; else -> c.destructive }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(harnessName, fontSize = 12.sp, color = c.textSecondary, maxLines = 1)
                                Text("·", fontSize = 12.sp, color = c.textTertiary)
                                Text(s.stateLabel, fontSize = 12.sp, color = stateTint, maxLines = 1)
                                if (projectName != null) {
                                    Text("·", fontSize = 12.sp, color = c.textTertiary)
                                    Text(projectName, fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                            Box {
                                IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(28.dp)) {
                                    Icon(Icons.Outlined.MoreVert, "会话操作", modifier = Modifier.size(18.dp))
                                }
                                DropdownMenu(menuExpanded, { menuExpanded = false }) {
                                    DropdownMenuItem(
                                        leadingIcon = { Icon(Icons.Outlined.PushPin, null) },
                                        text = { Text(if (s.pinned) "取消置顶" else "置顶") },
                                        onClick = {
                                            menuExpanded = false
                                            scope.launch { model.updateSession(s.id, JSONObject().put("pinned", !s.pinned)) }
                                        },
                                        enabled = state.canWrite
                                    )
                                    DropdownMenuItem(
                                        leadingIcon = { Icon(Icons.Outlined.Edit, null) },
                                        text = { Text("重命名") },
                                        onClick = {
                                            menuExpanded = false
                                            editing = s; title = s.title
                                        },
                                        enabled = state.canWrite
                                    )
                                    DropdownMenuItem(
                                        leadingIcon = { Icon(if (s.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, null) },
                                        text = { Text(if (s.archived) "恢复会话" else "归档会话") },
                                        onClick = {
                                            menuExpanded = false
                                            scope.launch { model.updateSession(s.id, JSONObject().put("archived", !s.archived)) }
                                        },
                                        enabled = state.canWrite
                                    )
                                    HorizontalDivider()
                                    DropdownMenuItem(
                                        leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error) },
                                        text = { Text("删除会话", color = MaterialTheme.colorScheme.error) },
                                        onClick = {
                                            menuExpanded = false
                                            deleting = s
                                        },
                                        enabled = state.canWrite
                                    )
                                }
                            }
                    }
                }
            }
        }
    }

    editing?.let { s ->
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("重命名对话") },
            text = {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it.take(200) },
                    label = { Text("对话标题") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            if (model.updateSession(s.id, JSONObject().put("title", title.trim())) != null) editing = null
                        }
                    },
                    enabled = title.isNotBlank() && state.canWrite
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消") } }
        )
    }

    deleting?.let { s ->
        ConfirmDialog(
            "删除「" + s.title + "」？",
            "从当前电脑删除此会话记录，此操作不能撤销。",
            "删除",
            { deleting = null }
        ) { scope.launch { if (model.deleteSession(s.id)) deleting = null } }
    }
}

@Composable private fun Conversation(state: WorkbenchState, model: Workbench) {
    var draft by rememberSaveable(state.selected) { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("queue") }
    var stopping by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf(false) }
    var usage by remember { mutableStateOf(false) }
    var modeMenuExpanded by remember { mutableStateOf(false) }
    var attachmentError by remember { mutableStateOf("") }
    var attachments by remember(state.selected) { mutableStateOf(listOf<TextAttachment>()) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session = state.sessions.firstOrNull { it.id == state.selected }
    val harnessId = session?.harnessId
    val harnessName = state.harnesses.firstOrNull { it.id == harnessId }?.name ?: harnessVisual(harnessId).name
    val running = session?.runState == "running"
    val colors = Kooyu.colors

    val blocks = remember(state.transcript) { transcriptBlocks(state.transcript.rows) }
    val continuation = remember(blocks) { continuationFlags(blocks) }
    val inboxItems = state.inbox.filter { it.sessionId == state.selected }
    val listState = rememberLazyListState()
    // Follow the stream while the reader is at the bottom; otherwise offer a jump button.
    val atBottom by remember { derivedStateOf {
        val info = listState.layoutInfo
        val last = info.visibleItemsInfo.lastOrNull()
        last == null || (last.index >= info.totalItemsCount - 1 && last.offset + last.size <= info.viewportEndOffset + 120)
    } }
    val tailSignature = blocks.size.toString() + ":" + (state.transcript.rows.lastOrNull()?.text?.length ?: 0) + ":" + inboxItems.size + ":" + running
    var followed by remember(state.selected) { mutableStateOf(false) }
    LaunchedEffect(tailSignature) {
        val total = listState.layoutInfo.totalItemsCount
        if (total > 0 && (!followed || atBottom)) { listState.scrollToItem(total - 1, Int.MAX_VALUE / 2); followed = true }
    }

    LaunchedEffect(state.composerDraft) {
        if (state.composerDraft.isNotEmpty()) draft = state.composerDraft
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            try {
                var next = attachments
                for (uri in uris) {
                    val name = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                        if (c.moveToFirst()) c.getString(0) else null
                    } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "附件"
                    val current = next
                    val file = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)!!.use { readTextAttachment(name, it, current) } }
                    next = next + file
                }
                attachments = next
                attachmentError = ""
            } catch (e: Exception) {
                attachmentError = e.message ?: "无法读取文本附件。"
            }
        }
    }

    Column(Modifier.fillMaxSize().background(colors.paper)) {
        Column {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                EngineBadge(harnessId, 28.dp, circle = false)
                Column(Modifier.weight(1f)) {
                    Text(session?.title ?: "对话", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val dot = when (session?.runState) { "running" -> colors.success; "waiting-input" -> colors.info; "idle" -> colors.textTertiary; else -> colors.destructive }
                        Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
                        Text(harnessName + " · " + (session?.stateLabel ?: "空闲") + (session?.model?.let { " · $it" } ?: ""),
                            fontSize = 11.5.sp, color = colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                IconButton(onClick = { usage = true }) { Icon(Icons.Outlined.BarChart, "当前会话用量", tint = colors.textSecondary) }
                IconButton(onClick = { detail = true }) { Icon(Icons.Outlined.Tune, "会话配置与工具记录", tint = colors.textSecondary) }
            }
            HorizontalDivider(color = colors.borderSubtle)
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (state.older) item("older") {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        TextButton(onClick = { scope.launch { model.loadOlder() } }, enabled = !state.loadingHistory) {
                            Text(if (state.loadingHistory) "加载中…" else "更早记录", fontSize = 12.5.sp, color = colors.textSecondary)
                        }
                    }
                }
                if (blocks.isEmpty() && !running) item("empty") {
                    Column(Modifier.fillMaxWidth().padding(vertical = 64.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        EngineBadge(harnessId, 44.dp, circle = false)
                        Text(if (harnessId == "kodo") "让 Kooyu 接下来做什么？" else "交给 $harnessName 什么任务？", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
                        Text("消息会发送到当前电脑执行，过程与结果实时同步。", fontSize = 13.sp, color = colors.textSecondary)
                    }
                }
                itemsIndexed(blocks, key = { _, b -> b.key }) { index, block ->
                    TranscriptBlockView(block, harnessId, live = running && state.transcript.thinkingPending && index == blocks.lastIndex, continuation = continuation[index])
                }
                if (running) item("running") {
                    val starting = session?.raw?.optString("connectionState").let { it != null && it.isNotEmpty() && it != "connected" }
                    RunIndicator(if (starting) "正在启动 $harnessName…" else "原生执行中")
                }
                items(inboxItems, key = { "inbox-" + it.id }) { item ->
                    InteractionCard(item, state.canWrite) { action -> scope.launch { model.answer(item, action) } }
                }
                item("tail") { Spacer(Modifier.height(1.dp)) }
            }
            androidx.compose.animation.AnimatedVisibility(!atBottom && blocks.isNotEmpty(), Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
                enter = fadeIn() + scaleIn(), exit = fadeOut() + scaleOut()) {
                SmallFloatingActionButton(onClick = { scope.launch { listState.animateScrollToItem((listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0), Int.MAX_VALUE / 2) } },
                    containerColor = colors.raised, contentColor = colors.text, shape = CircleShape,
                    elevation = FloatingActionButtonDefaults.elevation(2.dp, 4.dp)) { Icon(Icons.Outlined.KeyboardArrowDown, "回到底部") }
            }
        }

        // Composer card, desktop `.composer`: raised surface, hairline ring, controls row beneath the input.
        Column(Modifier.fillMaxWidth().background(colors.paper).padding(start = 12.dp, end = 12.dp, bottom = 10.dp)) {
            Surface(shape = RoundedCornerShape(20.dp), color = colors.raised, border = androidx.compose.foundation.BorderStroke(1.dp, colors.border),
                shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(6.dp)) {
                    if (attachmentError.isNotBlank()) Text(attachmentError, color = colors.destructive, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                    if (attachments.isNotEmpty()) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.padding(top = 4.dp)) {
                            items(attachments, key = { it.id }) { file ->
                                Row(Modifier.clip(RoundedCornerShape(8.dp)).background(colors.sunken).padding(start = 8.dp, end = 2.dp, top = 2.dp, bottom = 2.dp),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = colors.textSecondary, modifier = Modifier.size(14.dp))
                                    Text(file.name, fontSize = 12.sp, color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
                                    IconButton(onClick = { attachments = attachments.filterNot { it.id == file.id } }, modifier = Modifier.size(24.dp)) {
                                        Icon(Icons.Outlined.Close, "移除 " + file.name, tint = colors.textTertiary, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                        }
                    }
                    TextField(
                        value = draft, onValueChange = { draft = it },
                        placeholder = { Text(if (running) "补充说明或排队下一条…" else "输入消息…", color = colors.textTertiary) },
                        maxLines = 6, textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp, color = colors.text),
                        colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            disabledContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                            cursorColor = colors.text),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        IconButton(onClick = { picker.launch(arrayOf("text/*", "application/json", "application/xml")) }, modifier = Modifier.size(36.dp), enabled = attachments.size < 4) {
                            Icon(Icons.Outlined.AttachFile, "添加文本附件", tint = colors.textSecondary, modifier = Modifier.size(20.dp))
                        }
                        Box {
                            Row(Modifier.clip(RoundedCornerShape(9.dp)).clickable { modeMenuExpanded = true }.padding(horizontal = 8.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(when (mode) { "steer" -> "引导"; "new" -> "新回合"; else -> "排队" }, fontSize = 12.5.sp, color = colors.textSecondary)
                                Icon(Icons.Outlined.UnfoldMore, null, tint = colors.textTertiary, modifier = Modifier.size(14.dp))
                            }
                            DropdownMenu(modeMenuExpanded, { modeMenuExpanded = false }) {
                                DropdownMenuItem(text = { Text("排队发送") }, onClick = { mode = "queue"; modeMenuExpanded = false })
                                DropdownMenuItem(text = { Text("新回合") }, onClick = { mode = "new"; modeMenuExpanded = false })
                                if (session?.raw?.optJSONObject("nativeCapabilities")?.optString("steer") == "supported") {
                                    DropdownMenuItem(text = { Text("引导当前任务") }, onClick = { mode = "steer"; modeMenuExpanded = false })
                                }
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        val message = attachedMessage(draft, attachments)
                        val canSend = state.canWrite && message.isNotBlank() && message.length <= 200000
                        if (running && draft.isBlank() && attachments.isEmpty()) {
                            FilledIconButton(onClick = { stopping = true }, enabled = state.canWrite, shape = CircleShape, modifier = Modifier.size(36.dp),
                                colors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.accent, contentColor = colors.onAccent)) {
                                Icon(Icons.Filled.Stop, "停止并暂停", modifier = Modifier.size(18.dp))
                            }
                        } else {
                            FilledIconButton(
                                onClick = {
                                    val text = draft
                                    val files = attachments
                                    scope.launch {
                                        if (model.send(attachedMessage(text, files), mode) && draft == text) { draft = ""; attachments = emptyList() }
                                    }
                                },
                                enabled = canSend, shape = CircleShape, modifier = Modifier.size(36.dp),
                                colors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.accent, contentColor = colors.onAccent,
                                    disabledContainerColor = colors.sunken, disabledContentColor = colors.textTertiary),
                            ) { Icon(Icons.Filled.ArrowUpward, "发送", modifier = Modifier.size(18.dp)) }
                        }
                    }
                }
            }
        }
    }

    if (stopping) {
        ConfirmDialog("停止并暂停？", "停止当前任务并暂停自动续聊。", "停止", { stopping = false }) {
            stopping = false
            scope.launch { model.stop() }
        }
    }
    if (detail && session != null) SessionDetails(state, model, session) { detail = false }
    if (usage) {
        FullScreenPage("会话用量", { usage = false }) { padding ->
            Box(Modifier.padding(padding)) { UsageScreen(state, model, state.selected) }
        }
    }
}


@Composable fun InteractionCard(item: InboxItem, enabled: Boolean, answer: (NativeAction) -> Unit) {
    var confirming by remember { mutableStateOf<NativeAction?>(null) }
    val params = item.payload.optJSONObject("params") ?: item.payload
    val command = params.optString("command", params.optString("cmd", ""))
    val path = params.optString("path", params.optString("file", ""))

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
        border = androidx.compose.foundation.BorderStroke(1.5.dp, Color(0xFFF76808).copy(alpha = 0.6f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFF76808).copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Outlined.Shield, null, tint = Color(0xFFF76808), modifier = Modifier.size(16.dp))
                }
                Text("需要您的确认", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }

            if (command.isNotBlank()) {
                Surface(
                    color = Color(0xFF1E1E24),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(10.dp)) {
                        Text("终端命令：", style = MaterialTheme.typography.labelSmall, color = Color(0xFFA0A0AB))
                        Spacer(Modifier.height(4.dp))
                        SelectionContainer {
                            Text(
                                "$ $command",
                                color = Color(0xFF50E3C2),
                                fontFamily = FontFamily.Monospace,
                                fontSize = 13.sp
                            )
                        }
                    }
                }
            } else if (path.isNotBlank()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    Text(path, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                }
            }

            Surface(
                color = MaterialTheme.colorScheme.surfaceContainer,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                SelectionContainer {
                    Text(
                        params.toString(2),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            if (item.actions.isEmpty()) {
                Text(
                    "此交互尚无移动端原生审批选项，请在桌面端处理。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
                ) {
                    item.actions.forEach { action ->
                        if (action.destructive) {
                            OutlinedButton(
                                onClick = { confirming = action },
                                enabled = enabled,
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text(action.label)
                            }
                        } else {
                            Button(
                                onClick = { confirming = action },
                                enabled = enabled,
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text(action.label)
                            }
                        }
                    }
                }
            }
        }
    }

    confirming?.let { action ->
        ConfirmDialog(
            "确认执行操作？",
            "「${action.label}」将提交到当前电脑 Host 执行。",
            action.label,
            { confirming = null }
        ) {
            confirming = null
            answer(action)
        }
    }
}

@Composable fun ConfirmDialog(
    title: String,
    text: String,
    action: String,
    dismiss: () -> Unit,
    confirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = dismiss,
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = { Text(text) },
        confirmButton = {
            Button(onClick = confirm, shape = RoundedCornerShape(8.dp)) {
                Text(action)
            }
        },
        dismissButton = {
            TextButton(onClick = dismiss) {
                Text("取消")
            }
        }
    )
}

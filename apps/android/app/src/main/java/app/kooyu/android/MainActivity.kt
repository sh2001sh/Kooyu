package app.kooyu.android

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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ThemeManager.init(this)
        BackgroundReminders.receive(intent)
        enableEdgeToEdge()
        setContent {
            KooyuTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    KooyuScreen()
                }
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); BackgroundReminders.receive(intent)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun KooyuScreen(model: Workbench = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val pendingNotification by BackgroundReminders.pending.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var creating by rememberSaveable(state.connection?.hostId) { mutableStateOf(false) }
    var inboxOpen by remember { mutableStateOf(false) }
    var creatingProject by rememberSaveable { mutableStateOf("") }
    var devices by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    var showSplash by remember { mutableStateOf(true) }
    LaunchedEffect(state.notice) { val notice = state.notice; if (notice.isNotBlank()) { delay(7000); model.dismissNotice(notice) } }

    LaunchedEffect(state.connections.map { it.hostId + ":" + it.deviceId }, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            BackgroundReminders.retryRevocations(context, state.connections)
            BackgroundReminders.start(context)
        }
    }
    LaunchedEffect(state.connection?.hostId, state.selected, tab, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            BackgroundReminders.visibleHost = state.connection?.hostId
            BackgroundReminders.visibleSession = if (tab == 0) state.selected else null
            try { kotlinx.coroutines.awaitCancellation() }
            finally { BackgroundReminders.visibleHost = null; BackgroundReminders.visibleSession = null }
        }
    }
    LaunchedEffect(pendingNotification, state.busy) {
        val target = pendingNotification ?: return@LaunchedEffect
        if (!state.busy) {
            model.openNotification(target)?.let { if (it == 4) { inboxOpen = true; tab = 0 } else tab = it }
            if (BackgroundReminders.pending.value == target) BackgroundReminders.pending.value = null
        }
    }

    LaunchedEffect(state.connection?.token, state.selected) {
        val token = state.connection?.token
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            try { while (true) { model.refresh(); delay(2000) } } finally { model.suspended(token) }
        }
    }

    BackHandler(enabled = state.selected != null && tab == 0) { model.select(null) }

    Box(Modifier.fillMaxSize()) {
        BoxWithConstraints {
        val expanded = maxWidth >= 600.dp
        val split = maxWidth >= 840.dp
        Row(Modifier.fillMaxSize()) {
            if (state.connection != null && expanded) {
                NavigationRail(
                    modifier = Modifier.fillMaxHeight(),
                    containerColor = MaterialTheme.colorScheme.surfaceContainer
                ) {
                    Destinations(tab, true) { tab = it }
                }
            }
            Scaffold(
                modifier = Modifier.weight(1f),
                topBar = {
                    val inConversation = !split && state.selected != null && tab == 0
                    if (!inConversation) {
                        TopAppBar(
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = MaterialTheme.colorScheme.surface,
                                titleContentColor = MaterialTheme.colorScheme.onSurface
                            ),
                            title = {
                                if (state.connection == null) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Icon(
                                            painter = painterResource(R.drawable.kooyu_mark_coral),
                                            contentDescription = "Kooyu",
                                            tint = Color.Unspecified,
                                            modifier = Modifier.size(26.dp)
                                        )
                                        Text("kooyu", fontWeight = FontWeight.Bold, fontSize = 21.sp, letterSpacing = (-0.5).sp, color = Kooyu.colors.text)
                                    }
                                } else {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Icon(
                                            painter = painterResource(R.drawable.kooyu_mark_coral),
                                            contentDescription = "Kooyu",
                                            tint = Color.Unspecified,
                                            modifier = Modifier.size(22.dp)
                                        )
                                        Text("kooyu", fontWeight = FontWeight.Bold, fontSize = 18.sp, letterSpacing = (-0.5).sp, color = Kooyu.colors.text)
                                        Spacer(Modifier.width(2.dp))
                                        Surface(
                                            shape = RoundedCornerShape(20.dp),
                                            color = Kooyu.colors.sunken,
                                            border = BorderStroke(0.5.dp, Kooyu.colors.borderSubtle),
                                            modifier = Modifier.clickable(enabled = !state.busy) { devices = true }
                                        ) {
                                            Row(
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                                            ) {
                                                Box(
                                                    modifier = Modifier
                                                        .size(6.dp)
                                                        .clip(CircleShape)
                                                        .background(if (state.online) Kooyu.colors.success else Kooyu.colors.destructive)
                                                )
                                                val rawDeviceName = state.connection!!.name
                                                val displayDeviceName = if (rawDeviceName.length > 16 && rawDeviceName.matches(Regex("^[0-9a-fA-F]+$"))) {
                                                    rawDeviceName.take(6) + "…" + rawDeviceName.takeLast(4)
                                                } else rawDeviceName
                                                Text(
                                                    displayDeviceName,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = Kooyu.colors.textSecondary,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                Icon(Icons.Outlined.ExpandMore, "切换设备", modifier = Modifier.size(14.dp), tint = Kooyu.colors.textSecondary)
                                            }
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
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                        IconButton(onClick = { scope.launch { model.refresh(); if (tab == 1) model.refreshUsage() } }, modifier = Modifier.size(36.dp)) {
                                            Icon(Icons.Outlined.Refresh, "刷新数据", tint = Kooyu.colors.textSecondary, modifier = Modifier.size(19.dp))
                                        }
                                        IconButton(onClick = { inboxOpen = true }, modifier = Modifier.size(36.dp)) {
                                            BadgedBox(badge = { if (state.inbox.isNotEmpty()) Badge { Text(state.inbox.size.toString()) } }) {
                                                Icon(Icons.Outlined.Inbox, "收件箱", tint = Kooyu.colors.textSecondary, modifier = Modifier.size(19.dp))
                                            }
                                        }
                                        if (tab == 0) {
                                            Surface(
                                                shape = RoundedCornerShape(14.dp),
                                                color = Kooyu.colors.accent,
                                                modifier = Modifier
                                                    .height(32.dp)
                                                    .clickable(enabled = state.canWrite) { creatingProject = ""; creating = true }
                                            ) {
                                                Row(
                                                    modifier = Modifier.padding(horizontal = 11.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                                ) {
                                                    Icon(Icons.Outlined.Add, null, tint = Kooyu.colors.onAccent, modifier = Modifier.size(16.dp))
                                                    Text("新建", fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = Kooyu.colors.onAccent)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        )
                    }
                },
                bottomBar = {
                    val inConversation = !split && state.selected != null && tab == 0
                    if (state.connection != null && !expanded && !inConversation) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .navigationBarsPadding()
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Surface(
                                shape = RoundedCornerShape(26.dp),
                                color = if (Kooyu.colors.dark) Kooyu.colors.raised else Color(0xFFFAFAFC),
                                border = BorderStroke(0.6.dp, if (Kooyu.colors.dark) Kooyu.colors.borderStrong.copy(alpha = 0.35f) else Color(0x18000000)),
                                shadowElevation = if (Kooyu.colors.dark) 0.dp else 5.dp,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(60.dp)
                            ) {
                                Destinations(tab, false) { tab = it }
                            }
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
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.75f),
                            border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.35f)),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 6.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(Kooyu.colors.destructive)
                                )
                                Text(
                                    if (state.error.isNotBlank()) state.error else "离线 · 正在重连",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                    if (state.connection?.pending != null) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.8f),
                            border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 4.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(Kooyu.colors.info)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "待核对事项",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Kooyu.colors.text,
                                    modifier = Modifier.weight(1f)
                                )
                                TextButton(onClick = { clearing = true }) { Text("核对") }
                            }
                        }
                    }
                    if (state.notice.isNotBlank()) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(state.notice, fontSize = 12.sp, color = Kooyu.colors.textSecondary, modifier = Modifier.weight(1f))
                        IconButton(onClick = { model.dismissNotice(state.notice) }) { Icon(Icons.Outlined.Close, "关闭提示", tint = Kooyu.colors.textSecondary, modifier = Modifier.size(16.dp)) }
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
                        AnimatedContent(
                            targetState = tab,
                            transitionSpec = {
                                fadeIn(animationSpec = tween(220, easing = FastOutSlowInEasing))
                                    .togetherWith(fadeOut(animationSpec = tween(160, easing = FastOutLinearInEasing)))
                            },
                            label = "TabContentTransition",
                            modifier = Modifier.weight(1f).fillMaxWidth()
                        ) { currentTab ->
                            when (currentTab) {
                                1 -> UsageScreen(state, model)
                                2 -> ModelConfigurationScreen(state, model, embedded = true) {}
                                3 -> SettingsScreen(state, model)
                                else -> if (split) {
                                    Row(Modifier.fillMaxSize()) {
                                        Box(Modifier.width(340.dp).fillMaxHeight()) { SessionList(state, model) { project -> creatingProject = project; creating = true } }
                                        VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                        Box(Modifier.weight(1f).fillMaxHeight()) {
                                            if (state.selected == null) {
                                                EmptyConversationPlaceholder()
                                            } else {
                                                Conversation(state, model, split = true)
                                            }
                                        }
                                    }
                                } else {
                                    AnimatedContent(
                                        targetState = state.selected,
                                        transitionSpec = {
                                            if (targetState != null) {
                                                (fadeIn(animationSpec = tween(300, easing = FastOutSlowInEasing)) +
                                                 scaleIn(initialScale = 0.94f, animationSpec = tween(300, easing = FastOutSlowInEasing)))
                                                    .togetherWith(
                                                        fadeOut(animationSpec = tween(180, easing = FastOutLinearInEasing)) +
                                                        scaleOut(targetScale = 0.96f, animationSpec = tween(180, easing = FastOutLinearInEasing))
                                                    )
                                            } else {
                                                (fadeIn(animationSpec = tween(260, easing = FastOutSlowInEasing)) +
                                                 scaleIn(initialScale = 1.04f, animationSpec = tween(260, easing = FastOutSlowInEasing)))
                                                    .togetherWith(
                                                        fadeOut(animationSpec = tween(180, easing = FastOutLinearInEasing)) +
                                                        scaleOut(targetScale = 0.94f, animationSpec = tween(180, easing = FastOutLinearInEasing))
                                                    )
                                            }
                                        },
                                        label = "SessionTransition",
                                        modifier = Modifier.fillMaxSize()
                                    ) { selectedId ->
                                        if (selectedId == null) {
                                            SessionList(state, model) { project -> creatingProject = project; creating = true }
                                        } else {
                                            Conversation(state, model, split = false)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (devices && state.connection != null) DeviceActionSheet(state, model) { devices = false }
    if (creating && state.connection != null) SessionComposer(state, model, initialProject = creatingProject) { creating = false; tab = 0 }
    if (inboxOpen) FullScreenPage("收件箱", { inboxOpen = false }) { padding -> Box(Modifier.padding(padding)) { InboxTab(state, model) { model.select(it); inboxOpen = false; tab = 0 } } }
    if (state.addingDevice && state.connection != null) {
        FullScreenPage("添加设备", { model.addDevice(false) }) { padding ->
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
            "核对确认",
            "清除本机待核对标记",
            "确认",
            { clearing = false }
        ) { clearing = false; runCatching { model.clearPending() } }
    }

    if (showSplash) {
        MobiusSplashScreen(onDismiss = { showSplash = false })
    }
}
}

@Composable private fun Destinations(tab: Int, rail: Boolean, select: (Int) -> Unit) {
    val labels = listOf("对话", "用量", "模型来源", "设置")
    val icons = listOf(
        Icons.Outlined.ChatBubbleOutline,
        Icons.Outlined.BarChart,
        Icons.Outlined.Memory,
        Icons.Outlined.Settings
    )
    val selectedIcons = listOf(
        Icons.AutoMirrored.Outlined.Chat,
        Icons.Outlined.BarChart,
        Icons.Outlined.Memory,
        Icons.Outlined.Settings
    )

    @Composable fun IconFor(index: Int) {
        val active = tab == index
        val iconTint by animateColorAsState(
            targetValue = if (active) Kooyu.colors.text else Kooyu.colors.textSecondary,
            animationSpec = androidx.compose.animation.core.tween(200),
            label = "tabIconTint"
        )
        if (index == 0) {
            Icon(
                painter = painterResource(R.drawable.kooyu_mark_coral),
                contentDescription = labels[index],
                tint = if (active) Color.Unspecified else Kooyu.colors.textSecondary,
                modifier = Modifier.size(width = 19.dp, height = 16.dp)
            )
        } else {
            Icon(
                if (active) selectedIcons[index] else icons[index],
                contentDescription = labels[index],
                tint = iconTint,
                modifier = Modifier.size(19.dp)
            )
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
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 5.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            labels.forEachIndexed { i, label ->
                val active = tab == i
                val c = Kooyu.colors
                val animBg by animateColorAsState(
                    targetValue = if (active) (if (c.dark) Color(0xFF232734) else Color(0xFFECEEF2)) else Color.Transparent,
                    animationSpec = androidx.compose.animation.core.tween(200),
                    label = "tabBg"
                )
                val textTint by animateColorAsState(
                    targetValue = if (active) c.text else c.textSecondary,
                    animationSpec = androidx.compose.animation.core.tween(200),
                    label = "tabTextTint"
                )
                Surface(
                    shape = RoundedCornerShape(21.dp),
                    color = animBg,
                    border = if (active) BorderStroke(0.5.dp, if (c.dark) c.borderSubtle else Color(0x12000000)) else null,
                    shadowElevation = 0.dp,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(21.dp))
                        .clickable { select(i) }
                ) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            IconFor(i)
                            Text(
                                label,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                                letterSpacing = (-0.2).sp,
                                color = textTint
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun InboxTab(state: WorkbenchState, model: Workbench, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
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
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (state.inbox.isEmpty() && notices.isEmpty() && !loading) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(top = 64.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.CheckCircle, null, modifier = Modifier.size(56.dp), tint = c.success)
                        Text("暂无待处理事项", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = c.text)
                    }
                }
            }
        } else {
            items(state.inbox, key = { it.id }) { item ->
                val session = state.sessions.firstOrNull { it.id == item.sessionId }
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth().clickable { open(item.sessionId) }
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(c.sunken), contentAlignment = Alignment.Center) {
                            Icon(if (questionForm(item.payload) != null) Icons.Outlined.HelpOutline else Icons.Outlined.Shield, null, tint = c.info, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(session?.title ?: "对话通知", fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = c.text)
                            Text(if (questionForm(item.payload) != null) "Harness 正在等待你的回答" else "等待确认 · 点击进入对话处理", fontSize = 12.sp, color = c.textSecondary)
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
        val pendingIds = state.inbox.map { it.id }.toSet()
        items(notices.filter { it.optString("inboxItemId") !in pendingIds }.sortedByDescending { it.optLong("sequence") }, key = { "notice:" + it.getString("id") }) { notice ->
            val sessionId = notice.nullableString("sessionId")
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = c.raised,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth().clickable(enabled = sessionId != null) {
                    scope.launch { model.execute("/notifications/${encoded(notice.getString("id"))}/read"); if (sessionId != null) open(sessionId) }
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
        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.accent) }
        if (hasMore) item { TextButton(onClick = { scope.launch { load(cursor) } }, enabled = !loading) { Text("加载更多通知", color = c.accent) } }
    }
}

@Composable private fun EmptyConversationPlaceholder() {
    Box(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Icon(Icons.Outlined.Forum, null, modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.outline)
            Text("会话", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable fun HarnessBadge(harnessId: String, name: String? = null) {
    val v = harnessVisual(harnessId)
    val dark = Kooyu.colors.dark
    Row(Modifier.clip(RoundedCornerShape(6.dp)).background(if (dark) v.darkTint else v.tint).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        EngineBadge(harnessId, 14.dp, circle = false)
        Text(name ?: v.name, color = if (dark) v.darkInk else v.ink, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun DeviceActionSheet(
    state: WorkbenchState,
    model: Workbench,
    onDismiss: () -> Unit
) {
    val c = Kooyu.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.raised,
        dragHandle = {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 36.dp, height = 4.dp).clip(CircleShape).background(c.textTertiary.copy(alpha = 0.4f)))
            }
        },
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("选择设备", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = c.text, letterSpacing = (-0.3).sp, modifier = Modifier.padding(horizontal = 4.dp))
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onDismiss(); model.addDevice(true) }
                    .padding(horizontal = 16.dp, vertical = 14.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(c.paper), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Add, null, tint = c.accent, modifier = Modifier.size(18.dp))
                    }
                    Text("添加设备", fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                }
            }
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    state.connections.forEachIndexed { idx, item ->
                        val isCurrent = item.hostId == state.connection?.hostId
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { model.switchDevice(item.hostId); onDismiss() }
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(if (isCurrent) c.accentTint else c.paper),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Outlined.Computer, null, tint = if (isCurrent) c.accent else c.textSecondary, modifier = Modifier.size(18.dp))
                            }
                            Text(item.name, fontSize = 14.5.sp, fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
                            if (isCurrent) {
                                Surface(shape = CircleShape, color = c.successTint) {
                                    Text("当前", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.success, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                                }
                            }
                        }
                        if (idx < state.connections.lastIndex) {
                            HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 60.dp))
                        }
                    }
                }
            }

            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clickable { onDismiss() }
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("取消", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun SessionActionSheet(
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
        dragHandle = {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 36.dp, height = 4.dp).clip(CircleShape).background(c.textTertiary.copy(alpha = 0.4f)))
            }
        },
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                session.title.ifBlank { "未命名会话" },
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = c.text,
                letterSpacing = (-0.3).sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 4.dp)
            )

            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = canWrite) { onPin(); onDismiss() }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Outlined.PushPin, null, tint = c.brandCoral, modifier = Modifier.size(20.dp))
                        Text(if (session.pinned) "取消置顶" else "置顶会话", fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
                    }
                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 48.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = canWrite) { onRename(); onDismiss() }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Outlined.Edit, null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
                        Text("重命名", fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
                    }
                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 48.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = canWrite) { onArchive(); onDismiss() }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(if (session.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
                        Text(if (session.archived) "恢复会话" else "归档会话", fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = c.text, modifier = Modifier.weight(1f))
                    }
                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 48.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = canWrite) { onDelete(); onDismiss() }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Outlined.Delete, null, tint = c.destructive, modifier = Modifier.size(20.dp))
                        Text("删除会话", fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = c.destructive, modifier = Modifier.weight(1f))
                    }
                }
            }

            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clickable { onDismiss() }
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("取消", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                }
            }
        }
    }
}

@Composable private fun SessionList(state: WorkbenchState, model: Workbench, create: (String) -> Unit) {
    var workProject by remember { mutableStateOf<String?>(null) }
    var workTab by remember { mutableStateOf("工作记录") }
    if (workProject != null) WorkHubScreen(state, model, workProject!!, workTab) { workProject = null }
    var search by rememberSaveable { mutableStateOf("") }
    var archived by rememberSaveable { mutableStateOf(false) }
    var editing by remember { mutableStateOf<HostSession?>(null) }
    var title by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<HostSession?>(null) }
    var activeActionSession by remember { mutableStateOf<HostSession?>(null) }
    val scope = rememberCoroutineScope()

    val c = Kooyu.colors
    var managing by remember { mutableStateOf(false) }
    var collapsed by remember { mutableStateOf(setOf<String>()) }
    if (managing) FullScreenPage("项目与目录", { managing = false }) { padding -> Box(Modifier.padding(padding)) { ProjectsScreen(state, model) } }
    Column(Modifier.fillMaxHeight().background(c.paper)) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.borderSubtle),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp)
                .clickable { workTab = "工作记录"; workProject = "" }
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(
                    modifier = Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(c.brandCoralTint),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Outlined.Layers, null, tint = c.brandCoral, modifier = Modifier.size(16.dp))
                }
                Text("工作记录与成果", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = c.text, modifier = Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = c.textTertiary, modifier = Modifier.size(12.dp))
            }
        }
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = c.sunken,
            border = BorderStroke(0.5.dp, c.borderSubtle),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.Search, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                TextField(
                    value = search,
                    onValueChange = { search = it },
                    placeholder = { Text("搜索会话…", fontSize = 13.sp, color = c.textTertiary) },
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        disabledContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = c.text
                    ),
                    modifier = Modifier.weight(1f)
                )
                if (search.isNotEmpty()) {
                    IconButton(onClick = { search = "" }, modifier = Modifier.size(22.dp)) {
                        Icon(Icons.Outlined.Close, null, tint = c.textTertiary, modifier = Modifier.size(13.dp))
                    }
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.height(36.dp).weight(1f).clickable { managing = true }
            ) {
                Row(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(Icons.Outlined.Folder, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                    Text("项目目录", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
                }
            }
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = c.sunken,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.height(36.dp).weight(1.3f)
            ) {
                Row(Modifier.fillMaxSize().padding(2.dp)) {
                    val activeColor = if (c.dark) Color(0xFF1E212B) else Color.White
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (!archived) activeColor else Color.Transparent,
                        border = if (!archived) BorderStroke(0.5.dp, c.borderSubtle) else null,
                        modifier = Modifier.weight(1f).fillMaxHeight().clickable { archived = false }
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("进行中", fontSize = 12.sp, fontWeight = if (!archived) FontWeight.Bold else FontWeight.Medium, color = if (!archived) c.text else c.textSecondary)
                        }
                    }
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (archived) activeColor else Color.Transparent,
                        border = if (archived) BorderStroke(0.5.dp, c.borderSubtle) else null,
                        modifier = Modifier.weight(1f).fillMaxHeight().clickable { archived = true }
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("已归档", fontSize = 12.sp, fontWeight = if (archived) FontWeight.Bold else FontWeight.Medium, color = if (archived) c.text else c.textSecondary)
                        }
                    }
                }
            }
        }

        val visible = state.sessions
            .filter {
                it.archived == archived &&
                it.title.contains(search, true)
            }
            .sortedByDescending { it.pinned }

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
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
                            Icon(Icons.Outlined.SearchOff, null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.outline)
                            Text("无匹配会话", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
                        }
                    }
                }
            }
            val distinctProjects = state.projects
                .filter { p -> visible.any { s -> s.projectId == p.first } || p.second != "admin" }
                .distinctBy { it.first }
            val groups = listOf("" to "全局对话") + distinctProjects + visible.mapNotNull { it.projectId }.filter { id -> distinctProjects.none { it.first == id } }.distinct().map { it to "未归属项目" }
            groups.forEach { (projectId, name) ->
                val grouped = visible.filter { (it.projectId ?: "") == projectId }
                if (search.isBlank() || grouped.isNotEmpty()) item(key = "project:$projectId") {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f).heightIn(min = 36.dp).clickable { collapsed = if (projectId in collapsed) collapsed - projectId else collapsed + projectId }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(if (projectId in collapsed) Icons.AutoMirrored.Outlined.ArrowForwardIos else Icons.Outlined.ExpandMore, null, tint = c.textTertiary, modifier = Modifier.size(13.dp))
                            Text(name, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text, letterSpacing = (-0.2).sp)
                            Surface(color = c.sunken, shape = RoundedCornerShape(8.dp), border = BorderStroke(0.5.dp, c.borderSubtle)) {
                                Text("${grouped.size}", fontSize = 10.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, color = c.textTertiary, modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp))
                            }
                        }
                        IconButton(onClick = { workTab = "项目概览"; workProject = projectId }, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Topic, "$name 项目概览", tint = c.textSecondary, modifier = Modifier.size(16.dp)) }
                        IconButton(onClick = { create(projectId) }, enabled = state.canWrite, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Add, "新建", tint = c.textSecondary, modifier = Modifier.size(16.dp)) }
                    }
                }
                if (projectId !in collapsed || search.isNotBlank()) items(grouped, key = { it.id }) { s ->
                val isSelected = state.selected == s.id

                Surface(
                    onClick = { model.select(s.id) },
                    shape = RoundedCornerShape(18.dp),
                    color = if (isSelected) c.accentTint else c.raised,
                    border = BorderStroke(0.6.dp, if (isSelected) c.accent.copy(alpha = 0.45f) else c.borderSubtle),
                    shadowElevation = if (!c.dark && !isSelected) 0.8.dp else 0.dp,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 3.5.dp)
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                        Box {
                            EngineBadge(s.harnessId, 40.dp, circle = false)
                            if (s.runState != "idle" || s.kind == "supervisor") {
                                val dot = when {
                                    s.kind == "supervisor" -> c.success
                                    s.phase == "draft" -> c.success
                                    s.runState == "running" -> c.success
                                    s.runState == "waiting-input" -> c.info
                                    else -> c.destructive
                                }
                                Box(Modifier.align(Alignment.BottomEnd).offset(1.5.dp, 1.5.dp).size(10.dp).clip(CircleShape).background(c.raised).padding(1.5.dp).clip(CircleShape).background(dot))
                            }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.5.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (s.pinned) Icon(Icons.Filled.PushPin, "置顶", tint = c.brandCoral, modifier = Modifier.size(13.dp).padding(end = 4.dp))
                                Text(s.title.ifBlank { "未命名会话" }, fontSize = 15.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                                    letterSpacing = (-0.3).sp, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            }
                            val harnessName = state.harnesses.firstOrNull { it.id == s.harnessId }?.name ?: harnessVisual(s.harnessId).name
                            val projectName = state.projects.firstOrNull { it.first == s.projectId }?.second
                            val stateTint = when {
                                s.kind == "supervisor" -> c.success
                                s.phase == "draft" -> c.success
                                s.runState == "running" -> c.success
                                s.runState == "waiting-input" -> c.info
                                s.runState == "idle" -> c.textTertiary
                                else -> c.destructive
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(harnessName.uppercase(), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.textSecondary, letterSpacing = 0.5.sp, maxLines = 1)
                                Text("·", fontSize = 10.sp, color = c.textTertiary)
                                Text(s.stateLabel, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, color = stateTint, maxLines = 1)
                                if (projectName != null) {
                                    Text("·", fontSize = 10.sp, color = c.textTertiary)
                                    Surface(color = c.sunken, shape = RoundedCornerShape(4.dp), border = BorderStroke(0.5.dp, c.borderSubtle)) {
                                        Text(projectName, fontSize = 9.5.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp))
                                    }
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            IconButton(onClick = { activeActionSession = s }, modifier = Modifier.size(28.dp)) {
                                Icon(Icons.Outlined.MoreHoriz, "操作", tint = c.textTertiary, modifier = Modifier.size(17.dp))
                            }
                            Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, null, tint = c.textTertiary.copy(alpha = 0.45f), modifier = Modifier.size(11.dp))
                        }
                    }
                }
            }
            }
        }
    }

    if (activeActionSession != null) {
        val s = activeActionSession!!
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
            title = { Text("重命名对话", fontWeight = FontWeight.Bold, fontSize = 16.sp) },
            text = {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = c.sunken,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    TextField(
                        value = title,
                        onValueChange = { title = it.take(200) },
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            cursorColor = c.text
                        ),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            if (model.updateSession(s.id, JSONObject().put("title", title.trim())) != null) editing = null
                        }
                    },
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                    enabled = title.isNotBlank() && state.canWrite
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消", color = c.textSecondary) } }
        )
    }

    deleting?.let { s ->
        ConfirmDialog(
            "删除会话",
            "确认删除「" + s.title + "」？",
            "删除",
            { deleting = null }
        ) { scope.launch { if (model.deleteSession(s.id)) deleting = null } }
    }
}

@Composable private fun Conversation(state: WorkbenchState, model: Workbench, split: Boolean = false) {
    var workOpen by remember { mutableStateOf(false) }
    if (workOpen) WorkHubScreen(state, model, state.sessions.firstOrNull { it.id == state.selected }?.projectId ?: "", "成果") { workOpen = false }
    var draft by rememberSaveable(state.connection?.hostId, state.selected) { mutableStateOf(model.savedDraft(state.connection?.hostId, state.selected)) }
    val ownerHost = state.connection?.hostId
    val ownerSession = state.selected
    val draftSnapshot = remember(ownerHost, ownerSession) { mutableStateOf(draft) }
    draftSnapshot.value = draft
    DisposableEffect(ownerHost, ownerSession) { onDispose { model.saveDraft(ownerHost, ownerSession, draftSnapshot.value) } }
    LaunchedEffect(draft, ownerHost, ownerSession) { delay(300); model.saveDraft(ownerHost, ownerSession, draft) }
    var stopping by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf(false) }
    var usage by remember { mutableStateOf(false) }
    var goalDetailId by remember { mutableStateOf<String?>(null) }
    var attachmentError by remember { mutableStateOf("") }
    var uploading by remember { mutableStateOf(false) }
    var attachments by remember(state.selected) { mutableStateOf(listOf<ManagedAttachment>()) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session = state.sessions.firstOrNull { it.id == state.selected }
    val harnessId = session?.harnessId
    val harnessName = state.harnesses.firstOrNull { it.id == harnessId }?.name ?: harnessVisual(harnessId).name
    val running = session?.runState == "running"
    val colors = Kooyu.colors

    val matchingGoal = remember(state.snapshot, state.selected) {
        state.snapshot.optJSONArray("goals")?.objects()?.firstOrNull {
            it.optString("controllerSessionId") == state.selected ||
            it.optJSONArray("sessionIds")?.let { arr -> (0 until arr.length()).any { i -> arr.getString(i) == state.selected } } == true
        }
    }

    val blocks = remember(state.transcript) { transcriptBlocks(state.transcript.rows) }
    val continuation = remember(blocks) { continuationFlags(blocks) }
    val inboxItems = state.inbox.filter { it.sessionId == state.selected }
    val positionKey = (state.connection?.hostId ?: "") + ":" + state.selected
    val savedPosition = remember(positionKey) { model.readingPositions[positionKey] }
    val listState = rememberLazyListState(savedPosition?.first ?: 0, savedPosition?.second ?: 0)
    DisposableEffect(positionKey) { onDispose { model.readingPositions[positionKey] = listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset } }
    // Follow the stream while the reader is at the bottom; otherwise offer a jump button.
    val atBottom by remember { derivedStateOf {
        val info = listState.layoutInfo
        val last = info.visibleItemsInfo.lastOrNull()
        last == null || (last.index >= info.totalItemsCount - 1 && last.offset + last.size <= info.viewportEndOffset + 120)
    } }
    val tailSignature = blocks.size.toString() + ":" + (state.transcript.rows.lastOrNull()?.text?.length ?: 0) + ":" + inboxItems.size + ":" + running
    var followed by remember(state.selected) { mutableStateOf(savedPosition != null) }
    LaunchedEffect(tailSignature) {
        val total = listState.layoutInfo.totalItemsCount
        if (total > 0 && (!followed || atBottom)) { listState.scrollToItem(total - 1, Int.MAX_VALUE / 2); followed = true }
    }

    LaunchedEffect(state.composerDraft, state.composerAttachments) {
        if (state.composerDraft.isNotEmpty()) draft = state.composerDraft
        if (state.composerAttachments.isNotEmpty()) attachments = state.composerAttachments
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            val owner = state.selected
            val connection = state.connection
            uploading = true
            try {
                require(owner != null && connection != null && state.canWrite) { "请先连接设备。" }
                for (uri in uris) {
                    require(attachments.size < 10) { "一次最多附加 10 个文件。" }
                    val name = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                        if (c.moveToFirst()) c.getString(0) else null
                    } ?: "附件"
                    val bytes = withContext(Dispatchers.IO) {
                        context.contentResolver.openInputStream(uri)!!.use { input ->
                            val data = readAttachmentBytes(input)
                            require(data.size <= 32 * 1024 * 1024) { "单个附件最多 32 MiB。" }
                            data
                        }
                    }
                    val file = HostAPI(connection).upload(name, context.contentResolver.getType(uri) ?: "application/octet-stream", bytes, owner)
                    if (model.state.value.selected == owner && model.state.value.connection?.token == connection.token)
                        attachments = attachments + ManagedAttachment(file.getString("id"), name)
                }
                attachmentError = ""
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { attachmentError = e.message ?: "附件上传失败，请重新添加。" }
            finally { uploading = false }
        }
    }

    Column(Modifier.fillMaxSize().background(colors.paper)) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(54.dp)
                    .padding(start = if (split) 16.dp else 4.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (!split) {
                    IconButton(onClick = { model.select(null) }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBackIos, "返回", tint = colors.text, modifier = Modifier.size(17.dp))
                    }
                }
                EngineBadge(harnessId, 28.dp, circle = false)
                Column(Modifier.weight(1f)) {
                    Text(
                        session?.title ?: "对话",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.3).sp,
                        color = colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val dot = when (session?.runState) { "running" -> colors.success; "waiting-input" -> colors.info; "idle" -> colors.textTertiary; else -> colors.destructive }
                        Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
                        Text(
                            harnessName + " · " + (session?.stateLabel ?: "空闲"),
                            fontSize = 11.5.sp,
                            color = colors.textSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        session?.model?.let { modelName ->
                            Surface(
                                color = colors.sunken,
                                shape = RoundedCornerShape(4.dp),
                                border = BorderStroke(0.5.dp, colors.borderSubtle)
                            ) {
                                Text(
                                    modelName,
                                    fontSize = 9.5.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = colors.textSecondary,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                                )
                            }
                        }
                    }
                }
                if (matchingGoal != null && split) {
                    Surface(
                        color = colors.sunken,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.clickable { goalDetailId = matchingGoal.optString("id") }
                    ) {
                        Row(
                            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(Icons.Outlined.CheckCircle, null, modifier = Modifier.size(12.dp), tint = colors.accent)
                            Text(matchingGoal.optString("title"), fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 100.dp))
                        }
                    }
                }
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = colors.sunken,
                    border = BorderStroke(0.5.dp, colors.borderSubtle)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 2.dp)
                    ) {
                        IconButton(onClick = { workOpen = true }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Outlined.Layers, "项目工作", tint = colors.textSecondary, modifier = Modifier.size(16.dp))
                        }
                        IconButton(onClick = { usage = true }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Outlined.BarChart, "用量", tint = colors.textSecondary, modifier = Modifier.size(16.dp))
                        }
                        IconButton(onClick = { detail = true }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Outlined.Tune, "配置", tint = colors.textSecondary, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
            HorizontalDivider(color = colors.borderSubtle, thickness = 0.5.dp)
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
                if (blocks.isEmpty() && !running && inboxItems.isEmpty()) item("empty") {
                    val projectName = state.projects.firstOrNull { it.first == session?.projectId }?.second
                    ComposerWelcome(if (projectName != null) "在 " + projectName + " 中做什么？" else "今天想做些什么？",
                        Modifier.fillMaxWidth().heightIn(min = 280.dp))
                }
                itemsIndexed(blocks, key = { _, b -> b.key }) { index, block ->
                    TranscriptBlockView(block, harnessId, live = running && state.transcript.thinkingPending && index == blocks.lastIndex, continuation = continuation[index],
                        onEdit = if (state.canWrite) { row -> scope.launch { model.branch(row, true) }; Unit } else null,
                        onBranch = if (state.canWrite) { row -> scope.launch { model.branch(row, false) }; Unit } else null)
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

        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (session != null) {
                PendingComposerMessages(state, model, session)
                NativeComposerControls(state, model, session, draft, { draft = it }, attachments,
                    { id -> attachments = attachments.filterNot { it.id == id }; attachmentError = "" },
                    uploading, attachmentError, { picker.launch(arrayOf("*/*")) }) {
                    val text = draft
                    val files = attachments
                    scope.launch {
                        if (model.send(text, attachmentIds = files.map { it.id }) && draft == text) {
                            draft = ""; attachments = emptyList()
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
    if (goalDetailId != null) {
        GoalDetailScreen(goalDetailId!!, state, model) { goalDetailId = null }
    }
}


@Composable fun InteractionCard(item: InboxItem, enabled: Boolean, answer: (NativeAction) -> Unit) {
    val c = Kooyu.colors
    val form = remember(item.id, item.payload) { questionForm(item.payload) }
    var confirming by remember(item.id) { mutableStateOf<NativeAction?>(null) }
    var details by remember(item.id) { mutableStateOf(false) }
    var custom by remember(item.id) { mutableStateOf(false) }
    var json by remember(item.id) { mutableStateOf("") }
    var parseError by remember(item.id) { mutableStateOf("") }
    val params = item.payload.optJSONObject("params") ?: item.payload.optJSONObject("input") ?: item.payload
    val command = params.optString("command", params.optString("cmd", ""))
    val path = params.optString("path", params.optString("file", ""))
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = c.raised),
        border = BorderStroke(1.dp, c.border), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (form != null) Icons.Outlined.HelpOutline else Icons.Outlined.Shield, null, tint = c.info)
                Text(if (form != null) "等待你回答" else "等待你确认", style = MaterialTheme.typography.titleMedium, color = c.text)
            }
            if (command.isNotBlank() || path.isNotBlank()) SelectionContainer {
                Text(command.ifBlank { path }, fontFamily = FontFamily.Monospace, color = c.text, modifier = Modifier.fillMaxWidth())
            }
            if (item.payload.optString("protocol") == "kodo" && params.optString("schedule").isNotBlank()) SelectionContainer {
                Text(params.optString("text"), color = c.text, modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState()))
            }
            if (form != null) NativeQuestionFields(item, form, enabled, answer)
            else if (item.actions.isEmpty()) Text("此请求没有已声明的快捷选项，请核对原生请求后填写结构化回答。", color = c.textSecondary)
            else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item.actions.forEach { action ->
                    Button(onClick = { confirming = action }, enabled = enabled, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = if (action.destructive) c.sunken else c.accent,
                            contentColor = if (action.destructive) c.destructive else c.onAccent)) { Text(action.label) }
                }
            }
            TextButton(onClick = { details = !details }) { Text(if (details) "收起请求详情" else "请求详情") }
            if (details) SelectionContainer { Text(item.payload.toString(2), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.heightIn(max = 200.dp).verticalScroll(rememberScrollState())) }
            if (form == null) {
                TextButton(onClick = { custom = !custom }, enabled = enabled) { Text("结构化回答") }
                if (custom) {
                    OutlinedTextField(json, { json = it; parseError = "" }, enabled = enabled, label = { Text("原生回答 JSON") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 6)
                    if (parseError.isNotBlank()) Text(parseError, color = c.destructive)
                    TextButton(onClick = {
                        try { confirming = NativeAction("提交结构化回答", JSONObject(json), false) }
                        catch (_: Exception) { parseError = "JSON 格式无效，请填写原生协议要求的对象。" }
                    }, enabled = enabled && json.isNotBlank()) { Text("提交回答") }
                }
            }
        }
    }
    confirming?.let { action -> ConfirmDialog("确认回应此请求？", "将「${action.label}」提交到当前设备。", action.label, { confirming = null }) {
        confirming = null; answer(action)
    } }
}

@Composable fun ConfirmDialog(
    title: String,
    text: String,
    action: String,
    dismiss: () -> Unit,
    confirm: () -> Unit
) {
    val c = Kooyu.colors
    AlertDialog(
        onDismissRequest = dismiss,
        shape = RoundedCornerShape(18.dp),
        containerColor = c.raised,
        titleContentColor = c.text,
        textContentColor = c.textSecondary,
        title = { Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp, letterSpacing = (-0.3).sp) },
        text = { Text(text, fontSize = 14.sp, lineHeight = 20.sp) },
        confirmButton = {
            Button(
                onClick = confirm,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
            ) {
                Text(action, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = dismiss) {
                Text("取消", color = c.textSecondary)
            }
        }
    )
}

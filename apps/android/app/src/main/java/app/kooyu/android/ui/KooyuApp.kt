package app.kooyu.android.ui

import app.kooyu.android.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Shared X-axis slide between main destinations on Motion System 2.0 Panel / Exit curves. */
private fun tabTransition(forward: Boolean): ContentTransform =
    (slideInHorizontally(KooyuMotion.PanelIntOffset) { if (forward) it / 5 else -it / 5 } + fadeIn(KooyuMotion.base()))
        .togetherWith(slideOutHorizontally(KooyuMotion.exit()) { if (forward) -it / 6 else it / 6 } + fadeOut(KooyuMotion.exit()))

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun KooyuScreen(model: Workbench = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val pendingNotification by BackgroundReminders.pending.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var inboxOpen by rememberSaveable { mutableStateOf(false) }
    var creating by rememberSaveable(state.connection?.hostId) { mutableStateOf(false) }
    var creatingProject by rememberSaveable { mutableStateOf("") }
    var creatingHarness by rememberSaveable { mutableStateOf<String?>(null) }
    var creatingText by rememberSaveable { mutableStateOf("") }
    var devices by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    var showSplash by remember { mutableStateOf(true) }
    var backProgress by remember { mutableFloatStateOf(0f) }
    val c = Kooyu.colors
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(Unit) { KooyuLanguageStore.init(context) }
    val hostLang = state.appSettings?.nullableString("language")
    LaunchedEffect(hostLang) {
        if (!hostLang.isNullOrBlank() && hostLang != KooyuLanguageStore.setting) {
            KooyuLanguageStore.update(context, hostLang)
        }
    }
    val resolvedLocale = remember(KooyuLanguageStore.setting) {
        resolveKooyuLocale(KooyuLanguageStore.setting)
    }
    val create: (String, String?, String) -> Unit = { project, harness, initialPrompt ->
        creatingProject = project
        creatingHarness = harness
        creatingText = initialPrompt
        creating = true
    }
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
            model.openNotification(target)?.let {
                if (it == 4) inboxOpen = true else tab = it.coerceIn(0, 3)
            }
            if (BackgroundReminders.pending.value == target) BackgroundReminders.pending.value = null
        }
    }
    LaunchedEffect(state.connection?.token, state.selected) {
        val token = state.connection?.token
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            try { while (true) { model.refresh(); delay(2000) } }
            finally {
                // Changing the selected conversation restarts this effect, not the network.
                if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) model.suspended(token)
            }
        }
    }
    // A finished back gesture leaves the exiting page transformed while it slides away; reset on the next open.
    LaunchedEffect(state.selected) { if (state.selected != null) backProgress = 0f }

    CompositionLocalProvider(LocalKooyuLocale provides resolvedLocale) {
    Box(Modifier.fillMaxSize()) {
        BoxWithConstraints {
            val expanded = maxWidth >= 600.dp
            val split = maxWidth >= 840.dp
            val inConversation = !split && state.selected != null && tab == 0

            // Predictive back on phones: peels conversation with 0..28dp corners and 35% threshold haptic.
            PredictiveBackHandler(enabled = inConversation) { events ->
                var thresholdHit = false
                try {
                    events.collect {
                        backProgress = it.progress
                        if (it.progress >= 0.35f && !thresholdHit) {
                            thresholdHit = true
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        }
                    }
                    model.select(null)
                } catch (e: CancellationException) {
                    backProgress = 0f
                    throw e
                }
            }
            BackHandler(enabled = split && state.selected != null && tab == 0) { model.select(null) }

            Row(Modifier.fillMaxSize()) {
                if (state.connection != null && expanded) {
                    NavigationRail(modifier = Modifier.fillMaxHeight(), containerColor = c.navigator) {
                        Destinations(tab, true) { tab = it }
                    }
                }
                Scaffold(
                    modifier = Modifier.weight(1f),
                    containerColor = if (state.connection == null) c.paper else c.navigator,
                    topBar = {
                        if (!inConversation) KooyuTopBar(
                            deviceName = state.connection?.name,
                            online = state.online,
                            title = if (state.connection != null) when (tab) {
                                1 -> "项目"
                                2 -> "用量"
                                3 -> "设置"
                                else -> "对话"
                            } else null,
                            inboxCount = state.inbox.size,
                            onOpenInbox = if (state.connection != null) ({ inboxOpen = true }) else null,
                            showCreate = state.connection != null && tab in listOf(0, 1),
                            canCreate = state.canWrite,
                            onDevice = { if (!state.busy) devices = true },
                            onCreate = { create("", null, "") }
                        )
                    },
                    bottomBar = {
                        if (state.connection != null && !expanded && !inConversation) {
                            Box(
                                Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
                                contentAlignment = Alignment.Center
                            ) { Destinations(tab, false) { tab = it } }
                        }
                    }
                ) { padding ->
                    Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
                        // Offline errors live in the device pill and reconnect sheet instead of a banner (plan §5.1 A.1).
                        if (!inConversation && state.error.isNotBlank() && (state.connection == null || state.online)) {
                            InlineNotice(state.error, true) { model.dismissError() }
                        }
                        if (!inConversation && state.connection?.pending != null) {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = c.raised,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                            ) {
                                Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                    StatusBadge(SessionStatus("待核对事项", StatusTone.RUNNING), Modifier.weight(1f))
                                    TextButton(onClick = { clearing = true }) { Text("核对", color = c.text) }
                                }
                            }
                        }
                        if (!inConversation && state.notice.isNotBlank()) {
                            InlineNotice(state.notice, false) { model.dismissNotice(state.notice) }
                        }
                        if (state.connection == null) {
                            Column(Modifier.fillMaxSize().background(c.paper)) {
                                PairScreen(state.busy, state.requestedCloudHost) { address, code, name -> scope.launch { model.pair(address, code, name) } }
                                if (state.error.isNotBlank()) {
                                    TextButton(onClick = model::clearDamagedConnections, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                                        Text("清除损坏的本机连接", color = c.textSecondary)
                                    }
                                }
                            }
                        } else key(state.connection!!.hostId) {
                            AnimatedContent(
                                targetState = tab.coerceIn(0, 3),
                                transitionSpec = { tabTransition(targetState >= initialState) },
                                label = "TabContentTransition",
                                modifier = Modifier.weight(1f).fillMaxWidth()
                            ) { currentTab ->
                                when (currentTab) {
                                    1 -> ProjectsScreen(
                                        state = state,
                                        model = model,
                                        embedded = true,
                                        onOpenSession = { sid -> model.select(sid); tab = 0 },
                                        onCreateInProject = { pid -> create(pid, null, "") }
                                    )
                                    2 -> UsageScreen(state, model, embedded = true)
                                    3 -> SettingsScreen(state, model) { sid -> model.select(sid); tab = 0 }
                                    else -> if (split) {
                                        Row(Modifier.fillMaxSize()) {
                                            Box(Modifier.width(360.dp).fillMaxHeight()) { HomeScreen(state, model, create) }
                                            VerticalDivider(color = c.borderSubtle)
                                            Box(Modifier.weight(1f).fillMaxHeight()) {
                                                if (state.selected == null) EmptyConversationPlaceholder()
                                                else ConversationScreen(state, model, split = true)
                                            }
                                        }
                                    } else {
                                        val pushFraction by animateFloatAsState(
                                            targetValue = if (state.selected != null) (1f - backProgress).coerceIn(0f, 1f) else 0f,
                                            animationSpec = KooyuMotion.PanelFloat,
                                            label = "homeParallax"
                                        )
                                        Box(Modifier.fillMaxSize()) {
                                            Box(
                                                Modifier
                                                    .fillMaxSize()
                                                    .graphicsLayer {
                                                        val s = 1f - 0.05f * pushFraction
                                                        scaleX = s
                                                        scaleY = s
                                                        translationX = -size.width * 0.18f * pushFraction
                                                    }
                                            ) {
                                                HomeScreen(state, model, create)
                                            }
                                            if (pushFraction > 0.005f) {
                                                Box(
                                                    Modifier
                                                        .fillMaxSize()
                                                        .background(Color.Black.copy(alpha = 0.22f * pushFraction))
                                                        .clickable(
                                                            interactionSource = remember { MutableInteractionSource() },
                                                            indication = null,
                                                            onClick = {}
                                                        )
                                                )
                                            }
                                            androidx.compose.animation.AnimatedVisibility(
                                                visible = state.selected != null,
                                                enter = slideInHorizontally(KooyuMotion.PanelIntOffset) { it } + fadeIn(KooyuMotion.base()),
                                                exit = slideOutHorizontally(KooyuMotion.PanelIntOffset) { it } + fadeOut(KooyuMotion.exit()),
                                                modifier = Modifier.fillMaxSize()
                                            ) {
                                                Box(
                                                    Modifier
                                                        .fillMaxSize()
                                                        .graphicsLayer {
                                                            val p = backProgress
                                                            translationX = size.width * 0.16f * p
                                                            val s = 1f - 0.04f * p
                                                            scaleX = s
                                                            scaleY = s
                                                            shape = RoundedCornerShape((28f * p).dp)
                                                            clip = p > 0f
                                                        }
                                                ) {
                                                    ConversationScreen(state, model, split = false)
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
        }

        if (inboxOpen && state.connection != null) {
            FullScreenPage("收件箱 · 待办", { inboxOpen = false }) { padding ->
                Box(Modifier.fillMaxSize().background(c.navigator).padding(padding)) {
                    InboxTab(state, model, showLargeTitle = false) { sessionId ->
                        inboxOpen = false
                        model.select(sessionId)
                        tab = 0
                    }
                }
            }
        }
        if (devices && state.connection != null) ReconnectSheet(state, model) { devices = false }
        if (creating && state.connection != null) DraftSessionSheet(state, model, initialProject = creatingProject, initialText = creatingText, initialHarness = creatingHarness) { creating = false; creatingText = ""; tab = 0 }
        if (state.addingDevice && state.connection != null) {
            FullScreenPage("添加设备", { model.addDevice(false) }) { padding ->
                Column(Modifier.padding(padding)) {
                    if (state.error.isNotBlank()) Text(state.error, color = c.destructive, modifier = Modifier.padding(16.dp))
                    PairScreen(state.busy, state.requestedCloudHost) { address, code, name -> scope.launch { model.pair(address, code, name) } }
                }
            }
        }
        if (clearing) {
            ConfirmDialog("核对确认", "清除本机待核对标记", "确认", { clearing = false }) { clearing = false; runCatching { model.clearPending() } }
        }
        if (showSplash) MobiusSplashScreen(
            ready = state.connection == null || state.online || state.sessions.isNotEmpty(),
            onDismiss = { showSplash = false }
        )
    }
    }
}

/** Compact, dismissible notice row (errors in destructive ink, notices in secondary ink). */
@Composable private fun InlineNotice(text: String, error: Boolean, dismiss: () -> Unit) {
    val c = Kooyu.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp))
            .background(if (error) c.destructiveTint else c.raised).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (error) PulsingDot(c.destructive, pulsing = false)
        Text(text, style = KooyuType.caption, fontSize = 12.sp, fontWeight = if (error) FontWeight.SemiBold else FontWeight.Medium,
            color = if (error) c.destructive else c.textSecondary, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
        IconButton(onClick = dismiss, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Outlined.Close, "关闭提示", tint = c.textTertiary, modifier = Modifier.size(15.dp))
        }
    }
}

package app.kooyu.android.ui.conversation

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.screens.*

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBackIos
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class TodoTaskItem(val content: String, val status: String)

private fun extractLatestTodos(rows: List<TranscriptRow>): List<TodoTaskItem> {
    var latest = emptyList<TodoTaskItem>()
    for (row in rows) {
        if (row.role != RowRole.TOOL) continue
        val input = row.payload?.optJSONObject("input") ?: continue
        val arr = input.optJSONArray("todos") ?: continue
        val parsed = (0 until arr.length()).mapNotNull { idx ->
            val obj = arr.optJSONObject(idx) ?: return@mapNotNull null
            val text = obj.optString("content").trim().ifEmpty { obj.optString("title").trim() }
            if (text.isEmpty()) null else TodoTaskItem(text, obj.optString("status", "pending"))
        }
        if (parsed.isNotEmpty()) latest = parsed
    }
    return latest
}

@Composable internal fun EmptyConversationPlaceholder() {
    val c = Kooyu.colors
    Box(Modifier.fillMaxSize().background(c.paper).padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Outlined.Forum, null, modifier = Modifier.size(40.dp), tint = c.textTertiary)
            Text("选择一个会话", style = KooyuType.pageTitle, color = c.textSecondary)
        }
    }
}

/**
 * Clean Conversation Top Bar:
 * - Back + Title + Subtitle (`Engine · Status · formatWorkspaceLabel · [⑂ N 子代理 ▾]`)
 * - Single primary `[ⓘ]` inspector action on mobile (Goal badge also available on split wide screens)
 */
@Composable private fun ConversationTopBar(
    session: HostSession?,
    harnessName: String,
    location: String?,
    split: Boolean,
    goalTitle: String?,
    subagentCount: Int,
    selectedSubagentName: String?,
    onBack: () -> Unit,
    onGoal: () -> Unit,
    onSubagentClick: () -> Unit,
    onInspector: () -> Unit,
) {
    val c = Kooyu.colors
    Box(Modifier.fillMaxWidth()) {
        Box(Modifier.matchParentSize().kooyuGlassSurface(topHighlight = false))
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(start = if (split) 16.dp else 10.dp, end = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (!split) {
                    Box(
                        Modifier
                            .size(44.dp)
                            .kooyuPressable(onClickLabel = "返回会话列表") { onBack() },
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            Modifier
                                .size(35.dp)
                                .clip(androidx.compose.foundation.shape.CircleShape)
                                .background(c.raised.copy(alpha = 0.90f))
                                .border(0.5.dp, c.border, androidx.compose.foundation.shape.CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.ArrowBackIos,
                                "返回会话列表",
                                tint = c.text,
                                modifier = Modifier.size(15.dp).offset(x = 2.dp)
                            )
                        }
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        session?.title?.ifBlank { "未命名会话" } ?: "对话",
                        style = KooyuType.rowTitle,
                        fontSize = 15.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = c.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        EngineBadge(session?.harnessId, 14.dp, circle = false)
                        Text(harnessName, style = KooyuType.caption, fontWeight = FontWeight.Medium, color = c.textSecondary, maxLines = 1)
                        if (session != null && session.runState != "idle") {
                            Text("·", style = KooyuType.caption, color = c.textTertiary)
                            StatusBadge(sessionStatus(session))
                        }
                        if (!location.isNullOrBlank()) {
                            Text("·", style = KooyuType.caption, color = c.textTertiary)
                            Text(location, style = KooyuType.caption, color = c.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        }
                        if (subagentCount > 0) {
                            Row(
                                Modifier
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (selectedSubagentName != null) c.brandCoralTint else c.sunken)
                                    .border(0.5.dp, if (selectedSubagentName != null) c.brandCoral.copy(alpha = 0.4f) else c.borderSubtle, RoundedCornerShape(10.dp))
                                    .clickable(onClickLabel = "切换子代理视图", onClick = onSubagentClick)
                                    .padding(horizontal = 7.dp, vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                Icon(Icons.Outlined.AccountTree, null, tint = if (selectedSubagentName != null) c.brandCoral else c.textSecondary, modifier = Modifier.size(11.dp))
                                Text(
                                    selectedSubagentName ?: "$subagentCount 子代理 ▾",
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (selectedSubagentName != null) c.brandCoral else c.textSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }
                if (goalTitle != null && split) {
                    Row(
                        Modifier.clip(RoundedCornerShape(8.dp)).background(c.sunken).clickable(onClick = onGoal).padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(Icons.Outlined.CheckCircle, null, modifier = Modifier.size(12.dp), tint = c.text)
                        Text(goalTitle, style = KooyuType.caption, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 100.dp))
                    }
                }
                Box(
                    Modifier
                        .size(44.dp)
                        .kooyuPressable(onClickLabel = "会话检查器") { onInspector() },
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        Modifier
                            .size(35.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(c.raised.copy(alpha = 0.90f))
                            .border(0.5.dp, c.border, androidx.compose.foundation.shape.CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Outlined.Info, "会话检查器", tint = c.text, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable internal fun ConversationScreen(state: WorkbenchState, model: Workbench, split: Boolean = false) {
    var draft by rememberSaveable(state.connection?.hostId, state.selected) { mutableStateOf(model.savedDraft(state.connection?.hostId, state.selected)) }
    val ownerHost = state.connection?.hostId
    val ownerSession = state.selected
    val draftSnapshot = remember(ownerHost, ownerSession) { mutableStateOf(draft) }
    draftSnapshot.value = draft
    DisposableEffect(ownerHost, ownerSession) { onDispose { model.saveDraft(ownerHost, ownerSession, draftSnapshot.value) } }
    LaunchedEffect(draft, ownerHost, ownerSession) { delay(300); model.saveDraft(ownerHost, ownerSession, draft) }

    var inspector by remember { mutableStateOf(false) }
    var usage by remember { mutableStateOf(false) }
    var goalDetailId by remember { mutableStateOf<String?>(null) }
    var subagentSheetOpen by remember { mutableStateOf(false) }
    var activeAgentId by rememberSaveable(state.connection?.hostId, state.selected) { mutableStateOf<String?>(null) }
    var todoExpanded by rememberSaveable(state.selected) { mutableStateOf(false) }
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
    val projectName = state.projects.firstOrNull { it.first == session?.projectId }?.second
    val workspacePath = state.workspaces.firstOrNull { it.id == session?.workspaceId }?.path
    val location = workspacePath?.let { formatWorkspaceLabel(it).ifBlank { null } } ?: projectName

    val matchingGoal = remember(state.snapshot, state.selected) {
        state.snapshot.optJSONArray("goals")?.objects()?.firstOrNull {
            it.optString("controllerSessionId") == state.selected ||
                it.optJSONArray("sessionIds")?.let { arr -> (0 until arr.length()).any { i -> arr.getString(i) == state.selected } } == true
        }
    }

    val subagents = remember(state.transcript) { state.transcript.rows.mapNotNull { it.child }.distinctBy { it.agentId } }
    val activeSubagent = subagents.firstOrNull { it.agentId == activeAgentId }
    val displayedTranscript = remember(state.transcript, activeSubagent) {
        if (activeSubagent != null) buildTranscript(activeSubagent.events) else state.transcript
    }
    val todos = remember(state.transcript.rows) { extractLatestTodos(state.transcript.rows) }
    val blocks = remember(displayedTranscript) { transcriptBlocks(displayedTranscript.rows) }
    val continuation = remember(blocks) { continuationFlags(blocks) }
    val inboxItems = if (activeSubagent == null) state.inbox.filter { it.sessionId == state.selected } else emptyList()

    val positionKey = (state.connection?.hostId ?: "") + ":" + state.selected + ":" + (activeSubagent?.agentId ?: "main")
    val savedPosition = remember(positionKey) { model.readingPositions[positionKey] }
    val listState = rememberLazyListState(savedPosition?.first ?: 0, savedPosition?.second ?: 0)
    DisposableEffect(positionKey) { onDispose { model.readingPositions[positionKey] = listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset } }

    val atBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()
            last == null || (last.index >= info.totalItemsCount - 1 && last.offset + last.size <= info.viewportEndOffset + 120)
        }
    }
    val jumpThreshold = with(LocalDensity.current) { 240.dp.toPx() }
    val farFromBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull() ?: return@derivedStateOf false
            val hiddenBelow = info.visibleItemsInfo.filter { it.index >= info.totalItemsCount - 2 }.sumOf { (it.offset + it.size - info.viewportEndOffset).coerceAtLeast(0) }
            last.index < info.totalItemsCount - 2 || hiddenBelow > jumpThreshold
        }
    }
    val tailSignature = blocks.size.toString() + ":" + (displayedTranscript.rows.lastOrNull()?.text?.length ?: 0) + ":" + inboxItems.size + ":" + running
    var followed by remember(positionKey) { mutableStateOf(savedPosition != null) }
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

    Column(Modifier.fillMaxSize().background(colors.paper).imePadding()) {
        ConversationTopBar(
            session = session,
            harnessName = harnessName,
            location = location,
            split = split,
            goalTitle = matchingGoal?.optString("title"),
            subagentCount = subagents.size,
            selectedSubagentName = activeSubagent?.let { it.name ?: it.agentId },
            onBack = { model.select(null) },
            onGoal = { goalDetailId = matchingGoal?.optString("id") },
            onSubagentClick = { subagentSheetOpen = true },
            onInspector = { inspector = true }
        )

        // Pinned [← 返回主对话] banner when viewing a subagent transcript on mobile
        AnimatedVisibility(
            visible = activeSubagent != null,
            enter = expandVertically(KooyuMotion.BaseIntSize) + fadeIn(KooyuMotion.base()),
            exit = shrinkVertically(KooyuMotion.BaseIntSize) + fadeOut(KooyuMotion.snap())
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(colors.brandCoralTint)
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Outlined.AccountTree, null, tint = colors.brandCoral, modifier = Modifier.size(15.dp))
                Text(
                    "正在查看子代理：${activeSubagent?.name ?: activeSubagent?.agentId}",
                    style = KooyuType.label,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = colors.paper,
                    border = BorderStroke(0.5.dp, colors.border),
                    modifier = Modifier
                        .heightIn(min = 32.dp)
                        .clickable { activeAgentId = null }
                ) {
                    Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBackIos, null, tint = colors.text, modifier = Modifier.size(11.dp))
                        Text("返回主对话", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
                    }
                }
            }
        }

        // Collapsed TodoPanel summary pill defaulting collapsed on mobile
        AnimatedVisibility(visible = activeSubagent == null && todos.isNotEmpty()) {
            val doneCount = todos.count { it.status == "completed" }
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = colors.sunken,
                    border = BorderStroke(0.5.dp, colors.borderSubtle),
                    modifier = Modifier.fillMaxWidth().clickable { todoExpanded = !todoExpanded }
                ) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.Checklist, null, tint = if (doneCount == todos.size) colors.doneText else colors.info, modifier = Modifier.size(16.dp))
                            Text("任务进度 · 已完成 $doneCount / ${todos.size}", style = KooyuType.label, fontWeight = FontWeight.SemiBold, color = colors.text, modifier = Modifier.weight(1f))
                            Icon(if (todoExpanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = colors.textTertiary, modifier = Modifier.size(16.dp))
                        }
                        AnimatedVisibility(todoExpanded, enter = expandVertically(KooyuMotion.BaseIntSize) + fadeIn(KooyuMotion.base()), exit = shrinkVertically(KooyuMotion.BaseIntSize) + fadeOut(KooyuMotion.snap())) {
                            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                todos.forEach { todo ->
                                    val done = todo.status == "completed"
                                    val inProg = todo.status == "in_progress"
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Icon(
                                            when {
                                                done -> Icons.Outlined.CheckCircle
                                                inProg -> Icons.Outlined.PlayCircleOutline
                                                else -> Icons.Outlined.RadioButtonUnchecked
                                            },
                                            null,
                                            tint = when {
                                                done -> colors.doneText
                                                inProg -> colors.info
                                                else -> colors.textTertiary
                                            },
                                            modifier = Modifier.size(14.dp)
                                        )
                                        Text(
                                            todo.content,
                                            style = KooyuType.caption,
                                            fontSize = 12.sp,
                                            color = if (done) colors.textTertiary else colors.text,
                                            textDecoration = if (done) TextDecoration.LineThrough else TextDecoration.None
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                Modifier.fillMaxSize().imeNestedScroll(),
                state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (state.older && activeSubagent == null) item("older") {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        TextButton(onClick = { scope.launch { model.loadOlder() } }, enabled = !state.loadingHistory) {
                            Text(if (state.loadingHistory) "加载中…" else "更早记录", style = KooyuType.label, color = colors.textSecondary)
                        }
                    }
                }
                if (blocks.isEmpty() && !running && inboxItems.isEmpty() && activeSubagent == null) item("empty") {
                    ComposerWelcome(
                        title = if (session?.kind == "supervisor") "今天想推进什么？" else "与 ${harnessName.substringBefore(" · ")} 直接对话",
                        modifier = Modifier.fillMaxWidth().heightIn(min = 280.dp),
                        harnessId = harnessId,
                    )
                }
                itemsIndexed(blocks, key = { _, b -> b.key }) { index, block ->
                    val singleRow = (block as? TranscriptBlock.Single)?.row
                    val activeConv = state.conversation ?: session?.raw?.optJSONObject("conversation")
                    val rowVariants = remember(singleRow, activeConv, state.busy, state.canWrite) {
                        if (singleRow != null && activeSubagent == null) {
                            resolveMessageVariants(singleRow, activeConv, !state.canWrite || state.busy) { targetBranchId ->
                                scope.launch { model.selectMessageBranch(targetBranchId) }
                            }
                        } else null
                    }
                    Box(Modifier.animateItem(fadeInSpec = KooyuMotion.base(), placementSpec = KooyuMotion.BaseIntOffset, fadeOutSpec = KooyuMotion.snap())) {
                        TranscriptBlockView(
                            block,
                            harnessId,
                            live = running && displayedTranscript.thinkingPending && index == blocks.lastIndex,
                            continuation = continuation[index],
                            subagent = activeSubagent != null,
                            modelName = session?.model,
                            onEditSave = if (state.canWrite && activeSubagent == null) { row, editedText -> model.editMessage(row, editedText) } else null,
                            onBranch = if (state.canWrite && activeSubagent == null) { row -> scope.launch { model.branch(row, false) }; Unit } else null,
                            variants = rowVariants,
                        )
                    }
                }
                if (running && activeSubagent == null) item("running") {
                    val starting = session?.raw?.optString("connectionState").let { it != null && it.isNotEmpty() && it != "connected" }
                    RunIndicator(if (starting) "正在启动 $harnessName…" else "原生执行中")
                }
                items(inboxItems, key = { "inbox-" + it.id }) { item ->
                    Box(Modifier.animateItem(fadeInSpec = KooyuMotion.base(), placementSpec = KooyuMotion.BaseIntOffset)) {
                        InteractionCard(item, state.canWrite) { action -> scope.launch { model.answer(item, action) } }
                    }
                }
                item("tail") { Spacer(Modifier.height(1.dp)) }
            }
            androidx.compose.animation.AnimatedVisibility(
                farFromBottom && blocks.isNotEmpty(),
                Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 12.dp),
                enter = scaleIn(KooyuMotion.snap(), 0.6f) + fadeIn(KooyuMotion.snap()),
                exit = scaleOut(KooyuMotion.snap(), 0.6f) + fadeOut(KooyuMotion.snap())
            ) {
                JumpToBottomPill(streaming = running) {
                    scope.launch { listState.animateScrollToItem((listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0), Int.MAX_VALUE / 2) }
                }
            }
        }

        if (activeSubagent == null) {
            Column(Modifier.fillMaxWidth().background(colors.paper).padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (session != null) {
                    PendingComposerMessages(state, model, session)
                    NativeComposerControls(
                        state, model, session, draft, { draft = it }, attachments,
                        { id -> attachments = attachments.filterNot { it.id == id }; attachmentError = "" },
                        uploading, attachmentError, { picker.launch(arrayOf("*/*")) }
                    ) {
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
    }

    if (subagentSheetOpen) {
        ModalBottomSheet(onDismissRequest = { subagentSheetOpen = false }, containerColor = colors.raised, dragHandle = { KooyuSheetHandle() }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("子代理切换", style = KooyuType.pageTitle, fontSize = 17.sp, color = colors.text, modifier = Modifier.padding(horizontal = 4.dp))
                InsetGroupCard {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { activeAgentId = null; subagentSheetOpen = false }.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Outlined.Forum, null, tint = if (activeAgentId == null) colors.brandCoral else colors.textSecondary, modifier = Modifier.size(18.dp))
                        Text("主对话", style = KooyuType.rowTitle, color = colors.text, modifier = Modifier.weight(1f))
                        if (activeAgentId == null) Icon(Icons.Outlined.Check, "当前", tint = colors.brandCoral, modifier = Modifier.size(16.dp))
                    }
                    subagents.forEach { agent ->
                        InsetDivider(44)
                        val isSelected = activeAgentId == agent.agentId
                        val statusText = SUBAGENT_STATUS[agent.status.orEmpty()] ?: agent.status ?: "状态未知"
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { activeAgentId = agent.agentId; subagentSheetOpen = false }.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(Icons.Outlined.AccountTree, null, tint = if (isSelected) colors.brandCoral else colors.textSecondary, modifier = Modifier.size(18.dp))
                            Column(Modifier.weight(1f)) {
                                Text(agent.name ?: agent.agentId, style = KooyuType.rowTitle, color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(statusText, style = KooyuType.caption, color = colors.textSecondary)
                            }
                            if (isSelected) Icon(Icons.Outlined.Check, "当前", tint = colors.brandCoral, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }

    if (inspector && session != null) InspectorSheet(state, model, session, onUsage = { inspector = false; usage = true }) { inspector = false }
    if (usage) {
        FullScreenPage("会话用量", { usage = false }) { padding ->
            Box(Modifier.padding(padding)) { UsageScreen(state, model, state.selected) }
        }
    }
    if (goalDetailId != null) GoalDetailScreen(goalDetailId!!, state, model) { goalDetailId = null }
}

/** Plan §5.1 C.2 JumpToBottomFab: a pill with a live dot while the turn is still streaming. */
@Composable private fun JumpToBottomPill(streaming: Boolean, onClick: () -> Unit) {
    val c = Kooyu.colors
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = c.raised,
        shadowElevation = 4.dp,
        border = BorderStroke(0.5.dp, c.border),
        modifier = Modifier.kooyuPressable(onClickLabel = "回到底部") { onClick() }
    ) {
        Row(Modifier.height(38.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (streaming) PulsingDot(c.info, pulsing = true)
            Text(if (streaming) "新输出" else "回到底部", style = KooyuType.label, fontWeight = FontWeight.SemiBold, color = c.text)
            Icon(Icons.Outlined.KeyboardArrowDown, null, tint = c.text, modifier = Modifier.size(18.dp))
        }
    }
}

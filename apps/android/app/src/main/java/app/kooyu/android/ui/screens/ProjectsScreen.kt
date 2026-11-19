package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun ProjectsScreen(
    state: WorkbenchState,
    model: Workbench,
    embedded: Boolean = false,
    onOpenSession: ((String) -> Unit)? = null,
    onCreateInProject: ((String) -> Unit)? = null,
) {
    val c = Kooyu.colors
    val scope = rememberCoroutineScope()
    var adding by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var root by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<Pair<String, String>?>(null) }
    var deleting by remember { mutableStateOf<Pair<String, String>?>(null) }
    var addWorkspace by remember { mutableStateOf<String?>(null) }
    var browser by remember { mutableStateOf<HostWorkspace?>(null) }
    var workProject by remember { mutableStateOf<String?>(null) }
    var hubSection by rememberSaveable { mutableStateOf("projects") }

    if (workProject != null) {
        WorkHubScreen(state, model, initialProject = workProject!!, embedded = false) { workProject = null }
    }

    val globalWorkspaces = remember(state.workspaces) { state.workspaces.filter { it.projectId == null } }

    Column(Modifier.fillMaxSize().background(c.navigator)) {
        Box(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp)) {
            KooyuSegmentedControl(
                options = listOf(
                    SegmentOption("projects", "项目与目录"),
                    SegmentOption("work", "工作与计划")
                ),
                selected = hubSection,
                onSelect = { hubSection = it },
                modifier = Modifier.fillMaxWidth()
            )
        }
        if (hubSection == "work") {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                WorkHubScreen(state, model, embedded = true)
            }
        } else LazyColumn(
        Modifier.weight(1f).fillMaxWidth().background(c.navigator),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item("summary-bar") {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "${state.projects.size} 个项目 · ${state.workspaces.size} 个工作目录",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = c.textSecondary,
                    modifier = Modifier.padding(start = 2.dp)
                )
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = c.accent,
                    modifier = Modifier.kooyuPressable(enabled = state.canWrite, onClickLabel = "新建项目") {
                        name = ""; root = ""; adding = true
                    }
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(Icons.Outlined.CreateNewFolder, null, tint = c.onAccent, modifier = Modifier.size(15.dp))
                        Text("新建项目", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.onAccent)
                    }
                }
            }
        }

        if (state.projects.isEmpty()) {
            item("empty-projects") {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        Modifier.padding(horizontal = 24.dp, vertical = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            Modifier.size(44.dp).clip(RoundedCornerShape(13.dp)).background(c.sunken),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.FolderOpen, null, modifier = Modifier.size(22.dp), tint = c.textSecondary)
                        }
                        Text("暂无项目", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                    }
                }
            }
        }

        items(state.projects, key = { "proj-" + it.first }) { project ->
            val projectWorkspaces = state.workspaces.filter { it.projectId == project.first }
            val projectSessions = state.sessions
                .filter { it.projectId == project.first && !it.archived }
                .sortedByDescending { it.createdAt ?: "" }
            val activeCount = projectSessions.count { it.runState == "running" || it.runState == "waiting-input" }
            var menuOpen by remember { mutableStateOf(false) }

            Surface(
                shape = RoundedCornerShape(18.dp),
                color = c.raised,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                shadowElevation = if (c.dark) 0.dp else 0.5.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                        Box(
                            Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)).background(c.sunken).border(0.5.dp, c.borderSubtle, RoundedCornerShape(11.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.Folder, null, tint = c.text, modifier = Modifier.size(20.dp))
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(project.second, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("${projectSessions.size} 个对话", fontSize = 12.sp, color = c.textSecondary)
                                if (activeCount > 0) {
                                    Text("·", fontSize = 12.sp, color = c.textTertiary)
                                    PulsingDot(c.info, pulsing = true, size = 5.dp)
                                    Text("$activeCount 运行中", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.info)
                                }
                            }
                        }
                        Box {
                            IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(34.dp)) {
                                Icon(Icons.Outlined.MoreHoriz, "项目操作", tint = c.textSecondary, modifier = Modifier.size(18.dp))
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, modifier = Modifier.background(c.raised)) {
                                DropdownMenuItem(
                                    text = { Text("添加代码目录", color = c.text) },
                                    onClick = { menuOpen = false; addWorkspace = project.first; root = "" }
                                )
                                DropdownMenuItem(
                                    text = { Text("重命名项目", color = c.text) },
                                    onClick = { menuOpen = false; editing = project; name = project.second }
                                )
                                DropdownMenuItem(
                                    text = { Text("删除项目", color = c.destructive) },
                                    onClick = { menuOpen = false; deleting = project }
                                )
                            }
                        }
                    }

                    // Bound code workspace directories (tap to browse files & Git diffs!)
                    if (projectWorkspaces.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            projectWorkspaces.forEach { ws ->
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(11.dp))
                                        .background(c.sunken)
                                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(11.dp))
                                        .clickable { browser = ws }
                                        .padding(horizontal = 11.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Icon(Icons.Outlined.Terminal, null, modifier = Modifier.size(15.dp), tint = c.textSecondary)
                                    Text(
                                        ws.path,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 12.sp,
                                        color = c.text,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Text("浏览源码", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = c.textSecondary)
                                    Icon(Icons.Outlined.ChevronRight, null, modifier = Modifier.size(15.dp), tint = c.textTertiary)
                                }
                            }
                        }
                    }

                    // Recent sessions inside this project (up to 2 quick links)
                    if (projectSessions.isNotEmpty() && onOpenSession != null) {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                        ) {
                            projectSessions.take(2).forEachIndexed { idx, s ->
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { onOpenSession(s.id) }
                                        .padding(horizontal = 11.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    EngineBadge(s.harnessId, 22.dp, circle = false)
                                    Text(
                                        s.title.ifBlank { "未命名对话" },
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = c.text,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    StatusBadge(sessionStatus(s), emphasize = false)
                                }
                                if (idx < minOf(2, projectSessions.size) - 1) {
                                    HorizontalDivider(color = c.borderSubtle, thickness = 0.5.dp, modifier = Modifier.padding(start = 41.dp))
                                }
                            }
                        }
                    }

                    // Project action pills
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (onCreateInProject != null) {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = c.sunken,
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.weight(1f).kooyuPressable(enabled = state.canWrite, onClickLabel = "在项目新建对话") {
                                    onCreateInProject(project.first)
                                }
                            ) {
                                Row(
                                    Modifier.padding(vertical = 8.dp),
                                    horizontalArrangement = Arrangement.Center,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Outlined.AddComment, null, tint = c.text, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text("新建对话", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                                }
                            }
                        }
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = c.sunken,
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier.weight(1f).kooyuPressable(onClickLabel = "查看项目目标与成果") {
                                workProject = project.first
                            }
                        ) {
                            Row(
                                Modifier.padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Outlined.Layers, null, tint = c.text, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("目标与成果", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                            }
                        }
                    }
                }
            }
        }

        item("global-workspaces-header") {
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("全局工作目录", style = KooyuType.sectionHeader, fontSize = 12.sp, color = c.textTertiary, modifier = Modifier.padding(start = 4.dp))
                TextButton(
                    onClick = { addWorkspace = ""; root = "" },
                    enabled = state.canWrite,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Icon(Icons.Outlined.Add, null, tint = c.textSecondary, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(3.dp))
                    Text("绑定全局目录", fontSize = 12.sp, color = c.textSecondary)
                }
            }
        }

        if (globalWorkspaces.isEmpty()) {
            item("global-workspaces-empty") {
                Surface(
                    shape = RoundedCornerShape(15.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "未绑定独立全局目录，所有目录均已归属在各自项目下。",
                        fontSize = 12.5.sp,
                        color = c.textTertiary,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)
                    )
                }
            }
        } else {
            items(globalWorkspaces, key = { "gws-" + it.id }) { ws ->
                Surface(
                    shape = RoundedCornerShape(15.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth().clickable { browser = ws }
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Outlined.FolderOpen, null, tint = c.textSecondary, modifier = Modifier.size(18.dp))
                        Text(ws.path, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, color = c.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
    }

    if (adding || editing != null || addWorkspace != null) {
        AlertDialog(
            onDismissRequest = { adding = false; editing = null; addWorkspace = null },
            containerColor = c.raised,
            title = {
                Text(
                    if (addWorkspace != null) "添加工作目录" else if (editing != null) "重命名项目" else "新建项目",
                    fontWeight = FontWeight.Bold,
                    color = c.text
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (addWorkspace == null) {
                        Box(
                            Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(c.sunken)
                                .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                            contentAlignment = Alignment.CenterStart
                        ) {
                            BasicTextField(
                                value = name,
                                onValueChange = { name = it.take(100) },
                                singleLine = true,
                                textStyle = KooyuType.body.copy(color = c.text),
                                cursorBrush = SolidColor(c.brandCoral),
                                modifier = Modifier.fillMaxWidth(),
                                decorationBox = { inner ->
                                    if (name.isEmpty()) Text("项目名称（如 agent-harness）", style = KooyuType.body, color = c.textTertiary)
                                    inner()
                                }
                            )
                        }
                    }
                    if (editing == null) {
                        Box(
                            Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(c.sunken)
                                .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                            contentAlignment = Alignment.CenterStart
                        ) {
                            BasicTextField(
                                value = root,
                                onValueChange = { root = it },
                                singleLine = true,
                                textStyle = KooyuType.body.copy(color = c.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                                cursorBrush = SolidColor(c.brandCoral),
                                modifier = Modifier.fillMaxWidth(),
                                decorationBox = { inner ->
                                    if (root.isEmpty()) Text(if (addWorkspace == null) "设备代码路径（选填）" else "设备代码绝对路径", style = KooyuType.body, fontSize = 13.sp, color = c.textTertiary)
                                    inner()
                                }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            val result = when {
                                addWorkspace != null -> model.execute("/workspaces", body = JSONObject().put("projectId", addWorkspace?.ifEmpty { null } ?: JSONObject.NULL).put("rootPath", root.trim()))
                                editing != null -> model.execute("/projects/" + editing!!.first, "PATCH", JSONObject().put("name", name.trim()))
                                else -> model.execute("/projects", body = JSONObject().put("name", name.trim()).apply { if (root.isNotBlank()) put("rootPath", root.trim()) })
                            }
                            if (result != null) { adding = false; editing = null; addWorkspace = null }
                        }
                    },
                    enabled = state.canWrite && if (addWorkspace != null) root.isNotBlank() else name.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { adding = false; editing = null; addWorkspace = null }) { Text("取消", color = c.textSecondary) } }
        )
    }

    deleting?.let { project ->
        ConfirmDialog("删除项目「${project.second}」？", "删除项目不会丢失对话，关联会话将自动保留在全局对话列表中。", "删除项目", { deleting = null }) {
            scope.launch {
                if (model.execute("/projects/" + project.first + "?sessions=keep", "DELETE", null) != null) deleting = null
            }
        }
    }

    browser?.let { workspace ->
        FullScreenPage("工作区源码与变更", { browser = null }) { padding ->
            Box(Modifier.fillMaxSize().background(c.navigator).padding(padding)) {
                WorkspaceBrowser(workspace, state, model)
            }
        }
    }
}

@Composable fun WorkspaceBrowser(workspace: HostWorkspace, state: WorkbenchState, model: Workbench) {
    val c = Kooyu.colors
    var path by remember { mutableStateOf("") }
    var changes by remember { mutableStateOf(false) }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var requestedFile by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    LaunchedEffect(state.connection?.hostId, workspace.id, path, changes, requestedFile) {
        loading = true
        data = null
        preview = null
        val base = "/workspaces/" + workspace.id
        if (requestedFile != null) {
            preview = model.read(base + if (changes) "/changes/diff?path=" + encoded(requestedFile!!) else "/files/preview?path=" + encoded(requestedFile!!))
        } else {
            data = model.read(base + if (changes) "/changes" else "/files?path=" + encoded(path))
        }
        loading = false
    }

    Column(Modifier.fillMaxSize().background(c.navigator)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(workspace.path, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            KooyuSegmentedControl(
                options = listOf(SegmentOption(false, "文件列表"), SegmentOption(true, "Git 变更")),
                selected = changes,
                onSelect = { changes = it; requestedFile = null },
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (requestedFile != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { requestedFile = null }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回列表", tint = c.text)
                }
                Text(requestedFile!!, fontFamily = FontFamily.Monospace, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        } else if (path.isNotEmpty() && !changes) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { path = path.substringBeforeLast('/', "") }) {
                    Icon(Icons.Outlined.ArrowUpward, null, tint = c.text, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(5.dp))
                    Text("返回上级 · $path", fontSize = 12.5.sp, color = c.text)
                }
            }
        }

        if (loading) LinearProgressIndicator(color = c.accent, trackColor = c.sunken, modifier = Modifier.fillMaxWidth().height(2.dp))

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            preview?.let { value ->
                item {
                    Surface(
                        color = c.raised,
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(0.5.dp, c.borderSubtle),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        SelectionContainer {
                            Text(
                                value.nullableString("text") ?: value.nullableString("reason") ?: "此文件为二进制内容，暂不能作为文本查看。",
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp,
                                lineHeight = 18.sp,
                                color = c.text,
                                modifier = Modifier.padding(14.dp)
                            )
                        }
                    }
                }
            }

            val entries = (data?.optJSONArray(if (changes) "files" else "entries")?.objects() ?: emptyList())
            if (!loading && requestedFile == null && entries.isEmpty()) {
                item {
                    Surface(shape = RoundedCornerShape(14.dp), color = c.raised, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                        Text(data?.nullableString("error") ?: if (changes) "工作区干净，暂无未提交的 Git 变更。" else "目录为空。", fontSize = 13.sp, color = c.textSecondary, modifier = Modifier.padding(18.dp))
                    }
                }
            }

            items(entries, key = { it.getString("path") }) { entry ->
                val isDir = entry.optString("kind") == "directory"
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (isDir) path = entry.getString("path")
                            else requestedFile = entry.getString("path")
                        }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            if (isDir) Icons.Outlined.Folder else Icons.AutoMirrored.Outlined.InsertDriveFile,
                            null,
                            tint = if (isDir) c.text else c.textSecondary,
                            modifier = Modifier.size(19.dp)
                        )
                        Text(
                            entry.optString("name", entry.getString("path")),
                            fontSize = 13.5.sp,
                            fontWeight = if (isDir) FontWeight.SemiBold else FontWeight.Normal,
                            color = c.text,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (changes) {
                            val status = entry.optString("status")
                            Surface(color = c.sunken, shape = RoundedCornerShape(5.dp), border = BorderStroke(0.5.dp, c.borderSubtle)) {
                                Text(status, fontFamily = FontFamily.Monospace, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                            }
                        } else if (isDir) {
                            Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }
}

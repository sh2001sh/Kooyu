package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.R

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

@Composable fun DevicesScreen(state: WorkbenchState, model: Workbench) {
    var renaming by remember { mutableStateOf<Connection?>(null) }
    var removing by remember { mutableStateOf<Connection?>(null) }
    var name by remember { mutableStateOf("") }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Button(
            onClick = { model.addDevice(true) },
            enabled = !state.busy,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Outlined.Add, null)
            Spacer(Modifier.width(8.dp))
            Text("添加设备")
        }

        Text("已保存设备", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)

        state.connections.forEach { conn ->
            val isCurrent = conn.hostId == state.connection?.hostId
            val k = Kooyu.colors
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = if (isCurrent) k.brandCoralTint else k.raised),
                border = androidx.compose.foundation.BorderStroke(
                    if (isCurrent) 1.dp else 0.5.dp,
                    if (isCurrent) k.brandCoral.copy(alpha = 0.55f) else k.borderSubtle
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(k.sunken),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.Computer, null, tint = if (isCurrent) k.brandCoral else k.textSecondary)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(conn.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = k.text)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(if (isCurrent && state.online) k.success else k.textTertiary)
                                )
                                Text(
                                    if (isCurrent) (if (state.online) "当前设备 · 在线" else "当前设备 · 离线") else "已保存",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = k.textSecondary
                                )
                                if (conn.pending != null) {
                                    Text("· 操作待核对", style = MaterialTheme.typography.bodySmall, color = k.info)
                                }
                            }
                        }
                        if (!isCurrent) {
                            FilledTonalButton(
                                onClick = { model.switchDevice(conn.hostId) },
                                enabled = !state.busy,
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.filledTonalButtonColors(containerColor = k.sunken, contentColor = k.text),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Text("切换")
                            }
                        }
                    }

                    BackgroundReminderSettings(conn)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
                    ) {
                        TextButton(onClick = { renaming = conn; name = conn.name }, enabled = !state.busy) {
                            Text("重命名", color = k.text)
                        }
                        TextButton(
                            onClick = { removing = conn },
                            enabled = !state.busy,
                            colors = ButtonDefaults.textButtonColors(contentColor = k.destructive)
                        ) {
                            Text("移除连接")
                        }
                    }
                }
            }
        }


    }

    if (renaming != null) {
        val k = Kooyu.colors
        AlertDialog(
            onDismissRequest = { renaming = null },
            containerColor = k.raised,
            title = { Text("重命名设备", color = k.text) },
            text = {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(k.sunken)
                        .border(0.5.dp, k.borderSubtle, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart
                ) {
                    BasicTextField(
                        value = name,
                        onValueChange = { name = it.take(60) },
                        singleLine = true,
                        textStyle = KooyuType.body.copy(color = k.text),
                        cursorBrush = SolidColor(k.brandCoral),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            if (name.isEmpty()) Text("例如：工作站、MacBook", style = KooyuType.body, color = k.textTertiary)
                            inner()
                        }
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { model.renameDevice(renaming!!.hostId, name); renaming = null },
                    enabled = name.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = k.accent, contentColor = k.onAccent)
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("取消", color = k.textSecondary) } }
        )
    }

    removing?.let { c ->
        AlertDialog(
            onDismissRequest = { removing = null },
            containerColor = k.raised,
            titleContentColor = k.text,
            textContentColor = k.textSecondary,
            title = { Text("移除「${c.name}」？") },
            text = {
                Text(if (c.pending != null) "这台设备还有结果待核对的操作。移除后将失去本机核对标记，运行中的任务不会停止。" else "从手机中清除此设备连接，设备上的任务不会停止。")
            },
            confirmButton = {
                Button(
                    onClick = { model.removeDevice(c.hostId); removing = null },
                    colors = ButtonDefaults.buttonColors(containerColor = k.destructive, contentColor = Color.White)
                ) { Text("移除") }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("取消", color = k.textSecondary) } }
        )
    }
}

@Composable private fun BackgroundReminderSettings(connection: Connection) {
    val k = Kooyu.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val statuses by BackgroundReminders.status.collectAsStateWithLifecycle()
    val status = statuses[BackgroundReminders.key(connection)]
    var enabled by remember(connection.hostId, connection.deviceId, status) { mutableStateOf(BackgroundReminders.isEnabled(context, connection)) }
    var working by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { BackgroundReminders.enable(context, connection); enabled = BackgroundReminders.isEnabled(context, connection) }
        else BackgroundReminders.message(BackgroundReminders.key(connection), "通知权限未获允许，请在系统设置中开启。")
    }
    HorizontalDivider(color = k.borderSubtle)
    Text("后台事项提醒", style = KooyuType.rowTitle, color = k.text)
    if (status != null) {
        Text(status!!, style = KooyuType.caption, color = k.textSecondary)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = {
            if (android.os.Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) permission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            else { BackgroundReminders.enable(context, connection); enabled = BackgroundReminders.isEnabled(context, connection) }
        }, enabled = !working) { Text(if (enabled) "重新连接" else "开启后台提醒", color = k.text) }
        if (enabled) TextButton(onClick = { working = true; scope.launch { try { BackgroundReminders.disable(context, connection); enabled = false } finally { working = false } } }, enabled = !working) { Text("关闭提醒", color = k.textSecondary) }
        if (working) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = k.brandCoral)
    }
}

@Composable
private fun TagChip(text: String) {
    Surface(
        color = Kooyu.colors.sunken,
        shape = RoundedCornerShape(6.dp)
    ) {
        Text(
            text = text,
            color = Kooyu.colors.textSecondary,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    detail: String? = null,
    iconTint: Color? = null,
    iconBg: Color? = null,
    onClick: () -> Unit
) {
    val c = Kooyu.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(iconBg ?: c.sunken),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = iconTint ?: c.text,
                modifier = Modifier.size(18.dp)
            )
        }
        Spacer(modifier = Modifier.width(13.dp))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontSize = 15.sp,
                color = c.text,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = c.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (!detail.isNullOrBlank()) {
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = detail,
                style = MaterialTheme.typography.bodyMedium,
                fontSize = 13.sp,
                color = c.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(modifier = Modifier.width(6.dp))
        Icon(
            imageVector = Icons.Outlined.ChevronRight,
            contentDescription = null,
            tint = c.textTertiary,
            modifier = Modifier.size(16.dp)
        )
    }
}

@Composable fun SettingsScreen(
    state: WorkbenchState,
    model: Workbench,
    onOpenSession: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val versionName = remember(context) {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }
            .getOrNull()
            ?.takeIf { it.isNotBlank() } ?: "0.2.1"
    }
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    var showDeleteDeviceDialog by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf<JSONObject?>(null) }
    var instructions by remember { mutableStateOf("") }
    var defaultHarness by remember { mutableStateOf("kodo") }
    var languageSetting by remember { mutableStateOf(KooyuLanguageStore.setting) }
    var failure by remember { mutableStateOf(false) }
    var generalSaved by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.connection?.hostId, detail) {
        if (detail == "general") {
            settings = null
            failure = false
            settings = model.read("/app-settings")
            instructions = settings?.optString("personalInstructions") ?: ""
            defaultHarness = settings?.optString("defaultHarnessId", "kodo") ?: "kodo"
            languageSetting = settings?.nullableString("language") ?: KooyuLanguageStore.setting
            failure = settings == null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Kooyu.colors.navigator)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(top = 8.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 当前设备卡片（点击查看并切换设备）
        val currentDevice = state.connection
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(0.5.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier
                .fillMaxWidth()
                .clickable { detail = "devices" }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(60.dp)
                        .clip(RoundedCornerShape(17.dp))
                        .background(if (state.online) Kooyu.colors.accent else Kooyu.colors.sunken),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Laptop,
                        contentDescription = null,
                        tint = if (state.online) Kooyu.colors.onAccent else Kooyu.colors.textSecondary,
                        modifier = Modifier.size(30.dp)
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    val rawName = currentDevice?.name ?: "我的设备"
                    val displayName = if (rawName.length > 16 && rawName.matches(Regex("^[0-9a-fA-F]+$"))) {
                        rawName.take(6) + "…" + rawName.takeLast(4)
                    } else rawName
                    Text(
                        text = displayName,
                        style = MaterialTheme.typography.titleMedium,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        color = Kooyu.colors.text
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(if (state.online) Kooyu.colors.success else Kooyu.colors.textTertiary)
                        )
                        Text(
                            text = if (state.online) "在线 · 实时同步" else "离线",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (state.online) Kooyu.colors.success else Kooyu.colors.textSecondary,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TagChip(if (state.online) "加密通道" else "未连接")
                        val deviceCount = state.connections.size
                        TagChip("已保存 ${deviceCount} 台")
                    }
                }
                Icon(
                    imageVector = Icons.Outlined.ChevronRight,
                    contentDescription = null,
                    tint = Kooyu.colors.textTertiary,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        Text(
            kooyuT("settings.section.workspace"),
            style = KooyuType.sectionHeader,
            fontSize = 12.sp,
            color = Kooyu.colors.textTertiary,
            modifier = Modifier.padding(start = 6.dp, top = 4.dp)
        )

        // 工作区与能力配置
        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(0.5.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                SettingsRow(
                    icon = Icons.Outlined.Layers,
                    title = kooyuT("settings.workhub"),
                    subtitle = kooyuT("settings.workhub.detail"),
                    onClick = { detail = "workhub" }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 60.dp, end = 16.dp), thickness = 0.5.dp, color = Kooyu.colors.borderSubtle)
                SettingsRow(
                    icon = Icons.Outlined.Extension,
                    title = kooyuT("settings.engines"),
                    detail = "${state.harnesses.size}",
                    onClick = { detail = "engines" }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 60.dp, end = 16.dp), thickness = 0.5.dp, color = Kooyu.colors.borderSubtle)
                SettingsRow(
                    icon = Icons.Outlined.Memory,
                    title = kooyuT("settings.providers"),
                    detail = "${state.bindings.count { !it.optBoolean("archived") }}",
                    onClick = { detail = "providers" }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 60.dp, end = 16.dp), thickness = 0.5.dp, color = Kooyu.colors.borderSubtle)
                SettingsRow(
                    icon = Icons.Outlined.Download,
                    title = kooyuT("settings.import"),
                    subtitle = kooyuT("settings.import.detail"),
                    onClick = { detail = "import" }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 60.dp, end = 16.dp), thickness = 0.5.dp, color = Kooyu.colors.borderSubtle)
                SettingsRow(
                    icon = Icons.Outlined.BookmarkBorder,
                    title = kooyuT("settings.memory"),
                    onClick = { detail = "memory" }
                )
            }
        }

        Text(
            kooyuT("settings.section.preferences"),
            style = KooyuType.sectionHeader,
            fontSize = 12.sp,
            color = Kooyu.colors.textTertiary,
            modifier = Modifier.padding(start = 6.dp, top = 4.dp)
        )

        // 功能分组卡片（托管管理、通用与外观、帮助与反馈、关于）
        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(0.5.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                SettingsRow(
                    icon = Icons.Outlined.Security,
                    title = kooyuT("settings.host"),
                    onClick = { detail = "host" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 60.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.Outlined.Palette,
                    title = kooyuT("settings.general"),
                    subtitle = "${kooyuLanguageLabel(KooyuLanguageStore.setting)} · ${kooyuT("settings.general.detail")}",
                    onClick = { detail = "general" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 60.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.AutoMirrored.Outlined.HelpOutline,
                    title = kooyuT("settings.help"),
                    onClick = { detail = "help" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 60.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.Outlined.SystemUpdate,
                    title = kooyuT("update.title"),
                    detail = "V$versionName",
                    onClick = { detail = "update" }
                )
                HorizontalDivider(
                    modifier = Modifier.padding(start = 60.dp, end = 16.dp),
                    thickness = 0.5.dp,
                    color = Kooyu.colors.borderSubtle
                )
                SettingsRow(
                    icon = Icons.Outlined.Info,
                    title = kooyuT("settings.about"),
                    detail = "V$versionName",
                    onClick = { detail = "about" }
                )
            }
        }

        // 危险操作：删除设备
        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
            border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
            modifier = Modifier
                .fillMaxWidth()
                .clickable { showDeleteDeviceDialog = true }
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 15.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "删除设备",
                    color = Kooyu.colors.destructive,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
    }

    if (showDeleteDeviceDialog) {
        val targetName = state.connection?.name ?: "当前设备"
        AlertDialog(
            onDismissRequest = { showDeleteDeviceDialog = false },
            title = { Text("删除设备", fontWeight = FontWeight.Bold) },
            text = { Text("确定要删除设备【${targetName}】？设备端上的任务仍将继续运行。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteDeviceDialog = false
                        model.disconnect()
                    }
                ) {
                    Text("删除", color = Kooyu.colors.destructive, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDeviceDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    if (detail == "devices") {
        FullScreenPage("设备切换与管理", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                DevicesScreen(state, model)
            }
        }
    }

    if (detail == "workhub") {
        WorkHubScreen(state, model, embedded = false) { detail = null }
    }

    if (detail == "update") {
        AppUpdateScreen(currentVersion = versionName) { detail = null }
    }

    if (detail == "engines") {
        FullScreenPage("执行引擎与安装状态", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.navigator)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                val capLabels = mapOf("directChat" to "对话", "historyRead" to "历史", "resume" to "恢复", "observeLive" to "状态", "steer" to "补充", "cancel" to "停止", "interaction" to "审批")
                val harnessBindings = state.snapshot.optJSONObject("bindingDefaults")?.optJSONObject("harnessBindingIds")
                state.harnesses.forEach { h ->
                    val health = h.raw.optJSONObject("health")
                    val installed = health?.optBoolean("installed") ?: true
                    val caps = h.raw.optJSONObject("capabilities") ?: JSONObject()
                    val summary = capLabels.filter { (k, _) -> caps.optString(k) == "supported" }.values.joinToString(" · ")
                    val boundId = harnessBindings?.nullableString(h.id)
                    val bound = boundId?.let { id -> state.bindings.firstOrNull { it.optString("id") == id } }
                    val providerLabel = bound?.optString("name")?.substringBefore(" · ")?.ifBlank { bound.optString("name") }
                        ?.let { "Provider：$it" } ?: "原生配置"
                    WorkRow(
                        title = if (h.id == "kodo") "Kooyu" else h.name,
                        subtitle = "$providerLabel · " + (if (installed) "已就绪" else "未安装") + (if (summary.isNotBlank()) " · $summary" else ""),
                        open = null,
                        leading = { EngineBadge(h.id, 34.dp, circle = false) }
                    )
                }
            }
        }
    }

    if (detail == "providers") {
        ModelConfigurationScreen(state, model, embedded = false) { detail = null }
    }

    if (detail == "import") {
        ImportSessionsScreen(
            state = state,
            model = model,
            onClose = { detail = null },
            onOpenSession = onOpenSession?.let { open ->
                { sid -> detail = null; open(sid) }
            }
        )
    }

    if (detail == "memory") {
        GlobalMemorySettingsScreen(state, model) { detail = null }
    }

    if (detail == "host") {
        HostControlsScreen(state, model) { detail = null }
    }

    if (detail == "general") {
        FullScreenPage(kooyuT("settings.general"), { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.navigator)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                val c = Kooyu.colors
                // Language selector (works both online & offline, syncs to Host /app-settings when online)
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = c.raised),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(kooyuT("settings.language"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = c.text)
                        Text(kooyuT("settings.language.hint"), style = KooyuType.caption, color = c.textTertiary)
                        ChoiceField(
                            kooyuT("settings.language"),
                            languageSetting,
                            KOOYU_LANGUAGES.map { it.code to it.label },
                            enabled = true
                        ) { nextLang ->
                            languageSetting = nextLang
                            KooyuLanguageStore.update(context, nextLang)
                            settings?.let { cur ->
                                scope.launch {
                                    val body = JSONObject(cur.toString()).put("language", nextLang)
                                    if (model.execute("/app-settings", "PATCH", body) != null) {
                                        settings = model.read("/app-settings")
                                        generalSaved = true
                                        delay(1400)
                                        generalSaved = false
                                    }
                                }
                            }
                        }
                    }
                }

                AppearanceStudioSection()

                if (settings == null) {
                    if (failure) {
                        Text("读取失败", color = Kooyu.colors.destructive)
                    } else {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                } else {
                    fun persistGeneral(
                        nextHarness: String = defaultHarness,
                        nextInstructions: String = instructions,
                        nextLanguage: String = languageSetting
                    ) {
                        scope.launch {
                            val body = JSONObject(settings.toString())
                                .put("personalInstructions", nextInstructions)
                                .put("defaultHarnessId", nextHarness)
                                .put("language", nextLanguage)
                            if (model.execute("/app-settings", "PATCH", body) != null) {
                                settings = model.read("/app-settings")
                                generalSaved = true
                                delay(1600)
                                generalSaved = false
                            }
                        }
                    }
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = c.raised),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.borderSubtle),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(kooyuT("settings.defaultConfig"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.weight(1f))
                                AnimatedVisibility(generalSaved, enter = fadeIn(KooyuMotion.snap()), exit = fadeOut(KooyuMotion.snap())) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                                        Icon(Icons.Outlined.Check, null, tint = c.doneText, modifier = Modifier.size(13.dp))
                                        Text(kooyuT("settings.saved"), style = KooyuType.caption, color = c.doneText)
                                    }
                                }
                            }
                            ChoiceField(kooyuT("settings.defaultEngine"), defaultHarness, state.harnesses.map { it.id to it.name }, enabled = state.canWrite) { next ->
                                defaultHarness = next
                                persistGeneral(nextHarness = next)
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(kooyuT("settings.instructions"), style = KooyuType.sectionHeader, color = c.textTertiary, modifier = Modifier.weight(1f))
                                    if (instructions != (settings?.optString("personalInstructions") ?: "")) {
                                        TextButton(onClick = { persistGeneral() }, enabled = state.canWrite, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)) {
                                            Text("应用指令", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.brandCoral)
                                        }
                                    }
                                }
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = 120.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(c.sunken)
                                        .border(0.5.dp, c.borderSubtle, RoundedCornerShape(12.dp))
                                        .padding(12.dp)
                                ) {
                                    BasicTextField(
                                        value = instructions,
                                        onValueChange = { instructions = it.take(16000) },
                                        enabled = state.canWrite,
                                        textStyle = KooyuType.body.copy(color = c.text, fontSize = 14.sp, lineHeight = 20.sp),
                                        cursorBrush = SolidColor(c.brandCoral),
                                        modifier = Modifier.fillMaxWidth(),
                                        decorationBox = { inner ->
                                            if (instructions.isEmpty()) Text("希望所有对话共同遵守的回复习惯、语言或输出规范…", style = KooyuType.body, fontSize = 14.sp, color = c.textTertiary)
                                            inner()
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (detail == "help") {
        FullScreenPage("帮助与反馈", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("常见问题", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
                        Text("1. 如何连接设备？\n在桌面端打开 Kooyu 并显示二维码，点击当前设备卡片扫描二维码配对即可。\n\n2. 离线状态如何处理？\n请确认桌面客户端正在运行且处于同一局域网或内网穿透已建立。", style = MaterialTheme.typography.bodyMedium, color = Kooyu.colors.textSecondary, lineHeight = 20.sp)
                    }
                }
            }
        }
    }

    if (detail == "about") {
        FullScreenPage("关于", { detail = null }) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Kooyu.colors.paper)
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Spacer(Modifier.height(16.dp))
                val isDark = Kooyu.colors.dark
                val iconPlateColor = if (isDark) Color(0xFF141518) else Color(0xFFFFFFFF)
                val iconBorderColor = if (isDark) Color(0x24FFFFFF) else Color(0x18141518)
                Box(
                    modifier = Modifier
                        .size(84.dp)
                        .shadow(
                            elevation = if (isDark) 0.dp else 10.dp,
                            shape = RoundedCornerShape(22.dp),
                            ambientColor = Color.Black.copy(alpha = 0.14f),
                            spotColor = Color.Black.copy(alpha = 0.14f)
                        )
                        .clip(RoundedCornerShape(22.dp))
                        .background(iconPlateColor)
                        .border(0.75.dp, iconBorderColor, RoundedCornerShape(22.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Image(
                        painter = painterResource(R.drawable.ic_launcher_foreground),
                        contentDescription = "Kooyu",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.size(92.dp)
                    )
                }
                Text("Kooyu", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Kooyu.colors.text)
                Text("Version $versionName", style = MaterialTheme.typography.bodyMedium, color = Kooyu.colors.textSecondary)
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Kooyu.colors.raised),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Kooyu.colors.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("客户端版本", color = Kooyu.colors.textSecondary)
                            Text(versionName, color = Kooyu.colors.text, fontWeight = FontWeight.Medium)
                        }
                        HorizontalDivider(color = Kooyu.colors.borderSubtle, thickness = 0.5.dp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("构建协议", color = Kooyu.colors.textSecondary)
                            Text("v4", color = Kooyu.colors.text, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

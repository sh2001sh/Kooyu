package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.R

import kotlinx.coroutines.launch
import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

@Composable
fun PairScreen(busy: Boolean, requestedHost: String? = null, pair: (String, String, String) -> Unit) {
    val c = Kooyu.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var discovery by remember { mutableStateOf<CloudDevice?>(null) }
    var activation by remember { mutableStateOf("") }
    var hosts by remember { mutableStateOf(emptyList<org.json.JSONObject>()) }
    var address by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    // Invitations are transient secrets, never written to saved instance state.
    var code by remember { mutableStateOf("") }
    var invitation by remember { mutableStateOf<PairingInvitation?>(null) }
    var manual by rememberSaveable { mutableStateOf(false) }
    var scanning by rememberSaveable { mutableStateOf(false) }
    var scanError by remember { mutableStateOf("") }
    var permissionDenied by remember { mutableStateOf(false) }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = c.borderStrong,
        unfocusedBorderColor = c.border,
        focusedContainerColor = c.paper,
        unfocusedContainerColor = c.paper,
        focusedTextColor = c.text,
        unfocusedTextColor = c.text,
        focusedLabelColor = c.textSecondary,
        unfocusedLabelColor = c.textTertiary,
        focusedPlaceholderColor = c.textTertiary,
        unfocusedPlaceholderColor = c.textTertiary,
        focusedLeadingIconColor = c.textSecondary,
        unfocusedLeadingIconColor = c.textTertiary,
        cursorColor = c.brandCoral,
    )

    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        scanning = false
        if (result.resultCode == Activity.RESULT_OK) {
            val parsed = runCatching {
                PairingInvitation.parse(result.data?.getStringExtra(QrScannerActivity.EXTRA_INVITATION) ?: "")
            }
            parsed.onSuccess { invitation = it; manual = false; scanError = "" }
                .onFailure { scanError = it.message ?: "无法识别配对二维码，请重新扫描。" }
        }
    }

    val launchScanner = {
        invitation = null
        scanError = ""
        permissionDenied = false
        scanning = true
        try {
            scanner.launch(Intent(context, QrScannerActivity::class.java))
        } catch (_: Exception) {
            scanning = false
            scanError = "无法打开相机，请重试或手动输入。"
        }
    }

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchScanner()
        else {
            permissionDenied = true
            scanError = "未允许使用相机。可以在系统设置中开启，或手动输入连接信息。"
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .background(c.navigator)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .shadow(
                    elevation = if (c.dark) 0.dp else 8.dp,
                    shape = RoundedCornerShape(18.dp),
                    ambientColor = Color.Black.copy(alpha = 0.14f),
                    spotColor = Color.Black.copy(alpha = 0.14f)
                )
                .clip(RoundedCornerShape(18.dp))
                .background(c.raised)
                .border(0.75.dp, c.border, RoundedCornerShape(18.dp)),
            contentAlignment = Alignment.Center
        ) {
            Image(
                painter = painterResource(R.drawable.ic_launcher_foreground),
                contentDescription = "Kooyu",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(80.dp)
            )
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("连接工作电脑", style = KooyuType.pageTitle, color = c.text)
            Text(
                if (BuildConfig.ACCOUNT_ORIGIN.isNotBlank())
                    "登录 Kooyu 账号或扫描桌面二维码"
                else
                    "扫描桌面配对二维码建立端到端连接",
                style = KooyuType.caption,
                fontSize = 13.sp,
                color = c.textSecondary,
                textAlign = TextAlign.Center
            )
        }

        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(60) },
            label = { Text("设备名称（可选）") },
            placeholder = { Text("我的手机") },
            leadingIcon = { Icon(Icons.Outlined.Devices, null, modifier = Modifier.size(18.dp)) },
            singleLine = true,
            enabled = !busy,
            colors = fieldColors,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )

        if (BuildConfig.ACCOUNT_ORIGIN.isNotBlank()) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.raised,
                border = BorderStroke(0.5.dp, c.border),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Box(
                            Modifier
                                .size(34.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(c.brandCoralTint),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.PersonOutline, null, tint = c.brandCoral, modifier = Modifier.size(18.dp))
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Kooyu 账号连接", style = KooyuType.rowTitle, color = c.text)
                            Text(
                                if (requestedHost != null) "登录后自动匹配官网选中的电脑"
                                else "发现账号下已绑定电脑，无需现场扫码",
                                style = KooyuType.caption,
                                fontSize = 12.sp,
                                color = c.textSecondary
                            )
                        }
                    }

                    Button(
                        enabled = !busy && discovery == null,
                        shape = RoundedCornerShape(11.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = c.accent,
                            contentColor = c.onAccent,
                            disabledContainerColor = c.accent.copy(alpha = 0.45f),
                            disabledContentColor = c.onAccent.copy(alpha = 0.7f),
                        ),
                        contentPadding = PaddingValues(vertical = 13.dp),
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            scanError = ""
                            scope.launch {
                                runCatching {
                                    val client = CloudDevice.login()
                                    discovery = client
                                    activation = client.beginLogin()
                                    val activateUrl = BuildConfig.ACCOUNT_ORIGIN + "/activate?code=" + Uri.encode(activation)
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(activateUrl)))
                                    hosts = client.discover().filter {
                                        requestedHost == null || it.optString("id").equals(requestedHost, ignoreCase = true)
                                    }
                                    activation = ""
                                    if (hosts.isEmpty()) {
                                        discovery = null
                                        scanError = if (requestedHost == null) "此账号尚未绑定工作电脑，请先在桌面端绑定。" else "此账号中找不到官网选中的电脑。"
                                    }
                                }.onFailure {
                                    discovery = null
                                    activation = ""
                                    scanError = it.message ?: "登录失败"
                                }
                            }
                        }
                    ) {
                        if (activation.isNotEmpty()) {
                            CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp, color = c.onAccent)
                            Spacer(Modifier.width(8.dp))
                            Text("等待网页确认授权…", fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp)
                        } else {
                            Icon(Icons.Outlined.Login, null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("登录 Kooyu 账号", fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp)
                        }
                    }

                    if (activation.isNotEmpty()) {
                        Surface(
                            color = c.sunken,
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(0.5.dp, c.borderSubtle),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                Modifier.padding(14.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text("授权码（已在浏览器自动预填）", style = KooyuType.caption, color = c.textSecondary)
                                Text(
                                    activation,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 20.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 2.sp,
                                    color = c.text
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(
                                        onClick = {
                                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                            cm?.setPrimaryClip(ClipData.newPlainText("Kooyu 授权码", activation))
                                        },
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(0.75.dp, c.border),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = c.text)
                                    ) {
                                        Icon(Icons.Outlined.ContentCopy, null, modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(5.dp))
                                        Text("复制授权码", fontSize = 12.5.sp)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            val activateUrl = BuildConfig.ACCOUNT_ORIGIN + "/activate?code=" + Uri.encode(activation)
                                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(activateUrl))) }
                                        },
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(0.75.dp, c.border),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = c.text)
                                    ) {
                                        Text("重新打开授权页", fontSize = 12.5.sp)
                                    }
                                }
                            }
                        }
                    }

                    if (hosts.isNotEmpty()) {
                        Text("选择要连接的工作电脑（发起后需在电脑端批准）", style = KooyuType.caption, color = c.textSecondary)
                        hosts.forEach { host ->
                            val enabled = host.optBoolean("enabled")
                            Surface(
                                color = c.sunken,
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(0.5.dp, c.borderSubtle),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Box(
                                        Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(if (enabled) c.success else c.textTertiary)
                                    )
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(host.optString("name", "工作电脑"), style = KooyuType.rowTitle, color = c.text)
                                        Text(
                                            if (enabled) "可发起远程连接" else "已在电脑端停用远程",
                                            style = KooyuType.caption,
                                            color = c.textSecondary
                                        )
                                    }
                                    Button(
                                        enabled = !busy && enabled,
                                        shape = RoundedCornerShape(9.dp),
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = c.accent,
                                            contentColor = c.onAccent
                                        ),
                                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                                        onClick = {
                                            scope.launch {
                                                runCatching {
                                                    val request = requireNotNull(discovery).requestHost(host)
                                                    pair(request.address, request.code, name)
                                                }.onFailure { scanError = it.message ?: "申请失败" }
                                            }
                                        }
                                    ) {
                                        Text("连接", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = c.raised,
            border = BorderStroke(0.5.dp, c.border),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(
                        Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(c.sunken),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Outlined.QrCodeScanner, null, tint = c.text, modifier = Modifier.size(18.dp))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("扫码配对", style = KooyuType.rowTitle, color = c.text)
                        Text(
                            "在桌面端「设置 → 手机连接」生成二维码并扫码",
                            style = KooyuType.caption,
                            fontSize = 12.sp,
                            color = c.textSecondary
                        )
                    }
                }

                OutlinedButton(
                    onClick = {
                        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
                            scanError = "此设备没有可用相机，请手动输入连接信息。"
                        } else if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            launchScanner()
                        } else cameraPermission.launch(Manifest.permission.CAMERA)
                    },
                    enabled = !busy && !scanning,
                    shape = RoundedCornerShape(11.dp),
                    border = BorderStroke(0.75.dp, c.borderStrong),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = c.text),
                    contentPadding = PaddingValues(vertical = 12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (scanning) {
                        CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp, color = c.text)
                        Spacer(Modifier.width(8.dp))
                        Text("正在打开扫码器…", fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
                    } else {
                        Icon(Icons.Outlined.QrCodeScanner, contentDescription = null, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("扫描桌面二维码", fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        if (scanError.isNotEmpty()) {
            Surface(
                color = c.destructiveTint,
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(0.5.dp, c.destructive.copy(alpha = 0.28f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(Icons.Outlined.ErrorOutline, null, tint = c.destructive, modifier = Modifier.size(18.dp))
                    Text(scanError, color = c.destructive, style = KooyuType.caption, fontSize = 12.5.sp)
                }
            }
        }

        if (permissionDenied) {
            OutlinedButton(
                onClick = {
                    runCatching {
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)))
                    }.onFailure { scanError = "请在系统设置中为 Kooyu 允许相机权限。" }
                },
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(0.75.dp, c.border),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = c.text)
            ) {
                Icon(Icons.Outlined.Settings, null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("打开应用权限设置")
            }
        }

        invitation?.let { scanned ->
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.raised,
                border = BorderStroke(1.dp, c.success.copy(alpha = 0.5f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Outlined.CheckCircle, null, tint = c.success, modifier = Modifier.size(20.dp))
                        Text("已识别桌面二维码", style = KooyuType.rowTitle, color = c.text)
                    }
                    Text(
                        "配对码两分钟内有效，点击完成端到端加密连接。",
                        style = KooyuType.caption,
                        fontSize = 12.5.sp,
                        color = c.textSecondary
                    )
                    Button(
                        onClick = { pair(scanned.address, scanned.code, name) },
                        enabled = !busy,
                        shape = RoundedCornerShape(11.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                        contentPadding = PaddingValues(vertical = 12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (busy) {
                            CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp, color = c.onAccent)
                            Spacer(Modifier.width(8.dp))
                            Text("正在连接…", fontWeight = FontWeight.SemiBold)
                        } else {
                            Text("连接此设备", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }

        TextButton(
            onClick = { manual = !manual; invitation = null },
            enabled = !busy,
            colors = ButtonDefaults.textButtonColors(contentColor = c.textSecondary)
        ) {
            Icon(if (manual) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
            Text(if (manual) "收起手动输入" else "手动输入连接信息", fontSize = 13.sp)
        }

        AnimatedVisibility(visible = manual) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = c.raised,
                border = BorderStroke(0.5.dp, c.border),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        label = { Text("HTTPS 地址") },
                        placeholder = { Text("https://192.168.1.100:4433") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        singleLine = true,
                        enabled = !busy,
                        colors = fieldColors,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it },
                        label = { Text("配对码") },
                        placeholder = { Text("配对码") },
                        singleLine = true,
                        enabled = !busy,
                        colors = fieldColors,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Button(
                        onClick = { pair(address, code, name) },
                        enabled = !busy && address.isNotBlank() && code.isNotBlank(),
                        shape = RoundedCornerShape(11.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                        contentPadding = PaddingValues(vertical = 12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (busy) {
                            CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp, color = c.onAccent)
                            Spacer(Modifier.width(8.dp))
                            Text("正在配对…", fontWeight = FontWeight.SemiBold)
                        } else {
                            Text("完成配对", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

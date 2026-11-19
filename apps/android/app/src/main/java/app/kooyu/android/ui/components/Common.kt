package app.kooyu.android.ui.components

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ChoiceField(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    enabled: Boolean = true,
    choose: (String) -> Unit
) {
    val c = Kooyu.colors
    var sheetOpen by remember { mutableStateOf(false) }
    val displayValue = options.firstOrNull { it.first == value }?.second ?: value.ifBlank { "未选择" }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = c.sunken,
        border = androidx.compose.foundation.BorderStroke(0.5.dp, c.borderSubtle),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(enabled = enabled) { sheetOpen = true }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 46.dp)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (label.isNotBlank()) {
                Text(
                    text = label,
                    style = KooyuType.label.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),
                    color = c.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.weight(1f))
            }
            Text(
                text = displayValue,
                style = KooyuType.body.copy(fontSize = 14.sp),
                color = if (displayValue == "未选择" || displayValue.isEmpty()) c.textTertiary else c.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = if (label.isBlank()) Modifier.weight(1f) else Modifier.widthIn(max = 190.dp)
            )
            Icon(
                imageVector = Icons.Outlined.UnfoldMore,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = c.textTertiary
            )
        }
    }

    if (sheetOpen) {
        ModalBottomSheet(
            onDismissRequest = { sheetOpen = false },
            containerColor = c.raised,
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            dragHandle = {
                Box(
                    Modifier
                        .padding(vertical = 10.dp)
                        .size(width = 36.dp, height = 4.dp)
                        .background(c.borderStrong, CircleShape)
                )
            }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp)
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (label.isNotBlank()) {
                    Text(
                        text = label,
                        style = KooyuType.pageTitle,
                        fontSize = 17.sp,
                        color = c.text,
                        modifier = Modifier.padding(horizontal = 4.dp)
                    )
                }
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = c.sunken,
                    border = androidx.compose.foundation.BorderStroke(0.5.dp, c.borderSubtle),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    LazyColumn(modifier = Modifier.heightIn(max = 380.dp)) {
                        items(options) { (id, name) ->
                            val isSelected = id == value
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 48.dp)
                                    .clickable {
                                        choose(id)
                                        sheetOpen = false
                                    }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = name,
                                    style = KooyuType.body.copy(
                                        fontSize = 15.sp,
                                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal
                                    ),
                                    color = c.text,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                                if (isSelected) {
                                    Spacer(Modifier.width(10.dp))
                                    Icon(
                                        imageVector = Icons.Outlined.Check,
                                        contentDescription = "已选择",
                                        modifier = Modifier.size(18.dp),
                                        tint = c.accent
                                    )
                                }
                            }
                            if (id != options.lastOrNull()?.first) {
                                HorizontalDivider(
                                    color = c.borderSubtle,
                                    thickness = 0.5.dp,
                                    modifier = Modifier.padding(start = 16.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun FullScreenPage(
    title: String,
    close: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit
) {
    val c = Kooyu.colors
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = c.navigator) {
            Scaffold(
                containerColor = c.navigator,
                topBar = {
                    Box(Modifier.fillMaxWidth()) {
                        Box(Modifier.matchParentSize().kooyuGlassSurface(topHighlight = false))
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .statusBarsPadding()
                                .height(54.dp)
                                .padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Box(
                                Modifier
                                    .size(44.dp)
                                    .kooyuPressable(onClickLabel = "返回") { close() },
                                contentAlignment = Alignment.Center
                            ) {
                                Box(
                                    Modifier
                                        .size(35.dp)
                                        .clip(CircleShape)
                                        .background(c.raised.copy(alpha = 0.90f))
                                        .border(0.5.dp, c.border, CircleShape),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "关闭", tint = c.text, modifier = Modifier.size(17.dp))
                                }
                            }
                            Text(
                                title,
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = (-0.3).sp,
                                color = c.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                content = actions
                            )
                        }
                    }
                },
                content = content
            )
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

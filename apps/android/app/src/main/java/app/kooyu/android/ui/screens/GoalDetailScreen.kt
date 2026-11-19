package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

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

@Composable fun GoalDetailScreen(
    goalId: String,
    state: WorkbenchState,
    model: Workbench,
    openSession: ((String) -> Unit)? = null,
    close: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var note by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf("") }

    LaunchedEffect(goalId, state.connection?.hostId) {
        loading = true
        detail = model.read("/goals/$goalId/detail")
        loading = false
    }

    val goal = detail?.optJSONObject("goal")
    val title = goal?.optString("title") ?: "目标详情"
    val status = goal?.optString("status") ?: "draft"
    val verifyStatus = goal?.optString("verificationStatus") ?: "unverified"
    val artifacts = detail?.optJSONArray("artifacts")?.objects() ?: emptyList()
    val verifications = detail?.optJSONArray("verifications")?.objects() ?: emptyList()
    val criteria = goal?.optJSONArray("acceptanceCriteria")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()

    val statusLabel = when (status) {
        "active" -> "进行中"
        "blocked" -> "受阻"
        "awaiting-review" -> "待验收"
        "completed" -> "已完成"
        "cancelled" -> "已取消"
        else -> "草稿"
    }

    val verifyLabel = when (verifyStatus) {
        "passed" -> "检查通过"
        "failed" -> "检查失败"
        "not-applicable" -> "无需验证"
        else -> "未验证"
    }

    FullScreenPage(title, close) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(
                    color = when (status) {
                        "completed" -> MaterialTheme.colorScheme.primaryContainer
                        "awaiting-review" -> MaterialTheme.colorScheme.tertiaryContainer
                        "blocked" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceContainerHigh
                    },
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(statusLabel, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
                Surface(
                    color = when (verifyStatus) {
                        "passed" -> MaterialTheme.colorScheme.primaryContainer
                        "failed" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceContainerHigh
                    },
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(verifyLabel, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }

            if (criteria.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("验收标准", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        criteria.forEach { item ->
                            Text("• $item", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }

            if (artifacts.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("交付成果", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        artifacts.forEach { item ->
                            val art = item.optJSONObject("artifact") ?: item
                            val name = art.optString("displayName", art.optString("title", "成果文件"))
                            val version = art.optInt("version", 1)
                            Text("$name · v$version", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }

            if (verifications.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("验证记录", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        verifications.forEach { v ->
                            val outcome = v.optString("outcome", "unverified")
                            val method = v.optString("method", "验证")
                            val outcomeLabel = if (outcome == "passed") "通过" else if (outcome == "failed") "失败" else "无结论"
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(method, style = MaterialTheme.typography.bodyMedium)
                                Text(outcomeLabel, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            if (status == "awaiting-review") {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("验收确认", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        OutlinedTextField(
                            value = note,
                            onValueChange = { note = it },
                            label = { Text("意见") },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        val body = JSONObject().put("action", "accept").apply {
                                            if (note.isNotBlank()) put("remainingUncertainty", note)
                                        }
                                        if (model.execute("/goals/$goalId/decision", body = body) != null ||
                                            model.execute("/goals/$goalId/review", body = body) != null) {
                                            close()
                                        }
                                    }
                                },
                                enabled = state.canWrite,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("接受成果")
                            }
                            OutlinedButton(
                                onClick = {
                                    scope.launch {
                                        val body = JSONObject().put("action", "request-changes").put("note", note)
                                        if (model.execute("/goals/$goalId/decision", body = body) != null ||
                                            model.execute("/goals/$goalId/review", body = body) != null) {
                                            close()
                                        }
                                    }
                                },
                                enabled = state.canWrite && note.isNotBlank(),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("退回修改")
                            }
                        }
                    }
                }
            }

            if (errorText.isNotBlank()) {
                Text(errorText, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

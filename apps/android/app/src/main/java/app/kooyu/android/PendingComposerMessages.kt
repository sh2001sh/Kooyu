package app.kooyu.android

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

fun pendingUserMessages(commands: List<JSONObject>): List<JSONObject> = commands.filter {
    it.optString("kind") == "send" && it.optString("origin") == "user" && it.optString("status") == "accepted" &&
        it.optJSONObject("body")?.optString("mode") != "new"
}

@Composable fun PendingComposerMessages(state: WorkbenchState, model: Workbench, session: HostSession) {
    val pending = pendingUserMessages(state.commands)
    val scope = rememberCoroutineScope()
    var editing by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var text by remember { mutableStateOf("") }
    val supportsSteer = (session.raw.optJSONObject("nativeCapabilities")?.nullableString("steer")
        ?: state.harnesses.firstOrNull { it.id == session.harnessId }?.raw?.optJSONObject("capabilities")?.nullableString("steer")) == "supported"
    val immediate = session.runState == "idle" || session.runState == "running" && supportsSteer
    fun change(command: JSONObject, action: String, edited: String? = null) {
        scope.launch {
            val body = JSONObject().put("action", action).put("expectedRevision", command.optJSONObject("body")?.optInt("pendingRevision") ?: 0)
            if (edited != null) body.put("text", edited)
            if (model.execute("/sessions/${session.id}/commands/${command.getString("id")}", "PATCH", body) != null) editing = null
        }
    }
    if (pending.isNotEmpty()) Column(Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState()).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val c = Kooyu.colors
        Surface(shape = RoundedCornerShape(12.dp), color = c.sunken, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("准备发送", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = c.textSecondary)
                Text(" · ${pending.size}", style = MaterialTheme.typography.labelSmall, color = c.textTertiary)
            }
        }
        pending.forEachIndexed { index, command ->
            Surface(shape = RoundedCornerShape(14.dp), color = c.raised, border = BorderStroke(0.5.dp, c.borderSubtle), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Surface(shape = RoundedCornerShape(6.dp), color = c.accentTint) {
                            Text("排队 ${index + 1}", fontSize = 11.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, color = c.accent, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                        Text(command.optJSONObject("body")?.optString("text").orEmpty(), maxLines = 2, color = c.text, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
                        TextButton(onClick = { change(command, "send-now") }, enabled = state.canWrite && immediate) { Text(if (session.runState == "running") "插入当前轮" else "立即发送", fontSize = 12.sp) }
                        TextButton(onClick = { editing = command; text = command.optJSONObject("body")?.optString("text").orEmpty() }, enabled = state.canWrite) { Text("编辑", fontSize = 12.sp) }
                        TextButton(onClick = { scope.launch { model.execute("/sessions/${session.id}/commands/${command.getString("id")}", "DELETE", null) } }, enabled = state.canWrite) { Text("撤回", fontSize = 12.sp, color = c.destructive) }
                    }
                }
            }
        }
    }
    editing?.let { command ->
        val c = Kooyu.colors
        AlertDialog(
            onDismissRequest = { if (!state.busy) editing = null },
            shape = RoundedCornerShape(18.dp),
            containerColor = c.raised,
            titleContentColor = c.text,
            textContentColor = c.textSecondary,
            title = { Text("编辑待发消息", fontWeight = FontWeight.Bold, fontSize = 17.sp) },
            text = { OutlinedTextField(text, { text = it }, minLines = 3, maxLines = 7, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) },
            confirmButton = {
                Button(onClick = { change(command, "edit", text) }, enabled = state.canWrite && text.isNotBlank(), shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent)) {
                    Text("保存", fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消", color = c.textSecondary) } }
        )
    }
}

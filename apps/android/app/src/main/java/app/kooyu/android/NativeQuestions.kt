package app.kooyu.android

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

data class QuestionOption(val value: String, val label: String, val description: String)
data class NativeQuestion(val key: String, val text: String, val body: String, val options: List<QuestionOption>, val multiple: Boolean, val custom: Boolean, val secret: Boolean)
data class QuestionForm(val protocol: String, val questions: List<NativeQuestion>) {
    fun answer(selected: Map<String, List<String>>, custom: Map<String, String>, skipped: Set<String>): JSONObject {
        fun values(q: NativeQuestion) = custom[q.key]?.trim()?.takeIf { it.isNotEmpty() }?.let { listOf(it) } ?: selected[q.key].orEmpty()
        return when (protocol) {
            "opencode" -> JSONObject().put("answers", JSONArray(questions.map { JSONArray(values(it)) }))
            "codex" -> JSONObject().put("answers", JSONObject().apply { questions.forEach { put(it.key, JSONObject().put("answers", JSONArray(values(it)))) } })
            "claude" -> JSONObject().put("behavior", "allow").put("updatedInput", JSONObject().put("answers", JSONObject().apply { questions.forEach { put(it.key, values(it).joinToString(", ")) } }))
            else -> JSONObject().put("method", "click").put("answers", JSONObject().apply { questions.forEach { q ->
                val text = custom[q.key]?.trim().orEmpty(); val ids = selected[q.key].orEmpty()
                val value = when { q.key in skipped -> JSONObject().put("kind", "skipped")
                    text.isNotEmpty() && q.multiple && ids.isNotEmpty() -> JSONObject().put("kind", "multi_with_other").put("option_ids", JSONArray(ids)).put("other_text", text)
                    text.isNotEmpty() -> JSONObject().put("kind", "other").put("text", text)
                    q.multiple -> JSONObject().put("kind", "multi").put("option_ids", JSONArray(ids))
                    else -> JSONObject().put("kind", "single").put("option_id", ids.first()) }
                put(q.key, value)
            } })
        }
    }
}
fun questionForm(payload: JSONObject): QuestionForm? {
    val protocol = payload.optString("protocol")
    if (!when (protocol) { "claude" -> payload.optString("toolName") == "AskUserQuestion"; "codex" -> payload.optString("method") == "item/tool/requestUserInput"; "opencode" -> payload.optString("type") == "question.asked"; "kimi" -> payload.optString("method") == "question/request"; else -> false }) return null
    val raw = payload.optJSONObject(if (protocol == "claude") "input" else "params")?.optJSONArray("questions") ?: return null
    if (raw.length() !in 1..20) return null
    val questions = mutableListOf<NativeQuestion>()
    for (i in 0 until raw.length()) {
        val q = raw.optJSONObject(i) ?: return null
        if (q.opt("question") !is String || (protocol in listOf("codex", "kimi") && (q.opt("id") !is String || q.nullableString("id") == null))) return null
        if (q.has("options") && !q.isNull("options") && q.opt("options") !is JSONArray) return null
        val options = q.optJSONArray("options") ?: JSONArray()
        if (options.length() > 100) return null
        val normalized = mutableListOf<QuestionOption>()
        for (j in 0 until options.length()) {
            val o = options.optJSONObject(j) ?: return null
            if (o.opt("label") !is String || protocol == "kimi" && (o.opt("id") !is String || o.nullableString("id") == null)) return null
            normalized += QuestionOption(if (protocol == "kimi") o.getString("id") else o.getString("label"), o.getString("label"), o.optString("description"))
        }
        if (normalized.distinctBy { it.value }.size != normalized.size) return null
        val key = if (protocol in listOf("codex", "kimi")) q.getString("id") else if (protocol == "claude") q.getString("question") else i.toString()
        if (questions.any { it.key == key }) return null
        questions += NativeQuestion(key, q.getString("question"), if (protocol == "kimi") q.optString("body") else "", normalized,
            when (protocol) { "claude" -> q.optBoolean("multiSelect"); "kimi" -> q.optBoolean("multi_select"); "opencode" -> q.optBoolean("multiple"); else -> false },
            normalized.isEmpty() || when (protocol) { "codex" -> q.optBoolean("isOther"); "kimi" -> q.optBoolean("allow_other"); "opencode" -> q.opt("custom") != false; else -> true }, protocol == "codex" && q.optBoolean("isSecret"))
    }
    return QuestionForm(protocol, questions)
}
@Composable fun NativeQuestionFields(item: InboxItem, form: QuestionForm, enabled: Boolean, answer: (NativeAction) -> Unit) {
    val c = Kooyu.colors
    var selected by remember(item.id) { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var custom by remember(item.id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var skipped by remember(item.id) { mutableStateOf<Set<String>>(emptySet()) }
    form.questions.forEach { q ->
        Text(q.text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.text)
        if (q.body.isNotEmpty()) Text(q.body, color = c.textSecondary, fontSize = 13.sp)
        q.options.forEach { option ->
            val checked = q.key !in skipped && option.value in selected[q.key].orEmpty() && (form.protocol == "kimi" && q.multiple || custom[q.key].isNullOrBlank())
            Surface(
                shape = CircleShape,
                color = if (checked) (if (c.dark) c.raised else c.paper) else c.sunken,
                border = BorderStroke(if (checked) 1.5.dp else 0.5.dp, if (checked) c.accent else c.borderSubtle),
                shadowElevation = if (checked && !c.dark) 2.dp else 0.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .clickable(enabled && q.key !in skipped) {
                        val previous = selected[q.key].orEmpty()
                        selected = selected + (q.key to if (q.multiple) { if (option.value in previous) previous - option.value else previous + option.value } else listOf(option.value))
                        if (form.protocol != "kimi" || !q.multiple) custom = custom - q.key
                    }
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(if (checked) c.accent else (if (c.dark) c.sunken else c.paper)),
                        contentAlignment = Alignment.Center
                    ) {
                        if (checked) {
                            Icon(Icons.Outlined.Check, null, tint = c.onAccent, modifier = Modifier.size(16.dp))
                        } else {
                            Box(Modifier.size(8.dp).clip(CircleShape).background(c.textTertiary.copy(alpha = 0.5f)))
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(option.label, fontWeight = if (checked) FontWeight.Bold else FontWeight.Medium, color = c.text, fontSize = 14.5.sp)
                        if (option.description.isNotEmpty()) Text(option.description, style = MaterialTheme.typography.bodySmall, color = c.textSecondary)
                    }
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .background(if (checked) c.accent else Color.Transparent)
                            .then(if (!checked) Modifier.border(1.5.dp, c.borderSubtle, CircleShape) else Modifier),
                        contentAlignment = Alignment.Center
                    ) {
                        if (checked) {
                            Icon(Icons.Outlined.Check, null, tint = c.onAccent, modifier = Modifier.size(13.dp))
                        }
                    }
                }
            }
        }
        if (q.custom) OutlinedTextField(custom[q.key].orEmpty(), { custom = custom + (q.key to it.take(10000)) }, enabled = enabled && q.key !in skipped, label = { Text(if (q.options.isEmpty()) "你的回答" else "其他回答") }, visualTransformation = if (q.secret) PasswordVisualTransformation() else VisualTransformation.None, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
        if (form.protocol == "kimi") TextButton(onClick = { skipped = if (q.key in skipped) skipped - q.key else skipped + q.key }, enabled = enabled) { Text(if (q.key in skipped) "继续回答" else "跳过此题") }
    }
    val ready = form.questions.all { (form.protocol == "kimi" && it.key in skipped) || !custom[it.key].isNullOrBlank() || !selected[it.key].isNullOrEmpty() }
    Button(
        onClick = { answer(NativeAction("提交回答", form.answer(selected, custom, skipped), false)) },
        enabled = enabled && ready,
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
        modifier = Modifier.fillMaxWidth().height(50.dp)
    ) {
        Text("提交回答", fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
    if (form.protocol != "codex") TextButton(onClick = { answer(NativeAction("取消回答", if (form.protocol == "claude") JSONObject().put("behavior", "deny") else JSONObject().put("cancelled", true), false)) }, enabled = enabled) { Text("取消回答", color = c.textSecondary) }
}

package app.kooyu.android

import org.json.JSONArray
import org.json.JSONObject

/*
 * Mirrors apps/web/src/components/TranscriptView.tsx (buildTranscriptRows, toolSummary, toolOutput)
 * so the phone shows the same intermediate process as the desktop: thinking, tool calls,
 * sub-agents and turn failures, not only the final answer.
 */

object RowRole {
    const val USER = "user"
    const val ASSISTANT = "assistant"
    const val THINKING = "thinking"
    const val TOOL = "tool"
    const val SUBAGENT = "subagent"
    const val ERROR = "error"
}

data class ChildTranscript(val agentId: String, val name: String? = null, val parentAgentId: String? = null,
    val status: String? = null, val events: List<JSONObject> = emptyList())

data class TranscriptRow(val id: String, val role: String, val text: String, val eventIds: List<String> = emptyList(),
    val payload: JSONObject? = null, val origin: String? = null, val child: ChildTranscript? = null, val createdAt: String? = null, val attachments: List<JSONObject> = emptyList())

data class Transcript(val rows: List<TranscriptRow>, val thinkingPending: Boolean)

/** A run of consecutive tool calls collapses into one group, like the desktop. */
sealed interface TranscriptBlock {
    val key: String
    data class Single(val row: TranscriptRow) : TranscriptBlock { override val key get() = row.id }
    data class Tools(val rows: List<TranscriptRow>) : TranscriptBlock { override val key get() = "tools:" + rows.first().id }
}

fun transcriptBlocks(rows: List<TranscriptRow>): List<TranscriptBlock> {
    val blocks = mutableListOf<TranscriptBlock>()
    for (row in rows) {
        val last = blocks.lastOrNull()
        if (row.role == RowRole.TOOL && last is TranscriptBlock.Tools) blocks[blocks.lastIndex] = TranscriptBlock.Tools(last.rows + row)
        else blocks += if (row.role == RowRole.TOOL) TranscriptBlock.Tools(listOf(row)) else TranscriptBlock.Single(row)
    }
    return blocks
}

private fun JSONObject.str(key: String): String? = (opt(key) as? String)
private fun JSONObject.key(key: String): String? = opt(key)?.takeUnless { it == JSONObject.NULL }?.toString()?.takeIf { it.isNotEmpty() }
private fun JSONObject.truthy(key: String): Boolean = when (val v = opt(key)) {
    null, JSONObject.NULL, false -> false
    is String -> v.isNotEmpty()
    is Number -> v.toDouble() != 0.0
    else -> true
}

fun transcript(events: JSONArray): List<TranscriptRow> = buildTranscript(events.objects()).rows

fun buildTranscript(events: List<JSONObject>): Transcript {
    val rows = mutableListOf<TranscriptRow>()
    class Child(val agentId: String) { var name: String? = null; var parent: String? = null; var status: String? = null; val events = mutableListOf<JSONObject>() }
    val children = linkedMapOf<String, Child>()
    val stream = StringBuilder()
    var streamKey = ""
    val streamIds = mutableListOf<String>()
    val thought = StringBuilder()
    var thoughtKey = ""
    var thoughtItem: String? = null

    fun upsert(row: TranscriptRow, merge: (TranscriptRow) -> TranscriptRow = { row }) {
        val index = rows.indexOfFirst { it.id == row.id }
        if (index < 0) rows += row else rows[index] = merge(rows[index])
    }
    fun flushThought() {
        if (thought.isNotBlank()) {
            val id = thoughtItem?.let { "thought:$it" } ?: thoughtKey
            upsert(TranscriptRow(id, RowRole.THINKING, thought.toString().trim()))
        }
        thought.clear(); thoughtItem = null
    }
    fun flush() {
        flushThought()
        if (stream.isNotEmpty()) {
            rows += TranscriptRow(streamKey, RowRole.ASSISTANT, stream.toString(), streamIds.toList())
            stream.clear(); streamIds.clear()
        }
    }
    fun addError(id: String, text: String, payload: JSONObject) {
        if (text.isNotBlank() && rows.none { it.role == RowRole.ERROR && it.text == text })
            rows += TranscriptRow(id, RowRole.ERROR, text, listOf(id), payload)
    }

    for (e in events) {
        val p = e.optJSONObject("payload") ?: JSONObject()
        val eventId = e.optString("id")
        when (e.optString("type")) {
            "subagent" -> {
                val agentId = p.str("agentId")?.takeIf { it.isNotEmpty() } ?: continue
                var child = children[agentId]
                if (child == null) {
                    flush()
                    child = Child(agentId); children[agentId] = child
                    rows += TranscriptRow("subagent:$agentId", RowRole.SUBAGENT, "", listOf(eventId))
                }
                p.str("name")?.takeIf { it.isNotEmpty() }?.let { child.name = it }
                p.str("parentAgentId")?.takeIf { it.isNotEmpty() }?.let { child.parent = it }
                p.str("status")?.takeIf { it.isNotEmpty() }?.let { child.status = it }
                val inner = p.optJSONObject("event")
                val innerType = inner?.optString("type").orEmpty()
                if (inner != null && innerType.isNotEmpty() && innerType != "subagent") {
                    val value = inner.optJSONObject("payload") ?: JSONObject()
                    if (innerType == "turn-ended") value.str("outcome")?.let { child.status = it }
                    else if (innerType == "state") value.str("runState")?.let { child.status = it }
                    child.events += JSONObject().put("id", eventId + ":" + child.events.size).put("sequence", e.opt("sequence"))
                        .put("type", innerType).put("payload", value)
                }
            }
            "text-delta" -> {
                val text = p.str("text") ?: p.str("delta") ?: ""
                if (p.optString("channel") == "thought") {
                    val item = p.key("itemId")
                    if (thought.isNotEmpty() && item != null && item != thoughtItem) flushThought()
                    if (thought.isEmpty()) thoughtKey = "thought:$eventId"
                    thoughtItem = item
                    thought.append(text)
                } else {
                    flushThought()
                    if (stream.isEmpty()) streamKey = eventId
                    stream.append(text); streamIds += eventId
                }
            }
            "message" -> {
                val text = messageText(e.opt("payload"))
                if (text.isEmpty() && (p.optJSONArray("attachments")?.length() ?: 0) == 0) continue
                if (p.optString("channel") == "thought" || p.optString("type") == "reasoning") {
                    val item = p.key("id")
                    if (thought.isNotEmpty() && item != thoughtItem) flushThought()
                    thoughtItem = item ?: eventId
                    thoughtKey = "thought:$thoughtItem"
                    thought.setLength(0); thought.append(text)
                    continue
                }
                val role = if (p.optString("role") == "user") RowRole.USER else RowRole.ASSISTANT
                flushThought()
                if (role == RowRole.USER) flush() else { stream.clear(); streamIds.clear() }
                val id = p.key("id")?.let { "message:$it" } ?: eventId
                val origin = when (p.optString("origin")) { "supervisor" -> "由主对话发送"; "wake" -> "持久事件唤醒"; else -> null }
                val row = TranscriptRow(id, role, text, listOf(eventId), origin = origin, createdAt = e.nullableString("createdAt"), attachments = p.optJSONArray("attachments")?.objects() ?: emptyList())
                upsert(row) { old -> row.copy(eventIds = old.eventIds + eventId) }
            }
            "tool" -> {
                if (p.optString("type") in listOf("userMessage", "reasoning")) continue
                flush()
                val key = p.key("toolCallId") ?: p.key("id") ?: p.optJSONObject("part")?.key("id")
                val id = key?.let { "tool:$it" } ?: eventId
                val row = TranscriptRow(id, RowRole.TOOL, "", listOf(eventId), p)
                upsert(row) { old ->
                    val merged = JSONObject(old.payload?.toString() ?: "{}")
                    p.keys().forEach { k -> merged.put(k, p.get(k)) }
                    row.copy(payload = merged, eventIds = old.eventIds + eventId)
                }
            }
            "turn-ended", "settled" -> {
                flush()
                val message = failureText(p)
                val reasoned = e.optString("type") == "turn-ended" || p.truthy("error") || p.truthy("message")
                if (message != null && reasoned) addError(eventId, message, p)
            }
            "state" -> if (p.truthy("message") || p.truthy("error")) {
                flush()
                val message = p.str("message") ?: p.optJSONObject("error")?.str("message") ?: p.opt("error")?.toString().orEmpty()
                addError(eventId, message, p)
            }
            "error", "disconnected" -> {
                flush()
                val message = p.str("message")?.takeIf { it.isNotEmpty() } ?: messageText(p).ifEmpty { "运行出现错误，请在桌面核对。" }
                val text = if (e.optString("type") == "disconnected") "原生连接已断开：$message" else message
                if (rows.lastOrNull()?.text != text) rows += TranscriptRow(eventId, RowRole.ERROR, text, listOf(eventId), p)
            }
        }
    }
    val thinkingPending = thought.isNotBlank() && stream.isEmpty()
    flush()
    val frozen = rows.map { row ->
        if (row.role != RowRole.SUBAGENT) row
        else children[row.id.removePrefix("subagent:")]?.let { c -> row.copy(child = ChildTranscript(c.agentId, c.name, c.parent, c.status, c.events.toList())) } ?: row
    }
    return Transcript(frozen, thinkingPending)
}

/** Readable reason for a failed native turn; null for successful or cancelled turns. */
fun failureText(p: JSONObject?): String? {
    if (p == null || p.optString("outcome") != "failed") return null
    val error = p.opt("error")?.takeUnless { it == JSONObject.NULL } ?: p.opt("reason")?.takeUnless { it == JSONObject.NULL }
    val text = (error as? String) ?: (error as? JSONObject)?.let { it.str("underlyingErrorMessage") ?: it.str("message") } ?: p.str("message")
    return text?.trim()?.takeIf { it.isNotEmpty() } ?: "本轮执行失败，原生未提供原因。"
}

enum class ToolStatus(val label: String) { RUNNING("进行中"), DONE("完成"), FAILED("失败") }
data class ToolSummary(val title: String, val detail: String, val status: ToolStatus?)

/** Drop the shell wrapper Codex adds on Windows so the command itself is visible. */
fun bareCommand(value: Any?): String {
    var text = (value?.takeUnless { it == JSONObject.NULL } ?: "").toString().trim()
    Regex("""powershell\.exe"?\s+-Command\s+(.*)$""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).find(text)?.let { text = it.groupValues[1].trim() }
    if (text.length > 1 && text.startsWith("'") && text.endsWith("'")) text = text.substring(1, text.length - 1)
    return text
}

private fun JSONObject.firstText(vararg keys: String): String = keys.firstNotNullOfOrNull { k -> opt(k)?.takeUnless { it == JSONObject.NULL }?.toString()?.takeIf { it.isNotEmpty() } } ?: ""

fun toolSummary(p: JSONObject): ToolSummary {
    val exit = p.opt("exitCode") as? Number
    val failed = p.optString("status") == "failed" || p.opt("is_error") == true || p.opt("isError") == true || (exit != null && exit.toInt() != 0)
    val done = p.optString("status") == "completed" || p.optString("lifecycle") == "completed" || exit != null
    val status = when { failed -> ToolStatus.FAILED; done -> ToolStatus.DONE; p.optString("lifecycle") == "started" -> ToolStatus.RUNNING; else -> null }
    return when (p.optString("type")) {
        "commandExecution" -> ToolSummary("运行命令", bareCommand(p.opt("command")), status)
        "fileChange" -> ToolSummary("修改文件", (p.optJSONArray("changes")?.objects() ?: emptyList()).joinToString(", ") { it.optString("path") }, status)
        "mcpToolCall" -> ToolSummary(p.optString("server") + "." + p.optString("tool"), "", status)
        "webSearch" -> ToolSummary("网页搜索", p.firstText("query"), status)
        "tool_use" -> ToolSummary(p.firstText("name").ifEmpty { "工具" },
            (p.optJSONObject("input") ?: JSONObject()).firstText("command", "file_path", "path", "pattern", "url", "description"), status)
        else -> when {
            p.optString("role") == "toolResult" -> ToolSummary(p.firstText("toolName").ifEmpty { "工具" } + " 结果", "", status)
            p.optJSONArray("content")?.objects()?.any { it.optString("type") == "tool_result" } == true -> ToolSummary("工具结果", "", status)
            else -> {
                val name = p.firstText("title", "toolName", "name", "tool", "type").ifEmpty { "工具调用" }
                val input = listOf("input", "rawInput", "args", "arguments").firstNotNullOfOrNull { p.optJSONObject(it) }
                    ?: p.optJSONObject("state")?.optJSONObject("input")
                ToolSummary(name, input?.firstText("command", "path", "filePath") ?: "", status)
            }
        }
    }
}

fun toolOutput(p: JSONObject): String {
    p.str("aggregatedOutput")?.takeIf { it.isNotEmpty() }?.let { return it }
    p.optJSONObject("state")?.str("output")?.let { return it }
    p.optJSONArray("content")?.let { content ->
        val text = content.objects().map { c ->
            c.str("text") ?: c.str("content") ?: c.optJSONObject("content")?.str("text")
                ?: c.optJSONArray("content")?.objects()?.joinToString("\n") { it.optString("text") } ?: ""
        }.filter { it.isNotEmpty() }.joinToString("\n")
        if (text.isNotEmpty()) return text
    }
    p.str("rawOutput")?.let { return it }
    return p.toString(2)
}

val SUBAGENT_STATUS = mapOf("running" to "进行中", "busy" to "进行中", "pendingInit" to "启动中", "completed" to "完成", "idle" to "空闲",
    "failed" to "失败", "errored" to "失败", "cancelled" to "已取消", "stopped" to "已停止", "shutdown" to "已停止")

/** Text attachments travel inline in the user message; split them out so the phone can show file chips. */
data class UserMessageParts(val text: String, val files: List<Pair<String, String>>)
private val attachmentPattern = Regex("""--- 附加文本文件：(.+?) ---\n([\s\S]*?)\n--- 文件结束 ---""")
fun splitAttachments(text: String): UserMessageParts {
    val files = attachmentPattern.findAll(text).map { it.groupValues[1] to it.groupValues[2] }.toList()
    if (files.isEmpty()) return UserMessageParts(text, emptyList())
    return UserMessageParts(attachmentPattern.replace(text, "").trim(), files)
}

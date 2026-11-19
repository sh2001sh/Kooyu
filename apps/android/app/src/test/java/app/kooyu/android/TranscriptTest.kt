package app.kooyu.android

import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class TranscriptTest {
    @Test fun imageOnlyMessageKeepsTimestampAndAttachment() {
        val t = buildTranscript(JSONArray("""[{"id":"image","type":"message","createdAt":"2026-11-15T10:00:00Z","payload":{"role":"user","text":"","attachments":[{"fileId":"file","displayName":"photo.png"}]}}]""").objects())
        assertEquals(1, t.rows.size)
        assertEquals("2026-11-15T10:00:00Z", t.rows[0].createdAt)
        assertEquals("photo.png", t.rows[0].attachments.single().getString("displayName"))
    }
    @Test fun binaryAttachmentIsBoundedWithoutUtf8Decoding() {
        val data = byteArrayOf(0, -1, 127, 10)
        assertArrayEquals(data, readAttachmentBytes(java.io.ByteArrayInputStream(data), 4))
        assertThrows(IllegalArgumentException::class.java) { readAttachmentBytes(java.io.ByteArrayInputStream(data), 3) }
    }

    private fun events(json: String) = JSONArray(json).objects()

    @Test fun toolLifecycleMergesIntoOneRowAndShowsStatus() {
        val t = buildTranscript(events("""[
            {"id":"u","type":"message","payload":{"role":"user","text":"跑测试"}},
            {"id":"t1","type":"tool","payload":{"type":"commandExecution","id":"cmd-1","command":"npm test","lifecycle":"started"}},
            {"id":"t2","type":"tool","payload":{"type":"commandExecution","id":"cmd-1","exitCode":1,"aggregatedOutput":"1 failed"}},
            {"id":"a","type":"text-delta","payload":{"text":"测试失败了"}}
        ]"""))
        assertEquals(listOf(RowRole.USER, RowRole.TOOL, RowRole.ASSISTANT), t.rows.map { it.role })
        val tool = t.rows[1]
        assertEquals(listOf("t1", "t2"), tool.eventIds)
        val summary = toolSummary(tool.payload!!)
        assertEquals("运行命令", summary.title)
        assertEquals("npm test", summary.detail)
        assertEquals(ToolStatus.FAILED, summary.status)
        assertEquals("1 failed", toolOutput(tool.payload!!))
    }

    @Test fun thinkingStreamsAsItsOwnBlockAndIsPendingUntilAnswer() {
        val pending = buildTranscript(events("""[{"id":"d1","type":"text-delta","payload":{"channel":"thought","itemId":"r1","text":"先看"}},
            {"id":"d2","type":"text-delta","payload":{"channel":"thought","itemId":"r1","text":"文件"}}]"""))
        assertTrue(pending.thinkingPending)
        assertEquals(listOf(RowRole.THINKING to "先看文件"), pending.rows.map { it.role to it.text })
        val answered = buildTranscript(events("""[{"id":"d1","type":"text-delta","payload":{"channel":"thought","itemId":"r1","text":"先看"}},
            {"id":"d3","type":"text-delta","payload":{"text":"好的"}}]"""))
        assertFalse(answered.thinkingPending)
    }

    @Test fun consecutiveToolsGroupAndAssistantContinuationDropsHeader() {
        val t = buildTranscript(events("""[
            {"id":"u","type":"message","payload":{"role":"user","text":"q"}},
            {"id":"a1","type":"text-delta","payload":{"text":"看看"}},
            {"id":"t1","type":"tool","payload":{"type":"tool_use","id":"x","name":"Read","input":{"file_path":"a.ts"}}},
            {"id":"t2","type":"tool","payload":{"type":"tool_use","id":"y","name":"Grep","input":{"pattern":"foo"}}},
            {"id":"a2","type":"text-delta","payload":{"text":"完成"}}
        ]"""))
        val blocks = transcriptBlocks(t.rows)
        assertEquals(4, blocks.size)
        assertEquals(2, (blocks[2] as TranscriptBlock.Tools).rows.size)
        assertEquals(listOf(false, false, false, true), continuationFlags(blocks))
    }

    @Test fun subagentCollectsNestedEventsAndStatus() {
        val t = buildTranscript(events("""[
            {"id":"s1","type":"subagent","payload":{"agentId":"ag","name":"审查","status":"running"}},
            {"id":"s2","type":"subagent","payload":{"agentId":"ag","event":{"type":"text-delta","payload":{"text":"发现问题"}}}},
            {"id":"s3","type":"subagent","payload":{"agentId":"ag","event":{"type":"turn-ended","payload":{"outcome":"completed"}}}}
        ]"""))
        val child = t.rows.single().child!!
        assertEquals("审查", child.name)
        assertEquals("completed", child.status)
        assertEquals("发现问题", buildTranscript(child.events).rows.single().text)
    }

    @Test fun failedTurnBecomesErrorOnce() {
        val t = buildTranscript(events("""[
            {"id":"e1","type":"turn-ended","payload":{"outcome":"failed","error":{"message":"额度不足"}}},
            {"id":"e2","type":"settled","payload":{"outcome":"failed","error":{"message":"额度不足"}}},
            {"id":"e3","type":"turn-ended","payload":{"outcome":"completed"}}
        ]"""))
        assertEquals(listOf(RowRole.ERROR to "额度不足"), t.rows.map { it.role to it.text })
    }

    @Test fun windowsPowershellWrapperIsStripped() {
        assertEquals("git status", bareCommand("\"C:\\\\Windows\\\\powershell.exe\" -Command 'git status'"))
    }

    @Test fun fencedCodeIsSplitIncludingUnclosedStream() {
        val segments = splitMarkdown("说明\n\n```kotlin\nval a = 1\n```\n后续\n~~~\nopen")
        assertEquals(listOf(
            MarkdownSegment.Prose("说明"), MarkdownSegment.Code("kotlin", "val a = 1"),
            MarkdownSegment.Prose("后续"), MarkdownSegment.Code("", "open")), segments)
    }

    @Test fun attachmentsAreSplitFromUserText() {
        val message = attachedMessage("看看这个", listOf(TextAttachment("1", "a.txt", "内容", 6)))
        val parts = splitAttachments(message)
        assertEquals("看看这个", parts.text)
        assertEquals(listOf("a.txt" to "内容"), parts.files)
    }
}

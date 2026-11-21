package app.kooyu.android

import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*
import app.kooyu.android.ui.screens.*

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.time.LocalDate

class MobileParityTest {
    @Test fun dailyUsageFollowsLocalDateInsteadOfUtcPrefix() {
        assertEquals("2026-11-12", usageDayKey("2026-11-13T01:30:00Z", java.time.ZoneId.of("America/Los_Angeles")))
        assertNull(usageDayKey("invalid"))
    }
    private fun device(id: String, pending: String? = null) = Connection("https://example.com", id, "phone-$id", "token-$id", "2027-01-01", pending?.let { JSONObject().put("id", it) }, "电脑 $id")
    @Test fun legacyConnectionMigratesWithoutLosingTokenOrPending() {
        val book = ConnectionBook.parse(device("a", "pending-a").json())
        assertEquals("a", book.activeHostId); assertEquals("token-a", book.active?.token); assertEquals("pending-a", book.active?.pending?.getString("id"))
    }
    @Test fun bookRoundTripKeepsDeviceCredentialsAndPendingIndependent() {
        val book = ConnectionBook().put(device("a", "op-a"), true).put(device("b", "op-b"))
        val restored = ConnectionBook.parse(JSONObject(book.json().toString()))
        assertEquals("op-b", restored.select("b").active?.pending?.getString("id"))
        assertEquals("token-a", restored.active?.token)
        val cleared = restored.put(restored.active!!.copy(pending = null))
        assertNull(cleared.active?.pending); assertEquals("op-b", cleared.select("b").active?.pending?.getString("id"))
    }
    @Test fun repairingInvalidSelectionDeduplicatesHosts() {
        val json = JSONObject().put("devices", JSONArray(listOf(device("a").json(), device("a").json(), device("b").json()))).put("activeHostId", "deleted")
        val book = ConnectionBook.parse(json)
        assertEquals(listOf("a", "b"), book.devices.map { it.hostId }); assertEquals("a", book.activeHostId)
    }
    @Test fun updatingAndRemovingDevicesKeepStableOrderAndValidSelection() {
        val book = ConnectionBook().put(device("a"), true).put(device("b")).put(device("c")).put(device("b").copy(name = "重命名"))
        assertEquals(listOf("a", "b", "c"), book.devices.map { it.hostId })
        assertEquals("b", book.remove("a").activeHostId); assertEquals("a", book.remove("b").activeHostId)
        assertNull(book.remove("a").remove("b").remove("c").active)
    }
    private fun usage(id: String, session: String, scope: String, date: String, project: String? = null, source: String = "codex", cost: Double? = null) = UsageRecord(id, session, project, source, scope, 20.0, 10.0, null, null, cost, if (cost == null) "unknown" else "actual", null, date)
    @Test fun usageDeduplicatesBeforeApplyingDateAndProjectFilters() {
        val records = listOf(usage("turn", "a", "turn", "2026-10-01T12:00:00Z", "old"), usage("snapshot", "a", "session", "2026-11-13T12:00:00Z", "new"))
        assertTrue(filterUsage(records, UsageFilter(days = 7, projectId = "new"), LocalDate.of(2026, 11, 13)).isEmpty())
        assertEquals(listOf("snapshot"), filterUsage(records, UsageFilter(days = null, scope = "session")).map { it.id })
    }
    @Test fun usageFiltersAndUnknownCostPreserveMeaning() {
        val records = listOf(usage("a", "a", "turn", "2026-11-13T12:00:00Z", "p"), usage("b", "b", "turn", "2026-11-13T12:00:00Z", "p", "kodo", 0.0))
        val selected = filterUsage(records, UsageFilter(days = null, projectId = "p", source = "codex", sessionId = "a"))
        assertEquals(1, selected.size); assertNull(selected.first().costUsd); assertEquals(30.0, selected.first().tokens, 0.0)
        assertEquals(0.0, records[1].costUsd!!, 0.0)
    }
    @Test fun usageParserKeepsBindingBudgetScope() {
        val record = JSONObject("""{"id":"a","sessionId":"s","source":"kodo","scope":"turn","bindingId":"binding","costUsd":null,"firstTokenMs":680,"durationMs":4250}""")
        val parsed = UsageRecord.parse(record)
        assertEquals("binding", parsed.bindingId); assertNull(parsed.costUsd)
        assertEquals(680.0, parsed.firstTokenMs!!, 0.0); assertEquals(4250.0, parsed.durationMs!!, 0.0)
    }
    @Test fun newSessionBodyIsStrictAndPreservesInheritance() {
        val body = SessionDraft(firstMessage = "第一条消息\n下一行").body()
        assertEquals("第一条消息", body.getString("title")); assertFalse(body.has("bindingId")); assertFalse(body.has("requestId")); assertFalse(body.has("firstMessage"))
        assertTrue(SessionDraft(choice = "native").body().has("bindingId")); assertTrue(SessionDraft(choice = "native").body().isNull("bindingId"))
        assertEquals("profile", SessionDraft(choice = "binding:profile").body().getString("bindingId"))
        assertEquals("direct", SessionDraft(harnessId = "codex").body().getString("kind"))
    }
    @Test fun draftValidatesWorkspaceOwnershipAndRequiredBindings() {
        val descriptor = HostHarness("codex", "Codex", "native-models", JSONObject())
        assertNotNull(SessionDraft(harnessId = "codex").validation(descriptor, emptyList(), false))
        val workspaces = listOf(HostWorkspace("w", "p", "/repo"))
        assertNull(SessionDraft(harnessId = "codex", projectId = "p", workspaceId = "w").validation(descriptor, workspaces, false))
        assertNotNull(SessionDraft(harnessId = "codex", projectId = "other", workspaceId = "w").validation(descriptor, workspaces, false))
        assertNotNull(SessionDraft(choice = "native").validation(descriptor.copy(modelSupport = "binding-required"), emptyList(), false))
    }
    @Test fun historyPaginationMergesByIdAndOrdersBySequence() {
        fun event(id: String, sequence: Int, text: String) = JSONObject().put("id", id).put("sequence", sequence).put("text", text)
        val merged = mergeEvents(listOf(event("b", 2, "old")), listOf(event("a", 1, "first"), event("b", 2, "updated"), event("c", 3, "last")))
        assertEquals(listOf("a", "b", "c"), merged.map { it.getString("id") }); assertEquals("updated", merged[1].getString("text"))
    }
    @Test fun permissionOptionsMatchDesktopHarnesses() {
        assertEquals(listOf("accept-edits", "bypass-permissions"), permissionChoices("claude-code").map { it.first })
        assertEquals(permissionChoices("kodo"), permissionChoices("pi")); assertFalse(permissionChoices("kodo").any { it.first == "full-access" })
        assertEquals(5, permissionChoices("zcode").size); assertEquals(3, permissionChoices("kimi-code").size)
    }
    @Test fun providerEditKeepsVersionButNeverSubmitsCredentialReference() {
        val original = JSONObject("""{"id":"provider","revision":3,"catalogProvider":"catalog"}""")
        val endpoint = editableEndpoint(JSONObject("""{"id":"endpoint","name":"API","protocol":"openai-responses","baseUrl":"https://model.test","credentialRef":"secret-ref"}"""))
        val body = providerSaveBody(original, " 名称 ", listOf(endpoint))
        assertEquals(3, body.getInt("expectedRevision")); assertEquals("名称", body.getString("name")); assertFalse(endpoint.has("credentialRef")); assertFalse(endpoint.has("apiKey"))
    }
    @Test fun textAttachmentReadsAllShortChunks() {
        val bytes = "你好，完整文本".repeat(1000).toByteArray()
        val input = object : ByteArrayInputStream(bytes) { override fun read(b: ByteArray, off: Int, len: Int) = super.read(b, off, minOf(len, 7)) }
        val result = readTextAttachment("测试.txt", input, emptyList())
        assertEquals(bytes.size, result.bytes); assertEquals(String(bytes, Charsets.UTF_8), result.content)
    }
    @Test fun attachmentLimitsAreMeasuredInBytes() {
        assertEquals(65536, readTextAttachment("limit.txt", ByteArrayInputStream(ByteArray(65536) { 65 }), emptyList()).bytes)
        assertThrows(IllegalArgumentException::class.java) { readTextAttachment("large.txt", ByteArrayInputStream(ByteArray(65537) { 65 }), emptyList()) }
        val existing = TextAttachment("old", "old.txt", "", 163840)
        assertThrows(IllegalArgumentException::class.java) { readTextAttachment("extra.txt", ByteArrayInputStream(byteArrayOf(65)), listOf(existing)) }
        assertThrows(IllegalArgumentException::class.java) { readTextAttachment("fifth.txt", ByteArrayInputStream(byteArrayOf()), List(4) { existing }) }
    }
    @Test fun attachmentsRejectBinaryAndMalformedUtf8() {
        listOf(byteArrayOf(0, 1), byteArrayOf(0xC3.toByte(), 0x28)).forEach { bytes -> assertThrows(IllegalArgumentException::class.java) { readTextAttachment("bad.txt", ByteArrayInputStream(bytes), emptyList()) } }
    }
    @Test fun attachmentsUseDesktopWireFormatAndSafeNames() {
        val file = readTextAttachment("a\nb.txt", ByteArrayInputStream("内容".toByteArray()), emptyList())
        assertEquals("说明\n\n--- 附加文本文件：a b.txt ---\n内容\n--- 文件结束 ---", attachedMessage(" 说明 ", listOf(file)))
        assertTrue(attachedMessage("", listOf(file)).startsWith("--- 附加文本文件"))
    }
    @Test fun formatWorkspaceLabelSanitizesPathsAcrossPlatforms() {
        assertEquals("", formatWorkspaceLabel(null))
        assertEquals("", formatWorkspaceLabel("   "))
        assertEquals("Coding/agent-harness", formatWorkspaceLabel("D:\\dev\\Coding\\agent-harness"))
        assertEquals("repos/agent-harness", formatWorkspaceLabel("/Users/dev/repos/agent-harness/"))
        assertEquals("/", formatWorkspaceLabel("/"))
    }
    @Test fun i18nResolvesLocalesAndTranslatesPrimaryLabels() {
        assertEquals("en", app.kooyu.android.ui.theme.resolveKooyuLocale("en", "zh"))
        assertEquals("ja", app.kooyu.android.ui.theme.resolveKooyuLocale("system", "ja"))
        assertEquals("zh-CN", app.kooyu.android.ui.theme.resolveKooyuLocale("system", "zh"))
        assertEquals("Chats", app.kooyu.android.ui.theme.kooyuTranslate("en", "dock.chats"))
        assertEquals("チャット", app.kooyu.android.ui.theme.kooyuTranslate("ja", "dock.chats"))
        assertEquals("导入对话", app.kooyu.android.ui.theme.kooyuTranslate("zh-CN", "import.title"))
        assertEquals("Import Chats", app.kooyu.android.ui.theme.kooyuTranslate("en", "import.title"))
        assertEquals("音声入力", app.kooyu.android.ui.theme.kooyuTranslate("ja", "voice.start"))
    }
    @Test fun appendVoiceTranscriptHandlesCjkAndAsciiSpacing() {
        assertEquals("你好世界", app.kooyu.android.ui.conversation.appendVoiceTranscript("", " 你好世界 "))
        assertEquals("hello world", app.kooyu.android.ui.conversation.appendVoiceTranscript("hello", "world"))
        assertEquals("查看代码结构", app.kooyu.android.ui.conversation.appendVoiceTranscript("查看", "代码结构"))
    }
    @Test fun androidUpdaterComparesSemverAndParsesChecksums() {
        assertEquals(1, compareSemver("0.3.0", "0.2.1"))
        assertEquals(0, compareSemver("v0.2.1", "0.2.1"))
        assertEquals(-1, compareSemver("0.2.0", "0.2.1"))
        val sha = "a".repeat(64)
        val parsed = parseSha256SumsText("$sha  Kooyu-0.3.0-android-debug.apk\n")
        assertEquals(sha, parsed["Kooyu-0.3.0-android-debug.apk"])
    }
}

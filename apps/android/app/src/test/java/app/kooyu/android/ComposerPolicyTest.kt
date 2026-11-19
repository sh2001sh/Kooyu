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

class ComposerPolicyTest {
    @Test fun waitingAndUnknownStatesNeverStartANewTurn() {
        assertEquals("new", composerSendMode("idle"))
        listOf("running", "waiting-input", "failed", "unknown", "").forEach { assertEquals("queue", composerSendMode(it)) }
    }
    @Test fun queueExcludesSupervisionNewTurnsAndCompletedCommands() {
        val commands = JSONArray("""[
            {"id":"q","kind":"send","origin":"user","status":"accepted","body":{"mode":"queue","pendingRevision":3}},
            {"id":"n","kind":"send","origin":"user","status":"accepted","body":{"mode":"new"}},
            {"id":"s","kind":"send","origin":"supervisor","status":"accepted","body":{"mode":"queue"}},
            {"id":"done","kind":"send","origin":"user","status":"completed","body":{"mode":"queue"}}
        ]""").objects()
        assertEquals(listOf("q"), pendingUserMessages(commands).map { it.getString("id") })
        assertEquals(3, pendingUserMessages(commands).single().getJSONObject("body").getInt("pendingRevision"))
    }
    @Test fun boundModelIDsDoNotAcquireNativeProviderPrefixes() {
        val m = JSONObject("""{"id":"gpt-5","provider":"openai"}""")
        val native = HostSession("s", "", "opencode", "idle", false)
        val bound = native.copy(raw = JSONObject().put("bindingId", "b"))
        assertEquals("openai/gpt-5", sessionModelOptionId(native, m))
        assertEquals("gpt-5", sessionModelOptionId(bound, m))
    }
    @Test fun reasoningHonorsModelMetadataAndDoesNotInventOptions() {
        assertTrue(providerReasoningLevels(JSONObject(), "codex").isEmpty())
        assertEquals(listOf("off"), providerReasoningLevels(JSONObject().put("reasoning", false), "kodo"))
        val p = JSONObject("""{"reasoningOptions":[{"type":"effort","values":["none","low","high","unexpected"]}]}""")
        assertEquals(listOf("off", "low", "high"), providerReasoningLevels(p, "kodo"))
        assertEquals(listOf("low", "high"), providerReasoningLevels(p, "gemini"))
    }

    @Test fun nativeDefaultsMatchProviderAliasesAndPreferCapabilityMetadata() {
        val recent = JSONObject("""{"id":"gpt-5","provider":"openai"}""")
        val rich = JSONObject("""{"id":"gpt-5","provider":"openai","reasoning":["low","high"]}""")
        val selected = selectComposerModel(listOf(recent, rich), "openai/gpt-5", true)
        assertSame(rich, selected)
        assertEquals(listOf("low", "high"), composerReasoningLevels(selected, null, "openai/gpt-5", "codex"))
        assertEquals("openai/gpt-5", reasoningModelTarget("openai/gpt-5", selected, "codex", false))
        assertEquals("openai/gpt-5", composerDefaultModel(JSONObject("""{"provider":"openai","model":"gpt-5"}""")))
    }
    @Test fun inheritedFlaggedModelsCanBePinnedButUnknownExplicitModelsCannotBorrowEffort() {
        val fallback = JSONObject("""{"id":"claude-opus","isDefault":true,"reasoning":["low","high"]}""")
        assertNull(selectComposerModel(listOf(fallback), "custom-unknown", false))
        val selected = selectComposerModel(listOf(fallback), null, true)
        assertSame(fallback, selected)
        assertEquals("claude-opus", reasoningModelTarget(null, selected, "claude-code", false))
        assertEquals("claude-opus", reasoningModelTarget(null, selected, "claude-code", true))
        assertNull(selectComposerModel(listOf(JSONObject("""{"id":"random"}""")), null, true))
    }
    @Test fun explicitEmptyReasoningAndOtherBindingModelsNeverBorrowDefaults() {
        val binding = JSONObject("""{"model":"gpt-5","parameters":{"reasoningOptions":[{"type":"effort","values":["low","high"]}]}}""")
        val empty = JSONObject("""{"id":"gpt-5","reasoning":[]}""")
        assertTrue(composerReasoningLevels(empty, binding, "gpt-5", "codex").isEmpty())
        assertTrue(composerReasoningLevels(null, binding, "other-model", "codex").isEmpty())
        assertEquals(listOf("low", "high"), composerReasoningLevels(null, binding, "gpt-5", "codex"))
    }
}

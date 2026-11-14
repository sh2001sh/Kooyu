package app.kooyu.android

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeQuestionsTest {
    @Test fun codexAnswerKeepsQuestionIdentityAndSecretField() {
        val form = questionForm(JSONObject("""{"protocol":"codex","method":"item/tool/requestUserInput","params":{"questions":[{"id":"q","question":"请输入","isSecret":true,"options":[]}]}}"""))!!
        assertTrue(form.questions.single().secret)
        val answer = form.answer(emptyMap(), mapOf("q" to " 内容 "), emptySet())
        assertEquals("内容", answer.getJSONObject("answers").getJSONObject("q").getJSONArray("answers").getString(0))
        assertFalse(answer.has("behavior"))
    }
    @Test fun claudeMultiSelectUsesUpdatedInput() {
        val form = questionForm(JSONObject("""{"protocol":"claude","toolName":"AskUserQuestion","input":{"questions":[{"question":"选择","multiSelect":true,"options":[{"label":"A"},{"label":"B"}]}]}}"""))!!
        val answer = form.answer(mapOf("选择" to listOf("A", "B")), emptyMap(), emptySet())
        assertEquals("allow", answer.getString("behavior")); assertEquals("A, B", answer.getJSONObject("updatedInput").getJSONObject("answers").getString("选择"))
    }
    @Test fun openCodeUsesOrderedAnswerArrays() {
        val form = questionForm(JSONObject("""{"protocol":"opencode","type":"question.asked","params":{"questions":[{"question":"第一题","options":[{"label":"A"}]},{"question":"第二题"}]}}"""))!!
        val answer = form.answer(mapOf("0" to listOf("A")), mapOf("1" to "自由回答"), emptySet()).getJSONArray("answers")
        assertEquals("A", answer.getJSONArray(0).getString(0)); assertEquals("自由回答", answer.getJSONArray(1).getString(0))
    }
    @Test fun kimiKeepsOptionIdsCombinesOtherAndSupportsSkip() {
        val form = questionForm(JSONObject("""{"protocol":"kimi","method":"question/request","params":{"questions":[{"id":"a","question":"选择","multi_select":true,"allow_other":true,"options":[{"id":"option-id","label":"标签"}]},{"id":"b","question":"可跳过"}]}}"""))!!
        val answer = form.answer(mapOf("a" to listOf("option-id")), mapOf("a" to "补充"), setOf("b")).getJSONObject("answers")
        assertEquals("multi_with_other", answer.getJSONObject("a").getString("kind")); assertEquals("option-id", answer.getJSONObject("a").getJSONArray("option_ids").getString(0)); assertEquals("skipped", answer.getJSONObject("b").getString("kind"))
    }
    @Test fun malformedOrAmbiguousQuestionsNeverProduceAForm() {
        listOf(
            """{"protocol":"unknown","method":"question/request","params":{"questions":[{"question":"x"}]}}""",
            """{"protocol":"codex","method":"item/tool/requestUserInput","params":{"questions":[{"id":1,"question":"x"}]}}""",
            """{"protocol":"codex","method":"item/tool/requestUserInput","params":{"questions":[{"id":"a","question":"x"},{"id":"a","question":"y"}]}}""",
            """{"protocol":"claude","toolName":"AskUserQuestion","input":{"questions":[{"question":"x","options":[{"label":"A"},{"label":"A"}]}]}}""",
            """{"protocol":"kimi","method":"question/request","params":{"questions":[{"id":"q","question":"x","options":[{"label":"No ID"}]}]}}"""
        ).forEach { assertNull(questionForm(JSONObject(it))) }
    }
    @Test fun modelIdsKeepNativeProvidersButAvoidDoublePrefixingBindings() {
        assertEquals("anthropic/sonnet", modelOptionId("kodo", JSONObject().put("id", "sonnet").put("provider", "anthropic")))
        assertEquals("sonnet", modelOptionId("kodo", JSONObject().put("id", "sonnet").put("provider", "kodo-provider")))
        assertEquals("gpt-model", modelOptionId("codex", JSONObject().put("id", "gpt-model").put("provider", "openai")))
    }
    @Test fun providerBindingCanSelectItsFrozenModel() {
        val body = SessionDraft(choice = "binding:profile", model = "selected-model").body()
        assertEquals("profile", body.getString("bindingId")); assertEquals("selected-model", body.getString("model"))
    }
}

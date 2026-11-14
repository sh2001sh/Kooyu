package app.kooyu.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HostAPITest {
    @Test fun invalidSuccessResponseDoesNotAcknowledgePendingWrites() {
        assertEquals(true, responseObject("{\"ok\":true}").getBoolean("ok"))
        assertEquals(0, responseObject("null", allowNull = true).length())
        listOf("", "<html>proxy error</html>", "[]", "null").forEach { text ->
            val error = assertThrows(HostError::class.java) { responseObject(text) }
            assertEquals(0, error.status)
        }
    }
    @Test fun httpsOriginsOnly() {
        assertEquals("example.com", HostAPI.origin("https://example.com").host)
        listOf("http://example.com", "https://a:b@example.com", "https://example.com/api", "https://example.com?token=x", "https://example.com#x").forEach {
            assertThrows(IllegalArgumentException::class.java) { HostAPI.origin(it) }
        }
    }
    @Test fun finalMessageReplacesStreamingDeltas() {
        val events = JSONArray("""[
            {"id":"delta1","type":"text-delta","payload":{"text":"半句"}},
            {"id":"final","type":"message","payload":{"role":"assistant","content":[{"type":"text","text":"完整回答"}]}},
            {"id":"delta2","type":"text-delta","payload":{"channel":"thought","text":"内部思考"}}
        ]""")
        val rows = transcript(events)
        assertEquals(listOf(RowRole.ASSISTANT to "完整回答", RowRole.THINKING to "内部思考"), rows.map { it.role to it.text })
    }
    @Test fun relayPrefixIsPreserved() {
        val address = "https://relay.kooyu.app/h/" + "a".repeat(64)
        val base = HostAPI.origin(address)
        assertEquals(address + "/api/sessions?tail=300", HostAPI.apiUrl(base, "/sessions?tail=300").toString())
        assertThrows(IllegalArgumentException::class.java) { HostAPI.origin("https://relay.kooyu.app/h/not-a-host") }
        assertThrows(IllegalArgumentException::class.java) { HostAPI.apiUrl(base, "/../../healthz") }
    }
    @Test fun pendingRequestKeepsItsIdentityAcrossProcessDeath() {
        val c = Connection("https://example.com", "host-a", "device", "secret", "2027-01-01",
            JSONObject().put("id", "stable-id").put("path", "/sessions/a/send").put("body", JSONObject().put("text", "你好")))
        val restored = Connection.parse(JSONObject(c.json().toString()))
        assertEquals("stable-id", restored.pending?.getString("id"))
        assertEquals("你好", restored.pending?.getJSONObject("body")?.getString("text"))
    }
}

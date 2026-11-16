package app.kooyu.android

import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class NotificationStreamTest {
    private val host = "82a30839-5639-4f37-909e-7265cb86707b"
    private val otherHost = "f581246b-f1e3-47f6-91d9-a26a0e72f326"
    private val relay = "https://relay.example/h/" + "a".repeat(64)
    private val connection = Connection(relay, host, "paired-device", "test-bearer-secret", "2027-01-01")
    private fun item() = JSONObject().put("id", "question:1").put("sequence", 9).put("link", JSONObject().put("hostId", host))

    @Test fun targetRejectsUntrustedHostsAndBoundsIdentifiers() {
        assertNull(NotificationTarget.parse("https://evil.example", "question"))
        assertNull(NotificationTarget.parse("1-1-1-1-1", "question"))
        assertNull(NotificationTarget.parse(host, ""))
        assertNull(NotificationTarget.parse(host, ".."))
        assertNull(NotificationTarget.parse(host, "a\ncommand"))
        assertNull(NotificationTarget.parse(host, "问".repeat(334)))
        val target = NotificationTarget.parse(host, "id/../../approve?answer=yes #")!!
        assertEquals("/notifications/id%2F..%2F..%2Fapprove%3Fanswer%3Dyes%20%23", target.path)
        assertNotEquals(target, NotificationTarget.parse(otherHost, target.notificationId))
        assertTrue(HostAPI.apiUrl(HostAPI.origin(relay), target.path).encodedPath.startsWith("/h/" + "a".repeat(64) + "/api/notifications/"))
    }
    @Test fun parserPreservesMultilineDataAndIgnoresComments() {
        val parser = NotificationFrameParser()
        assertNull(parser.line(": heartbeat")); assertNull(parser.line(""))
        assertNull(parser.line("event: notification")); assertNull(parser.line("id: 9"))
        assertNull(parser.line("data: {\"a\":")); assertNull(parser.line("data: 1}"))
        assertEquals(NotificationFrame("notification", "{\"a\":\n1}"), parser.line(""))
        assertNull(parser.line("data: next"))
        assertEquals(NotificationFrame("message", "next"), parser.line(""))
    }
    @Test fun parserBoundsBothSingleLinesAndCombinedRecords() {
        assertThrows(IllegalArgumentException::class.java) { NotificationFrameParser().line("data: " + "x".repeat(65536)) }
        val parser = NotificationFrameParser()
        parser.line("data: " + "a".repeat(40000))
        assertThrows(IllegalArgumentException::class.java) { parser.line(":" + "b".repeat(40000)) }
    }
    @Test fun cursorRejectsForeignHostsAndResetDoesNotBecomeANotification() {
        val value = item()
        assertEquals(9L, notificationCursor(NotificationFrame("notification", value.toString()), host))
        assertNull(notificationCursor(NotificationFrame("notification", value.toString()), otherHost))
        assertNull(notificationCursor(NotificationFrame("message", value.toString()), host))
        value.put("sequence", -1)
        assertNull(notificationCursor(NotificationFrame("notification", value.toString()), host))
        value.put("sequence", 1.5)
        assertNull(notificationCursor(NotificationFrame("notification", value.toString()), host))
        value.put("sequence", "9")
        assertNull(notificationCursor(NotificationFrame("notification", value.toString()), host))
        assertEquals(50L, notificationCursor(NotificationFrame("reset", "{\"cursor\":50,\"items\":[]}"), host))
    }
    /** Test-only rewrite targets the loopback fixture. Production has no insecure transport option. */
    private fun client(server: MockWebServer) = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .addInterceptor { chain ->
            val original = chain.request()
            chain.proceed(original.newBuilder().url(server.url(original.url.encodedPath + (original.url.encodedQuery?.let { "?" + it } ?: ""))).build())
        }.build()

    @Test fun streamKeepsRelayPrefixAndBearerHeaderAndReportsRevocation() = runBlocking {
        MockWebServer().use { server ->
            val body = "id: 9\nevent: notification\ndata: " + item() + "\n\nevent: auth-expired\ndata: {}\n\n"
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(body))
            val frames = mutableListOf<NotificationFrame>()
            var failure: Throwable? = null
            withTimeout(5000) { NotificationStream(client(server)).events(connection, 8).onEach { frames.add(it) }.catch { failure = it }.collect() }
            assertEquals(1, frames.size)
            assertEquals(9L, notificationCursor(frames.single(), host))
            assertEquals(401, (failure as HostError).status)
            assertFalse(failure!!.message!!.contains(connection.token))
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("/h/" + "a".repeat(64) + "/api/notifications/events?after=8", request.path)
            assertEquals("Bearer " + connection.token, request.getHeader("Authorization"))
        }
    }
    @Test fun streamNeverFollowsRedirectsOrDisclosesBearerToAnotherOrigin() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://other.example/steal"))
            var failure: Throwable? = null
            withTimeout(5000) { NotificationStream(client(server)).events(connection, null).catch { failure = it }.collect() }
            assertEquals(302, (failure as HostError).status)
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun cancellingStreamClosesItsInflightRequest() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val task = async { NotificationStream(client(server)).events(connection, null).collect() }
            withTimeout(5000) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { assertNotNull(server.takeRequest(2, TimeUnit.SECONDS)) }
                task.cancelAndJoin()
            }
            assertTrue(task.isCancelled)
        }
    }
    @Test fun oversizedStreamFailsWithRedactedError() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: " + "secret".repeat(12000) + "\n\n"))
            var failure: Throwable? = null
            withTimeout(5000) { NotificationStream(client(server)).events(connection, null).catch { failure = it }.collect() }
            assertTrue(failure is HostError)
            assertFalse(failure!!.message!!.contains("secret"))
        }
    }
}

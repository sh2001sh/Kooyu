import XCTest
@testable import Kooyu

final class HostAPITests: XCTestCase {
    func testOnlyHTTPSOriginsAreAccepted() throws {
        XCTAssertEqual(try HostAPI.origin("https://example.com").host, "example.com")
        for address in ["http://example.com", "https://user:password@example.com", "https://example.com/api", "https://example.com?token=secret", "https://example.com#fragment"] {
            XCTAssertThrowsError(try HostAPI.origin(address), address)
        }
    }
    func testTranscriptAcceptsContentBlocksAndDelta() throws {
        let message = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"role":"assistant","content":[{"type":"text","text":"你好"}]}"#.utf8))
        XCTAssertEqual(message.text, "你好")
        let event = try JSONDecoder().decode(RuntimeEvent.self, from: Data(#"{"id":"1","type":"text-delta","sequence":1,"payload":{"delta":"继续"}}"#.utf8))
        XCTAssertEqual(event.text, "继续")
    }
    func testRelayPrefixIsPreserved() throws {
        let address = "https://relay.kooyu.app/h/" + String(repeating: "a", count: 64)
        let base = try HostAPI.origin(address)
        XCTAssertEqual(try HostAPI.apiURL(base, path: "/sessions?tail=300").absoluteString, address + "/api/sessions?tail=300")
        XCTAssertThrowsError(try HostAPI.origin("https://relay.kooyu.app/h/not-a-host"))
        XCTAssertThrowsError(try HostAPI.apiURL(base, path: "/../../healthz"))
        XCTAssertThrowsError(try HostAPI.apiURL(base, path: "/%2e%2e/healthz"))
        XCTAssertThrowsError(try HostAPI.apiURL(base, path: "/sessions/./healthz"))
    }
    func testPendingOperationSurvivesSerialization() throws {
        let connection = Connection(url: "https://example.com", hostId: "host-a", deviceId: "device-a", token: "secret", expiresAt: "2027-01-01", pending: PendingOperation(id: "stable-id", path: "/sessions/a/send", body: .object(["text": .string("你好")])))
        let decoded = try JSONDecoder().decode(Connection.self, from: JSONEncoder().encode(connection))
        XCTAssertEqual(decoded.pending?.id, "stable-id")
        XCTAssertEqual(decoded.pending?.body["text"].string, "你好")
    }
    func testFinalMessageReplacesDeltasAndKeepsThoughtsSeparate() throws {
        let events = try JSONDecoder().decode([RuntimeEvent].self, from: Data(#"[{"id":"d1","sequence":1,"type":"text-delta","payload":{"text":"半句"}},{"id":"m1","sequence":2,"type":"message","payload":{"role":"assistant","text":"完整回答"}},{"id":"d2","sequence":3,"type":"text-delta","payload":{"channel":"thought","text":"私有思考"}}]"#.utf8))
        let rows = transcript(events)
        XCTAssertEqual(rows.map(\.text), ["完整回答", "私有思考"])
        XCTAssertEqual(rows.map(\.role), [.assistant, .thinking])
    }
}

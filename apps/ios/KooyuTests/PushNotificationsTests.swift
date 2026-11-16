import XCTest
@testable import Kooyu

final class PushNotificationsTests: XCTestCase {
    func testPushOnlyCarriesHostAndNotificationIdentity() throws {
        let host = UUID().uuidString.lowercased()
        let target = try XCTUnwrap(NotificationTarget(payload: ["kooyu": ["hostId": host, "notificationId": "question:abc/def?answer=approve", "url": "https://attacker.test", "answer": "approve"]]))
        XCTAssertEqual(target.hostId, host)
        XCTAssertEqual(target.notificationId, "question:abc/def?answer=approve")
        XCTAssertFalse(target.path.contains("?"))
        XCTAssertFalse(target.path.contains("https://"))
        XCTAssertTrue(target.path.hasPrefix("/notifications/"))
    }
    func testMalformedOrUnboundedTargetsCannotNavigate() {
        let host = UUID().uuidString
        XCTAssertNil(NotificationTarget(payload: [:]))
        XCTAssertNil(NotificationTarget(hostId: "https://attacker.test", notificationId: "n"))
        XCTAssertNil(NotificationTarget(hostId: host, notificationId: ""))
        XCTAssertNil(NotificationTarget(hostId: host, notificationId: "a\nb"))
        XCTAssertNil(NotificationTarget(hostId: host, notificationId: String(repeating: "字", count: 400)))
    }
    func testSameNotificationIdOnDifferentHostsHasDifferentIdentity() throws {
        let first = try XCTUnwrap(NotificationTarget(hostId: UUID().uuidString, notificationId: "same-event"))
        let second = try XCTUnwrap(NotificationTarget(hostId: UUID().uuidString, notificationId: "same-event"))
        XCTAssertNotEqual(first, second)
    }
}

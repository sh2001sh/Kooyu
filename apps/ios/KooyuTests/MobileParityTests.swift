import XCTest
@testable import Kooyu

final class MobileParityTests: XCTestCase {
    func testDailyUsageFollowsLocalDate() {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(usageDayKey("2026-11-13T01:30:00Z", calendar: calendar), "2026-11-12")
        XCTAssertNil(usageDayKey("invalid", calendar: calendar))
    }
    private func device(_ id: String, pending: String? = nil) -> Connection {
        Connection(url: "https://example.com", hostId: id, deviceId: "phone-" + id, token: "token-" + id, expiresAt: "2027-01-01", pending: pending.map { PendingOperation(id: $0, path: "/sessions/s/send", body: .object(["text": .string("hello")])) }, name: "电脑 " + id)
    }
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    func testLegacyVaultMigratesCredentialAndPending() throws {
        let book = try JSONDecoder().decode(ConnectionBook.self, from: JSONEncoder().encode(device("a", pending: "op-a")))
        XCTAssertEqual(book.activeHostId, "a"); XCTAssertEqual(book.active?.token, "token-a"); XCTAssertEqual(book.active?.pending?.id, "op-a")
    }
    func testBookKeepsIndependentPendingAndStableDeviceOrder() throws {
        var book = ConnectionBook(); book.put(device("a", pending: "op-a"), activate: true); book.put(device("b", pending: "op-b")); book.put(device("a", pending: nil))
        let restored = try JSONDecoder().decode(ConnectionBook.self, from: JSONEncoder().encode(book))
        XCTAssertEqual(restored.devices.map(\.hostId), ["a", "b"]); XCTAssertNil(restored.active?.pending); XCTAssertEqual(restored.devices[1].pending?.id, "op-b")
        book.remove("a"); XCTAssertEqual(book.activeHostId, "b"); book.remove("b"); XCTAssertNil(book.active)
    }
    func testBookRepairsDuplicateAndInvalidSelection() throws {
        let a = String(decoding: try JSONEncoder().encode(device("a")), as: UTF8.self)
        let b = String(decoding: try JSONEncoder().encode(device("b")), as: UTF8.self)
        let data = Data("{\"devices\":[\(a),\(a),\(b)],\"activeHostId\":\"missing\"}".utf8)
        let book = try JSONDecoder().decode(ConnectionBook.self, from: data)
        XCTAssertEqual(book.devices.map(\.hostId), ["a", "b"]); XCTAssertEqual(book.activeHostId, "a")
    }
    func testUsageDeduplicatesBeforeDateAndProjectFiltering() throws {
        let raw = #"[{"id":"turn","sessionId":"s","scope":"turn","source":"codex","costKind":"unknown","createdAt":"2026-10-01T12:00:00Z","projectId":"old"},{"id":"snapshot","sessionId":"s","scope":"session","source":"codex","costKind":"unknown","createdAt":"2026-11-13T12:00:00Z","projectId":"new"}]"#
        let records = try JSONDecoder().decode([UsageRecord].self, from: Data(raw.utf8))
        let now = ISO8601DateFormatter().date(from: "2026-11-13T18:00:00Z")!
        XCTAssertTrue(filteredUsage(records, days: 7, project: "new", now: now).isEmpty)
        XCTAssertEqual(filteredUsage(records, days: 0, scope: "session").map(\.id), ["snapshot"])
        XCTAssertNil(records[0].costUsd)
    }
    func testStrictDraftSeparatesInheritanceAndExplicitNative() {
        var draft = SessionDraft(); draft.firstMessage = "首条消息\n第二行"
        XCTAssertEqual(draft.body["title"].string, "首条消息"); XCTAssertNil(draft.body.object["bindingId"]); XCTAssertNil(draft.body.object["requestId"])
        draft.choice = "native"; XCTAssertNotNil(draft.body.object["bindingId"])
        draft.choice = "binding:profile"; draft.model = "selected"; XCTAssertEqual(draft.body["bindingId"].string, "profile"); XCTAssertEqual(draft.body["model"].string, "selected")
        draft.title = ""; draft.firstMessage = "   "; XCTAssertEqual(draft.body["title"].string, "新对话")
    }
    func testWorkspaceOwnershipIsValidated() throws {
        let raw = #"{"protocolVersion":2,"hostId":"h","sessions":[],"projects":[],"inbox":[],"harnesses":[{"id":"codex","name":"Codex","modelSupport":"native-models"}],"workspaces":[{"id":"w","projectId":"p","rootPath":"/repo"}]}"#
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(raw.utf8))
        var draft = SessionDraft(); draft.harnessId = "codex"; XCTAssertNotNil(draft.validation(snapshot))
        draft.projectId = "p"; draft.workspaceId = "w"; XCTAssertNil(draft.validation(snapshot))
        draft.projectId = "other"; XCTAssertNotNil(draft.validation(snapshot))
    }
    func testHistoryPagesDeduplicateAndSortEvents() throws {
        let a = try JSONDecoder().decode([RuntimeEvent].self, from: Data(#"[{"id":"b","sequence":2,"type":"message","payload":{"text":"old"}}]"#.utf8))
        let b = try JSONDecoder().decode([RuntimeEvent].self, from: Data(#"[{"id":"a","sequence":1,"type":"message","payload":{"text":"first"}},{"id":"b","sequence":2,"type":"message","payload":{"text":"new"}}]"#.utf8))
        let merged = mergedEvents(a, b); XCTAssertEqual(merged.map(\.id), ["a", "b"]); XCTAssertEqual(merged[1].text, "new")
    }
    func testAttachmentWireFormatMatchesDesktop() {
        let file = MobileTextAttachment(id: "a", name: "a\nb.txt", content: "内容", bytes: 6)
        XCTAssertEqual(attachedMessage(" 说明 ", [file]), "说明\n\n--- 附加文本文件：a b.txt ---\n内容\n--- 文件结束 ---")
    }
    func testCodexQuestionsKeepIdsAndSecretField() throws {
        let payload = try json(#"{"protocol":"codex","method":"item/tool/requestUserInput","params":{"questions":[{"id":"q","question":"请输入","isSecret":true}]}}"#)
        let form = try XCTUnwrap(nativeQuestionForm(payload)); XCTAssertTrue(form.questions[0].secret)
        let answer = form.answer(selected: [:], custom: ["q": "内容"], skipped: [])
        XCTAssertEqual(answer["answers"]["q"]["answers"].array.first?.string, "内容")
    }
    func testKimiQuestionsKeepOptionIdsAndOtherText() throws {
        let payload = try json(#"{"protocol":"kimi","method":"question/request","params":{"questions":[{"id":"q","question":"选择","multi_select":true,"allow_other":true,"options":[{"id":"opt","label":"标签"}]},{"id":"skip","question":"可跳过"}]}}"#)
        let form = try XCTUnwrap(nativeQuestionForm(payload))
        let answer = form.answer(selected: ["q": ["opt"]], custom: ["q": "补充"], skipped: ["skip"])
        XCTAssertEqual(answer["answers"]["q"]["kind"].string, "multi_with_other"); XCTAssertEqual(answer["answers"]["q"]["option_ids"].array.first?.string, "opt"); XCTAssertEqual(answer["answers"]["skip"]["kind"].string, "skipped")
    }
    func testQuestionParserRejectsAmbiguousIdentities() throws {
        for raw in [#"{"protocol":"codex","method":"item/tool/requestUserInput","params":{"questions":[{"question":"missing id"}]}}"#, #"{"protocol":"claude","toolName":"AskUserQuestion","input":{"questions":[{"question":"x","options":[{"label":"same"},{"label":"same"}]}]}}"#] { XCTAssertNil(nativeQuestionForm(try json(raw))) }
    }
    func testNativeModelIdsPreserveProviderQualification() throws {
        XCTAssertEqual(nativeModelID("kodo", try json(#"{"id":"sonnet","provider":"anthropic"}"#)), "anthropic/sonnet")
        XCTAssertEqual(nativeModelID("kodo", try json(#"{"id":"sonnet","provider":"kodo-profile"}"#)), "sonnet")
    }
    func testFormatWorkspaceLabelSanitizesPathsAcrossPlatforms() {
        XCTAssertEqual(formatWorkspaceLabel(#"C:\Users\dev\Projects\agent-harness"#), "Projects/agent-harness")
        XCTAssertEqual(formatWorkspaceLabel("/Users/alice/work/kooyu-app/"), "work/kooyu-app")
        XCTAssertEqual(formatWorkspaceLabel("/home/runner/repo"), "repo")
        XCTAssertEqual(formatWorkspaceLabel("/var/log"), "var/log")
        XCTAssertEqual(formatWorkspaceLabel("/"), "/")
        XCTAssertEqual(formatWorkspaceLabel(nil), "")
        XCTAssertEqual(formatWorkspaceLabel("   "), "")
    }
}

import XCTest
@testable import Kooyu

final class TranscriptTests: XCTestCase {
    private func events(_ json: String) throws -> [RuntimeEvent] {
        var sequence = 0
        let raw = try JSONDecoder().decode([JSONValue].self, from: Data(json.utf8))
        return raw.map { value in
            sequence += 1
            return RuntimeEvent(id: value["id"].string, type: value["type"].string, sequence: sequence, payload: value["payload"])
        }
    }

    func testToolLifecycleMergesIntoOneRowAndShowsStatus() throws {
        let t = buildTranscript(try events(#"""
        [{"id":"u","type":"message","payload":{"role":"user","text":"跑测试"}},
         {"id":"t1","type":"tool","payload":{"type":"commandExecution","id":"cmd-1","command":"npm test","lifecycle":"started"}},
         {"id":"t2","type":"tool","payload":{"type":"commandExecution","id":"cmd-1","exitCode":1,"aggregatedOutput":"1 failed"}},
         {"id":"a","type":"text-delta","payload":{"text":"测试失败了"}}]
        """#))
        XCTAssertEqual(t.rows.map(\.role), [.user, .tool, .assistant])
        XCTAssertEqual(t.rows[1].eventIds, ["t1", "t2"])
        let summary = toolSummary(t.rows[1].payload)
        XCTAssertEqual(summary.title, "运行命令")
        XCTAssertEqual(summary.detail, "npm test")
        XCTAssertEqual(summary.status, .failed)
        XCTAssertEqual(toolOutput(t.rows[1].payload), "1 failed")
    }

    func testThinkingIsPendingUntilAnswer() throws {
        let pending = buildTranscript(try events(#"[{"id":"d1","type":"text-delta","payload":{"channel":"thought","itemId":"r1","text":"先看"}},{"id":"d2","type":"text-delta","payload":{"channel":"thought","itemId":"r1","text":"文件"}}]"#))
        XCTAssertTrue(pending.thinkingPending)
        XCTAssertEqual(pending.rows.map(\.text), ["先看文件"])
        let answered = buildTranscript(try events(#"[{"id":"d1","type":"text-delta","payload":{"channel":"thought","itemId":"r1","text":"先看"}},{"id":"d3","type":"text-delta","payload":{"text":"好的"}}]"#))
        XCTAssertFalse(answered.thinkingPending)
    }

    func testConsecutiveToolsGroupAndContinuationDropsHeader() throws {
        let t = buildTranscript(try events(#"""
        [{"id":"u","type":"message","payload":{"role":"user","text":"q"}},
         {"id":"a1","type":"text-delta","payload":{"text":"看看"}},
         {"id":"t1","type":"tool","payload":{"type":"tool_use","id":"x","name":"Read","input":{"file_path":"a.ts"}}},
         {"id":"t2","type":"tool","payload":{"type":"tool_use","id":"y","name":"Grep","input":{"pattern":"foo"}}},
         {"id":"a2","type":"text-delta","payload":{"text":"完成"}}]
        """#))
        let blocks = transcriptBlocks(t.rows)
        XCTAssertEqual(blocks.count, 4)
        if case .tools(let rows) = blocks[2] { XCTAssertEqual(rows.count, 2) } else { XCTFail("expected tool group") }
        XCTAssertEqual(continuationFlags(blocks), [false, false, false, true])
    }

    func testSubagentCollectsNestedEvents() throws {
        let t = buildTranscript(try events(#"""
        [{"id":"s1","type":"subagent","payload":{"agentId":"ag","name":"审查","status":"running"}},
         {"id":"s2","type":"subagent","payload":{"agentId":"ag","event":{"type":"text-delta","payload":{"text":"发现问题"}}}},
         {"id":"s3","type":"subagent","payload":{"agentId":"ag","event":{"type":"turn-ended","payload":{"outcome":"completed"}}}}]
        """#))
        let child = try XCTUnwrap(t.rows.first?.child)
        XCTAssertEqual(child.name, "审查")
        XCTAssertEqual(child.status, "completed")
        XCTAssertEqual(buildTranscript(child.events).rows.map(\.text), ["发现问题"])
    }

    func testFailedTurnBecomesErrorOnce() throws {
        let t = buildTranscript(try events(#"""
        [{"id":"e1","type":"turn-ended","payload":{"outcome":"failed","error":{"message":"额度不足"}}},
         {"id":"e2","type":"settled","payload":{"outcome":"failed","error":{"message":"额度不足"}}},
         {"id":"e3","type":"turn-ended","payload":{"outcome":"completed"}}]
        """#))
        XCTAssertEqual(t.rows.map(\.role), [.error])
        XCTAssertEqual(t.rows.map(\.text), ["额度不足"])
    }

    func testMarkdownBlocks() {
        let blocks = parseMarkdown("# 标题\n\n- [x] 完成\n- 普通\n  1. 嵌套\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```swift\nlet a = 1\n```\n> 引用\n\n---\n结尾")
        XCTAssertEqual(blocks.first, .heading(level: 1, text: "标题"))
        guard case .list(false, _, let items) = blocks[1] else { return XCTFail("expected list") }
        XCTAssertEqual(items.first?.checked, true)
        XCTAssertEqual(items.count, 2)
        if case .list(true, 1, _)? = items[1].blocks.last {} else { XCTFail("expected nested ordered list") }
        XCTAssertEqual(blocks[2], .table(header: ["a", "b"], rows: [["1", "2"]]))
        XCTAssertEqual(blocks[3], .code(language: "swift", code: "let a = 1"))
        if case .quote = blocks[4] {} else { XCTFail("expected quote") }
        XCTAssertEqual(blocks[5], .rule)
        XCTAssertEqual(blocks[6], .paragraph("结尾"))
    }

    func testUnclosedFenceStreamsAsCode() {
        XCTAssertEqual(parseMarkdown("前文\n```\nopen"), [.paragraph("前文"), .code(language: "", code: "open")])
    }

    func testAttachmentsSplitFromUserText() {
        let message = attachedMessage("看看这个", [MobileTextAttachment(id: "1", name: "a.txt", content: "内容", bytes: 6)])
        let parts = splitAttachments(message)
        XCTAssertEqual(parts.text, "看看这个")
        XCTAssertEqual(parts.files.map(\.name), ["a.txt"])
        XCTAssertEqual(parts.files.map(\.content), ["内容"])
    }
}

import XCTest
@testable import Kooyu

final class ComposerPolicyTests: XCTestCase {
    func testWaitingAndUnknownStatesQueue() {
        XCTAssertEqual(composerSendMode("idle"), "new")
        for state in ["running", "waiting-input", "failed", "unknown", ""] { XCTAssertEqual(composerSendMode(state), "queue") }
    }
    func testOnlyAcceptedUserQueueMessagesAreEditable() throws {
        let json = #"[{"id":"q","kind":"send","origin":"user","status":"accepted","body":{"mode":"queue"}},{"id":"n","kind":"send","origin":"user","status":"accepted","body":{"mode":"new"}},{"id":"s","kind":"send","origin":"supervisor","status":"accepted","body":{"mode":"queue"}}]"#
        let commands = try JSONDecoder().decode([JSONValue].self, from: Data(json.utf8))
        XCTAssertEqual(pendingUserMessages(commands).map { $0["id"].string }, ["q"])
    }
    func testReasoningFollowsMetadata() throws {
        XCTAssertEqual(providerReasoningLevels(.object([:]), "codex"), [])
        XCTAssertEqual(providerReasoningLevels(.object(["reasoning": .bool(false)]), "kodo"), ["off"])
        let p = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"reasoningOptions":[{"type":"effort","values":["none","low","high","unexpected"]}]}"#.utf8))
        XCTAssertEqual(providerReasoningLevels(p, "kodo"), ["off", "low", "high"])
        XCTAssertEqual(providerReasoningLevels(p, "gemini"), ["low", "high"])
    }

    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    func testProviderAliasesPreferRichMetadataAndPinEffectiveModel() throws {
        let recent = try json(#"{"id":"gpt-5","provider":"openai"}"#)
        let rich = try json(#"{"id":"gpt-5","provider":"openai","reasoning":["low","high"]}"#)
        let selected = selectComposerModel([recent, rich], "openai/gpt-5", inherited: true)
        XCTAssertEqual(composerReasoningLevels(selected, binding: nil, current: "openai/gpt-5", harness: "codex"), ["low", "high"])
        XCTAssertEqual(reasoningModelTarget("openai/gpt-5", selected: selected, harness: "codex", bound: false), "openai/gpt-5")
        XCTAssertEqual(composerDefaultModel(try json(#"{"provider":"openai","model":"gpt-5"}"#)), "openai/gpt-5")
    }
    func testFlagsOnlyApplyToInheritedModelAndBoundIDsRemainRaw() throws {
        let fallback = try json(#"{"id":"gpt-5","provider":"openai","isDefault":true,"reasoning":["high"]}"#)
        XCTAssertNil(selectComposerModel([fallback], "custom-unknown", inherited: false))
        let selected = selectComposerModel([fallback], "", inherited: true)
        XCTAssertEqual(reasoningModelTarget("", selected: selected, harness: "opencode", bound: false), "openai/gpt-5")
        XCTAssertEqual(reasoningModelTarget("", selected: selected, harness: "opencode", bound: true), "gpt-5")
        XCTAssertNil(selectComposerModel([try json(#"{"id":"random"}"#)], "", inherited: true))
    }
    func testEmptyMetadataAndOtherModelsDoNotBorrowBindingEffort() throws {
        let binding = try json(#"{"model":"gpt-5","parameters":{"reasoningOptions":[{"type":"effort","values":["low","high"]}]}}"#)
        let empty = try json(#"{"id":"gpt-5","reasoning":[]}"#)
        XCTAssertEqual(composerReasoningLevels(empty, binding: binding, current: "gpt-5", harness: "codex"), [])
        XCTAssertEqual(composerReasoningLevels(nil, binding: binding, current: "other", harness: "codex"), [])
        XCTAssertEqual(composerReasoningLevels(nil, binding: binding, current: "gpt-5", harness: "codex"), ["low", "high"])
    }
}

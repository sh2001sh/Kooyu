import SwiftUI

struct NativeQuestionOption: Identifiable { let id, label, detail: String }
struct NativeQuestion: Identifiable { let id, text, body: String; let options: [NativeQuestionOption]; let multiple, custom, secret: Bool }
struct NativeQuestionForm {
    let kind: String, questions: [NativeQuestion]
    func answer(selected: [String: [String]], custom: [String: String], skipped: Set<String>) -> JSONValue {
        func values(_ q: NativeQuestion) -> [String] { let text = (custom[q.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines); return text.isEmpty ? selected[q.id] ?? [] : [text] }
        if kind == "opencode" { return .object(["answers": .array(questions.map { .array(values($0).map { .string($0) }) })]) }
        if kind == "codex" { return .object(["answers": .object(Dictionary(uniqueKeysWithValues: questions.map { ($0.id, .object(["answers": .array(values($0).map { .string($0) })])) }))]) }
        if kind == "claude" { return .object(["behavior": .string("allow"), "updatedInput": .object(["answers": .object(Dictionary(uniqueKeysWithValues: questions.map { ($0.id, .string(values($0).joined(separator: ", "))) }))])]) }
        var answers: [String: JSONValue] = [:]
        for q in questions {
            let text = (custom[q.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines), ids = selected[q.id] ?? []
            if skipped.contains(q.id) { answers[q.id] = .object(["kind": .string("skipped")]) }
            else if !text.isEmpty && q.multiple && !ids.isEmpty { answers[q.id] = .object(["kind": .string("multi_with_other"), "option_ids": .array(ids.map { .string($0) }), "other_text": .string(text)]) }
            else if !text.isEmpty { answers[q.id] = .object(["kind": .string("other"), "text": .string(text)]) }
            else if q.multiple { answers[q.id] = .object(["kind": .string("multi"), "option_ids": .array(ids.map { .string($0) })]) }
            else { answers[q.id] = .object(["kind": .string("single"), "option_id": .string(ids.first ?? "")]) }
        }
        return .object(["method": .string("click"), "answers": .object(answers)])
    }
}
func nativeQuestionForm(_ payload: JSONValue) -> NativeQuestionForm? {
    let kind = payload["protocol"].string
    let recognized = kind == "claude" && payload["toolName"].string == "AskUserQuestion" || kind == "codex" && payload["method"].string == "item/tool/requestUserInput" || kind == "opencode" && payload["type"].string == "question.asked" || kind == "kimi" && payload["method"].string == "question/request"
    guard recognized, case .array(let raw) = payload[kind == "claude" ? "input" : "params"]["questions"], (1...20).contains(raw.count) else { return nil }
    var questions: [NativeQuestion] = []
    for (index, q) in raw.enumerated() {
        guard case .string(let text) = q["question"] else { return nil }
        if ["codex", "kimi"].contains(kind), q["id"].string.isEmpty { return nil }
        let options: [JSONValue]
        switch q["options"] { case .array(let values): options = values; case .null: options = []; default: return nil }
        guard options.count <= 100 else { return nil }
        var normalized: [NativeQuestionOption] = []
        for option in options {
            guard case .string(let label) = option["label"] else { return nil }
            let id = kind == "kimi" ? option["id"].string : label
            if kind == "kimi" && id.isEmpty || normalized.contains(where: { $0.id == id }) { return nil }
            normalized.append(NativeQuestionOption(id: id, label: label, detail: option["description"].string))
        }
        let key = ["codex", "kimi"].contains(kind) ? q["id"].string : kind == "claude" ? text : String(index)
        if questions.contains(where: { $0.id == key }) { return nil }
        let multiple = kind == "claude" ? q["multiSelect"].boolean : kind == "kimi" ? q["multi_select"].boolean : kind == "opencode" && q["multiple"].boolean
        let custom = options.isEmpty || (kind == "codex" ? q["isOther"].boolean : kind == "kimi" ? q["allow_other"].boolean : kind == "opencode" ? { if case .bool(false) = q["custom"] { return false }; return true }() : true)
        questions.append(NativeQuestion(id: key, text: text, body: kind == "kimi" ? q["body"].string : "", options: normalized, multiple: multiple, custom: custom, secret: kind == "codex" && q["isSecret"].boolean))
    }
    return NativeQuestionForm(kind: kind, questions: questions)
}
struct NativeQuestionFields: View {
    @Bindable var model: Workbench
    let item: InboxItem, form: NativeQuestionForm
    @State private var selected: [String: [String]] = [:]
    @State private var custom: [String: String] = [:]
    @State private var skipped = Set<String>()
    private var ready: Bool { form.questions.allSatisfy { form.kind == "kimi" && skipped.contains($0.id) || !(custom[$0.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !(selected[$0.id] ?? []).isEmpty } }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(form.questions) { q in
                Text(q.text).font(.headline)
                if !q.body.isEmpty { Text(q.body) }
                ForEach(q.options) { option in
                    Button {
                        let previous = selected[q.id] ?? []
                        selected[q.id] = q.multiple ? (previous.contains(option.id) ? previous.filter { $0 != option.id } : previous + [option.id]) : [option.id]
                        if form.kind != "kimi" || !q.multiple { custom[q.id] = "" }
                    } label: { HStack(alignment: .top, spacing: 12) {
                        let checked = !skipped.contains(q.id) && (selected[q.id] ?? []).contains(option.id) && (form.kind == "kimi" && q.multiple || (custom[q.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Image(systemName: checked ? "checkmark.circle.fill" : "circle").foregroundStyle(checked ? Color.accentColor : Color.secondary)
                        VStack(alignment: .leading) { Text(option.label); if !option.detail.isEmpty { Text(option.detail).font(.caption).foregroundStyle(.secondary) } }
                        Spacer()
                    }.frame(minHeight: 44) }.buttonStyle(.plain).disabled(!model.canWrite || skipped.contains(q.id))
                }
                if q.custom {
                    let binding = Binding(get: { custom[q.id] ?? "" }, set: { custom[q.id] = String($0.prefix(10000)) })
                    if q.secret { SecureField("你的回答", text: binding).textFieldStyle(.roundedBorder).disabled(!model.canWrite || skipped.contains(q.id)) }
                    else { TextField(q.options.isEmpty ? "你的回答" : "其他回答", text: binding).textFieldStyle(.roundedBorder).disabled(!model.canWrite || skipped.contains(q.id)) }
                }
                if form.kind == "kimi" { Button(skipped.contains(q.id) ? "继续回答" : "跳过此题") { if skipped.contains(q.id) { skipped.remove(q.id) } else { skipped.insert(q.id) } }.disabled(!model.canWrite) }
            }
            Button("提交回答") { Task { await model.answer(item, action: NativeAction(label: "提交回答", answer: form.answer(selected: selected, custom: custom, skipped: skipped), destructive: false)) } }.buttonStyle(.kooyuPrimary).disabled(!model.canWrite || !ready)
            if form.kind != "codex" { Button("取消回答") { Task { await model.answer(item, action: NativeAction(label: "取消回答", answer: form.kind == "claude" ? .object(["behavior": .string("deny")]) : .object(["cancelled": .bool(true)]), destructive: false)) } }.disabled(!model.canWrite) }
        }
    }
}

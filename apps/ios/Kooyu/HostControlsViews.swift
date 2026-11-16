import SwiftUI

struct HistorySearchView: View {
    @Bindable var model: Workbench
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var loading = false
    @State private var result: JSONValue?
    var body: some View {
        NavigationStack { List {
            if loading { ProgressView() }
            if let result, result["sessions"].array.isEmpty && result["hits"].array.isEmpty { Text("没有匹配结果。") }
            ForEach(Array((result?["sessions"].array ?? []).enumerated()), id: \.offset) { _, session in
                Button(session["title"].string) { Task { await model.select(session["id"].string); dismiss() } }
            }
            ForEach(Array((result?["hits"].array ?? []).enumerated()), id: \.offset) { _, hit in
                VStack(alignment: .leading, spacing: 8) {
                    Button(model.snapshot?.sessions.first { $0.id == hit["sessionId"].string }?.title ?? "历史消息") { Task { if await model.openSearchHit(hit["sessionId"].string, eventID: hit["eventId"].string) { dismiss() } } }
                    Text(hit["snippet"].string).font(.caption).textSelection(.enabled)
                }
            }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }.navigationTitle("搜索完整历史").searchable(text: $query, prompt: "当前设备的会话与消息内容")
            .toolbar { Button("完成") { dismiss() } }
            .task(id: query) {
                result = nil; guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { loading = false; return }
                loading = true; defer { loading = false }
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
                let encoded = String(query.prefix(1000)).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                result = await model.read("/search?q=" + encoded)
            }
        }
    }
}
struct HostControlsView: View {
    @Bindable var model: Workbench
    @State private var controller = ""
    @State private var target = ""
    @State private var mode = "observe"
    @State private var goal = ""
    @State private var trigger = "turn-ended"
    @State private var continuous = false
    @State private var continuations = "0"
    @State private var failures = "0"
    @State private var budget = "0"
    @State private var endAt = Date().addingTimeInterval(3600)
    @State private var hasDeadline = false
    @State private var confirmation: String?
    private var sessions: [HostSession] { model.snapshot?.sessions.filter { !$0.archived } ?? [] }
    private var limitsValid: Bool {
        [continuations, failures].allSatisfy { $0.isEmpty || (Int($0) ?? -1) >= 0 } && (budget.isEmpty || Double(budget).map { $0.isFinite && $0 >= 0 } == true)
    }
    private var limits: JSONValue {
        var values: [String: JSONValue] = [:]
        values["maxContinuations"] = .number(Double(continuations) ?? 0)
        values["maxFailures"] = .number(Double(failures) ?? 0)
        values["budgetUsd"] = .number(Double(budget) ?? 0)
        if hasDeadline { values["endAt"] = .string(ISO8601DateFormatter().string(from: endAt)) }
        return .object(values)
    }
    var body: some View {
        Form {
            Section {
                Text("主对话需要在项目中创建执行对话时，会主动发起授权请求。你可以在对话中确认，也可以直接要求主对话授权或撤销授权。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("当前托管") {
                if model.snapshot?.supervisions?.isEmpty != false { Text("暂无托管关系。") }
                ForEach(Array((model.snapshot?.supervisions ?? []).enumerated()), id: \.offset) { _, watch in watchRow(watch) }
            }
            Section("创建托管") { watchFields }
            Section("执行边界") { limitFields }
            Section {
                Button("创建托管") { confirmation = "create" }.disabled(!model.canWrite || controller.isEmpty || target.isEmpty || !limitsValid)
                if mode == "continue" { Button("转交目标的控制权") { confirmation = "transfer" }.disabled(!model.canWrite || controller.isEmpty || target.isEmpty || !limitsValid) }
            }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }.navigationTitle("会话托管")
            .confirmationDialog("确认提交到当前设备？", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
                if let action = confirmation { Button("确认", role: action.hasPrefix("revoke:") || action == "transfer" ? .destructive : nil) { confirmation = nil; Task { await submit(action) } } }
            }
    }
    private var watchFields: some View {
        Group {
            Picker("控制会话", selection: $controller) { Text("请选择主对话").tag(""); ForEach(sessions.filter { $0.kind == "supervisor" }) { Text($0.title).tag($0.id) } }.onChange(of: controller) { _, id in if target == id { target = "" } }
            Picker("目标会话", selection: $target) { Text("请选择").tag(""); ForEach(sessions.filter { $0.id != controller }) { Text($0.title).tag($0.id) } }
            Picker("模式", selection: $mode) { Text("仅观察").tag("observe"); Text("通知").tag("notify"); Text("自动继续").tag("continue") }
            TextField("目标与边界", text: $goal, axis: .vertical).lineLimit(3...6)
            Toggle("持续托管", isOn: $continuous)
            Picker("触发时机", selection: $trigger) { Text("回合结束").tag("turn-ended"); Text("任务稳定结束").tag("settled") }
        }
    }
    private var limitFields: some View {
        Group {
            TextField("最大继续次数", text: $continuations).keyboardType(.numberPad)
            TextField("最大连续失败次数", text: $failures).keyboardType(.numberPad)
            TextField("费用上限 USD", text: $budget).keyboardType(.decimalPad)
            Text("0 表示不限制；留空保存时按 0 处理。").font(.footnote).foregroundStyle(.secondary)
            Toggle("设置截止时间", isOn: $hasDeadline)
            if hasDeadline { DatePicker("截止日期和时间", selection: $endAt, displayedComponents: [.date, .hourAndMinute]) }
        }
    }
    private func watchRow(_ watch: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text((sessions.first { $0.id == watch["controllerSessionId"].string }?.title ?? "控制会话") + " → " + (sessions.first { $0.id == watch["targetSessionId"].string }?.title ?? "目标会话")).font(.headline)
            Text(watch["mode"].string + " · " + watch["state"].string).font(.caption).foregroundStyle(.secondary)
            HStack {
                if watch["state"].string == "active" { Button("暂停") { Task { _ = await model.execute("/watches/" + watch["id"].string, method: "PATCH", values: ["state": .string("paused")]) } } }
                if watch["state"].string != "revoked" { Button("撤销托管", role: .destructive) { confirmation = "revoke:" + watch["id"].string } }
            }.buttonStyle(.borderless).disabled(!model.canWrite)
        }
    }
    private func submit(_ action: String) async {
        if action.hasPrefix("revoke:") { _ = await model.execute("/watches/" + String(action.dropFirst(7)), method: "PATCH", values: ["state": .string("revoked")]); return }
        _ = await model.execute(action == "transfer" ? "/watches/transfer" : "/watches", values: ["controllerSessionId": .string(controller), "targetSessionId": .string(target), "mode": .string(mode), "goal": .string(goal), "continuous": .bool(continuous), "trigger": .string(trigger), "limits": limits])
    }
}

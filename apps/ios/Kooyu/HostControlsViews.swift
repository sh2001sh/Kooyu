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
        }.navigationTitle("搜索完整历史").searchable(text: $query, prompt: "当前电脑的会话与消息内容")
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
    @State private var continuations = ""
    @State private var failures = ""
    @State private var budget = ""
    @State private var endAt = ""
    @State private var project = ""
    @State private var grantMode = "create-only"
    @State private var confirmation: String?
    private var sessions: [HostSession] { model.snapshot?.sessions.filter { !$0.archived } ?? [] }
    private var limitsValid: Bool {
        [continuations, failures].allSatisfy { $0.isEmpty || (Int($0) ?? 0) > 0 } && (budget.isEmpty || Double(budget).map { $0.isFinite && $0 > 0 } == true) && (endAt.isEmpty || ISO8601DateFormatter().date(from: endAt) != nil)
    }
    private var limits: JSONValue {
        var values: [String: JSONValue] = [:]
        if let n = Double(continuations) { values["maxContinuations"] = .number(n) }
        if let n = Double(failures) { values["maxFailures"] = .number(n) }
        if let n = Double(budget) { values["budgetUsd"] = .number(n) }
        if !endAt.isEmpty { values["endAt"] = .string(endAt) }
        return .object(values)
    }
    var body: some View {
        Form {
            Section("当前托管") {
                if model.snapshot?.supervisions?.isEmpty != false { Text("暂无托管关系。") }
                ForEach(Array((model.snapshot?.supervisions ?? []).enumerated()), id: \.offset) { _, watch in watchRow(watch) }
            }
            Section("创建托管") { watchFields }
            Section("执行边界") { limitFields }
            Section {
                Button("创建托管") { confirmation = "create" }.disabled(!model.canWrite || controller.isEmpty || target.isEmpty || !limitsValid)
                if mode == "continue" { Button("转交目标的控制权") { confirmation = "transfer" }.disabled(!model.canWrite || controller.isEmpty || target.isEmpty || !limitsValid) }
                Text("自动继续会让主对话按上述边界继续目标会话，控制权转交会使旧控制者的待发操作失效。").font(.footnote).foregroundStyle(.secondary)
            }
            Section("项目授权") {
                Picker("项目", selection: $project) { Text("请选择").tag(""); ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) } }
                Picker("能力", selection: $grantMode) { Text("只可创建").tag("create-only"); Text("可创建与控制").tag("create-and-control"); Text("撤销授权").tag("revoke") }
                Button("提交项目授权") { confirmation = "grant" }.disabled(!model.canWrite || controller.isEmpty || project.isEmpty || !limitsValid)
            }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }.navigationTitle("托管与项目授权")
            .confirmationDialog("确认提交到当前电脑？", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
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
            TextField("最大继续次数（可选）", text: $continuations).keyboardType(.numberPad)
            TextField("最大连续失败次数（可选）", text: $failures).keyboardType(.numberPad)
            TextField("费用上限 USD（可选）", text: $budget).keyboardType(.decimalPad)
            TextField("截止时间 ISO 8601（可选）", text: $endAt).textInputAutocapitalization(.never).autocorrectionDisabled()
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
        if action == "grant" { _ = await model.execute("/sessions/\(controller)/grant", values: ["projectId": .string(project), "mode": .string(grantMode), "goal": .string(goal), "limits": limits]); return }
        _ = await model.execute(action == "transfer" ? "/watches/transfer" : "/watches", values: ["controllerSessionId": .string(controller), "targetSessionId": .string(target), "mode": .string(mode), "goal": .string(goal), "continuous": .bool(continuous), "trigger": .string(trigger), "limits": limits])
    }
}

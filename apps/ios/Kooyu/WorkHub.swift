import SwiftUI
import QuickLook

private let workTemplates: [(String, String)] = [
    ("检查项目", "请检查当前项目的结构和运行方式，指出需要优先处理的问题，并给出依据。"),
    ("修复并验证", "请定位并修复以下问题，运行相关检查，并交付修改说明、验证结果和剩余限制：\n"),
    ("整理成果", "请整理本项目当前工作的成果、实际验证记录和待处理事项，并关联来源对话。"),
    ("安排计划", "请帮我创建一个自动计划。先与我确认工作内容、执行时间、时区、执行设备和次数或预算边界，再请求必要授权。")
]
private func workStatus(_ value: String) -> String {
    ["draft": "草稿", "active": "进行中", "blocked": "等你处理", "awaiting-review": "待验收", "completed": "已完成", "cancelled": "已取消", "passed": "检查通过", "failed": "检查失败", "not-applicable": "无需验证", "accepted": "已接收", "deferred": "已延后", "dispatched": "执行中", "confirmed": "已确认", "observed": "已观察", "unknown": "待核对"][value] ?? "未验证"
}
private func planSchedule(_ trigger: JSONValue) -> String {
    if trigger["kind"].string == "webhook" { return "收到事件时执行" }
    if trigger["kind"].string == "interval" { return "每隔 \(Int(trigger["every"].number ?? 1)) " + (["minutes": "分钟", "hours": "小时", "days": "天"][trigger["unit"].string] ?? "小时") }
    if trigger["kind"].string == "calendar" { let timing = PlanTiming(trigger); let prefix = timing.mode == "once" ? timing.date : timing.mode == "daily" ? "每天" : timing.mode == "weekdays" ? "周一至周五" : timing.mode == "weekly" ? "每" + timing.weekdays.map { ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][$0] }.joined(separator: "、") : "每月 \(timing.day) 日"; return prefix + " " + timing.time }
    if trigger["kind"].string != "cron" { return trigger["at"].string }
    let fields = trigger["expression"].string.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    let days = ["*": "每天", "1-5": "每个工作日", "0,6": "每个周末", "6,0": "每个周末", "0": "每周日", "7": "每周日", "1": "每周一", "2": "每周二", "3": "每周三", "4": "每周四", "5": "每周五", "6": "每周六"]
    guard fields.count == 5, let minute = Int(fields[0]), let hour = Int(fields[1]), fields[2] == "*", fields[3] == "*", let day = days[fields[4]] else { return "自定义时间 · " + trigger["expression"].string }
    return day + String(format: " %02d:%02d", hour, minute)
}
private struct WorkSheet: Identifiable {
    let id = UUID()
    let kind: String
    let value: JSONValue
}

struct WorkHubView: View {
    @Bindable var model: Workbench
    @Environment(\.dismiss) private var dismiss
    @State private var project: String
    @State private var tab: String
    @State private var data: JSONValue?
    @State private var search = ""
    @State private var attention = false
    @State private var loading = false
    @State private var error = ""
    @State private var sheet: WorkSheet?
    private let tabs = ["工作记录", "成果", "自动计划", "项目概览", "项目约定", "执行能力", "常用任务"]
    init(model: Workbench, initialProject: String = "", initialTab: String = "工作记录") {
        self.model = model
        _project = State(initialValue: initialProject)
        _tab = State(initialValue: initialTab)
    }
    private func load() async {
        let host = model.connection?.hostId; let scope = project
        loading = true
        let result = await model.read("/workbench" + (project.isEmpty ? "" : "?projectId=\(project)"))
        guard model.connection?.hostId == host, project == scope else { return }
        data = result; error = result == nil ? "未能读取工作记录，请检查连接后刷新。" : ""; loading = false
    }
    private func source(_ id: String) {
        guard model.snapshot?.sessions.contains(where: { $0.id == id }) == true else { error = "来源会话已移除。"; return }
        Task { await model.select(id); model.selectedTab = "sessions"; dismiss() }
    }
    private func compose(_ text: String) { sheet = WorkSheet(kind: "compose", value: .string(text)) }
    private func matches(_ text: String) -> Bool { search.isEmpty || text.localizedCaseInsensitiveContains(search) }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("项目范围", selection: $project) {
                    Text("全部项目").tag("")
                    ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                }.pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 20) { ForEach(tabs, id: \.self) { title in
                        Button { tab = title } label: { Text(title).font(.subheadline.weight(tab == title ? .semibold : .regular)).foregroundStyle(tab == title ? KY.coral : KY.textSecondary).padding(.vertical, 14) }
                    } }.padding(.horizontal, 20)
                }
                Divider()
                StatusView(model: model)
                if loading { ProgressView().padding(12) }
                if !error.isEmpty { Text(error).foregroundStyle(KY.destructive).padding() }
                List {
                    if let data {
                        if ["工作记录", "成果", "自动计划"].contains(tab) {
                            TextField("搜索名称或内容", text: $search)
                            if tab == "工作记录" { Toggle("需要我处理", isOn: $attention) }
                        }
                        switch tab {
                        case "工作记录": work(data)
                        case "成果": artifacts(data)
                        case "自动计划": plans(data)
                        case "项目概览": overview(data)
                        case "项目约定": memories(data)
                        case "执行能力": capabilities(data)
                        default:
                            Text("选择后填入草稿，修改后再发送。").foregroundStyle(KY.textSecondary)
                            ForEach(workTemplates.indices, id: \.self) { index in Button { compose(workTemplates[index].1) } label: { WorkRow(title: workTemplates[index].0, subtitle: workTemplates[index].1) }.buttonStyle(.plain) }
                        }
                    }
                }.listStyle(.plain).refreshable { await load() }
            }
            .background(KY.paper)
            .navigationTitle(project.isEmpty ? "我的工作" : model.snapshot?.projects.first { $0.id == project }?.name ?? "项目工作")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("刷新工作记录").disabled(loading) }
            }
            .task(id: (model.connection?.hostId ?? "") + ":" + project) { data = nil; await load() }
            .sheet(item: $sheet, onDismiss: { Task { await load() } }) { selection in
                switch selection.kind {
                case "goal": GoalDetailView(model: model, goalId: selection.value["id"].string, onOpenSession: source)
                case "artifact": ManagedArtifactView(model: model, artifact: selection.value)
                case "plan": WorkPlanEditor(model: model, plan: selection.value, runs: data?["activations"].array.filter { $0["automationId"].string == selection.value["id"].string } ?? [], canRun: data?["actions"]["automations.run"]["available"].boolean == true, open: source)
                case "memory": WorkMemoryEditor(model: model, memory: selection.value, project: project)
                default: SessionComposerView(model: model, initialProject: project, initialText: selection.value.string)
                }
            }
        }.tint(KY.text)
    }
    @ViewBuilder private func work(_ data: JSONValue) -> some View {
        let inbox = data["inbox"].array.filter { item in matches(model.snapshot?.sessions.first { $0.id == item["sessionId"].string }?.title ?? "") }
        let goals = data["goals"].array.filter { matches($0["title"].string + $0["description"].string) && (!attention || ["blocked", "awaiting-review"].contains($0["status"].string)) }
        let running = data["sessions"].array.filter { session in
            ["running", "waiting-input"].contains(session["runState"].string) && matches(session["title"].string) && (!attention || session["runState"].string == "waiting-input") && !data["inbox"].array.contains { $0["sessionId"].string == session["id"].string } && !data["goals"].array.contains { $0["controllerSessionId"].string == session["id"].string || $0["sessionIds"].array.contains { $0.string == session["id"].string } }
        }
        ForEach(Array(inbox.enumerated()), id: \.offset) { _, item in Button { source(item["sessionId"].string) } label: { WorkRow(title: model.snapshot?.sessions.first { $0.id == item["sessionId"].string }?.title ?? "对话", subtitle: "等待回答或权限确认") }.buttonStyle(.plain) }
        ForEach(Array(goals.enumerated()), id: \.offset) { _, goal in Button { sheet = WorkSheet(kind: "goal", value: goal) } label: { WorkRow(title: goal["title"].string, subtitle: workStatus(goal["status"].string) + " · " + workStatus(goal["verificationStatus"].string)) }.buttonStyle(.plain) }
        ForEach(Array(running.enumerated()), id: \.offset) { _, session in Button { source(session["id"].string) } label: { WorkRow(title: session["title"].string, subtitle: session["runState"].string == "running" ? "正在运行" : "等待输入") }.buttonStyle(.plain) }
        if inbox.isEmpty && goals.isEmpty && running.isEmpty { ContentUnavailableView("暂无匹配工作", systemImage: "square.stack.3d.up", description: Text("在主对话中交代目标，过程、成果和验收会汇集到这里。")); Button("开始对话") { compose("") } }
    }
    @ViewBuilder private func artifacts(_ data: JSONValue) -> some View {
        let entries = data["artifacts"].array.filter { matches($0["artifact"]["title"].string + $0["artifact"]["displayName"].string) }
        ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
            let artifact = entry["artifact"]
            let goal = data["goals"].array.first { $0["id"].string == artifact["goalId"].string }
            VStack(alignment: .leading, spacing: 12) {
                Button { sheet = WorkSheet(kind: "artifact", value: artifact) } label: { WorkRow(title: artifact["title"].string, subtitle: artifact["displayName"].string + " · v\(Int(artifact["version"].number ?? 1))") }.disabled(!entry["available"].boolean).buttonStyle(.plain)
                Text(goal.map { workStatus($0["verificationStatus"].string) } ?? "未关联工作验收").font(.caption).foregroundStyle(KY.textSecondary)
                if !entry["available"].boolean { Text(entry["reason"].string).font(.caption).foregroundStyle(KY.destructive) }
                Button("返回来源对话") { source(artifact["sessionId"].string.isEmpty ? goal?["controllerSessionId"].string ?? "" : artifact["sessionId"].string) }.font(.subheadline)
            }.padding(.vertical, 6)
        }
        if entries.isEmpty { ContentUnavailableView("暂无匹配成果", systemImage: "doc", description: Text("交付文件会保留版本和来源对话。")) }
    }
    @ViewBuilder private func plans(_ data: JSONValue) -> some View {
        Button("通过对话创建计划", systemImage: "plus") { compose(workTemplates[3].1) }
        let plans = data["plans"].array.filter { matches($0["name"].string + $0["promptTemplate"].string) }
        ForEach(Array(plans.enumerated()), id: \.offset) { _, plan in
            Button { sheet = WorkSheet(kind: "plan", value: plan) } label: {
                WorkRow(title: plan["name"].string, subtitle: (plan["enabled"].boolean ? "已启用" : "已暂停") + " · " + plan["timeZone"].string + "\n" + planSchedule(plan["trigger"]) + "\n下次：" + (plan["enabled"].boolean && !plan["nextDueAt"].string.isEmpty ? plan["nextDueAt"].string : "暂无安排"))
            }.buttonStyle(.plain)
        }
        if plans.isEmpty { ContentUnavailableView("暂无匹配计划", systemImage: "calendar", description: Text("从对话创建，再在这里管理时间、边界和运行记录。")) }
    }
    @ViewBuilder private func overview(_ data: JSONValue) -> some View {
        Section("项目目录") { ForEach(Array(data["workspaces"].array.enumerated()), id: \.offset) { _, workspace in WorkRow(title: model.snapshot?.projects.first { $0.id == workspace["projectId"].string }?.name ?? "未分组目录", subtitle: workspace["rootPath"].string, arrow: false) } }
        Section("最近对话") { ForEach(Array(data["sessions"].array.filter { !$0["archived"].boolean }.sorted { $0["createdAt"].string > $1["createdAt"].string }.prefix(12).enumerated()), id: \.offset) { _, session in Button { source(session["id"].string) } label: { WorkRow(title: session["title"].string, subtitle: harnessVisual(session["harnessId"].string).name) }.buttonStyle(.plain) } }
        Button("在此新建对话", systemImage: "plus") { compose("") }
    }
    @ViewBuilder private func memories(_ data: JSONValue) -> some View {
        Button("新增约定", systemImage: "plus") { sheet = WorkSheet(kind: "memory", value: .null) }.disabled(!model.canWrite)
        ForEach(Array(data["memories"].array.enumerated()), id: \.offset) { _, memory in Button { sheet = WorkSheet(kind: "memory", value: memory) } label: { WorkRow(title: memory["subject"].string, subtitle: (memory["scope"].string == "user" ? "全局" : model.snapshot?.projects.first { $0.id == memory["projectId"].string }?.name ?? "项目") + " · " + (memory["status"].string == "confirmed" ? "已确认" : "待确认") + "\n" + memory["content"].string) }.buttonStyle(.plain) }
        if data["memories"].array.isEmpty { ContentUnavailableView("还没有长期约定", systemImage: "book", description: Text("保存稳定的项目规范；临时进度留在对话中。")) }
    }
    @ViewBuilder private func capabilities(_ data: JSONValue) -> some View {
        Text("能力来自当前设备；实际执行仍在设备上。").foregroundStyle(KY.textSecondary)
        ForEach(Array(data["harnesses"].array.enumerated()), id: \.offset) { _, harness in
            let labels = [("directChat", "对话"), ("historyRead", "历史读取"), ("resume", "恢复会话"), ("observeLive", "执行状态"), ("observeExternal", "外部会话"), ("steer", "途中补充"), ("cancel", "停止"), ("interaction", "询问与审批"), ("usage", "用量"), ("quota", "额度")]
            WorkRow(title: harness["name"].string, subtitle: (harness["health"].object.isEmpty ? "尚未检查安装状态" : harness["health"]["installed"].boolean ? "已安装" : "未安装") + "\n" + labels.filter { harness["capabilities"][$0.0].string == "supported" }.map { $0.1 }.joined(separator: " / ") + "\n" + harness["health"]["error"].string, arrow: false)
        }
    }
}

private struct WorkRow: View {
    let title: String
    let subtitle: String
    var arrow = true
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 7) { Text(title).font(.body.weight(.medium)).foregroundStyle(KY.text); Text(subtitle).font(.subheadline).foregroundStyle(KY.textSecondary).lineSpacing(3).lineLimit(5) }
            Spacer(minLength: 8)
            if arrow { Image(systemName: "chevron.right").font(.caption).foregroundStyle(KY.textTertiary) }
        }.padding(.vertical, 10).frame(minHeight: 48).contentShape(Rectangle())
    }
}

private struct WorkPlanEditor: View {
    @Bindable var model: Workbench
    let plan: JSONValue
    let runs: [JSONValue]
    let canRun: Bool
    let open: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = "", prompt = "", zone = "", maxRuns = "0", maxCost = "0", error = ""
    @State private var timing = PlanTiming(.null)
    @State private var preview: [JSONValue] = []
    private func bodyFields() throws -> [String: JSONValue] {
        guard !name.isEmpty, !prompt.isEmpty, !zone.isEmpty, maxRuns.isEmpty || (Int(maxRuns) ?? -1) >= 0, maxCost.isEmpty || Double(maxCost).map { $0.isFinite && $0 >= 0 } == true else { throw APIError(message: "请填写名称、内容与时区；次数须为非负整数，预算须为非负数；0 表示不限制。", status: 400) }
        var fields = plan.object
        for key in ["id", "revision", "dispatchGeneration", "effectiveAt", "nextDueAt", "createdAt", "updatedAt"] { fields.removeValue(forKey: key) }
        fields["expectedRevision"] = plan["revision"]; fields["name"] = .string(name); fields["promptTemplate"] = .string(prompt); fields["timeZone"] = .string(zone); fields["enabled"] = .bool(true)
        var limits: [String: JSONValue] = [:]
        if let count = Int(maxRuns) { limits["maxRuns"] = .number(Double(count)) }; if let cost = Double(maxCost) { limits["maxCostUsd"] = .number(cost) }; fields["limits"] = .object(limits)
        fields["trigger"] = try timing.trigger()
        return fields
    }
    var body: some View {
        NavigationStack {
            Form {
                StatusView(model: model)
                Section("计划设置") {
                    Text(plan["enabled"].boolean ? "已启用" : "已暂停")
                    Text("执行节点：" + (plan["executorId"].string == "local" ? model.connection?.displayName ?? "当前设备" : plan["executorId"].string))
                    TextField("计划名称", text: $name); TextField("工作内容", text: $prompt, axis: .vertical).lineLimit(3...8)
                    PlanScheduleFields(value: $timing, zone: zone)
                    DisclosureGroup("高级设置 · 时区与执行限制") {
                        TextField("执行时区", text: $zone)
                    TextField("最多执行次数（0 不限制）", text: $maxRuns).keyboardType(.numberPad); TextField("最高费用 USD（0 不限制）", text: $maxCost).keyboardType(.decimalPad)
                    }
                    Button("保存并启用") { Task { do { if await model.execute("/automations/\(plan["id"].string)", method: "PATCH", values: try bodyFields()) != nil { dismiss() } } catch { self.error = error.localizedDescription } } }.disabled(!model.canWrite)
                    Button("暂停计划") { Task { if await model.execute("/automations/\(plan["id"].string)/pause", values: ["expectedRevision": plan["revision"]]) != nil { dismiss() } } }.disabled(!model.canWrite)
                    Button("立即执行") { Task { if await model.execute("/automations/\(plan["id"].string)/run") != nil { dismiss() } } }.disabled(!model.canWrite || !canRun || !plan["enabled"].boolean)
                    Text("暂停只影响后续触发；立即执行新增一次运行，不改变原定时间。").font(.footnote).foregroundStyle(KY.textSecondary)
                    Button("预览执行时间") { Task { do { guard let c = model.connection else { return }; var fields = try bodyFields(); fields["requestId"] = .string(UUID().uuidString.lowercased()); let result: JSONValue = try await HostAPI(connection: c).perform("/automations/preview", method: "POST", body: .object(fields)); preview = result["occurrences"].array; error = "" } catch { self.error = error.localizedDescription } } }.disabled(!model.online)
                    ForEach(Array(preview.enumerated()), id: \.offset) { _, at in Text(at.string + " · " + zone).font(.footnote) }
                }
                if !error.isEmpty || !model.error.isEmpty { Text(error.isEmpty ? model.error : error).foregroundStyle(KY.destructive) }
                Section("运行记录") {
                    if runs.isEmpty { Text("暂无运行记录。") }
                    ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                        VStack(alignment: .leading, spacing: 8) { Text(run["receivedAt"].string); Text(workStatus(run["status"].string) + " " + run["lastError"].string).font(.caption).foregroundStyle(KY.textSecondary); if !run["sessionId"].string.isEmpty { Button("查看执行对话") { dismiss(); open(run["sessionId"].string) } } }
                    }
                }
            }.navigationTitle("计划详情").toolbar { Button("完成") { dismiss() } }
            .task { name = plan["name"].string; prompt = plan["promptTemplate"].string; zone = plan["timeZone"].string; timing = PlanTiming(plan["trigger"]); maxRuns = plan["limits"]["maxRuns"].number.map { String(Int($0)) } ?? "0"; maxCost = plan["limits"]["maxCostUsd"].number.map { String($0) } ?? "0" }
        }
    }
}

struct WorkMemoryEditor: View {
    @Bindable var model: Workbench
    let memory: JSONValue
    let project: String
    @Environment(\.dismiss) private var dismiss
    @State private var subject = "", content = ""
    @State private var deleting = false
    private func save(_ status: String) async {
        let existing = !memory["id"].string.isEmpty
        var fields: [String: JSONValue] = ["subject": .string(subject), "content": .string(content), "status": .string(status), "scope": existing ? memory["scope"] : .string(project.isEmpty ? "user" : "project"), "projectId": existing ? memory["projectId"] : project.isEmpty ? .null : .string(project), "sourceRefs": existing ? memory["sourceRefs"] : .array([.string("user:mobile")])]
        if existing { fields["expectedRevision"] = memory["revision"] }
        if await model.execute(existing ? "/memory/\(memory["id"].string)" : "/memory", method: existing ? "PATCH" : "POST", values: fields) != nil { dismiss() }
    }
    var body: some View {
        NavigationStack { Form {
            StatusView(model: model)
            Text((memory["scope"].string == "user" || memory["id"].string.isEmpty && project.isEmpty ? "全局约定" : "项目约定") + " · 确认后下轮生效").foregroundStyle(KY.textSecondary)
            TextField("约定主题", text: $subject); TextField("约定内容", text: $content, axis: .vertical).lineLimit(5...12)
            Button("保存并确认") { Task { await save("confirmed") } }.disabled(!model.canWrite || subject.isEmpty || content.isEmpty)
            if !memory["id"].string.isEmpty { Button("删除约定", role: .destructive) { deleting = true }.disabled(!model.canWrite) }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(KY.destructive) }
        }.navigationTitle(memory["id"].string.isEmpty ? "新增约定" : "编辑约定").toolbar { Button("取消") { dismiss() } }.task { subject = memory["subject"].string; content = memory["content"].string }
        .confirmationDialog("删除这条长期约定？下轮起不再使用。", isPresented: $deleting) { Button("删除", role: .destructive) { Task { await save("deleted") } } }
        }
    }
}

struct ManagedArtifactView: View {
    @Bindable var model: Workbench
    let artifact: JSONValue
    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var preview: URL?
    @State private var error = ""
    @State private var loading = true
    var body: some View {
        NavigationStack { Form {
            Section { Text(artifact["displayName"].string); Text("不可变成果快照 · v\(Int(artifact["version"].number ?? 1))").font(.caption).foregroundStyle(KY.textSecondary) }
            if loading { ProgressView("正在读取设备上的文件…") }
            if !error.isEmpty { Text(error).foregroundStyle(KY.destructive) }
            if let file { Button("预览文件") { preview = file }; ShareLink("保存或分享成果", item: file) }
        }.navigationTitle("成果预览").toolbar { Button("完成") { dismiss() } }.quickLookPreview($preview)
        .task(id: artifact["fileId"].string) {
            do { guard let c = model.connection else { return }; file = try await HostAPI(connection: c).artifactFile(artifact); loading = false }
            catch { self.error = error.localizedDescription; loading = false }
        } }
    }
}

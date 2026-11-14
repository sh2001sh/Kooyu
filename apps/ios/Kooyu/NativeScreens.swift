import SwiftUI
import Charts
import UniformTypeIdentifiers

struct DevicesView: View {
    @Bindable var model: Workbench
    @State private var renaming: Connection?
    @State private var removing: Connection?
    @State private var name = ""

    var body: some View {
        Section("已配对电脑") {
            ForEach(model.book.devices) { device in
                let isCurrent = device.hostId == model.connection?.hostId
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "desktopcomputer")
                            .foregroundStyle(isCurrent ? Color.accentColor : .secondary)
                        Text(device.displayName)
                            .font(.headline)
                        Spacer()
                        if isCurrent {
                            HStack(spacing: 4) {
                                Circle()
                                    .fill(model.online ? Color.green : Color.red)
                                    .frame(width: 6, height: 6)
                                Text(model.online ? "在线" : "离线")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color(uiColor: .tertiarySystemGroupedBackground))
                            .clipShape(Capsule())
                        } else {
                            Button("切换") { model.switchDevice(device.hostId) }
                                .font(.caption.bold())
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .disabled(model.busy)
                        }
                    }

                    if device.pending != nil {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            Text("此电脑有操作结果待核对").font(.footnote).foregroundStyle(.orange)
                        }
                    }

                    HStack {
                        Button("重命名") { renaming = device; name = device.displayName }
                            .font(.caption)
                        Spacer()
                        Button("移除连接", role: .destructive) { removing = device }
                            .font(.caption)
                    }
                    .buttonStyle(.borderless)
                    .disabled(model.busy)
                }
                .padding(.vertical, 6)
            }

            Button {
                model.addingDevice = true
            } label: {
                Label("添加另一台电脑", systemImage: "plus.circle.fill")
                    .font(.body.weight(.medium))
            }
            .disabled(model.busy)

            Text("移除仅清除本机保存的连接凭据；电脑上的任务将继续独立运行。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .alert("电脑名称", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("名称", text: $name)
            Button("保存") { if let device = renaming { model.renameDevice(device.hostId, name: name) }; renaming = nil }
            Button("取消", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("移除本机连接？电脑上的任务不会停止。", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let device = removing { Button("移除「\(device.displayName)」", role: .destructive) { model.removeDevice(device.hostId); removing = nil } }
        }
    }
}

struct DeviceMenu: View {
    @Bindable var model: Workbench
    var body: some View {
        Menu {
            ForEach(model.book.devices) { device in
                Button {
                    model.switchDevice(device.hostId)
                } label: {
                    HStack {
                        Text(device.displayName)
                        if device.hostId == model.connection?.hostId {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
            Divider()
            Button {
                model.addingDevice = true
            } label: {
                Label("添加电脑", systemImage: "plus")
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "desktopcomputer")
                Text(model.connection?.displayName ?? "电脑")
                    .font(.headline)
                Image(systemName: "chevron.down")
                    .font(.caption2.bold())
            }
        }
        .disabled(model.busy)
    }
}

struct SessionComposerView: View {
    @Bindable var model: Workbench
    @Environment(\.dismiss) private var dismiss
    @State private var draft = SessionDraft()
    @State private var catalog: JSONValue?
    @State private var loading = false

    private var harness: HostHarness? { model.snapshot?.harnesses?.first { $0.id == draft.harnessId } }
    private var profiles: [JSONValue] { model.snapshot?.bindings?.filter { $0["harnessId"].string == draft.harnessId && !$0["archived"].boolean } ?? [] }
    private var models: [JSONValue] { catalog?["models"].array ?? [] }

    var body: some View {
        NavigationStack {
            Form {
                Section("会话基础") {
                    TextField("对话标题（可选）", text: $draft.title)
                    Picker("所属项目", selection: $draft.projectId) {
                        Text("全局 · 无所属项目").tag("")
                        ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                    }
                    .onChange(of: draft.projectId) { _, _ in draft.workspaceId = "" }

                    Picker("工作目录", selection: $draft.workspaceId) {
                        Text("未绑定目录").tag("")
                        ForEach(model.snapshot?.workspaces?.filter { draft.projectId.isEmpty || $0.projectId == draft.projectId } ?? []) {
                            Text($0.rootPath).tag($0.id)
                        }
                    }

                    Picker("执行引擎", selection: $draft.harnessId) {
                        ForEach(model.snapshot?.harnesses ?? []) { Text($0.name).tag($0.id) }
                    }
                    .onChange(of: draft.harnessId) { _, _ in
                        draft.choice = "inherit"
                        draft.model = ""
                        draft.reasoning = ""
                        draft.permission = ""
                    }

                    if draft.harnessId == "kodo" {
                        Picker("会话模式", selection: $draft.kind) {
                            Text("Kooyu 主对话（自动监督）").tag("supervisor")
                            Text("直接对话").tag("direct")
                        }
                    }
                }

                Section("模型与权限配置") {
                    if harness?.modelSupport != "native-only" {
                        Picker("模型配置", selection: $draft.choice) {
                            Text("继承项目 / 电脑默认值").tag("inherit")
                            if harness?.modelSupport != "binding-required" {
                                Text("引擎原生默认").tag("native")
                                Text("指定模型").tag("model")
                            }
                            ForEach(Array(profiles.enumerated()), id: \.offset) { _, profile in
                                Text(profile["name"].string).tag("binding:" + profile["id"].string)
                            }
                        }

                        if draft.choice == "model" {
                            Picker("选择模型", selection: $draft.model) {
                                Text("请选择").tag("")
                                ForEach(Array(models.enumerated()), id: \.offset) { _, option in
                                    Text(option["name"].string.isEmpty ? option["id"].string : option["name"].string).tag(option["id"].string)
                                }
                            }
                            TextField("模型 ID", text: $draft.model)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()

                            let levels = models.first { $0["id"].string == draft.model }?["reasoning"].array.map(\.string) ?? []
                            if !levels.isEmpty {
                                Picker("思考强度 (Reasoning)", selection: $draft.reasoning) {
                                    Text("默认").tag("")
                                    ForEach(levels, id: \.self) { Text($0).tag($0) }
                                }
                            }
                        }
                    }

                    let permissions = permissionOptions(draft.harnessId)
                    if !permissions.isEmpty {
                        Picker("工具权限", selection: $draft.permission) {
                            Text("继承电脑默认值").tag("")
                            ForEach(permissions, id: \.0) { Text($0.1).tag($0.0) }
                        }
                    }

                    if loading {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text("正在读取引擎支持模型…").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }

                Section("首条消息（创建后自动发送）") {
                    TextEditor(text: $draft.firstMessage)
                        .frame(minHeight: 120)
                }

                if let issue = draft.validation(model.snapshot) {
                    Section {
                        Label(issue, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                    }
                }
                if !model.error.isEmpty {
                    Section {
                        Text(model.error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("新建对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(model.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(draft.firstMessage.isEmpty ? "创建" : "创建并发送") {
                        Task { if await model.createSession(draft) { dismiss() } }
                    }
                    .disabled(!model.canWrite || draft.validation(model.snapshot) != nil)
                }
            }
            .task(id: draft.harnessId) {
                loading = true
                catalog = nil
                catalog = await model.read("/harnesses/\(draft.harnessId)/models")
                loading = false
            }
            .interactiveDismissDisabled(model.busy)
            .onAppear {
                let preferred = model.appSettings?["defaultHarnessId"].string ?? "kodo"
                if model.snapshot?.harnesses?.contains(where: { $0.id == preferred }) == true {
                    draft.harnessId = preferred
                }
            }
            .onChange(of: draft.harnessId, initial: true) { _, id in
                let defaults = model.appSettings?["harnessDefaults"][id]
                draft.permission = defaults?["permissionMode"].string ?? ""
                draft.reasoning = defaults?["reasoning"].string ?? ""
            }
        }
    }
}

func usd(_ value: Double?) -> String { value.map { String(format: "$%.4f", $0) } ?? "—" }
struct UsageDay: Identifiable { let id: String; let amount: Double }

struct UsageView: View {
    @Bindable var model: Workbench
    @Environment(\.scenePhase) private var phase
    var sessionId: String? = nil
    @State private var days = 14
    @State private var limit = 50
    @State private var project = ""
    @State private var source = ""
    @State private var scope = "all"
    @State private var budgetAmount = ""
    @State private var budgeting = false

    private var records: [UsageRecord] {
        filteredUsage(model.usage?.records ?? [], days: days, project: project, source: source, session: sessionId, scope: scope)
    }
    private var costs: [Double] { records.compactMap(\.costUsd) }
    private var buckets: [UsageDay] {
        Dictionary(grouping: records.filter { $0.costUsd != nil }, by: { String($0.createdAt.prefix(10)) })
            .map { UsageDay(id: $0.key, amount: $0.value.compactMap(\.costUsd).reduce(0, +)) }
            .sorted { $0.id < $1.id }
    }

    var body: some View {
        List {
            Section {
                Picker("时间范围", selection: $days) {
                    Text("最近 7 天").tag(7)
                    Text("最近 14 天").tag(14)
                    Text("最近 30 天").tag(30)
                    Text("全部时间").tag(0)
                }
                Picker("所属项目", selection: $project) {
                    Text("全部项目").tag("")
                    ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                }
                Picker("执行引擎", selection: $source) {
                    Text("全部引擎").tag("")
                    ForEach(Array(Set(model.usage?.records.map(\.source) ?? [])).sorted(), id: \.self) { Text($0).tag($0) }
                }
                Picker("统计口径", selection: $scope) {
                    Text("全部（去重）").tag("all")
                    Text("按轮次").tag("turn")
                    Text("会话快照").tag("session")
                }
            }

            if model.usageLoading && model.usage == nil {
                HStack {
                    ProgressView().controlSize(.small)
                    Text("正在同步用量记录…").font(.footnote).foregroundStyle(.secondary)
                }
            }

            if !model.usageError.isEmpty {
                Section {
                    Text(model.usageError + (model.usage != nil ? " · 显示上次数据" : ""))
                        .foregroundStyle(.red)
                    Button("重新同步") { Task { await model.refreshUsage() } }
                }
            }

            if model.usage != nil {
                Section("费用与消耗汇总") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(costs.isEmpty ? "费用未报告" : usd(costs.reduce(0, +)) + " USD")
                            .font(.system(.largeTitle, design: .rounded).bold())
                            .foregroundStyle(Color.accentColor)

                        Text("实际 \(records.filter { $0.costKind == "actual" }.count) 笔 · 估算 \(records.filter { $0.costKind == "estimate" }.count) 笔 · 未报告 \(records.filter { $0.costUsd == nil }.count) 笔")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)

                    LabeledContent("输入 Token", value: records.compactMap(\.input).reduce(0, +).formatted(.number.precision(.fractionLength(0))))
                    LabeledContent("输出 Token", value: records.compactMap(\.output).reduce(0, +).formatted(.number.precision(.fractionLength(0))))
                    LabeledContent("上下文缓存读取", value: records.compactMap(\.cacheRead).reduce(0, +).formatted(.number.precision(.fractionLength(0))))
                    LabeledContent("上下文缓存写入", value: records.compactMap(\.cacheWrite).reduce(0, +).formatted(.number.precision(.fractionLength(0))))
                }

                Section("每日费用趋势") {
                    if buckets.isEmpty {
                        Text("当前范围内暂无已知费用数据。").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Chart(buckets) { day in
                            BarMark(
                                x: .value("日期", day.id),
                                y: .value("USD", day.amount)
                            )
                            .foregroundStyle(Color.accentColor.gradient)
                            .cornerRadius(4)
                        }
                        .frame(height: 160)
                        .padding(.vertical, 6)
                    }
                }

                Section("预算管理") {
                    ForEach(Array((model.usage?.budgets ?? []).enumerated()), id: \.offset) { _, budget in
                        budgetRow(budget)
                    }
                    Button {
                        budgeting = true
                    } label: {
                        Label("设置项目预算", systemImage: "plus")
                    }
                    .disabled(!model.canWrite)
                }

                Section("用量明细流水（\(records.count) 笔）") {
                    ForEach(Array(records.sorted { $0.createdAt > $1.createdAt }.prefix(limit))) { record in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(record.model ?? record.source)
                                    .font(.subheadline.bold())
                                Spacer()
                                Text(usd(record.costUsd))
                                    .font(.subheadline.bold())
                                    .foregroundStyle(Color.accentColor)
                            }
                            HStack {
                                Text(String(record.createdAt.prefix(19)).replacingOccurrences(of: "T", with: " "))
                                Spacer()
                                Text("入 \(record.input.map { $0.formatted() } ?? "—") / 出 \(record.output.map { $0.formatted() } ?? "—")")
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                    if records.count > limit {
                        Button("加载更多明细…") { limit += 100 }
                            .font(.subheadline)
                    }
                }
            }
        }
        .navigationTitle(sessionId == nil ? "用量与预算" : "会话用量")
        .refreshable { await model.refreshUsage() }
        .task(id: "\(model.connection?.hostId ?? "")-\(phase == .active)") {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.refreshUsage()
                do { try await Task.sleep(for: .seconds(10)) } catch { break }
            }
        }
        .sheet(isPresented: $budgeting) {
            NavigationStack {
                Form {
                    Picker("预算所属项目", selection: $project) {
                        Text("请选择项目").tag("")
                        ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                    }
                    TextField("限额金额 (USD)", text: $budgetAmount)
                        .keyboardType(.decimalPad)
                    if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                }
                .navigationTitle("设置预算")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { budgeting = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            Task {
                                if await model.execute("/budgets", values: ["projectId": .string(project), "usd": .number(Double(budgetAmount) ?? 0)]) != nil {
                                    budgeting = false
                                    await model.refreshUsage()
                                }
                            }
                        }
                        .disabled(!model.canWrite || project.isEmpty || (Double(budgetAmount) ?? 0) <= 0)
                    }
                }
            }
        }
    }

    @ViewBuilder private func budgetRow(_ budget: JSONValue) -> some View {
        let projectID = budget["projectId"].string, bindingID = budget["bindingId"].string
        let costs = filteredUsage(model.usage?.records ?? [], days: 0, project: projectID).filter { bindingID.isEmpty || $0.bindingId == bindingID }.compactMap(\.costUsd)
        let spent = costs.isEmpty ? nil : costs.reduce(0, +)
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent(
                model.snapshot?.projects.first { $0.id == projectID }?.name ?? "模型绑定预算",
                value: usd(budget["usd"].number)
            )
            .font(.headline)

            HStack {
                Text("已发生费用：" + usd(spent))
                Spacer()
                if let spent, let amount = budget["usd"].number {
                    Text("剩余：" + usd(amount - spent))
                        .foregroundStyle(amount - spent > 0 ? .green : .red)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

struct ProjectsView: View {
    @Bindable var model: Workbench
    @State private var editor = false
    @State private var editingProject: HostProject?
    @State private var deleting: HostProject?
    @State private var workspaceProject: String?
    @State private var name = "", path = ""

    var body: some View {
        List {
            ForEach(model.snapshot?.projects ?? []) { project in
                Section {
                    let workspaces = model.snapshot?.workspaces?.filter { $0.projectId == project.id } ?? []
                    if workspaces.isEmpty {
                        Text("未绑定电脑工作目录").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        ForEach(workspaces) { workspace in
                            NavigationLink {
                                WorkspaceBrowserView(model: model, workspace: workspace)
                            } label: {
                                Label(workspace.rootPath, systemImage: "folder")
                                    .font(.subheadline)
                            }
                        }
                    }

                    HStack {
                        Button {
                            workspaceProject = project.id; editingProject = nil; path = ""; editor = true
                        } label: {
                            Label("添加目录", systemImage: "plus")
                        }
                        Spacer()
                        Button("重命名") {
                            editingProject = project; workspaceProject = nil; name = project.name; editor = true
                        }
                        Spacer()
                        Button("删除", role: .destructive) { deleting = project }
                    }
                    .font(.footnote)
                    .buttonStyle(.borderless)
                    .disabled(!model.canWrite)
                } header: {
                    HStack {
                        Text(project.name).font(.headline)
                        Spacer()
                        let count = model.snapshot?.sessions.filter { $0.projectId == project.id && !$0.archived }.count ?? 0
                        Text("\(count) 个会话").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            Section("全局工作位置") {
                ForEach(model.snapshot?.workspaces?.filter { $0.projectId == nil } ?? []) { workspace in
                    NavigationLink {
                        WorkspaceBrowserView(model: model, workspace: workspace)
                    } label: {
                        Label(workspace.rootPath, systemImage: "folder")
                            .font(.subheadline)
                    }
                }
                Button {
                    workspaceProject = ""; editingProject = nil; path = ""; editor = true
                } label: {
                    Label("添加全局目录", systemImage: "plus")
                }
                .disabled(!model.canWrite)
            }
        }
        .navigationTitle("项目与目录")
        .refreshable { await model.refresh() }
        .toolbar {
            Button {
                editingProject = nil; workspaceProject = nil; name = ""; path = ""; editor = true
            } label: {
                Image(systemName: "folder.badge.plus")
            }
            .disabled(!model.canWrite)
        }
        .sheet(isPresented: $editor) {
            NavigationStack {
                Form {
                    if workspaceProject == nil { TextField("项目名称", text: $name) }
                    if editingProject == nil {
                        TextField("电脑上的绝对目录路径", text: $path)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Text(workspaceProject == nil ? "目录可留空，稍后添加。" : "目录必须在当前电脑上已存在。").font(.footnote).foregroundStyle(.secondary)
                    }
                    if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                }
                .navigationTitle(workspaceProject != nil ? "添加工作位置" : editingProject != nil ? "重命名项目" : "新建项目")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { editor = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") { Task { await saveProject() } }
                            .disabled(!model.canWrite || (workspaceProject != nil ? path.isEmpty : name.isEmpty))
                    }
                }
            }
        }
        .confirmationDialog("删除项目并保留会话与电脑文件？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let project = deleting {
                Button("删除项目", role: .destructive) {
                    Task { _ = await model.execute("/projects/\(project.id)?sessions=keep", method: "DELETE"); deleting = nil }
                }
            }
        }
    }

    private func saveProject() async {
        let result: JSONValue?
        if let project = workspaceProject {
            result = await model.execute("/workspaces", values: ["projectId": project.isEmpty ? .null : .string(project), "rootPath": .string(path)])
        } else if let project = editingProject {
            result = await model.execute("/projects/\(project.id)", method: "PATCH", values: ["name": .string(name)])
        } else {
            var fields: [String: JSONValue] = ["name": .string(name)]
            if !path.isEmpty { fields["rootPath"] = .string(path) }
            result = await model.execute("/projects", values: fields)
        }
        if result != nil { editor = false }
    }
}

struct WorkspaceBrowserView: View {
    @Bindable var model: Workbench
    let workspace: HostWorkspace
    @State private var path = "", section = "files"
    @State private var file: String?
    @State private var data: JSONValue?
    @State private var loading = false

    var body: some View {
        List {
            Section {
                Text(workspace.rootPath)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Picker("浏览内容", selection: $section) {
                    Text("文件目录").tag("files")
                    Text("Git 变更").tag("changes")
                }
                .pickerStyle(.segmented)
                .onChange(of: section) { _, _ in file = nil }
            }

            if file != nil {
                Button {
                    file = nil
                } label: {
                    Label("返回列表", systemImage: "arrow.backward")
                }
            } else if !path.isEmpty && section == "files" {
                Button {
                    path = path.split(separator: "/").dropLast().joined(separator: "/")
                } label: {
                    Label("返回上一级", systemImage: "arrow.up")
                }
            }

            if loading {
                HStack {
                    ProgressView().controlSize(.small)
                    Text("正在加载…").font(.footnote).foregroundStyle(.secondary)
                }
            } else if file != nil {
                Text(data?["text"].string.isEmpty == false ? data!["text"].string : data?["reason"].string.isEmpty == false ? data!["reason"].string : "此文件为二进制内容，暂不能作为文本查看。")
                    .textSelection(.enabled)
                    .font(.system(.caption, design: .monospaced))
            } else {
                let entries = data?[section == "files" ? "entries" : "files"].array ?? []
                if entries.isEmpty {
                    Text("暂无文件或变更。").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    let isDir = entry["kind"].string == "directory"
                    Button {
                        if isDir { path = entry["path"].string } else { file = entry["path"].string }
                    } label: {
                        HStack {
                            Label(
                                entry["name"].string.isEmpty ? entry["path"].string : entry["name"].string,
                                systemImage: isDir ? "folder.fill" : "doc.text"
                            )
                            Spacer()
                            if section == "changes" {
                                Text(entry["status"].string)
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.accentColor.opacity(0.15))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    .foregroundStyle(Color(uiColor: .label))
                }
            }
        }
        .navigationTitle("工作区文件")
        .task(id: "\(model.connection?.hostId ?? "")|\(path)|\(section)|\(file ?? "")") {
            loading = true; data = nil
            let base = "/workspaces/\(workspace.id)"
            let safe = (file ?? path).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
            data = await model.read(base + (file != nil ? section == "files" ? "/files/preview?path=\(safe)" : "/changes/diff?path=\(safe)" : section == "files" ? "/files?path=\(safe)" : "/changes"))
            loading = false
        }
    }
}

struct NativeSettingsView: View {
    @Bindable var model: Workbench
    @State private var section = "devices", instructions = "", harness = "kodo"
    @State private var settings: JSONValue?
    @State private var loadingSettings = false

    var body: some View {
        Form {
            Picker("设置分类", selection: $section) {
                Text("电脑").tag("devices")
                Text("引擎").tag("engines")
                Text("通用").tag("general")
            }
            .pickerStyle(.segmented)

            if section == "devices" {
                DevicesView(model: model)
            } else if section == "engines" {
                ForEach(model.snapshot?.harnesses ?? []) { engine in
                    Section(engine.name) {
                        let isReady = engine.health?["launchable"].boolean == true
                        HStack {
                            Text("状态")
                            Spacer()
                            Text(isReady ? "就绪" : engine.health?["error"].string.isEmpty == false ? engine.health!["error"].string : "未就绪")
                                .foregroundStyle(isReady ? .green : .red)
                        }
                        LabeledContent("默认模型", value: engine.nativeDefaults?["model"].string.isEmpty == false ? engine.nativeDefaults!["model"].string : "由引擎决定")
                        ForEach(Array((model.snapshot?.bindings?.filter { $0["harnessId"].string == engine.id } ?? []).enumerated()), id: \.offset) { _, binding in
                            Text(binding["name"].string + " · " + binding["model"].string)
                                .font(.footnote)
                        }
                    }
                }
                Text("引擎安装、登录和系统入口修改需在电脑本机完成。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if let settings {
                Section("宿主默认值") {
                    Picker("新对话默认引擎", selection: $harness) {
                        ForEach(model.snapshot?.harnesses ?? []) { Text($0.name).tag($0.id) }
                    }
                    TextEditor(text: $instructions)
                        .frame(minHeight: 140)
                    Button("保存个人指令与默认引擎") {
                        Task {
                            var values = settings.object
                            values["personalInstructions"] = .string(instructions)
                            values["defaultHarnessId"] = .string(harness)
                            if await model.execute("/app-settings", method: "PATCH", values: values) != nil {
                                self.settings = await model.read("/app-settings")
                            }
                        }
                    }
                    .disabled(!model.canWrite || instructions.count > 16000)

                    Text("保存后应用于此电脑的新建对话，已有会话不受影响。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else if loadingSettings {
                ProgressView("正在同步宿主配置…")
            } else {
                Button("读取失败，点击重试") { Task { await loadSettings() } }
            }

            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }
        .navigationTitle("设置")
        .task(id: "\(model.connection?.hostId ?? "")-\(section)") {
            if section == "general" { await loadSettings() }
        }
    }

    private func loadSettings() async {
        loadingSettings = true; defer { loadingSettings = false }
        settings = await model.read("/app-settings")
        instructions = settings?["personalInstructions"].string ?? ""
        harness = settings?["defaultHarnessId"].string ?? "kodo"
    }
}

struct MobileTextAttachment: Identifiable, Sendable { let id, name, content: String; let bytes: Int }
func attachedMessage(_ text: String, _ files: [MobileTextAttachment]) -> String {
    ([text.trimmingCharacters(in: .whitespacesAndNewlines)] + files.map { "--- 附加文本文件：\($0.name.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")) ---\n\($0.content)\n--- 文件结束 ---" }).filter { !$0.isEmpty }.joined(separator: "\n\n")
}

struct NativeSessionDetails: View {
    @Bindable var model: Workbench
    let session: HostSession
    @Environment(\.dismiss) private var dismiss
    @State private var section = "settings", title = "", project = "", workspace = "", chosenModel = "", reasoning = "", permission = ""
    @State private var options: JSONValue?
    @State private var nativePermissions: JSONValue?

    private var permissions: [(String, String)] {
        let values = nativePermissions?["options"].array.map { ($0["value"].string, $0["label"].string) } ?? []
        return values.isEmpty ? permissionOptions(session.harnessId) : values
    }
    private var models: [JSONValue] { options?["models"].array ?? [] }

    var body: some View {
        NavigationStack {
            List {
                Picker("详情分类", selection: $section) {
                    Text("设置").tag("settings")
                    Text("事件").tag("tools")
                    Text("队列").tag("queue")
                    Text("文件").tag("files")
                }
                .pickerStyle(.segmented)

                if section == "settings" {
                    Section("对话设置") {
                        TextField("会话标题", text: $title)
                        Picker("所属项目", selection: $project) {
                            Text("全局会话").tag("")
                            ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                        }
                        .onChange(of: project) { _, _ in workspace = "" }

                        Picker("工作目录", selection: $workspace) {
                            Text("未绑定目录").tag("")
                            ForEach(model.snapshot?.workspaces?.filter { project.isEmpty || $0.projectId == project } ?? []) {
                                Text($0.rootPath).tag($0.id)
                            }
                        }

                        Button("保存对话设置") {
                            Task {
                                _ = await model.updateSession(
                                    session.id,
                                    values: [
                                        "title": .string(title),
                                        "projectId": project.isEmpty ? .null : .string(project),
                                        "workspaceId": workspace.isEmpty ? .null : .string(workspace)
                                    ]
                                )
                            }
                        }
                        .disabled(!model.canWrite || title.isEmpty || title.count > 200)

                        if !permissions.isEmpty {
                            Picker("工具权限", selection: $permission) {
                                Text("引擎默认").tag("")
                                ForEach(permissions, id: \.0) { Text($0.1).tag($0.0) }
                            }
                            Button("应用权限") {
                                Task {
                                    _ = await model.updateSession(session.id, values: ["permissionMode": permission.isEmpty ? .null : .string(permission)])
                                }
                            }
                            .disabled(!model.canWrite || session.runState != "idle")
                        }
                    }

                    Section("模型与思考强度") {
                        if let options {
                            if options["modelSupport"].string == "native-only" {
                                Text("由此引擎的原生配置选择模型。").font(.footnote).foregroundStyle(.secondary)
                            } else {
                                Picker("模型", selection: $chosenModel) {
                                    Text("默认模型").tag("")
                                    ForEach(Array(models.enumerated()), id: \.offset) { _, option in
                                        Text(option["name"].string.isEmpty ? option["id"].string : option["name"].string).tag(option["id"].string)
                                    }
                                }
                                .onChange(of: chosenModel) { _, _ in reasoning = "" }

                                let levels = models.first { $0["id"].string == chosenModel }?["reasoning"].array.map(\.string) ?? []
                                if !levels.isEmpty {
                                    Picker("思考强度", selection: $reasoning) {
                                        Text("默认").tag("")
                                        ForEach(levels, id: \.self) { Text($0).tag($0) }
                                    }
                                }

                                Button("应用模型设置") {
                                    Task {
                                        let revision = options["session"]["settingsRevision"].number ?? Double(session.settingsRevision ?? 0)
                                        if await model.execute(
                                            "/sessions/\(session.id)/settings",
                                            values: [
                                                "expectedRevision": .number(revision),
                                                "model": chosenModel.isEmpty ? .null : .string(chosenModel),
                                                "reasoning": reasoning.isEmpty ? .null : .string(reasoning)
                                            ]
                                        ) != nil {
                                            self.options = await model.read("/sessions/\(session.id)/settings")
                                        }
                                    }
                                }
                                .disabled(!model.canWrite)
                            }
                        } else {
                            Button("读取模型选项") {
                                Task { options = await model.read("/sessions/\(session.id)/settings") }
                            }
                        }
                    }
                } else if section == "tools" {
                    let events = model.page?.events.filter { !["message", "text-delta"].contains($0.type) } ?? []
                    if events.isEmpty {
                        Text("暂无工具或运行记录。").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(events) { event in
                        DisclosureGroup(event.type + " · " + String(event.payload["name"].string.prefix(40))) {
                            Text(event.payload.formatted)
                                .textSelection(.enabled)
                                .font(.system(.caption, design: .monospaced))
                        }
                    }
                } else if section == "queue" {
                    if model.page?.commands?.isEmpty != false {
                        Text("暂无队列记录。").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(Array((model.page?.commands ?? []).enumerated()), id: \.offset) { _, command in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(command["status"].string)
                                    .font(.caption.bold())
                                    .foregroundStyle(Color.accentColor)
                                Spacer()
                                if command["status"].string == "accepted" {
                                    Button("撤回") {
                                        Task { _ = await model.execute("/sessions/\(session.id)/commands/\(command["id"].string)", method: "DELETE") }
                                    }
                                    .font(.caption)
                                    .buttonStyle(.borderless)
                                    .disabled(!model.canWrite)
                                }
                            }
                            Text(command["body"]["text"].string)
                                .font(.footnote)
                        }
                        .padding(.vertical, 4)
                    }
                } else if let workspace = model.snapshot?.workspaces?.first(where: { $0.id == session.workspaceId }) {
                    NavigationLink("浏览工作区文件与 Git 变更") {
                        WorkspaceBrowserView(model: model, workspace: workspace)
                    }
                } else {
                    Text("此会话未绑定工作目录。").font(.footnote).foregroundStyle(.secondary)
                }

                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
            }
            .navigationTitle("对话详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("完成") { dismiss() } }
            .task(id: session.id) {
                title = session.title
                project = session.projectId ?? ""
                workspace = session.workspaceId ?? ""
                chosenModel = session.model ?? ""
                reasoning = session.reasoning ?? ""
                permission = session.permissionMode ?? ""
                options = await model.read("/sessions/\(session.id)/settings")
                nativePermissions = await model.read("/sessions/\(session.id)/permissions")
            }
        }
    }
}

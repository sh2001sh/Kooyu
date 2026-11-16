import SwiftUI
import Charts
import UniformTypeIdentifiers

struct DevicesView: View {
    @Bindable var model: Workbench
    @State private var renaming: Connection?
    @State private var removing: Connection?
    @State private var name = ""

    var body: some View {
        Section("已配对设备") {
            Button {
                model.addingDevice = true
            } label: {
                Label("添加设备", systemImage: "plus.circle.fill")
                    .font(.body.weight(.medium))
            }
            .disabled(model.busy)

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
                            Text("此设备有操作结果待核对").font(.footnote).foregroundStyle(.orange)
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


        }
        .alert("设备名称", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("名称", text: $name)
            Button("保存") { if let device = renaming { model.renameDevice(device.hostId, name: name) }; renaming = nil }
            Button("取消", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("移除本机连接？设备上的任务不会停止。", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let device = removing { Button("移除「\(device.displayName)」", role: .destructive) { model.removeDevice(device.hostId); removing = nil } }
        }
    }
}

struct DeviceMenu: View {
    @Bindable var model: Workbench
    var body: some View {
        Menu {
            Button {
                model.addingDevice = true
            } label: {
                Label("添加设备", systemImage: "plus")
            }
            Divider()
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
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "desktopcomputer")
                Text(model.connection?.displayName ?? "设备")
                    .font(.headline)
                Image(systemName: "chevron.down")
                    .font(.caption2.bold())
            }
        }
        .disabled(model.busy)
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
    @State private var name = ""
    @State private var path = ""
    @State private var browsingDirectory = false

    var body: some View {
        List {
            ForEach(model.snapshot?.projects ?? []) { project in
                Section {
                    let workspaces = model.snapshot?.workspaces?.filter { $0.projectId == project.id } ?? []
                    if workspaces.isEmpty {
                        Text("未绑定设备工作目录").font(.footnote).foregroundStyle(.secondary)
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
                        Button { browsingDirectory = true } label: { Label(path.isEmpty ? "选择设备目录" : path, systemImage: "folder") }

                    }
                    if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                }
                .sheet(isPresented: $browsingDirectory) { DirectoryPickerView(model: model, initial: path) { selected in
                    path = selected
                    if name.isEmpty { name = selected.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? "新项目" }
                } }
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
        .confirmationDialog("删除项目并保留会话与设备文件？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
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
    @State private var path = ""
    @State private var section = "files"
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

struct SettingsDetailView: View {
    @Bindable var model: Workbench
    let section: String
    @State private var instructions = ""
    @State private var harness = "kodo"
    @State private var settings: JSONValue?
    @State private var loadingSettings = false
    @AppStorage("kooyu.appearance") private var appearance = "system"

    var body: some View {
        Form {
            if section == "general" {
                Section("外观") { Picker("主题", selection: $appearance) { Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") } }
            }
            if section == "models" {
                ModelConfigurationView(model: model)
            } else if section == "host" {
                HostControlsView(model: model)
            } else if section == "devices" {
                DevicesView(model: model)
                if let c = model.connection {
                    Section("后台提醒") {
                        Button("注册后台提醒") { Task { await model.push.enable(c) } }
                            .disabled(model.push.working || !model.online)
                        Button("关闭后台提醒", role: .destructive) { Task { await model.push.disable(c) } }
                            .disabled(model.push.working || !model.online)
                        if model.push.working { ProgressView("正在同步…") }
                    }
                }
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
                        LabeledContent("默认模型", value: engine.nativeDefaults?["model"].string.isEmpty == false ? engine.nativeDefaults!["model"].string : "引擎原生")
                        ForEach(Array((model.snapshot?.bindings?.filter { $0["harnessId"].string == engine.id } ?? []).enumerated()), id: \.offset) { _, binding in
                            Text(binding["name"].string + " · " + binding["model"].string)
                                .font(.footnote)
                        }
                    }
                }
            } else if let settings {
                Section("默认配置") {
                    Picker("默认引擎", selection: $harness) {
                        ForEach(model.snapshot?.harnesses ?? []) { Text($0.name).tag($0.id) }
                    }
                    TextEditor(text: $instructions)
                        .frame(minHeight: 140)
                    Button("保存配置") {
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
                }
            } else if loadingSettings {
                ProgressView("正在同步…")
            } else {
                Button("重试") { Task { await loadSettings() } }
            }

            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }
        .navigationTitle(section == "general" ? "通用与外观" : section == "engines" ? "执行引擎" : "会话托管")
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
    @State private var section = "settings"
    @State private var title = ""
    @State private var project = ""
    @State private var workspace = ""
    @State private var chosenModel = ""
    @State private var reasoning = ""
    @State private var permission = ""
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
                                        Text(option["name"].string.isEmpty ? option["id"].string : option["name"].string).tag(nativeModelID(session.harnessId, option))
                                    }
                                }
                                .onChange(of: chosenModel) { _, _ in reasoning = "" }

                                let levels = models.first { nativeModelID(session.harnessId, $0) == chosenModel || $0["id"].string == chosenModel }?["reasoning"].array.map(\.string) ?? []
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
                        Text("暂无运行事件。").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(events) { event in
                        let tool = event.payload["tool"].string.isEmpty ? (event.payload["name"].string.isEmpty ? event.type : event.payload["name"].string) : event.payload["tool"].string
                        let action = event.payload["action"].string.isEmpty ? event.payload["status"].string : event.payload["action"].string
                        let summary = event.payload["summary"].string.isEmpty ? event.payload["text"].string : event.payload["summary"].string
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(tool).font(.subheadline.bold())
                                if !action.isEmpty {
                                    Text(action).font(.caption2).padding(.horizontal, 4).padding(.vertical, 2).background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
                                }
                                Spacer()
                            }
                            if !summary.isEmpty { Text(summary).font(.caption).foregroundStyle(.secondary) }
                            DisclosureGroup("详情") {
                                Text(event.payload.formatted)
                                    .textSelection(.enabled)
                                    .font(.system(.caption, design: .monospaced))
                            }
                        }
                    }
                } else if section == "queue" {
                    PendingComposerMessages(model: model, session: session)
                } else if let workspace = model.snapshot?.workspaces?.first(where: { $0.id == session.workspaceId }) {
                    NavigationLink("工作区文件与 Git 变更") {
                        WorkspaceBrowserView(model: model, workspace: workspace)
                    }
                } else {
                    Text("未绑定工作目录。").font(.footnote).foregroundStyle(.secondary)
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

struct GoalDetailView: View {
    @Bindable var model: Workbench
    let goalId: String
    var onOpenSession: ((String) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var detail: JSONValue?
    @State private var loading = true
    @State private var note = ""
    @State private var artifactPreview: JSONValue?

    private var goal: JSONValue? { detail?["goal"] }
    private var status: String { goal?["status"].string ?? "draft" }
    private var verificationStatus: String { goal?["verificationStatus"].string ?? "unverified" }

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    ProgressView("正在读取…")
                } else if let goal {
                    if let onOpenSession { Button("返回来源对话") { dismiss(); onOpenSession(goal["controllerSessionId"].string) } }
                    Section("目标") {
                        Text(goal["title"].string).font(.headline)
                        HStack {
                            Text("状态")
                            Spacer()
                            Text(statusLabel(status)).bold()
                        }
                        HStack {
                            Text("验证状态")
                            Spacer()
                            Text(verifyLabel(verificationStatus)).bold()
                        }
                    }

                    let criteria = goal["acceptanceCriteria"].array.map(\.string)
                    if !criteria.isEmpty {
                        Section("验收标准") {
                            ForEach(criteria, id: \.self) { c in
                                Text("• " + c)
                            }
                        }
                    }

                    let artifacts = detail?["artifacts"].array ?? []
                    if !artifacts.isEmpty {
                        Section("交付成果") {
                            ForEach(Array(artifacts.enumerated()), id: \.offset) { _, art in
                                let item = art["artifact"].object.isEmpty ? art : art["artifact"]
                                Button(item["displayName"].string.isEmpty ? item["title"].string : item["displayName"].string) { artifactPreview = item }.disabled(!art["available"].boolean)
                            }
                        }
                    }

                    let verifications = detail?["verifications"].array ?? []
                    if !verifications.isEmpty {
                        Section("验证记录") {
                            ForEach(Array(verifications.enumerated()), id: \.offset) { _, v in
                                HStack {
                                    Text(v["method"].string)
                                    Spacer()
                                    Text(v["outcome"].string == "passed" ? "通过" : v["outcome"].string == "failed" ? "失败" : "无结论")
                                        .foregroundStyle(v["outcome"].string == "passed" ? .green : .red)
                                }
                            }
                        }
                    }

                    if status == "awaiting-review" {
                        Section("验收确认") {
                            TextField("意见", text: $note)
                            HStack(spacing: 12) {
                                Button("接受成果") {
                                    Task {
                                        var values: [String: JSONValue] = ["decision": .string("accept"), "expectedRevision": goal?["revision"] ?? .null]
                                        if !note.isEmpty { values["remainingUncertainty"] = .string(note) }
                                        if await model.execute("/goals/\(goalId)/review", values: values) != nil { dismiss() }
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(!model.canWrite)

                                Button("退回修改") {
                                    Task {
                                        let values: [String: JSONValue] = ["decision": .string("request-changes"), "expectedRevision": goal?["revision"] ?? .null, "note": .string(note)]
                                        if await model.execute("/goals/\(goalId)/review", values: values) != nil { dismiss() }
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(!model.canWrite || note.isEmpty)
                            }
                        }
                    }
                }
            }
            .navigationTitle("目标详情")
            .sheet(isPresented: Binding(get: { artifactPreview != nil }, set: { if !$0 { artifactPreview = nil } })) { if let artifactPreview { ManagedArtifactView(model: model, artifact: artifactPreview) } }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("关闭") { dismiss() } }
            .task {
                loading = true
                detail = await model.read("/goals/\(goalId)/detail")
                loading = false
            }
        }
    }

    private func statusLabel(_ s: String) -> String {
        switch s { case "active": "进行中"; case "blocked": "受阻"; case "awaiting-review": "待验收"; case "completed": "已完成"; case "cancelled": "已取消"; default: "草稿" }
    }

    private func verifyLabel(_ v: String) -> String {
        switch v { case "passed": "检查通过"; case "failed": "检查失败"; case "not-applicable": "无需验证"; default: "未验证" }
    }
}

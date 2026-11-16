import SwiftUI
import UniformTypeIdentifiers

@main struct KooyuApp: App {
    @UIApplicationDelegateAdaptor(KooyuAppDelegate.self) private var appDelegate
    @State private var model = Workbench()
    @AppStorage("kooyu.appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .tint(Color("AccentColor"))
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        }
    }
}

struct RootView: View {
    @Bindable var model: Workbench
    @Environment(\.scenePhase) private var phase
    var body: some View {
        Group {
            if model.connection == nil {
                PairView(model: model)
            } else {
                TabView(selection: $model.selectedTab) {
                    SessionListView(model: model)
                        .tabItem { Label("对话", systemImage: "bubble.left.and.bubble.right.fill") }
                        .tag("sessions")

                    NavigationStack { UsageView(model: model) }
                        .tabItem { Label("用量", systemImage: "chart.bar.xaxis") }
                        .tag("usage")

                    NavigationStack { ModelConfigurationView(model: model) }
                        .tabItem { Label("模型来源", systemImage: "cpu") }
                        .tag("models")

                    NavigationStack { NativeSettingsView(model: model) }
                        .tabItem { Label("设置", systemImage: "gearshape.fill") }
                        .tag("settings")
                }
                .id(model.connection?.hostId)
                .safeAreaInset(edge: .top, spacing: 0) { StatusView(model: model) }
            }
        }
        .sheet(isPresented: $model.addingDevice) {
            PairView(model: model).interactiveDismissDisabled(model.busy)
        }
        .task(id: "\(model.push.pending?.hostId ?? "")/\(model.push.pending?.notificationId ?? "")/\(model.busy)") {
            guard !model.busy, let target = model.push.pending else { return }
            if await model.openNotification(target), model.push.pending == target { model.push.pending = nil }
        }
        .task(id: "\(phase == .active)-\(model.book.devices.map { $0.hostId + $0.deviceId }.joined())") {
            guard phase == .active else { return }
            model.push.isVisible = { [weak model] target in await model?.notificationIsVisible(target) ?? false }
            await model.push.sync(model.book.devices)
        }
        .task(id: "\(phase == .active)-\(model.connection?.token ?? "")") {
            guard phase == .active, model.connection != nil else { model.online = false; return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(2)) } catch { break }
            }
        }
    }
    private var pending: [InboxItem] { model.snapshot?.inbox.filter { !$0.resolved } ?? [] }
}

struct PairView: View {
    @Bindable var model: Workbench
    @State private var address = ""
    @State private var name = ""
    @State private var code = ""
    @State private var showingScanner = false
    @State private var manual = false
    @State private var invitation: PairingInvitation?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "desktopcomputer.and.arrow.forward")
                            .font(.system(size: 48))
                            .foregroundStyle(Color.accentColor)
                            .padding(.top, 8)
                        Text("连接工作台")
                            .font(.title2.weight(.bold))
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                Section {
                    TextField("设备名称", text: $name)

                    Button {
                        invitation = nil
                        model.error = ""
                        showingScanner = true
                    } label: {
                        HStack {
                            Spacer()
                            Label("扫描桌面二维码", systemImage: "qrcode.viewfinder")
                                .font(.headline)
                            Spacer()
                        }
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.kooyuPrimary)
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .disabled(model.busy)
                }

                if let invitation {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("已识别桌面二维码", systemImage: "checkmark.circle.fill")
                                .font(.headline)
                                .foregroundStyle(.green)
                            Button {
                                Task { await model.pair(url: invitation.address, code: invitation.code, name: name) }
                            } label: {
                                HStack {
                                    Spacer()
                                    Text("连接此设备").fontWeight(.semibold)
                                    if model.busy { Spacer(); ProgressView() }
                                    Spacer()
                                }
                                .frame(minHeight: 40)
                            }
                            .buttonStyle(.kooyuPrimary)
                            .disabled(model.busy)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section {
                    DisclosureGroup("手动输入连接信息", isExpanded: $manual) {
                        TextField("https://192.168.1.100:4433", text: $address)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("6 位配对码", text: $code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                        Button {
                            Task { await model.pair(url: address, code: code, name: name) }
                        } label: {
                            HStack {
                                Text("完成配对")
                                Spacer()
                                if model.busy { ProgressView() }
                            }
                        }
                        .disabled(model.busy || address.isEmpty || code.isEmpty)
                    }
                    .disabled(model.busy)

                    Label("相机图像仅在手机本地解码，端对端传输强制使用 HTTPS 加密。", systemImage: "lock.shield")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if !model.error.isEmpty {
                    Section {
                        Text(model.error)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }
                }
            }
            .navigationTitle("连接设备")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.connection != nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { model.addingDevice = false }.disabled(model.busy)
                    }
                }
            }
        }
        .sheet(isPresented: $showingScanner) {
            PairingScannerView(onInvitation: { scanned in
                invitation = scanned
                manual = false
                showingScanner = false
            }, onManual: {
                invitation = nil
                manual = true
                showingScanner = false
            })
        }
    }
}

struct StatusView: View {
    @Bindable var model: Workbench
    @State private var clearing = false
    var body: some View {
        let hasIssue = !model.online || !model.error.isEmpty || model.connection?.pending != nil || !model.notice.isEmpty
        if hasIssue {
            VStack(alignment: .leading, spacing: 6) {
                if !model.online {
                    HStack(spacing: 6) {
                        Image(systemName: "wifi.slash").foregroundStyle(.red)
                        Text("设备已离线，正在重新连接").font(.footnote)
                    }
                }
                if !model.error.isEmpty {
                    Text(model.error).font(.footnote).foregroundStyle(KY.destructive).textSelection(.enabled)
                }
                if model.connection?.pending != nil {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        Text("有一项操作等待核对").font(.footnote)
                        Spacer()
                        Button("查询回执") { Task { await model.refresh() } }
                            .font(.footnote)
                            .disabled(model.busy)
                        Button("核对") { clearing = true }
                            .font(.caption.bold())
                            .buttonStyle(.bordered)
                            .controlSize(.mini)
                    }
                }
                if !model.notice.isEmpty {
                    Text(model.notice).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KY.sunken)
            .overlay(Divider(), alignment: .bottom)
            .confirmationDialog("清除本机待核对标记", isPresented: $clearing, titleVisibility: .visible) {
                Button("已核对，清除标记") {
                    do { try model.clearPending() } catch { model.error = error.localizedDescription }
                }
            }
        }
    }
}

struct SessionListView: View {
    @Bindable var model: Workbench
    @State private var creating = false
    @State private var search = ""
    @State private var project = ""
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    @State private var projectsOpen = false
    @State private var inboxOpen = false
    @State private var archived = false
    @State private var renaming: HostSession?
    @State private var deleting: HostSession?
    @State private var newTitle = ""
    @State private var workOpen = false
    @State private var workProject = ""
    @State private var workTab = "工作记录"

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            List(selection: $model.selected) {
                Section {
                    Button("工作记录与成果", systemImage: "square.stack.3d.up") { workProject = ""; workTab = "工作记录"; workOpen = true }
                    Button("管理项目", systemImage: "folder.badge.plus") { projectsOpen = true }
                    Picker("会话状态", selection: $archived) {
                        Text("进行中").tag(false)
                        Text("已归档").tag(true)
                    }
                    .pickerStyle(.segmented)
                }

                if sessions.isEmpty {
                    ContentUnavailableView(
                        "暂无会话",
                        systemImage: "bubble.left.and.exclamationmark"
                    )
                }

                ForEach(groups, id: \.id) { group in
                    Section {
                ForEach(sessions.filter { ($0.projectId ?? "") == group.id }) { session in
                    NavigationLink(value: session.id) {
                        HStack(spacing: 12) {
                            EngineBadge(harnessId: session.harnessId, size: 34, circle: false)
                                .overlay(alignment: .bottomTrailing) {
                                    if session.runState != "idle" {
                                        Circle().fill(runColor(session.runState)).frame(width: 7, height: 7)
                                            .padding(2).background(KY.paper, in: Circle()).offset(x: 3, y: 3)
                                    }
                                }
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    if session.pinned == true {
                                        Image(systemName: "pin.fill").font(.system(size: 10)).foregroundStyle(KY.textTertiary)
                                    }
                                    Text(session.title.isEmpty ? "未命名对话" : session.title)
                                        .font(.system(size: 15, weight: .medium)).foregroundStyle(KY.text).lineLimit(1)
                                }
                                HStack(spacing: 5) {
                                    Text(harnessVisual(session.harnessId).name)
                                    Text("·").foregroundStyle(KY.textTertiary)
                                    Text(session.stateLabel).foregroundStyle(runColor(session.runState))
                                    if let proj = model.snapshot?.projects.first(where: { $0.id == session.projectId }) {
                                        Text("·").foregroundStyle(KY.textTertiary)
                                        Text(proj.name).lineLimit(1)
                                    }
                                }
                                .font(.system(size: 12))
                                .foregroundStyle(KY.textSecondary)
                                .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 3)
                    }
                    .tag(session.id)
                    .swipeActions(edge: .leading) {
                        Button {
                            Task { _ = await model.updateSession(session.id, values: ["pinned": .bool(session.pinned != true)]) }
                        } label: {
                            Label(session.pinned == true ? "取消置顶" : "置顶", systemImage: session.pinned == true ? "pin.slash" : "pin")
                        }
                        .tint(.orange)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            deleting = session
                        } label: {
                            Label("删除", systemImage: "trash")
                        }

                        Button {
                            Task { _ = await model.updateSession(session.id, values: ["archived": .bool(!session.archived)]) }
                        } label: {
                            Label(session.archived ? "恢复" : "归档", systemImage: session.archived ? "tray.and.arrow.up" : "archivebox")
                        }
                        .tint(.blue)
                    }
                    .contextMenu {
                        Button(session.pinned == true ? "取消置顶" : "置顶") {
                            Task { _ = await model.updateSession(session.id, values: ["pinned": .bool(session.pinned != true)]) }
                        }
                        Button("重命名") { renaming = session; newTitle = session.title }
                        Button(session.archived ? "恢复会话" : "归档会话") {
                            Task { _ = await model.updateSession(session.id, values: ["archived": .bool(!session.archived)]) }
                        }
                        Divider()
                        Button("删除会话", role: .destructive) { deleting = session }
                    }
                    .disabled(model.busy)
                }
                    } header: {
                        HStack {
                            Text(group.name)
                            Spacer()
                            Button { workProject = group.id; workTab = "项目概览"; workOpen = true } label: { Image(systemName: "list.bullet.rectangle").frame(minWidth: 44, minHeight: 44) }.accessibilityLabel("\(group.name)项目概览")
                            Button { project = group.id; creating = true } label: { Image(systemName: "plus").frame(minWidth: 44, minHeight: 44) }.accessibilityLabel("在\(group.name)中新建对话").disabled(!model.canWrite)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("对话")
            .searchable(text: $search, prompt: "搜索会话标题")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { DeviceMenu(model: model) }
                ToolbarItem(placement: .primaryAction) {
                    Button { inboxOpen = true } label: { Image(systemName: "tray").overlay(alignment: .topTrailing) { if (model.snapshot?.inbox.filter { !$0.resolved }.count ?? 0) > 0 { Circle().fill(KY.destructive).frame(width: 7, height: 7) } } }.accessibilityLabel("收件箱")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        project = ""; creating = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .disabled(!model.canWrite)
                }
            }
            .sheet(isPresented: $creating) { SessionComposerView(model: model, initialProject: project) }
            .sheet(isPresented: $projectsOpen) { NavigationStack { ProjectsView(model: model).toolbar { Button("完成") { projectsOpen = false } } } }
            .sheet(isPresented: $inboxOpen) { InboxView(model: model) }
            .sheet(isPresented: $workOpen) { WorkHubView(model: model, initialProject: workProject, initialTab: workTab) }
        } detail: {
            if let session = model.snapshot?.sessions.first(where: { $0.id == model.selected }) {
                ConversationView(model: model, session: session).id(session.id)
            } else {
                ContentUnavailableView(
                    "选择会话",
                    systemImage: "bubble.left.and.bubble.right"
                )
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: model.selected) { _, selected in if selected != nil { compactColumn = .detail } }
        .alert("重命名对话", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("标题", text: $newTitle)
            Button("保存") {
                if let session = renaming {
                    Task { if await model.updateSession(session.id, values: ["title": .string(newTitle)]) { renaming = nil } }
                }
            }
            Button("取消", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("删除会话记录？此操作不可撤回。", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let session = deleting {
                Button("删除会话", role: .destructive) {
                    Task { await model.deleteSession(session.id); deleting = nil }
                }
            }
        }
    }

    private var groups: [HostProject] {
        [HostProject(id: "", name: "全局对话")] + (model.snapshot?.projects ?? [])
    }

    private var sessions: [HostSession] {
        model.snapshot?.sessions.filter {
            $0.archived == archived &&
            (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search))
        }.sorted { $0.pinned == true && $1.pinned != true } ?? []
    }

    private func runColor(_ state: String) -> Color {
        switch state { case "running": KY.success; case "waiting-input": KY.info; case "idle": KY.textTertiary; default: KY.destructive }
    }

    private func stateColor(_ label: String) -> Color {
        switch label {
        case "运行中": return .blue
        case "等待审批", "等待输入": return .orange
        default: return .secondary
        }
    }
}

struct HarnessTag: View {
    let harnessId: String
    var body: some View {
        let v = harnessVisual(harnessId)
        HStack(spacing: 3) {
            Text(v.monogram).font(.system(size: 8, weight: .bold))
            Text(v.name).font(.system(size: 10, weight: .semibold)).lineLimit(1)
        }
        .foregroundStyle(v.ink)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(v.tint, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

struct NewSessionView: View {
    @Bindable var model: Workbench
    var body: some View { SessionComposerView(model: model) }
}

struct ConversationView: View {
    @Bindable var model: Workbench
    let session: HostSession
    @State private var draft = ""
    @State private var attachmentError = ""
    @State private var stopping = false
    @State private var details = false
    @State private var usage = false
    @State private var workOpen = false
    @State private var goalDetailId: String? = nil
    @State private var importing = false
    @State private var attachments: [ManagedAttachment] = []
    @State private var uploading = false
    @State private var atBottom = true
    @State private var scrollToken = 0
    @State private var visibleBlock: String?
    @FocusState private var composerFocused: Bool

    private var live: HostSession { model.snapshot?.sessions.first { $0.id == session.id } ?? session }
    private var running: Bool { live.runState == "running" }
    private var transcriptData: Transcript { model.page?.session.id == session.id ? model.page?.transcript ?? .empty : .empty }
    private var harnessName: String { harnessVisual(session.harnessId).name }
    private var inbox: [InboxItem] { model.snapshot?.inbox.filter { !$0.resolved && $0.sessionId == session.id } ?? [] }

    var body: some View {
        let t = transcriptData
        let blocks = transcriptBlocks(t.rows)
        let cont = continuationFlags(blocks)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if model.page?.olderCursor != nil {
                        Button {
                            Task { await model.loadOlder() }
                        } label: {
                            HStack(spacing: 6) {
                                if model.loadingHistory { ProgressView().controlSize(.small) }
                                Text(model.loadingHistory ? "加载中…" : "更早记录").font(.system(size: 12.5)).foregroundStyle(KY.textSecondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.loadingHistory)
                    }

                    if blocks.isEmpty && !running && inbox.isEmpty {
                        ComposerWelcome(title: "今天想做些什么？").frame(minHeight: 300)
                    }

                    ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                        TranscriptBlockView(block: block, harnessId: session.harnessId,
                                            live: running && t.thinkingPending && index == blocks.count - 1, continuation: cont[index],
                                            onEdit: model.canWrite ? { row in Task { _ = await model.branch(row, edit: true) } } : nil,
                                            onBranch: model.canWrite ? { row in Task { _ = await model.branch(row, edit: false) } } : nil)
                    }

                    if running {
                        RunIndicatorView(label: (model.page?.events.isEmpty ?? true) ? "正在启动 \(harnessName)…" : "原生执行中")
                    }

                    ForEach(inbox) { item in InteractionView(item: item, model: model) }

                    Color.clear.frame(height: 1).id("bottom")
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .scrollTargetLayout()
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }
            .defaultScrollAnchor(.bottom)
            .scrollPosition(id: $visibleBlock)
            .onChange(of: visibleBlock) { _, id in if let id { model.readingAnchors[(model.connection?.hostId ?? "") + ":" + session.id] = id } }
            .scrollDismissesKeyboard(.interactively)
            .background(KY.paper)
            .onChange(of: "\(blocks.count):\(t.rows.last?.text.count ?? 0):\(inbox.count):\(running)") { _, _ in
                if atBottom { withAnimation(.snappy) { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .overlay(alignment: .bottom) {
                if !atBottom && !blocks.isEmpty {
                    Button { withAnimation(.snappy) { proxy.scrollTo("bottom", anchor: .bottom) } } label: {
                        Image(systemName: "chevron.down").font(.system(size: 13, weight: .semibold)).foregroundStyle(KY.text)
                            .frame(width: 36, height: 36)
                            .background(KY.raised, in: Circle())
                            .overlay(Circle().strokeBorder(KY.border))
                            .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 10)
                    .accessibilityLabel("回到底部")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .onChange(of: scrollToken) { _, _ in withAnimation(.snappy) { proxy.scrollTo("bottom", anchor: .bottom) } }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(session.title.isEmpty ? "对话" : session.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(KY.text).lineLimit(1)
                    HStack(spacing: 5) {
                        Circle().fill(stateColor).frame(width: 6, height: 6)
                        Text([harnessName, live.stateLabel, live.model].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 11)).foregroundStyle(KY.textSecondary).lineLimit(1)
                    }
                }
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { workOpen = true } label: { Image(systemName: "square.stack.3d.up") }.accessibilityLabel("项目工作与成果")
                if let goal = model.snapshot?.goals?.first(where: { $0.controllerSessionId == session.id || $0.sessionIds?.contains(session.id) == true }) {
                    Button { goalDetailId = goal.id } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "target")
                            Text(goal.title).lineLimit(1)
                        }
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(KY.sunken, in: Capsule())
                    }
                }
                Button { usage = true } label: { Image(systemName: "chart.bar") }.accessibilityLabel("当前会话用量")
                Button { details = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("会话配置与工具记录")
            }
        }
        .tint(KY.text)
        .refreshable { await model.refresh() }
        .task(id: session.id) {
            await model.select(session.id)
            visibleBlock = model.readingAnchors[(model.connection?.hostId ?? "") + ":" + session.id]
            draft = LocalDrafts.read(model.connection?.hostId ?? "", session.id)
            if !model.composerDraft.isEmpty { draft = model.composerDraft }
            if !model.composerAttachments.isEmpty { attachments = model.composerAttachments }
        }
        .onChange(of: model.composerDraft) { _, text in if !text.isEmpty { draft = text } }
        .onChange(of: draft) { _, text in do { try LocalDrafts.save(model.connection?.hostId ?? "", session.id, text) } catch { model.error = "无法保存此对话的本机草稿。" } }
        .onChange(of: model.composerAttachments.map(\.id)) { _, ids in if !ids.isEmpty { attachments = model.composerAttachments } }
        .sheet(isPresented: $details) { NativeSessionDetails(model: model, session: session) }
        .sheet(isPresented: $workOpen) { WorkHubView(model: model, initialProject: session.projectId ?? "", initialTab: "成果") }
        .sheet(item: Binding(get: { goalDetailId.map { GoalIdentifiable(id: $0) } }, set: { goalDetailId = $0?.id })) { item in
            GoalDetailView(model: model, goalId: item.id)
        }
        .sheet(isPresented: $usage) {
            NavigationStack {
                UsageView(model: model, sessionId: session.id)
                    .toolbar { Button("完成") { usage = false } }
            }
        }
        .confirmationDialog("停止当前运行并暂停自动续聊？", isPresented: $stopping, titleVisibility: .visible) {
            Button("停止并暂停", role: .destructive) { Task { await model.stop() } }
        }
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            Task { @MainActor in
                uploading = true
                defer { uploading = false }
                do {
                    guard let connection = model.connection, model.canWrite else { throw APIError(message: "请先连接设备。", status: 0) }
                    let owner = session.id
                    for url in try result.get() {
                        guard attachments.count < 10 else { throw APIError(message: "一次最多附加 10 个文件。", status: 0) }
                        let access = url.startAccessingSecurityScopedResource()
                        defer { if access { url.stopAccessingSecurityScopedResource() } }
                        let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
                        guard let size = values.fileSize, size <= 32 * 1024 * 1024 else { throw APIError(message: "单个附件最多 32 MiB。", status: 0) }
                        let data = try await Task.detached { try Data(contentsOf: url, options: .mappedIfSafe) }.value
                        let file = try await HostAPI(connection: connection).upload(name: url.lastPathComponent,
                            mediaType: values.contentType?.preferredMIMEType ?? "application/octet-stream", data: data, sessionId: owner)
                        guard model.selected == owner, model.connection?.token == connection.token else { return }
                        attachments.append(ManagedAttachment(id: file["id"].string, name: url.lastPathComponent))
                    }
                    attachmentError = ""
                } catch { attachmentError = error.localizedDescription }
            }
        }
    }

    private var stateColor: Color {
        switch live.runState { case "running": KY.success; case "waiting-input": KY.info; case "idle": KY.textTertiary; default: KY.destructive }
    }

    private var steerSupported: Bool { live.nativeCapabilities?["steer"] == "supported" }

    @ViewBuilder private var composer: some View {
        VStack(spacing: 0) {
            PendingComposerMessages(model: model, session: live)
            NativeComposerControls(model: model, session: live, text: $draft,
                attachments: attachments, uploading: uploading, error: attachmentError,
                attach: { importing = true },
                remove: { id in attachments.removeAll { $0.id == id }; attachmentError = "" },
                submit: {
                    let text = draft
                    let files = attachments
                    Task {
                        if await model.send(text, attachmentIds: files.map(\.id)), draft == text {
                            draft = ""; attachments = []; scrollToken += 1
                        }
                    }
                })

        }
        .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 8)
        .background(KY.paper)
    }

}

struct InteractionView: View {
    let item: InboxItem
    @Bindable var model: Workbench
    @State private var selectedAction: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "shield.lefthalf.filled")
                    .foregroundStyle(KY.info)
                    .font(.headline)
                Text(item.type == "interaction" ? "等待你确认审批" : "会话通知")
                    .font(.headline)
            }

            let params = item.payload["params"]
            let cmd = params["command"].string.isEmpty ? params["cmd"].string : params["command"].string
            let path = params["path"].string.isEmpty ? params["file"].string : params["path"].string

            if item.payload["protocol"].string == "kodo" && !params["schedule"].string.isEmpty {
                ScrollView { Text(params["text"].string).font(.subheadline).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 240)
            } else if !cmd.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("执行命令：").font(.caption).foregroundStyle(.secondary)
                    Text("$ \(cmd)")
                        .font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(.primary)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(KY.sunken)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            } else if !path.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text")
                    Text(path).font(.subheadline.bold())
                }
            } else {
                Text(params.formatted == "null" ? item.payload.formatted : params.formatted)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(KY.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            if let form = nativeQuestionForm(item.payload) {
                NativeQuestionFields(model: model, item: item, form: form)
            } else if item.actions?.isEmpty != false {
                StructuredInteractionReply(model: model, item: item)
            } else {
                VStack(spacing: 10) {
                    ForEach(Array((item.actions ?? []).enumerated()), id: \.offset) { index, action in
                        Button(action.label, role: action.destructive == true ? .destructive : nil) {
                            selectedAction = index
                        }
                        .buttonStyle(KooyuButtonStyle(prominent: action.destructive != true, destructive: action.destructive == true))
                        .disabled(!model.online || model.busy || model.connection?.pending != nil)
                    }
                }
            }
        }
        .padding(14)
        .background(KY.raised)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(KY.info.opacity(0.35), lineWidth: 1))
        .confirmationDialog("确认回应此请求？", isPresented: Binding(get: { selectedAction != nil }, set: { if !$0 { selectedAction = nil } }), titleVisibility: .visible) {
            if let index = selectedAction, let actions = item.actions, actions.indices.contains(index) {
                let action = actions[index]
                Button(action.label, role: action.destructive == true ? .destructive : nil) {
                    Task { await model.answer(item, action: action); selectedAction = nil }
                }
            }
        }
    }
}

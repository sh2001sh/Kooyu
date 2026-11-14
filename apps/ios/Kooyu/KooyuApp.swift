import SwiftUI
import UniformTypeIdentifiers

@main struct KooyuApp: App {
    @State private var model = Workbench()
    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .tint(Color("AccentColor"))
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
                TabView {
                    SessionListView(model: model)
                        .tabItem { Label("会话", systemImage: "bubble.left.and.bubble.right.fill") }

                    NavigationStack { ProjectsView(model: model) }
                        .tabItem { Label("项目", systemImage: "folder.fill") }

                    NavigationStack {
                        List {
                            if pending.isEmpty {
                                ContentUnavailableView(
                                    "暂无待处理事项",
                                    systemImage: "checkmark.circle.fill",
                                    description: Text("所有任务运行良好，无需人工审批或交互。")
                                )
                            }
                            ForEach(pending) { item in
                                Section(model.snapshot?.sessions.first { $0.id == item.sessionId }?.title ?? "会话") {
                                    InteractionView(item: item, model: model)
                                }
                            }
                        }
                        .listStyle(.insetGrouped)
                        .navigationTitle("待处理")
                        .refreshable { await model.refresh() }
                    }
                    .tabItem { Label("待处理", systemImage: "tray.fill") }
                    .badge(pending.count)

                    NavigationStack { UsageView(model: model) }
                        .tabItem { Label("用量", systemImage: "chart.bar.xaxis") }

                    NavigationStack { NativeSettingsView(model: model) }
                        .tabItem { Label("设置", systemImage: "gearshape.fill") }
                }
                .id(model.connection?.hostId)
                .safeAreaInset(edge: .top, spacing: 0) { StatusView(model: model) }
            }
        }
        .sheet(isPresented: $model.addingDevice) {
            PairView(model: model).interactiveDismissDisabled(model.busy)
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
                        Text("连接你的工作台")
                            .font(.title2.weight(.bold))
                        Text("在桌面 Kooyu「设置 → 手机连接」生成二维码，通过手机相机扫码即可快速配对。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                Section {
                    TextField("电脑名称（例如：MacBook Pro、工作站）", text: $name)

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
                            Text("配对码两分钟内有效，点击连接完成受信任配对。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button {
                                Task { await model.pair(url: invitation.address, code: invitation.code, name: name) }
                            } label: {
                                HStack {
                                    Spacer()
                                    Text("连接此电脑").fontWeight(.semibold)
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
            .navigationTitle("连接电脑")
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
                        Text("连接已断开，新的操作已暂停").font(.caption.weight(.medium))
                    }
                }
                if !model.error.isEmpty {
                    Text(model.error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                if model.connection?.pending != nil {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        Text("上次操作结果待核对，已暂停新写入").font(.caption)
                        Spacer()
                        Button("我已核对") { clearing = true }
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
            .background(.regularMaterial)
            .overlay(Divider(), alignment: .bottom)
            .confirmationDialog("仅清除本机待核对标记；不会撤销或重发原操作。", isPresented: $clearing, titleVisibility: .visible) {
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
    @State private var archived = false
    @State private var renaming: HostSession?
    @State private var deleting: HostSession?
    @State private var newTitle = ""

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selected) {
                Section {
                    Picker("项目范围", selection: $project) {
                        Text("全部项目").tag("")
                        Text("全局会话").tag("global")
                        ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                    }
                    Picker("会话状态", selection: $archived) {
                        Text("进行中").tag(false)
                        Text("已归档").tag(true)
                    }
                    .pickerStyle(.segmented)
                }

                if sessions.isEmpty {
                    ContentUnavailableView(
                        "暂无会话",
                        systemImage: "bubble.left.and.exclamationmark",
                        description: Text("创建新对话，或在桌面端发起任务。")
                    )
                }

                ForEach(sessions) { session in
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
            }
            .listStyle(.insetGrouped)
            .navigationTitle("会话")
            .searchable(text: $search, prompt: "搜索会话标题")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { DeviceMenu(model: model) }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        creating = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .disabled(!model.canWrite)
                }
            }
            .sheet(isPresented: $creating) { NewSessionView(model: model) }
        } detail: {
            if let session = model.snapshot?.sessions.first(where: { $0.id == model.selected }) {
                ConversationView(model: model, session: session)
            } else {
                ContentUnavailableView(
                    "选择会话",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("从侧边栏列表中选择一个会话，或新建对话。")
                )
            }
        }
        .navigationSplitViewStyle(.balanced)
        .alert("重命名对话", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("标题", text: $newTitle)
            Button("保存") {
                if let session = renaming {
                    Task { if await model.updateSession(session.id, values: ["title": .string(newTitle)]) { renaming = nil } }
                }
            }
            Button("取消", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("删除此电脑上的会话记录？此操作不能撤销。", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            if let session = deleting {
                Button("删除会话", role: .destructive) {
                    Task { await model.deleteSession(session.id); deleting = nil }
                }
            }
        }
    }

    private var sessions: [HostSession] {
        model.snapshot?.sessions.filter {
            $0.archived == archived &&
            (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search)) &&
            (project.isEmpty || (project == "global" ? $0.projectId == nil : $0.projectId == project))
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
    @State private var mode = "queue"
    @State private var attachmentError = ""
    @State private var stopping = false
    @State private var details = false
    @State private var usage = false
    @State private var importing = false
    @State private var attachments: [MobileTextAttachment] = []
    @State private var atBottom = true
    @State private var scrollToken = 0
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

                    if blocks.isEmpty && !running {
                        VStack(spacing: 10) {
                            EngineBadge(harnessId: session.harnessId, size: 44, circle: false)
                            Text(session.harnessId == "kodo" ? "让 Kooyu 接下来做什么？" : "交给 \(harnessName) 什么任务？")
                                .font(.system(size: 18, weight: .semibold)).foregroundStyle(KY.text)
                            Text("消息会发送到当前电脑执行，过程与结果实时同步。").font(.system(size: 13)).foregroundStyle(KY.textSecondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 64)
                    }

                    ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                        TranscriptBlockView(block: block, harnessId: session.harnessId,
                                            live: running && t.thinkingPending && index == blocks.count - 1, continuation: cont[index])
                    }

                    if running {
                        RunIndicatorView(label: (model.page?.events.isEmpty ?? true) ? "正在启动 \(harnessName)…" : "原生执行中")
                    }

                    ForEach(inbox) { item in InteractionView(item: item, model: model) }

                    Color.clear.frame(height: 1).id("bottom")
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }
            .defaultScrollAnchor(.bottom)
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
                Button { usage = true } label: { Image(systemName: "chart.bar") }.accessibilityLabel("当前会话用量")
                Button { details = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("会话配置与工具记录")
            }
        }
        .tint(KY.text)
        .refreshable { await model.refresh() }
        .task(id: session.id) { await model.select(session.id) }
        .onChange(of: model.composerDraft) { _, text in if !text.isEmpty { draft = text } }
        .sheet(isPresented: $details) { NativeSessionDetails(model: model, session: session) }
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
            allowedContentTypes: [.plainText, .json, .xml, .sourceCode, .commaSeparatedText],
            allowsMultipleSelection: true
        ) { result in
            do {
                let urls = try result.get()
                var next = attachments
                for url in urls {
                    guard next.count < 4 else { throw APIError(message: "一次最多附加 4 个文本文件。", status: 0) }
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url, options: .mappedIfSafe)
                    guard data.count <= 65536, next.reduce(0, { $0 + $1.bytes }) + data.count <= 163840 else {
                        throw APIError(message: "单个文件最多 64 KiB，附件合计最多 160 KiB。", status: 0)
                    }
                    guard let text = String(data: data, encoding: .utf8), !text.contains("\0") else {
                        throw APIError(message: "仅支持 UTF-8 文本附件。", status: 0)
                    }
                    next.append(MobileTextAttachment(id: UUID().uuidString, name: url.lastPathComponent, content: text, bytes: data.count))
                }
                attachments = next
                attachmentError = ""
            } catch {
                attachmentError = error.localizedDescription
            }
        }
    }

    private var stateColor: Color {
        switch live.runState { case "running": KY.success; case "waiting-input": KY.info; case "idle": KY.textTertiary; default: KY.destructive }
    }

    private var steerSupported: Bool { live.nativeCapabilities?["steer"] == "supported" }

    /// Desktop `.composer`: raised card with a hairline ring, input on top, controls beneath.
    @ViewBuilder private var composer: some View {
        let message = attachedMessage(draft, attachments)
        let canSend = !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && model.canWrite && message.count <= 200000
        VStack(alignment: .leading, spacing: 6) {
            if !attachmentError.isEmpty {
                Text(attachmentError).font(.system(size: 12)).foregroundStyle(KY.destructive).padding(.horizontal, 10)
            }
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(attachments) { file in
                            HStack(spacing: 4) {
                                Image(systemName: "doc.text").font(.system(size: 11)).foregroundStyle(KY.textSecondary)
                                Text(file.name).font(.system(size: 12)).foregroundStyle(KY.text).lineLimit(1)
                                Button { attachments.removeAll { $0.id == file.id } } label: {
                                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(KY.textTertiary).frame(width: 20, height: 20)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("移除 \(file.name)")
                            }
                            .padding(.leading, 8).padding(.vertical, 2)
                            .background(KY.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 8)
                }
            }
            TextField(running ? "补充说明或排队下一条…" : "输入消息…", text: $draft, axis: .vertical)
                .font(.system(size: 16))
                .lineLimit(1...6)
                .focused($composerFocused)
                .padding(.horizontal, 10).padding(.top, 6)
            HStack(spacing: 4) {
                Button { importing = true } label: {
                    Image(systemName: "paperclip").font(.system(size: 16)).foregroundStyle(KY.textSecondary).frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .disabled(attachments.count >= 4)
                .accessibilityLabel("添加文本附件")
                Menu {
                    Button("排队发送") { mode = "queue" }
                    Button("新回合") { mode = "new" }
                    if steerSupported { Button("引导当前任务") { mode = "steer" } }
                } label: {
                    HStack(spacing: 3) {
                        Text(mode == "new" ? "新回合" : mode == "steer" ? "引导" : "排队").font(.system(size: 12.5))
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9))
                    }
                    .foregroundStyle(KY.textSecondary)
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer()
                if running && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty {
                    Button { stopping = true } label: {
                        Image(systemName: "stop.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(KY.onAccent)
                            .frame(width: 34, height: 34).background(KY.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!model.canWrite)
                    .accessibilityLabel("停止并暂停")
                } else {
                    Button {
                        let text = draft
                        let files = attachments
                        Task {
                            if await model.send(attachedMessage(text, files), mode: mode), draft == text {
                                draft = ""
                                attachments = []
                                scrollToken += 1
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold)).foregroundStyle(canSend ? KY.onAccent : KY.textTertiary)
                            .frame(width: 34, height: 34).background(canSend ? KY.accent : KY.sunken, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                    .accessibilityLabel("发送")
                }
            }
        }
        .padding(6)
        .background(KY.raised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(KY.border))
        .shadow(color: .black.opacity(0.05), radius: 10, y: 4)
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

            if !cmd.isEmpty {
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

            if item.actions?.isEmpty != false {
                Text("此交互选项请在桌面端进行处理。").font(.footnote).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 10) {
                    Spacer()
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

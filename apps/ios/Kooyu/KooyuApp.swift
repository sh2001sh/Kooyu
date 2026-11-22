import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main struct KooyuApp: App {
    @UIApplicationDelegateAdaptor(KooyuAppDelegate.self) private var appDelegate
    @State private var model = Workbench()
    var body: some Scene {
        WindowGroup {
            let appearance = AppearanceStore.shared
            let _ = appearance.revision
            let _ = LanguageStore.shared.revision
            RootView(model: model)
                .onOpenURL { url in
                    guard url.scheme == "kooyu", url.host == "host",
                          let id = UUID(uuidString: String(url.path.dropFirst())),
                          url.query == nil, url.fragment == nil else { return }
                    if let device = model.book.devices.first(where: {
                        $0.cloud?.hostId.lowercased() == id.uuidString.lowercased()
                    }) {
                        model.switchDevice(device.hostId)
                    } else {
                        model.requestedCloudHost = id
                        model.addingDevice = model.connection != nil
                    }
                }
                .tint(KY.accent)
                .preferredColorScheme(appearance.preferredColorScheme)
                .onChange(of: model.appSettings?["language"].string) { _, next in
                    LanguageStore.shared.syncFromHost(next)
                }
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
                tabShell
                    .id(model.connection?.hostId)
                    .tint(.primary)
                    // On the conversation list the offline state lives in the top-bar connection pill.
                    .safeAreaInset(edge: .top, spacing: 0) { StatusView(model: model, showsOffline: model.selectedTab != "sessions") }
            }
        }
        .sheet(isPresented: $model.addingDevice, onDismiss: { model.requestedCloudHost = nil }) {
            PairView(model: model).interactiveDismissDisabled(model.busy)
        }
        .task(id: "\(model.push.pending?.hostId ?? "")/\(model.push.pending?.notificationId ?? "")/\(model.busy)") {
            guard !model.busy, let target = model.push.pending else { return }
            if await model.openNotification(target), model.push.pending == target { model.push.pending = nil }
        }
        .task(id: "\(phase == .active)-\(model.book.devices.map { $0.hostId + $0.deviceId }.joined())") {
            guard phase == .active else { return }
            model.push.isVisible = { [weak weakModel = model] target in await weakModel?.notificationIsVisible(target) ?? false }
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
    @State private var showingInbox = false
    @ViewBuilder private var tabShell: some View {
        let _ = LanguageStore.shared.revision
        let openInbox = { showingInbox = true }
        let tabs = TabView(selection: $model.selectedTab) {
            SessionListView(model: model, inboxCount: pending.count, onOpenInbox: openInbox)
                .tabItem { Label(kooyuT("dock.chats"), systemImage: "bubble.left.and.bubble.right.fill") }
                .tag("sessions")

            NavigationStack { ProjectsView(model: model, inboxCount: pending.count, onOpenInbox: openInbox) }
                .tabItem { Label(kooyuT("dock.projects"), systemImage: "folder.fill") }
                .tag("projects")

            NavigationStack { UsageView(model: model, inboxCount: pending.count, onOpenInbox: openInbox) }
                .tabItem { Label(kooyuT("dock.usage"), systemImage: "chart.bar.fill") }
                .tag("usage")

            NavigationStack { NativeSettingsView(model: model, inboxCount: pending.count, onOpenInbox: openInbox) }
                .tabItem { Label(kooyuT("dock.settings"), systemImage: "gearshape.fill") }
                .tag("settings")
        }
        .sheet(isPresented: $showingInbox) {
            InboxView(model: model, embedded: false)
        }
        if #available(iOS 18.0, *) {
            tabs.tabViewStyle(.sidebarAdaptable)
        } else {
            tabs
        }
    }
    private var pending: [InboxItem] { model.snapshot?.inbox.filter { !$0.resolved && $0.read != true } ?? [] }
}

struct PairView: View {
    @Bindable var model: Workbench
    @State private var address = ""
    @State private var name = ""
    @State private var code = ""
    @State private var showingScanner = false
    @State private var manual = false
    @State private var invitation: PairingInvitation?

    @State private var loginTask: Task<Void, Never>?
    @State private var discovery: CloudDevice?
    @State private var loginCode = ""
    @State private var loginURL: URL?
    @State private var hosts: [JSONValue] = []
    @State private var directoryReady = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(KY.raised)
                                .frame(width: 68, height: 68)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .strokeBorder(KY.border, lineWidth: 0.75)
                                )
                            Image("KooyuMark")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 42, height: 36)
                        }
                        .padding(.top, 8)
                        Text("连接工作电脑")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(KY.text)
                        Text("登录 Kooyu 账号或扫描桌面二维码")
                            .font(.footnote)
                            .foregroundStyle(KY.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                Section {
                    TextField("设备名称（可选）", text: $name)
                }

                Section("Kooyu 账号") {
                    if model.requestedCloudHost != nil {
                        Text("登录后将自动匹配官网选中的工作电脑。")
                            .font(.footnote)
                            .foregroundStyle(KY.textSecondary)
                    }
                    Button {
                        model.error = ""
                        loginTask = Task {
                            defer { loginTask = nil }
                            do {
                                let client = try CloudDevice.discovery()
                                discovery = client
                                directoryReady = false
                                hosts = []
                                let (device, value, url) = try await client.beginLogin()
                                loginCode = value
                                loginURL = url
                                let available = try await client.hosts(deviceCode: device)
                                hosts = available.filter { model.requestedCloudHost == nil || model.requestedCloudHost == UUID(uuidString: $0["id"].string) }
                                directoryReady = true
                            } catch {
                                if !Task.isCancelled { model.error = error.localizedDescription }
                            }
                            loginURL = nil
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if loginTask != nil && loginURL != nil {
                                ProgressView().tint(KY.onAccent)
                                Text("等待网页确认授权…").font(.subheadline.weight(.semibold))
                            } else {
                                Label("登录 Kooyu 账号", systemImage: "person.crop.circle")
                                    .font(.subheadline.weight(.semibold))
                            }
                            Spacer()
                        }
                        .frame(minHeight: 42)
                    }
                    .buttonStyle(.kooyuPrimary)
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .disabled(loginTask != nil || model.busy)

                    if let loginURL {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("授权码（打开授权页将自动预填）")
                                .font(.caption)
                                .foregroundStyle(KY.textSecondary)
                            HStack {
                                Text(loginCode)
                                    .font(.title3.monospaced().bold())
                                    .foregroundStyle(KY.text)
                                    .textSelection(.enabled)
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = loginCode
                                } label: {
                                    Label("复制", systemImage: "doc.on.doc")
                                        .font(.caption.weight(.medium))
                                }
                                .buttonStyle(.bordered)
                            }
                            Link(destination: loginURL) {
                                Label("前往官网确认授权", systemImage: "arrow.up.right.square")
                                    .font(.subheadline.weight(.medium))
                            }
                        }
                        .padding(.vertical, 4)
                    }

                    if directoryReady && hosts.isEmpty {
                        Text("此账号尚未绑定可连接的工作电脑。")
                            .font(.footnote)
                            .foregroundStyle(KY.textSecondary)
                    }

                    ForEach(hosts.indices, id: \.self) { index in
                        let host = hosts[index]
                        Button {
                            guard let discovery else { return }
                            loginTask = Task {
                                defer { loginTask = nil }
                                do {
                                    let request = try await discovery.requestHost(host)
                                    await model.pair(url: request.address, code: request.code, name: name)
                                } catch { model.error = error.localizedDescription }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "desktopcomputer")
                                    .foregroundStyle(KY.textSecondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(host["name"].string)
                                        .fontWeight(.medium)
                                        .foregroundStyle(KY.text)
                                    Text("点击发起连接并在电脑端批准")
                                        .font(.caption)
                                        .foregroundStyle(KY.textTertiary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(KY.textTertiary)
                            }
                        }
                        .disabled(model.busy || loginTask != nil)
                    }
                }

                Section {
                    Button {
                        invitation = nil
                        model.error = ""
                        showingScanner = true
                    } label: {
                        HStack {
                            Spacer()
                            Label("扫描桌面二维码", systemImage: "qrcode.viewfinder")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                        }
                        .frame(minHeight: 40)
                    }
                    .disabled(model.busy)
                } header: {
                    Text("扫码配对")
                } footer: {
                    Text("在桌面端「设置 → 手机连接」生成二维码后直接扫码。")
                }

                if let invitation {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("已识别桌面二维码", systemImage: "checkmark.circle.fill")
                                .font(.headline)
                                .foregroundStyle(KY.success)
                            Button {
                                Task { await model.pair(url: invitation.address, code: invitation.code, name: name) }
                            } label: {
                                HStack {
                                    Spacer()
                                    Text("连接此设备").fontWeight(.semibold)
                                    if model.busy { Spacer(); ProgressView().tint(KY.onAccent) }
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
                        TextField("配对码", text: $code)
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
                            .foregroundStyle(KY.destructive)
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
        .onDisappear { loginTask?.cancel() }
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
    var showsOffline = true
    @State private var clearing = false
    var body: some View {
        let offline = !model.online && showsOffline
        let hasIssue = offline || !model.error.isEmpty || model.connection?.pending != nil || !model.notice.isEmpty
        if hasIssue {
            VStack(alignment: .leading, spacing: 6) {
                if offline {
                    HStack(spacing: 6) {
                        Image(systemName: "wifi.slash").foregroundStyle(KY.destructive)
                        Text("设备已离线，正在重新连接").font(.footnote)
                    }
                }
                if !model.error.isEmpty {
                    Text(model.error).font(.footnote).foregroundStyle(KY.destructive).textSelection(.enabled)
                }
                if model.connection?.pending != nil {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(KY.info)
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

private struct SessionGroup: Identifiable {
    let id: String
    let title: String
    let harnessId: String?
    let projectId: String?
    let sessions: [HostSession]
}

struct SessionListView: View {
    @Bindable var model: Workbench
    var inboxCount: Int = 0
    var onOpenInbox: (() -> Void)? = nil
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var creating = false
    @State private var creatingHarness = ""
    @State private var search = ""
    @State private var project = ""
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    @State private var projectsOpen = false
    @State private var historyOpen = false
    @State private var archived = false
    @State private var activeOnly = false
    @AppStorage("kooyu.sessionGrouping") private var grouping = "recent"
    @State private var collapsed: Set<String> = []
    @State private var lastOpened: String?
    @State private var refreshTick = 0
    @State private var renaming: HostSession?
    @State private var deleting: HostSession?
    @State private var newTitle = ""
    @State private var workOpen = false
    @State private var workProject = ""
    @State private var workTab = "进行中与目标"

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            sidebar
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
        .onChange(of: model.selected) { _, selected in
            if let selected { lastOpened = selected; compactColumn = .detail }
        }
        .onChange(of: compactColumn) { _, column in
            // Returning to the list on a phone ends the open conversation, as the old List selection did.
            if column == .sidebar && sizeClass == .compact { model.selected = nil }
        }
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

    private var sidebar: some View {
        List {
            Section {
                HStack(spacing: 8) {
                    SessionSearchBar(text: $search)
                    Button { historyOpen = true } label: {
                        Image(systemName: "text.magnifyingglass")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(KY.textSecondary)
                            .frame(width: 38, height: 38)
                            .background(KY.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                    }
                    .buttonStyle(.kooyuPress)
                    .accessibilityLabel("搜索完整历史")
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

                filterPillsRow
                    .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                if !archived && search.isEmpty && !activeOnly {
                    Button { openSession(supervisor) } label: {
                        SupervisorCard(session: supervisor, selected: supervisor != nil && supervisor?.id == highlighted)
                    }
                    .buttonStyle(KooyuPressStyle(scale: 0.98))
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 6, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }

            if visibleSessions.isEmpty {
                ContentUnavailableView(
                    activeOnly ? "暂无活跃会话" : archived ? "暂无已归档会话" : search.isEmpty ? "暂无会话" : "没有匹配的会话",
                    systemImage: archived ? "archivebox" : "bubble.left.and.exclamationmark"
                )
                .listRowBackground(Color.clear)
            }

            if grouping == "recent" {
                if !visibleSessions.isEmpty {
                    Section {
                        ForEach(visibleSessions) { session in row(session) }
                    }
                }
            } else {
                ForEach(sessionGroups) { group in
                    Section {
                        if !collapsed.contains(group.id) {
                            ForEach(group.sessions) { session in row(session) }
                        }
                    } header: {
                        header(group)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(KY.navigator)
        .navigationTitle("对话")
        .navigationBarTitleDisplayMode(.inline)
        .tint(KY.text)
        .refreshable { refreshTick += 1; await model.refresh() }
        .sensoryFeedback(.impact(weight: .light), trigger: refreshTick)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { brand }
            ToolbarItem(placement: .principal) { ConnectionPill(model: model) }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let onOpenInbox {
                    InboxToolbarButton(count: inboxCount, action: onOpenInbox)
                }
                newButton
            }
        }
        .sheet(isPresented: $creating) {
            SessionComposerView(model: model, initialProject: project, initialHarness: creatingHarness)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $projectsOpen) { NavigationStack { ProjectsView(model: model).toolbar { Button("完成") { projectsOpen = false } } } }
        .sheet(isPresented: $historyOpen) { HistorySearchView(model: model) }
        .sheet(isPresented: $workOpen) { WorkHubView(model: model, initialProject: workProject, initialTab: workTab) }
    }

    private var brand: some View {
        Text("对话")
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(KY.text)
            .fixedSize()
    }

    private var filterPillsRow: some View {
        let runningCount = (model.snapshot?.sessions ?? []).filter { !$0.archived && ["running", "waiting-input"].contains($0.runState) }.count
        let archivedCount = (model.snapshot?.sessions ?? []).filter { $0.archived }.count
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach([("recent", "全部对话"), ("project", "按项目"), ("harness", "按引擎")], id: \.0) { mode, label in
                    let isSelected = !archived && !activeOnly && grouping == mode
                    Button {
                        withAnimation(KYMotion.snap) {
                            archived = false
                            activeOnly = false
                            grouping = mode
                        }
                    } label: {
                        Text(label)
                            .font(.system(size: 12.5, weight: isSelected ? .semibold : .medium))
                            .foregroundStyle(isSelected ? KY.onAccent : KY.textSecondary)
                            .padding(.horizontal, 12)
                            .frame(height: 30)
                            .background(isSelected ? KY.accent : KY.raised, in: Capsule())
                            .overlay(Capsule().strokeBorder(isSelected ? .clear : KY.borderSubtle, lineWidth: 0.5))
                    }
                    .buttonStyle(.kooyuPress)
                }

                Button {
                    withAnimation(KYMotion.snap) {
                        activeOnly = false
                        archived.toggle()
                    }
                } label: {
                    Text(archivedCount > 0 ? "已归档 \(archivedCount)" : "已归档")
                        .font(.system(size: 12.5, weight: archived ? .semibold : .medium))
                        .foregroundStyle(archived ? KY.onAccent : KY.textSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 30)
                        .background(archived ? KY.accent : KY.raised, in: Capsule())
                        .overlay(Capsule().strokeBorder(archived ? .clear : KY.borderSubtle, lineWidth: 0.5))
                }
                .buttonStyle(.kooyuPress)

                if runningCount > 0 || activeOnly {
                    Button {
                        withAnimation(KYMotion.snap) {
                            archived = false
                            activeOnly.toggle()
                        }
                    } label: {
                        HStack(spacing: 5) {
                            StatusDot(color: activeOnly ? .white : KY.info, pulse: runningCount > 0, size: 6)
                            Text("\(runningCount) 活跃")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(activeOnly ? .white : KY.infoText)
                        }
                        .padding(.horizontal, 11)
                        .frame(height: 30)
                        .background(activeOnly ? KY.info : KY.infoTint, in: Capsule())
                        .overlay(Capsule().strokeBorder(activeOnly ? .clear : KY.info.opacity(0.28), lineWidth: 0.5))
                    }
                    .buttonStyle(.kooyuPress)
                }
            }
        }
    }

    private var newButton: some View {
        Button { project = ""; creatingHarness = ""; creating = true } label: {
            HStack(spacing: 4) {
                Image(systemName: "square.and.pencil").font(.system(size: 13, weight: .semibold))
                Text("新建").font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(model.canWrite ? KY.onAccent : KY.textTertiary)
            .padding(.horizontal, 11)
            .frame(height: 32)
            .background(model.canWrite ? KY.accent : KY.sunken, in: Capsule())
        }
        .buttonStyle(.kooyuPress)
        .disabled(!model.canWrite)
        .accessibilityLabel("新建对话")
    }

    /// Selected session on iPad; on a phone, the most recently opened one keeps the coral bar.
    private var highlighted: String? { model.selected ?? lastOpened }

    private var supervisor: HostSession? {
        model.snapshot?.sessions.first { $0.kind == "supervisor" && $0.projectId == nil && !$0.archived }
    }

    private func openSession(_ session: HostSession?) {
        guard let session else {
            project = ""; creatingHarness = "kodo"; creating = true
            return
        }
        lastOpened = session.id
        model.selected = session.id
        compactColumn = .detail
    }

    private func toggle(_ id: String) {
        var next = collapsed
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        withAnimation(KYMotion.base) { collapsed = next }
    }

    @ViewBuilder private func row(_ session: HostSession) -> some View {
        Button { openSession(session) } label: {
            SessionRowView(session: session, detail: rowDetail(session))
        }
        .buttonStyle(KooyuPressStyle(scale: 0.98, haptic: false))
        .listRowBackground(SessionRowBackground(selected: session.id == highlighted))
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                Task { _ = await model.updateSession(session.id, values: ["pinned": .bool(session.pinned != true)]) }
            } label: {
                Label(session.pinned == true ? "取消置顶" : "置顶", systemImage: session.pinned == true ? "pin.slash" : "pin")
            }
            .tint(KY.textSecondary)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                deleting = session
            } label: {
                Label("删除", systemImage: "trash")
            }
            .tint(KY.destructive)

            Button {
                Task { _ = await model.updateSession(session.id, values: ["archived": .bool(!session.archived)]) }
            } label: {
                Label(session.archived ? "恢复" : "归档", systemImage: session.archived ? "tray.and.arrow.up" : "archivebox")
            }
            .tint(KY.info)
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
    }

    private func header(_ group: SessionGroup) -> some View {
        let active = group.sessions.filter { $0.runState == "running" || $0.runState == "waiting-input" }.count
        return SessionGroupHeader(title: group.title, harnessId: group.harnessId, count: group.sessions.count, active: active,
                                  collapsed: collapsed.contains(group.id), toggle: { self.toggle(group.id) }) {
            if let projectId = group.projectId {
                Button { workProject = projectId; workTab = "项目概览"; workOpen = true } label: {
                    Image(systemName: "list.bullet.rectangle").frame(minWidth: 36, minHeight: 44)
                }
                .accessibilityLabel("\(group.title)项目概览")
                Button { project = projectId; creatingHarness = ""; creating = true } label: {
                    Image(systemName: "plus").frame(minWidth: 36, minHeight: 44)
                }
                .accessibilityLabel("在\(group.title)中新建对话")
                .disabled(!model.canWrite)
            }
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(KY.textSecondary)
    }

    private func rowDetail(_ s: HostSession) -> String {
        var parts: [String] = []
        if grouping == "recent", let name = model.snapshot?.projects.first(where: { $0.id == s.projectId })?.name {
            parts.append(name)
        }
        if let name = s.model, !name.isEmpty {
            parts.append(String(name.split(separator: "/").last ?? Substring(name)))
        } else if grouping != "harness" {
            parts.append(harnessVisual(s.harnessId).name)
        }
        if grouping == "harness", let name = model.snapshot?.projects.first(where: { $0.id == s.projectId })?.name {
            parts.append(name)
        }
        return parts.joined(separator: " · ")
    }

    /// Sessions for the current archive/active scope and search, minus the pinned L0 supervisor (shown in its own card).
    private var visibleSessions: [HostSession] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let pinnedId = (archived || activeOnly) ? nil : supervisor?.id
        let projects = model.snapshot?.projects ?? []
        let filtered = (model.snapshot?.sessions ?? []).filter { (s: HostSession) -> Bool in
            guard s.archived == archived, s.id != pinnedId else { return false }
            if activeOnly && !["running", "waiting-input"].contains(s.runState) { return false }
            if query.isEmpty { return true }
            let projectName = projects.first { $0.id == s.projectId }?.name ?? ""
            return s.title.localizedCaseInsensitiveContains(query)
                || projectName.localizedCaseInsensitiveContains(query)
                || harnessVisual(s.harnessId).name.localizedCaseInsensitiveContains(query)
        }
        return filtered.sorted { $0.pinned == true && $1.pinned != true }
    }

    private var sessionGroups: [SessionGroup] {
        let list = visibleSessions
        if grouping == "harness" {
            var order: [String] = (model.snapshot?.harnesses ?? []).map(\.id)
            for s in list where !order.contains(s.harnessId) { order.append(s.harnessId) }
            return order.compactMap { (id: String) -> SessionGroup? in
                let items = list.filter { $0.harnessId == id }
                if items.isEmpty { return nil }
                let name = id == "kodo" ? "Kooyu" : (model.snapshot?.harnesses?.first { $0.id == id }?.name ?? harnessVisual(id).name)
                return SessionGroup(id: "h:" + id, title: name, harnessId: id, projectId: nil, sessions: items)
            }
        }
        let showEmpty = search.isEmpty && !archived
        let projects = [HostProject(id: "", name: "全局对话")] + (model.snapshot?.projects ?? [])
        return projects.compactMap { (project: HostProject) -> SessionGroup? in
            let items = list.filter { ($0.projectId ?? "") == project.id }
            if !showEmpty && items.isEmpty { return nil }
            return SessionGroup(id: "p:" + project.id, title: project.name, harnessId: nil, projectId: project.id, sessions: items)
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
    @State private var activeAgentId: String? = nil
    @State private var subagentSheetOpen = false
    @State private var todoExpanded = false
    @State private var pendingAfterDetails: String? = nil
    @FocusState private var composerFocused: Bool

    private var live: HostSession { model.snapshot?.sessions.first { $0.id == session.id } ?? session }
    private var running: Bool { live.runState == "running" }
    private var transcriptData: Transcript { model.page?.session.id == session.id ? model.page?.transcript ?? .empty : .empty }
    private var harnessName: String { harnessVisual(session.harnessId).name }
    private var inbox: [InboxItem] { model.snapshot?.inbox.filter { !$0.resolved && $0.sessionId == session.id } ?? [] }
    private var childAgents: [ChildTranscript] { transcriptData.rows.compactMap(\.child) }
    private var activeSubagent: ChildTranscript? { activeAgentId.flatMap { id in childAgents.first { $0.agentId == id } } }
    private var latestTodos: [TranscriptTodoItem] { extractLatestTodos(transcriptData.rows) }

    var body: some View {
        let t = transcriptData
        let blocks = transcriptBlocks(t.rows)
        let cont = continuationFlags(blocks)
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                if let sub = activeSubagent {
                    HStack(spacing: 8) {
                        Button {
                            withAnimation(KYMotion.base) { activeAgentId = nil }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left").font(.system(size: 11, weight: .bold))
                                Text("返回主对话").font(.system(size: 12, weight: .semibold))
                            }
                            .foregroundStyle(KY.text)
                            .padding(.horizontal, 10)
                            .frame(height: 30)
                            .background(KY.raised, in: Capsule())
                            .overlay(Capsule().strokeBorder(KY.border))
                        }
                        .buttonStyle(.kooyuPress)
                        Text("子代理：\(sub.name ?? sub.agentId)")
                            .font(KYFont.caption)
                            .foregroundStyle(KY.textSecondary)
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(KY.sunken)
                    .overlay(Divider(), alignment: .bottom)
                }

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let sub = activeSubagent {
                            let subTranscript = buildTranscript(sub.events)
                            let subStatus = subagentStatusLabels[sub.status ?? ""] ?? sub.status ?? ""
                            let subRunning = ["进行中", "启动中"].contains(subStatus)
                            if subTranscript.rows.isEmpty {
                                Text("等待子代理输出…").font(KYFont.caption).foregroundStyle(KY.textTertiary).padding(.top, 20)
                            } else {
                                TranscriptStack(transcript: subTranscript, harnessId: session.harnessId, running: subRunning, subagent: true)
                            }
                        } else {
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
                                                    onBranch: model.canWrite ? { row in Task { _ = await model.branch(row, edit: false) } } : nil,
                                                    modelName: live.model)
                                    .transition(.kooyuEntry)
                            }

                            if running {
                                RunIndicatorView(label: (model.page?.events.isEmpty ?? true) ? "正在启动 \(harnessName)…" : "原生执行中")
                            }

                            ForEach(inbox) { item in InteractionView(item: item, model: model) }
                        }

                        Color.clear.frame(height: 1).id("bottom")
                            .onAppear { atBottom = true }
                            .onDisappear { atBottom = false }
                    }
                    .scrollTargetLayout()
                    // Only a newly appended block animates in; streaming text and older-history pages keep the last id.
                    .animation(KYMotion.base, value: blocks.last?.id)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
                }
            }
            .defaultScrollAnchor(.bottom)
            .scrollPosition(id: $visibleBlock)
            .onChange(of: visibleBlock) { _, id in if let id { model.readingAnchors[(model.connection?.hostId ?? "") + ":" + session.id] = id } }
            .scrollDismissesKeyboard(.interactively)
            .background(KY.paper)
            .onChange(of: "\(blocks.count):\(t.rows.last?.text.count ?? 0):\(inbox.count):\(running)") { _, _ in
                if atBottom { withAnimation(KYMotion.snap) { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .overlay(alignment: .bottomTrailing) {
                ZStack(alignment: .bottomTrailing) {
                if !atBottom && !blocks.isEmpty {
                    Button { withAnimation(KYMotion.panel) { proxy.scrollTo("bottom", anchor: .bottom) } } label: {
                        HStack(spacing: 6) {
                            if running { StatusDot(color: KY.info, pulse: true) }
                            Text(running ? "正在输出" : "回到底部").font(KYFont.label)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(KY.text)
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .background(KY.glass, in: Capsule())
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay(Capsule().strokeBorder(KY.border))
                        .shadow(color: Color.black.opacity(0.1), radius: 8, x: 0, y: 2)
                    }
                    .buttonStyle(.kooyuPress)
                    .padding(.trailing, 16)
                    .padding(.bottom, 10)
                    .accessibilityLabel(running ? "回到底部，正在输出" : "回到底部")
                    .transition(.scale(scale: 0.6, anchor: .bottomTrailing).combined(with: .opacity))
                }
                }
                // Scoped to the button so the transcript itself is not animated when the sentinel toggles.
                .animation(KYMotion.snap, value: atBottom)
            }
            .onChange(of: scrollToken) { _, _ in withAnimation(KYMotion.panel) { proxy.scrollTo("bottom", anchor: .bottom) } }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(live.title.isEmpty ? "对话" : live.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(KY.text).lineLimit(1)
                    HStack(spacing: 5) {
                        EngineBadge(harnessId: session.harnessId, size: 14, circle: false)
                        if model.online {
                            StatusBadge(status: sessionStatus(live))
                        } else {
                            StatusBadge(status: SessionStatus(label: "设备离线", tone: .running))
                        }
                        if let place = placeLabel {
                            Text("·").foregroundStyle(KY.textTertiary)
                            Text(place).lineLimit(1).truncationMode(.head)
                        }
                    }
                    .font(KYFont.caption)
                    .foregroundStyle(KY.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if !childAgents.isEmpty {
                    Button { subagentSheetOpen = true } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 11, weight: .semibold))
                            Text("\(childAgents.count) 子代理").font(.system(size: 11.5, weight: .semibold))
                        }
                        .foregroundStyle(activeSubagent != nil ? Color.white : KY.text)
                        .padding(.horizontal, 8)
                        .frame(height: 28)
                        .background(activeSubagent != nil ? KY.brandCoral : KY.sunken, in: Capsule())
                    }
                    .accessibilityLabel("切换子代理视图，共 \(childAgents.count) 个子代理")
                }
                Button { details = true } label: { Image(systemName: "info.circle") }.accessibilityLabel("会话检查器")
            }
        }
        .tint(KY.text)
        .refreshable { await model.refresh() }
        .task(id: session.id) {
            activeAgentId = nil
            todoExpanded = false
            await model.select(session.id)
            visibleBlock = model.readingAnchors[(model.connection?.hostId ?? "") + ":" + session.id]
            draft = LocalDrafts.read(model.connection?.hostId ?? "", session.id)
            if !model.composerDraft.isEmpty { draft = model.composerDraft }
            if !model.composerAttachments.isEmpty { attachments = model.composerAttachments }
        }
        .onChange(of: model.composerDraft) { _, text in if !text.isEmpty { draft = text } }
        .onChange(of: draft) { _, text in do { try LocalDrafts.save(model.connection?.hostId ?? "", session.id, text) } catch { model.error = "无法保存此对话的本机草稿。" } }
        .onChange(of: model.composerAttachments.map(\.id)) { _, ids in if !ids.isEmpty { attachments = model.composerAttachments } }
        .sheet(isPresented: $subagentSheetOpen) {
            NavigationStack {
                List {
                    Button {
                        withAnimation(KYMotion.base) { activeAgentId = nil }
                        subagentSheetOpen = false
                    } label: {
                        HStack {
                            Text("主对话").font(KYFont.rowTitle)
                            Spacer()
                            if activeAgentId == nil { Image(systemName: "checkmark").foregroundStyle(KY.brandCoral) }
                        }
                    }
                    Section("子代理 (\(childAgents.count))") {
                        ForEach(childAgents, id: \.agentId) { child in
                            let st = subagentStatusLabels[child.status ?? ""] ?? child.status ?? "状态未知"
                            let tone: ToolStatus? = ["进行中", "启动中"].contains(st) ? .running : st == "失败" ? .failed : st == "完成" ? .done : nil
                            Button {
                                withAnimation(KYMotion.base) { activeAgentId = child.agentId }
                                subagentSheetOpen = false
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(child.name ?? child.agentId).font(KYFont.rowTitle).foregroundStyle(KY.text)
                                        Text(child.agentId).font(KYFont.caption).foregroundStyle(KY.textTertiary).lineLimit(1)
                                    }
                                    Spacer()
                                    StatusChip(text: st, tone: tone)
                                    if activeAgentId == child.agentId { Image(systemName: "checkmark").foregroundStyle(KY.brandCoral) }
                                }
                            }
                        }
                    }
                }
                .navigationTitle("子代理切换").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("完成") { subagentSheetOpen = false } }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $details, onDismiss: {
            guard let target = pendingAfterDetails else { return }
            pendingAfterDetails = nil
            if target == "work" { workOpen = true }
            else if target == "usage" { usage = true }
            else if target.hasPrefix("goal:") { goalDetailId = String(target.dropFirst(5)) }
        }) {
            NativeSessionDetails(
                model: model,
                session: live,
                onOpenWork: { pendingAfterDetails = "work" },
                onOpenUsage: { pendingAfterDetails = "usage" },
                onOpenGoal: { goalId in pendingAfterDetails = "goal:\(goalId)" }
            )
            .presentationDetents([.fraction(0.88), .large])
            .presentationDragIndicator(.visible)
        }
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

    /// Short project location for the top-bar subtitle: sanitized workspace path, else the project name.
    private var placeLabel: String? {
        if let root = model.snapshot?.workspaces?.first(where: { $0.id == live.workspaceId })?.rootPath, !root.isEmpty {
            let formatted = formatWorkspaceLabel(root)
            if !formatted.isEmpty { return formatted }
        }
        return model.snapshot?.projects.first(where: { $0.id == live.projectId })?.name
    }

    private var steerSupported: Bool { live.nativeCapabilities?["steer"] == "supported" }

    @ViewBuilder private var composer: some View {
        VStack(spacing: 6) {
            if activeSubagent == nil && !latestTodos.isEmpty {
                let done = latestTodos.filter { $0.status == "completed" }.count
                VStack(alignment: .leading, spacing: 6) {
                    Button {
                        withAnimation(KYMotion.base) { todoExpanded.toggle() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "checklist").font(.system(size: 11, weight: .semibold)).foregroundStyle(done == latestTodos.count ? KY.success : KY.infoText)
                            Text("待办进度 · \(done)/\(latestTodos.count)")
                                .font(KYFont.caption).foregroundStyle(KY.text)
                            Spacer()
                            Image(systemName: todoExpanded ? "chevron.down" : "chevron.up")
                                .font(.system(size: 10, weight: .bold)).foregroundStyle(KY.textTertiary)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 34)
                        .background(KY.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.borderSubtle))
                    }
                    .buttonStyle(.plain)
                    if todoExpanded {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(latestTodos) { todo in
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: todo.status == "completed" ? "checkmark.circle.fill" : todo.status == "in_progress" ? "clock.fill" : "circle")
                                        .font(.system(size: 12))
                                        .foregroundStyle(todo.status == "completed" ? KY.success : todo.status == "in_progress" ? KY.info : KY.textTertiary)
                                        .padding(.top, 2)
                                    Text(todo.content)
                                        .font(.system(size: 12.5))
                                        .foregroundStyle(todo.status == "completed" ? KY.textTertiary : KY.text)
                                        .strikethrough(todo.status == "completed")
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                        .padding(10)
                        .background(KY.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.borderSubtle))
                    }
                }
            }
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
    @State private var approved = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: approved ? "checkmark.shield.fill" : "shield.lefthalf.filled")
                    .foregroundStyle(approved ? KY.success : KY.info)
                    .font(.headline)
                Text(approved ? "已确认执行" : item.type == "interaction" ? "等待你确认审批" : "会话通知")
                    .font(.headline)
            }

            let params = item.payload["params"]
            let cmd = params["command"].string.isEmpty ? params["cmd"].string : params["command"].string
            let path = params["path"].string.isEmpty ? params["file"].string : params["path"].string

            if item.payload["protocol"].string == "kodo" && item.payload["method"].string == "question/request" {
                VStack(alignment: .leading, spacing: 4) {
                    if !params["title"].string.isEmpty {
                        Text(params["title"].string).font(.subheadline.bold())
                    }
                    if !params["detail"].string.isEmpty {
                        Text(params["detail"].string).font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else if item.payload["protocol"].string == "kodo" && !params["schedule"].string.isEmpty {
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

            if item.type != "interaction" {
                HStack(spacing: 10) {
                    Button {
                        Task { await model.markInboxRead(item.id) }
                    } label: {
                        Label("标为已读", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        Task { await model.deleteInboxItem(item.id) }
                    } label: {
                        Label("删除", systemImage: "trash")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            } else if let form = nativeQuestionForm(item.payload) {
                NativeQuestionFields(model: model, item: item, form: form)
            } else if item.actions?.isEmpty != false {
                StructuredInteractionReply(model: model, item: item)
                HStack(spacing: 10) {
                    Button("标为已读") { Task { await model.markInboxRead(item.id) } }
                        .font(.caption)
                    Button("删除", role: .destructive) { Task { await model.deleteInboxItem(item.id) } }
                        .font(.caption)
                }
            } else {
                VStack(spacing: 10) {
                    ForEach(Array((item.actions ?? []).enumerated()), id: \.offset) { index, action in
                        let isFirstPrimary = index == 0 && action.destructive != true
                        Button {
                            if action.destructive != true {
                                withAnimation(KYMotion.snap) { approved = true }
                                Task {
                                    await model.answer(item, action: action)
                                }
                            } else {
                                selectedAction = index
                            }
                        } label: {
                            HStack(spacing: 6) {
                                if isFirstPrimary && approved {
                                    Image(systemName: "checkmark.circle.fill")
                                }
                                Text(isFirstPrimary && approved ? "已批准" : action.label)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(KooyuButtonStyle(prominent: action.destructive != true, destructive: action.destructive == true))
                        .disabled(!model.online || model.busy || model.connection?.pending != nil || approved)
                    }
                }
            }
        }
        .padding(14)
        .background(KY.raised)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder((approved ? KY.success : KY.info).opacity(0.35), lineWidth: 1))
        .sensoryFeedback(.success, trigger: approved)
        .confirmationDialog("确认执行此拒绝或破坏性操作？", isPresented: Binding(get: { selectedAction != nil }, set: { if !$0 { selectedAction = nil } }), titleVisibility: .visible) {
            if let index = selectedAction, let actions = item.actions, actions.indices.contains(index) {
                let action = actions[index]
                Button(action.label, role: action.destructive == true ? .destructive : nil) {
                    Task { await model.answer(item, action: action); selectedAction = nil }
                }
            }
        }
    }
}

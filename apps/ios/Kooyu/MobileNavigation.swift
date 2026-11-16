import SwiftUI

struct NativeSettingsView: View {
    @Bindable var model: Workbench
    var body: some View {
        Form {
            Section("远程连接") {
                if let c = model.connection {
                    LabeledContent("当前设备", value: c.displayName)
                    LabeledContent("连接状态", value: model.online ? "在线" : "离线 · 正在重连")
                }
            }
            DevicesView(model: model)
            Section("偏好与配置") {
                NavigationLink("通用与外观") { SettingsDetailView(model: model, section: "general") }
                NavigationLink("全局记忆") { GlobalMemorySettingsView(model: model) }
                NavigationLink("执行引擎") { SettingsDetailView(model: model, section: "engines") }
                NavigationLink("会话托管") { HostControlsView(model: model) }
                NavigationLink("后台提醒") {
                    Form {
                        if let c = model.connection {
                            Button("注册后台提醒") { Task { await model.push.enable(c) } }.disabled(model.push.working || !model.online)
                            Button("关闭后台提醒", role: .destructive) { Task { await model.push.disable(c) } }.disabled(model.push.working || !model.online)
                            if model.push.working { ProgressView() }
                        }
                    }.navigationTitle("后台提醒")
                }
            }
        }.navigationTitle("设置")
    }
}

struct InboxView: View {
    @Bindable var model: Workbench
    @Environment(\.dismiss) private var dismiss
    @State private var notices: [JSONValue] = []
    @State private var cursor = 0
    @State private var more = false
    @State private var loading = false
    private func load(_ after: Int) async {
        loading = true; defer { loading = false }
        if let page = await model.read("/notifications?after=\(after)&limit=100") {
            let next = page["items"].array
            notices = after == 0 ? next : notices + next
            cursor = Int(page["cursor"].number ?? 0); more = next.count == 100
        }
    }
    var body: some View {
        NavigationStack {
            List {
                let items = model.snapshot?.inbox.filter { !$0.resolved } ?? []
                if items.isEmpty && notices.isEmpty && !loading { ContentUnavailableView("暂无待处理事项", systemImage: "tray") }
                ForEach(items) { item in
                    Button {
                        Task { await model.select(item.sessionId); model.selectedTab = "sessions"; dismiss() }
                    } label: {
                        HStack {
                            Image(systemName: "tray")
                            VStack(alignment: .leading, spacing: 5) {
                                Text(model.snapshot?.sessions.first { $0.id == item.sessionId }?.title ?? "对话通知").foregroundStyle(KY.text)
                                Text(nativeQuestionForm(item.payload) == nil ? "等待确认 · 点击进入对话处理" : "Harness 正在等待你的回答").font(.caption).foregroundStyle(KY.textSecondary)
                            }
                            Spacer(); Image(systemName: "chevron.right").foregroundStyle(KY.textTertiary)
                        }.frame(minHeight: 48)
                    }.buttonStyle(.plain)
                }
                ForEach(Array(notices.reversed().filter { notice in !items.contains { $0.id == notice["inboxItemId"].string } }.enumerated()), id: \.offset) { _, notice in
                    Button {
                        Task {
                            if let target = NotificationTarget(hostId: model.connection?.hostId ?? "", notificationId: notice["id"].string), await model.openNotification(target) { dismiss() }
                        }
                    } label: {
                        VStack(alignment: .leading) { Text(notice["title"].string); Text(model.snapshot?.sessions.first { $0.id == notice["sessionId"].string }?.title ?? notice["createdAt"].string).font(.caption).foregroundStyle(.secondary) }
                    }.frame(minHeight: 48)
                }
                if loading { ProgressView() }
                if more { Button("加载更多通知") { Task { await load(cursor) } }.disabled(loading) }
            }.navigationTitle("收件箱").refreshable { await model.refresh() }
                .toolbar { Button("完成") { dismiss() } }
                .task(id: model.connection?.hostId) { await load(0) }
        }
    }
}

struct DirectoryPickerView: View {
    @Bindable var model: Workbench
    var initial = ""
    var choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var path = ""
    @State private var data: JSONValue?
    @State private var loading = true
    @State private var retry = 0
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("主目录") { path = "" }
                    if let parent = data?["parent"].string.nonEmpty { Button("上级目录") { path = parent } }
                    Text(data?["path"].string ?? path).font(.caption).textSelection(.enabled)
                }
                if loading { ProgressView() }
                if !loading && data == nil { Button("读取失败，重试") { retry += 1 } }
                ForEach(data?["roots"].array.map(\.string) ?? [], id: \.self) { root in Button(root, systemImage: "externaldrive") { path = root } }
                ForEach(Array((data?["directories"].array ?? []).enumerated()), id: \.offset) { _, dir in
                    Button { path = dir["path"].string } label: { Label(dir["name"].string, systemImage: "folder") }.frame(minHeight: 44)
                }
                if !loading && data != nil && data?["directories"].array.isEmpty == true { Text("此目录没有子目录，可以直接选择。").foregroundStyle(.secondary) }
            }.navigationTitle("选择设备目录").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("选择此目录") { if let selected = data?["path"].string.nonEmpty { choose(selected); dismiss() } }.disabled(loading || data == nil)
                    }
                }
                .task { path = initial }
                .task(id: "\(path):\(retry)") {
                    loading = true; data = nil
                    let encoded = path.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                    data = await model.read("/directories" + (path.isEmpty ? "" : "?path=\(encoded)")); loading = false
                }
        }
    }
}

struct StructuredInteractionReply: View {
    @Bindable var model: Workbench
    let item: InboxItem
    @State private var text = ""
    @State private var confirming = false
    private var parsed: JSONValue? { guard let data = text.data(using: .utf8), let value = try? JSONDecoder().decode(JSONValue.self, from: data), case .object = value else { return nil }; return value }
    var body: some View {
        DisclosureGroup("结构化回答") {
            Text("此请求未提供标准表单，可按请求格式提交 JSON 对象。").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $text).font(.system(.caption, design: .monospaced)).frame(minHeight: 120)
            Button("提交回答") { confirming = true }.disabled(!model.canWrite || parsed == nil)
        }.confirmationDialog("确认提交此回答？", isPresented: $confirming, titleVisibility: .visible) {
            Button("提交") { if let value = parsed { Task { await model.answer(item, action: NativeAction(label: "提交", answer: value, destructive: false)) } } }
        }
    }
}

struct PendingComposerMessages: View {
    @Bindable var model: Workbench
    let session: HostSession
    @State private var editing: JSONValue?
    @State private var text = ""
    private var pending: [JSONValue] { pendingUserMessages(model.page?.commands ?? []) }
    private var steer: Bool { (session.nativeCapabilities?["steer"] ?? model.snapshot?.harnesses?.first { $0.id == session.harnessId }?.capabilities?["steer"].string) == "supported" }
    private func change(_ command: JSONValue, action: String, text: String? = nil) async {
        var values: [String: JSONValue] = ["expectedRevision": .number(command["body"]["pendingRevision"].number ?? 0), "action": .string(action)]
        if let text { values["text"] = .string(text) }
        if await model.execute("/sessions/\(session.id)/commands/\(command["id"].string)", method: "PATCH", values: values) != nil { editing = nil }
    }
    var body: some View {
        if !pending.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text("排队消息 · \(pending.count)").font(.caption).foregroundStyle(KY.textSecondary)
                    ForEach(Array(pending.enumerated()), id: \.offset) { _, command in
                        VStack(alignment: .leading) {
                            Text(command["body"]["text"].string).font(.subheadline).lineLimit(3)
                            HStack {
                                Button("编辑") { editing = command; text = command["body"]["text"].string }
                                if session.runState == "idle" || session.runState == "running" && steer {
                                    Button(session.runState == "running" ? "插入当前轮" : "立即发送") { Task { await change(command, action: "send-now") } }
                                }
                                Button("撤回", role: .destructive) { Task { _ = await model.execute("/sessions/\(session.id)/commands/\(command["id"].string)", method: "DELETE") } }
                            }.font(.caption).buttonStyle(.borderless).disabled(!model.canWrite)
                        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(KY.sunken, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }.frame(maxHeight: 190)
                .sheet(isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
                    NavigationStack {
                        TextEditor(text: $text).padding().navigationTitle("编辑排队消息")
                            .toolbar {
                                Button("取消") { editing = nil }
                                Button("保存") { if let command = editing { Task { await change(command, action: "edit", text: text) } } }.disabled(!model.canWrite || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                    }
                }
        }
    }
}

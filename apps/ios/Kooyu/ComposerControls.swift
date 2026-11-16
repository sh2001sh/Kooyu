import SwiftUI

struct ManagedAttachment: Identifiable, Sendable { let id, name: String }
func defaultPermissionLabel(_ harness: String) -> String {
    harness == "kodo" || harness == "pi" ? "默认工具" : harness == "opencode" ? "原生代理规则" : "原生默认"
}
struct NativeComposerControls: View {
    @Bindable var model: Workbench
    let session: HostSession
    @Binding var text: String
    var attachments: [ManagedAttachment]
    var uploading: Bool
    var error: String
    var attach: () -> Void
    var remove: (String) -> Void
    var submit: () -> Void
    @State private var options: JSONValue?
    @State private var permissions: JSONValue?
    @State private var showModels = false
    @State private var showReasoning = false
    @State private var query = ""
    @State private var loading = false
    @State private var loadError = ""
    private var descriptor: HostHarness? { model.snapshot?.harnesses?.first { $0.id == session.harnessId } }
    private var binding: JSONValue? {
        if let pinned = options?["binding"], case .object = pinned { return pinned }
        return model.snapshot?.bindings?.first { $0["id"].string == session.bindingId } }
    private var models: [JSONValue] { options?["models"].array ?? [] }
    private func value(_ item: JSONValue) -> String { session.bindingId == nil ? nativeModelID(session.harnessId, item) : item["id"].string }
    private var active: String {
        if let explicit = session.model { return explicit }
        if let effective = options?["effectiveModel"].string, !effective.isEmpty { return effective }
        if let bound = binding?["model"].string, !bound.isEmpty { return bound }
        return composerDefaultModel(options?["defaultModel"]) ?? descriptor?.nativeDefaults?["model"].string ?? ""
    }
    private var selected: JSONValue? { selectComposerModel(models, active, inherited: session.model == nil) }
    private var dynamicPermissions: Bool { ["gemini", "cursor", "kimi-code", "grok-build"].contains(session.harnessId) }
    private var acp: Bool { session.harnessId != "kimi-code" || session.permissionMode?.hasPrefix("acp:") == true || session.nativeSessionId.map { !$0.hasPrefix("session_") } == true }
    private var choices: [(String, String)] {
        let native = permissions?["options"].array.map { ($0["value"].string, $0["label"].string) } ?? []
        return dynamicPermissions && (acp || permissions != nil) ? native : permissionOptions(session.harnessId)
    }
    private var permission: String { dynamicPermissions ? permissions?["current"].string ?? session.permissionMode ?? "" : session.permissionMode ?? "" }
    private var permissionLabel: String { choices.first { $0.0 == permission }?.1 ?? defaultPermissionLabel(session.harnessId) }
    private var modelLabel: String {
        if let name = selected?["name"].string, !name.isEmpty { return name }
        return active.isEmpty ? "原生默认" : String(active.split(separator: "/").last ?? "原生默认")
    }
    private var levels: [String] { composerReasoningLevels(selected, binding: binding, current: active, harness: session.harnessId) }
    private var effort: String { session.reasoning ?? (binding != nil ? binding?["reasoning"].string.nonEmpty : descriptor?.nativeDefaults?["reasoning"].string.nonEmpty) ?? "默认思考" }
    private func load(_ discover: Bool) async {
        loading = true
        let query = discover ? (session.phase == "native" && session.connectionState == "connected" ? "?refresh=1" : "?discover=1") : ""
        if let result = await model.read("/sessions/\(session.id)/settings\(query)") { options = result; loadError = "" }
        else { loadError = "读取模型失败，请重试。" }
        loading = false
    }
    private func commit(_ choice: String?, _ level: String?) {
        Task { @MainActor in
            let revision = max(options?["session"]["settingsRevision"].number ?? 0, Double(session.settingsRevision ?? 0))
            let result = await model.execute("/sessions/\(session.id)/settings", values: ["expectedRevision": .number(revision),
                "model": choice.map { .string($0) } ?? .null, "reasoning": level.map { .string($0) } ?? .null])
            if result != nil { showModels = false; showReasoning = false }
            await load(false)
        }
    }
    private var leftControls: some View {
        HStack(spacing: 4) {
            Button(action: attach) { Image(systemName: "plus").frame(width: 44, height: 44) }.buttonStyle(.plain)
                .disabled(!model.canWrite || uploading || attachments.count >= 10).accessibilityLabel("添加附件")
            ComposerPill(title: descriptor?.name ?? session.harnessId, icon: "terminal", expandable: false)
            Menu {
                if !dynamicPermissions || session.harnessId == "kimi-code" && !acp { Button(defaultPermissionLabel(session.harnessId)) { Task { _ = await model.updateSession(session.id, values: ["permissionMode": .null]) } } }
                ForEach(choices, id: \.0) { value, label in
                    Button(label) { Task { _ = await model.updateSession(session.id, values: ["permissionMode": .string(value)]) } }
                }
                if choices.isEmpty { Text("权限由原生配置管理") }
            } label: { ComposerPill(title: permissionLabel, icon: "shield") }
            .disabled(!model.canWrite)
        }
    }
    private var rightControls: some View {
        HStack(spacing: 4) {
            Button { showModels = true } label: { ComposerPill(title: modelLabel, icon: "cpu", compact: true) }
                .buttonStyle(.plain).disabled(!model.canWrite || descriptor?.modelSupport == "native-only")
                .accessibilityLabel("模型配置")
            Button { showReasoning = true } label: { ComposerPill(title: effort, icon: "speedometer", compact: true) }
                .buttonStyle(.plain).fixedSize(horizontal: true, vertical: false)
                .disabled(!model.canWrite).accessibilityLabel("思考强度")
            Spacer(minLength: 0)
        }
    }
    var body: some View {
        WorkbenchComposer(text: $text, placeholder: "发送消息给 \(descriptor?.name ?? session.harnessId)…", enabled: session.bindingUnavailable != true,
            sendEnabled: model.canWrite && !uploading && error.isEmpty && session.bindingUnavailable != true && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty) && text.count <= 200000,
            stop: session.runState == "running" && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty,
            stopEnabled: model.canWrite && descriptor?.capabilities?["cancel"].string != "unsupported",
            uploading: uploading, error: error, attachments: attachments, remove: remove, submit: submit,
            cancel: { Task { await model.cancelTurn() } }, left: { leftControls }, right: { rightControls })
        .task(id: "\(session.id):\(session.settingsRevision ?? 0)") {
            await load(false); permissions = await model.read("/sessions/\(session.id)/permissions")
        }
        .sheet(isPresented: $showReasoning) {
            ComposerReasoningPicker(levels: levels, current: session.reasoning ?? "", loading: loading, error: loadError.nonEmpty ?? model.error,
                enabled: model.canWrite, refresh: { await load(true) }) { level in
                let target = level.isEmpty ? session.model : reasoningModelTarget(active, selected: selected, harness: session.harnessId, bound: binding != nil)
                commit(target, level.nonEmpty)
            }
        }
        .sheet(isPresented: $showModels) {
            NavigationStack {
                List {
                    if loading { ProgressView() }
                    if !loadError.isEmpty { Text(loadError).foregroundStyle(KY.destructive) }
                    Button(binding == nil ? "原生配置与登录" : "绑定默认模型") { commit(nil, nil) }.disabled(loading || !model.canWrite)
                    ForEach(Array(models.filter { query.isEmpty || (value($0) + " " + $0["name"].string).localizedCaseInsensitiveContains(query) }.enumerated()), id: \.offset) { _, item in
                        Button { commit(value(item), nil) } label: {
                            VStack(alignment: .leading) {
                                Text(item["name"].string.nonEmpty ?? item["id"].string)
                                Text(value(item)).font(.caption).foregroundStyle(KY.textSecondary)
                            }
                        }.disabled(loading || !model.canWrite)
                    }
                    if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !models.contains(where: { value($0) == query }) {
                        Button("使用模型：\(query)") { commit(query.trimmingCharacters(in: .whitespacesAndNewlines), nil) }.disabled(loading || !model.canWrite)
                    }
                }.searchable(text: $query, prompt: "筛选或输入模型 ID…")
                .navigationTitle("模型配置").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showModels = false } } }
                .refreshable { await load(true) }.task { await load(true) }
            }.tint(KY.text)
        }
    }
}

extension String { var nonEmpty: String? { isEmpty ? nil : self } }

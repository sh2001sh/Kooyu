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
    @State private var plusOpen = false
    @State private var showModels = false
    @State private var modelSheetTab = "model"
    @State private var stopSheetOpen = false
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
    private var effortValue: String { session.reasoning ?? "" }
    private var effortDisplay: String? { session.reasoning?.nonEmpty ?? (binding != nil ? binding?["reasoning"].string.nonEmpty : descriptor?.nativeDefaults?["reasoning"].string.nonEmpty) }
    private var modelSummary: String { effortDisplay.map { "\(modelLabel) · \($0)" } ?? modelLabel }
    private var supervised: Bool {
        model.snapshot?.supervisions?.contains {
            $0["targetSessionId"].string == session.id &&
                $0["state"].string == "active" &&
                $0["mode"].string == "continue"
        } == true
    }
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
            if result != nil { showModels = false }
            await load(false)
        }
    }

    var body: some View {
        let cancelSupported = descriptor?.capabilities?["cancel"].string != "unsupported"
        let showStop = (session.runState == "running" || supervised) && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty
        WorkbenchComposer(
            text: $text,
            placeholder: session.bindingUnavailable == true ? "会话配置不可用" : "发送消息给 \(descriptor?.name ?? session.harnessId)…",
            enabled: session.bindingUnavailable != true,
            sendEnabled: model.canWrite && !uploading && error.isEmpty && session.bindingUnavailable != true && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty) && text.count <= 200000,
            stop: showStop,
            stopEnabled: model.canWrite && (supervised || cancelSupported),
            stopAccessibilityLabel: supervised ? "停止或暂停托管" : "中断当前回合",
            uploading: uploading,
            error: error,
            attachments: attachments,
            remove: remove,
            submit: submit,
            cancel: {
                if supervised { stopSheetOpen = true }
                else { Task { await model.cancelTurn() } }
            },
            onPlus: { plusOpen = true },
            plusCount: attachments.count,
            plusEnabled: model.canWrite && session.bindingUnavailable != true,
            modelSummary: modelLabel,
            modelEnabled: model.canWrite && (descriptor?.modelSupport != "native-only" || !levels.isEmpty),
            harnessId: session.harnessId,
            onModel: { modelSheetTab = "model"; showModels = true },
            reasoningSummary: effortDisplay,
            onReasoning: { modelSheetTab = "reasoning"; showModels = true },
            permissionSummary: permissionLabel,
            onPermission: { plusOpen = true }
        )
        .task(id: "\(session.id):\(session.settingsRevision ?? 0)") {
            await load(false); permissions = await model.read("/sessions/\(session.id)/permissions")
        }
        .sheet(isPresented: $plusOpen) {
            NavigationStack {
                Form {
                    Section("附件") {
                        Button {
                            plusOpen = false
                            attach()
                        } label: {
                            Label(attachments.isEmpty ? "添加文件附件…" : "继续添加附件（已选 \(attachments.count)/10）", systemImage: "paperclip")
                        }
                        .disabled(!model.canWrite || uploading || attachments.count >= 10)
                    }
                    Section("工具权限 · \(permissionLabel)") {
                        if !dynamicPermissions || session.harnessId == "kimi-code" && !acp {
                            Button {
                                Task { _ = await model.updateSession(session.id, values: ["permissionMode": .null]) }
                                plusOpen = false
                            } label: {
                                HStack {
                                    Text(defaultPermissionLabel(session.harnessId))
                                    Spacer()
                                    if permission.isEmpty { Image(systemName: "checkmark") }
                                }
                            }.disabled(!model.canWrite)
                        }
                        ForEach(choices, id: \.0) { value, label in
                            Button {
                                Task { _ = await model.updateSession(session.id, values: ["permissionMode": .string(value)]) }
                                plusOpen = false
                            } label: {
                                HStack {
                                    Text(label)
                                    Spacer()
                                    if permission == value { Image(systemName: "checkmark") }
                                }
                            }.disabled(!model.canWrite)
                        }
                        if choices.isEmpty {
                            Text("权限由原生配置管理").font(.footnote).foregroundStyle(KY.textSecondary)
                        }
                    }
                }
                .navigationTitle("附加与权限").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("完成") { plusOpen = false } }
            }
        }
        .sheet(isPresented: $showModels) {
            ComposerModelReasoningSheet(
                models: models,
                currentModel: session.model,
                effectiveModelLabel: modelLabel,
                inheritLabel: binding == nil ? "原生配置与登录" : "绑定默认模型",
                modelSupport: descriptor?.modelSupport,
                levels: levels,
                currentReasoning: effortValue,
                loading: loading,
                error: loadError.nonEmpty ?? model.error,
                enabled: model.canWrite,
                initialTab: modelSheetTab,
                modelID: value,
                refresh: { await load(true) },
                chooseModel: { choice in commit(choice, nil) },
                chooseReasoning: { level in
                    let target = (level?.isEmpty != false) ? session.model : reasoningModelTarget(active, selected: selected, harness: session.harnessId, bound: binding != nil)
                    commit(target, level)
                }
            )
        }
        .confirmationDialog("停止当前运行", isPresented: $stopSheetOpen, titleVisibility: .visible) {
            Button("停止并暂停托管（推荐）", role: .destructive) { Task { await model.stop() } }
            if cancelSupported {
                Button("仅中断本轮（保留托管）") { Task { await model.cancelTurn() } }
            }
            Button("继续运行", role: .cancel) {}
        } message: {
            Text("此对话已开启自动托管；请选择仅中断本轮或同时暂停托管")
        }
    }
}

extension String { var nonEmpty: String? { isEmpty ? nil : self } }

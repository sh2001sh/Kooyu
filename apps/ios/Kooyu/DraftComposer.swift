import SwiftUI
import UniformTypeIdentifiers

struct SessionComposerView: View {
    @Bindable var model: Workbench
    var initialProject = ""
    var initialText = ""
    /// Preselected engine (the L0 card passes "kodo"); empty uses the device default.
    var initialHarness = ""
    @Environment(\.dismiss) private var dismiss
    private let quickPrompts = ["审查当前 Git 改动", "运行测试并修复错误", "分析项目架构"]
    @State private var draft = SessionDraft()
    @State private var plusOpen = false
    @State private var context = false
    @State private var directory = false
    @State private var importing = false
    @State private var uploading = false
    @State private var attachmentError = ""
    @State private var files: [ManagedAttachment] = []
    @State private var catalog: JSONValue?
    @State private var executors: [JSONValue] = []
    @State private var modelsOpen = false
    @State private var modelSheetTab = "model"
    @State private var loading = false
    @State private var loadError = ""
    private var descriptor: HostHarness? { model.snapshot?.harnesses?.first { $0.id == draft.harnessId } }
    private var bindings: [JSONValue] { model.snapshot?.bindings?.filter { $0["harnessId"].string == draft.harnessId && !$0["archived"].boolean } ?? [] }
    private var inherited: String {
        model.snapshot?.projects.first { $0.id == draft.projectId }?.bindingDefaults?[draft.harnessId].string.nonEmpty ?? model.snapshot?.bindingDefaults?["harnessBindingIds"][draft.harnessId].string ?? ""
    }
    private var binding: JSONValue? { bindings.first { $0["id"].string == (draft.choice.hasPrefix("binding:") ? String(draft.choice.dropFirst(8)) : draft.choice == "inherit" ? inherited : "") } }
    private var provider: JSONValue? { binding?["selectionMode"].string == "provider" ? binding : nil }
    private var models: [JSONValue] {
        if let provider {
            return provider["availableModels"].array.map { item in
                var value = item["effective"].object
                value["id"] = item["model"]; value["name"] = item["name"]
                value["reasoning"] = .array(providerReasoningLevels(item["effective"], draft.harnessId).map { .string($0) })
                return .object(value)
            }
        }
        if let binding {
            return [.object(["id": binding["model"], "name": binding["model"], "reasoning": .array(providerReasoningLevels(binding["parameters"], draft.harnessId).map { .string($0) })])]
        }
        return catalog?["models"].array ?? []
    }
    private var harnessPreset: JSONValue? { model.appSettings?["harnessDefaults"][draft.harnessId] }
    private var presetModel: String? {
        guard draft.executorId == "local", draft.choice == "inherit", let m = harnessPreset?["model"].string.nonEmpty else { return nil }
        if let provider { return provider["availableModels"].array.contains { $0["model"].string == m } ? m : nil }
        return binding == nil ? m : nil
    }
    private var effectiveReasoning: String? {
        draft.reasoning.nonEmpty ?? (draft.executorId == "local" && draft.choice == "inherit" ? harnessPreset?["reasoning"].string.nonEmpty : nil)
    }
    private var effectivePermission: String {
        if let chosen = draft.permission.nonEmpty { return chosen }
        if let preset = harnessPreset?["permissionMode"].string.nonEmpty, permissionOptions(draft.harnessId).contains(where: { $0.0 == preset }) { return preset }
        return ""
    }
    private var active: String {
        draft.model.nonEmpty ?? presetModel ?? binding?["model"].string.nonEmpty ?? composerDefaultModel(catalog?["defaultModel"]) ?? descriptor?.nativeDefaults?["model"].string ?? ""
    }
    private func modelID(_ item: JSONValue) -> String { binding == nil ? nativeModelID(draft.harnessId, item) : item["id"].string }
    private var selected: JSONValue? { selectComposerModel(models, active, inherited: draft.model.isEmpty) }
    private var levels: [String] { composerReasoningLevels(selected, binding: binding, current: active, harness: draft.harnessId) }
    private func loadCatalog(_ discover: Bool) async {
        loading = true
        if let result = await model.read("/harnesses/\(draft.harnessId)/models" + (discover ? "?discover=1" : "")) { catalog = result; loadError = "" }
        else { loadError = "读取模型失败，请刷新重试。" }
        loading = false
    }
    private var workspaces: [HostWorkspace] {
        let host = draft.executorId == "local" ? model.snapshot?.hostId : executors.first { $0["id"].string == draft.executorId }?["hostId"].string
        return model.snapshot?.workspaces?.filter { (draft.projectId.isEmpty || $0.projectId == draft.projectId) && ($0.hostId == nil || $0.hostId == host) } ?? []
    }
    private var validation: String? { draft.validation(model.snapshot) }
    private var harnessTitle: String {
        if draft.harnessId == "kodo" { return draft.kind == "supervisor" ? "Kooyu 主对话" : "Kooyu" }
        return descriptor?.name ?? harnessVisual(draft.harnessId).name
    }
    private var projectLabel: String {
        model.snapshot?.projects.first { $0.id == draft.projectId }?.name ?? "全局对话"
    }
    private var workspaceLabel: String {
        if let raw = workspaces.first(where: { $0.id == draft.workspaceId })?.rootPath ?? draft.customPath.nonEmpty {
            let short = formatWorkspaceLabel(raw)
            return short.isEmpty ? raw : short
        }
        return "未绑定目录"
    }
    private var draftPermissionLabel: String {
        permissionOptions(draft.harnessId).first { $0.0 == effectivePermission }?.1 ?? defaultPermissionLabel(draft.harnessId)
    }
    private var draftModelLabel: String {
        if draft.executorId != "local" { return "节点原生配置" }
        return selected?["name"].string.nonEmpty ?? active.nonEmpty ?? "原生默认"
    }
    private var draftModelSummary: String {
        if let r = effectiveReasoning { return "\(draftModelLabel) · \(r)" }
        return draftModelLabel
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(KY.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.kooyuPress)
                    .accessibilityLabel("取消")

                    Spacer(minLength: 4)

                    VStack(spacing: 2) {
                        Menu {
                            ForEach(model.snapshot?.harnesses ?? []) { engine in
                                Button {
                                    chooseHarness(engine.id)
                                } label: {
                                    HStack {
                                        Text(engine.id == "kodo" ? (draft.kind == "supervisor" ? "Kooyu 主对话" : "Kooyu") : engine.name)
                                        if engine.id == draft.harnessId { Image(systemName: "checkmark") }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 6) {
                                EngineBadge(harnessId: draft.harnessId, size: 18, circle: false)
                                Text(harnessTitle).font(.system(size: 15, weight: .semibold)).foregroundStyle(KY.text).lineLimit(1)
                                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(KY.textTertiary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(KY.sunken, in: Capsule())
                        }
                        .accessibilityLabel("切换引擎：\(harnessTitle)")

                        Button { plusOpen = true } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "folder").font(.system(size: 10, weight: .medium))
                                Text("\(projectLabel) · \(workspaceLabel)")
                                    .font(KYFont.caption)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .foregroundStyle(KY.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("项目与目录：\(projectLabel)，\(workspaceLabel)")
                    }

                    Spacer(minLength: 4)

                    Button { context = true } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.system(size: 17, weight: .medium))
                            .foregroundStyle(KY.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.kooyuPress)
                    .accessibilityLabel("更多会话设置")
                }

                Spacer(minLength: 8)
                ComposerWelcome(title: model.snapshot?.projects.first { $0.id == draft.projectId }.map { "在 \($0.name) 中做什么？" } ?? "今天想做些什么？")
                Spacer(minLength: 8)

                if draft.firstMessage.isEmpty && files.isEmpty {
                    quickPromptRow.transition(.opacity)
                }
                if let validation { Text(validation).font(.caption).foregroundStyle(KY.textSecondary) }
                if !model.error.isEmpty { Text(model.error).font(.caption).foregroundStyle(KY.destructive) }
                WorkbenchComposer(
                    text: $draft.firstMessage,
                    placeholder: "问问 \(harnessTitle)，或输入任务说明…",
                    enabled: !model.busy,
                    sendEnabled: model.canWrite && validation == nil && !uploading && attachmentError.isEmpty && (!draft.firstMessage.isEmpty || !files.isEmpty),
                    uploading: uploading,
                    error: attachmentError,
                    attachments: files,
                    remove: { id in files.removeAll { $0.id == id }; attachmentError = "" },
                    submit: submit,
                    autoFocus: true,
                    onPlus: { plusOpen = true },
                    plusCount: files.count,
                    plusEnabled: model.canWrite,
                    modelSummary: draftModelLabel,
                    modelEnabled: draft.executorId == "local" && (descriptor?.modelSupport != "native-only" || !levels.isEmpty),
                    harnessId: draft.harnessId,
                    onModel: { modelSheetTab = "model"; modelsOpen = true },
                    reasoningSummary: effectiveReasoning,
                    onReasoning: { modelSheetTab = "reasoning"; modelsOpen = true },
                    permissionSummary: draftPermissionLabel,
                    onPermission: { plusOpen = true }
                )
            }
            .animation(KYMotion.base, value: draft.firstMessage.isEmpty)
            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 12).background(KY.paper)
            .toolbar(.hidden, for: .navigationBar)
            .task {
                draft.firstMessage = initialText
                draft.harnessId = initialHarness.nonEmpty ?? model.appSettings?["defaultHarnessId"].string.nonEmpty ?? "kodo"
                setProject(initialProject)
                executors = await model.read("/executors")?.array ?? []
            }
            .task(id: draft.harnessId) {
                catalog = nil; await loadCatalog(false)
            }
            .sheet(isPresented: $plusOpen) { plusSheet }
            .sheet(isPresented: $context) { contextView }
            .sheet(isPresented: $directory) { DirectoryPickerView(model: model, initial: draft.customPath) { draft.customPath = $0; draft.workspaceId = "" } }
            .sheet(isPresented: $modelsOpen) { modelPicker }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                    Task { @MainActor in
                        uploading = true; defer { uploading = false }
                        do {
                            guard let connection = model.connection else { return }
                            for url in try result.get() {
                                guard files.count < 10 else { throw APIError(message: "一次最多附加 10 个文件。", status: 0) }
                                let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                                let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
                                guard let size = values.fileSize, size <= 32 * 1024 * 1024 else { throw APIError(message: "单个附件最多 32 MiB。", status: 0) }
                                let bytes = try await Task.detached { try Data(contentsOf: url, options: .mappedIfSafe) }.value
                                let file = try await HostAPI(connection: connection).upload(name: url.lastPathComponent, mediaType: values.contentType?.preferredMIMEType ?? "application/octet-stream", data: bytes, sessionId: nil)
                                guard model.connection?.token == connection.token else { return }
                                files.append(ManagedAttachment(id: file["id"].string, name: url.lastPathComponent))
                            }
                            attachmentError = ""
                        } catch { attachmentError = error.localizedDescription }
                    }
                }
        }
    }
    private func setProject(_ id: String) { draft.projectId = id; draft.workspaceId = model.snapshot?.workspaces?.first { $0.projectId == id && ($0.hostId == nil || $0.hostId == model.snapshot?.hostId) }?.id ?? ""; draft.customPath = "" }
    private func submit() { Task { if await model.createSession(draft, attachments: files) { model.selectedTab = "sessions"; dismiss() } } }
    private func chooseHarness(_ id: String) {
        withAnimation(KYMotion.snap) { draft.harnessId = id }
        draft.choice = "inherit"; draft.model = ""; draft.reasoning = ""; draft.permission = ""
    }
    private var quickPromptRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(quickPrompts, id: \.self) { prompt in
                    Button { draft.firstMessage = prompt } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "sparkles").font(.system(size: 11, weight: .semibold))
                            Text(prompt)
                        }
                        .font(KYFont.label)
                        .foregroundStyle(KY.textSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(KY.sunken, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kooyuPress)
                }
            }
            .padding(.horizontal, 2)
        }
    }
    private var plusSheet: some View {
        NavigationStack {
            Form {
                Section("附件") {
                    Button {
                        plusOpen = false
                        importing = true
                    } label: {
                        Label(files.isEmpty ? "添加文件附件…" : "继续添加附件（已选 \(files.count)/10）", systemImage: "paperclip")
                    }
                    .disabled(!model.canWrite || uploading || files.count >= 10)
                }
                Section("项目与目录") {
                    Picker("所属项目", selection: Binding(get: { draft.projectId }, set: { setProject($0) })) {
                        Text("全局对话").tag("")
                        ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) }
                    }
                    Picker("工作目录", selection: Binding(
                        get: { draft.workspaceId },
                        set: { draft.workspaceId = $0; draft.customPath = "" }
                    )) {
                        Text("未绑定目录").tag("")
                        ForEach(workspaces) { w in
                            let label = formatWorkspaceLabel(w.rootPath)
                            Text(label.isEmpty ? w.rootPath : label).tag(w.id)
                        }
                    }
                    if draft.executorId == "local" {
                        Button("浏览设备目录…") {
                            plusOpen = false
                            directory = true
                        }
                        if !draft.customPath.isEmpty {
                            LabeledContent("已选路径", value: formatWorkspaceLabel(draft.customPath))
                        }
                    }
                }
                Section("工具权限") {
                    Picker("权限策略", selection: $draft.permission) {
                        Text(defaultPermissionLabel(draft.harnessId)).tag("")
                        ForEach(permissionOptions(draft.harnessId), id: \.0) { value, label in
                            Text(label).tag(value)
                        }
                    }
                }
            }
            .navigationTitle("会话上下文与附件").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("完成") { plusOpen = false } }
        }
    }
    private var contextView: some View {
        NavigationStack {
            Form {
                TextField("对话标题（可选）", text: $draft.title)
                Picker("执行节点", selection: $draft.executorId) {
                    Text("当前设备").tag("local")
                    ForEach(Array(executors.filter { $0["id"].string != "local" }.enumerated()), id: \.offset) { _, node in Text(node["name"].string).tag(node["id"].string) }
                }.onChange(of: draft.executorId) { _, _ in draft.workspaceId = ""; draft.customPath = "" }
                if draft.harnessId == "kodo" { Picker("对话类型", selection: $draft.kind) { Text("Kooyu 主对话").tag("supervisor"); Text("直接对话").tag("direct") } }
            }.navigationTitle("对话设置").toolbar { Button("完成") { context = false } }
        }
    }
    private var modelPicker: some View {
        ComposerModelReasoningSheet(
            models: models,
            currentModel: draft.model.nonEmpty,
            effectiveModelLabel: draftModelLabel,
            inheritLabel: "继承项目 / 设备配置",
            modelSupport: descriptor?.modelSupport,
            levels: levels,
            currentReasoning: draft.reasoning,
            loading: loading,
            error: loadError,
            enabled: draft.executorId == "local",
            initialTab: modelSheetTab,
            bindings: bindings,
            bindingChoice: draft.choice,
            allowNativeChoice: descriptor?.modelSupport != "binding-required",
            onSelectInherit: {
                draft.choice = "inherit"; draft.model = ""; draft.reasoning = ""; modelsOpen = false
            },
            onSelectNative: {
                draft.choice = "native"; draft.model = ""; draft.reasoning = ""; modelsOpen = false
            },
            onSelectBinding: { id in
                draft.choice = "binding:" + id; draft.model = ""; draft.reasoning = ""; modelsOpen = false
            },
            modelID: modelID,
            refresh: { await loadCatalog(true) },
            chooseModel: { id in
                if let id {
                    selectModel(id)
                } else {
                    draft.choice = "inherit"; draft.model = ""; draft.reasoning = ""; modelsOpen = false
                }
            },
            chooseReasoning: { level in
                draft.reasoning = level ?? ""
                if let level, !level.isEmpty, let target = reasoningModelTarget(active, selected: selected, harness: draft.harnessId, bound: binding != nil) {
                    draft.model = target
                    draft.choice = binding.map { "binding:" + $0["id"].string } ?? "model"
                }
                modelsOpen = false
            }
        )
    }
    private func selectModel(_ id: String) {
        if provider == nil { draft.choice = "model" } else if let binding { draft.choice = "binding:" + binding["id"].string }
        draft.model = id; draft.reasoning = ""; modelsOpen = false
    }
}

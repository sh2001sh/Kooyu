import SwiftUI
import UniformTypeIdentifiers

struct SessionComposerView: View {
    @Bindable var model: Workbench
    var initialProject = ""
    var initialText = ""
    @Environment(\.dismiss) private var dismiss
    @State private var draft = SessionDraft()
    @State private var context = false
    @State private var directory = false
    @State private var importing = false
    @State private var uploading = false
    @State private var attachmentError = ""
    @State private var files: [ManagedAttachment] = []
    @State private var catalog: JSONValue?
    @State private var executors: [JSONValue] = []
    @State private var query = ""
    @State private var modelsOpen = false
    @State private var loading = false
    @State private var loadError = ""
    @State private var reasoningOpen = false
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
    private var active: String {
        draft.model.nonEmpty ?? binding?["model"].string.nonEmpty ?? composerDefaultModel(catalog?["defaultModel"]) ?? descriptor?.nativeDefaults?["model"].string ?? ""
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
    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                HStack {
                    Menu {
                        Button("全局对话") { setProject("") }
                        ForEach(model.snapshot?.projects ?? []) { project in Button(project.name) { setProject(project.id) } }
                    } label: { ComposerPill(title: model.snapshot?.projects.first { $0.id == draft.projectId }?.name ?? "全局对话", icon: "folder") }
                    Menu {
                        Button("未绑定目录") { draft.workspaceId = ""; draft.customPath = "" }
                        ForEach(workspaces) { workspace in Button(workspace.rootPath) { draft.workspaceId = workspace.id; draft.customPath = "" } }
                        if draft.executorId == "local" { Button("浏览设备目录…") { directory = true } }
                    } label: { ComposerPill(title: workspaces.first { $0.id == draft.workspaceId }?.rootPath ?? draft.customPath.nonEmpty ?? "选择目录", icon: "folder.badge.plus") }
                }.frame(maxWidth: .infinity, alignment: .leading)
                ComposerWelcome(title: model.snapshot?.projects.first { $0.id == draft.projectId }.map { "在 \($0.name) 中做什么？" } ?? "今天想做些什么？").frame(maxHeight: .infinity)
                if let validation { Text(validation).font(.caption).foregroundStyle(KY.textSecondary) }
                if !model.error.isEmpty { Text(model.error).font(.caption).foregroundStyle(KY.destructive) }
                WorkbenchComposer(text: $draft.firstMessage, placeholder: "问问 Kooyu 主对话，或输入任务说明…", enabled: !model.busy,
                    sendEnabled: model.canWrite && validation == nil && !uploading && attachmentError.isEmpty && (!draft.firstMessage.isEmpty || !files.isEmpty),
                    uploading: uploading, error: attachmentError, attachments: files, remove: { id in files.removeAll { $0.id == id }; attachmentError = "" }, submit: submit,
                    left: { leftControls }, right: { rightControls })
            }.padding(.horizontal, 16).padding(.bottom, 12).background(KY.paper)
                .navigationTitle("新建对话").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                    ToolbarItemGroup(placement: .confirmationAction) {
                        Button { context = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("对话设置")
                        Button("创建") { submit() }.disabled(!model.canWrite || validation != nil || uploading)
                    }
                }
                .task {
                    draft.firstMessage = initialText
                    draft.harnessId = model.appSettings?["defaultHarnessId"].string.nonEmpty ?? "kodo"
                    setProject(initialProject)
                    executors = await model.read("/executors")?.array ?? []
                }
                .task(id: draft.harnessId) {
                    catalog = nil; await loadCatalog(false)
                }
                .sheet(isPresented: $context) { contextView }
                .sheet(isPresented: $directory) { DirectoryPickerView(model: model, initial: draft.customPath) { draft.customPath = $0; draft.workspaceId = "" } }
                .sheet(isPresented: $modelsOpen) { modelPicker }
                .sheet(isPresented: $reasoningOpen) {
                    ComposerReasoningPicker(levels: levels, current: draft.reasoning, loading: loading, error: loadError, refresh: { await loadCatalog(true) }) { level in
                        draft.reasoning = level
                        if !level.isEmpty, let target = reasoningModelTarget(active, selected: selected, harness: draft.harnessId, bound: binding != nil) {
                            draft.model = target
                            draft.choice = binding.map { "binding:" + $0["id"].string } ?? "model"
                        }
                        reasoningOpen = false
                    }
                }
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
    private var leftControls: some View {
        HStack(spacing: 2) {
            Button { importing = true } label: { Image(systemName: "plus").frame(width: 44, height: 44) }.disabled(!model.canWrite || uploading || files.count >= 10).accessibilityLabel("添加附件")
            Menu {
                ForEach(model.snapshot?.harnesses ?? []) { engine in
                    Button(engine.id == "kodo" ? "Kooyu · 主对话" : engine.name) { draft.harnessId = engine.id; draft.choice = "inherit"; draft.model = ""; draft.reasoning = ""; draft.permission = "" }
                }
            } label: { ComposerPill(title: draft.harnessId == "kodo" && draft.kind == "supervisor" ? "Kooyu · 主对话" : descriptor?.name ?? draft.harnessId, icon: "terminal", selected: true) }
            Menu {
                Button(defaultPermissionLabel(draft.harnessId)) { draft.permission = "" }
                ForEach(permissionOptions(draft.harnessId), id: \.0) { value, label in Button(label) { draft.permission = value } }
            } label: { ComposerPill(title: permissionOptions(draft.harnessId).first { $0.0 == draft.permission }?.1 ?? defaultPermissionLabel(draft.harnessId), icon: "shield") }
        }.buttonStyle(.plain)
    }
    private var rightControls: some View {
        HStack(spacing: 2) {
            Button { modelsOpen = true } label: { ComposerPill(title: draft.executorId != "local" ? "节点原生配置" : selected?["name"].string.nonEmpty ?? active.nonEmpty ?? "原生默认", icon: "cpu", compact: true) }
                .disabled(draft.executorId != "local" || descriptor?.modelSupport == "native-only")
                .accessibilityLabel("模型配置")
            Button { reasoningOpen = true } label: { ComposerPill(title: draft.reasoning.nonEmpty ?? "默认思考", icon: "speedometer", compact: true) }
                .fixedSize(horizontal: true, vertical: false).disabled(draft.executorId != "local").accessibilityLabel("思考强度")
            Spacer(minLength: 0)
        }.buttonStyle(.plain)
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
        NavigationStack {
            List {
                if loading { ProgressView() }
                if !loadError.isEmpty { Text(loadError).foregroundStyle(KY.destructive) }
                Button("继承项目 / 设备配置") { draft.choice = "inherit"; draft.model = ""; draft.reasoning = ""; modelsOpen = false }
                if descriptor?.modelSupport != "binding-required" { Button("原生配置与登录") { draft.choice = "native"; draft.model = ""; draft.reasoning = ""; modelsOpen = false } }
                Section("引擎绑定") {
                    ForEach(Array(bindings.enumerated()), id: \.offset) { _, binding in Button(binding["name"].string + " · " + binding["model"].string) { draft.choice = "binding:" + binding["id"].string; draft.model = ""; draft.reasoning = ""; modelsOpen = false } }
                }
                if descriptor?.modelSupport != "binding-required" || provider != nil {
                    Section("模型") {
                        ForEach(Array(models.filter { query.isEmpty || (modelID($0) + " " + $0["name"].string).localizedCaseInsensitiveContains(query) }.enumerated()), id: \.offset) { _, item in
                            Button(item["name"].string.nonEmpty ?? modelID(item)) { selectModel(modelID(item)) }
                        }
                        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { Button("使用自定义模型：\(query)") { selectModel(query.trimmingCharacters(in: .whitespacesAndNewlines)) } }
                    }
                }
            }.refreshable { await loadCatalog(true) }.task { await loadCatalog(true) }.searchable(text: $query, prompt: "搜索或输入模型 ID").navigationTitle("模型配置").toolbar { Button("完成") { modelsOpen = false } }
        }
    }
    private func selectModel(_ id: String) {
        if provider == nil { draft.choice = "model" } else if let binding { draft.choice = "binding:" + binding["id"].string }
        draft.model = id; draft.reasoning = ""; modelsOpen = false
    }
}

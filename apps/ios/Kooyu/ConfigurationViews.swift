import SwiftUI

struct EndpointDraft: Identifiable {
    let id = UUID()
    var serverID: String?, name = "API", protocolName = "openai-completions", baseURL = "", modelsURL = "", key = "", clearKey = false
    init(_ value: JSONValue? = nil) {
        if let value { serverID = value["id"].string; name = value["name"].string; protocolName = value["protocol"].string; baseURL = value["baseUrl"].string; modelsURL = value["modelsUrl"].string }
    }
    var valid: Bool { guard !name.isEmpty, let url = URL(string: baseURL) else { return false }; return ["http", "https"].contains(url.scheme ?? "") && url.host != nil && url.user == nil && url.password == nil }
    var wire: JSONValue {
        var fields: [String: JSONValue] = ["name": .string(name), "protocol": .string(protocolName), "baseUrl": .string(baseURL), "clearCredential": .bool(clearKey)]
        if let serverID, !serverID.isEmpty { fields["id"] = .string(serverID) }
        if !modelsURL.isEmpty { fields["modelsUrl"] = .string(modelsURL) }
        if !key.isEmpty { fields["apiKey"] = .string(key) }
        return .object(fields)
    }
}
struct ModelConfigurationView: View {
    @Bindable var model: Workbench
    @State private var section = "providers"
    @State private var reload = 0
    @State private var config: JSONValue?
    @State private var original: JSONValue?
    @State private var deleting: JSONValue?
    @State private var loading = true
    @State private var editing = false
    private var rows: [JSONValue] { config?[section].array ?? [] }
    var body: some View {
        List {
            Picker("管理内容", selection: $section) { Text("来源").tag("providers"); Text("模型").tag("models"); Text("绑定").tag("bindings"); Text("默认").tag("defaults") }.pickerStyle(.segmented)
            if loading { ProgressView("读取配置…") }
            else if config == nil { Button("读取失败，重试") { reload += 1 } }
            else if section == "defaults" { BindingDefaultsView(model: model) }
            else {
                Button("添加配置", systemImage: "plus") { original = nil; editing = true }.disabled(!model.canWrite)
                if rows.isEmpty { Text("暂无配置").foregroundStyle(.secondary) }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Section {
                        Text(row["name"].string).font(.headline)
                        if section == "providers" {
                            ForEach(Array(row["endpoints"].array.enumerated()), id: \.offset) { _, endpoint in HStack {
                                Text(endpoint["name"].string)
                                Spacer()
                                Button("发现模型") { Task { if await model.execute("/providers/\(row["id"].string)/endpoints/\(endpoint["id"].string)/models/refresh") != nil { reload += 1 } } }.disabled(!model.canWrite)
                            } }
                        } else { Text(row["harnessId"].string + " · " + row["model"].string).font(.caption).foregroundStyle(.secondary) }
                        HStack {
                            Button("编辑") { original = row; editing = true }
                            Spacer()
                            if section != "bindings" { Button("删除", role: .destructive) { deleting = row } }
                        }.buttonStyle(.borderless).disabled(!model.canWrite)
                    }
                }
            }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }.navigationTitle("模型来源与绑定")
            .task(id: "\(model.connection?.hostId ?? "")-\(reload)") { loading = true; config = await model.read("/provider-configuration"); loading = false }
            .sheet(isPresented: $editing) { ConfigurationEditorView(model: model, kind: section, original: original, config: config ?? .null) { editing = false; reload += 1 } }
            .confirmationDialog("删除此配置？正在使用的配置以电脑检查结果为准。", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                if let row = deleting { Button("删除", role: .destructive) { Task { let path = section == "providers" ? "/providers/" : "/provider-models/"; if await model.execute(path + row["id"].string, method: "DELETE") != nil { deleting = nil; reload += 1 } } } }
            }
    }
}
struct ConfigurationEditorView: View {
    @Bindable var model: Workbench
    let kind: String, original: JSONValue?, config: JSONValue
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var provider = ""
    @State private var endpoint = ""
    @State private var modelID = ""
    @State private var harness = "kodo"
    @State private var reasoning = ""
    @State private var route = "auto"
    @State private var selection = "fixed"
    @State private var context = ""
    @State private var maxOutput = ""
    @State private var thinking = "auto"
    @State private var inputKind = "auto"
    @State private var inputPrice = ""
    @State private var outputPrice = ""
    @State private var endpoints = [EndpointDraft()]
    @State private var asDefault = false
    @State private var preview: JSONValue?
    @State private var defaultsRevision: Double = 0
    private var providers: [JSONValue] { config["providers"].array }
    private var valid: Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= (kind == "models" ? 200 : 100) else { return false }
        if kind == "providers" { return !endpoints.isEmpty && endpoints.allSatisfy(\.valid) }
        if kind == "models" { return !provider.isEmpty && !endpoint.isEmpty && !modelID.isEmpty && [context, maxOutput].allSatisfy { $0.isEmpty || (Int($0) ?? 0) > 0 } && [inputPrice, outputPrice].allSatisfy { $0.isEmpty || Double($0).map { $0.isFinite && $0 >= 0 } == true } }
        return !modelID.isEmpty
    }
    var body: some View {
        NavigationStack { Form {
            TextField("名称", text: $name)
            if kind == "providers" { providerFields }
            else if kind == "models" { modelFields }
            else { bindingFields }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }.navigationTitle(original == nil ? "添加配置" : "编辑配置")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(model.busy) }
                ToolbarItem(placement: .confirmationAction) { Button("保存") { Task { await save() } }.disabled(!valid || !model.canWrite) }
            }.onAppear(perform: load).interactiveDismissDisabled(model.busy)
        }
    }
    private var providerFields: some View {
        Group {
            ForEach($endpoints) { $entry in Section("API 端点") {
                TextField("端点名称", text: $entry.name)
                Picker("协议", selection: $entry.protocolName) { ForEach(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"], id: \.self) { Text($0).tag($0) } }
                TextField("模型 API Base URL", text: $entry.baseURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                TextField("模型发现地址（可选）", text: $entry.modelsURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                SecureField(entry.serverID == nil ? "API Key" : "新 API Key（留空保留）", text: $entry.key)
                Toggle("清除已保存的密钥", isOn: $entry.clearKey)
                if endpoints.count > 1 { Button("移除此端点", role: .destructive) { endpoints.removeAll { $0.id == entry.id } } }
            } }
            Button("添加端点") { endpoints.append(EndpointDraft()) }.disabled(endpoints.count >= 12)
            Text("密钥仅经 HTTPS 提交给当前电脑，保存后不显示原值。").font(.footnote)
        }
    }
    private var modelFields: some View {
        Group {
            Picker("模型来源", selection: $provider) { Text("请选择").tag(""); ForEach(Array(providers.enumerated()), id: \.offset) { _, row in Text(row["name"].string).tag(row["id"].string) } }.onChange(of: provider) { _, id in if providers.first(where: { $0["id"].string == id })?["endpoints"].array.contains(where: { $0["id"].string == endpoint }) != true { endpoint = "" } }
            Picker("端点", selection: $endpoint) { Text("请选择").tag(""); ForEach(Array((providers.first { $0["id"].string == provider }?["endpoints"].array ?? []).enumerated()), id: \.offset) { _, row in Text(row["name"].string).tag(row["id"].string) } }
            TextField("模型 ID", text: $modelID).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("上下文 Token（留空自动）", text: $context).keyboardType(.numberPad)
            TextField("最大输出 Token（留空自动）", text: $maxOutput).keyboardType(.numberPad)
            Picker("输入能力", selection: $inputKind) { Text("跟随目录 / 端点").tag("auto"); Text("文本").tag("text"); Text("文本与图像").tag("image") }
            Picker("思考能力", selection: $thinking) { Text("跟随目录 / 端点").tag("auto"); Text("支持思考").tag("true"); Text("不支持思考").tag("false") }
            TextField("输入 USD / 百万 Token（可选）", text: $inputPrice).keyboardType(.decimalPad)
            TextField("输出 USD / 百万 Token（可选）", text: $outputPrice).keyboardType(.decimalPad)
        }
    }
    private var bindingFields: some View {
        Group {
            Picker("引擎", selection: $harness) { ForEach(model.snapshot?.harnesses ?? []) { Text($0.name).tag($0.id) } }
            Picker("模型", selection: $modelID) { Text("请选择").tag(""); ForEach(Array(config["models"].array.enumerated()), id: \.offset) { _, row in Text(row["name"].string + " · " + row["model"].string).tag(row["id"].string) } }
            Picker("选择方式", selection: $selection) { Text("固定模型").tag("fixed"); Text("此来源下选择模型").tag("provider") }
            Picker("接入路由", selection: $route) { Text("自动").tag("auto"); Text("直连").tag("direct"); Text("网关").tag("gateway") }
            TextField("思考强度（可选）", text: $reasoning)
            Toggle("设为此电脑引擎的默认绑定", isOn: $asDefault)
            Button("检查兼容性") { Task { preview = await model.execute("/harness-bindings/preview", values: bindingBody(), refreshAfter: false) } }.disabled(!model.canWrite || !valid)
            if let preview {
                Text(preview["supported"].boolean ? "兼容 · " + preview["route"].string : "此配置尚不能使用")
                ForEach(Array(preview["issues"].array.enumerated()), id: \.offset) { _, issue in Text(issue.string).font(.footnote).foregroundStyle(.red) }
            }
        }
    }
    private func load() {
        defaultsRevision = model.snapshot?.bindingDefaults?["revision"].number ?? 0
        guard let value = original else { return }
        name = value["name"].string; provider = value["providerId"].string; endpoint = value["endpointId"].string
        modelID = value[kind == "bindings" ? "modelId" : "model"].string; harness = value["harnessId"].string.isEmpty ? "kodo" : value["harnessId"].string
        reasoning = value["reasoning"].string; selection = value["selectionMode"].string.isEmpty ? "fixed" : value["selectionMode"].string
        route = value["route"].string.isEmpty ? "auto" : value["route"].string
        if kind == "providers" { endpoints = value["endpoints"].array.map { EndpointDraft($0) } }
        context = value["overrides"]["contextWindow"].number.map { String(Int($0)) } ?? ""
        maxOutput = value["overrides"]["maxOutputTokens"].number.map { String(Int($0)) } ?? ""
        if case .bool(let supported) = value["overrides"]["reasoning"] { thinking = supported ? "true" : "false" }
        if case .array(let kinds) = value["overrides"]["input"] { inputKind = kinds.contains(where: { $0.string == "image" }) ? "image" : "text" }
        inputPrice = value["overrides"]["pricing"]["input"].number.map { String($0) } ?? ""
        outputPrice = value["overrides"]["pricing"]["output"].number.map { String($0) } ?? ""
    }
    private func versioned(_ fields: [String: JSONValue]) -> [String: JSONValue] {
        var fields = fields
        if let original { fields["id"] = original["id"]; fields["expectedRevision"] = original["revision"] }
        return fields
    }
    private func bindingBody() -> [String: JSONValue] {
        var fields = versioned(["name": .string(name), "harnessId": .string(harness), "modelId": .string(modelID), "reasoning": reasoning.isEmpty ? .null : .string(reasoning), "route": .string(route), "selectionMode": .string(selection)])
        if asDefault { fields["applyAsDefault"] = .bool(true); fields["expectedDefaultsRevision"] = .number(defaultsRevision) }
        return fields
    }
    private func save() async {
        let path: String; var fields: [String: JSONValue]
        if kind == "providers" {
            path = "/providers"; fields = versioned(["name": .string(name), "endpoints": .array(endpoints.map(\.wire))])
            if let catalog = original?["catalogProvider"], !catalog.string.isEmpty { fields["catalogProvider"] = catalog }
        } else if kind == "models" {
            path = "/provider-models"; var overrides = original?["overrides"].object ?? [:]
            overrides["contextWindow"] = Double(context).map { .number($0) }
            overrides["maxOutputTokens"] = Double(maxOutput).map { .number($0) }
            overrides["reasoning"] = thinking == "auto" ? nil : .bool(thinking == "true")
            overrides["input"] = inputKind == "auto" ? nil : .array((inputKind == "image" ? ["text", "image"] : ["text"]).map { .string($0) })
            var pricing = overrides["pricing"]?.object ?? [:]; pricing["input"] = Double(inputPrice).map { .number($0) }; pricing["output"] = Double(outputPrice).map { .number($0) }
            overrides["pricing"] = pricing.isEmpty ? nil : .object(pricing)
            fields = versioned(["name": .string(name), "providerId": .string(provider), "endpointId": .string(endpoint), "model": .string(modelID), "overrides": .object(overrides)])
        } else { path = "/harness-bindings"; fields = bindingBody() }
        if await model.execute(path, values: fields) != nil { saved() }
    }
}
struct BindingDefaultsView: View {
    @Bindable var model: Workbench
    @State private var project = ""
    @State private var mapping: [String: String] = [:]
    @State private var expectedRevision: Double = 0
    private var projectRaw: HostProject? { model.snapshot?.projects.first { $0.id == project } }
    var body: some View {
        Group {
            Picker("默认值范围", selection: $project) { Text("当前电脑").tag(""); ForEach(model.snapshot?.projects ?? []) { Text($0.name).tag($0.id) } }
            ForEach(model.snapshot?.harnesses ?? []) { engine in Picker(engine.name, selection: Binding(get: { mapping[engine.id] ?? "" }, set: { mapping[engine.id] = $0 })) {
                Text(project.isEmpty ? "引擎原生默认" : "继承电脑默认").tag("")
                ForEach(Array((model.snapshot?.bindings?.filter { $0["harnessId"].string == engine.id } ?? []).enumerated()), id: \.offset) { _, row in Text(row["name"].string).tag(row["id"].string) }
            } }
            Button("保存默认绑定") { Task { await save() } }.disabled(!model.canWrite)
            Button("重新读取默认值") { loadDefaults() }.disabled(model.busy)
        }.onChange(of: project, initial: true) { _, _ in
            loadDefaults()
        }
    }
    private func loadDefaults() {
        let defaults = project.isEmpty ? model.snapshot?.bindingDefaults?["harnessBindingIds"].object ?? [:] : projectRaw?.bindingDefaults?.object ?? [:]
        mapping = defaults.mapValues(\.string)
        expectedRevision = project.isEmpty ? model.snapshot?.bindingDefaults?["revision"].number ?? 0 : Double(projectRaw?.configRevision ?? 0)
    }
    private func save() async {
        let values: [String: JSONValue] = ["expectedRevision": .number(expectedRevision), project.isEmpty ? "harnessBindingIds" : "bindingDefaults": .object(mapping.mapValues { $0.isEmpty ? .null : .string($0) })]
        if let result = await model.execute(project.isEmpty ? "/binding-defaults" : "/projects/\(project)/binding-defaults", method: "PATCH", values: values) { expectedRevision = result[project.isEmpty ? "revision" : "configRevision"].number ?? expectedRevision }
    }
}
struct EngineDefaultsView: View {
    @Bindable var model: Workbench
    let engine: HostHarness
    @State private var chosen = ""
    @State private var reasoning = ""
    @State private var permission = ""
    @State private var originalSettings: JSONValue?
    var body: some View {
        Form {
            TextField("默认模型（留空沿用引擎）", text: $chosen).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("默认思考强度（可选）", text: $reasoning)
            Picker("默认工具权限", selection: $permission) { Text("原生默认").tag(""); ForEach(permissionOptions(engine.id), id: \.0) { Text($0.1).tag($0.0) } }
            Button("保存默认值") { Task {
                guard var fields = originalSettings?.object else { return }
                var all = fields["harnessDefaults"]?.object ?? [:]; var defaults = all[engine.id]?.object ?? [:]
                defaults["model"] = chosen.isEmpty ? .null : .string(chosen); defaults["reasoning"] = reasoning.isEmpty ? .null : .string(reasoning); defaults["permissionMode"] = permission.isEmpty ? .null : .string(permission)
                all[engine.id] = .object(defaults); fields["harnessDefaults"] = .object(all)
                if let result = await model.execute("/app-settings", method: "PATCH", values: fields) { originalSettings = result }
            } }.disabled(!model.canWrite || originalSettings == nil || chosen.count > 200 || reasoning.count > 100)
            Button("重新读取默认值") { Task { originalSettings = await model.read("/app-settings"); loadValues() } }.disabled(model.busy)
            Text("与桌面共用默认值，用于新对话。").font(.footnote)
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
        }.navigationTitle(engine.name + " 默认值").onAppear {
            originalSettings = model.appSettings; loadValues()
        }
    }
    private func loadValues() {
        let defaults = originalSettings?["harnessDefaults"][engine.id]; chosen = defaults?["model"].string ?? ""; reasoning = defaults?["reasoning"].string ?? ""; permission = defaults?["permissionMode"].string ?? ""
    }
}

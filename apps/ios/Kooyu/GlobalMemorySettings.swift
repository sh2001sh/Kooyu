import SwiftUI

struct GlobalMemorySettingsView: View {
    @Bindable var model: Workbench
    @State private var settings: JSONValue?
    @State private var entries: [JSONValue] = []
    @State private var docs: [JSONValue] = []
    @State private var activeDocName = "SOUL.md"
    @State private var docDraft = ""
    @State private var docDirty = false
    @State private var loading = false
    @State private var saving = false
    @State private var editing = false
    @State private var selected: JSONValue = .null
    @State private var notice = ""

    private var activeDoc: JSONValue? {
        docs.first { $0["name"].string == activeDocName }
    }

    private func reload() async {
        loading = true
        settings = await model.read("/memory/settings")
        entries = await model.read("/memory")?.array.filter { $0["scope"].string == "user" } ?? []
        let loadedDocs = await model.read("/memory/docs")?.array ?? []
        docs = loadedDocs
        if !docDirty {
            docDraft = loadedDocs.first { $0["name"].string == activeDocName }?["content"].string ?? ""
        }
        loading = false
    }

    private func save(_ enabled: Bool, _ automatic: Bool) async {
        guard let settings else { return }
        saving = true
        let fields: [String: JSONValue] = ["expectedRevision": settings["revision"], "enabled": .bool(enabled), "automaticSaving": .bool(automatic)]
        if let result = await model.execute("/memory/settings", method: "PATCH", values: fields) { self.settings = result; notice = "已保存，下轮生效。" }
        saving = false
    }

    private func saveActiveDoc() async {
        guard let doc = activeDoc else { return }
        saving = true
        let fields: [String: JSONValue] = [
            "expectedRevision": doc["revision"],
            "content": .string(docDraft),
        ]
        if await model.execute("/memory/docs/\(activeDocName)", method: "PATCH", values: fields) != nil {
            docDirty = false
            notice = "\(activeDocName) 已保存，下轮生效。"
            await reload()
        }
        saving = false
    }

    var body: some View {
        Form {
            StatusView(model: model)

            if !docs.isEmpty {
                Section {
                    Picker("文档", selection: $activeDocName) {
                        Text("SOUL.md").tag("SOUL.md")
                        Text("USER.md").tag("USER.md")
                        Text("MEMORY.md").tag("MEMORY.md")
                        Text("RULES.md").tag("RULES.md")
                        Text("HEARTBEAT.md").tag("HEARTBEAT.md")
                        Text("AGENTS.md").tag("AGENTS.md")
                        Text("ROUTING.md").tag("ROUTING.md")
                    }
                    .pickerStyle(.menu)
                    .onChange(of: activeDocName) { _, next in
                        docDraft = docs.first { $0["name"].string == next }?["content"].string ?? ""
                        docDirty = false
                    }

                    TextEditor(text: $docDraft)
                        .font(KYFont.mono)
                        .foregroundStyle(KY.text)
                        .frame(minHeight: 160)
                        .disabled(!model.canWrite || saving || loading)
                        .onChange(of: docDraft) { _, next in
                            docDirty = next != (activeDoc?["content"].string ?? "")
                        }

                    Button {
                        Task { await saveActiveDoc() }
                    } label: {
                        HStack {
                            Spacer()
                            if saving {
                                ProgressView().tint(KY.onAccent)
                            } else {
                                Text("保存 \(activeDocName)")
                            }
                            Spacer()
                        }
                    }
                    .buttonStyle(.kooyuPrimary)
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .disabled(!model.canWrite || saving || loading || !docDirty)
                } header: {
                    Text("主代理文档 · SOUL.md & MEMORY.md")
                } footer: {
                    Text("保存后自动写入本机 Host 目录，并在下一轮对话即时热加载。")
                        .foregroundStyle(KY.textSecondary)
                }
            }

            Section {
                if loading { ProgressView("正在读取全局记忆…") }
                if let settings {
                    Toggle("启用全局记忆", isOn: Binding(get: { settings["enabled"].boolean }, set: { value in Task { await save(value, settings["automaticSaving"].boolean) } }))
                        .disabled(!model.canWrite || saving || loading)
                    Toggle("自动保存对话记忆", isOn: Binding(get: { settings["automaticSaving"].boolean }, set: { value in Task { await save(settings["enabled"].boolean, value) } }))
                        .disabled(!model.canWrite || !settings["enabled"].boolean || saving || loading)
                }
                Button("刷新全局记忆") { Task { await reload() } }.disabled(loading || saving)
                if !notice.isEmpty { Text(notice).foregroundStyle(KY.textSecondary) }
            } header: { Text("记忆偏好") } footer: {
                Text("Kooyu 主对话使用并形成跨项目偏好，同一设备的桌面与已配对手机共用。关闭自动保存后，新记忆仅作为待确认建议；关闭全局记忆后保留已有内容。")
            }
            Section {
                Button("新增记忆", systemImage: "plus") { selected = .null; editing = true }.disabled(!model.canWrite || loading || saving)
                if !loading && settings != nil && entries.isEmpty { Text("还没有全局记忆。").foregroundStyle(KY.textSecondary) }
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(entry["subject"].string).font(.headline)
                        Text(entry["status"].string == "confirmed" ? "已确认 · 下轮使用" : "待确认 · 尚未使用").font(.caption).foregroundStyle(KY.textSecondary)
                        Text(entry["content"].string)
                        DisclosureGroup("查看来源") { ForEach(Array(entry["sourceRefs"].array.enumerated()), id: \.offset) { _, ref in Text(ref.string).font(.caption).textSelection(.enabled) } }
                        Button(entry["status"].string == "confirmed" ? "编辑记忆" : "查看并确认") { selected = entry; editing = true }.disabled(!model.canWrite || saving)
                    }
                }
            } header: { Text("已保存的全局记忆") } footer: { Text("可在对话中说“记住我偏好……”或“忘记……”。项目资料放在项目约定，临时进度不进入全局记忆。") }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(KY.destructive) }
        }
        .navigationTitle("人格与记忆")
        .task(id: model.connection?.hostId) { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $editing, onDismiss: { Task { await reload() } }) { WorkMemoryEditor(model: model, memory: selected, project: "") }
    }
}

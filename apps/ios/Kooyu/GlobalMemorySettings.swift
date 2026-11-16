import SwiftUI

struct GlobalMemorySettingsView: View {
    @Bindable var model: Workbench
    @State private var settings: JSONValue?
    @State private var entries: [JSONValue] = []
    @State private var loading = false
    @State private var saving = false
    @State private var editing = false
    @State private var selected: JSONValue = .null
    @State private var notice = ""
    private func reload() async {
        loading = true
        settings = await model.read("/memory/settings")
        entries = await model.read("/memory")?.array.filter { $0["scope"].string == "user" } ?? []
        loading = false
    }
    private func save(_ enabled: Bool, _ automatic: Bool) async {
        guard let settings else { return }
        saving = true
        let fields: [String: JSONValue] = ["expectedRevision": settings["revision"], "enabled": .bool(enabled), "automaticSaving": .bool(automatic)]
        if let result = await model.execute("/memory/settings", method: "PATCH", values: fields) { self.settings = result; notice = "已保存，下轮生效。" }
        saving = false
    }
    var body: some View {
        Form {
            StatusView(model: model)
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
        .navigationTitle("全局记忆")
        .task(id: model.connection?.hostId) { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $editing, onDismiss: { Task { await reload() } }) { WorkMemoryEditor(model: model, memory: selected, project: "") }
    }
}

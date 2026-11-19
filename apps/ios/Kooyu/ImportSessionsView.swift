import SwiftUI

private struct NativeImportCandidateItem: Identifiable, Sendable {
    let harnessId: String
    let nativeSessionId: String
    let title: String
    let cwd: String?
    let projectId: String?
    let workspaceId: String?
    let model: String?
    let updatedAt: String?
    let alreadyImported: Bool
    let existingSessionId: String?

    var id: String { "\(harnessId):\(nativeSessionId)" }

    init(json: JSONValue) {
        harnessId = json["harnessId"].string
        nativeSessionId = json["nativeSessionId"].string
        let rawTitle = json["title"].string
        title = rawTitle.isEmpty ? String(nativeSessionId.prefix(8)) : rawTitle
        cwd = json["cwd"].string.nonEmpty
        projectId = json["projectId"].string.nonEmpty
        workspaceId = json["workspaceId"].string.nonEmpty
        model = json["model"].string.nonEmpty
        updatedAt = json["updatedAt"].string.nonEmpty ?? json["createdAt"].string.nonEmpty
        alreadyImported = json["alreadyImported"].boolean == true
        existingSessionId = json["existingSessionId"].string.nonEmpty
    }
}

struct ImportSessionsView: View {
    @Bindable var model: Workbench
    @State private var projectFilter = ""
    @State private var harnessFilter = ""
    @State private var candidates: [NativeImportCandidateItem] = []
    @State private var selected: Set<String> = []
    @State private var loading = false
    @State private var importing = false
    @State private var statusBanner = ""

    private var importable: [NativeImportCandidateItem] {
        candidates.filter { !$0.alreadyImported }
    }

    var body: some View {
        let _ = LanguageStore.shared.revision
        List {
            Section {
                Picker(kooyuT("import.allProjects"), selection: $projectFilter) {
                    Text(kooyuT("import.allProjects")).tag("")
                    ForEach(model.snapshot?.projects ?? []) { p in
                        Text(p.name).tag(p.id)
                    }
                }
                Picker(kooyuT("import.allEngines"), selection: $harnessFilter) {
                    Text(kooyuT("import.allEngines")).tag("")
                    ForEach((model.snapshot?.harnesses ?? []).filter { $0.id != "cursor" }) { h in
                        Text(h.name).tag(h.id)
                    }
                }
            }

            if !statusBanner.isEmpty {
                Section {
                    Label(statusBanner, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(KY.success)
                }
            }

            Section {
                if loading && candidates.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(kooyuT("import.scanning")).foregroundStyle(.secondary)
                    }
                } else if candidates.isEmpty {
                    Text(kooyuT("import.empty")).foregroundStyle(.secondary)
                } else {
                    ForEach(candidates) { item in
                        let checked = selected.contains(item.id)
                        Button {
                            guard !item.alreadyImported else { return }
                            if checked { selected.remove(item.id) } else { selected.insert(item.id) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: item.alreadyImported ? "checkmark.circle.fill" : checked ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(item.alreadyImported ? KY.success : checked ? Color.accentColor : .secondary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    let projectName = item.projectId.flatMap { pid in model.snapshot?.projects.first { $0.id == pid }?.name } ?? kooyuT("import.unassigned")
                                    Text([item.harnessId, projectName, item.updatedAt.map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") }].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                if item.alreadyImported {
                                    Text(kooyuT("import.importedTag"))
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 2)
                                        .background(KY.success.opacity(0.14), in: Capsule())
                                        .foregroundStyle(KY.success)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } header: {
                HStack {
                    Text("\(selected.count) / \(importable.count)")
                    Spacer()
                    if !importable.isEmpty {
                        Button(selected.count == importable.count ? kooyuT("import.clear") : kooyuT("import.selectAll")) {
                            if selected.count == importable.count { selected.removeAll() }
                            else { selected = Set(importable.map(\.id)) }
                        }
                        .font(.caption)
                    }
                }
            }
        }
        .navigationTitle(kooyuT("import.title"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await scan() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading)
            }
            ToolbarItem(placement: .bottomBar) {
                Button {
                    Task { await performImport() }
                } label: {
                    Text(importing ? kooyuT("import.importing") : "\(kooyuT("import.importBtn")) (\(selected.count))")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.canWrite || selected.isEmpty || importing)
            }
        }
        .task(id: "\(model.connection?.hostId ?? "")|\(projectFilter)|\(harnessFilter)") {
            await scan()
        }
    }

    private func scan() async {
        loading = true; defer { loading = false }
        var parts: [String] = []
        if !projectFilter.isEmpty, let enc = projectFilter.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            parts.append("projectId=\(enc)")
        }
        if !harnessFilter.isEmpty, let enc = harnessFilter.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            parts.append("harnessId=\(enc)")
        }
        let path = "/native-imports" + (parts.isEmpty ? "" : "?" + parts.joined(separator: "&"))
        if let res = await model.read(path) {
            let list = res["candidates"].array.map(NativeImportCandidateItem.init)
            candidates = list
            let valid = Set(list.filter { !$0.alreadyImported }.map(\.id))
            selected = selected.intersection(valid)
        }
    }

    private func performImport() async {
        let chosen = candidates.filter { !$0.alreadyImported && selected.contains($0.id) }
        guard !chosen.isEmpty else { return }
        importing = true; defer { importing = false }
        let items: [JSONValue] = chosen.map { item in
            var obj: [String: JSONValue] = [
                "harnessId": .string(item.harnessId),
                "nativeSessionId": .string(item.nativeSessionId),
                "title": .string(item.title),
            ]
            if let cwd = item.cwd { obj["cwd"] = .string(cwd) }
            if let pid = item.projectId { obj["projectId"] = .string(pid) }
            if let wid = item.workspaceId { obj["workspaceId"] = .string(wid) }
            if let m = item.model { obj["model"] = .string(m) }
            return .object(obj)
        }
        var payload: [String: JSONValue] = ["items": .array(items)]
        if !projectFilter.isEmpty { payload["projectId"] = .string(projectFilter) }
        if let res = await model.execute("/native-imports", method: "POST", values: payload) {
            let count = res["imported"].array.count
            statusBanner = "\(kooyuT("import.done")) (\(count))"
            selected.removeAll()
            await model.refresh()
            await scan()
        }
    }
}

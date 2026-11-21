import SwiftUI

private func compareSemver(_ a: String, _ b: String) -> Int {
    let pa = a.replacingOccurrences(of: "v", with: "").split(separator: "-").first?.split(separator: ".").compactMap { Int($0) } ?? [0, 0, 0]
    let pb = b.replacingOccurrences(of: "v", with: "").split(separator: "-").first?.split(separator: ".").compactMap { Int($0) } ?? [0, 0, 0]
    for i in 0..<3 {
        let va = i < pa.count ? pa[i] : 0
        let vb = i < pb.count ? pb[i] : 0
        if va != vb { return va > vb ? 1 : -1 }
    }
    return 0
}

struct AppUpdateView: View {
    @Bindable var model: Workbench
    @State private var channel = "stable"
    @State private var checking = false
    @State private var hostVersion = ""
    @State private var latestVersion = ""
    @State private var latestTag = ""
    @State private var latestTitle = ""
    @State private var latestNotes = ""
    @State private var latestUrl = ""
    @State private var updateAvailable = false
    @State private var checked = false
    @State private var error = ""

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.2.1"
    }

    var body: some View {
        let _ = LanguageStore.shared.revision
        Form {
            Section {
                LabeledContent(kooyuT("settings.version"), value: "V\(appVersion)")
                if !hostVersion.isEmpty {
                    LabeledContent(kooyuT("update.hostVersion"), value: "V\(hostVersion)")
                }
                Picker(kooyuT("update.channel"), selection: $channel) {
                    Text(kooyuT("update.channel.stable")).tag("stable")
                    Text(kooyuT("update.channel.preview")).tag("preview")
                }
                .onChange(of: channel) { _, _ in
                    Task { await check() }
                }

                Button {
                    Task { await check() }
                } label: {
                    HStack {
                        Text(checking ? kooyuT("update.checking") : kooyuT("update.check"))
                        Spacer()
                        if checking { ProgressView() }
                    }
                }
                .disabled(checking)
            }

            if !error.isEmpty {
                Section {
                    Text(error).font(.footnote).foregroundStyle(KY.destructive)
                }
            }

            if checked && error.isEmpty {
                Section {
                    if updateAvailable && !latestVersion.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("\(kooyuT("update.available")) V\(latestVersion)", systemImage: "sparkles")
                                .font(.headline)
                                .foregroundStyle(KY.brandCoral)
                            if !latestTitle.isEmpty {
                                Text(latestTitle).font(.subheadline.weight(.medium))
                            }
                            if !latestNotes.isEmpty {
                                Text(latestNotes)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)

                        if let url = URL(string: latestUrl) {
                            Link(destination: url) {
                                Label(kooyuT("update.openRelease"), systemImage: "arrow.up.right.square")
                                    .font(.body.weight(.medium))
                            }
                        }
                    } else {
                        Label(kooyuT("update.upToDate"), systemImage: "checkmark.circle.fill")
                            .foregroundStyle(KY.success)
                    }
                }
            }
        }
        .navigationTitle(kooyuT("update.title"))
        .task { await check() }
    }

    private func check() async {
        guard !checking else { return }
        checking = true; error = ""
        defer { checking = false }

        if model.online, let res = await model.execute("/app-update/check", method: "POST", values: ["channel": .string(channel)], refreshAfter: false) {
            hostVersion = res["currentVersion"].string
            let latest = res["latest"]
            latestVersion = latest["version"].string
            latestTag = latest["tag"].string
            latestTitle = latest["title"].string
            latestNotes = latest["notes"].string
            latestUrl = latest["htmlUrl"].string
            updateAvailable = res["updateAvailable"].boolean || (!latestVersion.isEmpty && compareSemver(latestVersion, appVersion) > 0)
            error = res["error"].string
            checked = true
            return
        }

        // Fallback directly to GitHub Releases when Host is offline.
        guard let url = URL(string: "https://api.github.com/repos/sh2001sh/Kooyu/releases?per_page=10") else { return }
        var req = URLRequest(url: url)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Kooyu-iOS/\(appVersion)", forHTTPHeaderField: "User-Agent")
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                error = "GitHub API HTTP \(http.statusCode)"
                return
            }
            let list = try JSONDecoder().decode(JSONValue.self, from: data).array
            for item in list {
                if item["draft"].boolean { continue }
                let prerelease = item["prerelease"].boolean
                if channel == "stable" && prerelease { continue }
                let tag = item["tag_name"].string
                let version = tag.replacingOccurrences(of: "v", with: "").replacingOccurrences(of: "preview-", with: "").split(separator: "-").first.map(String.init) ?? ""
                guard !version.isEmpty else { continue }
                latestTag = tag
                latestVersion = version
                latestTitle = item["name"].string
                latestNotes = item["body"].string
                latestUrl = item["html_url"].string
                updateAvailable = compareSemver(version, appVersion) > 0 || (channel == "preview" && prerelease && compareSemver(version, appVersion) >= 0)
                checked = true
                return
            }
            updateAvailable = false
            checked = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}

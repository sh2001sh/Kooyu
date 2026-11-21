import SwiftUI

struct BarkSettingsSection: View {
    let connection: Connection
    let online: Bool
    @State private var endpoint = ""
    @State private var channel: JSONValue?
    @State private var loaded = false
    @State private var working = false
    @State private var problem = ""

    var body: some View {
        Section {
            if channel?["enabled"].boolean == true {
                HStack(spacing: 8) {
                    Text("状态")
                        .foregroundStyle(KY.text)
                    Spacer()
                    HStack(spacing: 5) {
                        Circle()
                            .fill(KY.success)
                            .frame(width: 7, height: 7)
                        Text("已启用")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(KY.doneText)
                    }
                }
            }
            SecureField("Bark 设备 HTTPS 地址", text: $endpoint)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
            Button {
                Task { await save() }
            } label: {
                HStack {
                    Spacer()
                    if working {
                        ProgressView().tint(KY.onAccent)
                    } else {
                        Text(channel == nil ? "启用 Bark 提醒" : "更新设备地址")
                    }
                    Spacer()
                }
            }
            .buttonStyle(.kooyuPrimary)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .disabled(!loaded || !online || working || endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if channel != nil {
                Button("移除 Bark 提醒", role: .destructive) {
                    Task { await remove() }
                }
                .foregroundStyle(KY.destructive)
                .disabled(!online || working)
            }
            if !problem.isEmpty {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(KY.destructive)
                Button("刷新配置") { Task { await refresh() } }
                    .foregroundStyle(KY.text)
                    .disabled(!online || working)
            }
        } header: {
            Text("Bark 提醒")
        } footer: {
            Text("任务完成、需要审批或遇到异常时通过 Bark 推送到手机。")
                .foregroundStyle(KY.textSecondary)
        }
        .task(id: online) { if online { await refresh() } }
    }

    @MainActor private func refresh() async {
        do {
            let channels: [JSONValue] = try await HostAPI(connection: connection).get("/notification-channels")
            channel = channels.first { $0["kind"].string == "bark" && $0["deviceId"].string == connection.deviceId }
            loaded = true
            problem = ""
        } catch { loaded = false; problem = "无法读取 Bark 配置。" }
    }

    @MainActor private func save() async {
        guard !working else { return }
        working = true
        defer { working = false }
        do {
            channel = try await HostAPI(connection: connection).perform("/notification-channels", method: "PUT", body: .object([
                "kind": .string("bark"), "enabled": .bool(true), "preview": .bool(false),
                "endpoint": .string(endpoint.trimmingCharacters(in: .whitespacesAndNewlines)),
                "expectedRevision": .number(channel?["revision"].number ?? 0)
            ])) as JSONValue
            endpoint = ""
            problem = ""
        } catch { problem = "Host 未确认更新。请核对设备地址，或刷新配置后重试。" }
    }

    @MainActor private func remove() async {
        guard !working, let channel else { return }
        working = true
        defer { working = false }
        do {
            let id = channel["id"].string.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
            let _: JSONValue = try await HostAPI(connection: connection).perform("/notification-channels/" + id, method: "DELETE")
            self.channel = nil
            endpoint = ""
            problem = ""
        } catch { problem = "Host 未确认移除，请刷新配置后重试。" }
    }
}

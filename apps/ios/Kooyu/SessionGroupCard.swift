import SwiftUI

/// Home-screen building blocks for §5.1-A: inset-grouped session rows with the coral selection bar,
/// the pinned L0 `Kooyu 主对话` card, the merged connection pill and the search + archive row.

/// Two-line session row: [engine badge] title / [dot + status word] · model or project.
struct SessionRowView: View {
    let session: HostSession
    var detail: String = ""
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            EngineBadge(harnessId: session.harnessId, size: 28, circle: false)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if session.pinned == true {
                        Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(KY.textTertiary)
                            .accessibilityLabel("已置顶")
                    }
                    Text(session.title.isEmpty ? "未命名对话" : session.title)
                        .font(KYFont.rowTitle).foregroundStyle(KY.text).lineLimit(1)
                }
                HStack(spacing: 5) {
                    StatusBadge(status: sessionStatus(session))
                    if !detail.isEmpty {
                        Text("·").foregroundStyle(KY.textTertiary)
                        Text(detail).lineLimit(1).truncationMode(.middle)
                    }
                }
                .font(KYFont.caption)
                .foregroundStyle(KY.textSecondary)
            }
            .alignmentGuide(.listRowSeparatorLeading) { d in d[.leading] }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Row background with the 3 pt coral bar and subtle monochrome tint for the active / most recently opened session.
struct SessionRowBackground: View {
    let selected: Bool
    var body: some View {
        ZStack(alignment: .leading) {
            KY.raised
            if selected {
                KY.accentTint
                Capsule().fill(KY.brandCoral).frame(width: 3).padding(.vertical, 9).padding(.leading, 3)
            }
        }
        .animation(KYMotion.snap, value: selected)
    }
}

/// Compact pinned L0 row for `Kooyu 主对话` (aligned 1:1 with Web Mobile & Android so conversations start high).
struct SupervisorCard: View {
    let session: HostSession?
    let selected: Bool
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        HStack(alignment: .center, spacing: 11) {
            EngineBadge(harnessId: "kodo", size: 34, circle: false)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("Kooyu 主对话")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KY.text)
                        .lineLimit(1)
                    Text("全局主控")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(KY.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(KY.sunken, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                    Spacer(minLength: 4)
                    if let session {
                        StatusBadge(status: sessionStatus(session))
                    } else {
                        Text("点击开启").font(KYFont.caption).foregroundStyle(KY.textTertiary)
                    }
                }
                Text("统筹项目进展与自动计划")
                    .font(.system(size: 12))
                    .foregroundStyle(KY.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? KY.accentTint : KY.raised, in: shape)
        .overlay(shape.strokeBorder(selected ? KY.borderStrong : KY.borderSubtle, lineWidth: 0.5))
        .contentShape(shape)
        .animation(KYMotion.snap, value: selected)
        .accessibilityElement(children: .combine)
        .accessibilityHint(session == nil ? "新建 Kooyu 主对话" : "打开 Kooyu 主对话")
    }
}

/// Native toolbar Inbox trigger with crisp coral unread badge (replaces hardcoded `.overlay(trailing: 96)`).
struct InboxToolbarButton: View {
    let count: Int
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "tray")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KY.text)
                    .frame(width: 32, height: 32)
                    .background(KY.raised, in: Circle())
                    .overlay(Circle().strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                if count > 0 {
                    Text(count > 99 ? "99+" : "\(count)")
                        .font(.system(size: 9.5, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(KY.brandCoral, in: Capsule())
                        .offset(x: 4, y: -4)
                }
            }
            .frame(minWidth: 36, minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kooyuPress)
        .accessibilityLabel(count > 0 ? "待办收件箱，\(count) 项待处理" : "待办收件箱")
    }
}

/// Device pill for the slim top bar. Online: green dot + host name. Offline: amber pulsing dot and
/// "离线 · 点击重连", replacing the old full-width offline banner on the conversation list.
struct ConnectionPill: View {
    @Bindable var model: Workbench
    var body: some View {
        Menu {
            if !model.online {
                Button { Task { await model.refresh() } } label: { Label("立即重连", systemImage: "arrow.clockwise") }
            }
            Section("已配对设备") {
                ForEach(model.book.devices) { device in
                    Button { model.switchDevice(device.hostId) } label: {
                        if device.hostId == model.connection?.hostId {
                            Label(device.displayName, systemImage: "checkmark")
                        } else {
                            Text(device.displayName)
                        }
                    }
                }
            }
            Button { model.addingDevice = true } label: { Label("添加设备 / 重新配对", systemImage: "qrcode.viewfinder") }
        } label: {
            HStack(spacing: 6) {
                StatusDot(color: model.online ? KY.success : KY.info, pulse: !model.online, size: 7)
                Text(model.online ? (model.connection?.displayName ?? "设备") : "离线 · 点击重连")
                    .font(KYFont.label).foregroundStyle(KY.text).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(KY.textTertiary)
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(KY.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(model.online ? KY.border : KY.info.opacity(0.45)))
            .frame(maxWidth: 200)
        }
        .disabled(model.busy)
        .accessibilityLabel(model.online ? "当前设备 \(model.connection?.displayName ?? "")，已连接" : "设备离线，点击重连")
    }
}

/// Compact Spotlight search bar (matches Web Mobile & Android 38pt height).
struct SessionSearchBar: View {
    @Binding var text: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium)).foregroundStyle(KY.textTertiary)
                .accessibilityHidden(true)
            TextField("搜索会话、项目或引擎…", text: $text)
                .font(.system(size: 14)).foregroundStyle(KY.text)
                .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(KY.textTertiary) }
                    .buttonStyle(.plain).accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 11)
        .frame(height: 38)
        .background(KY.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.borderSubtle, lineWidth: 0.5))
    }
}

/// Collapsible group header: chevron, optional engine badge, title, count, active count, trailing accessory.
struct SessionGroupHeader<Accessory: View>: View {
    let title: String
    var harnessId: String? = nil
    let count: Int
    var active: Int = 0
    let collapsed: Bool
    let toggle: () -> Void
    @ViewBuilder var accessory: () -> Accessory
    var body: some View {
        HStack(spacing: 6) {
            Button(action: toggle) {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(KY.textTertiary)
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                    if let harnessId { EngineBadge(harnessId: harnessId, size: 18, circle: false) }
                    Text(title).font(KYFont.sectionHeader).foregroundStyle(KY.textSecondary).lineLimit(1)
                    Text("\(count)").font(KYFont.caption).foregroundStyle(KY.textTertiary)
                    if active > 0 { StatusBadge(status: SessionStatus(label: "\(active) 活跃", tone: .running)) }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(title)，\(count) 个会话，\(collapsed ? "已折叠" : "已展开")")
            Spacer(minLength: 0)
            accessory()
        }
        .textCase(nil)
    }
}

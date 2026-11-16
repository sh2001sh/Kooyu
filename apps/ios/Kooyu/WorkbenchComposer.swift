import SwiftUI

func composerSendMode(_ runState: String) -> String { runState == "idle" ? "new" : "queue" }

struct ComposerPill: View {
    let title: String
    var icon: String? = nil
    var expandable = true
    var selected = false
    var compact = false
    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon).imageScale(.small) }
            Text(title).lineLimit(1).truncationMode(.middle)
            if expandable { Image(systemName: "chevron.down").font(.caption2) }
        }
        .font(.subheadline).foregroundStyle(KY.textSecondary)
        .padding(.horizontal, 8).frame(minHeight: 44).frame(maxWidth: compact ? nil : 230)
        .background(selected ? KY.sunken : .clear, in: Capsule())
        .contentShape(Rectangle())
    }
}

struct WorkbenchComposer<Left: View, Right: View>: View {
    @Binding var text: String
    let placeholder: String
    var enabled = true
    var sendEnabled = false
    var stop = false
    var stopEnabled = false
    var uploading = false
    var error = ""
    var attachments: [ManagedAttachment] = []
    var remove: (String) -> Void = { _ in }
    var submit: () -> Void
    var cancel: () -> Void = {}
    @ViewBuilder var left: () -> Left
    @ViewBuilder var right: () -> Right
    private var action: some View {
        let active = stop ? stopEnabled : sendEnabled
        return Button(action: stop ? cancel : submit) {
            Image(systemName: stop ? "stop.fill" : "arrow.up")
                .font(.body.weight(.semibold)).foregroundStyle(active ? KY.onAccent : KY.textTertiary)
                .frame(width: 36, height: 36).background(active ? KY.accent : KY.sunken, in: Circle())
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(!active).accessibilityLabel(stop ? "停止当前回合" : "发送消息")
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            right().frame(maxWidth: .infinity, alignment: .leading)
            input
        }
    }
    private var input: some View {
        VStack(alignment: .leading, spacing: 4) {
            if uploading { ProgressView().progressViewStyle(.linear) }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(KY.destructive) }
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(attachments) { file in
                            HStack {
                                Text(file.name).font(.caption).lineLimit(1)
                                Button { remove(file.id) } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                                    .buttonStyle(.plain).disabled(!enabled).accessibilityLabel("移除 \(file.name)")
                            }.padding(.leading, 8).background(KY.sunken, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
            }
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.body).foregroundStyle(KY.text).lineLimit(2...7).disabled(!enabled)
                .frame(minHeight: 80, alignment: .topLeading).padding(.horizontal, 8).padding(.top, 8)
                .accessibilityLabel("消息")
            HStack(spacing: 4) {
                ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 4) { left() } }
                action
            }
        }
        .padding(12).background(KY.raised, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(KY.borderSubtle))
    }
}

struct ComposerWelcome: View {
    let title: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ZStack {
            Image(scheme == .dark ? "ComposerAuraDark" : "ComposerAuraLight").resizable().scaledToFit().opacity(scheme == .dark ? 0.35 : 0.22)
                .accessibilityHidden(true)
            VStack(spacing: 22) {
                Image("KooyuMark").resizable().scaledToFit().frame(width: 38, height: 38).padding(16)
                    .background(KY.raised, in: RoundedRectangle(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(KY.borderSubtle))
                    .accessibilityLabel("Kooyu")
                Text(title).font(.largeTitle.bold()).multilineTextAlignment(.center).foregroundStyle(KY.text)
            }.padding(24)
        }.frame(maxWidth: .infinity)
    }
}

struct ComposerReasoningPicker: View {
    let levels: [String]
    let current: String
    let loading: Bool
    let error: String
    var enabled = true
    var refresh: () async -> Void
    var choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                if loading { ProgressView().accessibilityLabel("正在读取思考档位") }
                if !error.isEmpty { Text(error).foregroundStyle(KY.destructive) }
                Section {
                    option("", "默认思考")
                    ForEach(levels, id: \.self) { option($0, $0) }
                } footer: {
                    Text(!loading && levels.isEmpty ? "当前模型未提供可选思考档位。可刷新选项，或在模型配置中选择支持的模型。" : "此设置将在下一回合生效。")
                }
            }
            .navigationTitle("思考强度").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("刷新选项").disabled(loading) }
            }
            .refreshable { await refresh() }.task { await refresh() }
        }.tint(KY.text)
    }
    private func option(_ value: String, _ label: String) -> some View {
        Button { choose(value) } label: {
            HStack { Text(label); Spacer(); if current == value { Image(systemName: "checkmark").accessibilityLabel("已选择") } }
        }.disabled(loading || !enabled)
    }
}

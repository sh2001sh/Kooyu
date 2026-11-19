import SwiftUI

func composerSendMode(_ runState: String) -> String { runState == "idle" ? "new" : "queue" }

struct ComposerPill: View {
    let title: String
    var icon: String? = nil
    var expandable = true
    var selected = false
    var compact = false
    var harnessId: String? = nil
    var body: some View {
        HStack(spacing: 5) {
            if let harnessId {
                EngineBadge(harnessId: harnessId, size: 16)
            } else if let icon {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            }
            Text(title).lineLimit(1).truncationMode(.middle)
            if expandable { Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold)) }
        }
        .font(KYFont.label)
        .foregroundStyle(selected ? KY.text : KY.textSecondary)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .frame(maxWidth: compact ? nil : 200)
        .background(selected ? KY.accentTint : KY.raised, in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? KY.borderStrong : KY.border))
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// Unified iOS / ChatGPT Spacious Composer Pod:
/// [+] left, horizontally scrollable edge-faded parameter rail ([模型 ▾] [思考 ▾] [权限 ▾]),
/// and monochrome morphing (↑)/(■) action button on right (≥44pt touch targets).
struct WorkbenchComposer: View {
    @Binding var text: String
    let placeholder: String
    var enabled = true
    var sendEnabled = false
    var stop = false
    var stopEnabled = false
    var stopAccessibilityLabel = "中断当前回合"
    var uploading = false
    var error = ""
    var attachments: [ManagedAttachment] = []
    var remove: (String) -> Void = { _ in }
    var submit: () -> Void
    var cancel: () -> Void = {}
    var autoFocus = false
    var onPlus: () -> Void = {}
    var plusCount: Int = 0
    var plusEnabled: Bool = true
    var modelSummary: String = "原生默认"
    var modelEnabled: Bool = true
    var harnessId: String? = nil
    var onModel: () -> Void = {}
    var reasoningSummary: String? = nil
    var onReasoning: (() -> Void)? = nil
    var permissionSummary: String? = nil
    var onPermission: (() -> Void)? = nil
    @FocusState private var focused: Bool
    @State private var voice = VoiceInputController()

    private var voiceButton: some View {
        let active = voice.listening
        let label = active ? kooyuT("voice.stop") : kooyuT("voice.start")
        return Button {
            voice.toggle { spoken in
                text = appendVoiceTranscript(text, addition: spoken)
            }
        } label: {
            ZStack {
                Circle()
                    .fill(active ? KY.brandCoral : KY.sunken)
                    .frame(width: 36, height: 36)
                    .overlay(Circle().strokeBorder(active ? Color.clear : KY.borderSubtle, lineWidth: 0.5))
                Image(systemName: active ? "stop.fill" : "mic")
                    .font(.system(size: active ? 12 : 15, weight: .semibold))
                    .foregroundStyle(active ? Color.white : (enabled ? KY.textSecondary : KY.textTertiary))
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kooyuPress)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    @ViewBuilder private var voiceStrip: some View {
        if voice.listening {
            HStack(spacing: 8) {
                HStack(spacing: 2.5) {
                    ForEach(Array([0.55, 0.85, 1.0, 0.75, 0.5].enumerated()), id: \.offset) { _, factor in
                        Capsule()
                            .fill(KY.brandCoral)
                            .frame(width: 2.5, height: max(4, min(14, CGFloat(voice.level) * 14 * factor)))
                    }
                }
                .frame(height: 16)
                Text(voice.interim.isEmpty ? kooyuT("voice.listening") : voice.interim)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(KY.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                Button { voice.cancel() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(KY.textSecondary)
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(kooyuT("voice.cancel"))
                Button { voice.stop() } label: {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(KY.onAccent)
                        .frame(width: 24, height: 24)
                        .background(KY.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(kooyuT("voice.stop"))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(KY.brandCoralTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.brandCoral.opacity(0.28), lineWidth: 0.5))
            .padding(.horizontal, 12)
            .padding(.top, 10)
        } else if !voice.error.isEmpty {
            HStack(spacing: 6) {
                Text(voice.error).font(.caption).foregroundStyle(KY.destructive)
                Spacer()
                Button { voice.clearError() } label: {
                    Image(systemName: "xmark").font(.caption2).foregroundStyle(KY.destructive)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
    }

    /// Empty: muted circle. Typed: monochrome ink circle morphs crisply (KYMotion.morph). Running: rounded square Stop.
    private var action: some View {
        let active = stop ? stopEnabled : sendEnabled
        return Button(action: stop ? cancel : submit) {
            ZStack {
                RoundedRectangle(cornerRadius: stop ? 11 : 18, style: .continuous)
                    .fill(active ? KY.accent : KY.sunken)
                    .frame(width: 36, height: 36)
                Image(systemName: stop ? "stop.fill" : "arrow.up")
                    .font(.system(size: stop ? 13 : 15, weight: .bold))
                    .foregroundStyle(active ? KY.onAccent : KY.textTertiary)
                    .contentTransition(.symbolEffect(.replace))
            }
            .scaleEffect(active ? 1 : 0.92)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(KooyuPressStyle(scale: 0.94, dims: false))
        .disabled(!active)
        .animation(KYMotion.morph, value: active)
        .animation(KYMotion.morph, value: stop)
        .sensoryFeedback(.impact(weight: .light), trigger: active) { old, new in !old && new }
        .accessibilityLabel(stop ? stopAccessibilityLabel : "发送消息")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if uploading { ProgressView().progressViewStyle(.linear).tint(KY.text) }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(KY.destructive) }
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(attachments) { file in
                            HStack {
                                Image(systemName: "paperclip").font(.caption).foregroundStyle(KY.textTertiary)
                                Text(file.name).font(.caption).lineLimit(1)
                                Button { remove(file.id) } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                                    .buttonStyle(.plain).disabled(!enabled).accessibilityLabel("移除 \(file.name)")
                            }
                            .padding(.leading, 8)
                            .background(KY.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }
            }
            pod
        }
        .task {
            guard autoFocus else { return }
            try? await Task.sleep(for: .milliseconds(350))
            if !Task.isCancelled { focused = true }
        }
    }

    private var pod: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        return VStack(alignment: .leading, spacing: 4) {
            voiceStrip
            TextField(placeholder, text: $text, axis: .vertical)
                .font(KYFont.body)
                .foregroundStyle(KY.text)
                .lineLimit(1...6)
                .disabled(!enabled)
                .focused($focused)
                .padding(.horizontal, 15)
                .padding(.top, 13)
                .padding(.bottom, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("消息")

            HStack(alignment: .bottom, spacing: 4) {
                Button(action: onPlus) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(plusEnabled ? KY.text : KY.textTertiary)
                            .frame(width: 36, height: 36)
                            .background(KY.sunken, in: Circle())
                            .overlay(Circle().strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                        if plusCount > 0 {
                            Text("\(plusCount)")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(Color.white)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 15, minHeight: 15)
                                .background(KY.brandCoral, in: Capsule())
                                .offset(x: 3, y: -3)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.kooyuPress)
                .disabled(!plusEnabled)
                .accessibilityLabel(plusCount > 0 ? "附加文件与会话选项，已添加 \(plusCount) 个附件" : "附加文件与会话选项")

                ComposerChipFlowLayout(spacing: 5, lineSpacing: 5) {
                    Button(action: onModel) {
                        HStack(spacing: 4) {
                            if let harnessId {
                                EngineBadge(harnessId: harnessId, size: 14, circle: false)
                            } else {
                                Image(systemName: "cpu").font(.system(size: 11, weight: .semibold))
                            }
                            Text(modelSummary)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(KY.text)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8.5, weight: .bold))
                                .foregroundStyle(KY.textTertiary)
                        }
                        .padding(.horizontal, 8.5)
                        .frame(height: 32)
                        .frame(maxWidth: 140)
                        .background(KY.sunken, in: Capsule())
                        .overlay(Capsule().strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.kooyuPress)
                    .disabled(!modelEnabled)
                    .accessibilityLabel("选择模型：\(modelSummary)")

                    if let onReasoning {
                        Button(action: onReasoning) {
                            HStack(spacing: 3.5) {
                                Image(systemName: "brain.head.profile")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(KY.textSecondary)
                                Text(reasoningSummary?.nonEmpty ?? "默认思考")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(KY.textSecondary)
                                    .lineLimit(1)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 8.5, weight: .bold))
                                    .foregroundStyle(KY.textTertiary)
                            }
                            .padding(.horizontal, 8.5)
                            .frame(height: 32)
                            .background(KY.sunken, in: Capsule())
                            .overlay(Capsule().strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.kooyuPress)
                        .disabled(!modelEnabled)
                        .accessibilityLabel("思考强度：\(reasoningSummary?.nonEmpty ?? "默认思考")")
                    }

                    if let onPermission {
                        Button(action: onPermission) {
                            HStack(spacing: 3.5) {
                                Image(systemName: "shield")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(KY.textSecondary)
                                Text(permissionSummary?.nonEmpty ?? "默认权限")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(KY.textSecondary)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 8.5, weight: .bold))
                                    .foregroundStyle(KY.textTertiary)
                            }
                            .padding(.horizontal, 8.5)
                            .frame(height: 32)
                            .frame(maxWidth: 132)
                            .background(KY.sunken, in: Capsule())
                            .overlay(Capsule().strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.kooyuPress)
                        .disabled(!enabled)
                        .accessibilityLabel("工具权限：\(permissionSummary?.nonEmpty ?? "默认权限")")
                    }
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)

                voiceButton
                action
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 4)
        }
        .background(KY.raised, in: shape)
        .overlay(shape.strokeBorder(focused ? KY.borderStrong : KY.border, lineWidth: focused ? 1.5 : 0.75))
        .shadow(color: Color.black.opacity(focused ? 0.08 : 0.04), radius: focused ? 10 : 6, x: 0, y: 2)
        .animation(KYMotion.snap, value: focused)
    }
}

/// Compact wrapping chip layout so Model, Reasoning, and Permission pills never clip or fade under Send.
private struct ComposerChipFlowLayout: Layout {
    var spacing: CGFloat = 5
    var lineSpacing: CGFloat = 5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0

        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            if x > 0 && x + spacing + size.width > maxWidth {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            if x > 0 { x += spacing }
            x += size.width
            rowHeight = max(rowHeight, size.height)
            usedWidth = max(usedWidth, x)
        }
        return CGSize(width: min(maxWidth, usedWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            if x > bounds.minX && x + spacing + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            if x > bounds.minX { x += spacing }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Shared unified modal sheet switching between Model selection and Reasoning effort.
struct ComposerModelReasoningSheet: View {
    let models: [JSONValue]
    let currentModel: String?
    let effectiveModelLabel: String
    let inheritLabel: String
    let modelSupport: String?
    let levels: [String]
    let currentReasoning: String
    let loading: Bool
    let error: String
    var enabled = true
    var initialTab = "model"
    var bindings: [JSONValue] = []
    var bindingChoice: String? = nil
    var allowNativeChoice = false
    var onSelectInherit: (() -> Void)? = nil
    var onSelectNative: (() -> Void)? = nil
    var onSelectBinding: ((String) -> Void)? = nil
    var modelID: (JSONValue) -> String
    var refresh: () async -> Void
    var chooseModel: (String?) -> Void
    var chooseReasoning: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var tab = "model"
    @State private var query = ""

    init(
        models: [JSONValue],
        currentModel: String?,
        effectiveModelLabel: String,
        inheritLabel: String,
        modelSupport: String?,
        levels: [String],
        currentReasoning: String,
        loading: Bool,
        error: String,
        enabled: Bool = true,
        initialTab: String = "model",
        bindings: [JSONValue] = [],
        bindingChoice: String? = nil,
        allowNativeChoice: Bool = false,
        onSelectInherit: (() -> Void)? = nil,
        onSelectNative: (() -> Void)? = nil,
        onSelectBinding: ((String) -> Void)? = nil,
        modelID: @escaping (JSONValue) -> String,
        refresh: @escaping () async -> Void,
        chooseModel: @escaping (String?) -> Void,
        chooseReasoning: @escaping (String?) -> Void
    ) {
        self.models = models
        self.currentModel = currentModel
        self.effectiveModelLabel = effectiveModelLabel
        self.inheritLabel = inheritLabel
        self.modelSupport = modelSupport
        self.levels = levels
        self.currentReasoning = currentReasoning
        self.loading = loading
        self.error = error
        self.enabled = enabled
        self.initialTab = initialTab
        self.bindings = bindings
        self.bindingChoice = bindingChoice
        self.allowNativeChoice = allowNativeChoice
        self.onSelectInherit = onSelectInherit
        self.onSelectNative = onSelectNative
        self.onSelectBinding = onSelectBinding
        self.modelID = modelID
        self.refresh = refresh
        self.chooseModel = chooseModel
        self.chooseReasoning = chooseReasoning
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                KooyuSegmentedControl(
                    options: [
                        SegmentOption(value: "model", label: "模型 · \(effectiveModelLabel)"),
                        SegmentOption(value: "reasoning", label: "思考 · \(currentReasoning.isEmpty ? "默认" : currentReasoning)")
                    ],
                    selection: $tab
                )
                .padding(.horizontal, 16)
                .padding(.vertical, 8)

                if tab == "model" {
                    List {
                        if loading { ProgressView().accessibilityLabel("正在读取模型列表") }
                        if !error.isEmpty { Text(error).foregroundStyle(KY.destructive) }
                        if let onSelectInherit {
                            Button {
                                onSelectInherit()
                            } label: {
                                HStack {
                                    Text("继承项目 / 设备配置")
                                    Spacer()
                                    if bindingChoice == "inherit" { Image(systemName: "checkmark").accessibilityLabel("已选择") }
                                }
                            }.disabled(loading || !enabled)
                            if allowNativeChoice, let onSelectNative {
                                Button {
                                    onSelectNative()
                                } label: {
                                    HStack {
                                        Text("原生配置与登录")
                                        Spacer()
                                        if bindingChoice == "native" { Image(systemName: "checkmark").accessibilityLabel("已选择") }
                                    }
                                }.disabled(loading || !enabled)
                            }
                            if !bindings.isEmpty, let onSelectBinding {
                                Section("引擎绑定") {
                                    ForEach(Array(bindings.enumerated()), id: \.offset) { _, b in
                                        let id = b["id"].string
                                        Button {
                                            onSelectBinding(id)
                                        } label: {
                                            HStack {
                                                Text(b["name"].string + " · " + b["model"].string)
                                                Spacer()
                                                if bindingChoice == "binding:" + id && currentModel == nil {
                                                    Image(systemName: "checkmark").accessibilityLabel("已选择")
                                                }
                                            }
                                        }.disabled(loading || !enabled)
                                    }
                                }
                            }
                        } else if modelSupport != "native-only" {
                            Button {
                                chooseModel(nil)
                            } label: {
                                HStack {
                                    Text(inheritLabel)
                                    Spacer()
                                    if currentModel == nil { Image(systemName: "checkmark").accessibilityLabel("已选择") }
                                }
                            }.disabled(loading || !enabled)
                        }

                        if modelSupport == "native-only" {
                            Text("此引擎的可用模型由宿主原生登录态与配置文件决定。").font(.footnote).foregroundStyle(KY.textSecondary)
                        } else if onSelectInherit == nil || modelSupport != "binding-required" || bindingChoice?.hasPrefix("binding:") == true {
                            Section("模型") {
                                ForEach(Array(models.filter { query.isEmpty || (modelID($0) + " " + $0["name"].string).localizedCaseInsensitiveContains(query) }.enumerated()), id: \.offset) { _, item in
                                    let id = modelID(item)
                                    Button {
                                        chooseModel(id)
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading) {
                                                Text(item["name"].string.isEmpty ? item["id"].string : item["name"].string)
                                                Text(id).font(.caption).foregroundStyle(KY.textSecondary)
                                            }
                                            Spacer()
                                            if currentModel == id { Image(systemName: "checkmark").accessibilityLabel("已选择") }
                                        }
                                    }.disabled(loading || !enabled)
                                }
                                let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
                                if !trimmed.isEmpty && !models.contains(where: { modelID($0) == trimmed }) {
                                    Button("使用模型：\(trimmed)") { chooseModel(trimmed) }.disabled(loading || !enabled)
                                }
                            }
                        }
                    }
                    .searchable(text: $query, prompt: "筛选或输入模型 ID…")
                } else {
                    List {
                        if loading { ProgressView().accessibilityLabel("正在读取思考档位") }
                        if !error.isEmpty { Text(error).foregroundStyle(KY.destructive) }
                        Section {
                            reasoningOption("", "默认思考")
                            ForEach(levels, id: \.self) { reasoningOption($0, $0) }
                        } footer: {
                            Text(!loading && levels.isEmpty ? "当前模型未提供可选思考档位。可刷新选项，或在模型配置中选择支持的模型。" : "此设置将在下一回合生效。")
                        }
                    }
                }
            }
            .navigationTitle("模型与思考").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("刷新选项").disabled(loading)
                }
            }
            .refreshable { await refresh() }
            .task { await refresh() }
        }.tint(KY.text)
    }

    private func reasoningOption(_ value: String, _ label: String) -> some View {
        Button {
            chooseReasoning(value.isEmpty ? nil : value)
        } label: {
            HStack {
                Text(label)
                Spacer()
                if currentReasoning == value { Image(systemName: "checkmark").accessibilityLabel("已选择") }
            }
        }.disabled(loading || !enabled)
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

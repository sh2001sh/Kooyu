import SwiftUI

private struct CapsuleStyle: ViewModifier {
    var tone: ToolStatus?
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        content
            .background(tone == .failed ? KY.destructiveTint : tone == .running ? KY.accentTint : KY.capsule, in: shape)
            .overlay(shape.strokeBorder(tone == .failed ? KY.destructive.opacity(0.28) : tone == .running ? KY.accent.opacity(0.22) : KY.borderSubtle))
            .clipShape(shape)
    }
}
private extension View { func telemetryCapsule(_ tone: ToolStatus? = nil) -> some View { modifier(CapsuleStyle(tone: tone)) } }

private struct Pulse: ViewModifier {
    let active: Bool
    @State private var dim = false
    func body(content: Content) -> some View {
        content.opacity(active && dim ? 0.45 : 1)
            .onAppear { if active { withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true } } }
            .onChange(of: active) { _, on in
                if on { withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true } }
                else { withAnimation(.default) { dim = false } }
            }
    }
}

struct StatusChip: View {
    let text: String
    let tone: ToolStatus?
    var body: some View {
        Text(text)
            .font(.system(size: 10.5, weight: .medium))
            .lineLimit(1)
            .foregroundStyle(tone == .failed ? KY.destructive : tone == .running ? KY.text : tone == .done ? KY.doneText : KY.textTertiary)
            .padding(.horizontal, 7).padding(.vertical, 1.5)
            .background(tone == .failed ? KY.destructiveTint : tone == .running ? KY.accentTint : tone == .done ? KY.successTint : KY.paper.opacity(0.78),
                        in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

private struct StatusIcon: View {
    let systemName: String
    let tone: ToolStatus?
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(tone == .failed ? KY.destructive : tone == .running ? KY.text : KY.textTertiary)
            .frame(width: 20, height: 20)
            .background(tone == .failed ? KY.destructiveTint : tone == .running ? KY.accentTint : KY.paper, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(tone == nil || tone == .done ? KY.borderSubtle : .clear))
            .modifier(Pulse(active: tone == .running))
    }
}

private struct Chevron: View {
    let open: Bool
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(KY.textTertiary)
            .rotationEffect(.degrees(open ? 90 : 0))
            .animation(.snappy, value: open)
    }
}

private struct OutputWell: View {
    let text: String
    var body: some View {
        let shown = text.count > 20000 ? String(text.prefix(20000)) + "\n…（已截断）" : text
        let label = Text(shown)
            .font(.system(size: 11.5, design: .monospaced))
            .foregroundStyle(KY.textSecondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: true, vertical: true)
            .padding(10)
        Group {
            if shown.split(separator: "\n", omittingEmptySubsequences: false).count <= 18 {
                ScrollView(.horizontal, showsIndicators: false) { label }
            } else {
                ScrollView([.vertical, .horizontal]) { label }.frame(height: 320)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(KY.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct ToolCardView: View {
    let row: TranscriptRow
    var grouped = false
    @State private var open = false
    var body: some View {
        let summary = toolSummary(row.payload)
        let content = VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    StatusIcon(systemName: "wrench.adjustable", tone: summary.status)
                    Text(summary.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(KY.text).lineLimit(1)
                        .frame(maxWidth: 160, alignment: .leading).fixedSize(horizontal: true, vertical: false)
                    Text(summary.detail).font(.system(size: 11, design: .monospaced)).foregroundStyle(KY.textSecondary)
                        .lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
                    if let status = summary.status { StatusChip(text: status.rawValue, tone: status) }
                    Chevron(open: open)
                }
                .padding(.horizontal, 10).frame(minHeight: 36).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(summary.title) \(summary.detail) \(summary.status?.rawValue ?? "")")
            if open {
                let output = toolOutput(row.payload)
                VStack(alignment: .trailing, spacing: 2) {
                    CopyButton(text: output, label: "复制输出")
                    OutputWell(text: output)
                }
                .padding(.horizontal, 10).padding(.bottom, 10)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        if grouped { content } else { content.telemetryCapsule(summary.status == .done ? nil : summary.status) }
    }
}

struct ToolGroupView: View {
    let rows: [TranscriptRow]
    var collapse = true
    @State private var open = false
    var body: some View {
        if rows.count == 1 || !collapse {
            VStack(spacing: 6) { ForEach(rows) { ToolCardView(row: $0) } }
        } else {
            let summaries = rows.map { toolSummary($0.payload) }
            let failed = summaries.filter { $0.status == .failed }.count
            let active = summaries.filter { $0.status == .running }.count
            let names = summaries.map(\.title).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
            let tone: ToolStatus? = failed > 0 ? .failed : active > 0 ? .running : nil
            VStack(alignment: .leading, spacing: 0) {
                Button { withAnimation(.snappy) { open.toggle() } } label: {
                    HStack(spacing: 8) {
                        StatusIcon(systemName: "wrench.adjustable", tone: tone)
                        Text("\(rows.count) 次工具调用").font(.system(size: 12, weight: .semibold)).foregroundStyle(KY.text).fixedSize()
                        HStack(spacing: 4) {
                            ForEach(names.prefix(2), id: \.self) { name in
                                Text(name).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(KY.textSecondary).lineLimit(1)
                                    .padding(.horizontal, 6).padding(.vertical, 1.5)
                                    .background(KY.paper, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(KY.borderSubtle))
                            }
                            if names.count > 2 { Text("+\(names.count - 2)").font(.system(size: 10.5)).foregroundStyle(KY.textTertiary) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if active > 0 { StatusChip(text: "\(active) 进行中", tone: .running) }
                        if failed > 0 { StatusChip(text: "\(failed) 失败", tone: .failed) }
                        Chevron(open: open)
                    }
                    .padding(.horizontal, 10).frame(minHeight: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if open {
                    ForEach(rows) { row in
                        Divider().overlay(KY.borderSubtle)
                        ToolCardView(row: row, grouped: true)
                    }
                }
            }
            .telemetryCapsule(tone)
        }
    }
}

struct ThinkingView: View {
    let row: TranscriptRow
    let live: Bool
    @State private var open: Bool
    init(row: TranscriptRow, live: Bool) { self.row = row; self.live = live; _open = State(initialValue: live) }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "brain").font(.system(size: 12)).foregroundStyle(KY.textTertiary).modifier(Pulse(active: live))
                    Text(live ? "正在思考…" : "思考过程").font(.system(size: 12)).foregroundStyle(KY.textSecondary)
                    Spacer()
                    Chevron(open: open)
                }
                .padding(.horizontal, 10).frame(minHeight: 36).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Text(row.text)
                    .font(.system(size: 13)).lineSpacing(4).foregroundStyle(KY.textSecondary)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .telemetryCapsule()
        .onChange(of: live) { _, now in if now { open = true } }
    }
}

struct SubagentView: View {
    let child: ChildTranscript
    let harnessId: String?
    @State private var open = false
    var body: some View {
        let status = subagentStatusLabels[child.status ?? ""] ?? child.status ?? "状态未知"
        let tone: ToolStatus? = ["进行中", "启动中"].contains(status) ? .running : status == "失败" ? .failed : status == "完成" ? .done : nil
        VStack(alignment: .leading, spacing: 0) {
            Divider().overlay(KY.border)
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Chevron(open: open)
                    Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 12)).foregroundStyle(KY.textTertiary)
                    Text("子代理 · \(child.name ?? child.agentId)").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(KY.text).lineLimit(1)
                    Spacer()
                    StatusChip(text: status, tone: tone)
                }
                .frame(minHeight: 40).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                let inner = buildTranscript(child.events)
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(child.agentId).font(.system(size: 11, design: .monospaced)).foregroundStyle(KY.textTertiary).lineLimit(1)
                        Spacer()
                        CopyButton(text: inner.rows.map { $0.role == .tool ? toolOutput($0.payload) : $0.text }.joined(separator: "\n"), label: "复制子代理输出")
                    }
                    if let parent = child.parentAgentId { Text("父代理：\(parent)").font(.system(size: 11)).foregroundStyle(KY.textTertiary) }
                    if inner.rows.isEmpty {
                        Text("状态通知").font(.system(size: 11, design: .monospaced)).foregroundStyle(KY.textTertiary)
                    } else {
                        TranscriptStack(transcript: inner, harnessId: harnessId, running: tone == .running, subagent: true)
                    }
                }
                .padding(.leading, 12).padding(.bottom, 12)
            }
            Divider().overlay(KY.border)
        }
    }
}

struct ErrorTurnView: View {
    let row: TranscriptRow
    let title: String
    @State private var open = false
    var body: some View {
        let detail = row.payload["error"]["detail"].string
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 13)).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13, weight: .semibold))
                Text(row.text).font(.system(size: 13)).textSelection(.enabled)
                if !detail.isEmpty {
                    Button(open ? "收起详细信息" : "详细信息") { open.toggle() }.font(.system(size: 12)).buttonStyle(.plain).opacity(0.8).padding(.top, 3)
                    if open { Text(detail).font(.system(size: 11.5, design: .monospaced)).textSelection(.enabled) }
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(KY.destructive)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(KY.destructiveTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.destructive.opacity(0.24)))
        .accessibilityElement(children: .combine)
    }
}

private struct AttachmentPreview: Identifiable { let id = UUID(); let name, content: String }

struct UserTurnView: View {
    let row: TranscriptRow
    @State private var preview: AttachmentPreview?
    var body: some View {
        let parts = splitAttachments(row.text)
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .leading, spacing: 6) {
                if let origin = row.origin { Text(origin).font(.system(size: 11, weight: .semibold)).foregroundStyle(KY.textSecondary) }
                if !parts.text.isEmpty { MarkdownView(text: parts.text, fill: false) }
                ForEach(Array(row.attachments.enumerated()), id: \.offset) { _, file in Label(file["displayName"].string, systemImage: "paperclip").font(.caption).foregroundStyle(KY.textSecondary) }
                ForEach(Array(parts.files.enumerated()), id: \.offset) { _, file in
                    Button { preview = AttachmentPreview(name: file.name, content: file.content) } label: {
                        Label(file.name, systemImage: "doc.text").font(.system(size: 12)).foregroundStyle(KY.text).lineLimit(1)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .background(KY.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(KY.borderSubtle))
                    }
                    .buttonStyle(.plain)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 15).padding(.vertical, 10)
            .background(KY.bubble, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18, style: .continuous))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18, style: .continuous).stroke(KY.borderSubtle, lineWidth: 1))
        }
        .sheet(item: $preview) { item in
            NavigationStack {
                ScrollView([.vertical, .horizontal]) {
                    Text(item.content).font(.system(size: 12, design: .monospaced)).textSelection(.enabled).padding()
                }
                .navigationTitle(item.name).navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("完成") { preview = nil } }
            }
        }
    }
}

struct AssistantTurnView: View {
    let row: TranscriptRow
    let harnessId: String?
    let continuation: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !continuation {
                HStack(spacing: 8) {
                    EngineBadge(harnessId: harnessId, size: 20)
                    Text(harnessVisual(harnessId).name).font(.system(size: 12, weight: .semibold)).foregroundStyle(KY.textSecondary)
                    Spacer()
                    CopyButton(text: row.text)
                }
            }
            MarkdownView(text: row.text)
            if continuation { HStack { Spacer(); CopyButton(text: row.text) } }
        }
    }
}

struct RunIndicatorView: View {
    var label = "原生执行中"
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small).tint(KY.text)
            Text(label).font(.system(size: 12.5)).foregroundStyle(KY.textSecondary)
        }
        .padding(.vertical, 4)
    }
}

struct TranscriptBlockView: View {
    let block: TranscriptBlock
    let harnessId: String?
    let live: Bool
    let continuation: Bool
    var subagent = false
    var onEdit: ((TranscriptRow) -> Void)? = nil
    var onBranch: ((TranscriptRow) -> Void)? = nil
    var body: some View {
        switch block {
        case .tools(let rows): ToolGroupView(rows: rows)
        case .single(let row):
            switch row.role {
            case .thinking: ThinkingView(row: row, live: live)
            case .subagent: if let child = row.child { SubagentView(child: child, harnessId: harnessId) }
            case .user: UserTurnView(row: row)
            case .error: ErrorTurnView(row: row, title: subagent ? "子代理本轮失败" : "\(harnessVisual(harnessId).name) 本轮失败")
            default: AssistantTurnView(row: row, harnessId: harnessId, continuation: continuation)
            }
            if row.role == .user || row.role == .assistant {
                HStack(spacing: 8) {
                    if row.role == .user { Spacer() }
                    if let stamp = row.createdAt, let date = messageDate(stamp) {
                        Text(date, format: .dateTime.weekday(.wide).hour().minute()).font(.caption2).foregroundStyle(KY.textSecondary)
                    }
                    if row.role == .user {
                        CopyButton(text: row.text)
                        if !subagent, let onEdit {
                            Button { onEdit(row) } label: { Image(systemName: "pencil").frame(width: 44, height: 44) }
                                .buttonStyle(.plain).accessibilityLabel("编辑消息并分支")
                        }
                    } else if !subagent, row.createdAt != nil, let onBranch {
                        Menu { Button("分支到新聊天", systemImage: "arrow.triangle.branch") { onBranch(row) } } label: {
                            Image(systemName: "ellipsis").frame(width: 44, height: 44)
                        }.accessibilityLabel("更多消息操作")
                    }
                }.foregroundStyle(KY.textSecondary)
            }
        }
    }
}

/// Non-lazy transcript used for nested sub-agent output.
struct TranscriptStack: View {
    let transcript: Transcript
    let harnessId: String?
    let running: Bool
    var subagent = false
    var body: some View {
        let blocks = transcriptBlocks(transcript.rows)
        let cont = continuationFlags(blocks)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                TranscriptBlockView(block: block, harnessId: harnessId, live: running && transcript.thinkingPending && index == blocks.count - 1,
                                    continuation: cont[index], subagent: subagent)
            }
        }
    }
}

private func messageDate(_ stamp: String) -> Date? {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: stamp) ?? ISO8601DateFormatter().date(from: stamp)
}

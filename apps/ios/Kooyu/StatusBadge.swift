import SwiftUI

/// "状态必有文字" (§2.3): every session state is a 6 pt dot plus a Chinese word, never a bare dot.
enum SessionStatusTone: String, Sendable {
    case running, attention, ready, muted, error
}

struct SessionStatus: Equatable, Sendable {
    let label: String
    let tone: SessionStatusTone
    var pulses: Bool { tone == .running }
}

func sessionStatus(_ s: HostSession) -> SessionStatus {
    switch s.runState {
    case "waiting-input": return SessionStatus(label: "需确认", tone: .attention)
    case "running": return SessionStatus(label: "运行中", tone: .running)
    case "idle":
        if s.phase == "draft" { return SessionStatus(label: "未启动", tone: .muted) }
        if s.connectionState == "reconnecting" { return SessionStatus(label: "重连中", tone: .running) }
        if s.connectionState == "offline" { return SessionStatus(label: "未连接", tone: .muted) }
        return SessionStatus(label: "就绪", tone: .ready)
    case "failed", "error": return SessionStatus(label: "异常", tone: .error)
    default: return SessionStatus(label: "待核对", tone: .muted)
    }
}

extension SessionStatusTone {
    var dot: Color {
        switch self {
        case .running: KY.info
        case .attention: KY.brandCoral
        case .ready: KY.success
        case .muted: KY.textTertiary
        case .error: KY.destructive
        }
    }
    var ink: Color {
        switch self {
        case .running: KY.infoText
        case .attention: KY.coralInk
        case .ready: KY.textSecondary
        case .muted: KY.textTertiary
        case .error: KY.destructive
        }
    }
    var tint: Color {
        switch self {
        case .running: KY.infoTint
        case .attention: KY.brandCoralTint
        case .ready: KY.successTint
        case .muted: KY.sunken
        case .error: KY.destructiveTint
        }
    }
}

struct StatusDot: View {
    let color: Color
    var pulse = false
    var size: CGFloat = 6
    var body: some View {
        Circle().fill(color).frame(width: size, height: size).kooyuPulse(pulse).accessibilityHidden(true)
    }
}

/// Dot + word. `capsule` adds the tinted pill used in headers and the inspector.
struct StatusBadge: View {
    let status: SessionStatus
    var capsule = false
    var body: some View {
        HStack(spacing: 4) {
            StatusDot(color: status.tone.dot, pulse: status.pulses)
            Text(status.label).font(KYFont.caption).foregroundStyle(status.tone.ink).lineLimit(1).fixedSize()
        }
        .padding(.horizontal, capsule ? 7 : 0)
        .padding(.vertical, capsule ? 2 : 0)
        .background(capsule ? status.tone.tint : Color.clear, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("状态：\(status.label)")
    }
}

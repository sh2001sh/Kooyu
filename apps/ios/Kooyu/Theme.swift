import SwiftUI
import UIKit

extension Color {
    /// Dynamic light/dark color from 0xRRGGBB values, resolved by the current trait collection.
    init(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) {
        self.init(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let hex = isDark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: isDark ? darkAlpha : lightAlpha)
        })
    }
}

/// Desktop design tokens (apps/web/src/styles/app.css `:root` / `.dark`): monochrome accent,
/// paper/navigator/sunken surfaces and hairline borders, so the phone reads as the same product.
enum KY {
    static let paper = Color(light: 0xFFFFFF, dark: 0x0C0E14)
    static let navigator = Color(light: 0xF7F7F9, dark: 0x08090D)
    static let raised = Color(light: 0xFFFFFF, dark: 0x12151F)
    static let sunken = Color(light: 0xF1F2F4, dark: 0x06070A)
    static let bubble = Color(light: 0xF2F3F6, dark: 0x1A1D26)
    static let capsule = Color(light: 0xF8F8FA, dark: 0x161922)
    static let text = Color(light: 0x111317, dark: 0xF4F4F6)
    static let textSecondary = Color(light: 0x525866, dark: 0xB0B5C0)
    static let textTertiary = Color(light: 0x848B98, dark: 0x79808E)
    static let borderSubtle = Color(light: 0x111317, dark: 0xFFFFFF, lightAlpha: 0.07, darkAlpha: 0.06)
    static let border = Color(light: 0x111317, dark: 0xFFFFFF, lightAlpha: 0.11, darkAlpha: 0.11)
    static let borderStrong = Color(light: 0x111317, dark: 0xFFFFFF, lightAlpha: 0.18, darkAlpha: 0.22)
    static let accent = Color(light: 0x18191D, dark: 0xF4F4F6)
    static let onAccent = Color(light: 0xFFFFFF, dark: 0x141518)
    static let accentTint = Color(light: 0x18191D, dark: 0xFFFFFF, lightAlpha: 0.07, darkAlpha: 0.08)
    static let brandCoral = Color(light: 0xF17561, dark: 0xF17561)
    static let brandCoralTint = Color(light: 0xF17561, dark: 0xF17561, lightAlpha: 0.14, darkAlpha: 0.22)
    static let success = Color(light: 0x15803D, dark: 0x4ADE80)
    static let successTint = Color(light: 0x16A34A, dark: 0x4ADE80, lightAlpha: 0.1, darkAlpha: 0.12)
    static let doneText = Color(light: 0x218056, dark: 0x5FD39E)
    static let info = Color(light: 0xB45309, dark: 0xFBBF24)
    static let infoTint = Color(light: 0xD97706, dark: 0xF59E0B, lightAlpha: 0.1, darkAlpha: 0.12)
    static let destructive = Color(light: 0xB91C1C, dark: 0xF87171)
    static let destructiveTint = Color(light: 0xDC2626, dark: 0xEF4444, lightAlpha: 0.09, darkAlpha: 0.14)
}

/// Desktop HARNESS_VISUALS (apps/web/src/lib/harnesses.ts): one tinted plate + ink per engine.
struct HarnessVisual: Sendable {
    let name, monogram: String
    let tint: Color, ink: Color
}

private func visual(_ name: String, _ monogram: String, tint: UInt32, tintA: CGFloat, ink: UInt32, darkTint: UInt32, darkTintA: CGFloat, darkInk: UInt32) -> HarnessVisual {
    HarnessVisual(name: name, monogram: monogram, tint: Color(light: tint, dark: darkTint, lightAlpha: tintA, darkAlpha: darkTintA), ink: Color(light: ink, dark: darkInk))
}

let harnessVisuals: [String: HarnessVisual] = [
    "kodo": visual("Kooyu", "K", tint: 0xF17561, tintA: 0.14, ink: 0xC2422F, darkTint: 0xF17561, darkTintA: 0.22, darkInk: 0xFF9B8A),
    "pi": visual("pi", "π", tint: 0x745ED4, tintA: 0.13, ink: 0x5640B8, darkTint: 0x9382F0, darkTintA: 0.22, darkInk: 0xC4B9FF),
    "codex": visual("Codex", "</>", tint: 0x26805C, tintA: 0.13, ink: 0x166B48, darkTint: 0x3EBA86, darkTintA: 0.20, darkInk: 0x7AE0B3),
    "claude-code": visual("Claude Code", "✦", tint: 0xD97745, tintA: 0.14, ink: 0xB35221, darkTint: 0xEB8C58, darkTintA: 0.22, darkInk: 0xFFB28A),
    "deepseek-harness": visual("DeepSeek Harness", "DS", tint: 0x3470E0, tintA: 0.13, ink: 0x2257B8, darkTint: 0x5C94FA, darkTintA: 0.22, darkInk: 0x9CC2FF),
    "zcode": visual("ZCode", "Z", tint: 0xB85CA8, tintA: 0.13, ink: 0x8F3C81, darkTint: 0xD87AC8, darkTintA: 0.22, darkInk: 0xF0A8E3),
    "opencode": visual("OpenCode", "OC", tint: 0x486C82, tintA: 0.13, ink: 0x32566D, darkTint: 0x76A4C0, darkTintA: 0.22, darkInk: 0xA8D0E8),
    "gemini": visual("Gemini CLI", "◆", tint: 0x388AD4, tintA: 0.13, ink: 0x1E66A8, darkTint: 0x62AEF5, darkTintA: 0.22, darkInk: 0x9AD0FF),
    "cursor": visual("Cursor", "▸", tint: 0x5C5C66, tintA: 0.13, ink: 0x3E3E48, darkTint: 0xA8A8B8, darkTintA: 0.22, darkInk: 0xD6D6E2),
    "kimi-code": visual("Kimi Code", "K·", tint: 0x2C8EA8, tintA: 0.13, ink: 0x1A6B82, darkTint: 0x52B8D4, darkTintA: 0.22, darkInk: 0x94DCF0),
    "grok-build": visual("Grok Build", "Ø", tint: 0x806848, tintA: 0.14, ink: 0x664E2E, darkTint: 0xB8986C, darkTintA: 0.22, darkInk: 0xE0C498),
]

func harnessVisual(_ id: String?) -> HarnessVisual {
    if let v = harnessVisuals[id ?? "kodo"] { return v }
    let label = id ?? "引擎"
    return visual(label, String(label.prefix(2)).uppercased(), tint: 0x5C5C66, tintA: 0.13, ink: 0x3E3E48, darkTint: 0xA8A8B8, darkTintA: 0.22, darkInk: 0xD6D6E2)
}

/// Desktop-style engine badge: tinted circle or squircle with the engine's brand mark or monogram.
struct EngineBadge: View {
    let harnessId: String?
    var size: CGFloat = 20
    var circle = true
    var body: some View {
        let v = harnessVisual(harnessId)
        let isKooyu = harnessId == nil || harnessId == "kodo" || harnessId == "kooyu"
        let shape = circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
        ZStack {
            if isKooyu {
                Image("KooyuMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: size * 0.65, height: size * 0.65)
            } else {
                Text(v.monogram)
                    .font(.system(size: size * (v.monogram.count > 1 ? 0.36 : 0.5), weight: .bold))
                    .lineLimit(1)
                    .foregroundStyle(v.ink)
            }
        }
        .frame(width: size, height: size)
        .background(v.tint, in: shape)
        .overlay(shape.stroke(v.ink.opacity(0.14), lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

/// Desktop primary / secondary buttons: solid monochrome fill with contrasting label, or a hairline ring.
/// Replaces `.borderedProminent`, whose white label disappears on the near-white dark-mode accent.
struct KooyuButtonStyle: ButtonStyle {
    var prominent = true
    var destructive = false
    @Environment(\.isEnabled) private var enabled
    init(prominent: Bool = true, destructive: Bool = false) { self.prominent = prominent; self.destructive = destructive }
    func makeBody(configuration: Configuration) -> some View {
        let fill: Color = prominent ? (destructive ? KY.destructive : KY.accent) : KY.raised
        let ink: Color = prominent ? (destructive ? .white : KY.onAccent) : (destructive ? KY.destructive : KY.text)
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(ink)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(prominent ? .clear : KY.border))
            .opacity(enabled ? (configuration.isPressed ? 0.82 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == KooyuButtonStyle {
    static var kooyuPrimary: KooyuButtonStyle { KooyuButtonStyle() }
    static var kooyuSecondary: KooyuButtonStyle { KooyuButtonStyle(prominent: false) }
}

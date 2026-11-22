import Observation
import os
import SwiftUI
import UIKit

extension Color {
    /// Dynamic light/dark color from 0xRRGGBB values, resolved by the current trait collection.
    init(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) {
        self.init(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let hex = isDark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: isDark ? darkAlpha : lightAlpha
            )
        })
    }

    init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: Double(alpha)
        )
    }
}

private func uiColor(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
    UIColor(
        red: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: alpha
    )
}

private func mixHex(_ a: UInt32, _ b: UInt32, weightA: CGFloat) -> UInt32 {
    let w = max(0, min(1, weightA))
    let r = CGFloat((a >> 16) & 0xFF) * w + CGFloat((b >> 16) & 0xFF) * (1 - w)
    let g = CGFloat((a >> 8) & 0xFF) * w + CGFloat((b >> 8) & 0xFF) * (1 - w)
    let bl = CGFloat(a & 0xFF) * w + CGFloat(b & 0xFF) * (1 - w)
    return (UInt32(r.rounded()) << 16) | (UInt32(g.rounded()) << 8) | UInt32(bl.rounded())
}

private func relativeLuminance(_ hex: UInt32) -> CGFloat {
    let r = CGFloat((hex >> 16) & 0xFF) / 255
    let g = CGFloat((hex >> 8) & 0xFF) / 255
    let b = CGFloat(hex & 0xFF) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// 5 unified cross-platform presets matching Web (`appearance.ts`) and Android (`Theme.kt`).
struct KYThemePreset: Identifiable, Sendable {
    let id: String
    let label: String
    let lightBg: UInt32
    let lightFg: UInt32
    let darkBg: UInt32
    let darkFg: UInt32
    let accentId: String
}

let kyThemePresets: [KYThemePreset] = [
    KYThemePreset(id: "kooyu", label: "极简墨白", lightBg: 0xFFFFFF, lightFg: 0x141518, darkBg: 0x121316, darkFg: 0xF3F4F6, accentId: "default"),
    KYThemePreset(id: "chatgpt", label: "澄澈素白", lightBg: 0xFFFFFF, lightFg: 0x1A1C1F, darkBg: 0x212121, darkFg: 0xECECEC, accentId: "default"),
    KYThemePreset(id: "graphite", label: "深空石墨", lightBg: 0xFAFAFC, lightFg: 0x1C1C1E, darkBg: 0x1C1C1E, darkFg: 0xF5F5F7, accentId: "blue"),
    KYThemePreset(id: "claude", label: "温润米宣", lightBg: 0xFAF9F5, lightFg: 0x1F1E1D, darkBg: 0x1F1E1B, darkFg: 0xEFECE6, accentId: "coral"),
    KYThemePreset(id: "nord", label: "极夜冰川", lightBg: 0xF4F6FA, lightFg: 0x2E3440, darkBg: 0x242933, darkFg: 0xECEFF4, accentId: "indigo"),
]

struct KYAccentOption: Identifiable, Sendable {
    let id: String
    let label: String
    let lightHex: UInt32
    let darkHex: UInt32
}

let kyAccentOptions: [KYAccentOption] = [
    KYAccentOption(id: "default", label: "默认", lightHex: 0x141518, darkHex: 0xF3F4F6),
    KYAccentOption(id: "coral", label: "珊瑚红", lightHex: 0xE6533C, darkHex: 0xF17561),
    KYAccentOption(id: "blue", label: "苹果蓝", lightHex: 0x007AFF, darkHex: 0x3B9EFF),
    KYAccentOption(id: "indigo", label: "靛青紫", lightHex: 0x5856D6, darkHex: 0x7D7AFF),
    KYAccentOption(id: "emerald", label: "翡翠绿", lightHex: 0x10A37F, darkHex: 0x34D399),
    KYAccentOption(id: "amber", label: "琥珀金", lightHex: 0xD97706, darkHex: 0xF59E0B),
]

/// Immutable, Sendable palette snapshot resolved atomically by `KY` dynamic colors.
struct KYPaletteSnapshot: Sendable {
    let presetId: String
    let accentId: String
    let highContrast: Bool

    var preset: KYThemePreset {
        kyThemePresets.first { $0.id == presetId } ?? kyThemePresets[0]
    }

    func paperHex(dark: Bool) -> UInt32 { dark ? preset.darkBg : preset.lightBg }
    func textHex(dark: Bool) -> UInt32 { dark ? preset.darkFg : preset.lightFg }

    func navigatorHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0x0B0C0E : 0xF5F5F7 }
        return dark ? mixHex(paperHex(dark: true), 0x000000, weightA: 0.64) : mixHex(paperHex(dark: false), textHex(dark: false), weightA: 0.962)
    }

    func raisedHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0x181A1F : 0xFFFFFF }
        return dark ? mixHex(paperHex(dark: true), textHex(dark: true), weightA: 0.955) : paperHex(dark: false)
    }

    func sunkenHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0x0F1115 : 0xEFF0F3 }
        return dark ? mixHex(paperHex(dark: true), 0x000000, weightA: 0.78) : mixHex(paperHex(dark: false), textHex(dark: false), weightA: 0.942)
    }

    func bubbleHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0x20232B : 0xF2F3F6 }
        return dark ? mixHex(paperHex(dark: true), textHex(dark: true), weightA: 0.922) : mixHex(paperHex(dark: false), textHex(dark: false), weightA: 0.946)
    }

    func capsuleHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0x15171C : 0xF4F5F7 }
        return mixHex(paperHex(dark: dark), textHex(dark: dark), weightA: 0.965)
    }

    func textSecondaryHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0xA6AAB3 : 0x52555C }
        return mixHex(textHex(dark: dark), paperHex(dark: dark), weightA: dark ? 0.68 : 0.64)
    }

    func textTertiaryHex(dark: Bool) -> UInt32 {
        if presetId == "kooyu" { return dark ? 0x737882 : 0x80848E }
        return mixHex(textHex(dark: dark), paperHex(dark: dark), weightA: dark ? 0.46 : 0.48)
    }

    func accentHex(dark: Bool) -> UInt32 {
        if accentId == "default" { return textHex(dark: dark) }
        guard let opt = kyAccentOptions.first(where: { $0.id == accentId }) else { return textHex(dark: dark) }
        return dark ? opt.darkHex : opt.lightHex
    }

    func onAccentHex(dark: Bool) -> UInt32 {
        relativeLuminance(accentHex(dark: dark)) > 0.48 ? 0x121316 : 0xFFFFFF
    }

    func microCoralHex(dark: Bool) -> UInt32 {
        if accentId == "default" { return dark ? 0xF17561 : 0xE6533C }
        return accentHex(dark: dark)
    }

    var contrastMultiplier: CGFloat { highContrast ? 1.55 : 1.0 }

    static func loadFromDefaults() -> KYPaletteSnapshot {
        let defaults = UserDefaults.standard
        let preset = defaults.string(forKey: "kooyu.ap.preset") ?? "kooyu"
        let accent = defaults.string(forKey: "kooyu.ap.accent") ?? "default"
        let contrast = defaults.bool(forKey: "kooyu.ap.highContrast")
        return KYPaletteSnapshot(presetId: preset, accentId: accent, highContrast: contrast)
    }
}

private enum KYPaletteStorage {
    static let lock = OSAllocatedUnfairLock(initialState: KYPaletteSnapshot.loadFromDefaults())

    static var current: KYPaletteSnapshot {
        lock.withLock { $0 }
    }

    static func update(_ next: KYPaletteSnapshot) {
        lock.withLock { $0 = next }
    }
}

/// Observable appearance store synchronized with `UserDefaults` and `KY` dynamic colors.
@Observable @MainActor
final class AppearanceStore {
    static let shared = AppearanceStore()

    var themeMode: String
    var presetId: String
    var accentId: String
    var highContrast: Bool
    var revision: Int = 0

    private init() {
        let defaults = UserDefaults.standard
        let savedMode = defaults.string(forKey: "kooyu.appearance") ?? "system"
        self.themeMode = ["system", "light", "dark"].contains(savedMode) ? savedMode : "system"
        let snap = KYPaletteSnapshot.loadFromDefaults()
        self.presetId = snap.presetId
        self.accentId = snap.accentId
        self.highContrast = snap.highContrast
        KYPaletteStorage.update(snap)
    }

    var preferredColorScheme: ColorScheme? {
        switch themeMode {
        case "dark": return .dark
        case "light": return .light
        default: return nil
        }
    }

    var isModified: Bool {
        presetId != "kooyu" || accentId != "default" || highContrast
    }

    func setThemeMode(_ mode: String) {
        guard ["system", "light", "dark"].contains(mode) else { return }
        themeMode = mode
        UserDefaults.standard.set(mode, forKey: "kooyu.appearance")
    }

    func selectPreset(_ id: String) {
        guard let preset = kyThemePresets.first(where: { $0.id == id }) else { return }
        presetId = preset.id
        accentId = preset.accentId
        persistAndNotify()
    }

    func selectAccent(_ id: String) {
        guard kyAccentOptions.contains(where: { $0.id == id }) else { return }
        accentId = id
        persistAndNotify()
    }

    func setHighContrast(_ enabled: Bool) {
        highContrast = enabled
        persistAndNotify()
    }

    func reset() {
        presetId = "kooyu"
        accentId = "default"
        highContrast = false
        persistAndNotify()
    }

    private func persistAndNotify() {
        let defaults = UserDefaults.standard
        defaults.set(presetId, forKey: "kooyu.ap.preset")
        defaults.set(accentId, forKey: "kooyu.ap.accent")
        defaults.set(highContrast, forKey: "kooyu.ap.highContrast")
        KYPaletteStorage.update(KYPaletteSnapshot(presetId: presetId, accentId: accentId, highContrast: highContrast))
        revision += 1
    }
}

private func dynamicKY(_ resolve: @escaping @Sendable (KYPaletteSnapshot, Bool) -> UIColor) -> Color {
    Color(uiColor: UIColor { traits in
        let isDark = traits.userInterfaceStyle == .dark
        return resolve(KYPaletteStorage.current, isDark)
    })
}

/// Unified Kooyu tokens — Canonical 极简墨白 palette synced 1:1 with Web (`tokens.css`) and Android (`Theme.kt`):
/// Light `#F5F5F7 / #FFFFFF / #F2F3F6 / #141518` · Dark `#0B0C0E / #121316 / #20232B / #F3F4F6`.
/// `accent` is monochrome control ink (or user-selected accent); `brandCoral` is reserved for micro-accents only.
enum KY {
    static var navigator: Color { dynamicKY { uiColor($0.navigatorHex(dark: $1)) } }
    static var paper: Color { dynamicKY { uiColor($0.paperHex(dark: $1)) } }
    static var raised: Color { dynamicKY { uiColor($0.raisedHex(dark: $1)) } }
    static var sunken: Color { dynamicKY { uiColor($0.sunkenHex(dark: $1)) } }
    static var glass: Color { dynamicKY { uiColor($0.paperHex(dark: $1), alpha: $1 ? 0.84 : 0.86) } }
    static var bubble: Color { dynamicKY { uiColor($0.bubbleHex(dark: $1)) } }
    static var capsule: Color { dynamicKY { uiColor($0.capsuleHex(dark: $1)) } }
    static var text: Color { dynamicKY { uiColor($0.textHex(dark: $1)) } }
    static var textSecondary: Color { dynamicKY { uiColor($0.textSecondaryHex(dark: $1)) } }
    static var textTertiary: Color { dynamicKY { uiColor($0.textTertiaryHex(dark: $1)) } }
    static var borderSubtle: Color { dynamicKY { uiColor($0.textHex(dark: $1), alpha: min(0.35, 0.065 * $0.contrastMultiplier)) } }
    static var border: Color { dynamicKY { uiColor($0.textHex(dark: $1), alpha: min(0.45, ($1 ? 0.11 : 0.10) * $0.contrastMultiplier)) } }
    static var borderStrong: Color { dynamicKY { uiColor($0.textHex(dark: $1), alpha: min(0.60, ($1 ? 0.19 : 0.18) * $0.contrastMultiplier)) } }
    static var accent: Color { dynamicKY { uiColor($0.accentHex(dark: $1)) } }
    static var onAccent: Color { dynamicKY { uiColor($0.onAccentHex(dark: $1)) } }
    static var accentTint: Color { dynamicKY { uiColor($0.accentHex(dark: $1), alpha: $1 ? 0.14 : 0.08) } }
    static var brandCoral: Color { dynamicKY { uiColor($0.microCoralHex(dark: $1)) } }
    static var brandCoralTint: Color { dynamicKY { uiColor($0.microCoralHex(dark: $1), alpha: $1 ? 0.18 : 0.11) } }
    /// Coral used as text on paper (higher contrast than `brandCoral`).
    static var coralInk: Color { dynamicKY { $0.accentId == "default" ? uiColor($1 ? 0xFF9B8A : 0xC2422F) : uiColor($0.accentHex(dark: $1)) } }
    static let success = Color(light: 0x16A34A, dark: 0x34D399)
    static let successTint = Color(light: 0x16A34A, dark: 0x34D399, lightAlpha: 0.11, darkAlpha: 0.14)
    static let doneText = Color(light: 0x15803D, dark: 0x4ADE80)
    static let info = Color(light: 0xD97706, dark: 0xF59E0B)
    static let infoTint = Color(light: 0xD97706, dark: 0xF59E0B, lightAlpha: 0.11, darkAlpha: 0.14)
    /// Amber used as text on paper (status words next to the running dot).
    static let infoText = Color(light: 0xB45309, dark: 0xFBBF24)
    static let destructive = Color(light: 0xDC2626, dark: 0xF87171)
    static let destructiveTint = Color(light: 0xDC2626, dark: 0xF87171, lightAlpha: 0.10, darkAlpha: 0.15)
}

/// Typography scale (§2.2). Fixed point sizes, matching the existing `.system(size:)` usage across the app.
enum KYFont {
    static let pageTitle = Font.system(size: 20, weight: .bold)
    static let sectionHeader = Font.system(size: 12, weight: .semibold)
    static let rowTitle = Font.system(size: 14, weight: .semibold)
    static let body = Font.system(size: 15)
    static let label = Font.system(size: 13, weight: .medium)
    static let caption = Font.system(size: 11, weight: .medium).monospacedDigit()
    static let mono = Font.system(size: 12, design: .monospaced)
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
    "antigravity": visual("Antigravity", "A", tint: 0x5482CE, tintA: 0.14, ink: 0x234C94, darkTint: 0x5F80B9, darkTintA: 0.22, darkInk: 0xBAD1FF),
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
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(KYMotion.snap, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == KooyuButtonStyle {
    static var kooyuPrimary: KooyuButtonStyle { KooyuButtonStyle() }
    static var kooyuSecondary: KooyuButtonStyle { KooyuButtonStyle(prominent: false) }
}

import SwiftUI

/// Motion System 2.0 ("Fluid, Inevitable, Unnoticed") — 1:1 aligned with Web CSS linear() & Android `KooyuMotion`.
/// Compose `spring(dampingRatio = ζ, stiffness = k)` with unit mass maps to SwiftUI
/// `.spring(response: 2π / √k, dampingFraction: ζ)`.
/// Computed (not stored) so Swift 6 strict concurrency never has to reason about a global `Animation`.
enum KYMotion {
    /// Snap: ζ 1.00, k 780. Press feedback, toggles, chevrons (zero overshoot).
    static var snap: Animation { .spring(response: 0.225, dampingFraction: 1.0) }
    /// Glide: ζ 0.90, k 540. Segmented pill thumb, horizontal sliding indicators.
    static var glide: Animation { .spring(response: 0.270, dampingFraction: 0.90) }
    /// Base: ζ 0.94, k 460. Tool / reasoning disclosure, message entry, list changes.
    static var base: Animation { .spring(response: 0.293, dampingFraction: 0.94) }
    /// Panel: ζ 0.96, k 360. Sheets, inspector, page-level push transitions.
    static var panel: Animation { .spring(response: 0.331, dampingFraction: 0.96) }
    /// Morph: ζ 0.80, k 620. Composer send ↔ stop button morph (crisp ~1.5% settle).
    static var morph: Animation { .spring(response: 0.252, dampingFraction: 0.80) }
    /// Exit: 160 ms fast ease-in dismissal without lingering spring tail.
    static var exit: Animation { .timingCurve(0.32, 0, 0.67, 0, duration: 0.16) }
    /// Pulse: 1400 ms sine-like breathing cycle (700 ms each way).
    static var pulse: Animation { .easeInOut(duration: 0.7).repeatForever(autoreverses: true) }
}

/// Tactile press scale (§3.2.1): Snap spring to `scale` while pressed, light haptic on press-down.
/// Respects Reduce Motion (no scale) and leaves the label's own colors untouched.
struct KooyuPressStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    var haptic = true
    /// Dim the label while disabled (custom styles get no system disabled look). Off for labels that draw their own.
    var dims = true
    init(scale: CGFloat = 0.96, haptic: Bool = true, dims: Bool = true) { self.scale = scale; self.haptic = haptic; self.dims = dims }
    func makeBody(configuration: Configuration) -> some View {
        KooyuPressBody(configuration: configuration, scale: scale, haptic: haptic, dims: dims)
    }
}

private struct KooyuPressBody: View {
    let configuration: ButtonStyleConfiguration
    let scale: CGFloat
    let haptic: Bool
    let dims: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    var body: some View {
        let pressed = configuration.isPressed
        let enabled = haptic
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(pressed && !reduceMotion ? scale : 1)
            .opacity(dims && !isEnabled ? 0.45 : pressed ? 0.9 : 1)
            .animation(KYMotion.snap, value: pressed)
            .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: pressed) { _, now in enabled && now }
    }
}

extension ButtonStyle where Self == KooyuPressStyle {
    static var kooyuPress: KooyuPressStyle { KooyuPressStyle() }
}

/// Breathing opacity for "running" indicators (§3.1 Pulse). Static when Reduce Motion is on.
struct KooyuPulse: ViewModifier {
    let active: Bool
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .opacity(active && dim && !reduceMotion ? 0.4 : 1)
            .onAppear { if active { withAnimation(KYMotion.pulse) { dim = true } } }
            .onChange(of: active) { _, on in
                if on { withAnimation(KYMotion.pulse) { dim = true } } else { withAnimation(.default) { dim = false } }
            }
    }
}

extension View {
    func kooyuPulse(_ active: Bool) -> some View { modifier(KooyuPulse(active: active)) }
}

extension AnyTransition {
    /// New message entry (§3.2.3): rise 8 pt and fade in.
    static var kooyuEntry: AnyTransition {
        .asymmetric(insertion: .offset(x: 0, y: 8).combined(with: .opacity), removal: .opacity)
    }
}

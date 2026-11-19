import SwiftUI

struct SegmentOption<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    var badge: Int? = nil
    var id: Value { value }
}

/// Sliding-pill segmented control (§3.2.2): a raised thumb follows the selection with the Snap spring
/// on a sunken track, instead of the background flashing. Selection haptic on change.
struct KooyuSegmentedControl<Value: Hashable>: View {
    let options: [SegmentOption<Value>]
    @Binding var selection: Value
    var height: CGFloat = 36
    @Namespace private var thumbSpace

    var body: some View {
        let inner = height - 6
        HStack(spacing: 0) {
            ForEach(options) { option in
                let selected = option.value == selection
                Button {
                    guard !selected else { return }
                    withAnimation(KYMotion.glide) { selection = option.value }
                } label: {
                    HStack(spacing: 5) {
                        Text(option.label).font(KYFont.label).lineLimit(1).minimumScaleFactor(0.85)
                        if let badge = option.badge, badge > 0 {
                            Text("\(badge)").font(KYFont.caption).foregroundStyle(KY.textTertiary)
                        }
                    }
                    .foregroundStyle(selected ? KY.text : KY.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: inner)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: inner * 0.38, style: .continuous)
                                .fill(KY.raised)
                                .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1)
                                .matchedGeometryEffect(id: "thumb", in: thumbSpace)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(3)
        .frame(height: height)
        .background(KY.sunken, in: RoundedRectangle(cornerRadius: height * 0.38, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: height * 0.38, style: .continuous).strokeBorder(KY.borderSubtle))
        .sensoryFeedback(.selection, trigger: selection)
    }
}

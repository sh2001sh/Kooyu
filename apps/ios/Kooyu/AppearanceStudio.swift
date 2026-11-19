import SwiftUI

/// Native iOS Appearance Studio mirroring Web (`AppearanceStudio.tsx`) and Android (`AppearanceStudio.kt`):
/// Live conversation stage preview + 3-mode switcher + 5 unified presets + 6 accent swatches + high-contrast toggle.
struct AppearanceStudioSection: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let store = AppearanceStore.shared
        let isDark = colorScheme == .dark
        Section {
            VStack(alignment: .leading, spacing: 14) {
                livePreviewCard(presetId: store.presetId)

                KooyuSegmentedControl(
                    options: [
                        SegmentOption(value: "system", label: "跟随系统"),
                        SegmentOption(value: "light", label: "浅色"),
                        SegmentOption(value: "dark", label: "深色"),
                    ],
                    selection: Binding(
                        get: { store.themeMode },
                        set: { store.setThemeMode($0) }
                    )
                )
            }
            .padding(.vertical, 4)
        } header: {
            HStack {
                Text("外观")
                Spacer()
                if store.isModified {
                    Button("恢复默认") {
                        withAnimation(KYMotion.snap) { store.reset() }
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KY.textSecondary)
                }
            }
        }

        Section("预设画板") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(kyThemePresets) { preset in
                        let selected = store.presetId == preset.id
                        let accentOpt = kyAccentOptions.first { $0.id == preset.accentId } ?? kyAccentOptions[0]
                        Button {
                            withAnimation(KYMotion.snap) { store.selectPreset(preset.id) }
                        } label: {
                            VStack(spacing: 8) {
                                paletteMedallion(
                                    bg: Color(hex: isDark ? preset.darkBg : preset.lightBg),
                                    fg: Color(hex: isDark ? preset.darkFg : preset.lightFg),
                                    dot: Color(hex: isDark ? accentOpt.darkHex : accentOpt.lightHex)
                                )
                                Text(preset.label)
                                    .font(.system(size: 12, weight: selected ? .semibold : .medium))
                                    .foregroundStyle(selected ? KY.text : KY.textSecondary)
                                    .lineLimit(1)
                            }
                            .frame(width: 82)
                            .padding(.vertical, 10)
                            .background(KY.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(selected ? KY.accent : KY.borderSubtle, lineWidth: selected ? 1.5 : 0.5)
                            )
                        }
                        .buttonStyle(.kooyuPress)
                    }
                }
                .padding(.vertical, 4)
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .listRowBackground(Color.clear)
        }

        Section("点缀强调色与对比度") {
            HStack(spacing: 0) {
                ForEach(kyAccentOptions) { opt in
                    let selected = store.accentId == opt.id
                    let swatch = Color(hex: isDark ? opt.darkHex : opt.lightHex)
                    let checkColor: Color = (isDark && opt.id == "default") ? Color(hex: 0x121316) : .white
                    Button {
                        withAnimation(KYMotion.snap) { store.selectAccent(opt.id) }
                    } label: {
                        ZStack {
                            Circle()
                                .strokeBorder(selected ? KY.text : .clear, lineWidth: 2)
                                .frame(width: 34, height: 34)
                            Circle()
                                .fill(swatch)
                                .overlay(Circle().strokeBorder(KY.border, lineWidth: 0.5))
                                .frame(width: 26, height: 26)
                            if selected {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(checkColor)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(opt.label)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }

            Toggle(
                "高对比描边",
                isOn: Binding(
                    get: { store.highContrast },
                    set: { store.setHighContrast($0) }
                )
            )
            .tint(KY.accent)
        }
    }

    @ViewBuilder
    private func livePreviewCard(presetId: String) -> some View {
        let cardShape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                EngineBadge(harnessId: "kodo", size: 20, circle: false)
                Text("Kooyu 质感实时预览")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KY.text)
                Spacer()
                Text(kyThemePresets.first { $0.id == presetId }?.label ?? "极简墨白")
                    .font(KYFont.caption)
                    .foregroundStyle(KY.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(KY.sunken, in: Capsule())
            }
            Divider().overlay(KY.borderSubtle)
            HStack {
                Spacer(minLength: 28)
                Text("保持克制的留白与通透层次。")
                    .font(.system(size: 12.5))
                    .foregroundStyle(KY.text)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .background(KY.bubble, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            HStack(spacing: 7) {
                EngineBadge(harnessId: "claude-code", size: 18, circle: false)
                Text("已同步四端极简墨白与点缀色。")
                    .font(.system(size: 12))
                    .foregroundStyle(KY.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "arrow.up")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(KY.onAccent)
                    .frame(width: 22, height: 22)
                    .background(KY.accent, in: Circle())
            }
        }
        .padding(12)
        .background(KY.paper, in: cardShape)
        .overlay(cardShape.strokeBorder(KY.border, lineWidth: 0.5))
    }

    private func paletteMedallion(bg: Color, fg: Color, dot: Color) -> some View {
        ZStack {
            Circle().fill(bg)
            Circle()
                .fill(fg)
                .clipShape(DiagonalHalf())
            Circle()
                .fill(dot)
                .frame(width: 10, height: 10)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.85), lineWidth: 1))
        }
        .frame(width: 32, height: 32)
        .overlay(Circle().strokeBorder(KY.border, lineWidth: 0.75))
    }
}

private struct DiagonalHalf: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

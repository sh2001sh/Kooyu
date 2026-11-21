import AVFoundation
import SwiftUI

struct ConversationCall: View {
    @Bindable var model: Workbench
    let sessionID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var voice = VoiceInputController()
    @State private var speaker = AVSpeechSynthesizer()
    @State private var cursor = 0
    @State private var active = false
    @State private var sending = false
    @State private var problem = ""
    @State private var status = "正在打开语音服务…"

    private var hasError: Bool { !problem.isEmpty || !voice.error.isEmpty }
    private var displayStatus: String {
        if !problem.isEmpty { return problem }
        if !voice.error.isEmpty { return voice.error }
        return voice.interim.isEmpty ? status : voice.interim
    }

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(hasError ? KY.destructiveTint : KY.brandCoralTint)
                    .frame(width: 64, height: 64)
                Image(systemName: "waveform")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(hasError ? KY.destructive : KY.brandCoral)
                    .symbolEffect(.variableColor.iterative, isActive: !hasError && active)
            }
            .padding(.top, 8)

            Text("语音通话")
                .font(.title3.weight(.semibold))
                .foregroundStyle(KY.text)

            Text(displayStatus)
                .font(.subheadline)
                .foregroundStyle(hasError ? KY.destructive : KY.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)

            Spacer(minLength: 8)

            Button(role: .destructive) {
                finish()
                dismiss()
            } label: {
                Label("结束通话", systemImage: "phone.down.fill")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: 220, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(KY.destructive)
            .clipShape(Capsule())
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KY.paper)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .task {
            cursor = model.page?.events.last?.sequence ?? 0
            active = true
            while active && !Task.isCancelled {
                guard model.selected == sessionID, model.online else { finish(); dismiss(); return }
                for event in model.page?.events ?? [] where event.sequence > cursor {
                    cursor = event.sequence
                    guard event.type == "message", ["assistant", ""].contains(event.payload["role"].string), !event.text.isEmpty else { continue }
                    voice.cancel()
                    status = "正在播报回复…"
                    speaker.speak(AVSpeechUtterance(string: event.text))
                }
                if !speaker.isSpeaking && !voice.listening && !sending && model.canWrite && problem.isEmpty {
                    status = "正在聆听…"
                    await voice.start(conversation: true) { text in
                        guard active, !speaker.isSpeaking, !sending else { return }
                        sending = true
                        status = "正在发送…"
                        Task { @MainActor in
                            if !(await model.send(text)) { problem = "设备未确认语音消息。" }
                            sending = false
                        }
                    }
                    if !voice.error.isEmpty { problem = voice.error }
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        .onDisappear { finish() }
        .onChange(of: phase) { _, value in if value == .background { finish(); dismiss() } }
    }

    private func finish() {
        active = false
        voice.cancel()
        speaker.stopSpeaking(at: .immediate)
    }
}

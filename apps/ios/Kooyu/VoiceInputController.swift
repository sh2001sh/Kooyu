import AVFoundation
import Foundation
import Observation
import Speech

func appendVoiceTranscript(_ current: String, addition: String) -> String {
    let clean = addition.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else { return current }
    guard !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return clean }
    if let last = current.last, last.isWhitespace { return current + clean }
    if let last = current.last, let first = clean.first,
       last.isASCII && (last.isLetter || last.isNumber),
       first.isASCII && (first.isLetter || first.isNumber) {
        return "\(current) \(clean)"
    }
    return current + clean
}

@MainActor private func kooyuSpeechLocaleIdentifier() -> String {
    switch LanguageStore.shared.resolvedLocale {
    case "en": return "en-US"
    case "ja": return "ja-JP"
    default: return "zh-CN"
    }
}

private func installSpeechAudioTap(
    on inputNode: AVAudioInputNode,
    format: AVAudioFormat,
    request: SFSpeechAudioBufferRecognitionRequest,
    onLevel: @escaping @Sendable (Float) -> Void
) {
    inputNode.removeTap(onBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
        onLevel(computeBufferLevel(buffer))
    }
}

private func computeBufferLevel(_ buffer: AVAudioPCMBuffer) -> Float {
    guard let channel = buffer.floatChannelData?[0] else { return 0.2 }
    let frameLength = Int(buffer.frameLength)
    guard frameLength > 0 else { return 0.2 }
    var sum: Float = 0
    for i in 0..<frameLength {
        let sample = channel[i]
        sum += sample * sample
    }
    let rms = sqrt(sum / Float(frameLength))
    let scaled = min(1.0, max(0.18, rms * 14.0))
    return scaled
}

@MainActor @Observable final class VoiceInputController {
    var listening = false
    var interim = ""
    var level: Float = 0.2
    var error = ""

    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var cancelled = false
    private var delivered = false
    private var onFinal: ((String) -> Void)?

    func toggle(onResult: @escaping (String) -> Void) {
        if listening {
            stop()
        } else {
            Task { await start(onResult: onResult) }
        }
    }

    func start(onResult: @escaping (String) -> Void) async {
        error = ""
        interim = ""
        cancelled = false
        delivered = false
        onFinal = onResult

        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
        guard speechStatus == .authorized else {
            error = kooyuT("voice.err.permission")
            return
        }
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else {
            error = kooyuT("voice.err.permission")
            return
        }

        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: kooyuSpeechLocaleIdentifier())) ?? SFSpeechRecognizer()
        guard let recognizer, recognizer.isAvailable else {
            error = kooyuT("voice.err.unavailable")
            return
        }

        cleanup()
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = kooyuT("voice.err.unavailable")
            return
        }

        let engine = AVAudioEngine()
        let recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        recognitionRequest.shouldReportPartialResults = true
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        installSpeechAudioTap(on: inputNode, format: format, request: recognitionRequest) { [weak self] lv in
            Task { @MainActor [weak self] in
                guard let self, self.listening else { return }
                self.level = lv
            }
        }

        audioEngine = engine
        request = recognitionRequest
        listening = true

        task = recognizer.recognitionTask(with: recognitionRequest) { [weak self] result, err in
            let text = result?.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let isFinal = result?.isFinal == true
            let hasError = err != nil
            Task { @MainActor [weak self] in
                guard let self else { return }
                if !text.isEmpty { self.interim = text }
                if isFinal || hasError {
                    let finalText = text.isEmpty ? self.interim.trimmingCharacters(in: .whitespacesAndNewlines) : text
                    self.finish(with: finalText)
                }
            }
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            cleanup()
            self.error = kooyuT("voice.err.unavailable")
        }
    }

    func stop() {
        guard listening else { return }
        let snapshot = interim.trimmingCharacters(in: .whitespacesAndNewlines)
        request?.endAudio()
        if !snapshot.isEmpty {
            finish(with: snapshot)
        } else {
            cleanup()
        }
    }

    func cancel() {
        cancelled = true
        interim = ""
        error = ""
        task?.cancel()
        cleanup()
    }

    func clearError() {
        error = ""
    }

    private func finish(with finalText: String) {
        let shouldDeliver = !cancelled && !delivered && !finalText.isEmpty
        if shouldDeliver { delivered = true }
        let callback = onFinal
        cleanup()
        interim = ""
        if shouldDeliver {
            callback?(finalText)
        }
    }

    private func cleanup() {
        if let engine = audioEngine {
            if engine.isRunning { engine.stop() }
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.finish()
        audioEngine = nil
        request = nil
        task = nil
        listening = false
        level = 0.2
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

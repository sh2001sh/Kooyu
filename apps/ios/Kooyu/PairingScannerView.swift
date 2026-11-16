import AVFoundation
import SwiftUI
import UIKit
import VisionKit

@MainActor
struct PairingScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var ready = false
    @State private var message = ""
    @State private var showSettings = false
    @State private var attempt = 0
    let onInvitation: (PairingInvitation) -> Void
    let onManual: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if ready {
                    CameraScanner(onCode: { text in
                        ready = false
                        do { onInvitation(try PairingInvitation.parse(text)); dismiss() }
                        catch { message = error.localizedDescription }
                    }, onFailure: { detail in ready = false; message = detail })
                    .accessibilityLabel("二维码相机预览")
                } else if !message.isEmpty {
                    ContentUnavailableView {
                        Label("扫描未完成", systemImage: "qrcode.viewfinder")
                    } description: { Text(message) } actions: {
                        if showSettings {
                            Button("打开权限设置") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }.buttonStyle(.kooyuPrimary)
                        }
                        Button("重试") { attempt += 1 }
                        Button("返回手动输入") { onManual(); dismiss() }
                    }
                } else {
                    Spacer()
                    ProgressView("正在准备相机")
                    Spacer()
                }
                Text("图像仅在本机识别，不会上传").font(.footnote).foregroundStyle(.secondary).padding(.bottom)
            }
            .navigationTitle("扫描桌面二维码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
            .task(id: "\(phase == .active)-\(attempt)") {
                ready = false
                guard phase == .active else { return }
                await prepareCamera()
            }
        }
    }

    private func prepareCamera() async {
        message = ""
        showSettings = false
        guard DataScannerViewController.isSupported else {
            message = "此设备不支持实时扫码，请返回手动输入连接信息。"
            return
        }
        var authorization = AVCaptureDevice.authorizationStatus(for: .video)
        if authorization == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
            guard !Task.isCancelled else { return }
            authorization = AVCaptureDevice.authorizationStatus(for: .video)
        }
        guard !Task.isCancelled else { return }
        guard authorization == .authorized else {
            showSettings = authorization == .denied
            message = authorization == .restricted
                ? "系统限制了相机使用，请返回手动输入连接信息。"
                : "未允许使用相机。可以在设置中允许，或返回手动输入。"
            return
        }
        guard DataScannerViewController.isAvailable else {
            message = "相机暂时不可用，请关闭其他相机应用后重试，或返回手动输入。"
            return
        }
        ready = true
    }
}

@MainActor
private struct CameraScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    let onFailure: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(onCode: onCode, onFailure: onFailure) }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ controller: ScannerController, coordinator: ()) { controller.stop() }
}

/// VisionKit's camera and delegate are main-actor isolated; no capture objects cross executors.
@MainActor
private final class ScannerController: UIViewController, DataScannerViewControllerDelegate {
    private let scanner = DataScannerViewController(
        recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
        recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
        isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true)
    private let onCode: (String) -> Void
    private let onFailure: (String) -> Void
    private var delivered = false

    init(onCode: @escaping (String) -> Void, onFailure: @escaping (String) -> Void) {
        self.onCode = onCode
        self.onFailure = onFailure
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Not used with storyboards") }

    override func viewDidLoad() {
        super.viewDidLoad()
        scanner.delegate = self
        addChild(scanner)
        scanner.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scanner.view)
        NSLayoutConstraint.activate([
            scanner.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scanner.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scanner.view.topAnchor.constraint(equalTo: view.topAnchor),
            scanner.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        scanner.didMove(toParent: self)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !delivered else { return }
        do { try scanner.startScanning() }
        catch { stop(); onFailure("无法启动相机，请重试或返回手动输入。") }
    }
    override func viewWillDisappear(_ animated: Bool) { stop(); super.viewWillDisappear(animated) }
    func stop() { scanner.stopScanning() }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems {
            guard !delivered else { return }
            if case .barcode(let barcode) = item, let text = barcode.payloadStringValue {
                delivered = true
                stop()
                onCode(text)
            }
        }
    }
    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
        guard !delivered else { return }
        stop()
        onFailure("相机连接已中断，请重试或返回手动输入。")
    }
}

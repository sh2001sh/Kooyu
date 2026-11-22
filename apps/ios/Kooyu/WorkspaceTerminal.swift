import SwiftUI
import WebKit

@MainActor
struct WorkspaceTerminalView: View {
    let connection: Connection
    let workspaceID: String
    @State private var surface: WKWebView?
    @State private var pending = ""
    @State private var error = ""
    @State private var accepting = false

    private let shortcuts: [(String, String)] = [
        ("Ctrl+C", "\u{0003}"),
        ("Tab", "\t"),
        ("↑", "\u{001B}[A"),
        ("↓", "\u{001B}[B"),
        ("Esc", "\u{001B}"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(shortcuts, id: \.0) { label, seq in
                        Button {
                            enqueue(seq)
                        } label: {
                            Text(label)
                                .font(.caption.monospaced().weight(.medium))
                                .foregroundStyle(KY.text)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(KY.sunken, in: RoundedRectangle(cornerRadius: 7))
                                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(KY.borderSubtle, lineWidth: 0.5))
                        }
                        .buttonStyle(.plain)
                        .disabled(!accepting)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .background(KY.raised)
            .overlay(alignment: .bottom) { Divider() }

            TerminalSurface(ready: { surface = $0 }, input: enqueue, failed: { error = $0 })

            if !error.isEmpty {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(KY.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(KY.destructiveTint)
            }
        }
        .background(KY.navigator)
        .navigationTitle("工作区终端")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: surface.map(ObjectIdentifier.init)) {
            guard let view = surface else { return }
            let api = HostAPI(connection: connection)
            var endpoint: String?
            do {
                let opened: JSONValue = try await api.perform("/terminals", method: "POST", body: .object(["workspaceId": .string(workspaceID)]))
                let path = "/terminals/" + opened["id"].string
                endpoint = path
                let _: JSONValue = try await api.perform(path, method: "POST", body: .object(["cols": .number(44), "rows": .number(18)]))
                accepting = true
                var cursor = 0
                while !Task.isCancelled {
                    if !pending.isEmpty {
                        let batch = pending
                        pending = ""
                        let _: JSONValue = try await api.perform(path, method: "POST", body: .object(["data": .string(batch)]))
                    }
                    let update: JSONValue = try await api.get(path + "?cursor=" + String(cursor))
                    cursor = Int(update["cursor"].number ?? 0)
                    let text = update["text"].string, reset = update["reset"].boolean
                    if !text.isEmpty || reset {
                        _ = try await view.callAsyncJavaScript("window.renderTerminal(text, reset)", arguments: ["text": text, "reset": reset], in: nil, contentWorld: .page)
                    }
                    if update["closed"].boolean { break }
                    try await Task.sleep(for: .milliseconds(200))
                }
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            accepting = false
            if let endpoint {
                await Task {
                    let _: JSONValue? = try? await api.perform(endpoint, method: "DELETE", timeout: 3)
                }.value
            }
        }
    }

    private func enqueue(_ text: String) {
        guard accepting else { return }
        if pending.utf16.count + text.utf16.count <= 16384 {
            pending += text
        } else {
            error = "终端输入过多，请核对内容后重试。"
        }
    }
}

@MainActor
private struct TerminalSurface: UIViewRepresentable {
    let ready: (WKWebView) -> Void
    let input: (String) -> Void
    let failed: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(context.coordinator, name: "terminalInput")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "TerminalAssets") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else { Task { failed("终端资源缺失。") } }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "terminalInput")
        view.navigationDelegate = nil
        view.stopLoading()
    }
    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let owner: TerminalSurface
        init(_ owner: TerminalSurface) { self.owner = owner }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "TerminalAssets")
            decisionHandler(page != nil && action.request.url == page && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { owner.ready(webView) }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.frameInfo.isMainFrame, let data = message.body as? String { owner.input(data) }
        }
    }
}

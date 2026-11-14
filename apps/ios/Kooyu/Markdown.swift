import SwiftUI
import UIKit

/// Block-level Markdown (GFM subset used by agents). Inline spans go through AttributedString.
indirect enum MarkdownBlock: Hashable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case code(language: String, code: String)
    case quote([MarkdownBlock])
    case list(ordered: Bool, start: Int, items: [MarkdownListItem])
    case table(header: [String], rows: [[String]])
    case rule
}

struct MarkdownListItem: Hashable, Sendable {
    let checked: Bool?
    let blocks: [MarkdownBlock]
}

nonisolated(unsafe) private let fenceRegex = try! NSRegularExpression(pattern: #"^ {0,3}(`{3,}|~{3,})\s*([^`\s]*).*$"#)
nonisolated(unsafe) private let headingRegex = try! NSRegularExpression(pattern: #"^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$"#)
nonisolated(unsafe) private let ruleRegex = try! NSRegularExpression(pattern: #"^ {0,3}([-*_])(\s*\1){2,}\s*$"#)
nonisolated(unsafe) private let listRegex = try! NSRegularExpression(pattern: #"^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$"#)
nonisolated(unsafe) private let tableSeparatorRegex = try! NSRegularExpression(pattern: #"^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$"#)

private func groups(_ regex: NSRegularExpression, _ line: String) -> [String]? {
    let ns = line as NSString
    guard let m = regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { return nil }
    return (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
}

private func leadingSpaces(_ line: String) -> Int {
    var n = 0
    for c in line { if c == " " { n += 1 } else if c == "\t" { n += 4 } else { break } }
    return n
}

private func dropIndent(_ line: String, _ count: Int) -> String {
    var removed = 0, index = line.startIndex
    while index < line.endIndex, removed < count, line[index] == " " || line[index] == "\t" {
        removed += line[index] == "\t" ? 4 : 1
        index = line.index(after: index)
    }
    return String(line[index...])
}

private func tableCells(_ line: String) -> [String] {
    var t = line.trimmingCharacters(in: .whitespaces)
    if t.hasPrefix("|") { t.removeFirst() }
    if t.hasSuffix("|") && !t.hasSuffix("\\|") { t.removeLast() }
    var cells: [String] = [], current = "", escaped = false
    for c in t {
        if escaped { current.append(c); escaped = false; continue }
        if c == "\\" { escaped = true; current.append(c); continue }
        if c == "|" { cells.append(current.trimmingCharacters(in: .whitespaces)); current = "" } else { current.append(c) }
    }
    cells.append(current.trimmingCharacters(in: .whitespaces))
    return cells.map { $0.replacingOccurrences(of: "\\|", with: "|") }
}

func parseMarkdown(_ text: String) -> [MarkdownBlock] {
    parseLines(text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n"))
}

private func startsBlock(_ line: String, next: String?) -> Bool {
    groups(fenceRegex, line) != nil || groups(headingRegex, line) != nil || groups(ruleRegex, line) != nil
        || line.trimmingCharacters(in: .whitespaces).hasPrefix(">") || groups(listRegex, line) != nil
        || (line.contains("|") && next.map { groups(tableSeparatorRegex, $0) != nil && $0.contains("-") } == true)
}

private func parseLines(_ lines: [String]) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    var i = 0
    while i < lines.count {
        let line = lines[i]
        if line.trimmingCharacters(in: .whitespaces).isEmpty { i += 1; continue }
        if let fence = groups(fenceRegex, line) {
            let marker = fence[1]
            var body: [String] = []
            i += 1
            while i < lines.count {
                let t = lines[i].trimmingCharacters(in: .whitespaces)
                if t.count >= marker.count, t.allSatisfy({ $0 == marker.first }) { i += 1; break }
                body.append(lines[i]); i += 1
            }
            blocks.append(.code(language: fence[2], code: body.joined(separator: "\n")))
            continue
        }
        if let h = groups(headingRegex, line) { blocks.append(.heading(level: h[1].count, text: h[2])); i += 1; continue }
        if groups(ruleRegex, line) != nil { blocks.append(.rule); i += 1; continue }
        if line.trimmingCharacters(in: .whitespaces).hasPrefix(">") {
            var inner: [String] = []
            while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                var t = lines[i].trimmingCharacters(in: .whitespaces); t.removeFirst()
                if t.hasPrefix(" ") { t.removeFirst() }
                inner.append(t); i += 1
            }
            blocks.append(.quote(parseLines(inner)))
            continue
        }
        if line.contains("|"), i + 1 < lines.count, lines[i + 1].contains("-"), groups(tableSeparatorRegex, lines[i + 1]) != nil {
            let header = tableCells(line)
            var rows: [[String]] = []
            i += 2
            while i < lines.count, lines[i].contains("|"), !lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
                var cells = tableCells(lines[i])
                if cells.count < header.count { cells += Array(repeating: "", count: header.count - cells.count) }
                rows.append(Array(cells.prefix(header.count))); i += 1
            }
            blocks.append(.table(header: header, rows: rows))
            continue
        }
        if let first = groups(listRegex, line) {
            let baseIndent = leadingSpaces(first[1])
            let ordered = first[2].first?.isNumber == true
            let start = ordered ? Int(first[2].dropLast()) ?? 1 : 1
            var items: [MarkdownListItem] = []
            var current: [String] = []
            var contentIndent = baseIndent + first[2].count + 1
            func closeItem() {
                guard !current.isEmpty else { return }
                var lines = current
                var checked: Bool? = nil
                let head = lines[0]
                if head.hasPrefix("[ ] ") || head == "[ ]" { checked = false; lines[0] = String(head.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
                else if head.lowercased().hasPrefix("[x] ") || head.lowercased() == "[x]" { checked = true; lines[0] = String(head.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
                items.append(MarkdownListItem(checked: checked, blocks: parseLines(lines)))
                current = []
            }
            var previousBlank = false
            while i < lines.count {
                let l = lines[i]
                if l.trimmingCharacters(in: .whitespaces).isEmpty {
                    // A blank line continues the list only if the next line is indented into the item or is another marker.
                    if i + 1 < lines.count, leadingSpaces(lines[i + 1]) > baseIndent || (groups(listRegex, lines[i + 1]).map { leadingSpaces($0[1]) == baseIndent } ?? false) {
                        current.append(""); previousBlank = true; i += 1; continue
                    }
                    break
                }
                if let m = groups(listRegex, l), leadingSpaces(m[1]) <= baseIndent + 1 {
                    if (m[2].first?.isNumber == true) != ordered { break }
                    closeItem()
                    contentIndent = leadingSpaces(m[1]) + m[2].count + 1
                    current = [m[3]]
                } else if leadingSpaces(l) >= min(contentIndent, baseIndent + 2) {
                    current.append(dropIndent(l, contentIndent))
                } else if !previousBlank, !startsBlock(l, next: i + 1 < lines.count ? lines[i + 1] : nil) {
                    current.append(l.trimmingCharacters(in: .whitespaces))
                } else { break }
                previousBlank = false
                i += 1
            }
            closeItem()
            blocks.append(.list(ordered: ordered, start: start, items: items))
            continue
        }
        var paragraph: [String] = []
        while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
            if !paragraph.isEmpty, startsBlock(lines[i], next: i + 1 < lines.count ? lines[i + 1] : nil) { break }
            paragraph.append(lines[i].trimmingCharacters(in: .whitespaces)); i += 1
        }
        blocks.append(.paragraph(paragraph.joined(separator: "\n")))
    }
    return blocks
}

/// Inline Markdown (bold, italic, code, strike, links) with desktop styling for code spans and links.
func inlineMarkdown(_ text: String) -> AttributedString {
    var result = (try? AttributedString(markdown: text, options: .init(allowsExtendedAttributes: true, interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible))) ?? AttributedString(text)
    for run in result.runs {
        if let intent = run.inlinePresentationIntent, intent.contains(.code) {
            result[run.range][AttributeScopes.SwiftUIAttributes.FontAttribute.self] = Font.system(size: 13.5, design: .monospaced)
            result[run.range][AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] = KY.sunken
        }
        if run.link != nil {
            result[run.range][AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute.self] = Text.LineStyle(pattern: .solid)
            result[run.range][AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = KY.text
        }
    }
    return result
}

@MainActor private enum MarkdownCache {
    static var store: [String: [MarkdownBlock]] = [:]
    static func blocks(_ text: String) -> [MarkdownBlock] {
        if let hit = store[text] { return hit }
        if store.count > 400 { store.removeAll() }
        let parsed = parseMarkdown(text)
        store[text] = parsed
        return parsed
    }
}

struct MarkdownView: View {
    let text: String
    /// false inside user bubbles so short messages keep their natural width.
    var fill = true
    var body: some View {
        MarkdownBlocksView(blocks: MarkdownCache.blocks(text), fill: fill)
    }
}

struct MarkdownBlocksView: View {
    let blocks: [MarkdownBlock]
    var fill = true
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block)
            }
        }
        .frame(maxWidth: fill ? .infinity : nil, alignment: .leading)
    }
}

private func headingSize(_ level: Int) -> CGFloat {
    switch level { case 1: 21; case 2: 19; case 3: 17; case 4: 16; default: 15 }
}

struct MarkdownBlockView: View {
    let block: MarkdownBlock
    var body: some View {
        switch block {
        case .heading(let level, let text):
            Text(inlineMarkdown(text))
                .font(.system(size: headingSize(level), weight: level <= 2 ? .bold : .semibold))
                .foregroundStyle(KY.text)
                .padding(.top, level <= 2 ? 6 : 2)
                .textSelection(.enabled)
        case .paragraph(let text):
            Text(inlineMarkdown(text))
                .font(.system(size: 15))
                .lineSpacing(5)
                .foregroundStyle(KY.text)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case .code(let language, let code):
            CodeBlockView(language: language, code: code)
        case .quote(let inner):
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 1.5).fill(KY.borderStrong).frame(width: 3)
                MarkdownBlocksView(blocks: inner).foregroundStyle(KY.textSecondary)
            }
            .padding(.vertical, 6).padding(.trailing, 10)
            .background(KY.sunken.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Group {
                            if let checked = item.checked {
                                Image(systemName: checked ? "checkmark.square.fill" : "square").foregroundStyle(checked ? KY.text : KY.textTertiary)
                            } else if ordered {
                                Text("\(start + index).").monospacedDigit()
                            } else {
                                Text("•")
                            }
                        }
                        .font(.system(size: 15))
                        .foregroundStyle(KY.textSecondary)
                        .frame(minWidth: 14, alignment: .trailing)
                        MarkdownBlocksView(blocks: item.blocks)
                    }
                }
            }
        case .table(let header, let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                            Text(inlineMarkdown(cell)).font(.system(size: 13, weight: .semibold)).padding(.horizontal, 12).padding(.vertical, 7)
                                .frame(maxWidth: 280, alignment: .leading).background(KY.sunken)
                        }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        Divider().overlay(KY.borderSubtle)
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(inlineMarkdown(cell)).font(.system(size: 13)).padding(.horizontal, 12).padding(.vertical, 7)
                                    .frame(maxWidth: 280, alignment: .leading)
                            }
                        }
                    }
                }
                .foregroundStyle(KY.text)
                .textSelection(.enabled)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(KY.borderSubtle))
            }
        case .rule:
            Rectangle().fill(KY.border).frame(height: 1).padding(.vertical, 4)
        }
    }
}

struct CopyButton: View {
    let text: String
    var label = "复制"
    @State private var copied = false
    init(text: String, label: String = "复制") { self.text = text; self.label = label }
    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
            Task { try? await Task.sleep(for: .seconds(1.4)); copied = false }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(copied ? KY.success : KY.textTertiary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(copied ? "已复制" : label)
    }
}

struct CodeBlockView: View {
    let language: String
    let code: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language).font(.system(size: 11, design: .monospaced)).foregroundStyle(KY.textTertiary)
                Spacer()
                CopyButton(text: code, label: "复制代码")
            }
            .padding(.leading, 13).padding(.trailing, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12.5, design: .monospaced))
                    .lineSpacing(3)
                    .foregroundStyle(KY.text)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(.horizontal, 13).padding(.bottom, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KY.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(KY.borderSubtle))
    }
}

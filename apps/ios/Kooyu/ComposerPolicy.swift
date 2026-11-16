import Foundation

func providerReasoningLevels(_ p: JSONValue, _ harness: String) -> [String] {
    let sdk = ["kodo", "pi", "deepseek-harness"].contains(harness)
    if case .bool(false) = p["reasoning"] { return sdk ? ["off"] : [] }
    if sdk, case .object(let mapping) = p["thinkingLevelMap"] {
        let order = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        return order.filter { key in guard let value = mapping[key] else { return false }; if case .null = value { return false }; return true }
    }
    let declared = p["reasoningOptions"].array.filter { $0["type"].string == "effort" }.flatMap { $0["values"].array.map(\.string) }
    let mapped = declared.map { value in sdk && value == "none" ? "off" : harness == "zcode" && ["none", "off"].contains(value) ? "disabled" : value }
    let allowed: [String]?
    if sdk { allowed = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] }
    else if harness == "gemini" { allowed = ["minimal", "low", "medium", "high"] }
    else if harness == "grok-build" { allowed = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] }
    else { allowed = nil }
    return mapped.reduce(into: [String]()) { result, value in if !result.contains(value) && (allowed == nil || allowed!.contains(value)) { result.append(value) } }
}

func pendingUserMessages(_ commands: [JSONValue]) -> [JSONValue] {
    commands.filter { $0["kind"].string == "send" && $0["origin"].string == "user" && $0["status"].string == "accepted" && $0["body"]["mode"].string != "new" }
}

func composerModelMatches(_ model: JSONValue, _ current: String) -> Bool {
    guard !current.isEmpty else { return false }
    return model["id"].string == current || model["resolvedModel"].string.nonEmpty == current ||
        (!model["provider"].string.isEmpty && model["provider"].string + "/" + model["id"].string == current)
}
func selectComposerModel(_ models: [JSONValue], _ current: String, inherited: Bool) -> JSONValue? {
    let matches = models.filter { composerModelMatches($0, current) }
    if let match = matches.first(where: { if case .array = $0["reasoning"] { return true }; return false }) ?? matches.first { return match }
    guard inherited, let fallback = models.first(where: { $0["isCurrent"].boolean }) ?? models.first(where: { $0["isDefault"].boolean }) else { return nil }
    return models.first { candidate in
        guard composerModelMatches(candidate, fallback["id"].string), candidate["provider"].string == fallback["provider"].string else { return false }
        if case .array = candidate["reasoning"] { return true }; return false
    } ?? fallback
}
func composerDefaultModel(_ value: JSONValue?) -> String? {
    guard let value, !value["model"].string.isEmpty else { return nil }
    return value["provider"].string.isEmpty ? value["model"].string : value["provider"].string + "/" + value["model"].string
}
func reasoningModelTarget(_ current: String, selected: JSONValue?, harness: String, bound: Bool) -> String? {
    guard let selected, !composerModelMatches(selected, current) else { return current.nonEmpty }
    return bound ? selected["id"].string : nativeModelID(harness, selected)
}
func composerReasoningLevels(_ selected: JSONValue?, binding: JSONValue?, current: String, harness: String) -> [String] {
    if let selected, case .array = selected["reasoning"] { return selected["reasoning"].array.map(\.string) }
    guard let binding, current.isEmpty || current == binding["model"].string else { return [] }
    return providerReasoningLevels(binding["parameters"], harness)
}

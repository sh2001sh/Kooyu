import SwiftUI

struct PlanTiming {
    var mode = "daily", time = "09:00", date = "", weekdays = [1], day = 1
    var every = "1", unit = "hours", startAt = "", expression = "0 9 * * 1", legacyOnce = ""
    init(_ trigger: JSONValue) {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        date = formatter.string(from: Date())
        switch trigger["kind"].string {
        case "calendar":
            mode = trigger["frequency"].string; time = trigger["time"].string
            if !trigger["date"].string.isEmpty { date = trigger["date"].string }
            if !trigger["weekdays"].array.isEmpty { weekdays = trigger["weekdays"].array.compactMap { $0.number.map(Int.init) } }
            day = Int(trigger["dayOfMonth"].number ?? 1)
        case "interval": mode = "interval"; every = String(Int(trigger["every"].number ?? 1)); unit = trigger["unit"].string; startAt = trigger["startAt"].string
        case "once": mode = "once"; legacyOnce = trigger["at"].string
        case "webhook": mode = "webhook"
        default:
            expression = trigger["expression"].string
            let fields = expression.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            mode = "custom"
            if fields.count == 5, let minute = Int(fields[0]), let hour = Int(fields[1]), (0...59).contains(minute), (0...23).contains(hour), fields[3] == "*" {
                time = String(format: "%02d:%02d", hour, minute)
                if fields[2] == "*" {
                    if fields[4] == "*" { mode = "daily" }
                    else if fields[4] == "1-5" { mode = "weekdays" }
                    else {
                        let days = fields[4].split(separator: ",").compactMap { Int($0) }
                        if days.count == fields[4].split(separator: ",").count && !days.isEmpty && days.allSatisfy({ (0...7).contains($0) }) { mode = "weekly"; weekdays = Array(Set(days.map { $0 % 7 })).sorted() }
                    }
                } else if fields[4] == "*", let number = Int(fields[2]), (1...31).contains(number) { mode = "monthly"; day = number }
            }
        }
    }
    func trigger() throws -> JSONValue {
        if mode == "webhook" { return .object(["kind": .string("webhook")]) }
        if mode == "custom" { return .object(["kind": .string("cron"), "expression": .string(expression)]) }
        if mode == "once" && !legacyOnce.isEmpty { return .object(["kind": .string("once"), "at": .string(legacyOnce)]) }
        if mode == "interval" {
            guard let amount = Int(every), (1...525600).contains(amount) else { throw APIError(message: "执行间隔须为 1 至 525600 的整数。", status: 400) }
            let seconds = amount * (unit == "minutes" ? 60 : unit == "days" ? 86400 : 3600)
            let start = startAt.isEmpty ? ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(seconds))) : startAt
            return .object(["kind": .string("interval"), "every": .number(Double(amount)), "unit": .string(unit), "startAt": .string(start)])
        }
        guard mode != "weekly" || !weekdays.isEmpty else { throw APIError(message: "请至少选择一天。", status: 400) }
        var result: [String: JSONValue] = ["kind": .string("calendar"), "frequency": .string(mode), "time": .string(time)]
        if mode == "once" { result["date"] = .string(date) }
        if mode == "weekly" { result["weekdays"] = .array(weekdays.sorted().map { .number(Double($0)) }) }
        if mode == "monthly" { result["dayOfMonth"] = .number(Double(day)) }
        return .object(result)
    }
}

struct PlanScheduleFields: View {
    @Binding var value: PlanTiming
    let zone: String
    private var timeZone: TimeZone { TimeZone(identifier: zone) ?? .current }
    private func formatter(_ pattern: String) -> DateFormatter { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = timeZone; f.dateFormat = pattern; return f }
    private var dateSelection: Binding<Date> { Binding(get: { formatter("yyyy-MM-dd HH:mm").date(from: value.date + " " + value.time) ?? Date() }, set: { selected in value.date = formatter("yyyy-MM-dd").string(from: selected); value.time = formatter("HH:mm").string(from: selected) }) }
    var body: some View {
        Picker("执行频率", selection: Binding(get: { value.mode }, set: { value.mode = $0; value.legacyOnce = "" })) {
            Text("只执行一次").tag("once"); Text("每天").tag("daily"); Text("周一至周五").tag("weekdays"); Text("每周").tag("weekly"); Text("每月").tag("monthly"); Text("每隔一段时间").tag("interval"); Text("高级：自定义规则").tag("custom"); Text("收到外部事件时").tag("webhook")
        }
        if value.mode == "interval" {
            TextField("每隔", text: Binding(get: { value.every }, set: { value.every = $0; value.startAt = "" })).keyboardType(.numberPad)
            Picker("间隔单位", selection: Binding(get: { value.unit }, set: { value.unit = $0; value.startAt = "" })) { Text("分钟").tag("minutes"); Text("小时").tag("hours"); Text("天").tag("days") }
            Text("按固定间隔执行；新间隔保存后等待一个间隔开始，天按 24 小时计算。").font(.footnote).foregroundStyle(KY.textSecondary)
        } else if value.mode == "custom" {
            TextField("自定义 cron 规则", text: $value.expression)
        } else if value.mode != "webhook" {
            if value.mode == "once" && !value.legacyOnce.isEmpty {
                Text("原定时间：" + value.legacyOnce)
                Button("重新选择日期和时间") { value.legacyOnce = "" }
            } else {
                if value.mode == "once" { DatePicker("执行日期", selection: dateSelection, displayedComponents: .date).environment(\.timeZone, timeZone) }
                DatePicker("执行时间", selection: dateSelection, displayedComponents: .hourAndMinute).environment(\.timeZone, timeZone)
            }
            if value.mode == "weekly" {
                ForEach([1, 2, 3, 4, 5, 6, 0], id: \.self) { day in
                    Toggle(["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day], isOn: Binding(get: { value.weekdays.contains(day) }, set: { selected in value.weekdays.removeAll { $0 == day }; if selected { value.weekdays.append(day) } }))
                }
            }
            if value.mode == "monthly" { Picker("每月几号", selection: $value.day) { ForEach(1...31, id: \.self) { Text("\($0) 日").tag($0) } }; Text("当月没有该日期时跳过。").font(.footnote).foregroundStyle(KY.textSecondary) }
        }
    }
}

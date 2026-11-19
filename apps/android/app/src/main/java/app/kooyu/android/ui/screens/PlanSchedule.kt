package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.*
import app.kooyu.android.ui.theme.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.home.*
import app.kooyu.android.ui.conversation.*

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

@Composable internal fun DeadlinePicker(value: String, change: (String) -> Unit) {
    val context = LocalContext.current
    val selected = runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()) }
        .getOrElse { ZonedDateTime.now().plusHours(1) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().toggleable(value = value.isNotBlank(), role = Role.Switch,
            onValueChange = { enabled -> change(if (enabled) selected.toInstant().toString() else "") }),
            horizontalArrangement = Arrangement.SpaceBetween) {
            Text("设置截止时间", modifier = Modifier.padding(top = 12.dp))
            Switch(checked = value.isNotBlank(), onCheckedChange = null)
        }
        if (value.isNotBlank()) {
            OutlinedButton(onClick = {
                DatePickerDialog(context, { _, year, month, day ->
                    change(selected.with(LocalDate.of(year, month + 1, day)).toInstant().toString())
                }, selected.year, selected.monthValue - 1, selected.dayOfMonth).show()
            }, modifier = Modifier.fillMaxWidth()) { Text("截止日期：${selected.toLocalDate()}") }
            OutlinedButton(onClick = {
                TimePickerDialog(context, { _, hour, minute ->
                    change(selected.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
                        .toInstant().toString())
                }, selected.hour, selected.minute, true).show()
            }, modifier = Modifier.fillMaxWidth()) {
                Text("截止时间：${selected.format(DateTimeFormatter.ofPattern("HH:mm"))}")
            }
            Text("按本地时区 ${ZoneId.systemDefault().id} 保存。", style = MaterialTheme.typography.bodySmall)
        }
    }
}

internal data class PlanTiming(
    val mode: String = "daily", val time: String = "09:00", val date: String = LocalDate.now().toString(),
    val weekdays: List<Int> = listOf(1), val day: Int = 1, val every: String = "1", val unit: String = "hours",
    val startAt: String = "", val expression: String = "0 9 * * 1", val legacyOnce: String = ""
) {
    fun trigger(): JSONObject {
        if (mode == "webhook") return JSONObject().put("kind", "webhook")
        if (mode == "custom") return JSONObject().put("kind", "cron").put("expression", expression)
        if (mode == "once" && legacyOnce.isNotBlank()) return JSONObject().put("kind", "once").put("at", legacyOnce)
        if (mode == "interval") {
            val amount = every.toLongOrNull() ?: 0
            require(amount in 1..525600) { "执行间隔须为 1 至 525600 的整数。" }
            val seconds = amount * when(unit) { "minutes" -> 60L; "days" -> 86400L; else -> 3600L }
            return JSONObject().put("kind", "interval").put("every", amount).put("unit", unit)
                .put("startAt", startAt.ifBlank { Instant.now().plusSeconds(seconds).toString() })
        }
        require(mode != "weekly" || weekdays.isNotEmpty()) { "请至少选择一天。" }
        return JSONObject().put("kind", "calendar").put("frequency", mode).put("time", time).apply {
            if (mode == "once") put("date", date)
            if (mode == "weekly") put("weekdays", JSONArray(weekdays.sorted()))
            if (mode == "monthly") put("dayOfMonth", day)
        }
    }
    companion object {
        fun from(t: JSONObject): PlanTiming {
            val base = PlanTiming()
            return when(t.optString("kind")) {
                "calendar" -> base.copy(mode=t.optString("frequency"), time=t.optString("time"), date=t.optString("date",base.date), weekdays=t.optJSONArray("weekdays")?.let { a -> (0 until a.length()).map { a.optInt(it) } } ?: listOf(1), day=t.optInt("dayOfMonth",1))
                "interval" -> base.copy(mode="interval",every=t.optInt("every",1).toString(),unit=t.optString("unit","hours"),startAt=t.optString("startAt"))
                "once" -> base.copy(mode="once",legacyOnce=t.optString("at"))
                "webhook" -> base.copy(mode="webhook")
                else -> {
                    val expression=t.optString("expression")
                    val fields=expression.trim().split(Regex("\\s+"))
                    if(fields.size==5 && fields[0].toIntOrNull() in 0..59 && fields[1].toIntOrNull() in 0..23 && fields[3]=="*") {
                        val timed=base.copy(time=fields[1].padStart(2,'0')+":"+fields[0].padStart(2,'0'))
                        if(fields[2]=="*") {
                            if(fields[4]=="*") return timed
                            if(fields[4]=="1-5") return timed.copy(mode="weekdays")
                            if(Regex("[0-7](,[0-7])*").matches(fields[4])) return timed.copy(mode="weekly",weekdays=fields[4].split(',').map { it.toInt()%7 }.distinct())
                        } else if(fields[4]=="*" && fields[2].toIntOrNull() in 1..31) return timed.copy(mode="monthly",day=fields[2].toInt())
                    }
                    base.copy(mode="custom",expression=expression)
                }
            }
        }
    }
}

@Composable internal fun PlanScheduleFields(value: PlanTiming, change: (PlanTiming) -> Unit) {
    val context = LocalContext.current
    ChoiceField("执行频率", value.mode, listOf("once" to "只执行一次", "daily" to "每天", "weekdays" to "周一至周五", "weekly" to "每周", "monthly" to "每月", "interval" to "每隔一段时间", "custom" to "高级：自定义规则", "webhook" to "收到外部事件时")) { change(value.copy(mode=it,legacyOnce="")) }
    when(value.mode) {
        "interval" -> {
            OutlinedTextField(value.every, { change(value.copy(every=it,startAt="")) }, label={Text("每隔")}, singleLine=true, modifier=Modifier.fillMaxWidth())
            ChoiceField("间隔单位",value.unit,listOf("minutes" to "分钟","hours" to "小时","days" to "天")) { change(value.copy(unit=it,startAt="")) }
            Text("按固定间隔执行；新间隔保存后等待一个间隔开始，天按 24 小时计算。",style=MaterialTheme.typography.bodySmall,color=Kooyu.colors.textSecondary)
        }
        "custom" -> OutlinedTextField(value.expression,{change(value.copy(expression=it))},label={Text("自定义 cron 规则")},modifier=Modifier.fillMaxWidth())
        "webhook" -> Text("收到外部事件时执行。",color=Kooyu.colors.textSecondary)
        else -> {
            if(value.mode=="once" && value.legacyOnce.isNotBlank()) {
                Text("原定时间：${value.legacyOnce}")
                TextButton(onClick={change(value.copy(legacyOnce=""))}) { Text("重新选择日期和时间") }
            } else {
                if(value.mode=="once") OutlinedButton(onClick={
                    val date=runCatching{LocalDate.parse(value.date)}.getOrDefault(LocalDate.now())
                    DatePickerDialog(context,{_,year,month,day->change(value.copy(date=LocalDate.of(year,month+1,day).toString()))},date.year,date.monthValue-1,date.dayOfMonth).show()
                }){Text("执行日期：${value.date}")}
                OutlinedButton(onClick={val fields=value.time.split(":");TimePickerDialog(context,{_,hour,minute->change(value.copy(time="%02d:%02d".format(java.util.Locale.ROOT,hour,minute)))},fields[0].toInt(),fields[1].toInt(),true).show()}){Text("执行时间：${value.time}")}
            }
            if(value.mode=="weekly") {
                Text("每周哪几天")
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                    listOf(1,2,3,4,5,6,0).forEach { day -> FilterChip(selected=value.weekdays.contains(day),onClick={change(value.copy(weekdays=if(value.weekdays.contains(day))value.weekdays-day else value.weekdays+day))},label={Text(listOf("周日","周一","周二","周三","周四","周五","周六")[day])}) }
                }
            }
            if(value.mode=="monthly") {
                ChoiceField("每月几号",value.day.toString(),(1..31).map{it.toString() to "$it 日"}){change(value.copy(day=it.toInt()))}
                Text("当月没有该日期时跳过。",style=MaterialTheme.typography.bodySmall)
            }
        }
    }
}

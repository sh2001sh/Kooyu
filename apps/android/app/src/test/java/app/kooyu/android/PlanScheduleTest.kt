package app.kooyu.android

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlanScheduleTest {
    @Test fun legacyDatesAndIntervalAnchorsSurviveUnchangedEdits() {
        val date = "2027-01-20T09:00:00+08:00"
        assertEquals(date, PlanTiming.from(JSONObject().put("kind", "once").put("at", date)).trigger().getString("at"))
        val interval = JSONObject().put("kind", "interval").put("every", 90).put("unit", "minutes").put("startAt", date)
        val saved = PlanTiming.from(interval).trigger()
        assertEquals(date, saved.getString("startAt"))
        assertEquals(90, saved.getInt("every"))
    }
    @Test fun commonLegacySchedulesBecomeTimeSelectorsWhileComplexRulesRemainIntact() {
        val weekdays = PlanTiming.from(JSONObject().put("kind", "cron").put("expression", "30 9 * * 1-5"))
        assertEquals("weekdays", weekdays.mode)
        assertEquals("09:30", weekdays.time)
        val weekly = PlanTiming.from(JSONObject().put("kind", "cron").put("expression", "0 8 * * 1,7"))
        assertEquals(listOf(1, 0), weekly.weekdays)
        val complex = "*/13 3-9 * * 2-4"
        assertEquals(complex, PlanTiming.from(JSONObject().put("kind", "cron").put("expression", complex)).trigger().getString("expression"))
    }
    @Test fun emptyWeeksAndInvalidIntervalsCannotBeSaved() {
        listOf("0", "-1", "1.5", "525601", "").forEach { value ->
            assertTrue(runCatching { PlanTiming(mode = "interval", every = value).trigger() }.isFailure)
        }
        assertTrue(runCatching { PlanTiming(mode = "weekly", weekdays = emptyList()).trigger() }.isFailure)
    }
}

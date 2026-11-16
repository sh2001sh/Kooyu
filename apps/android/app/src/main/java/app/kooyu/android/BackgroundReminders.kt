package app.kooyu.android

import android.annotation.SuppressLint
import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import kotlin.random.Random

/** Preferences contain opt-ins, cursors and IDs only. Credentials remain in ConnectionVault. */
object BackgroundReminders {
    const val OPEN = "app.kooyu.android.OPEN_NOTIFICATION"
    const val STOP = "app.kooyu.android.STOP_REMINDERS"
    const val STATUS_CHANNEL = "kooyu.connection"
    const val ALERT_CHANNEL = "kooyu.reminders"
    private val messages = MutableStateFlow<Map<String, String>>(emptyMap())
    private val revoking = mutableSetOf<String>()
    val status = messages.asStateFlow()
    val pending = MutableStateFlow<NotificationTarget?>(null)
    @Volatile var visibleHost: String? = null
    @Volatile var visibleSession: String? = null
    internal fun preferences(context: Context) = context.getSharedPreferences("kooyu.reminders", Context.MODE_PRIVATE)
    fun key(c: Connection) = c.hostId + ":" + c.deviceId
    internal fun enabled(context: Context) = preferences(context).getStringSet("enabled", emptySet())!!.toSet()
    fun isEnabled(context: Context, c: Connection) = key(c) in enabled(context)
    internal fun message(key: String, text: String) { messages.update { it + (key to text) } }
    internal fun updateSet(context: Context, name: String, transform: (Set<String>) -> Set<String>) {
        val prefs = preferences(context)
        check(prefs.edit().putStringSet(name, transform(prefs.getStringSet(name, emptySet())!!.toSet())).commit()) { "无法保存提醒设置。" }
    }
    fun permitted(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() && manager.getNotificationChannel(ALERT_CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }
    /** Call only from a visible Activity or its permission-result callback. No boot receiver. */
    fun start(context: Context) {
        if (enabled(context).isNotEmpty() && permitted(context)) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, ReminderService::class.java)) }
                .onFailure { enabled(context).forEach { message(it, "后台连接未启动，请返回应用后重新启用。") } }
        }
    }
    fun enable(context: Context, c: Connection) {
        if (key(c) in revoking) { message(key(c), "正在撤销旧通道，请稍后重新启用。"); return }
        if (!permitted(context)) { message(key(c), "请在系统设置中允许通知。"); return }
        updateSet(context, "pending-revocations") { it - key(c) }
        updateSet(context, "confirmed") { it + key(c) }
        updateSet(context, "enabled") { it + key(c) }
        message(key(c), "正在连接此 Host 的提醒…")
        start(context)
    }
    internal fun stopHost(context: Context, c: Connection, reason: String) {
        updateSet(context, "enabled") { it - key(c) }
        updateSet(context, "confirmed") { it - key(c) }
        message(key(c), reason)
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.filter { it.tag?.startsWith(c.hostId + ":") == true }.forEach { manager.cancel(it.tag, it.id) }
    }
    suspend fun disable(context: Context, c: Connection) {
        stopHost(context, c, "此设备的后台提醒已在本机关闭。")
        updateSet(context, "pending-revocations") { it + key(c) }
        revoke(context, c)
    }
    private suspend fun revoke(context: Context, c: Connection) {
        if (isEnabled(context, c) || key(c) !in preferences(context).getStringSet("pending-revocations", emptySet())!! || !revoking.add(key(c))) return
        try {
            HostAPI(c).perform("/notification-channels/" + encoded(c.deviceId + ":client"), "DELETE")
            updateSet(context, "pending-revocations") { it - key(c) }
            message(key(c), "后台提醒已关闭，Host 已确认。")
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { message(key(c), "本机已关闭提醒；Host 尚未确认，联网后重试或在 Host 撤销设备。") }
        finally { revoking.remove(key(c)) }
    }
    suspend fun retryRevocations(context: Context, connections: List<Connection>) {
        val pending = preferences(context).getStringSet("pending-revocations", emptySet())!!.toSet()
        for (c in connections) if (key(c) in pending) revoke(context, c)
    }
    fun receive(intent: Intent?) {
        if (intent?.action != OPEN) return
        NotificationTarget.parse(intent.getStringExtra("hostId"), intent.getStringExtra("notificationId"))?.let { pending.value = it }
    }
}

/** User-visible messaging continuity. System/force-stop may interrupt it; no battery exemption. */
@SuppressLint("ApplySharedPref") // Persist cursors/receipts before acknowledging Host delivery.
class ReminderService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val workers = mutableMapOf<String, Pair<Connection, Job>>()
    private var connections: Map<String, Connection> = emptyMap()
    private lateinit var prefs: SharedPreferences
    private lateinit var vaultPrefs: SharedPreferences
    private val changed = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key in listOf("enabled", "confirmed", "data")) scope.launch { reconcile() }
    }
    private val manager get() = getSystemService(NotificationManager::class.java)
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        prefs = BackgroundReminders.preferences(this)
        vaultPrefs = getSharedPreferences("kooyu.connection", MODE_PRIVATE)
        prefs.registerOnSharedPreferenceChangeListener(changed)
        vaultPrefs.registerOnSharedPreferenceChangeListener(changed)
        manager.createNotificationChannel(NotificationChannel(BackgroundReminders.STATUS_CHANNEL, "后台连接状态", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel(BackgroundReminders.ALERT_CHANNEL, "工作事项提醒", NotificationManager.IMPORTANCE_DEFAULT).apply { lockscreenVisibility = Notification.VISIBILITY_PRIVATE })
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == BackgroundReminders.STOP) {
            connections.values.forEach { BackgroundReminders.stopHost(this, it, "后台连接已停止；返回设置可重新启用。") }
            BackgroundReminders.updateSet(this, "enabled") { emptySet() }
            stopSelf(); return START_NOT_STICKY
        }
        if (!BackgroundReminders.permitted(this) || BackgroundReminders.enabled(this).isEmpty()) { stopSelf(); return START_NOT_STICKY }
        foreground("正在连接已启用的设备…")
        reconcile()
        return START_STICKY
    }
    private fun foreground(text: String) {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, ReminderService::class.java).setAction(BackgroundReminders.STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, BackgroundReminders.STATUS_CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Kooyu 后台提醒").setContentText(text).setOngoing(true).setOnlyAlertOnce(true)
            .setContentIntent(open).addAction(0, "停止连接", stop).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE).build()
        ServiceCompat.startForeground(this, 4101, notification, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0)
    }
    private fun reconcile() {
        if (!BackgroundReminders.permitted(this)) { stopSelf(); return }
        val saved = runCatching { ConnectionVault(this).load().devices }.getOrElse { stopSelf(); return }
        val enabled = BackgroundReminders.enabled(this)
        connections = saved.filter { BackgroundReminders.key(it) in enabled }.associateBy { BackgroundReminders.key(it) }
        for ((id, worker) in workers.toMap()) if (connections[id]?.token != worker.first.token) { worker.second.cancel(); workers.remove(id) }
        if (connections.isEmpty()) { stopSelf(); return }
        foreground("已启用 " + connections.size + " 台设备 · 连接中断时自动重连")
        for ((id, c) in connections) if (workers[id]?.second?.isActive != true) {
            val job = scope.launch { follow(c) }
            workers[id] = c to job
        }
    }
    private fun current(c: Connection) = connections[BackgroundReminders.key(c)]?.token == c.token && BackgroundReminders.isEnabled(this, c) && BackgroundReminders.permitted(this)
    private fun visible(c: Connection, item: JSONObject) = BackgroundReminders.visibleHost == c.hostId && item.nullableString("sessionId")?.let { it == BackgroundReminders.visibleSession } == true
    private suspend fun acknowledge(c: Connection, item: JSONObject) {
        if (current(c) && visible(c, item)) HostAPI(c).post(NotificationTarget(c.hostId, item.getString("id")).path + "/ack", JSONObject().put("sessionId", item.getString("sessionId")))
    }
    private suspend fun follow(c: Connection) {
        val id = BackgroundReminders.key(c)
        var failures = 0
        while (current(c)) {
            try {
                val api = HostAPI(c)
                val health = api.get("/health")
                if (health.optString("hostId") != c.hostId || health.optInt("protocolVersion") != HostAPI.PROTOCOL_VERSION) throw HostError(409, "Host 身份或版本变化。")
                val old = api.array("/notification-channels").firstOrNull { it.optString("kind") == "client" && it.optString("deviceId") == c.deviceId }
                if (!current(c)) return
                val explicit = id in prefs.getStringSet("confirmed", emptySet())!!
                if (old != null && !old.optBoolean("enabled") && !explicit) { BackgroundReminders.stopHost(this, c, "Host 已关闭此提醒，请重新启用。"); return }
                val channel = if (old?.optBoolean("enabled") == true) old else api.perform("/notification-channels", "PUT", JSONObject().put("kind", "client").put("enabled", true).put("preview", false).put("expectedRevision", old?.optInt("revision") ?: 0))
                if (!current(c)) return
                BackgroundReminders.updateSet(this, "confirmed") { it - id }
                BackgroundReminders.message(id, "后台连接已建立；系统回收或强行停止后请返回应用检查。")
                coroutineScope {
                    launch {
                        val cursorKey = "cursor:$id"
                        val after = if (prefs.contains(cursorKey)) prefs.getLong(cursorKey, 0) else null
                        NotificationStream().events(c, after).collect { frame ->
                            if (!current(c)) return@collect
                            val cursor = notificationCursor(frame, c.hostId) ?: return@collect
                            if (frame.event == "notification") acknowledge(c, JSONObject(frame.data))
                            val previous = prefs.getLong(cursorKey, 0)
                            if (cursor > previous) check(prefs.edit().putLong(cursorKey, cursor).commit())
                            failures = 0
                        }
                    }
                    while (current(c)) {
                        val latest = api.array("/notification-channels").firstOrNull { it.optString("id") == channel.optString("id") }
                        if (!current(c)) return@coroutineScope
                        if (latest?.optBoolean("enabled") != true || latest.optInt("revision") != channel.optInt("revision")) throw HostError(403, "Host 提醒设置已变更。")
                        for (delivery in api.array("/notification-deliveries").take(50)) {
                            if (!current(c)) return@coroutineScope
                            val target = NotificationTarget.parse(c.hostId, delivery.optString("notificationId")) ?: continue
                            if (delivery.optString("deviceId") != c.deviceId || delivery.optString("channel") != "client") continue
                            val item = api.get(target.path)
                            if (!current(c) || item.optJSONObject("link")?.optString("hostId") != c.hostId || item.optString("id") != target.notificationId) continue
                            if (visible(c, item)) { acknowledge(c, item); continue }
                            val seenKey = "posted:$id"
                            val posted = prefs.getStringSet(seenKey, emptySet())!!.toSet()
                            if (item.isNull("readAt") && target.notificationId !in posted) {
                                val expires = runCatching { Instant.parse(delivery.getString("expiresAt")) }.getOrNull() ?: continue
                                if (expires <= Instant.now()) continue
                                show(c, target)
                                check(prefs.edit().putStringSet(seenKey, (posted.toList().takeLast(255) + target.notificationId).toSet()).commit())
                            }
                            if (current(c)) api.post("/notification-deliveries/accept", JSONObject().put("id", delivery.getString("id")))
                        }
                        failures = 0
                        delay(5000)
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (!current(c)) break
                if (e is HostError && e.status in listOf(401, 403, 404, 409)) { BackgroundReminders.stopHost(this, c, "Host 连接或提醒授权失效，请核对设备后重新启用。"); return }
                BackgroundReminders.message(id, "连接暂时中断，正在退避重连；Host 事项保持待处理。")
                failures = (failures + 1).coerceAtMost(6)
                delay((1000L shl failures).coerceAtMost(60000L) + Random.nextLong(1000))
            }
        }
        if (!BackgroundReminders.permitted(this)) stopSelf()
    }
    private fun show(c: Connection, target: NotificationTarget) {
        if (!current(c)) return
        val tag = c.hostId + ":" + target.notificationId
        val intent = Intent(this, MainActivity::class.java).setAction(BackgroundReminders.OPEN)
            .setData(android.net.Uri.Builder().scheme("kooyu-notification").authority(c.hostId).appendPath(target.notificationId).build())
            .putExtra("hostId", c.hostId).putExtra("notificationId", target.notificationId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val open = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, BackgroundReminders.ALERT_CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Kooyu 需要你处理").setContentText("请打开 Kooyu 查看").setContentIntent(open)
            .setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        manager.notify(tag, 1, notification)
    }
    override fun onDestroy() {
        prefs.unregisterOnSharedPreferenceChangeListener(changed)
        vaultPrefs.unregisterOnSharedPreferenceChangeListener(changed)
        connections.keys.forEach { BackgroundReminders.message(it, "后台连接已停止；返回设置可重新启用。") }
        scope.cancel(); ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

package app.dayplanner.nativebridge

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

/**
 * Команды, которые интерфейс вызывает через Rust: `native("sync" | "status" | "request" | "drain", {...})`.
 */
@TauriPlugin
class PlannerPlugin(private val activity: Activity) : Plugin(activity) {

    /** Принять от ядра список будильников и данные для виджетов. */
    @Command
    fun sync(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            Prefs.saveWidget(activity, args.optString("widget", "{}"))
            Notifier.ensureChannels(activity)
            Scheduler.replaceAll(activity, JSONArray(args.optString("alarms", "[]")))
            WidgetRenderer.updateAll(activity)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Не удалось обновить будильники")
        }
    }

    /** Какие разрешения уже выданы. */
    @Command
    fun status(invoke: Invoke) {
        val am = activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val notifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(activity).areNotificationsEnabled()
        }
        val fullScreen = if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true
        val res = JSObject()
        res.put("notifications", notifications)
        res.put("exactAlarms", Scheduler.canExact(am))
        res.put("fullScreen", fullScreen)
        res.put("batteryOk", pm.isIgnoringBatteryOptimizations(activity.packageName))
        invoke.resolve(res)
    }

    /** Запросить разрешение или открыть нужный экран настроек. */
    @Command
    fun request(invoke: Invoke) {
        val kind = invoke.getArgs().optString("kind", "")
        val pkg = Uri.parse("package:" + activity.packageName)
        try {
            when (kind) {
                "notifications" ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7001)
                    } else {
                        open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName))
                    }
                "exactAlarms" ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) open(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg))
                "fullScreen" ->
                    if (Build.VERSION.SDK_INT >= 34) open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg))
                "battery" -> open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
            }
            invoke.resolve()
        } catch (e: Exception) {
            // На некоторых прошивках нужного экрана нет — открываем общие настройки приложения.
            try {
                open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
                invoke.resolve()
            } catch (e2: Exception) {
                invoke.reject(e2.message ?: "Не удалось открыть настройки")
            }
        }
    }

    /** Забрать отметки, сделанные в уведомлениях, пока приложение было закрыто. */
    @Command
    fun drain(invoke: Invoke) {
        val res = JSObject()
        res.put("items", JSArray(Prefs.drain(activity).toString()))
        invoke.resolve(res)
    }

    private fun open(i: Intent) {
        activity.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

package com.example.pim_main.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.example.pim_main.MainActivity
import com.example.pim_main.R
import com.example.pim_main.api.PimApi
import kotlinx.coroutines.*
import java.util.Calendar
import java.util.TimeZone

/**
 * PIM Foreground Service
 *
 * Keeps the app process alive so NotificationListenerService works reliably.
 * Periodically pings the backend to prevent cold starts on Render free tier.
 *
 * Battery optimizations:
 * - NO WakeLock — foreground service + START_STICKY is enough
 * - Smart scheduling: pings every 8 min during active hours (8AM-12AM IST),
 *   every 30 min during sleep hours (12AM-8AM IST)
 * - Minimal resource usage: simple HTTP GET pings
 */
class PimForegroundService : Service() {

    companion object {
        private const val TAG = "PimForegroundService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "pim_foreground_channel"
        private const val CHANNEL_NAME = "PIM Background Service"

        // Active hours ping: 8 minutes (under Render's 15 min sleep threshold)
        private const val PING_INTERVAL_ACTIVE_MS = 8 * 60 * 1000L

        // Sleep hours ping: 30 minutes (save battery when DMs are unlikely)
        private const val PING_INTERVAL_SLEEP_MS = 30 * 60 * 1000L

        // IST timezone for time-based scheduling
        private val IST = TimeZone.getTimeZone("Asia/Kolkata")

        fun start(context: Context) {
            Log.d(TAG, "📦 Starting PIM Foreground Service...")
            val intent = Intent(context, PimForegroundService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            Log.d(TAG, "🛑 Stopping PIM Foreground Service...")
            context.stopService(Intent(context, PimForegroundService::class.java))
        }

        fun isRunning(context: Context): Boolean {
            val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            @Suppress("DEPRECATION")
            for (service in manager.getRunningServices(Integer.MAX_VALUE)) {
                if (PimForegroundService::class.java.name == service.service.className) {
                    return true
                }
            }
            return false
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pingJob: Job? = null
    private var lastPingTime: Long = 0
    private var successfulPings: Int = 0
    private var failedPings: Int = 0

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "🚀 PIM Foreground Service created")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "▶️ PIM Foreground Service started")
        startForeground(NOTIFICATION_ID, createNotification("PIM is running..."))
        startPingLoop()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "💀 PIM Foreground Service destroyed")
        pingJob?.cancel()
        serviceScope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Check if current IST hour is during active hours (8 AM to midnight)
     */
    private fun isActiveHours(): Boolean {
        val cal = Calendar.getInstance(IST)
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        return hour in 8..23 // 8 AM to 11:59 PM IST
    }

    /**
     * Get the appropriate ping interval based on time of day
     */
    private fun getCurrentPingInterval(): Long {
        return if (isActiveHours()) {
            PING_INTERVAL_ACTIVE_MS
        } else {
            PING_INTERVAL_SLEEP_MS
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps PIM running to auto-reply to Instagram DMs"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        Log.d(TAG, "📢 Notification channel created")
    }

    private fun createNotification(status: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🤖 PIM Active")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun updateNotification(status: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, createNotification(status))
    }

    private fun startPingLoop() {
        pingJob?.cancel()

        pingJob = serviceScope.launch {
            Log.d(TAG, "🔄 Starting smart ping loop")

            // Initial ping immediately
            performPing()

            while (isActive) {
                val interval = getCurrentPingInterval()
                val mode = if (isActiveHours()) "active" else "sleep"
                Log.d(TAG, "💤 Next ping in ${interval / 60000} min ($mode mode)")
                delay(interval)
                performPing()
            }
        }
    }

    private suspend fun performPing() {
        try {
            val mode = if (isActiveHours()) "⚡" else "🌙"
            Log.d(TAG, "$mode Pinging backend...")
            updateNotification("Pinging backend...")

            val startTime = System.currentTimeMillis()
            val isAlive = PimApi.pingBackend()
            val responseTime = System.currentTimeMillis() - startTime

            lastPingTime = System.currentTimeMillis()

            if (isAlive) {
                successfulPings++
                val timeStr = if (responseTime > 5000) "(cold start: ${responseTime / 1000}s)" else "(${responseTime}ms)"
                val modeLabel = if (isActiveHours()) "" else " 🌙"
                updateNotification("Backend connected $timeStr • ${formatTime(lastPingTime)}$modeLabel")
            } else {
                failedPings++
                val nextIn = getCurrentPingInterval() / 60000
                updateNotification("Backend may be sleeping • Retry in ${nextIn}min")
            }

            Log.d(TAG, "📊 Pings: ✓$successfulPings ✗$failedPings")
        } catch (e: Exception) {
            failedPings++
            Log.e(TAG, "❌ Ping error: ${e.message}")
            val nextIn = getCurrentPingInterval() / 60000
            updateNotification("Network issue • Retry in ${nextIn}min")
        }
    }

    private fun formatTime(timestamp: Long): String {
        val sdf = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        return sdf.format(java.util.Date(timestamp))
    }
}

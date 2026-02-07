package com.example.pim_main.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.example.pim_main.MainActivity
import com.example.pim_main.R
import com.example.pim_main.api.PimApi
import kotlinx.coroutines.*

/**
 * PIM Foreground Service
 *
 * This service runs in the foreground to:
 * 1. Keep the app process alive so NotificationListenerService keeps working
 * 2. Periodically ping the backend to prevent cold starts on Render
 *
 * Uses a WakeLock to ensure pings happen even when screen is off.
 * Battery optimized: pings every 8-9 minutes with minimal resource usage.
 */
class PimForegroundService : Service() {

    companion object {
        private const val TAG = "PimForegroundService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "pim_foreground_channel"
        private const val CHANNEL_NAME = "PIM Background Service"

        // Ping interval: 8 minutes (comfortably under Render's 15 min sleep threshold)
        private const val PING_INTERVAL_MS = 8 * 60 * 1000L // 8 minutes

        /**
         * Start the foreground service
         */
        fun start(context: Context) {
            Log.d(TAG, "📦 Starting PIM Foreground Service...")
            val intent = Intent(context, PimForegroundService::class.java)
            context.startForegroundService(intent)
        }

        /**
         * Stop the foreground service
         */
        fun stop(context: Context) {
            Log.d(TAG, "🛑 Stopping PIM Foreground Service...")
            context.stopService(Intent(context, PimForegroundService::class.java))
        }

        /**
         * Check if the service is running
         */
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
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastPingTime: Long = 0
    private var successfulPings: Int = 0
    private var failedPings: Int = 0

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "🚀 PIM Foreground Service created")
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "▶️ PIM Foreground Service started")

        // Start as foreground service with notification
        startForeground(NOTIFICATION_ID, createNotification("PIM is running..."))

        // Start the ping loop
        startPingLoop()

        // Return STICKY to restart if killed
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "💀 PIM Foreground Service destroyed")
        pingJob?.cancel()
        serviceScope.cancel()
        releaseWakeLock()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Create notification channel for Android O+
     */
    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW // Low importance = no sound, minimal visual
        ).apply {
            description = "Keeps PIM running to auto-reply to Instagram DMs"
            setShowBadge(false)
        }

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
        Log.d(TAG, "📢 Notification channel created")
    }

    /**
     * Create the foreground notification
     */
    private fun createNotification(status: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
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

    /**
     * Update the notification with new status
     */
    private fun updateNotification(status: String) {
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, createNotification(status))
    }

    /**
     * Acquire partial wake lock to ensure pings happen when screen is off
     */
    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "PIM::KeepAliveWakeLock"
        ).apply {
            acquire(10 * 60 * 60 * 1000L) // 10 hours max (will be released on destroy)
        }
        Log.d(TAG, "🔒 WakeLock acquired")
    }

    /**
     * Release the wake lock
     */
    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "🔓 WakeLock released")
            }
        }
        wakeLock = null
    }

    /**
     * Start the periodic ping loop
     */
    private fun startPingLoop() {
        pingJob?.cancel()

        pingJob = serviceScope.launch {
            Log.d(TAG, "🔄 Starting ping loop (every ${PING_INTERVAL_MS / 60000} minutes)")

            // Initial ping immediately
            performPing()

            // Then ping every PING_INTERVAL_MS
            while (isActive) {
                delay(PING_INTERVAL_MS)
                performPing()
            }
        }
    }

    /**
     * Perform a single ping to the backend
     */
    private suspend fun performPing() {
        try {
            Log.d(TAG, "🏓 Pinging backend...")
            updateNotification("Pinging backend...")  // Show user we're actively checking
            
            val startTime = System.currentTimeMillis()

            val isAlive = PimApi.pingBackend()
            val responseTime = System.currentTimeMillis() - startTime

            lastPingTime = System.currentTimeMillis()

            if (isAlive) {
                successfulPings++
                val status = "✅ Backend alive (${responseTime}ms) | ✓$successfulPings ✗$failedPings"
                Log.d(TAG, status)
                // Show response time to help debug slow cold starts
                val timeStr = if (responseTime > 5000) "(cold start: ${responseTime/1000}s)" else "(${responseTime}ms)"
                updateNotification("Backend connected $timeStr • ${formatTime(lastPingTime)}")
            } else {
                failedPings++
                val status = "⚠️ Backend unreachable | ✓$successfulPings ✗$failedPings"
                Log.w(TAG, status)
                // More informative message
                updateNotification("Backend may be sleeping • Will retry in 8min")
            }
        } catch (e: Exception) {
            failedPings++
            Log.e(TAG, "❌ Ping error: ${e.message}")
            updateNotification("Network issue • Will retry in 8min")
        }
    }

    /**
     * Format timestamp for display
     */
    private fun formatTime(timestamp: Long): String {
        val sdf = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        return sdf.format(java.util.Date(timestamp))
    }
}

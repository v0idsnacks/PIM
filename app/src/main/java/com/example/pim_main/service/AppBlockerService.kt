package com.example.pim_main.service

import android.accessibilityservice.AccessibilityService
import android.app.usage.UsageStatsManager
import android.content.Context
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast

/**
 * AppBlockerService — The Doom Scroll Guardian
 *
 * An Accessibility Service that monitors when Instagram is in the foreground.
 * If daily usage exceeds 30 minutes, it sends the user back to the home screen
 * with a motivational Toast: "Quota Khatam. Kaam kar le bhai."
 *
 * How it works:
 * 1. Listens for TYPE_WINDOW_STATE_CHANGED events (app switches)
 * 2. When Instagram comes to foreground, checks UsageStats for today's total
 * 3. If > 30 minutes → performGlobalAction(GLOBAL_ACTION_HOME)
 *
 * Requires:
 * - android.permission.PACKAGE_USAGE_STATS (granted in Settings > Usage Access)
 * - Accessibility Service enabled in Settings > Accessibility
 */
class AppBlockerService : AccessibilityService() {

    companion object {
        private const val TAG = "AppBlockerService"
        private const val INSTAGRAM_PACKAGE = "com.instagram.android"

        // Daily usage quota in milliseconds (30 minutes)
        private const val DAILY_QUOTA_MS = 30 * 60 * 1000L

        // Minimum gap between blocking actions (avoid spam)
        private const val BLOCK_COOLDOWN_MS = 5_000L
    }

    private var lastBlockTime = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "🛡️ Doom Scroll Blocker connected!")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return

        // Only care about window state changes (app coming to foreground)
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: return

        // Only monitor Instagram
        if (packageName != INSTAGRAM_PACKAGE) return

        val now = System.currentTimeMillis()

        // Cooldown to avoid rapid-fire blocking
        if (now - lastBlockTime < BLOCK_COOLDOWN_MS) return

        // Check usage time
        val usageMs = getInstagramUsageToday()
        val usageMinutes = usageMs / 60_000

        Log.d(TAG, "📊 Instagram usage today: ${usageMinutes}m / ${DAILY_QUOTA_MS / 60_000}m")

        if (usageMs > DAILY_QUOTA_MS) {
            // QUOTA EXCEEDED — Send them home!
            lastBlockTime = now

            Log.w(TAG, "🚫 QUOTA EXCEEDED! Usage: ${usageMinutes}m. Blocking Instagram.")

            // Go to home screen
            performGlobalAction(GLOBAL_ACTION_HOME)

            // Show motivational toast
            Toast.makeText(
                this,
                "Quota Khatam. Kaam kar le bhai. 💀",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "⚠️ Doom Scroll Blocker interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "💀 Doom Scroll Blocker destroyed")
    }

    /**
     * Query UsageStatsManager for Instagram's total foreground time today.
     *
     * "Today" is defined as since 4:30 AM IST.
     * This aligns with the reset logic — your day starts at 4:30 AM, not midnight.
     */
    private fun getInstagramUsageToday(): Long {
        val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
        if (usageStatsManager == null) {
            Log.e(TAG, "❌ UsageStatsManager not available")
            return 0L
        }

        val now = System.currentTimeMillis()
        val startOfDay = getStartOfDayMillis()

        val usageStats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startOfDay,
            now,
        )

        if (usageStats.isNullOrEmpty()) {
            Log.d(TAG, "📊 No usage stats available (permission may not be granted)")
            return 0L
        }

        val instagramStats = usageStats.find { it.packageName == INSTAGRAM_PACKAGE }
        val totalTime = instagramStats?.totalTimeInForeground ?: 0L

        return totalTime
    }

    /**
     * Get the start of day in millis.
     * Uses 4:30 AM IST (UTC+5:30) as the day boundary.
     * If current time is before 4:30 AM, use yesterday's 4:30 AM.
     */
    private fun getStartOfDayMillis(): Long {
        val ist = java.util.TimeZone.getTimeZone("Asia/Kolkata")
        val cal = java.util.Calendar.getInstance(ist)

        // Set to 4:30 AM today
        cal.set(java.util.Calendar.HOUR_OF_DAY, 4)
        cal.set(java.util.Calendar.MINUTE, 30)
        cal.set(java.util.Calendar.SECOND, 0)
        cal.set(java.util.Calendar.MILLISECOND, 0)

        val resetTime = cal.timeInMillis

        // If we haven't hit 4:30 AM yet, use yesterday's 4:30 AM
        if (System.currentTimeMillis() < resetTime) {
            cal.add(java.util.Calendar.DAY_OF_YEAR, -1)
        }

        return cal.timeInMillis
    }
}

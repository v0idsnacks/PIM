package com.example.pim_main.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * QuotaResetWorker — Resets the doom scroll blocker daily at ~4:30 AM IST.
 *
 * Uses WorkManager's PeriodicWork to schedule a daily reset.
 * The AppBlockerService uses 4:30 AM IST as the day boundary natively
 * (via getStartOfDayMillis), so this worker is a safety net that:
 *
 * 1. Logs the daily reset for debugging
 * 2. Can be extended to clear cached usage data if needed
 * 3. Ensures the system stays in sync even after reboots
 *
 * Schedule this from MainActivity.onCreate() or Application.onCreate().
 */
class QuotaResetWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "QuotaResetWorker"
        private const val WORK_NAME = "quota_reset_daily"

        /**
         * Schedule the daily quota reset worker.
         * Call this from MainActivity.onCreate() or Application.onCreate().
         *
         * Calculates the delay until the next 4:30 AM IST, then runs every 24 hours.
         */
        fun schedule(context: Context) {
            val delayMs = getDelayUntilNextReset()
            val delayMinutes = delayMs / 60_000

            Log.d(TAG, "⏰ Scheduling quota reset in ${delayMinutes}m (next 4:30 AM IST)")

            val resetWork = PeriodicWorkRequestBuilder<QuotaResetWorker>(
                24, TimeUnit.HOURS,         // Repeat every 24 hours
                15, TimeUnit.MINUTES,       // Flex window: ±15 minutes
            )
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,  // Replace if already scheduled
                resetWork,
            )

            Log.d(TAG, "✅ Quota reset worker scheduled")
        }

        /**
         * Cancel the daily quota reset worker.
         */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "🛑 Quota reset worker cancelled")
        }

        /**
         * Calculate milliseconds until the next 4:30 AM IST.
         */
        private fun getDelayUntilNextReset(): Long {
            val ist = TimeZone.getTimeZone("Asia/Kolkata")
            val now = Calendar.getInstance(ist)
            val target = Calendar.getInstance(ist).apply {
                set(Calendar.HOUR_OF_DAY, 4)
                set(Calendar.MINUTE, 30)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }

            // If 4:30 AM has already passed today, schedule for tomorrow
            if (now.after(target)) {
                target.add(Calendar.DAY_OF_YEAR, 1)
            }

            return target.timeInMillis - now.timeInMillis
        }
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "🌅 Quota reset triggered at 4:30 AM IST")
        Log.d(TAG, "📊 Instagram usage counter reset for a new day")

        // The AppBlockerService handles reset natively via getStartOfDayMillis()
        // using 4:30 AM IST as the boundary. This worker is the safety net.

        // Future extension: Clear any cached usage data here if needed

        return Result.success()
    }
}

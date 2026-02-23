package com.example.pim_main.worker

import android.content.Context
import android.util.Log
import androidx.work.*
import com.example.pim_main.api.PimApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Backend Keep-Alive Worker
 *
 * This worker runs periodically to ping the backend server,
 * preventing cold starts on free-tier hosting services like Render.
 *
 * Runs every 15 minutes (WorkManager's minimum periodic interval).
 * PimForegroundService handles the faster 8-min pings; this worker is a backup.
 * Uses battery-optimized scheduling via WorkManager.
 */
class BackendKeepAliveWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "BackendKeepAlive"
        private const val WORK_NAME = "pim_backend_keep_alive"

        // Ping interval: 15 minutes (WorkManager minimum for periodic work).
        // PimForegroundService pings every 8 min; this worker is a backup.
        private const val PING_INTERVAL_MINUTES = 15L

        // Flex interval: Allow 2 minutes flex for battery optimization
        private const val FLEX_INTERVAL_MINUTES = 2L

        /**
         * Schedule the keep-alive worker
         * Call this from MainActivity on app start
         */
        fun schedule(context: Context) {
            Log.d(TAG, "📅 Scheduling keep-alive worker (every $PING_INTERVAL_MINUTES min)")

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(false)  // Run even on low battery
                .build()

            val keepAliveRequest = PeriodicWorkRequestBuilder<BackendKeepAliveWorker>(
                PING_INTERVAL_MINUTES, TimeUnit.MINUTES,
                FLEX_INTERVAL_MINUTES, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    1, TimeUnit.MINUTES
                )
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,  // Keep existing if already scheduled
                keepAliveRequest
            )

            Log.d(TAG, "✅ Keep-alive worker scheduled")
        }

        /**
         * Cancel the keep-alive worker
         */
        fun cancel(context: Context) {
            Log.d(TAG, "🛑 Cancelling keep-alive worker")
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        /**
         * Check if keep-alive is currently scheduled
         */
        suspend fun isScheduled(context: Context): Boolean {
            return withContext(Dispatchers.IO) {
                try {
                    val workInfos = WorkManager.getInstance(context)
                        .getWorkInfosForUniqueWork(WORK_NAME)
                        .get()

                    workInfos.any {
                        it.state == WorkInfo.State.ENQUEUED ||
                        it.state == WorkInfo.State.RUNNING
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking work status: ${e.message}")
                    false
                }
            }
        }
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "🏓 Pinging backend to keep it alive...")

        return try {
            val isAlive = PimApi.pingBackend()

            if (isAlive) {
                Log.d(TAG, "✅ Backend is alive!")
                Result.success()
            } else {
                Log.w(TAG, "⚠️ Backend ping failed, will retry")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Keep-alive error: ${e.message}")
            Result.retry()
        }
    }
}

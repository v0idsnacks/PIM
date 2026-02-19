package com.example.pim_main.service

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.example.pim_main.api.PimApi
import com.example.pim_main.data.PimRepository
import com.example.pim_main.history.HistoryManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * PIM Notification Listener Service
 *
 * This is the "Spy" - it listens for Instagram DM notifications,
 * sends them to our backend "Brain", and auto-replies using the
 * notification's direct reply action.
 */
class PimNotificationService : NotificationListenerService() {

    companion object {
        private const val TAG = "PimNotificationService"
        private const val INSTAGRAM_PACKAGE = "com.instagram.android"

        // Cooldown period per sender (prevent rapid-fire replies / feedback loops)
        private const val REPLY_COOLDOWN_MS = 15_000L // 15 seconds - increased for safety

        // Time window to consider a message as "our own reply" (feedback detection)
        private const val SELF_REPLY_WINDOW_MS = 30_000L // 30 seconds
    }

    // Coroutine scope for async operations
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Repository for local DB
    private val repository by lazy { PimRepository.getInstance(applicationContext) }

    // Track processed messages to avoid duplicates and feedback loops
    // Key: hash of sender+message, Value: timestamp when processed
    private val processedMessages = mutableMapOf<String, Long>()
    private val lastReplyTime = mutableMapOf<String, Long>()

    // Track our own replies with timestamps so we don't reply to ourselves
    // Key: normalized reply text, Value: timestamp when sent
    private val sentReplies = mutableMapOf<String, Long>()

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "🚀 PIM Notification Service created")
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        Log.d(TAG, "💀 PIM Notification Service destroyed")
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "✅ Notification Listener connected - PIM is now watching!")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "❌ Notification Listener disconnected")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        Log.d(TAG, "🔔 Notification received from: ${sbn?.packageName ?: "null"}")

        sbn ?: return

        // Only process Instagram notifications
        if (sbn.packageName != INSTAGRAM_PACKAGE) {
            Log.d(TAG, "⏭️ Skipping non-Instagram notification: ${sbn.packageName}")
            return
        }

        Log.d(TAG, "📸 Instagram notification detected!")

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        // Extract sender and message
        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val message = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()

        Log.d(TAG, "📝 Raw data - Sender: '$sender', Message: '$message'")

        // Skip if missing data or if it's a group summary
        if (sender.isNullOrBlank() || message.isNullOrBlank()) {
            Log.w(TAG, "⚠️ Missing sender or message, skipping")
            return
        }
        if (extras.getBoolean("android.isGroupSummary", false)) {
            Log.d(TAG, "⏭️ Skipping group summary notification")
            return
        }

        // Skip reel/media shares — AI can't meaningfully reply to these
        if (isReelOrMediaShare(message)) {
            Log.d(TAG, "🎬 Skipping reel/media share from $sender: $message")
            return
        }

        Log.d(TAG, "📩 Instagram DM from $sender: $message")

        // === ANTI-FEEDBACK LOOP CHECKS ===
        val now = System.currentTimeMillis()
        val normalizedMessage = message.lowercase().trim()
        val messageKey = "${sender.lowercase()}:$normalizedMessage"

        // 1. Check if this message matches something we recently sent (our own reply)
        val sentTime = sentReplies[normalizedMessage]
        if (sentTime != null && (now - sentTime) < SELF_REPLY_WINDOW_MS) {
            Log.d(TAG, "🔄 Skipping - this appears to be our own reply (sent ${(now - sentTime) / 1000}s ago)")
            return
        }

        // 2. Check if we already processed this exact message recently
        val processedTime = processedMessages[messageKey]
        if (processedTime != null && (now - processedTime) < REPLY_COOLDOWN_MS * 2) {
            Log.d(TAG, "🔄 Skipping - already processed this message ${(now - processedTime) / 1000}s ago")
            return
        }

        // 3. Check cooldown per sender (prevent rapid replies)
        val lastReply = lastReplyTime[sender.lowercase()] ?: 0
        if (now - lastReply < REPLY_COOLDOWN_MS) {
            Log.d(TAG, "⏳ Skipping - cooldown active for $sender (${(REPLY_COOLDOWN_MS - (now - lastReply)) / 1000}s left)")
            return
        }

        // Mark as processed with current timestamp
        processedMessages[messageKey] = now

        // Cleanup old entries (remove entries older than 5 minutes)
        val fiveMinutesAgo = now - 300_000L
        processedMessages.entries.removeIf { it.value < fiveMinutesAgo }
        sentReplies.entries.removeIf { it.value < fiveMinutesAgo }

        // Find the reply action
        val replyAction = findReplyAction(notification)
        if (replyAction == null) {
            Log.w(TAG, "⚠️ No reply action found for this notification")
            return
        }

        // Process in background
        serviceScope.launch {
            processMessage(sender, message, replyAction, sbn.key)
        }
    }

    /**
     * Find the notification action that has a RemoteInput (the reply button)
     */
    private fun findReplyAction(notification: Notification): Notification.Action? {
        notification.actions?.forEach { action ->
            action.remoteInputs?.forEach { remoteInput ->
                if (remoteInput.allowFreeFormInput) {
                    Log.d(TAG, "🔍 Found reply action: ${action.title}")
                    return action
                }
            }
        }
        return null
    }

    /**
     * Send message to backend and auto-reply.
     * Uses HistoryManager to bundle local conversation history.
     */
    private suspend fun processMessage(
        sender: String,
        message: String,
        replyAction: Notification.Action,
        notificationKey: String
    ) {
        Log.d(TAG, "🧠 Sending to PIM backend...")

        // Step 1: Build the history payload BEFORE saving the new message
        //         (avoids duplicating this message in both history[] and message field)
        val historyPayload = HistoryManager.buildPayload(applicationContext, sender)
        Log.d(TAG, "📚 Bundled ${historyPayload.size} history messages for $sender")

        // Step 2: Save incoming message to local history (after payload is built)
        HistoryManager.addIncomingMessage(applicationContext, sender, message)

        // Step 3: Send to backend with history
        val reply = PimApi.sendMessage(sender, message, historyPayload)

        if (reply.isNullOrBlank()) {
            Log.e(TAG, "❌ Failed to get reply from backend")
            return
        }

        Log.d(TAG, "🤖 AI Reply: $reply")

        // Step 4: Save outgoing reply to local history
        HistoryManager.addOutgoingMessage(applicationContext, sender, reply)

        // Step 5: Also save to Room DB for UI display
        try {
            repository.saveMessagePair(sender, message, reply)
            Log.d(TAG, "💾 Messages saved to local DB")
        } catch (e: Exception) {
            Log.e(TAG, "⚠️ Failed to save to local DB: ${e.message}")
        }

        // Track that we're sending this reply with timestamp (to avoid replying to ourselves)
        val normalizedReply = reply.lowercase().trim()
        sentReplies[normalizedReply] = System.currentTimeMillis()

        // Update cooldown timestamp for this sender
        lastReplyTime[sender.lowercase()] = System.currentTimeMillis()

        // Send the reply
        sendReply(replyAction, reply)

        // Dismiss the notification to prevent re-processing
        try {
            cancelNotification(notificationKey)
            Log.d(TAG, "🗑️ Notification dismissed")
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ Could not dismiss notification: ${e.message}")
        }
    }

    /**
     * Send reply using the notification's RemoteInput
     */
    private fun sendReply(action: Notification.Action, replyText: String) {
        try {
            val remoteInput = action.remoteInputs?.firstOrNull { it.allowFreeFormInput }
            if (remoteInput == null) {
                Log.e(TAG, "❌ No RemoteInput found")
                return
            }

            // Create the reply intent
            val replyIntent = Intent()
            val bundle = Bundle().apply {
                putCharSequence(remoteInput.resultKey, replyText)
            }
            RemoteInput.addResultsToIntent(action.remoteInputs, replyIntent, bundle)

            // Send it!
            action.actionIntent.send(applicationContext, 0, replyIntent)

            Log.d(TAG, "✅ Reply sent successfully: $replyText")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to send reply: ${e.message}", e)
        }
    }

    /**
     * Check if a message is a reel, post, photo, video, or other media share
     * that the AI shouldn't try to reply to.
     */
    private fun isReelOrMediaShare(message: String): Boolean {
        val lower = message.lowercase().trim()
        return lower.contains("sent you a reel") ||
                lower.contains("shared a reel") ||
                lower.contains("sent a reel") ||
                lower.contains("instagram.com/reel") ||
                lower.contains("sent an attachment") ||
                lower.contains("sent you a post") ||
                lower.contains("shared a post") ||
                lower.contains("sent a post") ||
                lower.contains("sent a video") ||
                lower.contains("sent a photo") ||
                lower.contains("sent a voice message") ||
                lower.contains("sent you a story") ||
                lower.contains("shared a story") ||
                lower.contains("sent a story") ||
                lower.contains("sent you a profile") ||
                lower.contains("shared a profile") ||
                lower.contains("instagram.com/p/") ||
                lower.contains("instagram.com/stories/") ||
                lower == "liked a message" ||
                lower == "liked your message" ||
                lower.startsWith("reacted") ||
                lower.contains("sent you a link") ||
                // Instagram often shows just the media type
                lower == "sent a photo" ||
                lower == "sent a video" ||
                lower == "sent an audio" ||
                lower == "shared a reel" ||
                lower == "reel" ||
                lower == "post"
    }
}

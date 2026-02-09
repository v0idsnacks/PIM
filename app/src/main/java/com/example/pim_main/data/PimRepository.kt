package com.example.pim_main.data

import android.content.Context
import android.util.Log
import com.example.pim_main.api.PimApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

/**
 * Repository that manages local Room DB and syncs with backend.
 * Room is the primary data source for UI, backend is the source of truth.
 */
class PimRepository(context: Context) {

    companion object {
        private const val TAG = "PimRepository"

        @Volatile
        private var INSTANCE: PimRepository? = null

        fun getInstance(context: Context): PimRepository {
            return INSTANCE ?: synchronized(this) {
                val instance = PimRepository(context.applicationContext)
                INSTANCE = instance
                instance
            }
        }
    }

    private val db = PimDatabase.getDatabase(context)
    private val messageDao = db.messageDao()

    // ===== Local Operations =====

    fun getConversations(): Flow<List<MessageEntity>> = messageDao.getConversations()

    fun getMessagesForContact(contactName: String): Flow<List<MessageEntity>> =
        messageDao.getMessagesForContact(contactName)

    fun getUnratedReplies(limit: Int = 50): Flow<List<MessageEntity>> =
        messageDao.getUnratedReplies(limit)

    /**
     * Save a message pair (incoming + AI reply) to local DB.
     * Called from PimNotificationService after getting a reply.
     */
    suspend fun saveMessagePair(sender: String, incomingMessage: String, aiReply: String) {
        val now = System.currentTimeMillis()
        val normalizedSender = sender.trim().lowercase()

        // Save incoming message
        messageDao.insertMessage(
            MessageEntity(
                contactName = normalizedSender,
                messageContent = incomingMessage,
                isFromUser = false,
                createdAt = now,
            )
        )

        // Save AI reply
        messageDao.insertMessage(
            MessageEntity(
                contactName = normalizedSender,
                messageContent = aiReply,
                isFromUser = true,
                createdAt = now + 1, // +1ms to ensure ordering
            )
        )

        Log.d(TAG, "💾 Saved message pair for $normalizedSender")
    }

    // ===== Feedback =====

    /**
     * Submit feedback on an AI reply.
     */
    suspend fun submitFeedback(messageId: Long, rating: String, correction: String? = null) {
        messageDao.updateFeedback(messageId, rating, correction)
        Log.d(TAG, "📝 Feedback saved locally: $rating for message $messageId")
    }

    /**
     * Sync unsynced feedback to the backend.
     */
    suspend fun syncFeedback() {
        withContext(Dispatchers.IO) {
            try {
                val unsyncedFeedback = messageDao.getUnsyncedFeedback()
                if (unsyncedFeedback.isEmpty()) return@withContext

                Log.d(TAG, "📤 Syncing ${unsyncedFeedback.size} feedback entries...")

                for (msg in unsyncedFeedback) {
                    // To get the original message, we need the message before this reply
                    // The incoming message should be the previous message from the same contact
                    val contactMessages = messageDao.getMessageCount(msg.contactName)
                    val originalMessage = "unknown" // Simplified — ideally query the message before this one

                    val success = PimApi.submitFeedback(
                        contactName = msg.contactName,
                        originalMessage = originalMessage,
                        aiReply = msg.messageContent,
                        rating = msg.feedbackRating ?: "bad",
                        correction = msg.feedbackCorrection,
                    )

                    if (success) {
                        messageDao.markFeedbackSynced(msg.id)
                        Log.d(TAG, "✅ Feedback synced for message ${msg.id}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Feedback sync error: ${e.message}")
            }
        }
    }

    // ===== Backend Sync =====

    /**
     * Sync messages from backend to local Room DB.
     * Pulls all messages and upserts into local DB.
     */
    suspend fun syncFromBackend() {
        withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "📥 Syncing messages from backend...")
                val backendMessages = PimApi.fetchAllMessages()

                if (backendMessages.isNotEmpty()) {
                    val entities = backendMessages.map { msg ->
                        MessageEntity(
                            contactName = msg.contactName,
                            messageContent = msg.messageContent,
                            isFromUser = msg.isFromUser,
                            platform = msg.platform,
                            createdAt = msg.createdAtMs,
                        )
                    }
                    messageDao.insertMessages(entities)
                    Log.d(TAG, "✅ Synced ${entities.size} messages from backend")
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Backend sync error: ${e.message}")
            }
        }
    }

    suspend fun getTotalMessageCount(): Int = messageDao.getTotalMessageCount()
}

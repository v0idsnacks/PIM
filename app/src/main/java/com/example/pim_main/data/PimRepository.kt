package com.example.pim_main.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.Flow

/**
 * Repository that manages the local Room DB.
 * All conversation data lives on-device — the backend is stateless.
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
     * Submit feedback on an AI reply (saved locally in Room DB).
     * Feedback stays on-device — backend is stateless and has no feedback endpoint.
     */
    suspend fun submitFeedback(messageId: Long, rating: String, correction: String? = null) {
        messageDao.updateFeedback(messageId, rating, correction)
        Log.d(TAG, "📝 Feedback saved locally: $rating for message $messageId")
    }

    suspend fun getTotalMessageCount(): Int = messageDao.getTotalMessageCount()
}

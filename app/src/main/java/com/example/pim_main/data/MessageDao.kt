package com.example.pim_main.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for messages.
 */
@Dao
interface MessageDao {

    // ===== Insert =====

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<MessageEntity>)

    // ===== Query - Conversations =====

    /**
     * Get all distinct contacts with their latest message (for conversation list).
     */
    @Query("""
        SELECT * FROM messages 
        WHERE id IN (
            SELECT MAX(id) FROM messages GROUP BY contactName
        ) 
        ORDER BY createdAt DESC
    """)
    fun getConversations(): Flow<List<MessageEntity>>

    // ===== Query - Messages =====

    /**
     * Get all messages for a specific contact (chat thread).
     */
    @Query("SELECT * FROM messages WHERE contactName = :contactName ORDER BY createdAt ASC")
    fun getMessagesForContact(contactName: String): Flow<List<MessageEntity>>

    /**
     * Get AI replies that haven't been given feedback yet.
     */
    @Query("SELECT * FROM messages WHERE isFromUser = 1 AND feedbackRating IS NULL ORDER BY createdAt DESC LIMIT :limit")
    fun getUnratedReplies(limit: Int = 50): Flow<List<MessageEntity>>

    /**
     * Get message count for a contact.
     */
    @Query("SELECT COUNT(*) FROM messages WHERE contactName = :contactName")
    suspend fun getMessageCount(contactName: String): Int

    /**
     * Get total message count.
     */
    @Query("SELECT COUNT(*) FROM messages")
    suspend fun getTotalMessageCount(): Int

    // ===== Update - Feedback =====

    @Query("UPDATE messages SET feedbackRating = :rating, feedbackCorrection = :correction, feedbackSynced = 0 WHERE id = :messageId")
    suspend fun updateFeedback(messageId: Long, rating: String, correction: String? = null)

    @Query("UPDATE messages SET feedbackSynced = 1 WHERE id = :messageId")
    suspend fun markFeedbackSynced(messageId: Long)

    /**
     * Get all unsynced feedback entries.
     */
    @Query("SELECT * FROM messages WHERE feedbackRating IS NOT NULL AND feedbackSynced = 0")
    suspend fun getUnsyncedFeedback(): List<MessageEntity>

    // ===== Delete =====

    @Query("DELETE FROM messages")
    suspend fun deleteAllMessages()

    @Query("DELETE FROM messages WHERE contactName = :contactName")
    suspend fun deleteMessagesForContact(contactName: String)
}

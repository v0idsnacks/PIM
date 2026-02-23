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
     * Get total message count.
     */
    @Query("SELECT COUNT(*) FROM messages")
    suspend fun getTotalMessageCount(): Int

    // ===== Update - Feedback =====

    @Query("UPDATE messages SET feedbackRating = :rating, feedbackCorrection = :correction WHERE id = :messageId")
    suspend fun updateFeedback(messageId: Long, rating: String, correction: String? = null)

    // ===== Delete =====

    @Query("DELETE FROM messages")
    suspend fun deleteAllMessages()

    @Query("DELETE FROM messages WHERE contactName = :contactName")
    suspend fun deleteMessagesForContact(contactName: String)
}

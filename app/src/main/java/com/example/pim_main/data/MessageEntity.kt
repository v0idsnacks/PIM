package com.example.pim_main.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Room entity for storing messages locally.
 * Mirrors the backend messages table.
 */
@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val contactName: String,
    val messageContent: String,
    val isFromUser: Boolean = false,     // true = AI replied, false = they sent
    val platform: String = "instagram",
    val createdAt: Long = System.currentTimeMillis(),
    // Feedback fields (local only)
    val feedbackRating: String? = null,  // "good" | "bad" | null
    val feedbackCorrection: String? = null,
    val feedbackSynced: Boolean = false, // Whether feedback was synced to backend
)

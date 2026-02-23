package com.example.pim_main.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Room entity for storing messages locally.
 * All data lives on-device — the backend is stateless.
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
    // Feedback fields (local only, stays on-device)
    val feedbackRating: String? = null,  // "good" | "bad" | null
    val feedbackCorrection: String? = null,
    val feedbackSynced: Boolean = false, // Unused legacy column — kept to avoid Room schema migration
)

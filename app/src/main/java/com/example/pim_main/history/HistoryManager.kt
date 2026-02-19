package com.example.pim_main.history

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File

/**
 * HistoryManager — Local-First Conversation Memory
 *
 * Stores conversation history as a JSON file on the device.
 * Structure: Map<username, List<Message>>
 *
 * The 20-Message Rule: Only the last 20 messages per contact are kept.
 * This keeps payloads small and context relevant.
 *
 * Storage location: context.filesDir/history.json
 */
object HistoryManager {

    private const val TAG = "HistoryManager"
    private const val FILE_NAME = "history.json"
    private const val MAX_MESSAGES_PER_CONTACT = 20

    private val gson = Gson()

    /**
     * A single message in the conversation history.
     * role: "user" (they sent) or "model" (we replied)
     */
    data class Message(
        val role: String,       // "user" or "model"
        val content: String,
        val timestamp: Long = System.currentTimeMillis(),
    )

    // In-memory cache so we don't read from disk every time
    @Volatile
    private var cache: MutableMap<String, MutableList<Message>>? = null

    /**
     * Get the history file reference.
     */
    private fun getFile(context: Context): File {
        return File(context.filesDir, FILE_NAME)
    }

    /**
     * Load all history from disk into memory (lazy, cached).
     */
    private fun loadHistory(context: Context): MutableMap<String, MutableList<Message>> {
        cache?.let { return it }

        val file = getFile(context)
        if (!file.exists()) {
            Log.d(TAG, "📂 No history file found, starting fresh")
            val empty = mutableMapOf<String, MutableList<Message>>()
            cache = empty
            return empty
        }

        return try {
            val json = file.readText(Charsets.UTF_8)
            val type = object : TypeToken<MutableMap<String, MutableList<Message>>>() {}.type
            val loaded: MutableMap<String, MutableList<Message>> = gson.fromJson(json, type)
                ?: mutableMapOf()
            cache = loaded
            Log.d(TAG, "📂 Loaded history: ${loaded.size} contacts")
            loaded
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to load history: ${e.message}")
            val empty = mutableMapOf<String, MutableList<Message>>()
            cache = empty
            empty
        }
    }

    /**
     * Save the current history to disk.
     */
    private fun saveHistory(context: Context, history: Map<String, List<Message>>) {
        try {
            val json = gson.toJson(history)
            getFile(context).writeText(json, Charsets.UTF_8)
            Log.d(TAG, "💾 History saved (${history.size} contacts)")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to save history: ${e.message}")
        }
    }

    /**
     * Get the conversation history for a specific contact.
     * Returns the last 20 messages (or fewer if less exist).
     */
    fun getHistory(context: Context, username: String): List<Message> {
        val history = loadHistory(context)
        val key = username.trim().lowercase()
        return history[key]?.toList() ?: emptyList()
    }

    /**
     * Add an incoming message (from the other person) to the history.
     */
    fun addIncomingMessage(context: Context, username: String, content: String) {
        addMessage(context, username, Message(role = "user", content = content))
    }

    /**
     * Add our reply (Aditya's response) to the history.
     */
    fun addOutgoingMessage(context: Context, username: String, content: String) {
        addMessage(context, username, Message(role = "model", content = content))
    }

    /**
     * Add a message and enforce the 20-message rule.
     */
    private fun addMessage(context: Context, username: String, message: Message) {
        val history = loadHistory(context)
        val key = username.trim().lowercase()

        val messages = history.getOrPut(key) { mutableListOf() }
        messages.add(message)

        // THE 20-MESSAGE RULE: Only keep the last 20 messages
        if (messages.size > MAX_MESSAGES_PER_CONTACT) {
            val trimmed = messages.takeLast(MAX_MESSAGES_PER_CONTACT).toMutableList()
            history[key] = trimmed
        }

        cache = history
        saveHistory(context, history)

        Log.d(TAG, "💬 [$key] ${message.role}: ${message.content.take(40)}... (${history[key]?.size ?: 0} msgs)")
    }

    /**
     * Build the payload array that the backend expects.
     * Returns: List of { role: "user"|"model", content: "..." }
     * Ready to be serialized into the POST /chat request body.
     */
    fun buildPayload(context: Context, username: String): List<Map<String, String>> {
        val messages = getHistory(context, username)
        return messages.map { msg ->
            mapOf(
                "role" to msg.role,
                "content" to msg.content,
            )
        }
    }

    /**
     * Clear history for a specific contact.
     */
    fun clearHistory(context: Context, username: String) {
        val history = loadHistory(context)
        val key = username.trim().lowercase()
        history.remove(key)
        cache = history
        saveHistory(context, history)
        Log.d(TAG, "🗑️ Cleared history for $key")
    }

    /**
     * Clear ALL history.
     */
    fun clearAll(context: Context) {
        cache = mutableMapOf()
        saveHistory(context, emptyMap())
        Log.d(TAG, "🗑️ Cleared all history")
    }

    /**
     * Get the total number of contacts with history.
     */
    fun getContactCount(context: Context): Int {
        return loadHistory(context).size
    }

    /**
     * Get all contact usernames that have history.
     */
    fun getAllContacts(context: Context): List<String> {
        return loadHistory(context).keys.toList()
    }

    /**
     * Invalidate the in-memory cache (forces re-read from disk on next access).
     */
    fun invalidateCache() {
        cache = null
    }
}

package com.example.pim_main.api

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * PIM API Client - Connects to the Bun backend
 *
 * IMPORTANT: Replace BASE_URL with your PC's local IP address!
 * Run `ipconfig` in terminal to find your IPv4 address
 */
object PimApi {
    private const val TAG = "PimApi"

    // Production backend URL on Render
    private const val BASE_URL = "https://pim-backend-auhy.onrender.com"

    /**
     * Send a message to the PIM backend and get an AI-generated reply
     *
     * @param sender The contact name (e.g., "radha_01")
     * @param message The incoming message content
     * @return The AI-generated reply, or null if failed
     */
    suspend fun sendMessage(sender: String, message: String): String? {
        return withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "📤 Sending to backend - Sender: $sender, Message: $message")

                val url = URL("$BASE_URL/chat")
                val connection = url.openConnection() as HttpURLConnection

                connection.apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Accept", "application/json")
                    doOutput = true
                    connectTimeout = 30000  // 30 seconds - AI needs time
                    readTimeout = 30000
                }

                // Build JSON payload
                val jsonPayload = JSONObject().apply {
                    put("sender", sender)
                    put("message", message)
                }

                // Send request
                connection.outputStream.use { os ->
                    os.write(jsonPayload.toString().toByteArray(Charsets.UTF_8))
                    os.flush()
                }

                // Read response
                val responseCode = connection.responseCode
                Log.d(TAG, "📥 Response code: $responseCode")

                if (responseCode == HttpURLConnection.HTTP_OK) {
                    val response = connection.inputStream.bufferedReader().use { it.readText() }
                    Log.d(TAG, "📥 Response: $response")

                    val jsonResponse = JSONObject(response)
                    val reply = jsonResponse.optString("reply", "")

                    if (reply.isNotEmpty()) {
                        Log.d(TAG, "✅ Got reply: $reply")
                        reply
                    } else {
                        Log.w(TAG, "⚠️ No reply in response")
                        null
                    }
                } else {
                    val errorStream = connection.errorStream?.bufferedReader()?.use { it.readText() }
                    Log.e(TAG, "❌ HTTP Error $responseCode: $errorStream")
                    null
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ API Error: ${e.message}", e)
                null
            }
        }
    }

    /**
     * Quick health check to verify backend is running
     */
    suspend fun healthCheck(): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                val url = URL(BASE_URL)
                val connection = url.openConnection() as HttpURLConnection
                connection.connectTimeout = 5000
                connection.readTimeout = 5000

                val responseCode = connection.responseCode
                Log.d(TAG, "🏥 Health check: $responseCode")

                responseCode == HttpURLConnection.HTTP_OK
            } catch (e: Exception) {
                Log.e(TAG, "❌ Health check failed: ${e.message}")
                false
            }
        }
    }
}

package com.example.pim_main.api

import android.util.Log
import com.example.pim_main.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * PIM API Client - Connects to the Bun backend
 *
 * Backend URL is configured in local.properties:
 * PIM_BACKEND_URL=https://your-backend.onrender.com
 */
object PimApi {
    private const val TAG = "PimApi"

    // Backend URL from BuildConfig (set in local.properties)
    private val BASE_URL = BuildConfig.PIM_BACKEND_URL

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

    /**
     * Lightweight ping to keep backend alive
     * Used by BackendKeepAliveWorker to prevent cold starts on Render
     *
     * Uses longer timeout (70s) because Render free tier cold start takes 30-60 seconds
     * Includes retry logic to handle temporary network issues
     */
    suspend fun pingBackend(): Boolean {
        return withContext(Dispatchers.IO) {
            // Try up to 2 times (initial + 1 retry)
            repeat(2) { attempt ->
                try {
                    Log.d(TAG, "🏓 Pinging backend... (attempt ${attempt + 1})")

                    val url = URL(BASE_URL)
                    val connection = url.openConnection() as HttpURLConnection

                    connection.apply {
                        requestMethod = "GET"
                        // 70 seconds - Render cold start can take 30-60 seconds
                        connectTimeout = 70000
                        readTimeout = 70000
                        instanceFollowRedirects = true
                    }

                    val responseCode = connection.responseCode
                    val isAlive = responseCode == HttpURLConnection.HTTP_OK

                    Log.d(TAG, "🏓 Ping result: $responseCode (${if (isAlive) "alive" else "dead"})")

                    connection.disconnect()
                    
                    if (isAlive) return@withContext true
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Ping attempt ${attempt + 1} failed: ${e.message}")
                    if (attempt == 0) {
                        // Wait 5 seconds before retry
                        Thread.sleep(5000)
                    }
                }
            }
            false
        }
    }
}

package com.example.pim_main

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.pim_main.api.PimApi
import com.example.pim_main.service.PimNotificationService
import com.example.pim_main.ui.theme.PIM_MAINTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PIM_MAINTheme {
                PimApp()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PimApp() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Check if notification listener is enabled
    var isListenerEnabled by remember { mutableStateOf(false) }
    var isBackendAlive by remember { mutableStateOf<Boolean?>(null) }
    var isCheckingBackend by remember { mutableStateOf(false) }

    // Check notification listener permission
    LaunchedEffect(Unit) {
        isListenerEnabled = isNotificationListenerEnabled(context)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("PIM - Personal Instagram Manager") }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // Logo/Title
            Text(
                text = "🤖",
                fontSize = 64.sp
            )

            Text(
                text = "PIM",
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold
            )

            Text(
                text = "Auto-reply to Instagram DMs with AI",
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Status Cards
            StatusCard(
                title = "Notification Access",
                isEnabled = isListenerEnabled,
                enabledText = "Granted - PIM can read notifications",
                disabledText = "Required - Tap to grant access",
                onClick = {
                    // Open notification listener settings
                    context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }
            )

            StatusCard(
                title = "Backend Connection",
                isEnabled = isBackendAlive == true,
                isLoading = isCheckingBackend,
                enabledText = "Connected to PIM server",
                disabledText = if (isBackendAlive == null) "Tap to check connection" else "Not connected - Is backend running?",
                onClick = {
                    scope.launch {
                        isCheckingBackend = true
                        isBackendAlive = PimApi.healthCheck()
                        isCheckingBackend = false
                    }
                }
            )

            // Test API Button
            var testResult by remember { mutableStateOf<String?>(null) }
            var isTesting by remember { mutableStateOf(false) }

            Button(
                onClick = {
                    scope.launch {
                        isTesting = true
                        testResult = try {
                            val reply = PimApi.sendMessage("test_user", "Hello, this is a test!")
                            if (reply != null) "✅ Reply: $reply" else "❌ No reply received"
                        } catch (e: Exception) {
                            "❌ Error: ${e.message}"
                        }
                        isTesting = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !isTesting
            ) {
                if (isTesting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Testing...")
                } else {
                    Text("🧪 Test API Connection")
                }
            }

            testResult?.let { result ->
                Text(
                    text = result,
                    fontSize = 14.sp,
                    color = if (result.startsWith("✅")) Color(0xFF2E7D32) else Color(0xFFD84315),
                    textAlign = TextAlign.Center
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            // Instructions
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Setup Instructions",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text("1. Grant notification access above")
                    Text("2. Start your backend server (bun run dev)")
                    Text("3. Update IP address in PimApi.kt")
                    Text("4. Check backend connection")
                    Text("5. Receive an Instagram DM - PIM will auto-reply!")
                }
            }

            // Refresh button
            Button(
                onClick = {
                    isListenerEnabled = isNotificationListenerEnabled(context)
                    scope.launch {
                        isCheckingBackend = true
                        isBackendAlive = PimApi.healthCheck()
                        isCheckingBackend = false
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Refresh Status")
            }
        }
    }
}

@Composable
fun StatusCard(
    title: String,
    isEnabled: Boolean,
    enabledText: String,
    disabledText: String,
    isLoading: Boolean = false,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isEnabled)
                Color(0xFF1B5E20).copy(alpha = 0.1f)
            else
                Color(0xFFBF360C).copy(alpha = 0.1f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp
                )
            } else {
                Icon(
                    imageVector = if (isEnabled) Icons.Default.CheckCircle else Icons.Default.Warning,
                    contentDescription = null,
                    tint = if (isEnabled) Color(0xFF2E7D32) else Color(0xFFD84315)
                )
            }

            Column {
                Text(
                    text = title,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp
                )
                Text(
                    text = if (isEnabled) enabledText else disabledText,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * Check if notification listener permission is granted
 */
fun isNotificationListenerEnabled(context: android.content.Context): Boolean {
    val componentName = ComponentName(context, PimNotificationService::class.java)
    val enabledListeners = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners"
    )
    return enabledListeners?.contains(componentName.flattenToString()) == true
}

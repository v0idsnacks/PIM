package com.example.pim_main

import android.Manifest
import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.pim_main.api.PimApi
import com.example.pim_main.data.PimRepository
import com.example.pim_main.service.PimForegroundService
import com.example.pim_main.service.PimNotificationService
import com.example.pim_main.worker.BackendKeepAliveWorker
import com.example.pim_main.ui.ConversationListScreen
import com.example.pim_main.ui.ChatScreen
import com.example.pim_main.ui.theme.PIM_MAINTheme
import com.example.pim_main.ui.theme.StatusGreen
import com.example.pim_main.ui.theme.StatusRed
import com.example.pim_main.ui.theme.StatusAmber
import com.example.pim_main.ui.theme.StatusGreenDim
import com.example.pim_main.ui.theme.StatusRedDim
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            startPimServices()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                startPimServices()
            }
        } else {
            startPimServices()
        }

        enableEdgeToEdge()
        setContent {
            PIM_MAINTheme {
                PimApp()
            }
        }
    }

    private fun startPimServices() {
        PimForegroundService.start(this)
        BackendKeepAliveWorker.schedule(this)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PimApp() {
    val context = LocalContext.current
    val navController = rememberNavController()
    val repository = remember { PimRepository.getInstance(context) }
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    val showBottomBar = currentRoute == "dashboard" || currentRoute == "conversations"

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                ) {
                    NavigationBarItem(
                        icon = {
                            Icon(
                                if (currentRoute == "dashboard") Icons.Filled.Home else Icons.Outlined.Home,
                                contentDescription = "Dashboard"
                            )
                        },
                        label = { Text("Dashboard") },
                        selected = currentRoute == "dashboard",
                        onClick = {
                            navController.navigate("dashboard") {
                                popUpTo("dashboard") { inclusive = true }
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        )
                    )
                    NavigationBarItem(
                        icon = {
                            Icon(
                                if (currentRoute == "conversations" || currentRoute?.startsWith("chat/") == true)
                                    Icons.AutoMirrored.Filled.Chat else Icons.Outlined.ChatBubbleOutline,
                                contentDescription = "Messages"
                            )
                        },
                        label = { Text("Messages") },
                        selected = currentRoute == "conversations" || currentRoute?.startsWith("chat/") == true,
                        onClick = {
                            navController.navigate("conversations") {
                                popUpTo("dashboard")
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = "dashboard",
            modifier = Modifier.padding(innerPadding)
        ) {
            composable("dashboard") {
                DashboardScreen(repository = repository)
            }
            composable("conversations") {
                ConversationListScreen(
                    repository = repository,
                    onConversationClick = { contactName ->
                        navController.navigate("chat/${Uri.encode(contactName)}")
                    }
                )
            }
            composable(
                "chat/{contactName}",
                arguments = listOf(navArgument("contactName") { type = NavType.StringType })
            ) { backStackEntry ->
                val contactName = backStackEntry.arguments?.getString("contactName") ?: ""
                ChatScreen(
                    contactName = contactName,
                    repository = repository,
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}

// ─── Data classes for permission items ──────────────────────────────

data class PermissionItemData(
    val icon: ImageVector,
    val title: String,
    val description: String,
    val grantedText: String,
    val isGranted: Boolean,
    val isLoading: Boolean = false,
    val onClick: () -> Unit,
)

// ─── Dashboard Screen ───────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(repository: PimRepository) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    // Permission states
    var isListenerEnabled by remember { mutableStateOf(false) }
    var isBackendAlive by remember { mutableStateOf<Boolean?>(null) }
    var isCheckingBackend by remember { mutableStateOf(false) }
    var isBatteryOptimized by remember { mutableStateOf(true) }
    var isServiceRunning by remember { mutableStateOf(false) }
    var hasUsageStatsPermission by remember { mutableStateOf(false) }

    // Test state
    var testResult by remember { mutableStateOf<String?>(null) }
    var isTesting by remember { mutableStateOf(false) }

    fun refreshAll() {
        isListenerEnabled = isNotificationListenerEnabled(context)
        isBatteryOptimized = isBatteryOptimizationEnabled(context)
        isServiceRunning = PimForegroundService.isRunning(context)
        hasUsageStatsPermission = isUsageStatsPermissionGranted(context)
        scope.launch {
            isCheckingBackend = true
            isBackendAlive = PimApi.healthCheck()
            isCheckingBackend = false
        }
    }

    LaunchedEffect(Unit) { refreshAll() }

    // Count granted permissions
    val grantedCount = listOf(
        isListenerEnabled,
        !isBatteryOptimized,
        isServiceRunning,
        hasUsageStatsPermission,
        isBackendAlive == true,
    ).count { it }
    val totalPermissions = 5
    val progress by animateFloatAsState(
        targetValue = grantedCount.toFloat() / totalPermissions,
        animationSpec = tween(600),
        label = "progress"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scrollState)
            .padding(horizontal = 20.dp)
            .padding(top = 24.dp, bottom = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ── Branding Header ──
        Spacer(modifier = Modifier.height(16.dp))

        // App icon from drawable
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_launcher_foreground),
                contentDescription = "PIM Logo",
                modifier = Modifier.size(56.dp),
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "PIM",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
            letterSpacing = 2.sp,
        )

        Text(
            text = "Personal Intelligence Module",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(24.dp))

        // ── Setup Progress Card ──
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            ),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Setup Progress",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "$grantedCount / $totalPermissions",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = if (grantedCount == totalPermissions)
                            StatusGreen else MaterialTheme.colorScheme.primary,
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp)),
                    color = if (grantedCount == totalPermissions)
                        StatusGreen else MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                    strokeCap = StrokeCap.Round,
                )
                if (grantedCount == totalPermissions) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "All systems operational",
                        style = MaterialTheme.typography.bodySmall,
                        color = StatusGreen,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        // ── Section: Permissions ──
        SectionHeader(title = "PERMISSIONS")
        Spacer(modifier = Modifier.height(12.dp))

        val permissionItems = listOf(
            PermissionItemData(
                icon = Icons.Outlined.Notifications,
                title = "Notification Access",
                description = "Read Instagram DM notifications to auto-reply on your behalf.",
                grantedText = "Listening for DMs",
                isGranted = isListenerEnabled,
                onClick = {
                    context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                },
            ),
            PermissionItemData(
                icon = Icons.Outlined.BatteryChargingFull,
                title = "Battery Unrestricted",
                description = "Allow PIM to run in the background without being killed by the system.",
                grantedText = "Unrestricted mode active",
                isGranted = !isBatteryOptimized,
                onClick = {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${context.packageName}")
                    }
                    context.startActivity(intent)
                },
            ),
            PermissionItemData(
                icon = Icons.Outlined.BarChart,
                title = "Usage Stats Access",
                description = "Track Instagram screen time for the doom scroll blocker (30 min daily limit).",
                grantedText = "Tracking screen time",
                isGranted = hasUsageStatsPermission,
                onClick = {
                    context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                },
            ),
        )

        permissionItems.forEach { item ->
            PermissionCard(item)
            Spacer(modifier = Modifier.height(10.dp))
        }

        Spacer(modifier = Modifier.height(20.dp))

        // ── Section: Services ──
        SectionHeader(title = "SERVICES")
        Spacer(modifier = Modifier.height(12.dp))

        PermissionCard(
            PermissionItemData(
                icon = Icons.Outlined.Bolt,
                title = "Background Service",
                description = "Foreground service that keeps the notification listener alive.",
                grantedText = "Running",
                isGranted = isServiceRunning,
                onClick = {
                    PimForegroundService.start(context)
                    isServiceRunning = true
                },
            )
        )
        Spacer(modifier = Modifier.height(10.dp))

        PermissionCard(
            PermissionItemData(
                icon = Icons.Outlined.Cloud,
                title = "Backend Connection",
                description = "Groq AI server that generates replies. Hosted on Render.",
                grantedText = "Connected",
                isGranted = isBackendAlive == true,
                isLoading = isCheckingBackend,
                onClick = {
                    scope.launch {
                        isCheckingBackend = true
                        isBackendAlive = PimApi.healthCheck()
                        isCheckingBackend = false
                    }
                },
            )
        )

        Spacer(modifier = Modifier.height(28.dp))

        // ── Test Connection ──
        OutlinedButton(
            onClick = {
                scope.launch {
                    isTesting = true
                    testResult = try {
                        val reply = PimApi.testReply("Hello, this is a test!")
                        if (reply != null) "Reply: $reply" else null
                    } catch (e: Exception) {
                        null
                    }
                    isTesting = false
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !isTesting,
            shape = RoundedCornerShape(12.dp),
            border = ButtonDefaults.outlinedButtonBorder(enabled = !isTesting),
        ) {
            if (isTesting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Testing AI...")
            } else {
                Icon(Icons.Outlined.Science, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Test AI Reply")
            }
        }

        AnimatedVisibility(
            visible = testResult != null && !isTesting,
            enter = fadeIn() + expandVertically(),
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = StatusGreenDim.copy(alpha = 0.3f),
                ),
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        Icons.Outlined.SmartToy,
                        contentDescription = null,
                        tint = StatusGreen,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = testResult ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = StatusGreen,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // ── Refresh ──
        TextButton(
            onClick = { refreshAll() },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(6.dp))
            Text("Refresh Status")
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

// ─── Section Header ─────────────────────────────────────────────────

@Composable
fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        letterSpacing = 1.5.sp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp),
    )
}

// ─── Permission Card ────────────────────────────────────────────────

@Composable
fun PermissionCard(data: PermissionItemData) {
    val containerColor by animateColorAsState(
        targetValue = if (data.isGranted)
            StatusGreenDim.copy(alpha = 0.15f)
        else
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        animationSpec = tween(400),
        label = "cardColor"
    )
    val accentColor = if (data.isGranted) StatusGreen else MaterialTheme.colorScheme.onSurfaceVariant

    Card(
        onClick = data.onClick,
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (data.isGranted) Modifier.border(
                    width = 1.dp,
                    color = StatusGreen.copy(alpha = 0.25f),
                    shape = RoundedCornerShape(14.dp),
                ) else Modifier
            ),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Icon circle
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(
                        if (data.isGranted) StatusGreen.copy(alpha = 0.15f)
                        else MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (data.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Icon(
                        imageVector = data.icon,
                        contentDescription = null,
                        tint = accentColor,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            // Text content
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = data.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = if (data.isGranted) data.grantedText else data.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (data.isGranted) StatusGreen.copy(alpha = 0.8f)
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    lineHeight = 18.sp,
                )
            }

            // Status indicator
            Box(
                modifier = Modifier.padding(top = 2.dp),
            ) {
                if (data.isGranted) {
                    Icon(
                        Icons.Filled.CheckCircle,
                        contentDescription = "Granted",
                        tint = StatusGreen,
                        modifier = Modifier.size(22.dp),
                    )
                } else {
                    Icon(
                        Icons.Outlined.ChevronRight,
                        contentDescription = "Tap to grant",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
        }
    }
}

/**
 * Check if notification listener permission is granted
 */
fun isNotificationListenerEnabled(context: Context): Boolean {
    val componentName = ComponentName(context, PimNotificationService::class.java)
    val enabledListeners = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners"
    )
    return enabledListeners?.contains(componentName.flattenToString()) == true
}

/**
 * Check if battery optimization is enabled for our app
 * Returns true if app IS being optimized (bad for background work)
 * Returns false if app is UNRESTRICTED (good for background work)
 */
fun isBatteryOptimizationEnabled(context: Context): Boolean {
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return !powerManager.isIgnoringBatteryOptimizations(context.packageName)
}

/**
 * Check if Usage Stats permission is granted (required for doom scroll blocker).
 * This is a special permission that can only be granted in system settings.
 */
fun isUsageStatsPermissionGranted(context: Context): Boolean {
    val appOpsManager = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = appOpsManager.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName
    )
    return mode == AppOpsManager.MODE_ALLOWED
}


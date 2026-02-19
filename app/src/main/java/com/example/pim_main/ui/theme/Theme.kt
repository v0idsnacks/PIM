package com.example.pim_main.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * PIM Dark Color Scheme — terminal/hacker inspired
 * Dark slate backgrounds, electric indigo accents
 */
private val PimDarkColorScheme = darkColorScheme(
    primary = Indigo60,
    onPrimary = Color.White,
    primaryContainer = Indigo20,
    onPrimaryContainer = Indigo80,
    secondary = Slate50,
    onSecondary = Slate05,
    secondaryContainer = Slate30,
    onSecondaryContainer = Slate90,
    tertiary = Cyan60,
    onTertiary = Slate05,
    background = Slate05,
    onBackground = Slate90,
    surface = Slate10,
    onSurface = Slate90,
    surfaceVariant = Slate20,
    onSurfaceVariant = Slate70,
    outline = Slate30,
    outlineVariant = Slate20,
)

/**
 * PIM Light Color Scheme — clean, minimal
 */
private val PimLightColorScheme = lightColorScheme(
    primary = Indigo40,
    onPrimary = Color.White,
    primaryContainer = Indigo80,
    onPrimaryContainer = Indigo20,
    secondary = Slate40,
    onSecondary = Color.White,
    secondaryContainer = Slate90,
    onSecondaryContainer = Slate10,
    tertiary = Cyan60,
    onTertiary = Slate05,
    background = Color(0xFFFAFAFC),
    onBackground = Slate10,
    surface = Color.White,
    onSurface = Slate10,
    surfaceVariant = Slate90,
    onSurfaceVariant = Slate40,
    outline = Slate70,
    outlineVariant = Slate90,
)

@Composable
fun PIM_MAINTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // Always use PIM brand colors — no dynamic color
    val colorScheme = if (darkTheme) PimDarkColorScheme else PimLightColorScheme

    // Tint the system bars to match
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.surface.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
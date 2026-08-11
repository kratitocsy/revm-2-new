package com.revm2.app.locking

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Android ceiling for "block a distracting app": we cannot kill the
 * process (that's what app_guard.rs does on desktop via `sysinfo` — no
 * Android permission model allows one app to kill another). Instead we
 * detect the foreground app via TYPE_WINDOW_STATE_CHANGED events and lay
 * a full-screen overlay on top of it. The blocked app keeps running
 * underneath; this is the same ceiling Opal/AppBlock document hitting.
 */
class RevM2AccessibilityService : AccessibilityService() {

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var lastCheckedPackage: String? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val info = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
            notificationTimeout = 100
        }
        serviceInfo = info
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        if (pkg == lastCheckedPackage && overlayView != null) return
        lastCheckedPackage = pkg

        if (BlockStore.isAppBlocked(this, pkg)) {
            showOverlay(pkg)
        } else {
            removeOverlay()
        }
    }

    override fun onInterrupt() { removeOverlay() }

    override fun onDestroy() {
        removeOverlay()
        super.onDestroy()
    }

    private fun showOverlay(blockedPackage: String) {
        if (overlayView != null) return // already showing

        val session = BlockStore.current(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F00B0B0F"))
            setPadding(64, 64, 64, 64)
        }
        val title = TextView(this).apply {
            text = "This app is blocked during your focus session"
            setTextColor(Color.parseColor("#D4AF37"))
            textSize = 20f
            gravity = Gravity.CENTER
        }
        val subtitle = TextView(this).apply {
            text = if (session.noEarlyUnlock)
                "No-early-unlock is on for this session — return to RevM2 to see when it ends."
            else
                "Open RevM2 to end the session early if you need to."
            setTextColor(Color.parseColor("#B0AFAF"))
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 32)
        }
        root.addView(title)
        root.addView(subtitle)

        // Only offer an in-overlay exit path when the session allows early
        // unlock. When no_early_unlock is set, the ONLY way out is through
        // the app's own unlock-phrase flow — matches the desktop guard's
        // "no dismiss button" behavior for committed sessions.
        if (!session.noEarlyUnlock) {
            val openAppBtn = Button(this).apply {
                text = "Open RevM2"
                setOnClickListener {
                    val launch = packageManager.getLaunchIntentForPackage(packageName)
                    launch?.let { startActivity(it) }
                }
            }
            root.addView(openAppBtn)
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            0, // no FLAG_NOT_FOCUSABLE / FLAG_NOT_TOUCHABLE — overlay must actually intercept input
            PixelFormat.TRANSLUCENT
        )

        try {
            windowManager?.addView(root, params)
            overlayView = root
        } catch (e: Exception) {
            // SYSTEM_ALERT_WINDOW not granted — fail silently, the plugin's
            // checkPermissions() surface should have caught this before
            // enforcement started. Don't crash the host app's foreground.
        }
    }

    private fun removeOverlay() {
        overlayView?.let {
            try { windowManager?.removeView(it) } catch (e: Exception) { /* view already gone */ }
        }
        overlayView = null
    }
}

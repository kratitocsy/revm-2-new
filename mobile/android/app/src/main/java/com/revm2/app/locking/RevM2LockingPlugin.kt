package com.revm2.app.locking

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.net.VpnService
import android.provider.Settings
import android.text.TextUtils
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray

/**
 * JS-facing bridge for Tier 2+3 locking. Exposed the same way
 * session_bridge.rs exposes Tauri commands on desktop — pages call this
 * via `Capacitor.Plugins.RevM2Locking.<method>(...)`, no bundler import
 * needed since this app ships as plain HTML/JS (see shared.js's
 * RM2Native helper for the pattern).
 *
 * Deliberately thin: this plugin only ever reads/writes BlockStore and
 * launches system permission screens. All real session logic (when to
 * start/end, which apps/domains, no_early_unlock, etc.) stays owned by
 * the same Supabase-driven code (`focus_lock_sessions` /
 * `focus_lock_schedules`) already running on web/desktop — this is just
 * the on-device enforcement layer underneath it.
 */
@CapacitorPlugin(name = "RevM2Locking")
class RevM2LockingPlugin : Plugin() {

    private val adminComponent: ComponentName
        get() = ComponentName(context, RevM2DeviceAdminReceiver::class.java)

    // ── Installed-apps picker (Tier 2 app-blocking) ──────────────────
    // Package name is what BlockStore/isAppBlocked actually match against
    // (see RevM2AccessibilityService — event.packageName is a real Android
    // package name, unlike desktop's process-name strings). label is
    // purely for display in the JS-side picker UI.
    @PluginMethod
    fun listInstalledApps(call: PluginCall) {
        val pm = context.packageManager
        val launchable = pm.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0
        )
        val seen = HashSet<String>()
        val result = JSONArray()
        for (info in launchable) {
            val pkg = info.activityInfo.packageName
            if (pkg == context.packageName) continue // never let RevM2 block itself
            if (!seen.add(pkg)) continue
            val entry = JSObject()
            entry.put("packageName", pkg)
            entry.put("label", info.loadLabel(pm).toString())
            result.put(entry)
        }
        val out = JSObject()
        out.put("apps", result)
        call.resolve(out)
    }

    // ── Permission checks ──────────────────────────────────────────
    // Named checkLockPermissions, NOT checkPermissions - Capacitor's base
    // Plugin class already declares an open checkPermissions(call) for its
    // own @Permission-annotation system, and Kotlin refuses to compile a
    // same-signature method that silently hides it without `override`
    // (compile error: "hides member of supertype and needs 'override'
    // modifier"). Deliberately not overriding that one either - it's not
    // what we want here, we want our own four-flag JSON shape.

    @PluginMethod
    fun checkLockPermissions(call: PluginCall) {
        val result = JSObject()
        result.put("accessibility", isAccessibilityServiceEnabled())
        result.put("overlay", Settings.canDrawOverlays(context))
        result.put("vpn", VpnService.prepare(context) == null) // null = already granted
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        result.put("deviceAdmin", dpm?.isAdminActive(adminComponent) == true)
        call.resolve(result)
    }

    // ── Permission requests (each opens the relevant system screen —
    //    none of these can be silently granted, all are manual per the
    //    Android capability table in the research doc) ───────────────

    @PluginMethod
    fun requestAccessibility(call: PluginCall) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun requestOverlay(call: PluginCall) {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            android.net.Uri.parse("package:" + context.packageName)
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun requestVpn(call: PluginCall) {
        val prepareIntent = VpnService.prepare(context)
        if (prepareIntent != null) {
            // Must go through the calling Activity to get the one-tap
            // system VPN consent dialog (not Restricted-Settings-gated,
            // per the research doc).
            activity.startActivityForResult(prepareIntent, VPN_REQUEST_CODE)
        }
        call.resolve()
    }

    @PluginMethod
    fun requestDeviceAdmin(call: PluginCall) {
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
        intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
        intent.putExtra(
            DevicePolicyManager.EXTRA_ADD_EXPLANATION,
            "Lets RevM2 require deactivating admin here before the app can " +
            "be uninstalled — this is what makes leaving mid-session a " +
            "deliberate extra step instead of one tap. Revocable anytime " +
            "from Settings."
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    // ── Block list + session control ───────────────────────────────

    @PluginMethod
    fun setBlockListAndStart(call: PluginCall) {
        val sessionId = call.getString("sessionId") ?: return call.reject("sessionId required")
        val noEarlyUnlock = call.getBoolean("noEarlyUnlock") ?: false
        val appsMode = call.getString("appsMode") ?: "blacklist"
        val unlockPhrase = call.getString("unlockPhrase")
        val apps = call.getArray("apps")?.toList<String>() ?: emptyList()
        val domains = call.getArray("domains")?.toList<String>() ?: emptyList()

        BlockStore.startSession(
            ctx = context,
            sessionId = sessionId,
            noEarlyUnlock = noEarlyUnlock,
            appsMode = appsMode,
            appList = apps,
            domainList = domains,
            unlockPhrase = unlockPhrase
        )

        // Start the VPN tunnel for domain blocking, only if it's already
        // been granted (requestVpn() must have been called + accepted
        // earlier in onboarding/session-start flow — we never prompt
        // mid-session).
        if (VpnService.prepare(context) == null) {
            val vpnIntent = Intent(context, RevM2VpnService::class.java)
            vpnIntent.action = RevM2VpnService.ACTION_START
            context.startService(vpnIntent)
        }

        call.resolve()
    }

    @PluginMethod
    fun endSession(call: PluginCall) {
        val enteredPhrase = call.getString("unlockPhrase")
        val session = BlockStore.current(context)

        if (session.noEarlyUnlock && session.unlockPhrase != null) {
            if (!TextUtils.equals(enteredPhrase, session.unlockPhrase)) {
                return call.reject("unlock phrase did not match")
            }
        }

        BlockStore.endSession(context)
        val vpnIntent = Intent(context, RevM2VpnService::class.java)
        vpnIntent.action = RevM2VpnService.ACTION_STOP
        context.startService(vpnIntent)
        call.resolve()
    }

    @PluginMethod
    fun getSessionState(call: PluginCall) {
        val s = BlockStore.current(context)
        val result = JSObject()
        result.put("active", s.active)
        result.put("sessionId", s.sessionId)
        result.put("noEarlyUnlock", s.noEarlyUnlock)
        call.resolve(result)
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expected = context.packageName + "/" + RevM2AccessibilityService::class.java.name
        val enabledServices = Settings.Secure.getString(
            context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.split(":").any { it.equals(expected, ignoreCase = true) }
    }

    private fun <T> JSONArray.toList(): List<String> {
        val out = mutableListOf<String>()
        for (i in 0 until length()) out.add(getString(i))
        return out
    }

    companion object {
        const val VPN_REQUEST_CODE = 8842
    }
}

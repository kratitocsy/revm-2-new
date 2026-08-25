package com.revm2.app.locking

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

/**
 * Single source of truth for "what's currently being enforced", shared
 * between:
 *  - RevM2LockingPlugin (JS bridge — writes this when a session/schedule
 *    starts or the plugin syncs `focus_lock_sessions` from Supabase)
 *  - RevM2AccessibilityService (reads the app blocklist + mode)
 *  - RevM2VpnService (reads the domain blocklist)
 *
 * Deliberately just SharedPreferences, not a DB — this mirrors the
 * desktop guards (`app_guard.rs` / `browser_guard.rs`), which also just
 * hold an in-memory/simple list synced down from the session row, not a
 * local relational copy of Supabase.
 */
object BlockStore {
    private const val PREFS = "revm2_locking_state"
    private const val KEY_SESSION_ACTIVE = "session_active"
    private const val KEY_SESSION_ID = "session_id"
    private const val KEY_NO_EARLY_UNLOCK = "no_early_unlock"
    private const val KEY_APPS_MODE = "apps_mode" // "blacklist" | "whitelist"
    private const val KEY_APP_LIST = "app_list"   // JSON array of package names
    private const val KEY_DOMAIN_LIST = "domain_list" // JSON array of domains
    private const val KEY_UNLOCK_PHRASE = "unlock_phrase"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    data class Session(
        val active: Boolean,
        val sessionId: String?,
        val noEarlyUnlock: Boolean,
        val appsMode: String,
        val appList: Set<String>,
        val domainList: Set<String>,
        val unlockPhrase: String?
    )

    fun current(ctx: Context): Session {
        val p = prefs(ctx)
        return Session(
            active = p.getBoolean(KEY_SESSION_ACTIVE, false),
            sessionId = p.getString(KEY_SESSION_ID, null),
            noEarlyUnlock = p.getBoolean(KEY_NO_EARLY_UNLOCK, false),
            appsMode = p.getString(KEY_APPS_MODE, "blacklist") ?: "blacklist",
            appList = jsonArrayToSet(p.getString(KEY_APP_LIST, "[]")),
            domainList = jsonArrayToSet(p.getString(KEY_DOMAIN_LIST, "[]")),
            unlockPhrase = p.getString(KEY_UNLOCK_PHRASE, null)
        )
    }

    fun startSession(
        ctx: Context,
        sessionId: String,
        noEarlyUnlock: Boolean,
        appsMode: String,
        appList: List<String>,
        domainList: List<String>,
        unlockPhrase: String?
    ) {
        prefs(ctx).edit()
            .putBoolean(KEY_SESSION_ACTIVE, true)
            .putString(KEY_SESSION_ID, sessionId)
            .putBoolean(KEY_NO_EARLY_UNLOCK, noEarlyUnlock)
            .putString(KEY_APPS_MODE, appsMode)
            .putString(KEY_APP_LIST, JSONArray(appList).toString())
            .putString(KEY_DOMAIN_LIST, JSONArray(domainList).toString())
            .putString(KEY_UNLOCK_PHRASE, unlockPhrase)
            .apply()
    }

    /** Ends enforcement. Mirrors the DB-level `active = false` on
     * focus_lock_sessions — this is the on-device counterpart of that. */
    fun endSession(ctx: Context) {
        prefs(ctx).edit()
            .putBoolean(KEY_SESSION_ACTIVE, false)
            .putString(KEY_SESSION_ID, null)
            .apply()
    }

    fun isAppBlocked(ctx: Context, packageName: String): Boolean =
        isAppBlockedForSession(current(ctx), packageName, ctx.packageName, systemExemptPackages(ctx))

    fun isDomainBlocked(ctx: Context, domain: String): Boolean =
        isDomainBlockedForSession(current(ctx), domain)

    /**
     * Pure decision logic, no Context/SharedPreferences — takes an
     * already-loaded Session so it can be unit tested directly (see
     * app/src/test/.../BlockLogicTest.kt) without Robolectric or a device.
     */
    fun isAppBlockedForSession(
        s: Session,
        packageName: String,
        selfPackageName: String,
        additionalExcluded: Set<String> = emptySet()
    ): Boolean {
        if (!s.active) return false
        // Never block our own app, the device's default launcher, or the
        // system Settings app — otherwise a bad blocklist entry (or any
        // whitelist that forgets to include them) could brick navigation
        // entirely, with no way back in short of a factory reset.
        if (packageName == selfPackageName) return false
        if (packageName in additionalExcluded) return false
        return when (s.appsMode) {
            "whitelist" -> packageName !in s.appList
            else -> packageName in s.appList // blacklist (default)
        }
    }

    /** Resolves the device's current default launcher + the Settings app
     * package at call time (not hardcoded — OEM launchers/Settings vary),
     * so isAppBlocked() can exempt them regardless of appsMode. */
    private fun systemExemptPackages(ctx: Context): Set<String> {
        val pm = ctx.packageManager
        val exempt = mutableSetOf<String>()

        val launcherIntent = android.content.Intent(android.content.Intent.ACTION_MAIN)
            .addCategory(android.content.Intent.CATEGORY_HOME)
        pm.resolveActivity(launcherIntent, 0)?.activityInfo?.packageName?.let { exempt.add(it) }

        val settingsIntent = android.content.Intent(android.provider.Settings.ACTION_SETTINGS)
        pm.resolveActivity(settingsIntent, 0)?.activityInfo?.packageName?.let { exempt.add(it) }

        return exempt
    }

    fun isDomainBlockedForSession(s: Session, domain: String): Boolean {
        if (!s.active) return false
        val d = domain.lowercase().removeSuffix(".")
        return s.domainList.any { d == it || d.endsWith(".$it") }
    }

    private fun jsonArrayToSet(raw: String?): Set<String> {
        if (raw.isNullOrBlank()) return emptySet()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }.toSet()
        } catch (e: Exception) {
            emptySet()
        }
    }
}

package com.revm2.app.locking

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/**
 * Device Admin (NOT Device Owner — see docs/revm2-locking-research.md).
 * This alone can't hard-block deactivation; Android always lets the user
 * go to Settings > Device Admin Apps and deactivate it, which is by
 * design revocable-anytime. What it *does* give us:
 *
 *   1. An explicit "deactivate device admin" step required before the app
 *      can be uninstalled at all — the actual uninstall-resistance.
 *   2. This onDisableRequested() message shown at that moment, so leaving
 *      isn't a silent one-tap action during a committed session.
 */
class RevM2DeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        val session = BlockStore.current(context)
        return if (session.active && session.noEarlyUnlock) {
            "You're mid-session with no-early-unlock on. Deactivating here " +
            "removes RevM2's uninstall-resistance immediately — it won't end " +
            "the session in RevM2 itself. Open the app if you meant to end " +
            "the session properly instead."
        } else {
            "This turns off uninstall-resistance for RevM2. You can still " +
            "manage sessions normally from inside the app."
        }
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
    }
}

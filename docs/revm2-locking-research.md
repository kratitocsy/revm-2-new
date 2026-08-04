# RevM2 Cross-Platform Locking Research (Android + macOS)

Status: **Research only — not started on either platform.** Revisit after
desktop (Windows) work is done. Android is the priority when we return to
this; macOS is further deprioritized (see its section below).
Saved: Aug 2026.

## Android

## TL;DR

Android CANNOT match the desktop blocker's strength. Desktop kills processes
and blocks Task Manager directly (near-total control). Android sandboxing
makes that structurally impossible — no permission model on Android lets one
app kill or fully lock another. Realistic ceiling: **parity with Opal /
AppBlock / Forest**, not parity with our own desktop build. This is the
same ceiling every competitor hits, confirmed by their own docs (see
"Competitor benchmark" below) — not a shortfall of our engineering.

## Desktop today (what we're trying to approximate, not replicate)

Source: `desktop/src-tauri/src/`
- `app_guard.rs` — kills blacklisted native app processes via `sysinfo` crate, polling.
- `browser_guard.rs` / `gate_guard.rs` — coordinates with the browser extension to block sites.
- `taskmgr_guard.rs` / `taskmgr_backstop.rs` — blocks Task Manager so the guard process can't be killed by the user.

None of this ports to Android as-is. Needs a different mechanism, not a translation.

## Android capability table

| Capability | Desktop | Android ceiling | Mechanism | Permission needed |
|---|---|---|---|---|
| Block a distracting app | Kill the process | Full-screen overlay when app detected in foreground (app keeps running underneath) | `AccessibilityService` (Android 14+ per Opal's own Play listing) or `UsageStatsManager` polling + `SYSTEM_ALERT_WINDOW` overlay | Accessibility / Usage Access + Overlay — all manual grants in Settings |
| Block a website | Browser-extension-level block | Local on-device VPN blackholing DNS/domains for blocked sites | `VpnService` API, loopback only, no real remote server | VPN permission (one-tap system dialog, not Restricted-Settings-gated) |
| Prevent circumventing the block | Blocks Task Manager entirely | **Partial** — Device Admin permission can prevent app uninstall during an active session (confirmed: AppBlock calls this "Strict Mode") | `DevicePolicyManager` (Device Admin, NOT full enterprise Device Owner/MDM) | Device Admin grant, revocable by user outside a session |
| Getting the permissions in the first place | Just run the installer | Multi-tap Settings flow, worse on Samsung | — | See Restricted Settings below |

## Platform friction that erodes reliability even after permissions are granted

1. **Restricted Settings (Android 13+, tightened in 15).** Apps installed
   from anywhere other than an app-store's purpose-built install API
   (i.e. sideloaded APKs from browsers/file managers/messaging apps) are
   blocked by default from being granted Accessibility, Usage Access,
   Overlay, or Device Admin. User must manually "allow restricted settings"
   per app, worse on Samsung (extra identity-verification step).
   **Distribute via Play Store, not raw APK, to avoid stacking this on
   top of everything else.**
2. **Google is tightening sideloading further.** Reports of a broader
   unverified-sideloading restriction rolling out industry-wide later in
   2026 — direction of travel is more restriction, not less. Re-check
   before building.
3. **OEM battery managers silently kill the background service.**
   Samsung/Xiaomi/OnePlus kill background processes to save battery unless
   the user manually whitelists the app — the "don't kill my app" problem.
   Blocker can silently stop working with zero user action.
4. **VPN conflicts.** Only one VPN active system-wide. If the user already
   runs a real VPN, our local blocking VPN can't coexist.

## Competitor benchmark (checked their own docs/listings, 2026)

- **Opal** (Play Store listing): uses `AccessibilityService` API on Android
  14+ to manage the block list. Uses a local VPN system for site blocking,
  explicitly states no private browsing data leaves the device.
  Android and iOS/Mac are different codebases — Android trails iOS in
  feature parity per their own FAQ.
- **AppBlock** (help docs): documents the full permission set — Usage
  Access, Overlay, Notification Access (for notification blocking +
  keeping the background service alive), Device Admin (uninstall
  prevention = "Strict Mode"), Location (geofence/WiFi-based blocking).
- **Independent review of Opal (2026):** explicit admission that no
  screen-time app can fully take control from the user — it's still their
  phone, they can always change a setting, end a session, or delete the
  app. Stated as true of every app in the category, not just Opal.

## Revised target feature set for RevM2 Android (matches category leader tier)

- Accessibility-based foreground app detection + overlay block
- Local `VpnService` for website blocking
- Device Admin for uninstall-resistance during an active session
  (revocable outside a session — be upfront about this in-app)
- Usage Access for reporting/limits, reused for stats parity with desktop
- Friction dial for breaks, matching Opal's "easy / harder to skip" pattern,
  rather than claiming an unbreakable lock

## Build path (when we get to it)

1. **Capacitor**, not a bare PWA/TWA wrapper — wraps existing web frontend
   (`groups.html`, `materials.js`, `materials-viewer.js`, etc.) completely
   unchanged. Native Kotlin plugin added on top for the blocking logic,
   exposed to JS the same way Tauri's `invoke()` works on desktop.
2. Supabase schema needs **zero changes** —
   `focus_lock_sessions` / `focus_lock_schedules` / presets with
   `apps_mode` (blacklist/whitelist) are already platform-agnostic rows,
   shared across desktop, web, and future Android.
3. Play Store submission needs an explicit Accessibility-usage
   declaration + in-app disclosure (standard for this app category,
   generally approved when the listing matches the permission use — not
   a red flag by itself, but a real review step to budget time for).
4. Distribute via Play Store internal testing track even during
   development, to sidestep Restricted Settings friction from day one
   rather than fighting it while iterating.

## macOS — deprioritized (low expected usage among target users — Indian students, Mac ownership is low)

Revisit only if actual demand shows up. Full analysis below, done but shelved.

**Distribution:** direct notarized DMG, not the Mac App Store — App Sandbox
is mandatory for Store distribution and categorically forbids the
process-killing behavior our guards rely on (no `runFullTrust`-style
escape hatch like Windows MSIX has). Mac App Store would need a
fundamentally different, Screen-Time-API-based build — separate,
open-ended effort gated on Apple approving that restricted entitlement.

**Guard-by-guard status:**
- `app_guard.rs` — already cross-platform (`sysinfo`), works on macOS as-is.
- `browser_guard.rs` — cross-platform except `request_graceful_close`,
  which shells out to Windows' `taskkill`; needs a `SIGTERM`/`kill` branch.
- `taskmgr_backstop.rs` — currently a no-op on macOS; port `schtasks` to
  `launchd` (`.plist` in `~/Library/LaunchAgents`).
- `gate_guard.rs` (screen-capture protection for the reader) — currently a
  no-op on macOS; needs real `NSWindow.sharingType = .none` via
  `objc2`/`cocoa` crate bridging. Biggest unknown/highest-risk item.
- `taskmgr_guard.rs` (Windows Task Manager disable) — **no macOS
  equivalent exists.** Replace with a `launchd` watchdog that respawns the
  guard process within seconds if force-quit via Activity Monitor, resuming
  session state from Supabase (`focus_lock_sessions`). Deterrent/friction,
  not a hard block — same honesty framing as every other platform gap in
  this doc.

**No local Mac available — build/test logistics:**
- Can't cross-compile/sign/notarize from Windows; macOS itself is required
  for that step.
- **GitHub Actions macOS runners** (Tauri has an official GitHub Action for
  build+sign+notarize) handle everything except the one piece requiring a
  human eyeball — screen-capture protection has to be visually verified on
  a real screen, can't be confirmed headlessly in CI.
- For that one piece: rent time on **MacinCloud** or similar (pay-by-hour
  remote Mac access) — a few hours, not days, once the code itself is
  written and compiling cleanly via CI.
- Cheapest long-term option if this becomes ongoing: a used Mac mini (M1),
  removes rental time-pressure entirely.

**Time estimate (single dev, direct-DMG path, no App Store):**
Roughly 8–14 working days assuming a local Mac. Add ~1 day of logistics
overhead for CI signing setup + rental-session scheduling given no local
Mac. Cutting the `gate_guard.rs` Cocoa work (ship without capture
protection initially, JS blur/visibility fallback only) saves 2–4 days.

**Trigger to revisit:** meaningful share of actual users on macOS, or a
paying/institutional customer specifically requesting it.

## Decision (locked in)

We're committing to the full technical ceiling described above — Accessibility
+ overlay, local VPN, Device Admin, Usage Access — not a lighter-weight
version. Framed honestly to users as "the strongest blocking Android allows,"
not as parity with desktop. Revisit this file when desktop work is done.

## Open questions to resolve when we start this

- Which exact permission set to request up front vs. progressively
  (all-at-once during onboarding vs. only when a feature is first used)?
- Device Admin UX: how to explain "uninstall-blocked during session" so it
  doesn't read as sketchy/malware-like to users or reviewers.
- Whether to reuse Opal's "Breaks Allowed: easy / harder" pattern verbatim
  or design our own friction curve tied to `focus_lock_presets`.
- Confirm current sideloading-restriction rollout status before building
  (this area moves fast; re-search closer to build time).

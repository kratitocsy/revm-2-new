# RevM2 Mobile (Android — Capacitor)

Wraps the existing web frontend (unchanged) in a native Android shell,
with a native locking plugin layered on top for Tier 2+3 blocking.
See `../docs/revm2-locking-research.md` for the full research/decisions
this is built from.

## Setup

```
npm install
npm run build      # copies ../*.html/js/css into www/ and runs cap sync
npx cap open android   # opens the project in Android Studio
```

`www/` is gitignored — it's just a synced copy of the root site files,
not a separate source of truth. Always run `npm run sync-web` (or
`npm run build`) after editing any root-level `.html`/`.js`/`.css` file
before building the Android app, or the app will build against a stale
copy.

## Status

- **Tier 1** (Capacitor wrapper + mobile-native UI shell — bottom tab
  bar, native chrome, touch redesigns): scaffolded, see `shared.js`'s
  `initMobileNativeShell()` and the `.rm2-native-shell` rules in
  `style.css`.
- **Tier 2+3** (Accessibility overlay block + local VPN DNS blocking +
  Device Admin uninstall-resistance): native Kotlin implemented under
  `android/app/src/main/java/com/revm2/app/locking/`, exposed to JS as
  `Capacitor.Plugins.RevM2Locking`. **Not yet compiled or tested on a
  real device** — needs Android Studio + a device/emulator to validate,
  especially the VPN DNS-forwarding loop.
- **Permission onboarding + session wiring**: done in `blocks.html` —
  `#mobilePermCard` walks through Accessibility/Overlay/VPN/Device Admin
  grants (native-only, hidden on web/desktop), and `syncSessionToMobile()`
  mirrors session start/end into the native plugin the same way the
  existing desktop bridge (`syncBlockedAppsToDesktop` /
  `pushSessionEventToDesktop`) already does for Tauri. Stop-early on
  mobile uses its own in-app code-prompt gate (no browser extension
  exists inside the WebView to mediate the usual extension-hosted gate) —
  see the comment above that branch in `stopActiveBlock()` for what's
  NOT yet verified equivalent to the real extension flow.
- **App blocking is web/desktop-only for now** — desktop's app list holds
  process names, which don't map to Android package names. Site/domain
  blocking (VPN) IS wired through to mobile. A real Android app picker
  (package name + label, likely via `PackageManager.getInstalledApplications`)
  is still needed before app-blocking can extend to mobile.
- **Not started:** Tier 4 (Device Owner) opt-in flow; a `productFlavors`
  split so a Play-distributed build can exclude Tier 4 entirely while a
  direct-download build includes it (see the Play Store discussion this
  was built alongside).
- **Tier 4 (Device Owner / "Advanced Lock")**: not started, opt-in-only
  per the locked-in decision in the research doc. Must never be reachable
  from inside a Play-distributed build — see `productFlavors` note above.

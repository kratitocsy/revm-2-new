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
- **Not started:** the in-app onboarding UI that walks the user through
  granting each permission and calls into `RevM2Locking`, and wiring
  session start/end into the existing `blocks.html` /
  `focus_lock_sessions` Supabase logic.
- **Tier 4 (Device Owner / "Advanced Lock")**: not started, opt-in-only
  per the locked-in decision in the research doc.

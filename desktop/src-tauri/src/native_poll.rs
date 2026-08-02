// Native (Rust/tokio) fallback for "is a focus session active right now."
//
// THE BUG THIS FIXES: every other piece of session-state truth in this app
// - starting a schedule-driven block, ending one, keeping the close/quit
// lock alive, everything - ultimately traces back to ONE source: the
// webview page (blocks.html's loadActiveBlock, tracker.html's
// pollBlockStatusForDesktop) calling `sb.from('focus_lock_sessions')...`
// on a plain `setInterval(..., 5000)` and forwarding the answer to Rust
// via the `set_session_active` command. See lib.rs's WATCHDOG_TIMEOUT_SECS
// doc comment - the watchdog even admits this poll can "die."
//
// It doesn't just die from crashes. Chromium (and WebView2, which is
// Chromium under the hood on Windows) deliberately throttles - and, once
// a page has been hidden/occluded long enough, can pause almost entirely
// - JS timers like setInterval in a backgrounded frame ("Intensive Timer
// Throttling" / background tab throttling). Turning the monitor off is
// enough to make Windows treat this app's window as occluded even though
// the process itself, and the rest of the machine, is still fully awake -
// so the 5s poll can silently stretch to minutes. Two visible symptoms
// follow:
//   1. A schedule slot that's supposed to start while the screen is off
//      never gets enforced - schedule-tick (the Supabase Edge Function)
//      still creates the focus_lock_sessions row right on time, but
//      nothing here ever tells this process to start blocking, because
//      nothing called set_session_active(true).
//   2. Worse, an ALREADY active block can get released early: if the
//      poll stays quiet for WATCHDOG_TIMEOUT_SECS (120s) - very plausible
//      once Chromium's intensive throttling kicks in after ~5 minutes
//      hidden - spawn_watchdog_loop (lib.rs) assumes the poll died and
//      lifts enforcement itself.
//
// The fix: an independent channel that isn't a webview timer at all. This
// task runs on tokio's own scheduler, which Windows does not throttle
// just because a monitor is off (unlike a hidden browser frame), and
// talks to Supabase's REST API directly - the same query
// loadActiveBlock() makes, just made from Rust instead of JS. On a
// healthy system where the webview poll is running normally, this is a
// redundant confirmation that agrees with what set_session_active is
// already being told. It only ever matters once the JS side has gone
// quiet, which is exactly when it's needed most.
//
// This is additive, not a replacement, matching the same philosophy as
// heartbeat.rs and taskmgr_backstop.rs elsewhere in this app: give
// something that's supposed to be continuous a second, OS-level way to
// stay true instead of depending on a single fragile signal.

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicI64};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::MenuItem;
use tauri::AppHandle;

use crate::{apply_blocked_apps, apply_session_state, BrowserGraceTracker};

// How often the native side re-checks Supabase on its own. Independent of
// - and deliberately shorter than - lib.rs's WATCHDOG_TIMEOUT_SECS (120s),
// so this task alone is enough to keep the watchdog from ever seeing the
// staleness it's watching for, even if the webview poll is fully stalled.
const NATIVE_POLL_INTERVAL_SECS: u64 = 20;

#[derive(Clone)]
pub struct AuthInfo {
    pub user_id: String,
    pub access_token: String,
    pub supabase_url: String,
    pub supabase_anon_key: String,
}

/// Last-known Supabase auth for the signed-in account, pushed here by the
/// webview (see shared.js's syncNativeAuthToken, called from requireAuth()
/// and on every onAuthStateChange event) via the `sync_native_auth`
/// command. `None` until the first successful requireAuth() on this
/// device/run - the poll below simply skips ticks until it has something
/// to use, same as it always could before this existed.
pub struct AuthState(pub Mutex<Option<AuthInfo>>);

impl AuthState {
    pub fn new() -> Self {
        AuthState(Mutex::new(None))
    }

    fn get(&self) -> Option<AuthInfo> {
        self.0.lock().ok().and_then(|g| g.clone())
    }
}

#[derive(Deserialize, Default)]
struct SessionRow {
    ends_at: Option<String>,
    #[serde(default)]
    apps: Vec<String>,
    apps_mode: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn spawn_native_session_poll(
    app: AppHandle,
    session_active: Arc<AtomicBool>,
    blocked_apps: crate::app_guard::SharedBlockList,
    grace_tracker: Arc<BrowserGraceTracker>,
    heartbeat_state: Arc<crate::heartbeat::HeartbeatState>,
    quit_item: MenuItem<tauri::Wry>,
    last_sync: Arc<AtomicI64>,
    backstop_fire_at: Arc<AtomicI64>,
    auth_state: Arc<AuthState>,
) {
    tauri::async_runtime::spawn(async move {
        // A dedicated client (not reqwest::get everywhere) so connections
        // to Supabase get reused across ticks instead of a fresh TLS
        // handshake every 20s.
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("native_poll: failed to build HTTP client, fallback poll disabled: {e}");
                return;
            }
        };

        let mut interval = tokio::time::interval(Duration::from_secs(NATIVE_POLL_INTERVAL_SECS));
        loop {
            interval.tick().await;

            let Some(auth) = auth_state.get() else {
                // Nothing pushed yet (e.g. very first tick right after
                // launch, before the webview has finished requireAuth()).
                // Not an error - just wait for the next tick.
                continue;
            };

            let url = format!(
                "{}/rest/v1/focus_lock_sessions?user_id=eq.{}&active=eq.true&select=ends_at,apps,apps_mode&limit=1",
                auth.supabase_url.trim_end_matches('/'),
                auth.user_id,
            );

            let resp = client
                .get(&url)
                .header("apikey", &auth.supabase_anon_key)
                .header("Authorization", format!("Bearer {}", auth.access_token))
                .send()
                .await;

            let rows: Vec<SessionRow> = match resp {
                Ok(r) if r.status().is_success() => match r.json().await {
                    Ok(rows) => rows,
                    Err(e) => {
                        eprintln!("native_poll: couldn't parse Supabase response: {e}");
                        continue;
                    }
                },
                // 401/403 most likely means the cached access token expired
                // without a fresher one ever reaching us (e.g. the webview
                // poll has been throttled long enough that even
                // supabase-js's own refresh timer got starved). Nothing
                // useful to do but wait - the next successful webview tick
                // (as soon as the screen wakes, or via an OS-level
                // background wake) re-syncs a good token via
                // sync_native_auth, and this loop picks it back up
                // automatically on its next interval.
                Ok(r) => {
                    eprintln!("native_poll: Supabase returned {}", r.status());
                    continue;
                }
                Err(e) => {
                    eprintln!("native_poll: request failed: {e}");
                    continue;
                }
            };

            let row = rows.into_iter().next();
            let active = row.is_some();
            let ends_at = row.as_ref().and_then(|r| r.ends_at.clone());

            apply_session_state(
                &app,
                &session_active,
                &blocked_apps,
                &grace_tracker,
                &heartbeat_state,
                &quit_item,
                &last_sync,
                &backstop_fire_at,
                active,
                ends_at,
            )
            .await;

            // Mirrors pollBlockStatusForDesktop's own
            // set_blocked_apps call, so app-level enforcement (not just
            // the close/quit lock) also keeps working from this path.
            if let Some(row) = row {
                let mode = row.apps_mode.unwrap_or_else(|| "blacklist".to_string());
                let _ = apply_blocked_apps(&app, &blocked_apps, row.apps, Some(mode));
            }
        }
    });
}

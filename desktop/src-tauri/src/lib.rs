mod app_guard;
mod browser_guard;
mod gate_guard;
mod heartbeat;
mod native_poll;
mod session_bridge;
mod taskmgr_backstop;
mod taskmgr_guard;

#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

// `WebviewWindow::set_closable` (called below in set_session_active) only
// grays out the SC_CLOSE item in the title bar's system menu on Windows.
//
// This used to also remove the WS_SYSMENU window style entirely, to hide
// the X from the taskbar thumbnail preview too (Explorer draws that purely
// from WS_SYSMENU's presence, not the menu item's enabled state). That was
// a real bug, not just a cosmetic trade-off: Windows' non-client
// caption-button rendering gates ALL THREE buttons (minimize, maximize,
// close) on WS_SYSMENU being present, not just close - so for the entire
// duration of every active session, maximize and minimize were also
// getting disabled, with no way to tell from the outside that this was
// "expected" rather than the app hanging or bugged. It also isn't even the
// real enforcement: the CloseRequested -> api.prevent_close() handler
// registered in run() below is what actually blocks closing, and it works
// off the `session_active` flag directly, independent of window style. So
// removing this trades a minor cosmetic gap (the taskbar thumbnail's X
// stays visible, though clicking it still hits prevent_close() and does
// nothing) for maximize/minimize never being incorrectly disabled again.
#[cfg(target_os = "windows")]
fn set_native_closable(window: &tauri::WebviewWindow, closable: bool) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnableMenuItem, GetSystemMenu, SetWindowPos,
        MF_BYCOMMAND, MF_ENABLED, MF_GRAYED, SC_CLOSE, SWP_FRAMECHANGED, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER,
    };

    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as HWND;

    unsafe {
        // Keep the system menu's own close-item enabled state honest -
        // this alone also grays the visible title-bar X on modern Windows,
        // without touching WS_SYSMENU (and therefore without touching
        // minimize/maximize at all).
        let hmenu = GetSystemMenu(hwnd, 0);
        if hmenu != 0 {
            EnableMenuItem(
                hmenu,
                SC_CLOSE as u32,
                MF_BYCOMMAND | if closable { MF_ENABLED } else { MF_GRAYED },
            );
        }

        // Force a non-client repaint so the title bar reflects the new
        // menu-item state immediately rather than waiting on some
        // unrelated redraw.
        SetWindowPos(
            hwnd,
            0,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn set_native_closable(_window: &tauri::WebviewWindow, _closable: bool) {}
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

// Fires a native OS notification (Windows toast / etc) - separate from
// the tray tooltip, which only shows on hover and is easy to miss.
// Errors are swallowed on purpose: a failed
// notification shouldn't take down the guard loop, and there's nowhere
// useful to surface the error to (no window may even be open).
fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

// How long to suppress a repeat "Can't close" toast after firing one.
// Windows can deliver CloseRequested more than once for what's really a
// single user action (Alt+F4 held a beat too long, a stray double
// WM_CLOSE, the taskbar "Close window" entry racing the title-bar X) -
// without this, one close attempt could pop several toasts back to back,
// which reads as the notification firing "on its own" on a schedule
// rather than in response to something the person did.
const CLOSE_NOTIFY_COOLDOWN_SECS: i64 = 5;

const BLOCKED_APPS_STORE: &str = "revm2-blocked-apps.json";
const BLOCKED_APPS_KEY: &str = "blocked_apps";
const BLOCKED_APPS_MODE_KEY: &str = "blocked_apps_mode"; // "blacklist" | "whitelist", see app_guard::AppMode

// How long a browser can sit "extension not detected" before we start
// closing it. Not zero, on purpose:
//   1. Chromium doesn't write its Preferences file the instant an
//      extension is toggled - the pref store batches commits, so a
//      same-second read can look disabled even when it isn't.
//   2. A hard-zero grace period means one glitchy read slams the
//      browser shut with no warning, which is worse UX for no real
//      security benefit against someone who genuinely disabled it.
// 60s is long enough to absorb that lag and give a legitimate "I'll
// re-enable it" moment, short enough that it isn't a real bypass.
const EXTENSION_GRACE_SECS: i64 = 60;

pub(crate) fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn session_lock_path() -> std::path::PathBuf {
    let base = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    std::path::PathBuf::from(base).join("RevM2").join("session.lock")
}

// The uninstaller (see installer/hooks.nsh) checks for this file's
// existence before allowing removal to proceed. Written the instant a
// session goes active, removed the instant it doesn't - not on a
// timer, so there's no window where the lock is stale in either
// direction.
fn write_session_lock(active: bool) {
    let path = session_lock_path();
    if active {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, now_ts().to_string());
    } else {
        let _ = std::fs::remove_file(&path);
    }
}

// How long the app will keep enforcing a "session active" lock (close
// disabled, quit disabled) without hearing ANY set_session_active call from
// the web page. Normal operation calls this every 5s (see blocks.html's
// loadActiveBlock poll), so going this long without one means the poll
// itself has died - tab closed oddly, browser crashed, network down, a bug,
// whatever - not that a real unlimited session is still running. Without
// this, a dead poll leaves the app permanently unclosable with no recourse
// but a Task Manager "End task", forever, even after the person genuinely
// wants out and the website agrees there's nothing active. This is a
// fail-safe of last resort, not the normal unlock path - the web poll
// reaching set_session_active(false) is still what's supposed to happen
// within 5-10s of a session actually ending.
const WATCHDOG_TIMEOUT_SECS: i64 = 120;
// How often the watchdog checks. Independent of the 3s guard-tick interval
// since this isn't about enforcement, just detecting a stalled poll.
const WATCHDOG_CHECK_INTERVAL_SECS: u64 = 15;

// Shared flag: is a focus session currently active. Wrapped in Arc so the
// background poller task can hold its own clone independent of Tauri's
// managed-state lookup.
pub struct SessionState(pub Arc<AtomicBool>);

// Shared flag: does the signed-in account have AT LEAST ONE enabled
// schedule row (focus_lock_schedules.active = true), independent of
// whether a session is literally firing right now. Deliberately kept
// separate from SessionState rather than folded into the same bool -
// this is driven solely by native_poll.rs's own ~20s tick (schedules
// aren't something any webview page polls today), while SessionState
// is driven by both the webview's ~5s poll AND native_poll's fallback.
// Blending the two into one flag would mean those two pollers
// fighting each other every few seconds (webview says "no live
// session" -> unlock, native poll says "schedule active" -> relock,
// repeat) - see lock_should_hold() below for how they're combined
// instead, only at the points that actually need the combined answer.
//
// What this flag governs: staying tray-resident, the close("X")/quit
// lock, and Task Manager being disabled - i.e. "can the person make
// this app stop running at all." It deliberately does NOT gate
// app_guard/browser_guard's actual kill loop - that stays tied to
// SessionState alone, so having a schedule configured doesn't block
// apps/sites at 3am on a day nothing is scheduled. Only a genuinely
// live session should ever kill anything.
pub struct ScheduleActiveState(pub Arc<AtomicBool>);

// True if either flag says the app should stay locked down. The one
// place this OR happens - every caller that touches closable/
// taskmgr_guard/quit_item goes through this instead of reading either
// flag directly, so the two can never drift out of sync with each
// other.
fn lock_should_hold(session_active: &AtomicBool, schedule_active: &AtomicBool) -> bool {
    session_active.load(Ordering::SeqCst) || schedule_active.load(Ordering::SeqCst)
}

// Unix timestamp of the last time the web page successfully told us
// (via set_session_active) what the real session state is - true or false,
// either counts as "still in contact". The watchdog uses staleness of this,
// not the session state itself, to decide the poll has died.
pub struct LastSyncState(pub Arc<std::sync::atomic::AtomicI64>);

// Unix timestamp the taskmgr_backstop scheduled task is currently set to
// fire at, or 0 if none is scheduled. Lets set_session_active avoid
// re-running schtasks.exe on every 5s poll tick when the computed fire
// time hasn't actually changed since the last call.
pub struct BackstopFireAt(pub Arc<std::sync::atomic::AtomicI64>);

// Per-browser-name -> unix timestamp of when it was FIRST seen running
// without the extension, continuously. Reset to None the moment it's
// seen protected again. This is what turns "instant kill" into
// "60s grace, then kill, then keep killing on every tick if reopened."
pub struct BrowserGraceTracker(pub Mutex<HashMap<String, i64>>);

#[tauri::command]
async fn set_session_active(
    app: AppHandle,
    state: tauri::State<'_, SessionState>,
    schedule_state: tauri::State<'_, ScheduleActiveState>,
    blocked_apps: tauri::State<'_, app_guard::SharedBlockList>,
    grace_tracker: tauri::State<'_, Arc<BrowserGraceTracker>>,
    heartbeat_state: tauri::State<'_, Arc<heartbeat::HeartbeatState>>,
    quit_item: tauri::State<'_, MenuItem<tauri::Wry>>,
    last_sync: tauri::State<'_, LastSyncState>,
    backstop_fire_at: tauri::State<'_, BackstopFireAt>,
    active: bool,
    // Optional and independent of `active` - callers that don't yet know
    // the real end time (e.g. the optimistic active:true fired right at
    // session start, before the block/preset row is finalized, or a
    // genuinely unlimited session with no end time at all) can omit
    // this; see taskmgr_backstop for how the fallback ceiling handles
    // that case.
    ends_at: Option<String>,
) -> Result<(), String> {
    apply_session_state(
        &app,
        &state.0,
        &schedule_state.0,
        blocked_apps.inner(),
        grace_tracker.inner(),
        heartbeat_state.inner(),
        quit_item.inner(),
        &last_sync.0,
        &backstop_fire_at.0,
        active,
        ends_at,
    )
    .await;
    Ok(())
}

// Companion to set_session_active, but for the broader "does this
// account have any schedule enabled at all" question (see
// ScheduleActiveState's doc comment). Called from native_poll.rs's own
// tick - no webview page pushes this today, since none of them
// currently ask "do I have any active schedule row" independent of
// "is a session live right now." Kept as its own command (rather than
// folding into set_session_active) so the two can be driven by
// different, independent pollers without fighting each other - see
// lock_should_hold().
// Shared by both the set_schedule_active command (webview/debug callers)
// and native_poll.rs (which has raw Arc/MenuItem handles, not
// tauri::State extractors, so it can't call the #[tauri::command]
// version directly). Re-applies the closable/taskmgr/quit_item lock
// surface from the combined signal, and updates the tray tooltip on a
// real edge while idle.
pub(crate) fn apply_schedule_active_lock(
    app: &AppHandle,
    session_active: &Arc<AtomicBool>,
    schedule_active: &Arc<AtomicBool>,
    quit_item: &MenuItem<tauri::Wry>,
) {
    let locked = lock_should_hold(session_active, schedule_active);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_closable(!locked);
        #[cfg(target_os = "windows")]
        set_native_closable(&window, !locked);
    }
    if let Err(e) = taskmgr_guard::set_disabled(locked) {
        eprintln!("taskmgr_guard: failed to set disabled={locked}: {e}");
    }
    let _ = quit_item.set_enabled(!locked);

    if !session_active.load(Ordering::SeqCst) {
        let text = if schedule_active.load(Ordering::SeqCst) {
            "RevM2 - Schedule active (locked, no session right now)".to_string()
        } else {
            "RevM2 - No active session".to_string()
        };
        let _ = set_tray_status(app.clone(), text);
    }
}

#[tauri::command]
async fn set_schedule_active(
    app: AppHandle,
    state: tauri::State<'_, SessionState>,
    schedule_state: tauri::State<'_, ScheduleActiveState>,
    quit_item: tauri::State<'_, MenuItem<tauri::Wry>>,
    active: bool,
) -> Result<(), String> {
    schedule_state.0.store(active, Ordering::SeqCst);
    apply_schedule_active_lock(&app, &state.0, &schedule_state.0, &quit_item);
    Ok(())
}



// The actual logic behind set_session_active, pulled out so
// native_poll.rs's fallback Supabase poll can drive the exact same state
// machine as the webview's own poll - the two are meant to be
// indistinguishable to everything downstream (browser_guard, app_guard,
// the close/quit lock, the taskmgr backstop). See native_poll.rs's module
// doc for why a second caller of this exists at all.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_session_state(
    app: &AppHandle,
    state: &Arc<AtomicBool>,
    schedule_active: &Arc<AtomicBool>,
    blocked_apps: &app_guard::SharedBlockList,
    grace_tracker: &Arc<BrowserGraceTracker>,
    heartbeat_state: &Arc<heartbeat::HeartbeatState>,
    quit_item: &MenuItem<tauri::Wry>,
    last_sync: &Arc<std::sync::atomic::AtomicI64>,
    backstop_fire_at: &Arc<std::sync::atomic::AtomicI64>,
    active: bool,
    ends_at: Option<String>,
) {
    // Any call at all - true or false - proves whichever poll called this
    // (webview or native) is still alive and reaching us. This is what the
    // watchdog checks for staleness, independent of whatever `active`
    // value came in.
    last_sync.store(now_ts(), Ordering::SeqCst);

    let was_active = state.swap(active, Ordering::SeqCst);
    write_session_lock(active);

    // Session genuinely ending (the normal path, or the watchdog below) -
    // put the tray back to its true idle state instead of leaving it
    // showing stale "Session active..."/"closed: ..." text from the guard
    // loop, which only updates the tooltip while a session is active.
    // Only actually goes idle if nothing else (a still-enabled schedule)
    // is holding the lock - otherwise this would flash "No active
    // session" for a moment right as a schedule keeps it locked anyway.
    if was_active && !active {
        let idle_text = if schedule_active.load(Ordering::SeqCst) {
            "RevM2 - Schedule active (locked, no session right now)".to_string()
        } else {
            "RevM2 - No active session".to_string()
        };
        let _ = set_tray_status(app.clone(), idle_text);
    }

    // Hide the taskbar/title-bar close ("X") control while the app should
    // stay locked - either a block is literally active, OR the account
    // has any schedule enabled at all (see ScheduleActiveState's doc for
    // why that's a second, OR'd-in flag rather than folded into `active`
    // itself). Runs on every call (not just the false->true edge) so it
    // stays correct even if a call is ever missed or retried.
    let locked = lock_should_hold(state, schedule_active);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_closable(!locked);
        #[cfg(target_os = "windows")]
        set_native_closable(&window, !locked);
    }

    // Task Manager is the single most common way to just kill
    // revm2-desktop.exe and walk away from every other guard above -
    // lock it for the same window the close/quit controls are locked.
    // Runs on every call, same reasoning as set_closable above: stays
    // correct even if a call is ever missed or retried.
    if let Err(e) = taskmgr_guard::set_disabled(locked) {
        eprintln!("taskmgr_guard: failed to set disabled={locked}: {e}");
    }

    // External, process-independent backstop: if this process dies
    // outright before it gets a chance to release the lock itself (see
    // taskmgr_backstop's module doc), a Scheduled Task fires on its own
    // and clears it.
    if active {
        // Prefer the real end time whenever it's known - deterministic,
        // so repeated polls with the same ends_at never cause a
        // needless reschedule. Only fall back to the drifting "now +
        // ceiling" anchor on the false->true edge, when no real end
        // time is known yet; on later polls that still don't have one,
        // deliberately leave whatever was already scheduled alone
        // rather than recomputing against a moving "now" - that would
        // defeat the dedup below and re-spawn schtasks.exe on every
        // single 5s poll tick for the life of an unlimited session.
        let fire_at = match ends_at.as_deref().and_then(taskmgr_backstop::compute_fire_at_from_ends_at) {
            Some(fire_at) => Some(fire_at),
            None if !was_active => Some(taskmgr_backstop::indefinite_ceiling_from_now()),
            None => None,
        };
        if let Some(fire_at) = fire_at {
            let prev = backstop_fire_at.swap(fire_at, Ordering::SeqCst);
            if prev != fire_at {
                if let Err(e) = taskmgr_backstop::schedule(fire_at) {
                    eprintln!("taskmgr_backstop: failed to schedule: {e}");
                }
            }
        }
    } else {
        // Dedup, same idea as schedule()'s compare-and-swap above: only
        // actually spawn schtasks /delete if there was something to
        // cancel. Without this, cancel() fired unconditionally on every
        // single poll tick with active=false - which, since the frontend
        // polls every 5s (see blocks.html/tracker.html's
        // pollBlockStatusForDesktop) and most of the time there's no
        // active session at all, meant spawning schtasks.exe every 5
        // seconds forever during ordinary idle use.
        let prev = backstop_fire_at.swap(0, Ordering::SeqCst);
        if prev != 0 {
            if let Err(e) = taskmgr_backstop::cancel() {
                eprintln!("taskmgr_backstop: failed to cancel: {e}");
            }
        }
    }

    // Same reasoning for the tray's "Quit RevM2" item - the real gate is
    // in the "quit" match arm in the tray's on_menu_event handler, this
    // just keeps the visible state honest.
    let _ = quit_item.set_enabled(!locked);

    // "Always check for extension active or not whenever a block
    // starts" - without this, a block that starts with the extension
    // already disabled/incognito-blind has to wait for the periodic
    // loop's next 3s tick to notice at all. Only fires on the
    // false->true edge, not on every call (stopping a session, or a
    // redundant start-while-already-active, shouldn't re-trigger it).
    if active && !was_active {
        let app = app.clone();
        let blocked_apps = blocked_apps.clone();
        let grace_tracker = grace_tracker.clone();
        let heartbeat_state = heartbeat_state.clone();
        tauri::async_runtime::spawn(async move {
            run_guard_tick(&app, &blocked_apps, &grace_tracker, &heartbeat_state).await;
        });
    }
}

// Manual override, independent of session state - lets the frontend (or
// a debug/testing flow) toggle the lock directly without starting a real
// focus session. The automatic hook in set_session_active above is what
// normally drives this; this command exists alongside it the same way
// set_blocked_apps exists alongside the automatic guard tick.
#[tauri::command]
fn set_taskmgr_disabled(disabled: bool) -> Result<(), String> {
    taskmgr_guard::set_disabled(disabled)
}

// Called by shared.js's syncNativeAuthToken (see requireAuth()) so
// native_poll.rs's fallback poll has a current Supabase access token to
// work with, independent of whatever the webview's own poll is doing.
// Safe to call redundantly - every call just overwrites the cached value,
// and shared.js does call it redundantly on purpose (once after every
// requireAuth(), and again on every onAuthStateChange event, including
// token refreshes).
#[tauri::command]
fn sync_native_auth(
    auth_state: tauri::State<Arc<native_poll::AuthState>>,
    user_id: String,
    access_token: String,
    refresh_token: String,
    supabase_url: String,
    supabase_anon_key: String,
) -> Result<(), String> {
    if let Ok(mut guard) = auth_state.0.lock() {
        *guard = Some(native_poll::AuthInfo {
            user_id,
            access_token,
            refresh_token,
            supabase_url,
            supabase_anon_key,
        });
    }
    Ok(())
}

#[tauri::command]
fn debug_browser_status(heartbeat: tauri::State<Arc<heartbeat::HeartbeatState>>) -> Result<Vec<(String, bool, bool, String)>, String> {
    Ok(browser_guard::debug_status(&heartbeat))
}

// Called from blocks.html (only meaningful when running inside the
// desktop webview - see isDesktopApp()) right alongside the existing
// set_session_active invoke, and again on every loadActiveBlock() tick so
// a change noticed by *that* poll (e.g. another device ending the session
// via emergency unlock) also reaches the extension without waiting on its
// own separate Edge Function poll. Safe to call redundantly with
// unchanged state - see SessionEventBus::push.
#[tauri::command]
fn push_session_event(
    bridge: tauri::State<Arc<session_bridge::SessionEventBus>>,
    active: bool,
    session: Option<serde_json::Value>,
) -> Result<(), String> {
    bridge.push(active, session.unwrap_or(serde_json::Value::Null));
    Ok(())
}

// icon's tooltip always reflects the latest known state, even when the
// main window is closed/minimized.
#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_tooltip(Some(text.as_str())).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Native app blocking (extension can't reach these) --------------------

#[tauri::command]
fn list_running_apps() -> Result<Vec<app_guard::RunningApp>, String> {
    Ok(app_guard::list_running_apps())
}

#[derive(serde::Serialize)]
struct BlockedAppsInfo {
    apps: Vec<String>,
    mode: String, // "blacklist" | "whitelist"
}

#[tauri::command]
fn get_blocked_apps(app: tauri::AppHandle) -> Result<BlockedAppsInfo, String> {
    let store = app.store(BLOCKED_APPS_STORE).map_err(|e| e.to_string())?;
    let apps = store
        .get(BLOCKED_APPS_KEY)
        .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
        .unwrap_or_default();
    let mode = store
        .get(BLOCKED_APPS_MODE_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "blacklist".to_string());
    Ok(BlockedAppsInfo { apps, mode })
}

#[tauri::command]
fn set_blocked_apps(
    app: tauri::AppHandle,
    blocked: tauri::State<app_guard::SharedBlockList>,
    apps: Vec<String>,
    mode: Option<String>,
) -> Result<(), String> {
    apply_blocked_apps(&app, blocked.inner(), apps, mode)
}

// Shared by the tauri command above and native_poll.rs's fallback poll -
// same reasoning as apply_session_state.
pub(crate) fn apply_blocked_apps(
    app: &tauri::AppHandle,
    blocked: &app_guard::SharedBlockList,
    apps: Vec<String>,
    mode: Option<String>,
) -> Result<(), String> {
    let mode = app_guard::AppMode::from_str_lenient(mode.as_deref().unwrap_or("blacklist"));
    let mode_str = match mode {
        app_guard::AppMode::Whitelist => "whitelist",
        app_guard::AppMode::Blacklist => "blacklist",
    };

    let store = app.store(BLOCKED_APPS_STORE).map_err(|e| e.to_string())?;
    store.set(BLOCKED_APPS_KEY, serde_json::json!(apps.clone()));
    store.set(BLOCKED_APPS_MODE_KEY, serde_json::json!(mode_str));
    store.save().map_err(|e| e.to_string())?;
    *blocked.lock().map_err(|_| "lock poisoned".to_string())? = app_guard::BlockedApps { apps, mode };
    Ok(())
}

// Applies the 60s-grace rule to whatever browser_guard currently sees
// as unprotected-and-running. Returns four things:
//   1. browsers that have been unprotected for >= EXTENSION_GRACE_SECS
//      and should be closed THIS tick.
//   2. the browser with the least time remaining in its grace window
//      (for the tray tooltip countdown).
//   3. browsers whose grace window STARTED this exact tick - i.e. the
//      first time they were seen unprotected, not a repeat of an
//      already-running countdown. This is what the on-screen "you have
//      60 seconds" popup keys off of, so it fires once per disable
//      event instead of once per 3s tick.
//   4. browsers that had an active grace timer last tick and are now
//      running WITH the extension protecting them again - i.e. actually
//      re-enabled in time, not just closed some other way (which would
//      also drop out of the grace tracker but isn't worth a "you're
//      covered again" popup).
fn apply_grace_period(
    tracker: &BrowserGraceTracker,
    heartbeat: &heartbeat::HeartbeatState,
) -> (
    Vec<&'static str>,
    Option<(&'static str, i64)>,
    Vec<&'static str>,
    Vec<&'static str>,
) {
    let unprotected = browser_guard::unprotected_running_browsers(heartbeat);
    let unprotected_set: std::collections::HashSet<&'static str> =
        unprotected.iter().copied().collect();

    let mut guard = tracker.0.lock().unwrap_or_else(|e| e.into_inner());
    let now = now_ts();

    // Anything that had a grace timer running last tick but isn't in the
    // unprotected list anymore either got the extension re-enabled in
    // time, or was closed some other way (manually, or by us on a
    // previous tick). Snapshot the candidates before retain() drops them,
    // then narrow to "actually re-enabled" below via a fresh
    // running+protected check - "no longer unprotected" alone doesn't
    // distinguish the two.
    let recovered_candidates: Vec<String> = guard.keys().cloned().collect();
    let recovered_candidates: Vec<String> = recovered_candidates
        .into_iter()
        .filter(|name| !unprotected_set.contains(name.as_str()))
        .collect();

    // Reset the timer for anything that's protected again (or not
    // running) - a browser that fixes itself gets a clean slate, not
    // partial credit toward being closed later.
    guard.retain(|name, _| unprotected_set.contains(name.as_str()));

    let mut to_close = Vec::new();
    let mut soonest: Option<(&'static str, i64)> = None;
    let mut newly_started = Vec::new();

    for name in unprotected {
        let is_new = !guard.contains_key(name);
        let since = *guard.entry(name.to_string()).or_insert(now);
        let elapsed = now - since;
        let remaining = (EXTENSION_GRACE_SECS - elapsed).max(0);

        if is_new {
            newly_started.push(name);
        }

        if elapsed >= EXTENSION_GRACE_SECS {
            to_close.push(name);
        } else if soonest.map(|(_, r)| remaining < r).unwrap_or(true) {
            soonest = Some((name, remaining));
        }
    }
    drop(guard);

    let mut recovered = Vec::new();
    if !recovered_candidates.is_empty() {
        let statuses = browser_guard::debug_status(heartbeat);
        for target in browser_guard::supported_browsers() {
            if !recovered_candidates.iter().any(|n| n == target.name) {
                continue;
            }
            let protected_now = statuses
                .iter()
                .any(|(name, running, ext_ok, _reason)| name == target.name && *running && *ext_ok);
            if protected_now {
                recovered.push(target.name);
            }
        }
    }

    (to_close, soonest, newly_started, recovered)
}

// Runs forever on its own async task: every 3s, if a session is active,
// applies the extension-grace-period check to browsers and the
// immediate check to user-selected native apps.
async fn run_guard_tick(
    app: &AppHandle,
    blocked_apps: &app_guard::SharedBlockList,
    grace_tracker: &Arc<BrowserGraceTracker>,
    heartbeat_state: &Arc<heartbeat::HeartbeatState>,
) {
    let mut closed: Vec<String> = Vec::new();

    let (to_close, soonest_grace, newly_started, recovered) = apply_grace_period(grace_tracker, heartbeat_state);

    // One popup per disable event, right when the countdown
    // starts - not once per 3s tick, and not silently buried
    // in a tooltip nobody's hovering over.
    for name in &newly_started {
        let reason = browser_guard::supported_browsers()
            .into_iter()
            .find(|t| t.name == *name)
            .map(|t| browser_guard::protection_gap_reason(&t, heartbeat_state))
            .unwrap_or("disabled");
        if reason == "incognito" {
            notify(
                app,
                "RevM2 - Incognito access not allowed",
                &format!(
                    "{name}'s RevM2 extension doesn't have Incognito access. Go to chrome://extensions -> RevM2 -> Details -> turn on \"Allow in Incognito\" within {EXTENSION_GRACE_SECS} seconds or {name} will be closed."
                ),
            );
        } else if reason == "site_access" {
            notify(
                app,
                "RevM2 - Site access restricted",
                &format!(
                    "{name}'s RevM2 extension's Site access is set to something other than \"On all sites\". Go to chrome://extensions -> RevM2 -> Details -> Site access -> \"On all sites\" within {EXTENSION_GRACE_SECS} seconds or {name} will be closed."
                ),
            );
        } else {
            notify(
                app,
                "RevM2 - Extension disabled",
                &format!(
                    "{name}'s RevM2 extension is missing or disabled. Re-enable it within {EXTENSION_GRACE_SECS} seconds or {name} will be closed."
                ),
            );
        }
    }

    // Confirms the re-enable actually landed - otherwise the only
    // feedback is the countdown popup disappearing, which is easy
    // to miss and doesn't say whether it worked.
    for name in &recovered {
        notify(
            app,
            "RevM2 - Extension re-enabled",
            &format!("{name}'s RevM2 extension is back on - {name} is protected again."),
        );
    }

    if !to_close.is_empty() {
        // Repetitive on purpose: this fires every 3s tick for
        // as long as the browser stays unprotected and gets
        // reopened, not just once. There's no "grace used up,
        // now leave it alone" state.
        let killed = browser_guard::kill_browsers_by_name(&to_close);
        if !killed.is_empty() {
            eprintln!("browser_guard: grace expired, closed: {killed:?}");
            notify(
                app,
                "RevM2 - Browser closed",
                &format!(
                    "{} was closed because the RevM2 extension wasn't re-enabled in time.",
                    killed.join(", ")
                ),
            );
            closed.extend(killed.iter().map(|s| s.to_string()));
        }
    }

    let blocked = blocked_apps
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let killed_apps = app_guard::kill_blocked_apps(&blocked);
    if !killed_apps.is_empty() {
        eprintln!("app_guard: closed blocked apps: {killed_apps:?}");
        closed.extend(killed_apps);
    }

    // Whitelist mode's stronger promise: allowed apps aren't just spared,
    // they're expected to stay open - bring one back if the person closed
    // it themselves or it crashed mid-session. No-op in blacklist mode
    // and when the allow list is empty (see sync_and_relaunch_whitelisted).
    let mut relaunched_apps: Vec<String> = Vec::new();
    if blocked.mode == app_guard::AppMode::Whitelist {
        relaunched_apps = app_guard::sync_and_relaunch_whitelisted(app, &blocked.apps);
        if !relaunched_apps.is_empty() {
            eprintln!("app_guard: relaunched allowed apps: {relaunched_apps:?}");
            notify(
                app,
                "RevM2 - App reopened",
                &format!(
                    "{} was closed during your session and has been reopened - it's on your allow list.",
                    relaunched_apps.join(", ")
                ),
            );
        }
    }

    // Always on, independent of the user's own blacklist/whitelist - see
    // app_guard::kill_shell_processes for why.
    let killed_shells = app_guard::kill_shell_processes();
    if !killed_shells.is_empty() {
        eprintln!("app_guard: closed shell processes: {killed_shells:?}");
        closed.extend(killed_shells);
    }

    let status_text = if !closed.is_empty() {
        format!("RevM2 - closed: {}", closed.join(", "))
    } else if !relaunched_apps.is_empty() {
        format!("RevM2 - reopened: {}", relaunched_apps.join(", "))
    } else if let Some((name, remaining)) = soonest_grace {
        format!("RevM2 - {name} extension missing, {remaining}s until blocked")
    } else {
        "RevM2 - Session active, all protected".to_string()
    };
    let _ = set_tray_status(app.clone(), status_text);
}

// Runs forever: every WATCHDOG_CHECK_INTERVAL_SECS, if we're currently
// enforcing "session active" but haven't heard from the web page's poll
// (in either direction) for WATCHDOG_TIMEOUT_SECS, treat that as a dead
// poll rather than a real still-running session and release the lock
// ourselves - restore closability, re-enable quit, clear the session
// lock file, reset the tray. This does NOT touch the actual focus_lock_sessions
// row in Supabase (this process has no way to know if that's stale too),
// so the website may still show a block as active - it just means this
// specific desktop app stops enforcing/blocking its own close until the
// web page reconnects and syncs the real state again.
fn spawn_watchdog_loop(
    app: AppHandle,
    session_active: Arc<AtomicBool>,
    schedule_active: Arc<AtomicBool>,
    last_sync: Arc<std::sync::atomic::AtomicI64>,
    quit_item: MenuItem<tauri::Wry>,
    backstop_fire_at: Arc<std::sync::atomic::AtomicI64>,
) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(WATCHDOG_CHECK_INTERVAL_SECS));
        loop {
            interval.tick().await;
            if !session_active.load(Ordering::SeqCst) {
                continue;
            }
            let last = last_sync.load(Ordering::SeqCst);
            let stale_for = now_ts() - last;
            if stale_for < WATCHDOG_TIMEOUT_SECS {
                continue;
            }

            eprintln!(
                "watchdog: no set_session_active call in {stale_for}s (timeout {WATCHDOG_TIMEOUT_SECS}s) - releasing session lock as a fail-safe"
            );
            session_active.store(false, Ordering::SeqCst);
            write_session_lock(false);

            // Only fully unlock (closable, Task Manager) if there's ALSO
            // no active schedule holding the lock independently - the
            // whole point of ScheduleActiveState is that it must survive
            // this exact release. Without this check, a monitor simply
            // turning off long enough to stale the webview poll would
            // silently defeat the schedule-based lock too.
            let still_locked = schedule_active.load(Ordering::SeqCst);
            if !still_locked {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_closable(true);
                    #[cfg(target_os = "windows")]
                    set_native_closable(&window, true);
                }
                let _ = quit_item.set_enabled(true);
                if let Err(e) = taskmgr_guard::set_disabled(false) {
                    eprintln!("taskmgr_guard: failed to re-enable during watchdog release: {e}");
                }
            }
            backstop_fire_at.store(0, Ordering::SeqCst);
            if let Err(e) = taskmgr_backstop::cancel() {
                eprintln!("taskmgr_backstop: failed to cancel during watchdog release: {e}");
            }
            let idle_text = if still_locked {
                "RevM2 - Schedule active (locked, no session right now)".to_string()
            } else {
                "RevM2 - No active session".to_string()
            };
            let _ = set_tray_status(app.clone(), idle_text);

            notify(
                &app,
                "RevM2 - Block auto-released",
                "Lost contact with your account for a couple of minutes, so the block was released as a safety measure. Open RevM2 in your browser to confirm your session actually ended.",
            );
        }
    });
}

fn spawn_guard_loop(
    app: AppHandle,
    session_active: Arc<AtomicBool>,
    blocked_apps: app_guard::SharedBlockList,
    grace_tracker: Arc<BrowserGraceTracker>,
    heartbeat_state: Arc<heartbeat::HeartbeatState>,
) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            if !session_active.load(Ordering::SeqCst) {
                // Not in a session - no enforcement, and no point
                // carrying stale grace timers into the next session.
                if let Ok(mut g) = grace_tracker.0.lock() {
                    g.clear();
                }
                continue;
            }

            run_guard_tick(&app, &blocked_apps, &grace_tracker, &heartbeat_state).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_active = Arc::new(AtomicBool::new(false));
    let schedule_active = Arc::new(AtomicBool::new(false));
    let blocked_apps: app_guard::SharedBlockList = Arc::new(Mutex::new(app_guard::BlockedApps::default()));
    let grace_tracker = Arc::new(BrowserGraceTracker(Mutex::new(HashMap::new())));
    let heartbeat_state = Arc::new(heartbeat::HeartbeatState::new());
    let session_bridge = Arc::new(session_bridge::SessionEventBus::new());
    let gate_guard_state = Arc::new(gate_guard::GateGuardState::new());
    // Seeded to "now" rather than 0/never - session_active also starts
    // false, so the watchdog is a no-op until a session actually begins,
    // but seeding it means a slow first poll after launch can never itself
    // read as WATCHDOG_TIMEOUT_SECS of staleness.
    let last_sync = Arc::new(std::sync::atomic::AtomicI64::new(now_ts()));
    // 0 = no backstop scheduled task currently pending.
    let backstop_fire_at = Arc::new(std::sync::atomic::AtomicI64::new(0));
    // 0 = never notified yet; see CLOSE_NOTIFY_COOLDOWN_SECS above.
    let last_close_notify_ts = Arc::new(std::sync::atomic::AtomicI64::new(0));
    // (No longer need a session_active clone here - ExitRequested is
    // prevented unconditionally now; see the run() closure below.)
    // See native_poll.rs's module doc: the desktop app's own independent,
    // OS-timer-driven check of Supabase, so schedule-driven blocks keep
    // starting/ending correctly even when the webview's JS poll is
    // throttled or paused (e.g. the monitor turning off).
    let auth_state = Arc::new(native_poll::AuthState::new());

    // Starts listening immediately, independent of session state - the
    // extension heartbeats regardless of whether a focus session is
    // active, so by the time a session actually starts we already have a
    // fresh signal instead of waiting on the first heartbeat after the
    // fact.
    heartbeat::spawn_heartbeat_server(heartbeat_state.clone(), session_bridge.clone(), gate_guard_state.clone());

    tauri::Builder::default()
        // Must be registered before any other plugin (tauri-plugin-single-
        // instance's own requirement). Without this, launching the app a
        // second time - e.g. from a Start Menu shortcut while it's already
        // running quietly in the tray after auto-starting at login - spins
        // up a second process. That second process tries to bind the same
        // heartbeat port (127.0.0.1:47552) the first one already holds,
        // fails silently (see heartbeat::spawn_heartbeat_server), and ends
        // up running its own private, disconnected session-event bus that
        // nothing is listening to. Any "Start"/"End" click in that second
        // window then updates state nobody's watching, and the browser
        // extension only ever finds out via its own slow ~35s background
        // poll - which is exactly the "it takes a while to reach the
        // extension unless I refresh the site in an actual browser tab"
        // symptom (the direct browser-tab-to-extension path bypasses the
        // desktop app, and its own poll, entirely). Focusing the existing
        // window on a second launch, instead of starting a second process,
        // closes that gap.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Launches RevM2 at Windows login, passing --hidden so the
        // window is never shown at boot - just the tray icon, with
        // native_poll.rs already ticking. Without this, a reboot (or the
        // app simply not being reopened) leaves nothing running to
        // notice a scheduled block start, or to hold the schedule-active
        // lock at all. MacosLauncher::LaunchAgent is ignored on Windows
        // (the plugin uses the registry Run key there instead) but is
        // still the required argument cross-platform.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SessionState(session_active.clone()))
        .manage(ScheduleActiveState(schedule_active.clone()))
        .manage(blocked_apps.clone())
        .manage(heartbeat_state.clone())
        .manage(grace_tracker.clone())
        .manage(session_bridge.clone())
        .manage(gate_guard_state.clone())
        .manage(LastSyncState(last_sync.clone()))
        .manage(BackstopFireAt(backstop_fire_at.clone()))
        .manage(auth_state.clone())
        .setup(move |app| {
            gate_guard_state.spawn_watchers(app.handle().clone());

            // Window starts invisible (see tauri.conf.json) so this is
            // the only place it ever appears - avoids a visible flash on
            // an autostart launch before we get a chance to check for
            // --hidden. A normal double-click launch (no arg) shows it
            // immediately, same as before this change.
            let launched_hidden = std::env::args().any(|a| a == "--hidden");
            if !launched_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }

            if let Ok(store) = app.store(BLOCKED_APPS_STORE) {
                if let Some(apps) = store
                    .get(BLOCKED_APPS_KEY)
                    .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                {
                    let mode = store
                        .get(BLOCKED_APPS_MODE_KEY)
                        .and_then(|v| v.as_str().map(|s| app_guard::AppMode::from_str_lenient(s)))
                        .unwrap_or_default();
                    if let Ok(mut guard) = blocked_apps.lock() {
                        *guard = app_guard::BlockedApps { apps, mode };
                    }
                }
            }

            // Clear any stale lock left behind by a crash/force-kill
            // from a previous run - the source of truth for "active"
            // is the website's session-status, re-synced within
            // seconds of launch via set_session_active; a leftover
            // lock file shouldn't block an uninstall forever.
            write_session_lock(false);

            // Same reasoning as write_session_lock(false) above: if the
            // last run crashed/was force-killed mid-session, don't start
            // back up with Task Manager still locked - the website
            // re-syncs the real state within seconds via
            // set_session_active, which will re-lock it if a session is
            // genuinely still active.
            if let Err(e) = taskmgr_guard::set_disabled(false) {
                eprintln!("taskmgr_guard: failed to clear stale lock on startup: {e}");
            }
            // Same reasoning: a leftover scheduled task from a run that
            // crashed mid-session shouldn't outlive this fresh start -
            // set_session_active will recreate it within seconds if a
            // session turns out to genuinely still be active.
            if let Err(e) = taskmgr_backstop::cancel() {
                eprintln!("taskmgr_backstop: failed to clear stale schedule on startup: {e}");
            }

            // Auto-enable on first run, so the reliability fix actually
            // takes effect without the person needing to know it exists.
            // Idempotent: enable() on an already-enabled autostart entry
            // is a no-op, so this is safe to run on every launch, not
            // just a genuine first run. Explicitly surfaced (not silent)
            // via the checkable tray item below - this app already asks
            // for a lot of trust (Task Manager lock, uninstall-adjacent
            // protections), so "runs at login" should be visible and
            // toggle-able, not just assumed.
            {
                use tauri_plugin_autostart::ManagerExt;
                let autolaunch = app.autolaunch();
                if matches!(autolaunch.is_enabled(), Ok(false)) {
                    if let Err(e) = autolaunch.enable() {
                        eprintln!("autostart: failed to enable: {e}");
                    }
                }
            }

            let debug_item = MenuItem::with_id(app, "debug_status", "Show Debug Status", true, None::<&str>)?;
            let autostart_enabled = {
                use tauri_plugin_autostart::ManagerExt;
                app.autolaunch().is_enabled().unwrap_or(true)
            };
            let autostart_item = tauri::menu::CheckMenuItem::with_id(
                app, "toggle_autostart", "Start with Windows", true, autostart_enabled, None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit RevM2", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&debug_item, &autostart_item, &quit_item])?;

            // Also managed as app state so set_session_active can grey it
            // out/re-enable it as sessions start and stop - see there.
            app.manage(quit_item.clone());

            let debug_session_active = session_active.clone();
            let debug_blocked_apps = blocked_apps.clone();
            let debug_heartbeat = heartbeat_state.clone();
            let quit_session_active = session_active.clone();
            let quit_schedule_active = schedule_active.clone();
            let autostart_item_handle = autostart_item.clone();

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("RevM2 - No active session")
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            // The menu item is greyed out while a session is
                            // active (see set_session_active), but that's
                            // just the visible cue - this is the real gate.
                            // Belt-and-braces against anything that could
                            // still fire the click (e.g. a stale enabled
                            // state from a missed toggle).
                            if quit_session_active.load(Ordering::SeqCst) {
                                notify(app, "RevM2 - Can't quit", "A block is active. End it from the app to quit.");
                                return;
                            }
                            if quit_schedule_active.load(Ordering::SeqCst) {
                                notify(app, "RevM2 - Can't quit", "A schedule is active on this account. Turn it off from Blocks to quit.");
                                return;
                            }
                            app.exit(0);
                        }
                        "toggle_autostart" => {
                            use tauri_plugin_autostart::ManagerExt;
                            let autolaunch = app.autolaunch();
                            let now_enabled = autolaunch.is_enabled().unwrap_or(true);
                            let result = if now_enabled {
                                autolaunch.disable()
                            } else {
                                autolaunch.enable()
                            };
                            match result {
                                Ok(()) => {
                                    let _ = autostart_item_handle.set_checked(!now_enabled);
                                }
                                Err(e) => {
                                    eprintln!("autostart: failed to toggle: {e}");
                                    // Reflect the real (unchanged) state rather
                                    // than leaving the checkbox showing a
                                    // toggle that didn't actually happen.
                                    let _ = autostart_item_handle.set_checked(now_enabled);
                                }
                            }
                        }
                        "debug_status" => {
                            let active = debug_session_active.load(Ordering::SeqCst);
                            let (apps, apps_mode) = debug_blocked_apps.lock()
                                .map(|g| (g.apps.clone(), g.mode))
                                .unwrap_or_default();
                            let browsers = browser_guard::debug_status(&debug_heartbeat);
                            let lines: Vec<String> = browsers.iter()
                                .map(|(name, running, protected, reason)| {
                                    let hb_age = debug_heartbeat.seconds_since_last(name)
                                        .map(|s| format!("{s}s ago"))
                                        .unwrap_or_else(|| "never".to_string());
                                    format!("{name}: running={running} protected={protected} reason={reason} last_heartbeat={hb_age}")
                                })
                                .collect();
                            let msg = format!(
                                "session_active: {active}\\nblocked_apps ({apps_mode:?}): {:?}\\n\\n{}",
                                apps, lines.join("\\n")
                            );
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval(&format!("alert({})", serde_json::to_string(&msg).unwrap_or_default()));
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            spawn_guard_loop(
                app.handle().clone(),
                session_active.clone(),
                blocked_apps.clone(),
                grace_tracker.clone(),
                heartbeat_state.clone(),
            );

            spawn_watchdog_loop(
                app.handle().clone(),
                session_active.clone(),
                schedule_active.clone(),
                last_sync.clone(),
                quit_item.clone(),
                backstop_fire_at.clone(),
            );

            native_poll::spawn_native_session_poll(
                app.handle().clone(),
                session_active.clone(),
                schedule_active.clone(),
                blocked_apps.clone(),
                grace_tracker.clone(),
                heartbeat_state.clone(),
                quit_item.clone(),
                last_sync.clone(),
                backstop_fire_at.clone(),
                auth_state.clone(),
            );

            // Belt-and-braces alongside set_native_closable/set_closable
            // above: those hide/grey the close affordance, but this is
            // the real gate. Covers Alt+F4 and the taskbar icon's own
            // right-click "Close window" entry, neither of which goes
            // through the title-bar/thumbnail X at all.
            if let Some(window) = app.get_webview_window("main") {
                let close_guard_session = session_active.clone();
                let close_guard_schedule = schedule_active.clone();
                let close_guard_app = app.handle().clone();
                let close_guard_last_notify = last_close_notify_ts.clone();
                let close_guard_window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Always prevent the default close - real exit is
                        // only ever the tray's "Quit RevM2" (app.exit(0)).
                        // What differs is what happens instead: locked,
                        // the window stays visible with a "can't close"
                        // notification (so it's obvious *why* nothing
                        // happened); idle, it just quietly hides to tray,
                        // matching ordinary tray-app behavior instead of
                        // fully exiting and losing the poll loop.
                        api.prevent_close();
                        let session_live = close_guard_session.load(Ordering::SeqCst);
                        let schedule_live = close_guard_schedule.load(Ordering::SeqCst);
                        if session_live || schedule_live {
                            let now = now_ts();
                            let last = close_guard_last_notify.load(Ordering::SeqCst);
                            if now - last >= CLOSE_NOTIFY_COOLDOWN_SECS {
                                close_guard_last_notify.store(now, Ordering::SeqCst);
                                let body = if session_live {
                                    "A block is active. End it from the app first."
                                } else {
                                    "A schedule is active on this account. Turn it off from Blocks first."
                                };
                                notify(&close_guard_app, "RevM2 - Can't close", body);
                            }
                        } else {
                            let _ = close_guard_window.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_tray_status,
            set_session_active,
            set_schedule_active,
            push_session_event,
            debug_browser_status,
            list_running_apps,
            get_blocked_apps,
            set_blocked_apps,
            set_taskmgr_disabled,
            sync_native_auth,
            gate_guard::gate_protection_start,
            gate_guard::gate_protection_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // Belt-and-braces alongside the CloseRequested guard registered
            // in setup() above: that one covers the main window
            // specifically, this covers the process-level exit request in
            // case anything else ever triggers one (e.g. all windows
            // closing some other way). Can't do anything about a hard
            // OS-level kill from Task Manager's "End task" - no user-space
            // code can intercept that - but every graceful shutdown path
            // goes through here.
            // Real exit is now ONLY ever app.exit(0) in the tray's "quit"
            // handler above - that call bypasses RunEvent entirely, so
            // this branch never sees it. Every other path that could
            // request an exit (last window closing, etc) is prevented
            // unconditionally, matching the window-close handler's shift
            // to always-minimize-to-tray rather than only guarding
            // during an active lock.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}

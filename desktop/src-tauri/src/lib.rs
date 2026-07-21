mod app_guard;
mod browser_guard;

#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_store::StoreExt;

const BLOCKED_APPS_STORE: &str = "revm2-blocked-apps.json";
const BLOCKED_APPS_KEY: &str = "blocked_apps";

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

fn now_ts() -> i64 {
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

// Shared flag: is a focus session currently active. Wrapped in Arc so the
// background poller task can hold its own clone independent of Tauri's
// managed-state lookup.
pub struct SessionState(pub Arc<AtomicBool>);

// Per-browser-name -> unix timestamp of when it was FIRST seen running
// without the extension, continuously. Reset to None the moment it's
// seen protected again. This is what turns "instant kill" into
// "60s grace, then kill, then keep killing on every tick if reopened."
pub struct BrowserGraceTracker(pub Mutex<HashMap<String, i64>>);

#[tauri::command]
fn set_session_active(state: tauri::State<SessionState>, active: bool) -> Result<(), String> {
    state.0.store(active, Ordering::SeqCst);
    write_session_lock(active);
    Ok(())
}

#[tauri::command]
fn debug_browser_status() -> Result<Vec<(String, bool, bool)>, String> {
    Ok(browser_guard::debug_status())
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

#[tauri::command]
fn get_blocked_apps(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let store = app.store(BLOCKED_APPS_STORE).map_err(|e| e.to_string())?;
    let apps = store
        .get(BLOCKED_APPS_KEY)
        .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
        .unwrap_or_default();
    Ok(apps)
}

#[tauri::command]
fn set_blocked_apps(
    app: tauri::AppHandle,
    blocked: tauri::State<app_guard::SharedBlockList>,
    apps: Vec<String>,
) -> Result<(), String> {
    let store = app.store(BLOCKED_APPS_STORE).map_err(|e| e.to_string())?;
    store.set(BLOCKED_APPS_KEY, serde_json::json!(apps.clone()));
    store.save().map_err(|e| e.to_string())?;
    *blocked.lock().map_err(|_| "lock poisoned".to_string())? = app_guard::BlockedApps(apps);
    Ok(())
}

// Applies the 60s-grace rule to whatever browser_guard currently sees
// as unprotected-and-running, returning the subset that have been
// unprotected for >= EXTENSION_GRACE_SECS and should be closed THIS
// tick. Also returns, for UI purposes, the browser with the least time
// remaining in its grace window (so the tray can show a countdown).
fn apply_grace_period(
    tracker: &BrowserGraceTracker,
) -> (Vec<&'static str>, Option<(&'static str, i64)>) {
    let unprotected = browser_guard::unprotected_running_browsers();
    let unprotected_set: std::collections::HashSet<&'static str> =
        unprotected.iter().copied().collect();

    let mut guard = tracker.0.lock().unwrap_or_else(|e| e.into_inner());
    let now = now_ts();

    // Reset the timer for anything that's protected again (or not
    // running) - a browser that fixes itself gets a clean slate, not
    // partial credit toward being closed later.
    guard.retain(|name, _| unprotected_set.contains(name.as_str()));

    let mut to_close = Vec::new();
    let mut soonest: Option<(&'static str, i64)> = None;

    for name in unprotected {
        let since = *guard.entry(name.to_string()).or_insert(now);
        let elapsed = now - since;
        let remaining = (EXTENSION_GRACE_SECS - elapsed).max(0);

        if elapsed >= EXTENSION_GRACE_SECS {
            to_close.push(name);
        } else if soonest.map(|(_, r)| remaining < r).unwrap_or(true) {
            soonest = Some((name, remaining));
        }
    }

    (to_close, soonest)
}

// Runs forever on its own async task: every 3s, if a session is active,
// applies the extension-grace-period check to browsers and the
// immediate check to user-selected native apps.
fn spawn_guard_loop(
    app: AppHandle,
    session_active: Arc<AtomicBool>,
    blocked_apps: app_guard::SharedBlockList,
    grace_tracker: Arc<BrowserGraceTracker>,
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

            let mut closed: Vec<String> = Vec::new();

            let (to_close, soonest_grace) = apply_grace_period(&grace_tracker);
            if !to_close.is_empty() {
                // Repetitive on purpose: this fires every 3s tick for
                // as long as the browser stays unprotected and gets
                // reopened, not just once. There's no "grace used up,
                // now leave it alone" state.
                let killed = browser_guard::kill_browsers_by_name(&to_close);
                if !killed.is_empty() {
                    eprintln!("browser_guard: grace expired, closed: {killed:?}");
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

            let status_text = if !closed.is_empty() {
                format!("RevM2 - closed: {}", closed.join(", "))
            } else if let Some((name, remaining)) = soonest_grace {
                format!("RevM2 - {name} extension missing, {remaining}s until blocked")
            } else {
                "RevM2 - Session active, all protected".to_string()
            };
            let _ = set_tray_status(app.clone(), status_text);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_active = Arc::new(AtomicBool::new(false));
    let blocked_apps: app_guard::SharedBlockList = Arc::new(Mutex::new(app_guard::BlockedApps::default()));
    let grace_tracker = Arc::new(BrowserGraceTracker(Mutex::new(HashMap::new())));

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionState(session_active.clone()))
        .manage(blocked_apps.clone())
        .setup(move |app| {
            if let Ok(store) = app.store(BLOCKED_APPS_STORE) {
                if let Some(apps) = store
                    .get(BLOCKED_APPS_KEY)
                    .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                {
                    if let Ok(mut guard) = blocked_apps.lock() {
                        *guard = app_guard::BlockedApps(apps);
                    }
                }
            }

            // Clear any stale lock left behind by a crash/force-kill
            // from a previous run - the source of truth for "active"
            // is the website's session-status, re-synced within
            // seconds of launch via set_session_active; a leftover
            // lock file shouldn't block an uninstall forever.
            write_session_lock(false);

            let quit_item = MenuItem::with_id(app, "quit", "Quit RevM2", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_item])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("RevM2 - No active session")
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            spawn_guard_loop(
                app.handle().clone(),
                session_active.clone(),
                blocked_apps.clone(),
                grace_tracker.clone(),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_tray_status,
            set_session_active,
            debug_browser_status,
            list_running_apps,
            get_blocked_apps,
            set_blocked_apps
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

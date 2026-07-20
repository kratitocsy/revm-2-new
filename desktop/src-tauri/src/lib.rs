mod browser_guard;
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, AppHandle};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

// Shared flag: is a focus session currently active. Wrapped in Arc so the
// background poller task can hold its own clone independent of Tauri's
// managed-state lookup.
pub struct SessionState(pub Arc<AtomicBool>);

#[tauri::command]
fn set_session_active(state: tauri::State<SessionState>, active: bool) -> Result<(), String> {
    state.0.store(active, Ordering::SeqCst);
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

// Runs forever on its own async task: every 3s, if a session is active,
// asks browser_guard which browsers are unprotected and kills them.
fn spawn_browser_guard_loop(app: AppHandle, session_active: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            if !session_active.load(Ordering::SeqCst) {
                continue;
            }
            let killed = browser_guard::kill_unprotected_browsers();
            if !killed.is_empty() {
                eprintln!("browser_guard: killed unprotected browsers: {killed:?}");
                let _ = set_tray_status(
                    app.clone(),
                    format!("RevM2 - closed unprotected: {}", killed.join(", ")),
                );
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_active = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionState(session_active.clone()))
        .setup(move |app| {
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

            spawn_browser_guard_loop(app.handle().clone(), session_active.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_tray_status,
            set_session_active,
            debug_browser_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
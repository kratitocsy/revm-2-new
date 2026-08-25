fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "greet",
                "set_tray_status",
                "set_session_active",
                "set_schedule_active",
                "sync_native_auth",
                "debug_browser_status",
                "list_running_apps",
                "get_blocked_apps",
                "set_blocked_apps",
                "push_session_event",
                "gate_protection_start",
                "gate_protection_stop",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

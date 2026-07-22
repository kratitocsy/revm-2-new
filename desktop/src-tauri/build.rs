fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "greet",
                "set_tray_status",
                "set_session_active",
                "debug_browser_status",
                "list_running_apps",
                "get_blocked_apps",
                "set_blocked_apps",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

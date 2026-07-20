// Detects whether the RevM2 browser extension is installed+enabled in any
// Chromium-based browser on this machine, and (while a focus session is
// active) kills browser processes that don't have it - same spirit as
// Cold Turkey's "install the extension in every browser" enforcement.
//
// Only covers Chromium-family browsers (Chrome, Edge, Brave, Opera,
// Vivaldi) since they all share the same extension format/ID derivation.
// Firefox uses an entirely different extension system and isn't covered.

use serde_json::Value;
use std::path::PathBuf;
use sysinfo::{Pid, System};

// Computed once (see the conversation) from the fixed "key" in the
// extension's manifest.json - deterministic no matter where it's unpacked.
pub const EXTENSION_ID: &str = "knofmgookchmjekaefloaljcamjlbnmp";

pub struct BrowserTarget {
    pub name: &'static str,
    pub process_names: &'static [&'static str], // case-insensitive match against sysinfo's process name
    pub user_data_dir: fn() -> Option<PathBuf>,
}

fn local_appdata() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

pub fn supported_browsers() -> Vec<BrowserTarget> {
    vec![
        BrowserTarget {
            name: "Chrome",
            process_names: &["chrome.exe"],
            user_data_dir: || local_appdata().map(|p| p.join("Google\\Chrome\\User Data")),
        },
        BrowserTarget {
            name: "Edge",
            process_names: &["msedge.exe"],
            user_data_dir: || local_appdata().map(|p| p.join("Microsoft\\Edge\\User Data")),
        },
        BrowserTarget {
            name: "Brave",
            process_names: &["brave.exe"],
            user_data_dir: || local_appdata().map(|p| p.join("BraveSoftware\\Brave-Browser\\User Data")),
        },
        BrowserTarget {
            name: "Opera",
            process_names: &["opera.exe"],
            user_data_dir: || local_appdata().map(|p| p.join("Opera Software\\Opera Stable")),
        },
        BrowserTarget {
            name: "Vivaldi",
            process_names: &["vivaldi.exe"],
            user_data_dir: || local_appdata().map(|p| p.join("Vivaldi\\User Data")),
        },
    ]
}

// Checks every profile folder (Default, Profile 1, Profile 2, ...) under a
// browser's User Data directory for our extension being present AND
// enabled (state == 1 in Chromium's Preferences JSON).
fn extension_enabled_in_profile(prefs_path: &PathBuf) -> bool {
    let Ok(content) = std::fs::read_to_string(prefs_path) else { return false };
    let Ok(json): Result<Value, _> = serde_json::from_str(&content) else { return false };
    let state = json
        .pointer(&format!("/extensions/settings/{EXTENSION_ID}/state"));
    matches!(state.and_then(|v| v.as_i64()), Some(1))
}

pub fn is_extension_installed(target: &BrowserTarget) -> bool {
    let Some(user_data_dir) = (target.user_data_dir)() else { return false };
    let Ok(entries) = std::fs::read_dir(&user_data_dir) else { return false };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Profile folders are "Default" or "Profile N" - skip anything else
        // (caches, extensions staging dirs, etc.) to avoid false negatives
        // from unrelated folders.
        if name != "Default" && !name.starts_with("Profile ") { continue; }

        let prefs = path.join("Preferences");
        if extension_enabled_in_profile(&prefs) {
            return true;
        }
    }
    false
}

// Diagnostic snapshot - for each supported browser, is it currently
// running, and does is_extension_installed() think the extension is
// there. Exposed via a Tauri command so it can be queried live from
// DevTools without needing a rebuild each time.
pub fn debug_status() -> Vec<(String, bool, bool)> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    supported_browsers()
        .into_iter()
        .map(|target| {
            let running = sys.processes().values().any(|p| {
                target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name()))
            });
            let extension_installed = is_extension_installed(&target);
            (target.name.to_string(), running, extension_installed)
        })
        .collect()
}

// Returns the names of every supported browser that's currently running
// but doesn't have the extension enabled in any of its profiles.
pub fn unprotected_running_browsers() -> Vec<&'static str> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut result = Vec::new();
    for target in supported_browsers() {
        let running = sys.processes().values().any(|p| {
            target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name()))
        });
        if running && !is_extension_installed(&target) {
            result.push(target.name);
        }
    }
    result
}

// Kills every running process matching any supported browser that doesn't
// have the extension - called only while a focus session is active.
// Only reports a browser as "killed" if kill() actually reported success -
// previously this assumed every kill() call worked without checking.
pub fn kill_unprotected_browsers() -> Vec<&'static str> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = Vec::new();
    for target in supported_browsers() {
        if is_extension_installed(&target) { continue; }
        let pids: Vec<Pid> = sys
            .processes()
            .iter()
            .filter(|(_, p)| target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name())))
            .map(|(pid, _)| *pid)
            .collect();

        if pids.is_empty() { continue; }

        let mut any_succeeded = false;
        for pid in pids {
            if let Some(process) = sys.process(pid) {
                let ok = process.kill();
                if !ok {
                    eprintln!("browser_guard: failed to kill {} (pid {pid})", target.name);
                }
                any_succeeded = any_succeeded || ok;
            }
        }
        if any_succeeded {
            killed.push(target.name);
        }
    }
    killed
}
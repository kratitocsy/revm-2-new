// Kills user-selected native apps (games, etc. the browser extension has
// no reach into) while a focus session is active. Mirrors browser_guard.rs
// in spirit and structure, but the block list is user-configured rather
// than derived from extension state.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BlockedApps(pub Vec<String>); // process names, e.g. "steam.exe"

pub type SharedBlockList = Arc<Mutex<BlockedApps>>;

/// A running process, for the "pick which apps to block" UI. We surface
/// currently-running processes rather than scanning Program Files /
/// Start Menu — simpler, and in practice the user is picking apps they
/// know they run during study sessions, which are almost always already
/// open when they're configuring this.
#[derive(Debug, Clone, Serialize)]
pub struct RunningApp {
    pub name: String,
    pub pid: u32,
}

/// De-duplicated by process name (same app often has multiple processes),
/// skips obvious system/background noise so the picker list is usable.
pub fn list_running_apps() -> Vec<RunningApp> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let skip_prefixes = [
        "svchost", "system", "registry", "runtime", "dwm", "csrss", "wininit",
        "smss", "lsass", "services", "conhost", "revm2-desktop",
    ];

    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<RunningApp> = sys
        .processes()
        .values()
        .filter_map(|p| {
            let name = p.name(); // &str in sysinfo 0.30, same as browser_guard.rs
            let lower = name.to_lowercase();
            if skip_prefixes.iter().any(|s| lower.starts_with(s)) {
                return None;
            }
            if !seen.insert(lower) {
                return None; // already have this process name
            }
            Some(RunningApp { name: name.to_string(), pid: p.pid().as_u32() })
        })
        .collect();

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

/// Kills every running process matching a name in the block list.
/// Called on the same tick as browser_guard's check, only while a
/// session is active. Returns the names actually killed (kill()
/// reported success) so the UI/tray can show what happened, same
/// pattern as kill_unprotected_browsers().
pub fn kill_blocked_apps(blocked: &BlockedApps) -> Vec<String> {
    if blocked.0.is_empty() {
        return Vec::new();
    }
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = std::collections::HashSet::new();
    for process in sys.processes().values() {
        let name = process.name(); // &str in sysinfo 0.30
        let matches = blocked.0.iter().any(|b| b.eq_ignore_ascii_case(name));
        if matches {
            let ok = process.kill();
            if ok {
                killed.insert(name.to_string());
            } else {
                eprintln!("app_guard: failed to kill {name} (pid {})", process.pid());
            }
        }
    }
    killed.into_iter().collect()
}

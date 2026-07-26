// Kills user-selected native apps (games, etc. the browser extension has
// no reach into) while a focus session is active. Mirrors browser_guard.rs
// in spirit and structure, but the block list is user-configured rather
// than derived from extension state.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use sysinfo::System;

/// Mirrors the `apps_mode` check constraint on focus_lock_sessions /
/// focus_lock_presets in Supabase ('blacklist' | 'whitelist'). Serialized
/// lowercase so it round-trips directly against those column values and
/// against what blocks.html sends over `set_blocked_apps`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppMode {
    Blacklist,
    Whitelist,
}

impl Default for AppMode {
    fn default() -> Self {
        AppMode::Blacklist
    }
}

impl AppMode {
    /// Tolerant parse for whatever a JS `mode` string turns out to be -
    /// anything other than exactly "whitelist" falls back to the
    /// historical (and safer-by-default) blacklist behavior.
    pub fn from_str_lenient(s: &str) -> Self {
        if s.eq_ignore_ascii_case("whitelist") {
            AppMode::Whitelist
        } else {
            AppMode::Blacklist
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BlockedApps {
    pub apps: Vec<String>, // process names, e.g. "steam.exe"
    #[serde(default)]
    pub mode: AppMode,
}

pub type SharedBlockList = Arc<Mutex<BlockedApps>>;

/// Processes we refuse to touch even in whitelist mode ("close everything
/// except these"), because killing them takes down the whole desktop
/// session rather than just an app the user meant to step away from.
/// This is deliberately broader than the picker's skip_prefixes below -
/// that list only trims noise from a UI the user is choosing FROM, this
/// one is a hard safety net for logic that kills things automatically.
/// Best-effort: it covers core Windows shell/session processes, not every
/// third-party background agent (antivirus, GPU driver helpers, etc.) -
/// those can still be added to the allow list by the user if needed.
const NEVER_KILL_PREFIXES: &[&str] = &[
    "svchost", "system", "idle", "registry", "runtime", "dwm", "csrss",
    "wininit", "winlogon", "smss", "lsass", "services", "conhost",
    "revm2-desktop", "explorer", "taskhost", "sihost", "ctfmon",
    "fontdrvhost", "dllhost", "searchindexer", "searchapp", "searchhost",
    "shellexperiencehost", "startmenuexperiencehost", "applicationframehost",
    "textinputhost", "securityhealth", "systemsettings", "userinit",
    "logonui", "audiodg", "wmiprvse", "lsaiso", "spoolsv",
    "backgroundtaskhost", "wudfhost",
];

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
///
/// Branches on `blocked.mode`:
///   - Blacklist (legacy/default): kill only processes whose name IS
///     in the list.
///   - Whitelist ("allow only these apps"): kill every running process
///     whose name is NOT in the list, except anything matching
///     NEVER_KILL_PREFIXES or a supported browser process (browsers stay
///     governed by browser_guard's extension-based check, which is the
///     more informed policy for them - this shouldn't fight that logic
///     or blindly close the browser the user is meant to be using).
pub fn kill_blocked_apps(blocked: &BlockedApps) -> Vec<String> {
    match blocked.mode {
        AppMode::Blacklist => kill_blacklisted(&blocked.apps),
        AppMode::Whitelist => kill_not_whitelisted(&blocked.apps),
    }
}

fn kill_blacklisted(apps: &[String]) -> Vec<String> {
    if apps.is_empty() {
        return Vec::new();
    }
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = std::collections::HashSet::new();
    for process in sys.processes().values() {
        let name = process.name(); // &str in sysinfo 0.30
        let matches = apps.iter().any(|b| b.eq_ignore_ascii_case(name));
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

fn kill_not_whitelisted(allowed: &[String]) -> Vec<String> {
    // An empty allow list almost certainly means "haven't picked apps
    // yet" rather than "block literally everything" - not touching
    // anything is the safer failure mode, same spirit as the empty-list
    // no-op in the blacklist branch above.
    if allowed.is_empty() {
        return Vec::new();
    }

    let browser_names: Vec<&'static str> = crate::browser_guard::supported_browsers()
        .into_iter()
        .flat_map(|t| t.process_names.iter().copied())
        .collect();

    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = std::collections::HashSet::new();
    for process in sys.processes().values() {
        let name = process.name(); // &str in sysinfo 0.30
        let lower = name.to_lowercase();

        if allowed.iter().any(|a| a.eq_ignore_ascii_case(name)) {
            continue; // explicitly allowed
        }
        if NEVER_KILL_PREFIXES.iter().any(|p| lower.starts_with(p)) {
            continue; // core OS/session process - never touch
        }
        if browser_names.iter().any(|b| b.eq_ignore_ascii_case(name)) {
            continue; // deferred to browser_guard's own enforcement
        }

        let ok = process.kill();
        if ok {
            killed.insert(name.to_string());
        } else {
            eprintln!("app_guard: failed to kill {name} (pid {})", process.pid());
        }
    }
    killed.into_iter().collect()
}

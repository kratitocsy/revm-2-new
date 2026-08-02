// Kills user-selected native apps (games, etc. the browser extension has
// no reach into) while a focus session is active. Mirrors browser_guard.rs
// in spirit and structure, but the block list is user-configured rather
// than derived from extension state.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

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
/// session, destabilizes the OS, or breaks hardware (display/audio/
/// network) rather than just closing an app the user meant to step away
/// from. This is deliberately broader than the picker's skip_prefixes
/// below - that list only trims noise from a UI the user is choosing
/// FROM, this one is a hard safety net for logic that kills things
/// automatically. Covers core Windows shell/session processes, built-in
/// antivirus, GPU/display driver helpers, and core networking/servicing -
/// still best-effort, not exhaustive across every vendor's background
/// agent, but the common/critical ones are named explicitly rather than
/// left to whatever the user happened to also add to their allow list.
const NEVER_KILL_PREFIXES: &[&str] = &[
    "svchost", "system", "idle", "registry", "runtime", "dwm", "csrss",
    "wininit", "winlogon", "smss", "lsass", "services", "conhost",
    "revm2-desktop", "explorer", "taskhost", "sihost", "ctfmon",
    "fontdrvhost", "dllhost", "searchindexer", "searchapp", "searchhost",
    "shellexperiencehost", "startmenuexperiencehost", "applicationframehost",
    "textinputhost", "securityhealth", "systemsettings", "userinit",
    "logonui", "audiodg", "wmiprvse", "lsaiso", "spoolsv",
    "backgroundtaskhost", "wudfhost",
    // Tauri on Windows renders through the WebView2 runtime, which spawns
    // "msedgewebview2.exe" helper/renderer processes distinct from real
    // Edge ("msedge.exe" - already skipped via browser_names below, but
    // that list intentionally only contains real, user-facing browsers).
    // Without this, whitelist app-mode killed RevM2's own UI process
    // mid-session (it's neither in this list nor a recognized browser),
    // leaving the window blank/dead and unable to ever report the
    // session as over.
    "msedgewebview2",
    // Windows Defender / built-in antivirus - killing these mid-scan or
    // mid-realtime-protection is a stability/security regression far
    // worse than anything gained by "blocking" them.
    "msmpeng", "nissrv", "mpcmdrun", "securityhealthservice",
    "windowsdefender",
    // GPU/display driver helper processes. These aren't optional UI you
    // can safely close - on some driver versions killing them mid-session
    // has taken the display driver down with them (black screen / forced
    // re-login), which is a much worse outcome than the app staying open.
    "nvcontainer", "nvdisplay.container", "nvwmi64",
    "igfxem", "igfxtray", "igfxhk", "igfxext",
    "amdrsserv", "radeonsoftware", "atieclxx", "atiesrxx",
    // Core networking/Bluetooth/audio stack - killing these can drop wifi,
    // Bluetooth peripherals, or all system audio for the rest of the
    // session, none of which is what "block distracting apps" means.
    "wlanext", "bthudtask", "audiosrv", "rtkaudservice", "rtkauduservice64",
    // Windows Update / servicing - not urgent to kill, and interrupting a
    // servicing operation mid-write is the kind of thing that produces a
    // corrupted update rather than a "blocked" one.
    "trustedinstaller", "tiworker", "wuauclt", "usoclient",
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
        "smss", "lsass", "services", "conhost", "revm2-desktop", "msedgewebview2",
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

/// Always-on, not user-configurable - unlike kill_blocked_apps above
/// (which only touches what the user picked), this runs unconditionally
/// on every guard tick while a session is active. Same reasoning as
/// taskmgr_guard: a shell is one of the most direct ways to bypass every
/// other layer here (taskkill the app, reg-delete the DisableTaskMgr/
/// DisableCmd values, etc.), so it gets closed the moment it's seen
/// running, same as an unprotected browser.
///
/// cmd.exe is ALSO registry-blocked from launching fresh (see
/// taskmgr_guard's DisableCmd) - it's still killed here too, because that
/// policy only stops NEW launches, not a command prompt that was already
/// open before the session started.
///
/// Honest limitation, same as anywhere else in this codebase that kills
/// on a timer: this runs on the same 3s cadence as everything else in
/// run_guard_tick, so a single command that starts and finishes inside
/// that window (a one-line `taskkill ...` and Enter) isn't stopped by
/// this - only a shell left open/idle is guaranteed to get closed on the
/// next tick.
const ALWAYS_KILL_SHELL_PROCESSES: &[&str] = &[
    "cmd.exe",
    "powershell.exe",
    "powershell_ise.exe",
    "pwsh.exe",       // PowerShell 7+
    "windowsterminal.exe",
    "wt.exe",
];

pub fn kill_shell_processes() -> Vec<String> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = std::collections::HashSet::new();
    for process in sys.processes().values() {
        let name = process.name(); // &str in sysinfo 0.30
        if ALWAYS_KILL_SHELL_PROCESSES.iter().any(|s| s.eq_ignore_ascii_case(name)) {
            let ok = process.kill();
            if ok {
                killed.insert(name.to_string());
            } else {
                eprintln!("app_guard: failed to kill shell process {name} (pid {})", process.pid());
            }
        }
    }
    killed.into_iter().collect()
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
        let lower = name.to_lowercase();

        // Same hard safety net as whitelist mode below - RevM2 itself and
        // core OS/session processes are never killed, even if a name here
        // ends up in the user's own blacklist (typo, bad preset, someone
        // else editing the list, etc.). Whitelist mode already had this
        // check; blacklist mode is the "kill only these named apps" path,
        // so it's a much more direct way for revm2-desktop to end up
        // self-terminating mid-session if it's ever missing here.
        if NEVER_KILL_PREFIXES.iter().any(|p| lower.starts_with(p)) {
            continue;
        }

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
    // Previously this treated an empty allow list as "user hasn't picked
    // apps yet" and no-op'd, on the assumption that's the only way an
    // empty list could arrive here. That's no longer true: blocks.html's
    // UI refuses to start a whitelist block with zero apps picked, but
    // the schedule-tick Edge Function's sleep slot deliberately sends
    // apps:[] under whitelist mode to mean "allow nothing, close
    // everything" (see supabase/functions/schedule-tick/index.ts). So an
    // empty list here is now a real, intentional "block all apps" -
    // fall through to the normal kill loop below instead of skipping it.
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

// Persists the real executable path of every allowed app we've ever seen
// running, so a later relaunch (below) works even after the desktop app
// itself has restarted since that app was last open.
const APP_PATHS_STORE: &str = "revm2-app-paths.json";
const APP_PATHS_KEY: &str = "known_app_paths"; // lowercased process name -> full exe path

/// Whitelist mode's stronger promise: an allowed app isn't just spared
/// from being killed, it's actively expected to stay running - if the
/// user closes one themselves mid-session (or it crashes), this brings
/// it back. Two passes over the process list:
///   1. For every allowed app that IS currently running, record/update
///      its real executable path in the on-disk store, so we still know
///      where to find it if it later disappears - including across the
///      desktop app's own restarts.
///   2. For every allowed app that is NOT currently running, relaunch it
///      from the most recently known path, if we have one.
///
/// Best-effort, not a guarantee: an allowed app that has never been seen
/// running - typed in manually rather than picked from the running-apps
/// list, or picked but not actually launched even once since - has no
/// known path yet and is silently skipped. Same "can't act on what we
/// don't know" reasoning as the rest of this module; nothing here can
/// discover an install location it's never observed in memory.
pub fn sync_and_relaunch_whitelisted(app: &AppHandle, allowed: &[String]) -> Vec<String> {
    if allowed.is_empty() {
        return Vec::new();
    }

    let store = match app.store(APP_PATHS_STORE) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("app_guard: failed to open app-paths store: {e}");
            return Vec::new();
        }
    };
    let mut known_paths: std::collections::HashMap<String, String> = store
        .get(APP_PATHS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut running_lower = std::collections::HashSet::new();
    let mut paths_changed = false;
    for process in sys.processes().values() {
        let name = process.name(); // &str in sysinfo 0.30
        if !allowed.iter().any(|a| a.eq_ignore_ascii_case(name)) {
            continue;
        }
        let lower = name.to_lowercase();
        running_lower.insert(lower.clone());

        // exe() can come back None (permissions, some system processes) -
        // don't overwrite a previously-known-good path with nothing.
        if let Some(exe_path) = process.exe() {
            if !exe_path.as_os_str().is_empty() {
                if let Some(path_str) = exe_path.to_str() {
                    if known_paths.get(&lower).map(String::as_str) != Some(path_str) {
                        known_paths.insert(lower, path_str.to_string());
                        paths_changed = true;
                    }
                }
            }
        }
    }

    if paths_changed {
        store.set(APP_PATHS_KEY, serde_json::json!(known_paths));
        if let Err(e) = store.save() {
            eprintln!("app_guard: failed to save known app paths: {e}");
        }
    }

    let mut relaunched = Vec::new();
    for app_name in allowed {
        let lower = app_name.to_lowercase();
        if running_lower.contains(&lower) {
            continue; // already running, nothing to do
        }
        if let Some(path) = known_paths.get(&lower) {
            match std::process::Command::new(path).spawn() {
                Ok(_) => relaunched.push(app_name.clone()),
                Err(e) => eprintln!("app_guard: failed to relaunch {app_name} from {path}: {e}"),
            }
        }
        // else: never seen running this app - no known path, can't relaunch.
    }
    relaunched
}

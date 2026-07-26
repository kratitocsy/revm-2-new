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
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::time::Duration;
use sysinfo::{Pid, System};

// Passed via .creation_flags() to every Command we spawn here. Without
// this, spawning a console-subsystem exe like taskkill.exe from a Tauri
// app (a GUI-subsystem process) still pops a visible console window for
// each call - and this runs once per chrome.exe PID (Chrome commonly has
// dozens: main process, one per renderer tab, GPU, utility, extension
// processes, ...), every time the guard loop tries to close an
// unprotected browser. Without CREATE_NO_WINDOW that's a rapid flash of
// console windows, potentially repeated every few seconds for as long as
// enforcement keeps re-triggering.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Computed once (see the conversation) from the fixed "key" in the
// extension's manifest.json - deterministic no matter where it's unpacked,
// on Chrome. Edge does NOT honor the "key" field for sideloaded/unpacked
// extensions the way Chrome does - it assigns its own ID (derived from the
// extension's folder path) regardless of "key" being present. Confirmed
// via Microsoft's own bug tracker (microsoft/MicrosoftEdge-Extensions#41)
// and a 2024 Microsoft Q&A thread reporting the exact same thing. So this
// constant is only ever correct for Chrome/Brave/Vivaldi/Opera (which do
// honor "key" for unpacked extensions, being closer to stock Chromium
// here) - never assume it matches what Edge actually assigned. See
// read_extension_settings() below for how that's handled.
pub const EXTENSION_ID: &str = "knofmgookchmjekaefloaljcamjlbnmp";

// The extension's manifest "name" - stable across every browser regardless
// of what ID that browser assigns it. Used as a fallback identifier for
// browsers (Edge) that don't honor EXTENSION_ID above.
const EXTENSION_NAME: &str = "RevM\u{b2} Focus Lock";

pub struct BrowserTarget {
    pub name: &'static str,
    pub process_names: &'static [&'static str], // case-insensitive match against sysinfo's process name
    pub user_data_dir: fn() -> Option<PathBuf>,
}

// See read_extension_settings() below for which file on disk is actually
// authoritative for an extension's enabled/incognito state (Secure
// Preferences, not the plain Preferences file this module used to read).
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

// Loads the "/extensions/settings/{id}" object for our extension in one
// profile folder. Chrome has kept extension state (enabled/disabled) AND
// the per-extension "incognito" permission flag in a file called
// "Secure Preferences" since Chrome 37 - NOT in the plain "Preferences"
// file - specifically as a tamper-resistance measure (each entry is
// HMAC-signed against a machine-specific seed) so that outside tools can't
// silently rewrite an extension's state by editing JSON on disk. Reading
// only "Preferences" (what this used to do) means reading a file Chrome
// no longer reliably keeps this data in: the state read back could be
// stale, missing entirely, or - going by field reports - inconsistently
// present depending on Chrome version/OS, none of which is something this
// code can tell apart from "extension genuinely isn't there". That's
// consistent with "I re-enabled it / turned on Allow in Incognito and it
// still says blocked": the write Chrome actually makes lands in Secure
// Preferences, and nothing here was ever looking there.
//
// "Preferences" is tried second, purely as a fallback for older/unusual
// Chrome builds where Secure Preferences might be absent or not yet
// populated - never as the primary source.
//
// Within each file, EXTENSION_ID is tried first (fast, and correct for
// Chrome/Brave/Vivaldi/Opera), but Edge assigns sideloaded extensions its
// own ID regardless of the manifest's "key" field, so that direct lookup
// always misses there - see the comment on EXTENSION_ID. As a fallback,
// every entry under extensions.settings is scanned for one whose stored
// manifest snapshot has our extension's name, which is stable no matter
// what ID the browser assigned it.
//
// The "each entry carries a /manifest/name snapshot of manifest.json at
// install time" structure is well attested in third-party browser-
// forensics write-ups, but unverified here against a live Secure
// Preferences file - if a given Chromium build doesn't store that
// snapshot, this fallback just finds nothing and falls through to the
// heartbeat, same as before this fix. If it turns out Edge's actual entry
// is still not being found this way, the fastest way to confirm at all is
// to open Edge's own Secure Preferences file and check what the extension
// entry for RevM2 actually looks like there.
fn read_extension_settings(profile_dir: &PathBuf) -> Option<Value> {
    for filename in ["Secure Preferences", "Preferences"] {
        let Ok(content) = std::fs::read_to_string(profile_dir.join(filename)) else { continue };
        let Ok(json): Result<Value, _> = serde_json::from_str(&content) else { continue };

        if let Some(settings) = json
            .pointer(&format!("/extensions/settings/{EXTENSION_ID}"))
        {
            return Some(settings.clone());
        }

        if let Some(all_settings) = json.pointer("/extensions/settings").and_then(|v| v.as_object()) {
            for entry in all_settings.values() {
                let name_matches = entry
                    .pointer("/manifest/name")
                    .and_then(|v| v.as_str())
                    .map(|n| n == EXTENSION_NAME)
                    .unwrap_or(false);
                if name_matches {
                    return Some(entry.clone());
                }
            }
        }
    }
    None
}

// Checks every profile folder (Default, Profile 1, Profile 2, ...) under a
// browser's User Data directory for our extension being present, enabled
// (state == 1), AND permitted to run in Incognito windows (incognito ==
// true).
//
// The incognito requirement isn't optional: an extension without explicit
// "Allow in Incognito" access literally cannot run there at all - no
// content scripts, no declarativeNetRequest rules, nothing. Chrome also
// defaults every extension to incognito=false on install, so out of the
// box, Incognito is a total blind spot for this entire blocking scheme -
// the person can dodge every rule just by opening a private window,
// without even touching the extension's enabled/disabled state. Treating
// "enabled but not incognito-permitted" the same as "disabled" closes
// that gap: the browser gets closed exactly like it would if the
// extension were off, and the fix is the same one-time toggle either way
// (chrome://extensions -> Details -> Allow in Incognito).
fn extension_fully_permitted_in_profile(profile_dir: &PathBuf) -> bool {
    let Some(settings) = read_extension_settings(profile_dir) else { return false };
    let enabled = matches!(
        settings.get("state").and_then(|v| v.as_i64()),
        Some(1)
    );
    // Chrome omits the "incognito" key entirely when it's false (the
    // default), so absence means "not allowed", not "unknown" - only an
    // explicit `true` counts.
    let incognito_allowed = matches!(
        settings.get("incognito").and_then(|v| v.as_bool()),
        Some(true)
    );
    enabled && incognito_allowed
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

        if extension_fully_permitted_in_profile(&path) {
            return true;
        }
    }
    false
}

// Diagnostic-only: is the extension enabled in ANY profile, ignoring the
// incognito requirement entirely. Used solely to pick notification
// wording ("disabled" vs "incognito not allowed") - is_protected() above
// is what actually decides whether a browser gets closed, this never
// feeds into that decision.
fn extension_enabled_ignoring_incognito(target: &BrowserTarget) -> bool {
    let Some(user_data_dir) = (target.user_data_dir)() else { return false };
    let Ok(entries) = std::fs::read_dir(&user_data_dir) else { return false };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name != "Default" && !name.starts_with("Profile ") { continue; }

        let Some(settings) = read_extension_settings(&path) else { continue };
        let enabled = matches!(settings.get("state").and_then(|v| v.as_i64()), Some(1));
        if enabled { return true; }
    }
    false
}

/// Which specific problem is making `target` unprotected right now -
/// "disabled" (extension off, missing, or not running at all) or
/// "incognito" (alive, but not incognito-permitted) - purely to word the
/// notification correctly. Mirrors is_protected()'s own alive/incognito
/// split exactly, so this can never disagree with the actual decision.
pub fn protection_gap_reason(
    target: &BrowserTarget,
    heartbeat: &crate::heartbeat::HeartbeatState,
) -> &'static str {
    let alive = extension_enabled_ignoring_incognito(target) || heartbeat.is_fresh(target.name);
    if !alive {
        "disabled"
    } else {
        "incognito"
    }
}

/// Whether a browser process with the given name is currently running.
/// Split out of the various "is X running" checks below so heartbeat.rs
/// can reuse it (attributing an ambiguous heartbeat to "the only supported
/// browser that's actually open") without duplicating the sysinfo dance.
pub fn is_process_running(target: &BrowserTarget) -> bool {
    let mut sys = System::new_all();
    sys.refresh_processes();
    sys.processes().values().any(|p| {
        target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name()))
    })
}

/// The combined protection check: is the extension alive (disk OR a
/// recent heartbeat), AND is it incognito-permitted.
///
/// "Alive": disk read (state == 1, checked in Secure Preferences first -
/// see read_extension_settings - then Preferences as a fallback) OR a
/// recent heartbeat - a heartbeat can only exist if the background script
/// is genuinely running right now, impossible for a disabled extension,
/// so it's trustworthy even when it disagrees with a stale/lagging
/// Secure Preferences write (e.g. mid-batch, or the HMAC re-sign hasn't
/// landed yet).
///
/// "Incognito-permitted": prefers the heartbeat's own live
/// chrome.management.getSelf().incognitoAccess reading whenever we've
/// ever received one this run, even a slightly old one - that's a real
/// browser API result at the moment it fired, not a guess. The disk-based
/// check (reading Secure Preferences, falling back to Preferences, for an
/// "incognito" key) only ever applies as a fallback for browsers we've
/// never heard a heartbeat from at all - e.g. an extension build older
/// than the heartbeat feature, or the extension's very first few seconds
/// before its first heartbeat lands. Even now that the disk read targets
/// the right file, the heartbeat stays preferred: it's a live API result,
/// not a JSON read racing Chrome's own write/HMAC-resign cycle.
pub fn is_protected(target: &BrowserTarget, heartbeat: &crate::heartbeat::HeartbeatState) -> bool {
    let alive = extension_enabled_ignoring_incognito(target) || heartbeat.is_fresh(target.name);
    if !alive {
        return false;
    }
    match heartbeat.known_incognito_allowed(target.name) {
        Some(allowed) => allowed,
        None => is_extension_installed(target),
    }
}

// Diagnostic snapshot - for each supported browser, is it currently
// running, is it protected (disk read OR a recent heartbeat - see
// is_protected), and if not, why (only meaningful when running &&
// !protected). Exposed via a Tauri command so it can be queried live
// from DevTools/tray without needing a rebuild each time.
pub fn debug_status(heartbeat: &crate::heartbeat::HeartbeatState) -> Vec<(String, bool, bool, String)> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    supported_browsers()
        .into_iter()
        .map(|target| {
            let running = sys.processes().values().any(|p| {
                target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name()))
            });
            let protected = is_protected(&target, heartbeat);
            let reason = if running && !protected {
                protection_gap_reason(&target, heartbeat).to_string()
            } else {
                "ok".to_string()
            };
            (target.name.to_string(), running, protected, reason)
        })
        .collect()
}

// Returns the names of every supported browser that's currently running
// but isn't protected (no enabled extension on disk, and no recent
// heartbeat backing it up either).
pub fn unprotected_running_browsers(heartbeat: &crate::heartbeat::HeartbeatState) -> Vec<&'static str> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut result = Vec::new();
    for target in supported_browsers() {
        let running = sys.processes().values().any(|p| {
            target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name()))
        });
        if running && !is_protected(&target, heartbeat) {
            result.push(target.name);
        }
    }
    result
}

// Asks a process to close via taskkill WITHOUT /F - on Windows this posts
// WM_CLOSE to the process's top-level windows rather than calling
// TerminateProcess. That matters a lot here specifically because of how
// Chromium persists prefs: writes to the Preferences file are batched and
// some (including, per Chromium's own prefs README, "lossy" prefs that
// don't schedule their own write) are only guaranteed to reach disk on a
// clean shutdown - otherwise they just sit bundled in memory waiting for
// the next commit that never comes. A hard TerminateProcess (what
// sysinfo's Process::kill() does on Windows, and what this function used
// to always use) skips that shutdown path entirely.
//
// Concretely, this is what caused the "re-enabling the extension doesn't
// stop the browser being closed" bug: disabling the extension writes
// "disabled" to disk fine (that already happened before the 60s grace
// timer even starts), but re-enabling it while the browser keeps getting
// hard-killed every cycle means the "enabled" write never survives long
// enough to hit disk - it's stuck in memory, gets wiped by the next
// TerminateProcess, and is_extension_installed() keeps reading the stale
// "disabled" value off disk forever, no matter how many times the person
// re-enables it in the UI.
//
// Only the browser's main process actually owns windows and responds to
// WM_CLOSE; renderer/GPU/utility child processes sharing the same
// executable name don't and will just no-op here, which is fine - closing
// the main process takes the whole browser (and its prefs flush) down
// with it in the normal way.
fn request_graceful_close(pid: Pid) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string()]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.output();
}

// Kills every running process matching any of the given browser names
// (as returned by unprotected_running_browsers/supported_browsers -
// e.g. "Chrome", "Edge"), regardless of current extension state. This
// is the low-level primitive; deciding WHICH names to pass in (e.g.
// after a grace period) lives in lib.rs's guard loop, not here - this
// module only knows how to detect and how to kill, not how long to wait.
//
// Tries a graceful close first (see request_graceful_close above) and
// only falls back to a hard TerminateProcess-style kill for whatever's
// still alive after a short wait - e.g. a browser with no window handler
// listening, an unsaved-changes dialog holding it open, or a background
// process that outlived its window. This still reliably closes the
// browser (enforcement doesn't get weaker), it just gives Chrome's normal
// exit path - and the pref flush that comes with it - a chance to run
// first.
pub fn kill_browsers_by_name(names: &[&'static str]) -> Vec<&'static str> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = Vec::new();
    for target in supported_browsers() {
        if !names.contains(&target.name) {
            continue;
        }
        let pids: Vec<Pid> = sys
            .processes()
            .iter()
            .filter(|(_, p)| target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name())))
            .map(|(pid, _)| *pid)
            .collect();

        if pids.is_empty() { continue; }

        for &pid in &pids {
            request_graceful_close(pid);
        }

        // Give Chrome's normal shutdown path (and the pref flush that
        // comes with it) a moment to actually happen before checking
        // what's left.
        std::thread::sleep(Duration::from_millis(1500));
        sys.refresh_processes();

        let mut any_succeeded = false;
        for pid in pids {
            let Some(process) = sys.process(pid) else {
                // Already gone - the graceful close worked.
                any_succeeded = true;
                continue;
            };
            let ok = process.kill();
            if !ok {
                eprintln!("browser_guard: failed to force-kill {} (pid {pid})", target.name);
            }
            any_succeeded = any_succeeded || ok;
        }
        if any_succeeded {
            killed.push(target.name);
        }
    }
    killed
}

// Kills every running process matching any supported browser that doesn't
// have the extension, with NO grace period - kept for the debug/manual
// path (e.g. a future "close now" button); the guard loop itself uses
// unprotected_running_browsers() + kill_browsers_by_name() so it can
// apply the 60s grace period in between. Only reports a browser as
// "killed" if kill() actually reported success.
pub fn kill_unprotected_browsers(heartbeat: &crate::heartbeat::HeartbeatState) -> Vec<&'static str> {
    let unprotected = unprotected_running_browsers(heartbeat);
    kill_browsers_by_name(&unprotected)
}
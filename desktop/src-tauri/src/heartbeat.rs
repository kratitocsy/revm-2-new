// Local heartbeat listener.
//
// browser_guard.rs figures out "is the extension enabled" by reading
// Chromium's Preferences JSON off disk. That's necessary (it's the only
// source of truth for "installed" at all) but it's also laggy: writes to
// Preferences are batched, and - per the big comment on
// request_graceful_close in browser_guard.rs - a browser that gets
// force-killed can lose an "I just re-enabled it" write entirely, leaving
// the disk stuck on "disabled" no matter how many times the person
// actually re-enables it in the UI.
//
// This module gives the extension a second, much faster way to say "I'm
// here": its background service worker POSTs a small heartbeat to a
// fixed localhost port every time it's alive and running (which, for an
// MV3 extension, is only possible when it's actually enabled - a disabled
// extension's background script doesn't execute at all). The desktop app
// treats a recent heartbeat as proof of "protected" even when the disk
// read still says otherwise, and that proof shows up within one alarm
// tick (~30s, well inside the 60s grace window) instead of waiting on a
// prefs flush that might never come.
//
// This is additive, not a replacement: is_extension_installed() (disk)
// remains the primary signal and is checked first. The heartbeat only
// ever adds protection, never removes it - a missing/stale heartbeat
// simply falls back to whatever the disk already says.

use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};

pub const HEARTBEAT_PORT: u16 = 47552;

// How long a heartbeat counts as "still alive". Comfortably more than the
// extension's own ~30s alarm period so one missed tick (SW briefly
// evicted, machine under load, a slow wake) doesn't immediately look like
// the extension vanished, but well inside the 60s grace window so a
// genuinely-disabled extension still gets caught.
pub const HEARTBEAT_FRESHNESS_SECS: i64 = 75;

// background.js POSTs plain JS-convention camelCase keys (ua, brands,
// incognitoAllowed). Without rename_all here, serde_json looks for a
// literal "incognito_allowed" key, never finds it, and silently falls
// back to None -> false on every heartbeat - meaning this field could
// never actually report `true`, no matter what chrome.management.getSelf()
// said extension-side. rename_all fixes the wire format to match what's
// really being sent.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HeartbeatBody {
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    brands: Option<Vec<String>>,
    // chrome.management.getSelf().incognitoAccess, read live by the
    // extension on every heartbeat - see background.js. This is a direct
    // API call, not a disk read, so it's exactly as current as the
    // person's actual chrome://extensions setting at the moment the
    // heartbeat fired, no batching lag in either direction.
    #[serde(default)]
    incognito_allowed: Option<bool>,
}

#[derive(Clone, Copy)]
struct Entry {
    last_seen: i64,
    incognito_allowed: bool,
}

/// Last-seen timestamp + last-reported incognito permission per resolved
/// browser name (e.g. "Chrome", "Edge"). Shared between the listener
/// thread and the guard loop.
pub struct HeartbeatState(Mutex<HashMap<&'static str, Entry>>);

impl HeartbeatState {
    pub fn new() -> Self {
        HeartbeatState(Mutex::new(HashMap::new()))
    }

    /// Seconds since the given browser's last heartbeat, if it's ever sent
    /// one. `None` means we've never heard from it at all (not "long ago" -
    /// just no data), which callers should treat as "no override available".
    pub fn seconds_since_last(&self, browser: &str) -> Option<i64> {
        let guard = self.0.lock().ok()?;
        let e = guard.get(browser)?;
        Some((crate::now_ts() - e.last_seen).max(0))
    }

    /// True only if the browser has a heartbeat within the freshness
    /// window AND that heartbeat reported incognito access as granted.
    /// This is the single check callers should use for "does the
    /// heartbeat prove this browser is fully protected" - a fresh
    /// heartbeat from an extension that isn't incognito-permitted is
    /// proof of "enabled", not proof of "protected", and must not
    /// override the disk read into a false positive.
    pub fn is_fresh_and_permitted(&self, browser: &str) -> bool {
        let Ok(guard) = self.0.lock() else { return false };
        let Some(e) = guard.get(browser) else { return false };
        let age = (crate::now_ts() - e.last_seen).max(0);
        age <= HEARTBEAT_FRESHNESS_SECS && e.incognito_allowed
    }

    fn record(&self, browser: &'static str, incognito_allowed: bool) {
        if let Ok(mut guard) = self.0.lock() {
            guard.insert(browser, Entry { last_seen: crate::now_ts(), incognito_allowed });
        }
    }
}

// Maps a Chromium UA-Client-Hints brand list (preferred) or, failing that,
// the plain User-Agent string, to one of browser_guard's supported browser
// names. Chrome's brand list always mixes in a couple of randomized
// "Not:A-Brand"-style decoy entries alongside the real one(s), so we look
// for a recognizable brand rather than assuming position.
//
// Chrome and Brave are NOT distinguishable this way - Brave deliberately
// mimics Chrome's UA and omits itself from the brand list to resist
// fingerprinting. That case is left unresolved here; the caller falls back
// to a "only one supported browser process is currently running" heuristic
// instead of guessing.
fn resolve_browser_name(ua: Option<&str>, brands: Option<&[String]>) -> Option<&'static str> {
    if let Some(brands) = brands {
        for b in brands {
            let b = b.to_ascii_lowercase();
            if b.contains("edge") {
                return Some("Edge");
            }
            if b.contains("opera") {
                return Some("Opera");
            }
            if b.contains("vivaldi") {
                return Some("Vivaldi");
            }
            if b.contains("brave") {
                return Some("Brave");
            }
            if b.contains("google chrome") {
                return Some("Chrome");
            }
        }
    }
    let ua = ua?.to_ascii_lowercase();
    if ua.contains("edg/") {
        return Some("Edge");
    }
    if ua.contains("opr/") {
        return Some("Opera");
    }
    if ua.contains("vivaldi") {
        return Some("Vivaldi");
    }
    None
}

fn handle_body(state: &HeartbeatState, body: &str) {
    let Ok(parsed) = serde_json::from_str::<HeartbeatBody>(body) else {
        return;
    };
    // Chrome omits/undefines this if the extension's own
    // chrome.management.getSelf() call ever fails - treat "unknown" the
    // same as "not granted" rather than silently trusting it.
    let incognito_allowed = parsed.incognito_allowed.unwrap_or(false);

    if let Some(name) = resolve_browser_name(parsed.ua.as_deref(), parsed.brands.as_deref()) {
        state.record(name, incognito_allowed);
        return;
    }

    // Ambiguous (almost always Brave, or an unrecognized Chromium fork).
    // A heartbeat can only have come from a real running browser process,
    // so if exactly one supported browser is currently running, it must be
    // that one. If more than one is running we genuinely can't tell which
    // sent it - skip attribution rather than credit the wrong browser.
    let running: Vec<&'static str> = crate::browser_guard::supported_browsers()
        .into_iter()
        .filter(|t| crate::browser_guard::is_process_running(t))
        .map(|t| t.name)
        .collect();
    if running.len() == 1 {
        state.record(running[0], incognito_allowed);
    }
}

/// Binds a tiny local HTTP server on 127.0.0.1 and processes heartbeat
/// POSTs on its own OS thread for the lifetime of the app. Runs outside
/// Tauri's IPC/webview entirely - the extension talks to this directly,
/// same as it already talks to the RevM2 web API.
pub fn spawn_heartbeat_server(state: Arc<HeartbeatState>) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", HEARTBEAT_PORT)) {
            Ok(server) => server,
            Err(e) => {
                // Most likely another instance of the app (or a stale
                // process) already holds the port. Non-fatal: the disk
                // read in browser_guard.rs still works fine on its own,
                // this thread just has nothing useful to do.
                eprintln!("heartbeat: failed to bind 127.0.0.1:{HEARTBEAT_PORT}: {e}");
                return;
            }
        };

        for mut request in server.incoming_requests() {
            if request.method() != &tiny_http::Method::Post {
                let _ = request.respond(tiny_http::Response::empty(405));
                continue;
            }

            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            handle_body(&state, &body);

            // 204: the extension doesn't need or read a response body,
            // this is fire-and-forget from its side.
            let _ = request.respond(tiny_http::Response::empty(204));
        }
    });
}

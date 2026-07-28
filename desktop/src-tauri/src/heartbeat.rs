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
// never actually report `true`, no matter what chrome.extension.isAllowedIncognitoAccess()
// said extension-side. rename_all fixes the wire format to match what's
// really being sent.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HeartbeatBody {
    #[serde(default)]
    ua: Option<String>,
    #[serde(default)]
    brands: Option<Vec<String>>,
    // chrome.extension.isAllowedIncognitoAccess(), read live by the
    // extension on every heartbeat - see background.js. This is a direct
    // API call, not a disk read, so it's exactly as current as the
    // person's actual chrome://extensions setting at the moment the
    // heartbeat fired, no batching lag in either direction.
    #[serde(default)]
    incognito_allowed: Option<bool>,
    // chrome.permissions.contains({origins: ["http://*/*","https://*/*"]}),
    // read live by the extension on every heartbeat - see background.js.
    // Reflects Chrome's per-extension "Site access" control
    // (chrome://extensions -> Details -> On all sites / On specific sites
    // / On click). Blocking is implemented with declarativeNetRequest
    // "redirect" rules, which Chrome's own docs say require host
    // permissions on the target site - unlike plain "block" rules. So
    // narrowing Site access, or setting it to "On click", silently stops
    // the redirect from firing on whatever site was left out, with the
    // extension still showing Enabled and Incognito still showing
    // Allowed. Same class of gap as incognito_allowed above, same fix
    // shape: a live API result, not a disk read.
    #[serde(default)]
    all_sites_access: Option<bool>,
}

#[derive(Clone, Copy)]
struct Entry {
    last_seen: i64,
    incognito_allowed: bool,
    all_sites_access: bool,
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

    /// True if the browser has a heartbeat within the freshness window,
    /// regardless of what it reported for incognito. Pure liveness check.
    pub fn is_fresh(&self, browser: &str) -> bool {
        self.seconds_since_last(browser)
            .map(|age| age <= HEARTBEAT_FRESHNESS_SECS)
            .unwrap_or(false)
    }

    /// The most recently reported incognito_allowed value for this
    /// browser, with NO freshness bound - `None` only when we've never
    /// heard from it at all this run. Deliberately unbounded: this is a
    /// live chrome.extension.isAllowedIncognitoAccess() API result at the moment it was
    /// sent, not a value that can go stale the way a cached read might -
    /// once we've learned it, it's more trustworthy than guessing at
    /// Chromium's internal Preferences schema for the same information,
    /// even if the heartbeat itself is old. (If the browser's heartbeat
    /// has gone stale enough to matter, is_fresh()/is_protected()'s
    /// liveness check already handles that separately.)
    pub fn known_incognito_allowed(&self, browser: &str) -> Option<bool> {
        let guard = self.0.lock().ok()?;
        guard.get(browser).map(|e| e.incognito_allowed)
    }

    /// Same shape/reasoning as known_incognito_allowed above, for the
    /// "Site access" (host permissions) live reading instead.
    pub fn known_all_sites_access(&self, browser: &str) -> Option<bool> {
        let guard = self.0.lock().ok()?;
        guard.get(browser).map(|e| e.all_sites_access)
    }

    fn record(&self, browser: &'static str, incognito_allowed: bool, all_sites_access: bool) {
        if let Ok(mut guard) = self.0.lock() {
            guard.insert(browser, Entry { last_seen: crate::now_ts(), incognito_allowed, all_sites_access });
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
    // chrome.extension.isAllowedIncognitoAccess() call ever fails - treat "unknown" the
    // same as "not granted" rather than silently trusting it.
    let incognito_allowed = parsed.incognito_allowed.unwrap_or(false);
    // Same "fail toward not granted" reasoning as incognito_allowed above.
    let all_sites_access = parsed.all_sites_access.unwrap_or(false);

    if let Some(name) = resolve_browser_name(parsed.ua.as_deref(), parsed.brands.as_deref()) {
        state.record(name, incognito_allowed, all_sites_access);
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
        state.record(running[0], incognito_allowed, all_sites_access);
    }
}

// Pulls `since` off a "/session-events?since=123" request target. Missing
// or unparseable defaults to 0, which just means "give me the current
// state immediately" - the safe default for a client that's never
// connected before.
fn parse_since(url: &str) -> u64 {
    url.split('?')
        .nth(1)
        .and_then(|qs| qs.split('&').find_map(|kv| kv.strip_prefix("since=")))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Binds a tiny local HTTP server on 127.0.0.1 and handles two routes for
/// the lifetime of the app, entirely outside Tauri's IPC/webview - the
/// extension talks to this directly, same as it already talks to the
/// RevM2 web API:
///   - POST /heartbeat        - existing "I'm alive" ping (see module docs)
///   - GET  /session-events   - long-poll for an instant session start/end
///     signal from the desktop app (see session_bridge.rs)
///
/// Each accepted connection is handed to its own thread. That's a
/// deliberate change from the old single-loop version: a /session-events
/// request can legitimately block for up to ~25s (see
/// session_bridge::SessionEventBus::wait_for), and heartbeat POSTs need to
/// keep landing without waiting behind that.
// CORS support for this local server.
//
// Extension background pages/offscreen documents with a matching
// host_permission are documented to bypass CORS entirely for their own
// fetch() calls - which is why this server historically never sent any
// Access-Control-* headers at all. In practice that bypass doesn't
// reliably apply to every single request: field reports (and a live
// DevTools capture) show the exact same background.js, same toggle
// state, alternating between a clean heartbeat and
// "blocked by CORS policy: No 'Access-Control-Allow-Origin' header is
// present" from one call to the next - most visible right after the
// service worker (re)starts, before Chromium has fully settled which of
// its exemptions apply to this instance yet. Rather than depend on that
// internal timing, this server now answers CORS the same way any other
// spec-compliant server would: explicit preflight handling plus the
// header on every actual response. That makes it correct regardless of
// whether the extension-side bypass is active for a given request.
//
// "*" (not the specific chrome-extension://<id> origin) is deliberate:
// this server only ever binds to 127.0.0.1, is never reachable from
// outside this machine, and doesn't rely on the caller's origin for any
// access decision - the fixed extension ID isn't authoritative anyway
// (see EXTENSION_ID's own doc comment in browser_guard.rs re: Edge
// assigning its own ID), so there's nothing gained by trying to
// allowlist a specific one here.
fn cors_origin_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap()
}

fn cors_preflight_response() -> tiny_http::Response<std::io::Empty> {
    tiny_http::Response::empty(204)
        .with_header(cors_origin_header())
        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap())
        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap())
        .with_header(tiny_http::Header::from_bytes(&b"Access-Control-Max-Age"[..], &b"86400"[..]).unwrap())
}

pub fn spawn_heartbeat_server(
    state: Arc<HeartbeatState>,
    bridge: Arc<crate::session_bridge::SessionEventBus>,
    gate: Arc<crate::gate_guard::GateGuardState>,
) {
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
            let state = state.clone();
            let bridge = bridge.clone();
            let gate = gate.clone();
            std::thread::spawn(move || {
                let url = request.url().to_string();
                let path = url.split('?').next().unwrap_or("");

                // Every browser-issued CORS preflight is an OPTIONS request,
                // regardless of which route it's for - answer it the same
                // way everywhere rather than duplicating this per-path.
                if request.method() == &tiny_http::Method::Options {
                    let _ = request.respond(cors_preflight_response());
                    return;
                }

                if path == "/session-events" {
                    if request.method() != &tiny_http::Method::Get {
                        let _ = request.respond(tiny_http::Response::empty(405).with_header(cors_origin_header()));
                        return;
                    }
                    let since = parse_since(&url);
                    match bridge.wait_for(since) {
                        Some((seq, payload)) => {
                            let mut body = payload;
                            if let Some(obj) = body.as_object_mut() {
                                obj.insert("seq".to_string(), serde_json::json!(seq));
                            }
                            let json = serde_json::to_string(&body).unwrap_or_else(|_| "{}".to_string());
                            let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
                            let _ = request.respond(
                                tiny_http::Response::from_string(json)
                                    .with_header(header)
                                    .with_header(cors_origin_header()),
                            );
                        }
                        None => {
                            // Timed out, nothing new - the extension's
                            // long-poll loop reconnects immediately with
                            // the same `since`, so this is silent and cheap.
                            let _ = request.respond(tiny_http::Response::empty(204).with_header(cors_origin_header()));
                        }
                    }
                    return;
                }

                // Long-poll counterpart of /session-events, but for the
                // extension's own 150-char unlock-code gate (see unlock.js
                // and gate_guard.rs's module doc). unlock.js calls this
                // alongside its own JS-level checks so a real OS-level
                // focus-loss (any app stealing focus, not just a browser
                // tab/window change) also resets the code, same as
                // visibilitychange already does for browser-level changes.
                if path == "/gate/status" {
                    if request.method() != &tiny_http::Method::Get {
                        let _ = request.respond(tiny_http::Response::empty(405).with_header(cors_origin_header()));
                        return;
                    }
                    let since = parse_since(&url);
                    match gate.browser_bus.wait_for(since) {
                        Some((seq, reason)) => {
                            let json = serde_json::to_string(&serde_json::json!({ "seq": seq, "reason": reason }))
                                .unwrap_or_else(|_| "{}".to_string());
                            let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
                            let _ = request.respond(
                                tiny_http::Response::from_string(json)
                                    .with_header(header)
                                    .with_header(cors_origin_header()),
                            );
                        }
                        None => {
                            let _ = request.respond(tiny_http::Response::empty(204).with_header(cors_origin_header()));
                        }
                    }
                    return;
                }

                // unlock.js POSTs here the moment its gate opens (right
                // after the "Pause for a Cause" click reveals the code) and
                // again the moment it closes (unlocked, or the tab/page is
                // being torn down) - see gate_guard.rs's arm_browser/
                // disarm_browser for what each does natively.
                if path == "/gate/start" {
                    if request.method() != &tiny_http::Method::Post {
                        let _ = request.respond(tiny_http::Response::empty(405).with_header(cors_origin_header()));
                        return;
                    }
                    gate.arm_browser();
                    let _ = request.respond(tiny_http::Response::empty(204).with_header(cors_origin_header()));
                    return;
                }
                if path == "/gate/stop" {
                    if request.method() != &tiny_http::Method::Post {
                        let _ = request.respond(tiny_http::Response::empty(405).with_header(cors_origin_header()));
                        return;
                    }
                    gate.disarm_browser();
                    let _ = request.respond(tiny_http::Response::empty(204).with_header(cors_origin_header()));
                    return;
                }

                if request.method() != &tiny_http::Method::Post {
                    let _ = request.respond(tiny_http::Response::empty(405).with_header(cors_origin_header()));
                    return;
                }

                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                handle_body(&state, &body);

                // 204: the extension doesn't need or read a response body,
                // this is fire-and-forget from its side.
                let _ = request.respond(tiny_http::Response::empty(204).with_header(cors_origin_header()));
            });
        }
    });
}

// Native (OS-level) backing for the two "type N random characters exactly"
// gibberish-lock gates in this codebase:
//   - blocks.html's 500-char schedule edit/pause gate, rendered in this
//     app's own Tauri webview.
//   - the browser extension's 150-char focus-block unlock code, in
//     blocked/unlock.js, rendered in a normal browser tab this process
//     doesn't own.
//
// Both already regenerate their code on suspicious activity entirely in
// JS - losing document focus, a copy/cut, a PrintScreen/Cmd+Shift+3/4/5
// keydown (see unlock.js's own comments, and blocks.html's schedule gate,
// which mirrors it). That JS layer is necessarily best-effort: a browser
// can only ever see browser-level focus changes, and can only ever guess
// after the fact that a screenshot tool fired. This module adds two things
// neither JS layer can do alone:
//
//   1. Actual capture PREVENTION, not just detection -
//      SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) makes the
//      protected window render as solid black in any screenshot, screen
//      recording, or screen-share for as long as protection is on.
//      Windows 10 2004+ only - silently a no-op everywhere else, same
//      pattern as taskmgr_guard/taskmgr_backstop's own Windows-only split.
//   2. True OS-level foreground-window watching via GetForegroundWindow(),
//      which sees ANY app stealing focus, not just a browser tab/window
//      change - closing exactly the gap unlock.js's own comment and
//      taskmgr_backstop's module doc both call out as unreachable from a
//      browser extension by itself.
//
// Two independent callers, two independent windows to protect:
//   - This app's own main window, while blocks.html's schedule gate is
//     open in the Tauri webview - driven by the gate_protection_start/stop
//     Tauri commands below, called directly from blocks.html once it
//     detects it's running inside the desktop app.
//   - Whichever browser window most likely has the extension's unlock code
//     on screen. The extension isn't a Tauri frontend and can't call a
//     Tauri command - it instead POSTs to /gate/start and /gate/stop on
//     the same local heartbeat server (127.0.0.1:47552, see heartbeat.rs)
//     it already talks to, and long-polls /gate/status for a focus-lost
//     signal the same way session_bridge.rs already lets it long-poll for
//     session changes. Best-effort identification: whichever top-level
//     window is foreground at the moment /gate/start lands is taken to be
//     the tab showing the code, since the gate only opens in direct
//     response to a click on that exact page - the person is necessarily
//     looking at it right then.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

const WATCH_POLL_INTERVAL: Duration = Duration::from_millis(200);
const LONG_POLL_TIMEOUT: Duration = Duration::from_secs(25);

#[cfg(target_os = "windows")]
mod win {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    pub fn foreground_hwnd() -> i64 {
        unsafe { GetForegroundWindow() as i64 }
    }

    /// No-op on hwnd == 0 (nothing to protect yet / already cleared) -
    /// callers pass whatever they last recorded, which can legitimately be
    /// unset.
    pub fn set_capture_protected(hwnd_i64: i64, protected: bool) -> Result<(), String> {
        if hwnd_i64 == 0 {
            return Ok(());
        }
        let affinity = if protected { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        let ok = unsafe { SetWindowDisplayAffinity(hwnd_i64 as HWND, affinity) };
        if ok == 0 {
            return Err("SetWindowDisplayAffinity failed".to_string());
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod win {
    pub fn foreground_hwnd() -> i64 {
        0
    }
    pub fn set_capture_protected(_hwnd_i64: i64, _protected: bool) -> Result<(), String> {
        Ok(()) // no-op off Windows (dev on macOS/Linux)
    }
}

/// One side's watch state: whether it's currently armed, and which HWND
/// counts as "still fine" while armed. 0 means "no expected window yet" -
/// treated as always-ok so a watcher that starts before its first hwnd is
/// recorded doesn't immediately fire a false positive.
struct WatchSlot {
    watching: AtomicBool,
    expected_hwnd: AtomicI64,
}
impl WatchSlot {
    fn new() -> Self {
        WatchSlot { watching: AtomicBool::new(false), expected_hwnd: AtomicI64::new(0) }
    }
}

struct BusInner {
    // Bumped only on a real focus-lost event - a client compares its own
    // `since` against this, same long-poll shape as SessionEventBus in
    // session_bridge.rs.
    seq: u64,
    reason: String,
}

/// Long-poll event bus the extension reads via GET /gate/status?since=N.
/// Deliberately a plain copy of SessionEventBus's shape rather than a
/// shared generic - the payload types differ (a reason string vs a session
/// JSON blob) and duplicating ~20 lines here is clearer than genericizing
/// a struct that's only ever used by these two call sites.
pub struct GateEventBus {
    inner: Mutex<BusInner>,
    changed: Condvar,
}
impl GateEventBus {
    fn new() -> Self {
        GateEventBus { inner: Mutex::new(BusInner { seq: 0, reason: String::new() }), changed: Condvar::new() }
    }
    fn trigger(&self, reason: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.seq += 1;
            g.reason = reason.to_string();
            self.changed.notify_all();
        }
    }
    pub fn wait_for(&self, since: u64) -> Option<(u64, String)> {
        let guard = self.inner.lock().ok()?;
        let (guard, timed_out) = self
            .changed
            .wait_timeout_while(guard, LONG_POLL_TIMEOUT, |s| s.seq <= since)
            .ok()?;
        if timed_out.timed_out() {
            None
        } else {
            Some((guard.seq, guard.reason.clone()))
        }
    }
}

pub struct GateGuardState {
    own: Arc<WatchSlot>,
    browser: Arc<WatchSlot>,
    pub browser_bus: Arc<GateEventBus>,
}

impl GateGuardState {
    pub fn new() -> Self {
        GateGuardState {
            own: Arc::new(WatchSlot::new()),
            browser: Arc::new(WatchSlot::new()),
            browser_bus: Arc::new(GateEventBus::new()),
        }
    }

    /// Starts both background watcher threads. Called once from setup() -
    /// each thread just idles cheaply (one 300ms sleep per loop) whenever
    /// its slot's `watching` flag is off, so there's no cost to starting
    /// them up front rather than lazily per gate-open.
    pub fn spawn_watchers(&self, app: tauri::AppHandle) {
        spawn_focus_watcher(self.own.clone(), {
            let app = app.clone();
            move |reason| {
                use tauri::Emitter;
                let _ = app.emit("revm2://gate-focus-lost", reason);
            }
        });
        spawn_focus_watcher(self.browser.clone(), {
            let bus = self.browser_bus.clone();
            move |reason| bus.trigger(reason)
        });
    }

    /// Own-window (Tauri webview) side - called from the
    /// gate_protection_start/stop commands below.
    fn arm_own(&self, hwnd: i64) -> Result<(), String> {
        win::set_capture_protected(hwnd, true)?;
        self.own.expected_hwnd.store(hwnd, Ordering::SeqCst);
        self.own.watching.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn disarm_own(&self, hwnd: i64) {
        self.own.watching.store(false, Ordering::SeqCst);
        let _ = win::set_capture_protected(hwnd, false);
        self.own.expected_hwnd.store(0, Ordering::SeqCst);
    }

    /// Browser side - called from heartbeat.rs's /gate/start and
    /// /gate/stop handlers. Takes whatever's currently foreground as the
    /// window to protect - see the module doc's "best-effort
    /// identification" note.
    pub fn arm_browser(&self) {
        let hwnd = win::foreground_hwnd();
        let _ = win::set_capture_protected(hwnd, true);
        self.browser.expected_hwnd.store(hwnd, Ordering::SeqCst);
        self.browser.watching.store(true, Ordering::SeqCst);
    }
    pub fn disarm_browser(&self) {
        self.browser.watching.store(false, Ordering::SeqCst);
        let hwnd = self.browser.expected_hwnd.swap(0, Ordering::SeqCst);
        let _ = win::set_capture_protected(hwnd, false);
    }
}

fn spawn_focus_watcher<F: Fn(&str) + Send + 'static>(slot: Arc<WatchSlot>, on_lost: F) {
    std::thread::spawn(move || {
        // Tracks whether the last poll while armed was "fine", so a
        // sustained absence only fires on_lost once on the OK->lost
        // transition rather than every 200ms for as long as it lasts -
        // same shape as unlock.js's own regenerate-once-per-event
        // behavior, just at the OS level instead of the DOM level.
        let mut was_ok = true;
        loop {
            if !slot.watching.load(Ordering::SeqCst) {
                was_ok = true; // clean slate for the next time this arms
                std::thread::sleep(Duration::from_millis(300));
                continue;
            }
            let expected = slot.expected_hwnd.load(Ordering::SeqCst);
            let current = win::foreground_hwnd();
            let ok = expected == 0 || current == expected;
            if !ok && was_ok {
                on_lost("lost focus to another window");
            }
            was_ok = ok;
            std::thread::sleep(WATCH_POLL_INTERVAL);
        }
    });
}

// window.hwnd() itself is only compiled into Tauri's API on Windows -
// unlike win::foreground_hwnd/set_capture_protected above (which exist on
// every OS and just no-op off Windows), this call site needs its own
// per-OS split so the crate still builds for macOS/Linux dev machines
// (see taskmgr_backstop.rs's module doc for the same dev-on-mac/Linux
// reasoning).
#[cfg(target_os = "windows")]
fn window_hwnd_i64(window: &tauri::WebviewWindow) -> Result<i64, String> {
    window.hwnd().map(|h| h.0 as i64).map_err(|e| e.to_string())
}
#[cfg(not(target_os = "windows"))]
fn window_hwnd_i64(_window: &tauri::WebviewWindow) -> Result<i64, String> {
    Ok(0)
}

// --- Tauri commands (own-window side, called from blocks.html) -----------

#[tauri::command]
pub fn gate_protection_start(
    window: tauri::WebviewWindow,
    state: tauri::State<Arc<GateGuardState>>,
) -> Result<(), String> {
    let hwnd = window_hwnd_i64(&window)?;
    state.arm_own(hwnd)
}

#[tauri::command]
pub fn gate_protection_stop(
    window: tauri::WebviewWindow,
    state: tauri::State<Arc<GateGuardState>>,
) -> Result<(), String> {
    let hwnd = window_hwnd_i64(&window).unwrap_or(0);
    state.disarm_own(hwnd);
    Ok(())
}

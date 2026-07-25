// Local session-event bridge: desktop app -> extension, same machine only.
//
// Why this exists: the extension's only other way to learn "a session
// started/ended somewhere other than this exact browser tab" is polling
// session-status (a Supabase Edge Function) on a timer - see SYNC_ALARM in
// background.js. That's fine for genuinely cross-device sync, but it's
// needless latency for the case where the desktop app is running right
// here and already knows the answer (blocks.html's own loadActiveBlock()
// poll of focus_lock_sessions already tells the desktop app the current
// state independent of anything the extension does).
//
// So: when the desktop app learns the session state has changed, it pushes
// that fact into this bus. The extension long-polls it over a plain local
// HTTP GET (see heartbeat.rs, which hosts this on the same
// 127.0.0.1:47552 listener as the existing heartbeat POST) and reacts
// within one round trip - no Supabase quota spent, no 35s wait. This is
// deliberately NOT a replacement for the Edge Function poll: it only ever
// covers "this machine's desktop app knew about it," never a different
// device with no desktop app running. That gap is intentional - it's
// still covered by the slower existing poll.
//
// Long-poll, not a real push protocol (SSE/WebSocket), because tiny_http
// (already a dependency, see heartbeat.rs) doesn't speak either of those,
// and adding a second server crate for this one endpoint isn't worth it.
// A client sends `GET /session-events?since=<seq>` and the request thread
// blocks (via Condvar::wait_timeout_while) until `seq` advances past
// `since`, or ~25s pass, whichever comes first - then the caller
// immediately reconnects with whatever `since` it was just given. Net
// latency for a real change is one wakeup, not one poll interval.

use std::sync::{Condvar, Mutex};
use std::time::Duration;

// Kept comfortably under tiny_http's own read/write timeouts and under
// most reverse-proxy/browser default idle limits (not that either applies
// on localhost, but there's no reason to push it close to any ceiling).
// The extension's long-poll loop just reconnects instantly on timeout, so
// this only affects how "chatty" an idle connection is, not correctness.
const LONG_POLL_TIMEOUT: Duration = Duration::from_secs(25);

struct BusInner {
    // Bumped only when `payload` actually changes (see push()) - a client
    // that's been offline can compare its own `since` against this and
    // immediately get the latest state on reconnect instead of waiting
    // for the next real transition.
    seq: u64,
    payload: serde_json::Value,
}

pub struct SessionEventBus {
    inner: Mutex<BusInner>,
    changed: Condvar,
}

impl SessionEventBus {
    pub fn new() -> Self {
        SessionEventBus {
            inner: Mutex::new(BusInner {
                seq: 0,
                payload: serde_json::json!({ "active": false, "session": null }),
            }),
            changed: Condvar::new(),
        }
    }

    /// Records the latest known session state. No-ops (no seq bump, no
    /// wakeup) if it's identical to what's already there - loadActiveBlock()
    /// on the website side calls this on every one of its own poll ticks,
    /// not just on real transitions, so this needs to be safe to call
    /// redundantly.
    pub fn push(&self, active: bool, session: serde_json::Value) {
        let next = serde_json::json!({ "active": active, "session": session });
        if let Ok(mut guard) = self.inner.lock() {
            if guard.payload != next {
                guard.payload = next;
                guard.seq += 1;
                self.changed.notify_all();
            }
        }
    }

    /// Blocks the calling thread (expected to be a dedicated per-request
    /// thread - see heartbeat.rs - never the single sequential accept
    /// loop) until `seq` moves past `since`, or the long-poll timeout
    /// elapses. Returns `Some((seq, payload))` on a real change,
    /// including immediately if the caller's `since` was already stale
    /// when it asked (no missed-update window). Returns `None` on
    /// timeout, meaning "nothing new, reconnect whenever."
    pub fn wait_for(&self, since: u64) -> Option<(u64, serde_json::Value)> {
        let guard = self.inner.lock().ok()?;
        let (guard, timed_out) = self
            .changed
            .wait_timeout_while(guard, LONG_POLL_TIMEOUT, |state| state.seq <= since)
            .ok()?;
        if timed_out.timed_out() {
            None
        } else {
            Some((guard.seq, guard.payload.clone()))
        }
    }
}

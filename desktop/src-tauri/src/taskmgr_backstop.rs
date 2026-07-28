// External, process-independent backstop for taskmgr_guard: schedules a
// one-shot Windows Scheduled Task that force-clears the DisableTaskMgr
// AND DisableCmd registry values at a computed time, regardless of
// whether revm2-desktop.exe is even alive to do it itself.
//
// Why this exists: the watchdog in lib.rs and the startup cleanup both
// only run *inside* the app's own process. If the process is killed
// outright (crash, BSOD, power loss, an elevated `taskkill /f`), nothing
// is left running to release the lock until the app happens to start
// again - and per the installer hooks, that only happens automatically
// at login, not right after a crash. This task lives independently in
// Task Scheduler, so it fires on schedule even if the app never comes
// back up in time.
//
// Timing:
//   - Timed session (a real ends_at): fires at ends_at + BACKSTOP_GRACE_SECS.
//     Mirrors the in-process watchdog's own grace period, just applied
//     externally.
//   - Indefinite session (unlimited, or no usable ends_at): no real end
//     time to anchor to, so this is a hard ceiling
//     (BACKSTOP_INDEFINITE_CEILING_SECS out) purely as crash insurance -
//     should never fire during a legitimate long session, but also
//     shouldn't leave someone locked out for a full day if the app died
//     20 minutes in.
//
// Callers in lib.rs are responsible for (re)calling schedule() only when
// the computed fire time actually changes, and for calling cancel() on
// every active->inactive transition and on startup cleanup - this module
// just does the computation and the two OS-facing operations.

const TASK_NAME: &str = "RevM2TaskmgrBackstop";
const BACKSTOP_GRACE_SECS: i64 = 5 * 60;
const BACKSTOP_INDEFINITE_CEILING_SECS: i64 = 24 * 60 * 60;

#[cfg(target_os = "windows")]
mod win {
    use super::TASK_NAME;
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows_sys::Win32::Storage::FileSystem::FileTimeToLocalFileTime;
    use windows_sys::Win32::System::Time::FileTimeToSystemTime;

    // Same flag, same reason as browser_guard.rs's own copy of this
    // constant: schtasks.exe is a console app, and spawning one from this
    // GUI process without CREATE_NO_WINDOW pops a real (if brief) console
    // window on screen. schedule()/cancel() both used to be missing this,
    // which combined with cancel() firing on every 5s "no active session"
    // poll tick (see lib.rs's set_session_active) made it flash constantly
    // whenever nothing was even blocked - looked exactly like a
    // command-prompt window randomly opening every few seconds.
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // 100ns intervals between the FILETIME epoch (1601-01-01) and the
    // Unix epoch (1970-01-01) - a fixed, well-known constant.
    const UNIX_EPOCH_AS_FILETIME_TICKS: u64 = 116_444_736_000_000_000;

    fn unix_secs_to_local_systemtime(unix_secs: i64) -> Option<SYSTEMTIME> {
        // Should never be negative in practice (every caller adds a
        // positive offset to `now`), but fail closed to 0 rather than
        // underflow/panic on a malformed input.
        let unix_secs = unix_secs.max(0) as u64;
        let ticks_100ns = unix_secs
            .checked_mul(10_000_000)?
            .checked_add(UNIX_EPOCH_AS_FILETIME_TICKS)?;

        let utc_ft = FILETIME {
            dwLowDateTime: (ticks_100ns & 0xFFFF_FFFF) as u32,
            dwHighDateTime: (ticks_100ns >> 32) as u32,
        };

        let mut local_ft = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let mut st = SYSTEMTIME {
            wYear: 0, wMonth: 0, wDayOfWeek: 0, wDay: 0,
            wHour: 0, wMinute: 0, wSecond: 0, wMilliseconds: 0,
        };

        unsafe {
            // Local, not UTC, on purpose: <StartBoundary> without a UTC
            // offset suffix is interpreted by Task Scheduler as local
            // machine time, so the value we hand it needs to already be
            // local for the fire time to land where we computed it.
            if FileTimeToLocalFileTime(&utc_ft, &mut local_ft) == 0 {
                return None;
            }
            if FileTimeToSystemTime(&local_ft, &mut st) == 0 {
                return None;
            }
        }
        Some(st)
    }

    pub fn now_unix_secs() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    /// Schedules (replacing any existing one) a one-shot task that force-
    /// clears DisableTaskMgr at `fire_at_unix_secs` (UTC unix timestamp).
    ///
    /// Uses an XML task definition rather than schtasks' `/st`/`/sd`
    /// flags deliberately: those are parsed against the machine's short
    /// date format, which varies by locale (India's default is
    /// dd-MM-yyyy, not the MM/dd/yyyy most schtasks examples assume) and
    /// would silently misfire the date on a non-US machine. The XML
    /// `<StartBoundary>` field is a fixed, unambiguous local-datetime
    /// string, not subject to that.
    pub fn schedule(fire_at_unix_secs: i64) -> Result<(), String> {
        let st = unix_secs_to_local_systemtime(fire_at_unix_secs)
            .ok_or_else(|| "failed to convert target time to local SYSTEMTIME".to_string())?;

        let start_boundary = format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond
        );

        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>RevM2 crash backstop - clears the Task Manager lock if the app isn't alive to do it itself.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>{start_boundary}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <DeleteExpiredTaskAfter>PT0S</DeleteExpiredTaskAfter>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>reg.exe</Command>
      <Arguments>delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f</Arguments>
    </Exec>
    <Exec>
      <Command>reg.exe</Command>
      <Arguments>delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableCmd /f</Arguments>
    </Exec>
  </Actions>
</Task>"#
        );

        // schtasks /xml expects UTF-16LE with a BOM - writing plain UTF-8
        // here would make it misparse the file.
        let xml_path = std::env::temp_dir().join("revm2-taskmgr-backstop.xml");
        let mut utf16: Vec<u16> = vec![0xFEFF];
        utf16.extend(xml.encode_utf16());
        let bytes: Vec<u8> = utf16.iter().flat_map(|u| u.to_le_bytes()).collect();
        std::fs::File::create(&xml_path)
            .and_then(|mut f| f.write_all(&bytes))
            .map_err(|e| format!("failed to write task XML: {e}"))?;

        let output = Command::new("schtasks")
            .args(["/create", "/tn", TASK_NAME, "/xml"])
            .arg(&xml_path)
            .arg("/f")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("failed to run schtasks /create: {e}"));

        let _ = std::fs::remove_file(&xml_path);
        let output = output?;

        if !output.status.success() {
            return Err(format!(
                "schtasks /create failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(())
    }

    /// Deletes the backstop task if present. Not finding one (already
    /// fired and self-deleted via DeleteExpiredTaskAfter, or never
    /// scheduled) is not an error - this is called on every session-end
    /// path, most of which won't have one pending.
    pub fn cancel() -> Result<(), String> {
        let output = Command::new("schtasks")
            .args(["/delete", "/tn", TASK_NAME, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("failed to run schtasks /delete: {e}"))?;

        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("cannot find") {
            return Ok(()); // nothing to cancel
        }
        Err(format!("schtasks /delete failed: {stderr}"))
    }
}

#[cfg(not(target_os = "windows"))]
mod win {
    pub fn now_unix_secs() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
    pub fn schedule(_fire_at_unix_secs: i64) -> Result<(), String> {
        Ok(()) // no-op off Windows (dev on macOS/Linux)
    }
    pub fn cancel() -> Result<(), String> {
        Ok(())
    }
}

/// Parses a Postgres/Supabase `timestamptz` as returned by JS's
/// `Date.toISOString()` (e.g. "2026-07-28T15:50:00.000Z") into a unix
/// timestamp. Only understands that specific always-UTC shape (which is
/// all the frontend ever sends here) - deliberately not a general ISO
/// 8601 parser.
fn parse_iso8601_utc_to_unix(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19
        || b[4] != b'-' || b[7] != b'-' || b[10] != b'T'
        || b[13] != b':' || b[16] != b':'
    {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: u32 = s.get(5..7)?.parse().ok()?;
    let day: u32 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Howard Hinnant's days-from-civil algorithm (public domain) -
    // proleptic Gregorian y/m/d -> days since 1970-01-01. Avoids pulling
    // in a date/time crate for this one conversion.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    Some(days * 86_400 + hour * 3600 + minute * 60 + second)
}

/// Deterministic: same `ends_at` always produces the same fire time, no
/// dependency on "now". Safe to call on every poll tick without causing
/// schedule() churn, since the caller's dedup (compare-and-swap against
/// the previous value) will only actually see a change when the real end
/// time itself changes.
pub fn compute_fire_at_from_ends_at(ends_at: &str) -> Option<i64> {
    parse_iso8601_utc_to_unix(ends_at).map(|t| t + BACKSTOP_GRACE_SECS)
}

/// NOT deterministic - anchored to the current time, so it drifts by a
/// few seconds on every call. Callers must only invoke this once, right
/// when a session starts and no real end time is known yet (or it's
/// genuinely unlimited), and then leave the result alone on later polls
/// rather than recomputing it - otherwise the mismatch against a moving
/// "now" defeats the caller's own dedup and re-spawns schtasks.exe on
/// every single poll tick for the life of the session.
pub fn indefinite_ceiling_from_now() -> i64 {
    win::now_unix_secs() + BACKSTOP_INDEFINITE_CEILING_SECS
}

pub fn schedule(fire_at_unix_secs: i64) -> Result<(), String> {
    win::schedule(fire_at_unix_secs)
}

pub fn cancel() -> Result<(), String> {
    win::cancel()
}

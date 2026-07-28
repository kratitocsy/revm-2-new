// Disables/re-enables Task Manager AND Command Prompt for the current
// Windows user via the `DisableTaskMgr` and `DisableCMD` policy values -
// the same ones Group Policy and parental-control software use.
// taskmgr.exe and cmd.exe each check their own value at launch time and
// refuse to open if it's set - no service, no process hook, no admin
// rights required for the HKCU form used here.
//
// DisableCMD=2 (not 1) is used deliberately: 1 still allows batch file
// (.bat/.cmd) processing, which would let someone route around the
// interactive-prompt block with a one-line .bat double-click. 2 disables
// both.
//
// PowerShell has no equivalent simple HKCU policy - blocking it outright
// needs AppLocker/Software Restriction Policies, which need admin rights
// at install time. See app_guard::kill_shell_processes for the
// best-effort fallback (kills the process on the same 3s tick as
// everything else) and its honest limitation: a single command that
// completes before the next tick isn't stopped by this.
//
// None of this stops someone from killing revm2-desktop.exe itself via
// some other means (Task Manager before this took effect, taskkill from
// an already-open shell, etc.) - it closes the most common bypasses, not
// a complete anti-tamper story. Same spirit as browser_guard/app_guard.

#[cfg(target_os = "windows")]
mod win {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE,
    };

    const SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
    const TASKMGR_VALUE: &str = "DisableTaskMgr";
    const CMD_VALUE: &str = "DisableCmd";
    // 2 = disable cmd.exe entirely, including .bat/.cmd batch processing
    // (1 would still let a double-clicked .bat route around the
    // interactive-prompt block).
    const CMD_DISABLED_DATA: u32 = 2;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Sets or clears a single DWORD policy value under SUBKEY.
    /// `disabled = false` deletes the value rather than writing 0, so we
    /// don't leave a stray policy key behind for something else - e.g.
    /// an admin's actual Group Policy - to have to fight with later.
    fn set_dword_policy(value_name: &str, enabled_data: u32, disabled: bool) -> Result<(), String> {
        let subkey_w = wide(SUBKEY);
        let mut hkey: HKEY = 0;

        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey_w.as_ptr(),
                0,
                std::ptr::null_mut(), // lpClass: unused, PWSTR wants *mut not *const
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                std::ptr::null(),
                &mut hkey,
                std::ptr::null_mut(),
            )
        };
        if status != ERROR_SUCCESS || hkey == 0 {
            return Err(format!("RegCreateKeyExW failed for {value_name}: {status}"));
        }

        let value_name_w = wide(value_name);
        let result = if disabled {
            let data: u32 = enabled_data;
            let status = unsafe {
                RegSetValueExW(
                    hkey,
                    value_name_w.as_ptr(),
                    0,
                    REG_DWORD,
                    &data as *const u32 as *const u8,
                    std::mem::size_of::<u32>() as u32,
                )
            };
            if status == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(format!("RegSetValueExW failed for {value_name}: {status}"))
            }
        } else {
            let status = unsafe { RegDeleteValueW(hkey, value_name_w.as_ptr()) };
            // ERROR_FILE_NOT_FOUND (2) just means it was already
            // enabled/never set - not a real failure for a "make sure
            // it's enabled" call.
            if status == ERROR_SUCCESS || status == 2 {
                Ok(())
            } else {
                Err(format!("RegDeleteValueW failed for {value_name}: {status}"))
            }
        };

        unsafe {
            RegCloseKey(hkey);
        }
        result
    }

    /// Sets/clears both policies. Attempts both even if one fails, and
    /// aggregates any errors, so a failure on one (e.g. some odd
    /// permissions edge case on DisableCmd) doesn't silently skip the
    /// other - maximizes actual protection coverage rather than
    /// short-circuiting on the first error.
    pub fn set_disabled(disabled: bool) -> Result<(), String> {
        let taskmgr_result = set_dword_policy(TASKMGR_VALUE, 1, disabled);
        let cmd_result = set_dword_policy(CMD_VALUE, CMD_DISABLED_DATA, disabled);
        match (taskmgr_result, cmd_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(e), Ok(())) | (Ok(()), Err(e)) => Err(e),
            (Err(e1), Err(e2)) => Err(format!("{e1}; {e2}")),
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win {
    pub fn set_disabled(_disabled: bool) -> Result<(), String> {
        Ok(()) // no-op off Windows (dev on macOS/Linux)
    }
}

/// Public entry point used from lib.rs, both from the explicit command
/// and from set_session_active's active/inactive transitions.
pub fn set_disabled(disabled: bool) -> Result<(), String> {
    win::set_disabled(disabled)
}

// Disables/re-enables Task Manager for the current Windows user via the
// same `DisableTaskMgr` policy value Group Policy and parental-control
// software use. taskmgr.exe (and the Ctrl+Shift+Esc / Ctrl+Alt+Del ->
// "Task Manager" launcher) checks this registry value itself at launch
// time and refuses to open if it's set - no service, no process hook,
// no admin rights required for the HKCU form used here.
//
// This does NOT stop someone from killing revm2-desktop.exe itself via
// some other means (a different task manager, `taskkill` from a command
// prompt, etc.) - it only closes the single most common bypass (opening
// Task Manager and ending the process from there). It's one layer in the
// same spirit as browser_guard/app_guard, not a complete anti-tamper
// story on its own.

#[cfg(target_os = "windows")]
mod win {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE,
    };

    const SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
    const VALUE_NAME: &str = "DisableTaskMgr";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Sets or clears the policy. `disabled = true` blocks Task Manager
    /// from opening; `disabled = false` removes the restriction (deletes
    /// the value rather than writing 0, so we don't leave a stray policy
    /// key behind for something else - e.g. an admin's actual Group
    /// Policy - to have to fight with later).
    pub fn set_disabled(disabled: bool) -> Result<(), String> {
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
            return Err(format!("RegCreateKeyExW failed: {status}"));
        }

        let value_name_w = wide(VALUE_NAME);
        let result = if disabled {
            let data: u32 = 1;
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
                Err(format!("RegSetValueExW failed: {status}"))
            }
        } else {
            let status = unsafe { RegDeleteValueW(hkey, value_name_w.as_ptr()) };
            // ERROR_FILE_NOT_FOUND (2) just means it was already
            // enabled/never set - not a real failure for a "make sure
            // it's enabled" call.
            if status == ERROR_SUCCESS || status == 2 {
                Ok(())
            } else {
                Err(format!("RegDeleteValueW failed: {status}"))
            }
        };

        unsafe {
            RegCloseKey(hkey);
        }
        result
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

; RevM2 desktop installer hooks (referenced via bundle.windows.nsis.installerHooks
; in tauri.conf.json). Tauri's NSIS template calls these macros automatically
; at the right points - nothing else needs to invoke them.
;
; What this achieves, end to end:
;   1. Install requires one UAC prompt (installMode: perMachine already
;      forces this).
;   2. That elevated moment is used to create a Scheduled Task that
;      launches revm2-desktop.exe with RunLevel "highest" (i.e. admin
;      integrity), and to point the Start Menu / Desktop shortcuts at
;      that task instead of the exe directly.
;   3. Because the task's elevation was already consented to at install
;      time, running it later via `schtasks /run` does NOT prompt for
;      UAC again - this is standard, well-documented Windows Task
;      Scheduler behavior, not a workaround of anything.
;   4. The result: revm2-desktop.exe runs at High integrity on every
;      normal launch. A standard (non-elevated) Task Manager, run by
;      the same logged-in user, cannot terminate a High-integrity
;      process - Windows returns Access Denied. That's what actually
;      stops a casual "just End Task it" bypass, not anything the app
;      does at runtime.
;   5. Uninstall is gated on session.lock (written/removed by the app
;      itself in lib.rs's set_session_active) - if a session is active,
;      the uninstaller refuses and explains why.

!macro NSIS_HOOK_POSTINSTALL
    ; --- ProgramData\RevM2 needs to be writable by standard users -----
    ; The app itself runs elevated (see below) so it could write here
    ; regardless, but keeping this permissive means the session.lock
    ; read in the uninstaller (running as a different, also-elevated
    ; process) never trips over an ACL surprise either way.
    CreateDirectory "$COMMONPROGRAMDATA\RevM2"
    nsExec::ExecToLog 'icacls "$COMMONPROGRAMDATA\RevM2" /grant *S-1-5-32-545:(OI)(CI)M /T'

    ; --- Scheduled Task: launches the app pre-elevated, no prompt -----
    ; /sc onlogon: also starts automatically at login, matching normal
    ; "study app opens with Windows" expectations.
    ; /rl highest: run at admin integrity.
    ; /f: overwrite if this task already exists (re-install/upgrade case).
    nsExec::ExecToLog 'schtasks /create /tn "RevM2DesktopElevated" /tr "\"$INSTDIR\revm2-desktop.exe\"" /sc onlogon /rl highest /f'

    ; --- Redirect shortcuts to launch via the task, not the exe -------
    ; Tauri's base NSIS script already created these pointing straight
    ; at the exe; overwriting them here (same paths) makes every normal
    ; launch path - Start Menu, Desktop, taskbar pin - go through the
    ; elevated task instead. IconFile keeps the app's real icon even
    ; though the shortcut target is now schtasks.exe.
    CreateShortCut "$SMPROGRAMS\RevM2.lnk" "$SYSDIR\schtasks.exe" \
        '/run /tn "RevM2DesktopElevated"' "$INSTDIR\revm2-desktop.exe" 0
    CreateShortCut "$DESKTOP\RevM2.lnk" "$SYSDIR\schtasks.exe" \
        '/run /tn "RevM2DesktopElevated"' "$INSTDIR\revm2-desktop.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
    ; session.lock exists only while set_session_active(true) has been
    ; called and not yet followed by set_session_active(false) - see
    ; lib.rs. This is a cooperative check (the uninstaller is itself
    ; elevated, same as any per-machine app), not an OS-level lock; see
    ; the desktop README's "threat model" section for what that does
    ; and doesn't guarantee.
    IfFileExists "$COMMONPROGRAMDATA\RevM2\session.lock" 0 +4
        MessageBox MB_OK|MB_ICONSTOP \
            "A focus session is currently active.$\r$\n$\r$\n\
            RevM2 can't be uninstalled until the session ends. Open the \
            app and use its stop-early flow if this is urgent."
        Abort
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
    ; Only reached if PREUNINSTALL didn't abort above.
    nsExec::ExecToLog 'schtasks /delete /tn "RevM2DesktopElevated" /f'
    Delete "$SMPROGRAMS\RevM2.lnk"
    Delete "$DESKTOP\RevM2.lnk"
    RMDir /r "$COMMONPROGRAMDATA\RevM2"
!macroend

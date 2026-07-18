if running && !is_extension_installed(&target) {
            result.push(target.name);
        }
    }
    result
}

// Kills every running process matching any supported browser that doesn't
// have the extension - called only while a focus session is active.
pub fn kill_unprotected_browsers() -> Vec<&'static str> {
    let mut sys = System::new_all();
    sys.refresh_processes();

    let mut killed = Vec::new();
    for target in supported_browsers() {
        if is_extension_installed(&target) { continue; }
        let pids: Vec<Pid> = sys
            .processes()
            .iter()
            .filter(|(_, p)| target.process_names.iter().any(|pn| pn.eq_ignore_ascii_case(p.name())))
            .map(|(pid, _)| *pid)
            .collect();

        if !pids.is_empty() {
            for pid in pids {
                if let Some(process) = sys.process(pid) {
                    process.kill();
                }
            }
            killed.push(target.name);
        }
    }
    killed
}

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const API_BASE = "https://dhzjtjekbvxxsauzhadl.supabase.co/functions/v1";
const POLL_INTERVAL_MS = 30_000;

async function getToken() {
  return await invoke("get_token");
}

async function setToken(token) {
  await invoke("save_token", { token });
}

async function fetchSessionStatus(token) {
  try {
    const res = await fetch(`${API_BASE}/session-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null);
    return { ok: true, data };
  } catch {
    return { ok: false, offline: true };
  }
}

function setStatusText(text) {
  const el = document.getElementById("status-text");
  if (el) el.textContent = text;
  invoke("set_tray_status", { text: `RevM2 - ${text}` }).catch(() => {});
}

async function poll() {
  const token = await getToken();
  const connectForm = document.getElementById("connect-form");
  const disconnectBtn = document.getElementById("disconnect-btn");

  if (!token) {
    setStatusText("Not connected");
    connectForm.style.display = "flex";
    disconnectBtn.style.display = "none";
    invoke("set_session_active", { active: false }).catch(() => {});
    return;
  }

  connectForm.style.display = "none";
  disconnectBtn.style.display = "inline-block";

  const result = await fetchSessionStatus(token);

  if (result.status === 401) {
    setStatusText("Token expired - reconnect");
    await setToken("");
    invoke("set_session_active", { active: false }).catch(() => {});
    return;
  }
  if (!result.ok) {
    setStatusText("Offline - retrying...");
    return; // leave session_active as-is - don't disable enforcement just because a poll failed
  }

  const session = result.data?.session;
  const active = !!session?.active;
  invoke("set_session_active", { active }).catch(() => {});

  if (active) {
    const timeLabel = session.unlimited
      ? "no time limit"
      : `${session.durationMinutes ?? "?"} min left`;
    setStatusText(`Active: ${session.blockName || "Focus session"} - ${timeLabel}`);
  } else {
    setStatusText("No active session");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const connectForm = document.getElementById("connect-form");
  const disconnectBtn = document.getElementById("disconnect-btn");

  connectForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("token-input");
    const value = input.value.trim();
    if (!value) return;
    await setToken(value);
    input.value = "";
    poll();
  });

  disconnectBtn?.addEventListener("click", async () => {
    await setToken("");
    poll();
  });

  listen("browser-blocked", (event) => {
    const names = event.payload.join(", ");
    alert(
      `${names} was closed because the RevM2 extension isn't installed there yet.\n\nInstall it from the Blocks page, then reopen ${names}.`
    );
  });

  poll();
  setInterval(poll, POLL_INTERVAL_MS);
});
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

// --- Blocked apps panel ----------------------------------------------------
//
// Backend (app_guard.rs / lib.rs commands) has been ready for a while -
// list_running_apps / get_blocked_apps / set_blocked_apps, plus
// kill_blocked_apps() already running on every guard-loop tick whenever a
// session is active. This wires an actual UI to it: the block list was
// previously invisible and unconfigurable from the app itself.

let blockedApps = []; // process names, e.g. "steam.exe" - authoritative local copy
const RUNNING_APPS_REFRESH_MS = 8_000;

function normalizeProcessName(name) {
  return name.trim();
}

function isBlocked(name) {
  const lower = name.toLowerCase();
  return blockedApps.some((b) => b.toLowerCase() === lower);
}

async function loadBlockedApps() {
  try {
    blockedApps = await invoke("get_blocked_apps");
  } catch {
    blockedApps = [];
  }
  renderBlockedList();
}

async function saveBlockedApps() {
  try {
    await invoke("set_blocked_apps", { apps: blockedApps });
  } catch (err) {
    console.error("Failed to save blocked apps", err);
  }
}

function renderBlockedList() {
  const list = document.getElementById("blocked-list");
  const emptyHint = document.getElementById("blocked-empty");
  if (!list) return;

  list.querySelectorAll(".blocked-chip").forEach((el) => el.remove());

  if (blockedApps.length === 0) {
    if (emptyHint) emptyHint.style.display = "block";
    return;
  }
  if (emptyHint) emptyHint.style.display = "none";

  blockedApps.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "blocked-chip";
    chip.textContent = name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-remove";
    removeBtn.setAttribute("aria-label", `Stop blocking ${name}`);
    removeBtn.textContent = "\u00d7";
    removeBtn.onclick = async () => {
      blockedApps = blockedApps.filter((b) => b.toLowerCase() !== name.toLowerCase());
      await saveBlockedApps();
      renderBlockedList();
      populateRunningAppsSelect(); // it can be re-added now, so put it back in the picker
    };

    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
}

async function addAppToBlockList(rawName) {
  const name = normalizeProcessName(rawName);
  if (!name) return;
  if (isBlocked(name)) return; // already there - nothing to do
  blockedApps = [...blockedApps, name];
  await saveBlockedApps();
  renderBlockedList();
  populateRunningAppsSelect();
}

let lastRunningApps = [];

async function populateRunningAppsSelect() {
  const select = document.getElementById("running-apps-select");
  if (!select) return;

  let apps;
  try {
    apps = await invoke("list_running_apps");
  } catch (err) {
    console.error("Failed to list running apps", err);
    select.innerHTML = "<option value=''>Couldn't read running apps</option>";
    return;
  }
  lastRunningApps = apps;

  const selectable = apps.filter((a) => !isBlocked(a.name));
  select.innerHTML = "";

  if (selectable.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = apps.length === 0 ? "No apps detected" : "All visible apps already blocked";
    select.appendChild(opt);
    return;
  }

  selectable.forEach((app) => {
    const opt = document.createElement("option");
    opt.value = app.name;
    opt.textContent = app.name;
    select.appendChild(opt);
  });
}

function wireAppsPanel() {
  document.getElementById("add-from-running-btn")?.addEventListener("click", async () => {
    const select = document.getElementById("running-apps-select");
    const name = select?.value;
    if (!name) return;
    await addAppToBlockList(name);
  });

  document.getElementById("refresh-running-btn")?.addEventListener("click", () => {
    populateRunningAppsSelect();
  });

  const manualInput = document.getElementById("manual-app-input");
  const addManual = async () => {
    if (!manualInput) return;
    const value = manualInput.value.trim();
    if (!value) return;
    await addAppToBlockList(value);
    manualInput.value = "";
  };
  document.getElementById("add-manual-btn")?.addEventListener("click", addManual);
  manualInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addManual();
    }
  });
}

async function initAppsPanel() {
  wireAppsPanel();
  await loadBlockedApps();
  await populateRunningAppsSelect();
  setInterval(populateRunningAppsSelect, RUNNING_APPS_REFRESH_MS);
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
  initAppsPanel();
});
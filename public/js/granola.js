import { $, G, ago, esc, plural, state } from "./core.js";
import { loadNotes, readSse, refreshState } from "./shell.js";
import { noteCache } from "./notes.js";

// ---- Granola connection and sync ----

export function renderGranola() {
  const el = $("granolaCard");
  const busy = G.syncing;
  const btn = (id, label, primary = true) => `<button id="${id}" ${busy ? "disabled" : ""} class="${primary ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-white text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 dark:bg-ink-700 dark:text-brand-100 dark:ring-ink-600"} mt-2.5 w-full rounded-xl px-3 py-2 text-sm font-extrabold transition active:scale-95 disabled:opacity-60">${label}</button>`;
  let body;
  if (!G.connected) {
    body = `<div class="flex items-center gap-2 text-sm font-extrabold"><span class="h-2 w-2 rounded-full bg-slate-300"></span>Granola</div>
      <p class="mt-1 font-medium leading-snug opacity-80">One sign-in, then your whole semester syncs itself.</p>
      ${btn("connectBtn", "Connect Granola")}
      ${G.authUrl ? `<a href="${esc(G.authUrl)}" target="_blank" rel="noopener" class="mt-2 block text-center text-[11px] font-bold underline">Sign-in tab didn't open? Click here</a>` : ""}`;
  } else {
    const last = G.last;
    const lastLine = last ? `Synced ${ago(last.at)}${last.added || last.updated ? ` · ${last.added} new, ${last.updated} updated` : " · all up to date"}` : "Not synced yet";
    body = `<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 text-sm font-extrabold"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Granola connected</div>
        <button id="disconnectBtn" class="text-[10px] font-bold opacity-50 hover:opacity-100">Disconnect</button></div>
      <p class="mt-1 font-medium opacity-80">${esc(busy ? "Syncing…" : lastLine)}</p>
      ${btn("syncBtn", busy ? '<span class="dots"><span></span><span></span><span></span></span>' : "Sync now")}`;
  }
  if (G.msg) body += `<div class="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-[11px] font-semibold leading-relaxed dark:bg-ink-900/40">${esc(G.msg)}</div>`;
  if (G.detail) body += `<details class="mt-2 text-[11px]"><summary class="cursor-pointer font-bold opacity-70">See what changed</summary><div class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap opacity-80">${esc(G.detail)}</div></details>`;
  el.innerHTML = body;
}

export async function refreshGranola() {
  try {
    const s = await fetch("/api/granola/status").then((r) => r.json());
    Object.assign(G, { connected: s.connected, syncing: s.syncing || G.syncing, last: s.last ?? null });
  } catch {}
  renderGranola();
}

export async function connectGranola() {
  G.msg = "Opening the Granola sign-in…"; G.authUrl = ""; renderGranola();
  try {
    const res = await fetch("/api/granola/connect", { method: "POST" });
    const d = await res.json();
    if (!res.ok) { G.msg = "😕 " + d.error; return renderGranola(); }
    G.authUrl = d.authUrl;
    G.msg = "Finish signing in on the Granola tab. This page updates by itself.";
    renderGranola();
    window.open(d.authUrl, "_blank");
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch("/api/granola/status").then((r) => r.json());
      if (s.connected) { G.connected = true; G.authUrl = ""; G.msg = "🎉 Connected! Pulling in your notes…"; renderGranola(); return runGranolaSync(); }
    }
    G.msg = "Sign-in timed out. Click Connect Granola to try again."; G.authUrl = "";
  } catch (e) {
    G.msg = "😕 Couldn't start the sign-in. Is StudyDeck still running?";
  }
  renderGranola();
}

export async function runGranolaSync() {
  if (G.syncing) return;
  G.syncing = true; G.detail = ""; G.msg = "Starting…"; renderGranola();
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      if (d.needsConnect) { G.connected = false; G.msg = "Granola needs to be connected again."; } else G.msg = "😕 " + (d.error || `Sync failed (${res.status})`);
      return;
    }
    await readSse(res, (ev, data) => {
      if (ev === "progress") { G.msg = data; renderGranola(); }
      if (ev === "done") {
        const bits = [data.added.length && `${data.added.length} new`, data.updated.length && `${data.updated.length} updated`, data.moved.length && `${data.moved.length} re-filed`].filter(Boolean);
        G.msg = bits.length ? `🎉 ${bits.join(", ")} (of ${data.scanned} meetings)` : `✅ Already up to date (${data.scanned} meetings checked)`;
        if (data.errors.length) G.msg += ` · ${plural(data.errors.length, "problem")}`;
        G.detail = [...data.added.map((a) => `+ ${a.course}: ${a.title}`), ...data.updated.map((a) => `~ ${a.course}: ${a.title}`), ...data.moved.map((a) => `→ ${a.course}: ${a.title}`),
          ...data.errors.map((e) => `! ${e.title}: ${e.error}`)].join("\n");
      }
      if (ev === "error") { G.msg = "😕 " + data.message; if (data.needsConnect) G.connected = false; }
    });
  } catch (e) {
    G.msg = "😕 Lost contact with StudyDeck during the sync.";
  }
  G.syncing = false;
  noteCache.clear();
  await Promise.all([refreshGranola(), refreshState(), loadNotes()]);
}
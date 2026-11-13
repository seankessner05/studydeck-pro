import { $, courseName, esc, iconFor, palette, plural, state } from "./core.js";
import { refreshState, selectCourse } from "./shell.js";

// ---- AI usage and Pause AI ----
export function renderAi() {
  const u = state.usage;
  const el = $("aiChip");
  if (!el) return;
  const paused = state.aiPaused;
  el.className = `flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${paused ? "bg-sun/30 text-amber-900 dark:text-sun" : "bg-slate-50 text-slate-600 dark:bg-ink-700 dark:text-slate-300"}`;
  const calls = u ? u.today.calls : 0;
  el.innerHTML = paused
    ? `<span>⏸ AI paused</span><button id="aiToggle" class="rounded-lg bg-white/70 px-2 py-0.5 font-extrabold dark:bg-ink-900/40">Resume</button>`
    : `<span title="Questions and, soon, card and exam generation. Reviewing cards uses no AI.">✨ AI on · ${calls} ${calls === 1 ? "call" : "calls"} today</span><button id="aiToggle" class="rounded-lg px-2 py-0.5 font-extrabold text-slate-400 hover:bg-white dark:hover:bg-ink-900/40">Pause</button>`;
  $("q").placeholder = paused ? "AI is paused. Resume it in the sidebar to ask questions." : "Ask anything about your notes…";
}

export async function refreshAi() {
  try {
    const u = await fetch("/api/usage").then((r) => r.json());
    state.usage = u;
    state.aiPaused = u.paused;
  } catch {}
  renderAi();
}

export async function toggleAi() {
  const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aiPaused: !state.aiPaused }) });
  if (res.ok) state.aiPaused = (await res.json()).aiPaused;
  await refreshAi();
}

// ---- class picker (⌘K) ----
// An object, not a bare variable, so the keyboard handler in another module can change it.
export const pickerState = { index: 0 };
export function pickerItems() {
  const f = $("pickerInput").value.toLowerCase();
  const all = [{ id: "all", name: "Everything", count: state.total }, ...state.courses.filter((c) => !c.archived)];
  return all.filter((c) => `${c.id} ${courseName(c.id)}`.toLowerCase().includes(f));
}
export function renderPicker() {
  const items = pickerItems();
  pickerState.index = Math.min(pickerState.index, Math.max(0, items.length - 1));
  $("pickerList").innerHTML = items.map((c, i) => `<button data-pick="${esc(c.id)}" class="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm ${i === pickerState.index ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "hover:bg-slate-50 dark:hover:bg-ink-700"}">
      <span class="grid h-8 w-8 place-items-center rounded-xl ${palette(c.id).tile}">${iconFor(c.id)}</span><span class="flex-1 font-bold">${esc(courseName(c.id))}${c.id !== "all" && c.id !== "unsorted" ? ` <span class="font-mono text-[11px] font-semibold text-slate-400">${esc(c.id)}</span>` : ""}</span><span class="text-xs font-bold text-slate-400">${c.count}</span></button>`).join("")
    || '<div class="px-3 py-6 text-center text-sm text-slate-400">No class matches. Did you mean ECON? 🤓</div>';
  return items;
}
export function openPicker() {
  $("picker").classList.remove("hidden"); $("picker").classList.add("flex");
  $("pickerInput").value = "";
  pickerState.index = Math.max(0, pickerItems().findIndex((c) => c.id === state.course));
  renderPicker(); $("pickerInput").focus();
}
export function closePicker() { $("picker").classList.add("hidden"); $("picker").classList.remove("flex"); }
export function pick(id) { closePicker(); if (id) selectCourse(id); }

// ---- manage classes ----
export function renderManage(error = "") {
  const rows = state.courses.filter((c) => c.id !== "unsorted").map((c) => `<div class="flex items-center gap-3 rounded-2xl px-3 py-2 ${c.archived ? "opacity-50" : ""}">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${palette(c.id).tile}">${iconFor(c.id)}</span>
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">${esc(c.name)} <span class="font-mono text-[11px] font-semibold text-slate-400">${esc(c.id)}</span></div>
        <div class="text-[11px] text-slate-400">${esc(state.profiles.find((p) => p.id === c.profile)?.label ?? c.profile)}${c.semester ? " · " + esc(c.semester) : ""} · ${plural(c.count, "note")}</div></div>
      <button data-archive="${esc(c.id)}" data-to="${c.archived ? "0" : "1"}" ${state.editable ? "" : "disabled"} class="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold hover:bg-slate-50 disabled:opacity-40 dark:border-ink-600 dark:hover:bg-ink-700">${c.archived ? "Restore" : "Archive"}</button></div>`).join("");
  $("manageList").innerHTML = rows;
  $("manageNote").classList.toggle("hidden", state.editable);
  $("manageForm").classList.toggle("hidden", !state.editable);
  $("profile").innerHTML = state.profiles.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("");
  $("manageError").textContent = error;
}
export async function openManage() { await refreshState(); renderManage(); $("manage").classList.remove("hidden"); $("manage").classList.add("flex"); }
export function closeManage() { $("manage").classList.add("hidden"); $("manage").classList.remove("flex"); }
export async function saveCourse(method, url, body) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return renderManage(data.error || "Something went wrong.");
  if (body.archived && state.course === decodeURIComponent(url.split("/").pop())) state.course = "all";
  await selectCourse(state.course);
  renderManage();
}

// ---- doctor ----
export const STATUS_UI = {
  ok: { icon: "✓", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  warn: { icon: "!", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  fail: { icon: "✗", cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
};
export async function runDoctorUi(deep = false) {
  $("doctor").classList.remove("hidden"); $("doctor").classList.add("flex");
  $("doctorSummary").textContent = deep ? "Running a deep check (asks Claude one tiny question)…" : "Checking your setup…";
  $("doctorList").innerHTML = '<div class="flex items-center gap-2 px-6 py-6 text-sm text-slate-400"><span class="dots"><span></span><span></span><span></span></span>This can take up to 20 seconds.</div>';
  $("doctorAgain").disabled = $("doctorDeep").disabled = true;
  try {
    const checks = await fetch(`/api/doctor${deep ? "?deep=1" : ""}`).then((r) => r.json());
    const n = (s) => checks.filter((c) => c.status === s).length;
    $("doctorSummary").textContent = n("fail") ? `${plural(n("fail"), "problem")} to fix` : n("warn") ? `Working, with ${plural(n("warn"), "thing")} to look at` : "Everything looks good ✨";
    $("doctorList").innerHTML = checks.map((c) => `<div class="flex gap-3 px-6 py-3.5">
        <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${STATUS_UI[c.status].cls}">${STATUS_UI[c.status].icon}</span>
        <div class="min-w-0 flex-1"><div class="text-sm font-bold">${esc(c.label)}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400">${esc(c.detail)}</div>
          ${c.fix ? `<div class="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-ink-700 dark:text-slate-200">${esc(c.fix)}</div>` : ""}</div></div>`).join("");
  } catch {
    $("doctorSummary").textContent = "Couldn't reach the StudyDeck server.";
    $("doctorList").innerHTML = "";
  }
  $("doctorAgain").disabled = $("doctorDeep").disabled = false;
}
export function closeDoctor() { $("doctor").classList.add("hidden"); $("doctor").classList.remove("flex"); }
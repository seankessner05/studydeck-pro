import { $, G, S, courseName, esc, fmtDate, palette, plural, state } from "./core.js";
import { noteCache } from "./notes.js";
import { loadStudyToday } from "./cards.js";
import { refreshAi } from "./panels.js";

// ---- generate cards and quiz questions from lectures ----
export const GEN_CHIP = {
  none: ["New", "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"],
  generated: ["Done", "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"],
  stale: ["Edited since", "bg-sun/30 text-amber-800 dark:text-sun"],
};
export const GEN_STATE_ICON = { queued: "⏳", running: "✍️", done: "✅", error: "⚠️", skipped: "⏭️" };

// The same panel makes flashcards (Flashcards tab) or quiz questions (Quizzes tab); everything that differs lives here.
export const GEN_CFG = {
  cards: {
    st: () => S.gen, base: "/api/study/generate", one: "card", many: "cards", icon: "✨",
    lead: "Make cards from your lectures", title: "Make cards", pitch: "Each card comes with a quote from your note as its receipt. Cards that can't prove themselves are dropped.",
    per: "Cards per lecture", callsPer: 1, working: "writing…", have: (n) => n + (n === 1 ? " card" : " cards"),
    headBusy: "Writing cards…", doneBtn: "Study them now →",
  },
  quiz: {
    st: () => S.qgen, base: "/api/study/quiz/generate", one: "question", many: "questions", icon: "📝",
    lead: "Make quiz questions from your lectures", title: "Make questions", pitch: "Each question is written from your note, checked against it, then solved blind by a second Claude call that never sees the answer key. Any that don't hold up are dropped.",
    per: "Questions per lecture", callsPer: 2, working: "writing and checking…", have: (n) => n + (n === 1 ? " question" : " questions"),
    headBusy: "Writing and checking questions…", doneBtn: "Quiz me now →",
  },
  problems: {
    st: () => S.pgen, base: "/api/study/problems/generate", one: "problem", many: "problems", icon: "🧮",
    lead: "Make practice problems from your lectures", title: "Make problems", pitch: "Each problem is written as a small program, the app computes every step itself, and a second Claude call solves it blind. Lectures with no calculations make none.",
    per: "Problems per lecture", callsPer: 2, working: "writing and solving…", have: (n) => n + (n === 1 ? " problem" : " problems"),
    headBusy: "Writing and solving problems…", doneBtn: "Practice now →",
  },
};
export const gk = () => (S.sub === "quiz" ? "quiz" : S.sub === "problems" ? "problems" : "cards");

export async function loadGenPlan(kind = gk()) {
  const res = await fetch(`${GEN_CFG[kind].base}/plan?course=${encodeURIComponent(state.course)}`);
  if (!res.ok) return;
  const plan = await res.json();
  const G = GEN_CFG[kind].st();
  G.plan = plan;
  // Start with what's worth doing: lectures with nothing yet, or edited since they were processed.
  G.selected = new Set(plan.lectures.filter((l) => l.status !== "generated").slice(0, plan.maxPerJob).map((l) => l.id));
  updateGenPanel(kind);
}

export function genJobDone(job) { return job && job.status !== "running" && !job.items.some((i) => i.state === "running" || i.state === "queued"); }

export function genPanelHtml(kind = gk()) {
  const C = GEN_CFG[kind];
  const G = C.st();
  if (G.job) return genJobHtml(G.job, kind);
  if (!G.open || !G.plan) {
    return `<div class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-gradient-to-r from-brand-50 to-fuchsia-50 p-5 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-fuchsia-500/10 dark:ring-brand-500/30">
      <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-2xl shadow-card dark:bg-ink-800">${C.icon}</div>
      <div class="min-w-[12rem] flex-1"><div class="font-extrabold">${C.lead}</div>
        <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${C.pitch}</div></div>
      <button data-gen-open class="w-full shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-extrabold text-white hover:bg-brand-600 sm:w-auto">Choose lectures</button></div>`;
  }
  const p = G.plan;
  const picked = p.lectures.filter((l) => G.selected.has(l.id));
  const dens = p.densities.map((d) => `<button data-gen-density="${d.id}" class="rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${G.density === d.id ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-300"}">${esc(d.label)} <span class="opacity-70">≈${d.target}</span></button>`).join("");
  const rows = p.lectures.map((l) => {
    const [label, cls] = GEN_CHIP[l.status];
    return `<label class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-ink-700">
      <input type="checkbox" data-gen-note="${esc(l.id)}" ${G.selected.has(l.id) ? "checked" : ""} class="h-4 w-4 shrink-0 accent-brand-500" />
      <span class="w-14 shrink-0 text-xs font-extrabold ${palette(l.course).text}">${esc(fmtDate(l.date))}</span>
      <span class="min-w-0 flex-1 truncate text-sm font-bold">${esc(l.title)}${state.course === "all" ? ` <span class="font-mono text-[10px] font-semibold text-slate-400">${esc(l.course)}</span>` : ""}</span>
      <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${cls}">${l.status === "generated" ? C.have(l.cards) : label}</span></label>`;
  }).join("");
  const n = picked.length;
  const tooMany = n > p.maxPerJob;
  const blocked = p.paused || p.running || !n || tooMany;
  const calls = n * C.callsPer;
  const note = p.paused ? `<span class="text-amber-700 dark:text-sun">⏸ AI is paused. Resume it in the sidebar to generate.</span>`
    : p.running ? `<span class="text-amber-700 dark:text-sun">Another generation job is running. Wait for it to finish.</span>`
    : tooMany ? `<span class="text-red-600 dark:text-red-400">Pick ${p.maxPerJob} lectures or fewer at a time.</span>`
    : n ? `About <b>${plural(calls, "Claude call")}</b>${C.callsPer > 1 ? ": a write and a double-check for each lecture" : ", one per lecture"}. That's like asking ${plural(calls, "question")} in chat.` : "Pick at least one lecture.";
  return `<div class="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
    <div class="flex items-center justify-between gap-3"><div class="font-extrabold">${C.icon} ${C.title} · ${esc(courseName(state.course))}</div>
      <button data-gen-close class="rounded-lg px-2 text-xl leading-none text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-700" aria-label="Close">×</button></div>
    <div class="mt-3 flex flex-wrap items-center gap-2"><span class="text-xs font-extrabold uppercase tracking-wider text-slate-400">${C.per}</span>${dens}</div>
    <input id="genFocus" value="${esc(G.focus)}" maxlength="200" placeholder="Focus (optional), e.g. only formulas, or just definitions" class="mt-3 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" />
    <div class="mt-4 flex items-center justify-between text-xs"><span class="font-extrabold uppercase tracking-wider text-slate-400">Lectures</span>
      <span class="flex gap-3 font-bold text-brand-600 dark:text-brand-300"><button data-gen-pick="new">New only</button><button data-gen-pick="all">All</button><button data-gen-pick="none">None</button></span></div>
    <div class="mt-1 max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-100 dark:ring-ink-700">${rows || '<div class="p-4 text-sm text-slate-400">No lectures in this class yet.</div>'}</div>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3"><div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${note}</div>
      <button id="genGo" ${blocked ? "disabled" : ""} class="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-95 disabled:opacity-50">${n ? `Generate for ${plural(n, "lecture")} →` : "Generate"}</button></div>
    ${G.error ? `<div class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">${esc(G.error)}</div>` : ""}
  </div>`;
}

export function genJobHtml(job, kind = gk()) {
  const C = GEN_CFG[kind];
  const done = genJobDone(job);
  const settled = job.items.filter((i) => ["done", "error", "skipped"].includes(i.state)).length;
  const pct = job.items.length ? Math.round((100 * settled) / job.items.length) : 0;
  const t = job.totals;
  const rows = job.items.map((i) => `<div class="flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm">
      <span class="w-5 shrink-0 text-center ${i.state === "running" ? "animate-pulse" : ""}">${GEN_STATE_ICON[i.state]}</span>
      <span class="w-14 shrink-0 text-xs font-extrabold ${palette(i.course).text}">${esc(fmtDate(i.date))}</span>
      <span class="min-w-0 flex-1 truncate font-bold">${esc(i.title)}</span>
      <span class="shrink-0 text-xs font-extrabold ${i.state === "error" ? "text-red-600 dark:text-red-400" : i.state === "done" ? "text-emerald-600 dark:text-emerald-300" : "text-slate-400"}">${i.state === "done" ? `+${i.created} · ${Math.max(1, Math.round((i.finishedAt - i.startedAt) / 1000))}s` : i.state === "error" ? "failed" : i.state === "running" ? `${C.working} ${Math.round((Date.now() - i.startedAt) / 1000)}s` : i.state === "skipped" ? "skipped" : "waiting"}</span></div>
      ${i.error ? `<div class="mx-3 mb-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">${esc(i.error)}</div>` : ""}`).join("");
  const dropped = job.items.flatMap((i) => i.dropped.map((d) => ({ ...d, title: i.title })));
  const droppedHtml = dropped.length
    ? `<details class="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs dark:bg-ink-700"><summary class="cursor-pointer font-extrabold">${plural(dropped.length, C.one)} didn't pass the checks and ${dropped.length === 1 ? "was" : "were"} not saved</summary>
        <ul class="mt-2 space-y-1.5 font-medium text-slate-600 dark:text-slate-300">${dropped.map((d) => `<li><span class="font-bold">${esc(d.front)}</span><br><span class="text-slate-400">${esc(d.title)} · ${esc(d.why)}</span></li>`).join("")}</ul></details>`
    : "";
  const head = !done ? `${C.headBusy} ${settled} of ${job.items.length} lectures` : job.status === "cancelled" ? "Stopped" : job.stoppedBecause ? (t.created ? `Added ${plural(t.created, "new " + C.one)}, then stopped` : "Stopped before anything was made") : t.created ? `🎉 Added ${plural(t.created, "new " + C.one)}` : "Nothing new to add";
  const sub = done
    ? `${plural(job.items.filter((i) => i.state === "done").length, "lecture")} processed · ${t.duplicates} duplicate${t.duplicates === 1 ? "" : "s"} skipped · ${t.dropped} dropped · ${plural(t.calls, "Claude call")}`
    : `${plural(t.created, C.one)} so far · ${plural(t.calls, "Claude call")}`;
  return `<div class="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
    <div class="flex items-start justify-between gap-3"><div><div class="text-lg font-extrabold">${head}</div><div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${sub}</div></div>
      ${done ? "" : `<button id="genCancel" class="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Cancel</button>`}</div>
    <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full bg-brand-500 transition-all" style="width:${done ? 100 : pct}%"></div></div>
    ${job.stoppedBecause ? `<div class="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" role="status"><div class="font-extrabold">Stopped early: the lectures marked skipped were not tried.</div><div class="mt-1 text-xs font-medium">${esc(job.stoppedBecause)} Run it again later and only the lectures that are still missing will be done.</div></div>` : ""}
    <div class="mt-3 max-h-64 overflow-y-auto">${rows}</div>${droppedHtml}
    ${done ? `<div class="mt-4 flex gap-3">${t.created ? `<button id="genStudy" class="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-600">${C.doneBtn}</button>` : ""}
      <button id="genDismiss" class="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Done</button></div>` : ""}
  </div>`;
}

/** Redraw the panel, but only if it is the one on screen (a job can finish while you are on the other tab). */
export function updateGenPanel(kind = gk()) {
  if (kind !== gk()) return;
  const el = $("genPanel");
  if (el) el.innerHTML = genPanelHtml(kind);
}

export async function startGeneration(kind = gk()) {
  const C = GEN_CFG[kind];
  const G = C.st();
  G.error = "";
  const res = await fetch(C.base, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ course: state.course, noteIds: [...G.selected], density: G.density, focus: G.focus }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { G.error = d.error || "Couldn't start that."; return updateGenPanel(kind); }
  G.job = d;
  updateGenPanel(kind);
  pollGeneration(kind);
}

export async function pollGeneration(kind) {
  const C = GEN_CFG[kind];
  const G = C.st();
  if (G.polling) return;
  G.polling = true;
  try {
    for (;;) {
      const r = await fetch(`${C.base}/status`).then((x) => x.json());
      if (r.job) G.job = r.job;
      updateGenPanel(kind);
      if (!r.running) break;
      await new Promise((ok) => setTimeout(ok, 1100));
    }
  } catch {}
  G.polling = false;
  noteCache.clear();
  await Promise.all([loadStudyToday(), refreshAi()]);
}

/** After a reload or a tab switch: pick up a job that is still running on the server. */
/** True if this job's report was already shown after a restart (remembered in this browser). Marks it as shown. */
export function genReportSeen(id) {
  try {
    const seen = JSON.parse(localStorage.getItem("gen-reports-seen") || "[]");
    if (seen.includes(id)) return true;
    localStorage.setItem("gen-reports-seen", JSON.stringify([...seen, id].slice(-30)));
  } catch {}
  return false;
}

export async function resumeGeneration() {
  for (const kind of ["cards", "quiz", "problems"]) {
    const C = GEN_CFG[kind];
    if (C.st().polling) continue;
    try {
      const r = await fetch(`${C.base}/status`).then((x) => x.json());
      if (r.running && r.job) { C.st().job = r.job; updateGenPanel(kind); pollGeneration(kind); }
      // A job that was cut off by a restart: show its report once, so you know what finished and what didn't.
      else if (r.job && r.job.status === "interrupted" && !genReportSeen(r.job.id)) { C.st().job = r.job; updateGenPanel(kind); }
    } catch {}
  }
}

export async function cancelGeneration(kind = gk()) {
  await fetch(`${GEN_CFG[kind].base}/cancel`, { method: "POST" });
}

export function dismissGeneration(kind = gk()) {
  Object.assign(GEN_CFG[kind].st(), { job: null, open: false, error: "" });
  updateGenPanel(kind);
}
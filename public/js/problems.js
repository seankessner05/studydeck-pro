import { $, S, api, btnGhost, btnPrimary, courseName, esc, fmtNum, fmtUnit, loadingHtml, palette, panelCls, state, toneOf } from "./core.js";
import { refreshState, setView } from "./shell.js";
import { loadStudyToday, renderStudy, statTile } from "./cards.js";
import { genPanelHtml, resumeGeneration } from "./generate.js";
import { subSwitch } from "./quiz.js";
import { goSub, renderStudyMore } from "./studyhub.js";

// =============================================================== practice problems
export const PRB = { mode: "home", home: null, length: 5, error: "", runId: "", queue: [], idx: 0, input: "", hintShown: false, hinted: false, result: null, busy: false, qT0: 0, summary: null };
export const DIFF = { 1: "●○○ Easy", 2: "●●○ Medium", 3: "●●● Hard" };

export async function loadProblemsHome() {
  const r = await api(`/api/study/problems/home?course=${encodeURIComponent(state.course)}`);
  if (!r.ok) return;
  PRB.home = r.data;
  if (state.view === "study" && S.sub === "problems" && PRB.mode === "home") renderProblemsHome();
  resumeGeneration();
}

export function renderProblemsHome() {
  const h = PRB.home;
  if (!h) { $("studyBody").innerHTML = `<div class="space-y-5">${subSwitch()}${loadingHtml}</div>`; return; }
  const total = h.counts.total;
  const len = Math.min(PRB.length, Math.max(1, total));
  const lens = [3, 5, 10].map((n) => `<button data-pr-len="${n}" class="rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${PRB.length === n ? "bg-white text-orange-700 shadow-card" : "bg-white/20 text-white hover:bg-white/30"}">${n}</button>`).join("");
  const list = h.problems.slice(0, 60).map((p) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-ink-700">
      <span class="w-20 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-[10px] font-extrabold text-slate-500 dark:bg-ink-700 dark:text-slate-300">${DIFF[p.difficulty]}</span>
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">${esc(p.stem)}</div><div class="truncate text-xs text-slate-400">${esc(p.section || "")}${state.course === "all" ? ` · ${esc(p.course)}` : ""}</div></div>
      ${p.asked ? `<span class="shrink-0 text-xs font-extrabold ${p.right === p.asked ? "text-emerald-600 dark:text-emerald-300" : p.right === 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-sun"}">${p.right}/${p.asked}</span>` : ""}
      <button data-del-p="${esc(p.id)}" class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Move to trash (you can undo)" aria-label="Move to trash: problem">×</button></div>`).join("");
  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-6 text-white shadow-pop md:p-8">
      <div class="absolute -top-8 -right-8 text-[9rem] leading-none opacity-10">🧮</div>
      <div class="flex items-start justify-between gap-3"><div class="text-sm font-extrabold opacity-80">Practice problems · ${esc(courseName(state.course))}</div><div class="rounded-full bg-white/20 px-3 py-1 text-xs font-extrabold">🔥 ${h.streak}-day streak</div></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-6xl font-extrabold tabular-nums">${total}</span><span class="text-lg font-bold opacity-80">${total === 1 ? "problem" : "problems"} ready</span></div>
      <div class="mt-1 text-sm font-semibold opacity-80">${total ? "Numbers you work out yourself. The app checks them: every answer is computed, not guessed." : "Make some from your lectures below."}</div>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button id="startPractice" ${total ? "" : "disabled"} class="rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-orange-700 shadow-card transition hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:hover:translate-y-0">${total ? `Start ${len} ${len === 1 ? "problem" : "problems"} →` : "No problems yet"}</button>
        <div class="flex items-center gap-1.5"><span class="text-xs font-extrabold opacity-80">Length</span>${lens}</div></div>
      ${PRB.error ? `<div class="mt-3 rounded-xl bg-white/20 px-3 py-2 text-xs font-bold">${esc(PRB.error)}</div>` : ""}
    </div>
    <div class="grid grid-cols-3 gap-3">${statTile("In your bank", total, "text-slate-700 dark:text-slate-200")}${statTile("Tried", h.counts.seen, "text-emerald-600 dark:text-emerald-300")}${statTile("Right first try, 7 days", h.accuracy.answers ? h.accuracy.pct + "%" : "–", "text-brand-600 dark:text-brand-300")}</div>
    <div id="genPanel">${genPanelHtml("problems")}</div>
    ${list ? `<details class="${panelCls} !p-3"><summary class="cursor-pointer px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">Your problems (${total})</summary>${list}</details>` : ""}
  </div>`;
}

export async function startPractice(noteIds) {
  const r = await api("/api/study/problems/start", "POST", { course: state.course, length: PRB.length, noteIds: Array.isArray(noteIds) ? noteIds : undefined });
  if (!r.ok) { PRB.error = r.data.error || "Couldn't start."; if (S.sub !== "problems") await goSub("problems"); return renderStudyMore(); }
  PRB.error = "";
  Object.assign(PRB, { mode: "play", runId: r.data.runId, queue: r.data.problems, idx: 0, input: "", hintShown: false, hinted: false, result: null, busy: false, qT0: Date.now(), summary: null });
  S.sub = "problems";
  setView("study");
  renderStudy();
}

export function exitPractice() {
  PRB.mode = "home";
  PRB.result = null;
  Promise.all([loadProblemsHome(), loadStudyToday(), refreshState()]);
  renderStudy();
}

export function renderProblemPlay() {
  const p = PRB.queue[PRB.idx];
  if (!p) return finishPracticeRun();
  const r = PRB.result;
  const total = PRB.queue.length;
  const pct = Math.round((100 * PRB.idx) / total);
  const steps = r ? `<div class="overflow-x-auto rounded-2xl ring-1 ring-slate-200 dark:ring-ink-600"><table class="w-full text-left text-sm">
      <thead class="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:bg-ink-700"><tr><th class="px-3 py-2">Step</th><th class="px-3 py-2">Calculation</th><th class="px-3 py-2 text-right">Result</th></tr></thead>
      <tbody>${r.steps.map((s, i) => `<tr class="border-t border-slate-100 dark:border-ink-700"><td class="px-3 py-2 align-top"><div class="font-bold">${i + 1}. ${esc(s.label)}</div><div class="text-xs text-slate-500 dark:text-slate-400">${esc(s.explain)}</div></td>
        <td class="px-3 py-2 align-top font-mono text-xs text-slate-600 dark:text-slate-300">${esc(s.expr)}</td><td class="px-3 py-2 text-right align-top font-extrabold tabular-nums">${fmtNum(s.value)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const feedback = r ? `<div class="fade-in space-y-3">
      <div class="rounded-2xl px-4 py-3 ${r.correct ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200"}">
        <div class="text-base font-extrabold">${r.correct ? (r.attempt > 1 ? "Got it this time 💪" : PRB.hinted ? "Correct, with a hint" : "Correct! 🎉") : r.gaveUp ? "Here's how it works" : "Not quite"}</div>
        <div class="mt-1 text-sm font-medium">The answer is <b>${esc(fmtUnit(r.answer, r.unit))}</b>.${!r.correct && r.off !== null ? ` You were off by ${Math.round(r.off * 100)}%.` : ""} The app computed every step below itself.</div></div>
      ${steps}
      ${r.quote ? `<div class="rounded-2xl bg-sun/20 px-4 py-3 text-left text-xs leading-relaxed text-amber-900 dark:text-sun"><div class="mb-1 text-[10px] font-extrabold uppercase tracking-wider opacity-70">The formula, from your notes</div>“${esc(r.quote)}”
        ${r.noteId ? `<button data-open-note="${esc(r.noteId)}" data-quote="${esc(r.quote)}" class="mt-1.5 block font-extrabold underline">Open the note →</button>` : ""}</div>` : ""}
      <button id="nextP" class="w-full rounded-2xl bg-brand-500 py-4 text-base font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-[0.99]">${PRB.idx + 1 >= PRB.queue.length ? "Finish" : "Next problem"} <span class="ml-1 text-xs font-bold opacity-70">(Enter)</span></button></div>` : "";
  $("studyBody").innerHTML = `<div class="mx-auto max-w-2xl space-y-4">
    <div class="flex items-center gap-3"><button id="exitPractice" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-700">← Back</button>
      <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-ink-700"><div class="h-full rounded-full bg-orange-500 transition-all" style="width:${pct}%"></div></div>
      <span class="text-xs font-extrabold tabular-nums text-slate-400">${PRB.idx + 1} / ${total}</span></div>
    <div class="${panelCls} !p-6 md:!p-8 !shadow-pop">
      <div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400"><span class="rounded-full px-2 py-0.5 ${palette(p.course).tile} ${palette(p.course).text}">${esc(p.course)}</span>${DIFF[p.difficulty]}${p.again ? '<span class="rounded-full bg-sun/30 px-2 py-0.5 text-amber-800 dark:text-sun">Second try</span>' : ""}</div>
      <div class="text-lg leading-relaxed font-bold md:text-xl">${esc(p.stem)}</div></div>
    ${!r ? `<div class="space-y-3">
      ${PRB.hintShown ? `<div class="rounded-2xl bg-brand-50 px-4 py-3 text-sm dark:bg-brand-500/10"><div class="text-[10px] font-extrabold uppercase tracking-wider text-brand-600 dark:text-brand-300">Hint · your first step</div><b>${esc(p.hint.label)}.</b> ${esc(p.hint.explain)}</div>`
        : `<button id="hintBtn" class="${btnGhost}">💡 Show a hint <span class="text-xs font-semibold text-slate-400">(counts as help)</span></button>`}
      <div class="flex items-center gap-2"><div class="relative flex-1"><input id="problemInput" value="${esc(PRB.input)}" inputmode="decimal" autocomplete="off" placeholder="Your answer${p.unit ? ` (${esc(p.unit)})` : ""}" class="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3.5 text-lg font-extrabold tabular-nums focus:border-brand-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800" /></div>
        <button id="checkProblem" class="${btnPrimary} !py-3.5">Check</button></div>
      ${PRB.error ? `<div class="text-xs font-semibold text-red-600 dark:text-red-400">${esc(PRB.error)}</div>` : ""}
      <button id="giveUp" class="text-xs font-bold text-slate-400 underline hover:text-slate-600">I'm stuck: show me the solution</button></div>` : ""}
    ${feedback}
    <div class="text-center text-[11px] font-semibold text-slate-400">${r ? "Missed problems come back at the end of this set, and first next time." : "Type a number (a $ or % sign is fine). Within 1% counts as right. Esc to leave."}</div>
  </div>`;
  if (!r) { const el = $("problemInput"); if (el && document.activeElement !== el) el.focus(); }
}

export async function submitProblem(gaveUp = false) {
  const p = PRB.queue[PRB.idx];
  if (!p || PRB.result || PRB.busy) return;
  if (!gaveUp && !PRB.input.trim()) { PRB.error = "Type a number first."; return renderProblemPlay(); }
  PRB.busy = true;
  try {
    const r = await api("/api/study/problems/answer", "POST", { runId: PRB.runId, problemId: p.id, submitted: gaveUp ? null : PRB.input, gaveUp, hinted: PRB.hinted, msTaken: Date.now() - PRB.qT0 });
    if (!r.ok) { PRB.error = r.data.error || "Couldn't check that."; return renderProblemPlay(); }
    PRB.error = "";
    PRB.result = { ...r.data, gaveUp };
    if (r.data.attempt === 1 && !r.data.correct) PRB.queue.push({ ...p, again: true });
    renderProblemPlay();
  } finally {
    PRB.busy = false;
  }
}

export function nextProblem() {
  if (!PRB.result) return;
  PRB.idx++;
  Object.assign(PRB, { input: "", hintShown: false, hinted: false, result: null, error: "", qT0: Date.now() });
  if (PRB.idx >= PRB.queue.length) return finishPracticeRun();
  renderProblemPlay();
}

export async function finishPracticeRun() {
  const r = await api("/api/study/problems/finish", "POST", { runId: PRB.runId });
  PRB.summary = r.ok ? r.data : null;
  if (r.ok) state.streak = r.data.streak;
  PRB.mode = "done";
  await Promise.all([loadProblemsHome(), loadStudyToday(), refreshState()]);
  if (PRB.mode === "done") renderProblemsDone();
}

export function renderProblemsDone() {
  const s = PRB.summary;
  if (!s || !s.total) { $("studyBody").innerHTML = `<div class="${panelCls} mx-auto max-w-md text-center"><div class="text-5xl">🤷</div><h2 class="mt-3 text-2xl font-extrabold">Nothing attempted</h2><button id="exitPractice" class="${btnGhost} mt-5">Back to Study</button></div>`; return; }
  const verdict = s.pct >= 90 ? ["🏆", "Excellent!"] : s.pct >= 70 ? ["🎉", "Solid work!"] : s.pct >= 50 ? ["💪", "Getting there"] : ["🌱", "Good practice"];
  $("studyBody").innerHTML = `<div class="${panelCls} mx-auto max-w-lg text-center !p-8 !shadow-pop fade-in">
    <div class="text-6xl">${verdict[0]}</div><h2 class="mt-3 text-3xl font-extrabold tracking-tight">${verdict[1]}</h2>
    <p class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">${s.correct} of ${s.total} right on the first try${s.recovered ? `, and you fixed ${s.recovered} on the second` : ""}.</p>
    <div class="mt-6 grid grid-cols-3 gap-3">${statTile("First try", s.pct + "%", toneOf(s.pct))}${statTile("No hint", s.unaided, "text-brand-600 dark:text-brand-300")}${statTile("Time", Math.floor(s.seconds / 60) + ":" + String(s.seconds % 60).padStart(2, "0"), "text-slate-700 dark:text-slate-200")}</div>
    ${s.unaided < s.correct ? '<p class="mt-3 text-xs font-semibold text-slate-400">A problem solved after opening the hint counts as half in your progress.</p>' : ""}
    ${s.missed.length ? `<details class="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-left text-xs dark:bg-ink-700"><summary class="cursor-pointer font-extrabold">What you missed</summary><ul class="mt-2 list-disc space-y-1 pl-4 font-medium text-slate-600 dark:text-slate-300">${s.missed.map((m) => `<li>${esc(m.stem)}</li>`).join("")}</ul></details>` : ""}
    <div class="mt-6 flex justify-center gap-3"><button id="exitPractice" class="${btnGhost}">Back to Study</button><button id="startPractice" class="${btnPrimary}">Another set →</button></div></div>`;
}
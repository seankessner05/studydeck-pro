// ---- Study tab, part 2: practice problems, teach-back tutor, mock exams and cheat sheets, progress, Match game ----
// Loaded after app.js and shares its globals ($, esc, state, S, statTile, plural, palette, courseName, fmtDate, openSource, ...).

async function api(url, method = "GET", body) {
  try {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the StudyDeck server." } };
  }
}
const toneOf = (pct) => (pct >= 75 ? "text-emerald-600 dark:text-emerald-300" : pct >= 55 ? "text-amber-600 dark:text-sun" : "text-red-600 dark:text-red-400");
const barOf = (pct) => (pct >= 75 ? "bg-emerald-500" : pct >= 55 ? "bg-amber-500" : "bg-red-500");
const loadingHtml = `<div class="py-20 text-center text-slate-400"><span class="dots"><span></span><span></span><span></span></span></div>`;
const panelCls = "rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600";
const btnPrimary = "rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-95 disabled:opacity-50";
const btnGhost = "rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700";
const fmtNum = (v) => (Number.isFinite(v) ? Number(Number(v).toPrecision(8)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "–");
const fmtUnit = (v, unit) => (unit === "$" ? `${v < 0 ? "−" : ""}$${fmtNum(Math.abs(v))}` : unit === "%" ? `${fmtNum(v)}%` : unit ? `${fmtNum(v)} ${unit}` : fmtNum(v));
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const noteTitleOf = (id) => (state.notes.find((n) => n.id === id) || {}).title || "";

function studyMoreBusy() {
  return (S.sub === "problems" && PRB.mode === "play") || (S.sub === "exam" && ["take", "building"].includes(EXM.mode)) || (S.sub === "tutor" && TUT.mode === "chat");
}
function renderStudyMore() {
  if (S.sub === "problems") return PRB.mode === "play" ? renderProblemPlay() : PRB.mode === "done" ? renderProblemsDone() : renderProblemsHome();
  if (S.sub === "tutor") return renderTutor();
  if (S.sub === "exam") return renderExam();
  if (S.sub === "progress") return renderProgress();
}
async function loadStudyMore() {
  if (S.sub === "problems") return loadProblemsHome();
  if (S.sub === "tutor") return loadTutorHome();
  if (S.sub === "exam") return loadExamHome();
  if (S.sub === "progress") return loadProgress();
}
// On a phone the six tabs scroll sideways: keep the current one in view after every switch.
// (Screens redraw themselves as data arrives, so watch for any redraw rather than hooking one function.)
let centerQueued = false;
new MutationObserver(() => {
  if (centerQueued) return;
  centerQueued = true;
  requestAnimationFrame(() => {
    centerQueued = false;
    const row = document.querySelector("#studyBody [data-sub]")?.parentElement;
    const active = row && row.querySelector("[data-sub].bg-white");
    if (row && active && row.scrollWidth > row.clientWidth) row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
  });
}).observe($("studyBody"), { childList: true });

/** Jump to one of the study sub-screens from anywhere (the plan's buttons use this). */
async function goSub(sub, course) {
  if (course && course !== state.course) await selectCourse(course);
  S.sub = sub;
  setView("study");
  renderStudy();
  await loadStudyToday();
}

// =============================================================== practice problems
const PRB = { mode: "home", home: null, length: 5, error: "", runId: "", queue: [], idx: 0, input: "", hintShown: false, hinted: false, result: null, busy: false, qT0: 0, summary: null };
const DIFF = { 1: "●○○ Easy", 2: "●●○ Medium", 3: "●●● Hard" };

async function loadProblemsHome() {
  const r = await api(`/api/study/problems/home?course=${encodeURIComponent(state.course)}`);
  if (!r.ok) return;
  PRB.home = r.data;
  if (state.view === "study" && S.sub === "problems" && PRB.mode === "home") renderProblemsHome();
  resumeGeneration();
}

function renderProblemsHome() {
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

async function startPractice(noteIds) {
  const r = await api("/api/study/problems/start", "POST", { course: state.course, length: PRB.length, noteIds: Array.isArray(noteIds) ? noteIds : undefined });
  if (!r.ok) { PRB.error = r.data.error || "Couldn't start."; if (S.sub !== "problems") await goSub("problems"); return renderStudyMore(); }
  PRB.error = "";
  Object.assign(PRB, { mode: "play", runId: r.data.runId, queue: r.data.problems, idx: 0, input: "", hintShown: false, hinted: false, result: null, busy: false, qT0: Date.now(), summary: null });
  S.sub = "problems";
  setView("study");
  renderStudy();
}

function exitPractice() {
  PRB.mode = "home";
  PRB.result = null;
  Promise.all([loadProblemsHome(), loadStudyToday(), refreshState()]);
  renderStudy();
}

function renderProblemPlay() {
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

async function submitProblem(gaveUp = false) {
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

function nextProblem() {
  if (!PRB.result) return;
  PRB.idx++;
  Object.assign(PRB, { input: "", hintShown: false, hinted: false, result: null, error: "", qT0: Date.now() });
  if (PRB.idx >= PRB.queue.length) return finishPracticeRun();
  renderProblemPlay();
}

async function finishPracticeRun() {
  const r = await api("/api/study/problems/finish", "POST", { runId: PRB.runId });
  PRB.summary = r.ok ? r.data : null;
  if (r.ok) state.streak = r.data.streak;
  PRB.mode = "done";
  await Promise.all([loadProblemsHome(), loadStudyToday(), refreshState()]);
  if (PRB.mode === "done") renderProblemsDone();
}

function renderProblemsDone() {
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

// =============================================================== teach-back tutor
const TUT = { mode: "home", pick: null, topics: [], showAll: false, session: null, input: "", busy: false, error: "", history: [], progress: null, summary: null, score: null, done: false, round: 0 };

async function loadTutorHome() {
  const r = await api(`/api/study/tutor/history?course=${encodeURIComponent(state.course)}`);
  TUT.history = r.ok ? r.data : [];
  if (state.view === "study" && S.sub === "tutor" && TUT.mode === "home") renderTutor();
}

function renderTutor() {
  if (TUT.mode === "chat") return renderTutorChat();
  const lectures = [...state.notes].filter((n) => n.course !== "unsorted").sort((a, b) => b.date.localeCompare(a.date));
  const shown = TUT.showAll ? lectures : lectures.slice(0, 8);
  const rows = shown.map((n) => `<button data-tut-pick="${esc(n.id)}" class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${TUT.pick === n.id ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-500/15" : "hover:bg-slate-50 dark:hover:bg-ink-700"}">
      <span class="w-14 shrink-0 text-xs font-extrabold ${palette(n.course).text}">${esc(fmtDate(n.date))}</span><span class="min-w-0 flex-1 truncate text-sm font-bold">${esc(n.title)}</span>${state.course === "all" ? `<span class="font-mono text-[10px] font-semibold text-slate-400">${esc(n.course)}</span>` : ""}</button>`).join("");
  const topics = TUT.pick ? `<div class="mt-4"><div class="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">What will you explain?</div>
      <div class="flex flex-wrap gap-2">${TUT.topics.map((t, i) => `<button data-tut-topic="${i}" class="rounded-full px-3 py-1.5 text-xs font-extrabold transition ${TUT.topicIdx === i ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-300"}">${i === 0 ? "The whole lecture" : esc(t.topic)}</button>`).join("")}</div>
      <button id="tutStart" ${TUT.topicIdx === undefined ? "disabled" : ""} class="${btnPrimary} mt-4">Start explaining →</button></div>` : "";
  const hist = TUT.history.length ? `<div class="${panelCls}"><div class="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">Your teach-backs</div>${TUT.history.map((h) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2 text-sm"><span class="min-w-0 flex-1 truncate"><b>${esc(h.topic)}</b> <span class="text-xs text-slate-400">${esc(h.lecture)}</span></span>${h.finishedAt ? `<span class="shrink-0 text-xs font-extrabold ${toneOf(Math.round((h.score ?? 0) * 100))}">${h.score === null ? "–" : Math.round(h.score * 100) + "%"}${h.gaps ? ` · ${plural(h.gaps, "gap")}` : ""}</span>` : '<span class="shrink-0 text-xs font-semibold text-slate-400">unfinished</span>'}</div>`).join("")}</div>` : "";
  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-500 via-brand-600 to-sky-500 p-6 text-white shadow-pop md:p-8">
      <div class="absolute -top-8 -right-8 text-[9rem] leading-none opacity-10">🗣️</div>
      <div class="text-sm font-extrabold opacity-80">Teach it back · ${esc(courseName(state.course))}</div>
      <h2 class="mt-2 text-3xl font-extrabold tracking-tight">Explain it first. Find the gap.</h2>
      <p class="mt-2 max-w-xl text-sm font-semibold opacity-90">You explain a topic in your own words, notes closed. The tutor checks what you got across against your lecture, asks one question at a time, and never hands you the answer. About ${MAX_TUTOR_ROUNDS} short rounds.</p></div>
    <div class="${panelCls}"><div class="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">Pick a lecture</div>
      ${rows || '<div class="p-4 text-sm text-slate-400">No lectures in this class yet.</div>'}
      ${lectures.length > 8 ? `<button data-tut-all class="mt-1 px-3 py-1 text-xs font-bold text-brand-600 dark:text-brand-300">${TUT.showAll ? "Show fewer" : `Show all ${lectures.length}`}</button>` : ""}
      ${topics}${TUT.error ? `<div class="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">${esc(TUT.error)}</div>` : ""}</div>
    ${hist}</div>`;
}
const MAX_TUTOR_ROUNDS = 3;

async function pickTutorLecture(id) {
  TUT.pick = id;
  TUT.topicIdx = undefined;
  TUT.topics = [];
  TUT.error = "";
  renderTutor();
  const r = await api(`/api/study/tutor/topics?noteId=${encodeURIComponent(id)}`);
  if (r.ok) { TUT.topics = r.data; TUT.topicIdx = 0; }
  else TUT.error = r.data.error || "Couldn't read that lecture.";
  renderTutor();
}

async function startTutorSession() {
  const t = TUT.topics[TUT.topicIdx];
  if (!t) return;
  const r = await api("/api/study/tutor/start", "POST", { noteId: TUT.pick, topic: t.topic });
  if (!r.ok) { TUT.error = r.data.error || "Couldn't start."; return renderTutor(); }
  Object.assign(TUT, { mode: "chat", session: r.data, input: "", busy: false, error: "", progress: null, summary: null, score: null, done: false, round: 0 });
  renderTutor();
}

function renderTutorChat() {
  const t = TUT.session;
  const bubbles = t.transcript.map((m) => `<div class="flex ${m.role === "student" ? "justify-end" : "justify-start"}"><div class="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "student" ? "bg-brand-500 text-white" : "bg-white shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600"}">${esc(m.text)}</div></div>`).join("");
  const sum = TUT.summary;
  const summary = sum ? `<div class="${panelCls} fade-in space-y-4 !p-6">
      <div class="flex items-center justify-between"><div class="text-lg font-extrabold">How it went</div>${TUT.score !== null ? `<div class="text-3xl font-extrabold tabular-nums ${toneOf(Math.round(TUT.score * 100))}">${Math.round(TUT.score * 100)}%</div>` : ""}</div>
      ${sum.got.length ? `<div><div class="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-300">You got across</div><ul class="space-y-1.5">${sum.got.map((g) => `<li class="text-sm"><b>${esc(g.idea)}</b><br><span class="text-xs text-slate-400">your words: “${esc(g.evidence)}”</span></li>`).join("")}</ul></div>` : ""}
      ${sum.gaps.length ? `<div><div class="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400">Still missing</div><ul class="space-y-2">${sum.gaps.map((g) => `<li class="rounded-xl bg-sun/20 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-sun"><b class="text-sm">${esc(g.idea)}</b><br>From your notes: “${esc(g.quote)}” <button data-open-note="${esc(t.noteId)}" data-quote="${esc(g.quote)}" class="font-extrabold underline">Open →</button></li>`).join("")}</ul></div>` : ""}
      <div class="rounded-xl bg-brand-50 px-3 py-2 text-sm dark:bg-brand-500/10"><b>Next:</b> ${esc(sum.next)}</div>
      <div class="flex flex-wrap gap-3"><button id="tutAgain" class="${btnPrimary}">Explain another topic</button><button data-tut-quiz class="${btnGhost}">Quiz me on this lecture</button><button id="tutLeave" class="${btnGhost}">Done</button></div></div>` : "";
  $("studyBody").innerHTML = `<div class="mx-auto max-w-2xl space-y-4">
    <div class="flex items-center gap-3"><button id="tutLeave" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-700">← Back</button>
      <div class="min-w-0 flex-1 truncate text-sm font-extrabold">${esc(t.topic)}</div>
      ${TUT.progress ? `<span class="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">${TUT.progress.covered} of ${TUT.progress.total} ideas across</span>` : ""}
      <span class="shrink-0 text-xs font-extrabold text-slate-400">Round ${Math.min(TUT.round + (TUT.done ? 0 : 1), MAX_TUTOR_ROUNDS)} of ${MAX_TUTOR_ROUNDS}</span></div>
    <div class="space-y-3">${bubbles}${TUT.busy ? `<div class="flex justify-start"><div class="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-500 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600"><span class="dots"><span></span><span></span><span></span></span>Checking against your lecture…</div></div>` : ""}</div>
    ${summary}
    ${!TUT.done ? `<div class="space-y-2"><textarea id="tutInput" rows="5" placeholder="Explain it in your own words…" class="w-full rounded-2xl border-2 border-slate-200 bg-white p-4 text-sm leading-relaxed focus:border-brand-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800" ${TUT.busy ? "disabled" : ""}>${esc(TUT.input)}</textarea>
      <div class="flex items-center justify-between gap-3"><span class="text-xs font-semibold ${TUT.error ? "text-red-600 dark:text-red-400" : "text-slate-400"}">${TUT.error ? esc(TUT.error) : "⌘/Ctrl + Enter to send. A sentence or two is the minimum."}</span><button id="tutSend" ${TUT.busy ? "disabled" : ""} class="${btnPrimary}">Send</button></div></div>` : ""}
  </div>`;
  const el = $("tutInput");
  if (el && !TUT.busy) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  window.scrollTo?.(0, 0);
  const view = $("studyView"); if (view) view.scrollTop = view.scrollHeight;
}

async function sendTutor() {
  if (TUT.busy || TUT.done) return;
  const text = TUT.input.trim();
  if (text.length < 15) { TUT.error = "Write a bit more: a sentence or two at least."; return renderTutorChat(); }
  TUT.busy = true;
  TUT.error = "";
  TUT.session.transcript = [...TUT.session.transcript, { role: "student", text }];
  TUT.input = "";
  renderTutorChat();
  const r = await api(`/api/study/tutor/${TUT.session.id}/turn`, "POST", { text });
  TUT.busy = false;
  if (!r.ok) {
    TUT.session.transcript = TUT.session.transcript.slice(0, -1);
    TUT.input = text;
    TUT.error = r.data.error || "The tutor couldn't answer.";
    return renderTutorChat();
  }
  const d = r.data;
  TUT.session.transcript = [...TUT.session.transcript, { role: "tutor", text: d.message }];
  Object.assign(TUT, { progress: d.progress, round: d.round, done: d.done, summary: d.summary, score: d.score });
  if (d.done) { state.streak = d.streak; loadTutorHome(); refreshAi(); }
  refreshAi();
  renderTutorChat();
}

// =============================================================== exams and cheat sheets
const EXM = { mode: "home", exams: [], history: [], sheets: [], form: { open: false, error: "", course: "", name: "Exam 2", date: "", from: "", to: "" }, preset: "standard", sitting: null, answers: {}, remaining: 0, timer: null, results: null, grading: false, error: "", warnings: [], sheet: null, busy: false, remarkFor: null, remarkText: "", remarkMsg: "" };
const PRESET_INFO = { quick: ["Quick check", "6 multiple choice + 1 problem", "about 15 min"], standard: ["Standard", "12 multiple choice + 3 problems + 2 written", "about 45–60 min"], full: ["Full length", "20 multiple choice + 4 problems + 3 written", "about 75–90 min"] };

async function loadExamHome() {
  const c = encodeURIComponent(state.course);
  const [e, h, s] = await Promise.all([api(`/api/study/exams?course=${c}`), api(`/api/study/exam/history?course=${c}`), api(`/api/study/sheets?course=${c}`)]);
  EXM.exams = e.ok ? e.data : [];
  EXM.history = h.ok ? h.data : [];
  EXM.sheets = s.ok ? s.data : [];
  if (state.view === "study" && S.sub === "exam" && EXM.mode === "home") renderExam();
}

function renderExam() {
  if (EXM.mode === "building") return renderExamBuilding();
  if (EXM.mode === "take") return renderExamTake();
  if (EXM.mode === "results") return renderExamResults();
  if (EXM.mode === "sheet") return renderSheet();
  return renderExamHome();
}

function dayChip(d) {
  const cls = d <= 1 ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : d <= 4 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-sun" : "bg-slate-100 text-slate-600 dark:bg-ink-700 dark:text-slate-300";
  return `<span class="rounded-full px-2.5 py-0.5 text-xs font-extrabold ${cls}">${d === 0 ? "Today" : d === 1 ? "Tomorrow" : `in ${d} days`}</span>`;
}

function renderExamHome() {
  const f = EXM.form;
  const picker = state.course === "all" ? `<select data-ex-form="course" class="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm font-semibold dark:border-ink-600 dark:bg-ink-800">${state.courses.filter((c) => !c.archived && c.id !== "unsorted").map((c) => `<option value="${esc(c.id)}" ${f.course === c.id ? "selected" : ""}>${esc(c.id)} · ${esc(c.name)}</option>`).join("")}</select>` : "";
  const form = f.open ? `<form id="examForm" class="${panelCls} space-y-3"><div class="flex items-center justify-between"><div class="font-extrabold">Add an exam</div><button type="button" data-ex-close class="rounded-lg px-2 text-xl leading-none text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-700">×</button></div>
      ${picker}
      <input data-ex-form="name" value="${esc(f.name)}" maxlength="80" placeholder="Name, like Exam 2" class="w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" />
      <div class="grid gap-3 sm:grid-cols-3"><label class="text-xs font-bold text-slate-500">Exam day<input data-ex-form="date" type="date" value="${esc(f.date)}" class="mt-1 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" /></label>
        <label class="text-xs font-bold text-slate-500">Covers lectures from<input data-ex-form="from" type="date" value="${esc(f.from)}" class="mt-1 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" /></label>
        <label class="text-xs font-bold text-slate-500">…through (optional)<input data-ex-form="to" type="date" value="${esc(f.to)}" class="mt-1 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" /></label></div>
      <div class="flex items-center justify-between"><span class="text-xs text-red-600 dark:text-red-400">${esc(f.error)}</span><button class="${btnPrimary}">Save exam</button></div></form>` : "";
  const sheetsFor = (id) => EXM.sheets.filter((s) => s.examId === id).slice(0, 4);
  const cards = EXM.exams.map((e) => `<div class="${panelCls} space-y-3">
      <div class="flex flex-wrap items-center gap-2"><span class="text-lg font-extrabold">${esc(e.name)}</span><span class="rounded-full px-2 py-0.5 text-[10px] font-extrabold ${palette(e.course).tile} ${palette(e.course).text}">${esc(e.course)}</span>${dayChip(e.daysLeft)}
        <button data-ex-del="${esc(e.id)}" class="ml-auto rounded-lg px-2 text-lg leading-none text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" aria-label="Remove exam">×</button></div>
      <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${new Date(e.dateMs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · covers ${plural(e.lectures, "lecture")} from ${esc(e.from)}${e.to ? ` through ${esc(e.to)}` : ""}</div>
      <div class="flex flex-wrap gap-2"><button data-ex-start="${esc(e.id)}" class="${btnPrimary}">🎯 Mock exam</button><button data-sheet-make="onepage" data-exam="${esc(e.id)}" class="${btnGhost}">📄 One-page cheat sheet</button><button data-sheet-make="guide" data-exam="${esc(e.id)}" class="${btnGhost}">📚 Study guide</button></div>
      ${sheetsFor(e.id).length ? `<div class="flex flex-wrap gap-2 text-xs">${sheetsFor(e.id).map((s) => `<button data-sheet-open="${esc(s.id)}" class="rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-600 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-300">${s.kind === "onepage" ? "Cheat sheet" : "Study guide"} v${s.version} · ${s.cards} cards</button>`).join("")}</div>` : ""}
    </div>`).join("");
  const presets = Object.entries(PRESET_INFO).map(([id, [label, what, mins]]) => `<button data-ex-preset="${id}" class="rounded-xl px-3 py-2 text-left text-xs transition ${EXM.preset === id ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-300"}"><div class="font-extrabold">${label}</div><div class="opacity-80">${what}</div><div class="opacity-60">${mins}</div></button>`).join("");
  const hist = EXM.history.map((h) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-ink-700"><span class="min-w-0 flex-1 truncate"><b>${esc(h.name)}</b> <span class="text-xs text-slate-400">${new Date(h.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></span>
      ${h.finishedAt ? `<span class="text-sm font-extrabold ${toneOf(h.pct ?? 0)}">${h.pct}%</span>${h.writtenPending ? '<span class="text-xs font-semibold text-amber-600 dark:text-sun">grading pending</span>' : ""}<button data-ex-review="${esc(h.id)}" class="text-xs font-extrabold text-brand-600 underline dark:text-brand-300">Review</button>` : `<button data-ex-review="${esc(h.id)}" class="text-xs font-extrabold text-brand-600 underline dark:text-brand-300">Resume</button>`}</div>`).join("");
  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 p-6 text-white shadow-pop md:p-8">
      <div class="absolute -top-8 -right-8 text-[9rem] leading-none opacity-10">🎯</div>
      <div class="text-sm font-extrabold opacity-80">Exam mode · ${esc(courseName(state.course))}</div>
      <h2 class="mt-2 text-3xl font-extrabold tracking-tight">${EXM.exams.length ? "Your next exams" : "Set up your next exam"}</h2>
      <p class="mt-2 max-w-xl text-sm font-semibold opacity-90">Timed mock exams from your own bank, plus a one-page cheat sheet and a full study guide built from your verified cards. Add the exam's date and which lectures it covers.</p>
      <button data-ex-open class="mt-4 rounded-2xl bg-white px-5 py-2.5 text-sm font-extrabold text-red-700 shadow-card transition hover:-translate-y-0.5 active:scale-95">+ Add an exam</button></div>
    ${form}
    ${EXM.exams.length ? `<div class="${panelCls} !p-4"><div class="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">Mock exam length</div><div class="grid gap-2 sm:grid-cols-3">${presets}</div></div>` : ""}
    ${EXM.error ? `<div class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">${esc(EXM.error)}</div>` : ""}
    ${cards}
    ${hist ? `<div class="${panelCls} !p-3"><div class="px-3 pt-2 pb-1 text-xs font-extrabold uppercase tracking-wider text-slate-400">Past mock exams</div>${hist}</div>` : ""}
  </div>`;
}

function dateInput(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function saveExamForm() {
  const f = EXM.form;
  const course = state.course === "all" ? (f.course || (state.courses.find((c) => !c.archived && c.id !== "unsorted") || {}).id) : state.course;
  const r = await api("/api/study/exams", "POST", { course, name: f.name, date: f.date, from: f.from, to: f.to || null });
  if (!r.ok) { f.error = r.data.error || "Couldn't save that."; return renderExamHome(); }
  Object.assign(f, { open: false, error: "", name: "Exam 2", date: "", from: "", to: "" });
  await loadExamHome();
}

async function startMockExam(examId) {
  EXM.error = "";
  EXM.mode = "building";
  renderExam();
  const r = await api("/api/study/exam/start", "POST", { examId, preset: EXM.preset });
  if (!r.ok) { EXM.mode = "home"; EXM.error = r.data.error || "Couldn't build the exam."; return renderExam(); }
  openSitting(r.data, r.data.warnings || []);
}

function openSitting(s, warnings = []) {
  EXM.sitting = s;
  EXM.warnings = warnings;
  EXM.mode = "take";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(`exam-answers-${s.id}`) || "{}"); } catch {}
  EXM.answers = saved;
  EXM.results = null;
  clearInterval(EXM.timer);
  const tick = () => {
    EXM.remaining = s.deadlineAt - Date.now();
    const el = $("examTimer");
    if (el) { el.textContent = mmss(EXM.remaining); el.classList.toggle("text-red-600", EXM.remaining < 5 * 60000); }
    if (EXM.remaining <= 0) { clearInterval(EXM.timer); submitExam(true); }
  };
  EXM.timer = setInterval(tick, 1000);
  tick();
  renderExam();
}

function renderExamBuilding() {
  $("studyBody").innerHTML = `<div class="mx-auto max-w-md py-20 text-center"><div class="text-6xl animate-pulse">📝</div><h2 class="mt-4 text-2xl font-extrabold">Building your exam…</h2>
    <p class="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Picking questions from every lecture it covers, and having Claude write the written questions from your notes. About 20 seconds.</p></div>`;
}

const examAnswered = (it) => {
  const a = EXM.answers[it.id];
  return Array.isArray(a) ? a.length > 0 : typeof a === "string" ? a.trim().length > 0 : false;
};

function examItemHtml(it, n) {
  const a = EXM.answers[it.id];
  const head = `<div class="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400"><span>Question ${n}</span><span>·</span><span>${it.points} ${it.points === 1 ? "point" : "points"}</span>${it.type === "mcq" ? `<span>· ${KIND_LABEL[it.kind]}</span>` : ""}</div>`;
  if (it.type === "mcq") {
    const picked = Array.isArray(a) ? a : [];
    return `${head}<div class="text-base leading-snug font-extrabold">${esc(it.stem)}</div><div class="mt-3 ${it.kind === "tf" ? "grid grid-cols-2" : "flex flex-col"} gap-2">${it.options.map((o, i) => `<button data-ex-opt="${esc(it.id)}:${i}" class="flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-bold transition ${picked.includes(i) ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15" : "border-slate-200 hover:border-brand-300 dark:border-ink-600"}">${it.kind === "tf" ? "" : `<span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold ${picked.includes(i) ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 dark:bg-ink-700"}">${LETTER[i]}</span>`}<span class="flex-1">${esc(o)}</span></button>`).join("")}</div>`;
  }
  if (it.type === "problem") return `${head}<div class="text-base leading-relaxed font-bold">${esc(it.stem)}</div><input data-ex-text="${esc(it.id)}" value="${esc(typeof a === "string" ? a : "")}" inputmode="decimal" autocomplete="off" placeholder="Your answer${it.unit ? ` (${esc(it.unit)})` : ""}" class="mt-3 w-full max-w-xs rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-base font-extrabold tabular-nums focus:border-brand-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800" />`;
  return `${head}<div class="text-base leading-relaxed font-bold">${esc(it.prompt)}</div><textarea data-ex-text="${esc(it.id)}" rows="6" placeholder="Answer in your own words…" class="mt-3 w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm leading-relaxed focus:border-brand-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800">${esc(typeof a === "string" ? a : "")}</textarea>`;
}

function renderExamTake() {
  const s = EXM.sitting;
  const groups = [["mcq", "Multiple choice"], ["problem", "Problems"], ["written", "Written answers"]];
  let n = 0;
  const sections = groups.map(([type, label]) => {
    const items = s.items.filter((i) => i.type === type);
    if (!items.length) return "";
    return `<div class="space-y-3"><div class="text-sm font-extrabold text-slate-500 dark:text-slate-400">${label}</div>${items.map((it) => { n++; return `<div id="ex-item-${esc(it.id)}" class="${panelCls}">${examItemHtml(it, n)}</div>`; }).join("")}</div>`;
  }).join("");
  const answered = s.items.filter(examAnswered).length;
  $("studyBody").innerHTML = `<div class="mx-auto max-w-2xl space-y-5">
    <div class="sticky top-0 z-10 -mx-1 flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 shadow-card ring-1 ring-slate-200/70 backdrop-blur dark:bg-ink-800/95 dark:ring-ink-600">
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-extrabold">${esc(s.name)}</div><div id="examProgress" class="text-xs font-semibold text-slate-400">${answered} of ${s.items.length} answered</div></div>
      <div id="examTimer" class="text-2xl font-extrabold tabular-nums">${mmss(EXM.remaining)}</div>
      <button id="examHandIn" class="${btnPrimary}">Hand in</button></div>
    ${EXM.warnings.length ? `<div class="rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900 dark:bg-sun/10 dark:text-sun">${EXM.warnings.map(esc).join("<br>")}</div>` : ""}
    ${sections}
    <div class="text-center"><button id="examHandIn2" class="${btnPrimary} !px-8 !py-3">Hand in the exam</button><div class="mt-2 text-[11px] font-semibold text-slate-400">Your answers are saved on this computer as you go. When time runs out the exam is handed in for you.</div></div></div>`;
}

function saveExamAnswers() {
  try { localStorage.setItem(`exam-answers-${EXM.sitting.id}`, JSON.stringify(EXM.answers)); } catch {}
  const el = $("examProgress");
  if (el) el.textContent = `${EXM.sitting.items.filter(examAnswered).length} of ${EXM.sitting.items.length} answered`;
}

function toggleExamOption(itemId, i) {
  const it = EXM.sitting.items.find((x) => x.id === itemId);
  if (!it) return;
  const cur = Array.isArray(EXM.answers[itemId]) ? EXM.answers[itemId] : [];
  EXM.answers[itemId] = it.kind === "multi" ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b)) : [i];
  const box = $(`ex-item-${itemId}`);
  if (box) box.innerHTML = examItemHtml(it, EXM.sitting.items.indexOf(it) + 1 - 0);
  // the question number in a section follows the list order across all sections
  const order = ["mcq", "problem", "written"].flatMap((t) => EXM.sitting.items.filter((x) => x.type === t));
  if (box) box.innerHTML = examItemHtml(it, order.indexOf(it) + 1);
  saveExamAnswers();
}

async function submitExam(auto = false) {
  if (EXM.busy) return;
  const s = EXM.sitting;
  if (!auto) {
    const blank = s.items.filter((i) => !examAnswered(i)).length;
    if (!confirm(blank ? `${plural(blank, "question")} still blank. Hand in anyway?` : "Hand in your exam?")) return;
  }
  EXM.busy = true;
  clearInterval(EXM.timer);
  $("studyBody").innerHTML = `<div class="mx-auto max-w-md py-20 text-center"><div class="text-6xl animate-pulse">✅</div><h2 class="mt-4 text-2xl font-extrabold">${auto ? "Time's up. " : ""}Handing in…</h2></div>`;
  const r = await api(`/api/study/exam/${s.id}/submit`, "POST", { answers: EXM.answers });
  EXM.busy = false;
  if (!r.ok) { EXM.mode = "take"; EXM.error = r.data.error || "Couldn't hand in."; alert(EXM.error); return renderExamTake(); }
  try { localStorage.removeItem(`exam-answers-${s.id}`); } catch {}
  EXM.results = r.data;
  EXM.mode = "results";
  EXM.remarkFor = null;
  renderExamResults();
  if (r.data.writtenPending) gradeWrittenNow();
  Promise.all([loadStudyToday(), refreshAi()]);
}

async function gradeWrittenNow() {
  EXM.grading = true;
  EXM.error = "";
  renderExamResults();
  const r = await api(`/api/study/exam/${EXM.results.id}/grade-written`, "POST");
  EXM.grading = false;
  if (r.ok) EXM.results = r.data;
  else EXM.error = r.data.error || "Couldn't grade the written answers.";
  renderExamResults();
  refreshAi();
}

async function reviewSitting(id) {
  const r = await api(`/api/study/exam/${id}`);
  if (!r.ok) { EXM.error = r.data.error || "Couldn't open that exam."; return renderExam(); }
  if (!r.data.finishedAt) { return openSitting({ ...r.data, deadlineAt: r.data.deadlineAt }, []); }
  EXM.results = r.data;
  EXM.mode = "results";
  EXM.remarkFor = null;
  renderExamResults();
}

function renderExamResults() {
  const s = EXM.results;
  const sum = s.summary;
  const byId = Object.fromEntries(s.results.map((r) => [r.id, r]));
  const order = ["mcq", "problem", "written"].flatMap((t) => s.items.filter((x) => x.type === t));
  const TYPE_LABEL = { mcq: "Multiple choice", problem: "Problems", written: "Written" };
  const review = order.map((it, i) => {
    const r = byId[it.id];
    const mark = it.type === "written" ? (r.graded ? `${r.earned}/${r.max}` : "…") : r.correct ? "✓" : r.answered ? "✗" : "–";
    const tone = it.type === "written" ? (r.graded ? toneOf(Math.round((100 * r.earned) / Math.max(1, r.max))) : "text-slate-400") : r.correct ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-400";
    let body = "";
    if (it.type === "mcq") {
      body = `<div class="mt-2 space-y-1">${it.options.map((o, k) => { const right = r.answer.includes(k); const picked = (r.picked || []).includes(k); return `<div class="flex gap-2 rounded-lg px-2 py-1 text-xs ${right ? "bg-emerald-50 font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : picked ? "bg-red-50 font-bold text-red-700 dark:bg-red-500/10 dark:text-red-300" : "text-slate-500"}"><span>${it.kind === "tf" ? "" : LETTER[k] + "."}</span><span class="flex-1">${esc(o)}</span><span>${right ? "✓" : picked ? "✗ your pick" : ""}</span></div>`; }).join("")}</div>
        <div class="mt-2 text-xs text-slate-600 dark:text-slate-300">${esc(r.explanation || "")}</div>${r.quote ? `<div class="mt-1 text-[11px] text-slate-400">From your notes: “${esc(r.quote)}” <button data-open-note="${esc(it.noteId || "")}" data-quote="${esc(r.quote)}" class="font-extrabold underline">Open →</button></div>` : ""}`;
    } else if (it.type === "problem") {
      body = `<div class="mt-2 text-xs">You answered <b>${r.answered ? esc(fmtUnit(r.submitted, r.unit)) : "nothing"}</b>. The answer is <b>${esc(fmtUnit(r.answer, r.unit))}</b>.</div>
        <details class="mt-1 text-xs"><summary class="cursor-pointer font-bold text-brand-600 dark:text-brand-300">Worked solution</summary><ol class="mt-1 space-y-1 pl-4">${r.steps.map((st) => `<li><b>${esc(st.label)}</b>: <span class="font-mono">${esc(st.expr)}</span> = <b>${fmtNum(st.value)}</b></li>`).join("")}</ol></details>`;
    } else if (r.graded) {
      body = `<div class="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs dark:bg-ink-700">${esc(r.text || "(no answer)")}</div>
        <ul class="mt-2 space-y-1.5">${r.points.map((p) => `<li class="text-xs"><span class="font-extrabold ${p.met ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}">${p.met ? "✓" : "✗"}</span> ${esc(p.text)}${p.met ? `<div class="pl-4 text-[11px] text-slate-400">your words: “${esc(p.evidence)}”</div>` : p.note ? `<div class="pl-4 text-[11px] text-amber-700 dark:text-sun">${esc(p.note)}</div>` : ""}</li>`).join("")}</ul>
        ${r.remark ? `<div class="mt-2 text-xs text-slate-500 dark:text-slate-400"><b>Feedback:</b> ${esc(r.remark)}</div>` : ""}
        ${r.answered && !r.remarkUsed ? (EXM.remarkFor === it.id ? `<div class="mt-2 space-y-2"><textarea data-remark-text rows="3" placeholder="Which point do you think you earned, and where in your answer did you say it?" class="w-full rounded-lg border border-slate-200 bg-transparent p-2 text-xs dark:border-ink-600">${esc(EXM.remarkText)}</textarea><div class="flex gap-2"><button data-remark-send="${esc(it.id)}" class="${btnPrimary} !py-1.5 !text-xs">Ask for a second look</button><button data-remark-cancel class="${btnGhost} !py-1.5 !text-xs">Cancel</button></div>${EXM.remarkMsg ? `<div class="text-xs text-red-600 dark:text-red-400">${esc(EXM.remarkMsg)}</div>` : ""}</div>` : `<button data-remark-open="${esc(it.id)}" class="mt-2 text-xs font-extrabold text-brand-600 underline dark:text-brand-300">Contest this grade</button>`) : r.remarkUsed ? '<div class="mt-2 text-[11px] font-semibold text-slate-400">You used your second look on this one.</div>' : ""}`;
    } else body = `<div class="mt-2 text-xs text-slate-400">${EXM.grading ? "Grading this one now…" : "Waiting to be graded."}</div>`;
    const title = it.type === "written" ? it.prompt : it.stem;
    return `<details class="${panelCls} !p-4" ${it.type === "written" || (!r.correct && it.type !== "written") ? "open" : ""}><summary class="flex cursor-pointer items-start gap-3"><span class="w-8 shrink-0 text-lg font-extrabold ${tone}">${mark}</span><span class="min-w-0 flex-1 text-sm font-bold"><span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">${i + 1} · ${TYPE_LABEL[it.type]} · ${r.earned}/${r.max}</span><br>${esc(title)}</span></summary>${body}</details>`;
  }).join("");
  const typeBars = sum.byType.map((t) => `<div class="flex items-center gap-3 text-sm"><span class="w-32 shrink-0 font-bold">${TYPE_LABEL[t.type]}</span><div class="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full ${barOf(Math.round((100 * t.earned) / Math.max(1, t.max)))}" style="width:${Math.max(4, Math.round((100 * t.earned) / Math.max(1, t.max)))}%"></div></div><span class="w-14 shrink-0 text-right text-xs font-extrabold tabular-nums text-slate-500">${t.earned}/${t.max}</span></div>`).join("");
  const lectBars = sum.byLecture.map((l) => `<div class="flex items-center gap-3 text-sm"><span class="min-w-0 flex-1 truncate font-bold">${esc(l.title)}</span><div class="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full ${barOf(Math.round((100 * l.earned) / Math.max(1, l.max)))}" style="width:${Math.max(4, Math.round((100 * l.earned) / Math.max(1, l.max)))}%"></div></div><span class="w-14 shrink-0 text-right text-xs font-extrabold tabular-nums text-slate-500">${l.earned}/${l.max}</span></div>`).join("");
  $("studyBody").innerHTML = `<div class="mx-auto max-w-2xl space-y-4 fade-in">
    <div class="flex items-center gap-3"><button id="examBack" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-700">← Back</button><div class="text-sm font-extrabold">${esc(s.name)}</div>${s.overtime ? '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">handed in late</span>' : ""}</div>
    <div class="${panelCls} text-center !p-8 !shadow-pop">
      <div class="text-6xl font-extrabold tabular-nums ${toneOf(sum.pct ?? 0)}">${sum.pct}%</div><div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">${sum.earned} of ${sum.max} points${s.writtenPending ? " so far" : ""}</div>
      ${s.writtenPending ? `<div class="mt-3 text-sm font-semibold text-amber-700 dark:text-sun">${EXM.grading ? '<span class="dots"><span></span><span></span><span></span></span> Grading your written answers, one rubric point at a time…' : "Your written answers aren't graded yet."}</div>${!EXM.grading ? `<button id="gradeWritten" class="${btnPrimary} mt-3">Grade them now</button>` : ""}` : ""}
      ${EXM.error ? `<div class="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">${esc(EXM.error)}</div>` : ""}</div>
    <div class="${panelCls} space-y-2"><div class="text-xs font-extrabold uppercase tracking-wider text-slate-400">Where the points went</div>${typeBars}<div class="pt-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">By lecture, weakest first</div>${lectBars}</div>
    <div class="text-xs font-extrabold uppercase tracking-wider text-slate-400">Review every question</div>${review}
    <p class="text-center text-[11px] font-semibold text-slate-400">Written points count only when the grader can quote the words in your own answer that earn them. Your multiple-choice and problem answers now count in your Progress.</p></div>`;
}

async function makeSheet(kind, examId) {
  EXM.error = "";
  const btn = document.querySelector(`[data-sheet-make="${kind}"][data-exam="${examId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = kind === "guide" ? "Building…" : "Picking the best cards…"; }
  const r = await api("/api/study/sheets", "POST", { examId, kind });
  if (!r.ok) { EXM.error = r.data.error || "Couldn't build that."; await loadExamHome(); return renderExamHome(); }
  await loadExamHome();
  EXM.sheet = r.data;
  EXM.mode = "sheet";
  renderSheet();
  refreshAi();
}

async function openSheet(id) {
  const r = await api(`/api/study/sheets/${id}`);
  if (!r.ok) { EXM.error = r.data.error || "That sheet is gone."; return renderExamHome(); }
  EXM.sheet = r.data;
  EXM.mode = "sheet";
  renderSheet();
}

function renderSheet() {
  const sh = EXM.sheet;
  const g = sh.sheet;
  const dense = g.kind === "onepage";
  $("studyBody").innerHTML = `<div class="mx-auto max-w-3xl space-y-4 fade-in">
    <div class="flex flex-wrap items-center gap-3 print:hidden"><button id="sheetBack" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-700">← Back</button>
      <div class="min-w-0 flex-1 text-sm font-extrabold">${g.kind === "onepage" ? "One-page cheat sheet" : "Study guide"} · version ${sh.version}</div>
      <button id="sheetPrint" class="${btnPrimary}">🖨 Print / save as PDF</button><a href="/api/study/sheets/${esc(sh.id)}/export.md" download class="${btnGhost}">⬇ Markdown</a><button data-sheet-del="${esc(sh.id)}" class="${btnGhost} text-red-600">Delete</button></div>
    <div id="sheetPrintArea" class="print-sheet rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600 ${dense ? "print-dense" : ""}">
      <h2 class="text-xl font-extrabold tracking-tight">${esc(g.title)}</h2>
      <div class="mb-3 text-xs font-semibold text-slate-400">${g.cards} cards, each from your own lecture notes${g.left ? ` · ${g.left} more didn't fit on one page (they're in the study guide)` : ""}</div>
      <div class="${dense ? "sheet-cols" : ""}">${g.groups.map((grp) => `<section class="sheet-group mb-3"><h3 class="mb-1 border-b border-slate-200 pb-0.5 text-sm font-extrabold uppercase tracking-wide text-brand-700 dark:border-ink-600 dark:text-brand-300">${esc(grp.heading)}</h3>
        <ul class="space-y-1">${grp.items.map((it) => `<li class="text-[13px] leading-snug"><b>${esc(it.front)}</b> <span class="whitespace-pre-line text-slate-700 dark:text-slate-300">${esc(it.back)}</span></li>`).join("")}</ul></section>`).join("")}</div>
    </div></div>`;
}

// =============================================================== progress
const PG = { data: null, plan: null, minutes: 45, loading: false, openLecture: null, backupMsg: "" };

async function loadProgress() {
  PG.loading = true;
  const c = encodeURIComponent(state.course);
  const [p, pl, bk] = await Promise.all([api(`/api/study/progress?course=${c}`), api(`/api/study/plan?course=${c}&minutes=${PG.minutes}`), api("/api/study/backups")]);
  PG.loading = false;
  PG.data = p.ok ? p.data : null;
  PG.plan = pl.ok ? pl.data : null;
  PG.backups = bk.ok ? bk.data : [];
  if (state.view === "study" && S.sub === "progress") renderProgress();
}

const PLAN_ICON = { generate: "✨", cards: "🃏", quiz: "📝", problems: "🧮", tutor: "🗣️", exam: "🎯" };
const LEVEL_LABEL = { unknown: "not practiced yet", weak: "needs work", shaky: "getting there", solid: "solid" };

function masteryBar(m) {
  if (m.score === null) return `<span class="text-xs font-semibold text-slate-400">${m.answers ? "too little practice to judge" : "not practiced yet"}</span>`;
  const pct = Math.round(m.score * 100);
  return `<div class="flex items-center gap-2"><div class="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full ${barOf(pct)}" style="width:${Math.max(4, pct)}%"></div></div><span class="w-9 text-right text-xs font-extrabold tabular-nums ${toneOf(pct)}">${pct}%</span></div>`;
}

function renderProgress() {
  const d = PG.data;
  if (!d) { $("studyBody").innerHTML = `<div class="space-y-5">${subSwitch()}${loadingHtml}</div>`; return; }
  const plan = PG.plan;
  const mins = [30, 45, 60, 90].map((m) => `<button data-pg-min="${m}" class="rounded-lg px-2.5 py-1 text-xs font-extrabold transition ${PG.minutes === m ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-300"}">${m} min</button>`).join("");
  const planHtml = plan && plan.items.length
    ? plan.items.map((it, i) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-ink-700"><span class="text-xl">${PLAN_ICON[it.kind]}</span><div class="min-w-0 flex-1"><div class="text-sm font-extrabold">${esc(it.title)}${state.course === "all" ? ` <span class="font-mono text-[10px] font-semibold text-slate-400">${esc(it.course)}</span>` : ""}</div><div class="text-xs text-slate-500 dark:text-slate-400">${esc(it.detail)}</div></div><span class="shrink-0 text-xs font-bold text-slate-400">${it.minutes} min</span><button data-plan-go="${i}" class="${btnPrimary} !px-3 !py-1.5 !text-xs">Go</button></div>`).join("")
    : `<div class="px-3 py-4 text-sm font-semibold text-slate-500">${plan && plan.plans.length ? "Nothing left to do today: you're ahead. 🎉" : "Add an exam on the Exam tab and I'll plan your days around it."}</div>`;
  const exams = d.exams.map((e) => {
    const r = e.readiness;
    const pct = Math.round(r.score * 100);
    return `<div class="${panelCls} !p-4"><div class="flex flex-wrap items-center gap-2"><span class="font-extrabold">${esc(e.name)}</span><span class="rounded-full px-2 py-0.5 text-[10px] font-extrabold ${palette(e.course).tile} ${palette(e.course).text}">${esc(e.course)}</span>${dayChip(e.daysLeft)}</div>
      <div class="mt-3 flex items-end gap-4"><div class="text-4xl font-extrabold tabular-nums ${toneOf(pct)}">${pct}%</div><div class="pb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">estimated readiness<br>confidence <b>${r.confidence}</b>: ${r.practiced} of ${r.lectures} lectures practiced, ${plural(r.answers, "answer")}</div></div>
      ${r.confidence === "low" ? '<div class="mt-2 text-[11px] font-semibold text-slate-400">That number is a rough guess until you have answered more across more lectures.</div>' : ""}</div>`;
  }).join("");
  const weak = d.weakSpots.length ? d.weakSpots.map((w, i) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2"><div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">${esc(w.section || w.title)}</div><div class="truncate text-xs text-slate-400">${esc(w.title)} · ${esc(fmtDate(w.date))}${state.course === "all" ? ` · ${esc(w.course)}` : ""}</div></div>${masteryBar(w.mastery)}
      <button data-weak-quiz="${i}" class="${btnGhost} !px-2.5 !py-1 !text-xs">Quiz</button><button data-weak-tutor="${i}" class="${btnGhost} !px-2.5 !py-1 !text-xs">Teach back</button></div>`).join("") : '<div class="px-3 py-3 text-sm font-semibold text-slate-500">No weak spots yet. They show up once you have answered a few questions on a topic and missed some.</div>';
  const lect = d.lectures.map((l) => `<div><button data-lect-toggle="${esc(l.id)}" class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-700"><span class="w-14 shrink-0 text-xs font-extrabold ${palette(l.course).text}">${esc(fmtDate(l.date))}</span><span class="min-w-0 flex-1 truncate text-sm font-bold">${esc(l.title)}</span>
      <span class="hidden shrink-0 text-[11px] font-bold text-slate-400 sm:inline">🃏${l.material.cards} 📝${l.material.questions} 🧮${l.material.problems}</span>${masteryBar(l.mastery)}</button>
      ${PG.openLecture === l.id && l.sections.length ? `<div class="mb-1 ml-16 space-y-1 border-l-2 border-slate-100 pl-3 dark:border-ink-700">${l.sections.map((s) => `<div class="flex items-center gap-3 py-0.5"><span class="min-w-0 flex-1 truncate text-xs font-semibold text-slate-500">${esc(s.name)} <span class="text-slate-300">(${plural(s.mastery.answers, "answer")})</span></span>${masteryBar(s.mastery)}</div>`).join("")}</div>` : ""}</div>`).join("");
  const ins = d.insights.map((i) => `<li class="flex gap-2 text-sm font-medium"><span>${{ idle: "⏰", missed: "🔁", untried: "🆕", nomaterial: "📭", streak: "🔥", tip: "💡" }[i.kind]}</span><span>${esc(i.text)}</span></li>`).join("");
  const last = (PG.backups || [])[0];
  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="${panelCls}"><div class="flex flex-wrap items-center justify-between gap-2"><div><div class="font-extrabold">Today's plan</div><div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${plan ? `${plan.totalMinutes} of your ${plan.budget} minutes, soonest exam first` : ""}</div></div><div class="flex gap-1.5">${mins}</div></div><div class="mt-2">${planHtml}</div></div>
    ${exams ? `<div class="grid gap-3 sm:grid-cols-2">${exams}</div>` : ""}
    <div class="${panelCls} !p-3"><div class="px-3 pt-2 pb-1 text-xs font-extrabold uppercase tracking-wider text-slate-400">Weak spots</div>${weak}</div>
    ${ins ? `<div class="${panelCls}"><div class="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">Worth knowing</div><ul class="space-y-2">${ins}</ul></div>` : ""}
    <div class="${panelCls} !p-3"><div class="px-3 pt-2 pb-1 text-xs font-extrabold uppercase tracking-wider text-slate-400">Every lecture · click for sections</div>${lect || '<div class="p-3 text-sm text-slate-400">No lectures yet.</div>'}
      <div class="px-3 pt-2 text-[11px] font-semibold text-slate-400">Mastery comes from what you actually answered (card ratings, quiz and problem first tries, teach-backs). Recent answers count more, a success with a hint counts half, and with too little practice it says so instead of guessing.</div></div>
    <div class="${panelCls} flex flex-wrap items-center gap-3"><button data-backup-now class="${btnGhost}">💾 Back up my study data</button><span id="studyToolMsg" class="text-xs font-semibold text-slate-400">${last ? `Last backup: ${new Date(last.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. A copy is made automatically once a day.` : "No backups yet. One is made automatically once a day."}</span></div>
  </div>`;
}

async function runPlanItem(i) {
  const it = PG.plan.items[i];
  if (!it) return;
  if (it.course && it.course !== state.course) await selectCourse(it.course);
  if (it.kind === "cards") { S.sub = "cards"; S.mode = "home"; renderStudy(); await loadStudyToday(); return startStudySession(); }
  if (it.kind === "quiz") { S.sub = "quiz"; return startQuiz(it.noteIds); }
  if (it.kind === "problems") return startPractice(it.noteIds);
  if (it.kind === "generate") {
    S.sub = "cards";
    S.mode = "home";
    S.gen.open = true;
    renderStudy();
    await loadStudyToday();
    await loadGenPlan("cards");
    S.gen.selected = new Set(it.noteIds || []);
    updateGenPanel("cards");
    return;
  }
  if (it.kind === "tutor") { TUT.mode = "home"; S.sub = "tutor"; renderStudy(); await loadTutorHome(); return pickTutorLecture((it.noteIds || [])[0]); }
  if (it.kind === "exam") { EXM.mode = "home"; S.sub = "exam"; renderStudy(); await loadExamHome(); return startMockExam(it.examId); }
}

// =============================================================== Match game
const MT = { on: false, pairs: [], tiles: [], sel: null, matched: new Set(), misses: 0, t0: 0, done: false, wrong: null, error: "" };

async function startMatch() {
  const r = await api(`/api/study/match?course=${encodeURIComponent(state.course)}&count=6`);
  if (!r.ok) { const el = $("studyToolMsg"); if (el) el.textContent = r.data.error || "Couldn't start."; return; }
  const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  MT.pairs = r.data;
  MT.tiles = shuffle([...r.data.map((p) => ({ id: p.id, kind: "term", text: p.term })), ...r.data.map((p) => ({ id: p.id, kind: "def", text: p.definition }))]).map((t, i) => ({ ...t, key: i }));
  Object.assign(MT, { on: true, sel: null, matched: new Set(), misses: 0, t0: Date.now(), done: false, wrong: null });
  renderMatch();
}

function renderMatch() {
  const secs = Math.round((Date.now() - MT.t0) / 1000);
  const tiles = MT.tiles.map((t) => {
    const gone = MT.matched.has(t.id);
    const sel = MT.sel === t.key;
    const bad = MT.wrong && MT.wrong.includes(t.key);
    return `<button data-mt-tile="${t.key}" ${gone ? "disabled" : ""} class="flex min-h-[5.5rem] items-center justify-center rounded-2xl border-2 p-3 text-center text-sm font-bold leading-snug transition ${gone ? "pointer-events-none scale-90 border-transparent opacity-0" : bad ? "border-red-400 bg-red-50 dark:bg-red-500/10" : sel ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15" : "border-slate-200 bg-white hover:border-brand-300 dark:border-ink-600 dark:bg-ink-800"} ${t.kind === "def" ? "italic" : ""}">${esc(t.text)}</button>`;
  }).join("");
  $("studyBody").innerHTML = MT.done
    ? `<div class="${panelCls} mx-auto max-w-md text-center !p-8 !shadow-pop fade-in"><div class="text-6xl">🎮</div><h2 class="mt-3 text-3xl font-extrabold">All matched!</h2><p class="mt-1 text-sm font-semibold text-slate-500">${Math.round((MT.end - MT.t0) / 1000)} seconds, ${MT.misses === 0 ? "no misses" : plural(MT.misses, "miss", "misses")}.</p>
        <div class="mt-6 flex justify-center gap-3"><button id="mtExit" class="${btnGhost}">Back to Study</button><button id="mtAgain" class="${btnPrimary}">Play again →</button></div></div>`
    : `<div class="mx-auto max-w-2xl space-y-4"><div class="flex items-center gap-3"><button id="mtExit" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-700">← Back</button><div class="flex-1 text-sm font-extrabold">Match each term with its answer</div><span class="text-xs font-extrabold tabular-nums text-slate-400">${MT.matched.size} / ${MT.pairs.length} · ${plural(MT.misses, "miss", "misses")}</span></div>
        <div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4">${tiles}</div></div>`;
}

function tapTile(key) {
  if (MT.done || MT.wrong) return;
  const t = MT.tiles.find((x) => x.key === key);
  if (!t || MT.matched.has(t.id)) return;
  if (MT.sel === null) { MT.sel = key; return renderMatch(); }
  if (MT.sel === key) { MT.sel = null; return renderMatch(); }
  const first = MT.tiles.find((x) => x.key === MT.sel);
  if (first.id === t.id && first.kind !== t.kind) {
    MT.matched.add(t.id);
    MT.sel = null;
    if (MT.matched.size === MT.pairs.length) { MT.done = true; MT.end = Date.now(); }
    return renderMatch();
  }
  MT.misses++;
  MT.wrong = [MT.sel, key];
  MT.sel = null;
  renderMatch();
  setTimeout(() => { MT.wrong = null; if (MT.on) renderMatch(); }, 650);
}

// =============================================================== events
$("studyBody").addEventListener("click", (e) => {
  const t = e.target;
  const hit = (sel) => t.closest(sel);
  // problems
  if (hit("#startPractice")) return startPractice();
  if (hit("#exitPractice")) return exitPractice();
  const pl = hit("[data-pr-len]"); if (pl) { PRB.length = Number(pl.dataset.prLen); return renderProblemsHome(); }
  if (hit("#hintBtn")) { PRB.hintShown = true; PRB.hinted = true; return renderProblemPlay(); }
  if (hit("#checkProblem")) return submitProblem(false);
  if (hit("#giveUp")) { PRB.hinted = true; return submitProblem(true); }
  if (hit("#nextP")) return nextProblem();
  const dp = hit("[data-del-p]"); if (dp) return deleteWithUndo("problem", `/api/study/problems/${encodeURIComponent(dp.dataset.delP)}`);
  // tutor
  const tp = hit("[data-tut-pick]"); if (tp) return pickTutorLecture(tp.dataset.tutPick);
  const tt = hit("[data-tut-topic]"); if (tt) { TUT.topicIdx = Number(tt.dataset.tutTopic); return renderTutor(); }
  if (hit("[data-tut-all]")) { TUT.showAll = !TUT.showAll; return renderTutor(); }
  if (hit("#tutStart")) return startTutorSession();
  if (hit("#tutSend")) return sendTutor();
  if (hit("#tutLeave") || hit("#tutAgain")) { TUT.mode = "home"; loadTutorHome(); return renderTutor(); }
  if (hit("[data-tut-quiz]")) { const id = TUT.session && TUT.session.noteId; TUT.mode = "home"; S.sub = "quiz"; return startQuiz(id ? [id] : undefined); }
  // exams
  if (hit("[data-ex-open]")) { EXM.form.open = true; EXM.form.from = EXM.form.from || dateInput(-35); EXM.form.date = EXM.form.date || dateInput(7); return renderExamHome(); }
  if (hit("[data-ex-close]")) { EXM.form.open = false; return renderExamHome(); }
  const pr = hit("[data-ex-preset]"); if (pr) { EXM.preset = pr.dataset.exPreset; return renderExamHome(); }
  const es = hit("[data-ex-start]"); if (es) return startMockExam(es.dataset.exStart);
  const ed = hit("[data-ex-del]"); if (ed) { if (confirm("Remove this exam from your list? Your cards, questions and past mock exams stay.")) api(`/api/study/exams/${encodeURIComponent(ed.dataset.exDel)}`, "DELETE").then(loadExamHome); return; }
  const er = hit("[data-ex-review]"); if (er) return reviewSitting(er.dataset.exReview);
  const eo = hit("[data-ex-opt]"); if (eo) { const [id, i] = eo.dataset.exOpt.split(":"); return toggleExamOption(id, Number(i)); }
  if (hit("#examHandIn") || hit("#examHandIn2")) return submitExam(false);
  if (hit("#gradeWritten")) return gradeWrittenNow();
  if (hit("#examBack")) { EXM.mode = "home"; return loadExamHome().then(renderExam); }
  const ro = hit("[data-remark-open]"); if (ro) { EXM.remarkFor = ro.dataset.remarkOpen; EXM.remarkText = ""; EXM.remarkMsg = ""; return renderExamResults(); }
  if (hit("[data-remark-cancel]")) { EXM.remarkFor = null; return renderExamResults(); }
  const rs = hit("[data-remark-send]"); if (rs) return sendRemark(rs.dataset.remarkSend);
  const sm = hit("[data-sheet-make]"); if (sm) return makeSheet(sm.dataset.sheetMake, sm.dataset.exam);
  const so = hit("[data-sheet-open]"); if (so) return openSheet(so.dataset.sheetOpen);
  if (hit("#sheetBack")) { EXM.mode = "home"; return loadExamHome().then(renderExam); }
  if (hit("#sheetPrint")) return window.print();
  const sd = hit("[data-sheet-del]"); if (sd) { if (confirm("Delete this version?")) api(`/api/study/sheets/${encodeURIComponent(sd.dataset.sheetDel)}`, "DELETE").then(() => { EXM.mode = "home"; return loadExamHome().then(renderExam); }); return; }
  // progress
  const pm = hit("[data-pg-min]"); if (pm) { PG.minutes = Number(pm.dataset.pgMin); return loadProgress(); }
  const pg = hit("[data-plan-go]"); if (pg) return runPlanItem(Number(pg.dataset.planGo));
  const lt = hit("[data-lect-toggle]"); if (lt) { PG.openLecture = PG.openLecture === lt.dataset.lectToggle ? null : lt.dataset.lectToggle; return renderProgress(); }
  const wq = hit("[data-weak-quiz]"); if (wq) { const w = PG.data.weakSpots[Number(wq.dataset.weakQuiz)]; return (async () => { if (w.course !== state.course) await selectCourse(w.course); S.sub = "quiz"; return startQuiz([w.noteId]); })(); }
  const wt = hit("[data-weak-tutor]"); if (wt) { const w = PG.data.weakSpots[Number(wt.dataset.weakTutor)]; return (async () => { if (w.course !== state.course) await selectCourse(w.course); TUT.mode = "home"; S.sub = "tutor"; renderStudy(); await loadTutorHome(); return pickTutorLecture(w.noteId); })(); }
  // new cards a day
  const nl = hit("[data-newlimit]");
  if (nl) return api("/api/settings", "POST", { newPerDay: Number(nl.dataset.newlimit) }).then((r) => { if (r.ok) return Promise.all([loadStudyToday(), loadProgress()]); const el = $("studyToolMsg"); if (el) el.textContent = r.data.error || "Couldn't change that."; });
  // Match game, backup
  if (hit("[data-match-start]")) return startMatch();
  const mt = hit("[data-mt-tile]"); if (mt) return tapTile(Number(mt.dataset.mtTile));
  if (hit("#mtExit")) { MT.on = false; return renderStudy(); }
  if (hit("#mtAgain")) return startMatch();
  if (hit("[data-backup-now]")) return backupNow();
});

async function backupNow() {
  const el = $("studyToolMsg");
  if (el) el.textContent = "Backing up…";
  const r = await api("/api/study/backup", "POST");
  const msg = r.ok ? `Backed up (${Math.max(1, Math.round(r.data.bytes / 1024))} KB). Kept in data/backups.` : r.data.error || "Couldn't back up.";
  const el2 = $("studyToolMsg");
  if (el2) el2.textContent = msg;
  if (r.ok && S.sub === "progress") loadProgress();
}

async function sendRemark(itemId) {
  const ta = document.querySelector("[data-remark-text]");
  const argument = (ta ? ta.value : EXM.remarkText).trim();
  EXM.remarkText = argument;
  if (argument.length < 5) { EXM.remarkMsg = "Say why you think a point should count."; return renderExamResults(); }
  EXM.remarkMsg = "";
  EXM.grading = true;
  renderExamResults();
  const r = await api(`/api/study/exam/${EXM.results.id}/remark`, "POST", { itemId, argument });
  EXM.grading = false;
  if (r.ok) { EXM.results = r.data; EXM.remarkFor = null; } else EXM.remarkMsg = r.data.error || "Couldn't look at it again.";
  renderExamResults();
  refreshAi();
}

$("studyBody").addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "problemInput") { PRB.input = t.value; return; }
  if (t.id === "tutInput") { TUT.input = t.value; return; }
  if (t.dataset && t.dataset.exText !== undefined) { EXM.answers[t.dataset.exText] = t.value; saveExamAnswers(); return; }
  if (t.dataset && t.dataset.remarkText !== undefined) { EXM.remarkText = t.value; return; }
  if (t.dataset && t.dataset.exForm) EXM.form[t.dataset.exForm] = t.value;
});
$("studyBody").addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.exForm) EXM.form[e.target.dataset.exForm] = e.target.value; });
$("studyBody").addEventListener("submit", (e) => { if (e.target.id === "examForm") { e.preventDefault(); saveExamForm(); } });

document.addEventListener("keydown", (e) => {
  if (state.view !== "study" || e.metaKey && e.key !== "Enter" || e.altKey) return;
  if (S.sub === "problems" && PRB.mode === "play") {
    if (e.key === "Escape") { if (!$("source").classList.contains("hidden")) return; return exitPractice(); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (PRB.result) nextProblem();
      else if (e.target && e.target.id === "problemInput") submitProblem(false);
    }
  }
  if (S.sub === "tutor" && TUT.mode === "chat" && e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target && e.target.id === "tutInput") { e.preventDefault(); sendTutor(); }
});

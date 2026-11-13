import { $, Q, S, courseName, esc, palette, state } from "./core.js";
import { refreshState } from "./shell.js";
import { loadStudyToday, renderStudy, statTile } from "./cards.js";
import { genPanelHtml } from "./generate.js";
import { refreshAi } from "./panels.js";

// ---- quizzes ----
export const KIND_LABEL = { single: "Pick one", multi: "Select all that apply", tf: "True or false" };
export const KIND_SHORT = { single: "Pick 1", multi: "Select all", tf: "T / F" };
export const LETTER = "ABCDE";

export function subSwitch() {
  const tabs = [["cards", "🃏", "Cards"], ["quiz", "📝", "Quiz"], ["problems", "🧮", "Problems"], ["tutor", "🗣️", "Tutor"], ["exam", "🎯", "Exam"], ["progress", "📊", "Progress"]];
  return `<div class="flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1 [scrollbar-width:none] dark:bg-ink-800">${tabs.map(([id, ic, label]) => `<button data-sub="${id}" class="shrink-0 grow rounded-xl px-3 py-2 text-sm font-extrabold whitespace-nowrap transition ${S.sub === id ? "bg-white text-brand-700 shadow-card dark:bg-ink-600 dark:text-brand-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}">${ic} ${label}</button>`).join("")}</div>`;
}

export function setSub(sub) {
  if (S.sub === sub) return;
  S.sub = sub;
  renderStudy();
  loadStudyToday();
}

export async function loadQuizHome() {
  const res = await fetch(`/api/study/quiz/home?course=${encodeURIComponent(state.course)}`);
  if (!res.ok) return;
  Q.home = await res.json();
  if (state.view === "study" && S.sub === "quiz" && Q.mode === "home") renderQuizHome();
}

export function renderQuizHome() {
  const h = Q.home;
  if (!h) { $("studyBody").innerHTML = `<div class="space-y-5">${subSwitch()}<div class="py-20 text-center text-slate-400"><span class="dots"><span></span><span></span><span></span></span></div></div>`; return; }
  const total = h.counts.total;
  const len = Math.min(Q.length, Math.max(1, total));
  const acc = h.accuracy;
  const lens = [5, 10, 20].map((n) => `<button data-qlen="${n}" class="rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${Q.length === n ? "bg-white text-emerald-700 shadow-card" : "bg-white/20 text-white hover:bg-white/30"}">${n}</button>`).join("");
  const list = h.questions.slice(0, 60).map((q) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-ink-700">
      <span class="w-16 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-[10px] font-extrabold text-slate-500 dark:bg-ink-700 dark:text-slate-300">${KIND_SHORT[q.kind]}</span>
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">${esc(q.stem)}</div><div class="truncate text-xs text-slate-400">${esc(q.section || "")}${state.course === "all" ? ` · ${esc(q.course)}` : ""}</div></div>
      ${q.asked ? `<span class="shrink-0 text-xs font-extrabold ${q.right === q.asked ? "text-emerald-600 dark:text-emerald-300" : q.right === 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-sun"}">${q.right}/${q.asked}</span>` : ""}
      <button data-del-q="${esc(q.id)}" class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Move to trash (you can undo)" aria-label="Move to trash: question">×</button></div>`).join("");
  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-600 to-brand-600 p-6 text-white shadow-pop md:p-8">
      <div class="absolute -top-8 -right-8 text-[9rem] leading-none opacity-10">📝</div>
      <div class="flex items-start justify-between gap-3"><div class="text-sm font-extrabold opacity-80">Quiz yourself · ${esc(courseName(state.course))}</div>
        <div class="rounded-full bg-white/20 px-3 py-1 text-xs font-extrabold">🔥 ${h.streak}-day streak</div></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-6xl font-extrabold tabular-nums">${total}</span><span class="text-lg font-bold opacity-80">${total === 1 ? "question" : "questions"} ready</span></div>
      <div class="mt-1 text-sm font-semibold opacity-80">${total ? `${h.counts.seen} seen · new and missed questions come first` : "Make some from your lectures below."}</div>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button id="startQuiz" ${total ? "" : "disabled"} class="rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-emerald-700 shadow-card transition hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:hover:translate-y-0">${total ? `Start a ${len}-question quiz →` : "No questions yet"}</button>
        <div class="flex items-center gap-1.5"><span class="text-xs font-extrabold opacity-80">Length</span>${lens}</div></div>
      ${Q.error ? `<div class="mt-3 rounded-xl bg-white/20 px-3 py-2 text-xs font-bold">${esc(Q.error)}</div>` : ""}
    </div>
    <div class="grid grid-cols-3 gap-3">${statTile("In your bank", total, "text-slate-700 dark:text-slate-200")}${statTile("Seen", h.counts.seen, "text-emerald-600 dark:text-emerald-300")}${statTile("Right first try, 7 days", acc.answers ? acc.pct + "%" : "–", "text-brand-600 dark:text-brand-300")}</div>
    <div id="genPanel">${genPanelHtml("quiz")}</div>
    ${list ? `<details class="rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600"><summary class="cursor-pointer px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">Your questions (${total})</summary>${list}</details>` : ""}
  </div>`;
}

export async function startQuiz(noteIds) {
  const res = await fetch("/api/study/quiz/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course: state.course, length: Q.length, noteIds: Array.isArray(noteIds) ? noteIds : undefined }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { Q.error = d.error || "Couldn't start a quiz."; return renderQuizHome(); }
  Q.error = "";
  Object.assign(Q, { mode: "play", runId: d.runId, queue: d.questions, idx: 0, picked: [], result: null, explain: null, asked: 0, correct: 0, t0: Date.now(), qT0: Date.now(), busy: false, summary: null });
  S.sub = "quiz";
  renderStudy();
}

export function exitQuiz() {
  Q.mode = "home";
  Q.result = null;
  Promise.all([loadQuizHome(), loadStudyToday(), refreshState()]);
  renderStudy();
}

export function renderQuizPlay() {
  const q = Q.queue[Q.idx];
  if (!q) return finishQuizRun();
  const r = Q.result;
  const total = Q.queue.length;
  const pct = Math.round((100 * Q.idx) / total);
  const isTf = q.kind === "tf";
  const optHtml = q.options.map((o, i) => {
    const picked = Q.picked.includes(i);
    let cls = "border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700";
    let chip = "bg-slate-100 text-slate-500 dark:bg-ink-700 dark:text-slate-300";
    let mark = q.kind === "multi" ? (picked ? "☑" : "☐") : "";
    if (!r && picked) { cls = "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/15"; chip = "bg-brand-500 text-white"; }
    if (r) {
      const right = r.answer.includes(i);
      if (right) { cls = "border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-500/15"; chip = "bg-emerald-500 text-white"; mark = picked || q.kind !== "multi" ? "✓" : "✓ missed"; }
      else if (picked) { cls = "border-red-400 bg-red-50 dark:border-red-400 dark:bg-red-500/10"; chip = "bg-red-500 text-white"; mark = "✗"; }
      else { cls = "border-slate-100 bg-white opacity-60 dark:border-ink-700 dark:bg-ink-800"; mark = ""; }
    }
    return `<button data-opt="${i}" ${r ? "disabled" : ""} class="${isTf ? "justify-center py-6 text-xl" : "py-3.5 text-left text-[15px]"} flex w-full items-center gap-3 rounded-2xl border-2 px-4 font-bold transition active:scale-[0.99] ${cls}">
      ${isTf ? "" : `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${chip}">${LETTER[i]}</span>`}
      <span class="${isTf ? "" : "flex-1"}">${esc(o)}</span>${mark ? `<span class="shrink-0 text-sm font-extrabold">${mark}</span>` : ""}</button>`;
  }).join("");

  let feedback = "";
  if (r) {
    const ex = Q.explain;
    feedback = `<div class="fade-in space-y-3">
      <div class="rounded-2xl px-4 py-3 ${r.correct ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200"}">
        <div class="text-base font-extrabold">${r.correct ? (r.attempt > 1 ? "Got it this time 💪" : "Correct! 🎉") : q.kind === "multi" ? "Not quite: you need every right option and no wrong ones" : "Not quite"}</div>
        <div class="mt-1 text-sm leading-relaxed font-medium">${esc(r.explanation)}</div></div>
      ${r.quote ? `<div class="rounded-2xl bg-sun/20 px-4 py-3 text-left text-xs leading-relaxed text-amber-900 dark:text-sun"><div class="mb-1 text-[10px] font-extrabold uppercase tracking-wider opacity-70">From your notes</div>“${esc(r.quote)}”
        ${r.noteId ? `<button data-open-note="${esc(r.noteId)}" data-quote="${esc(r.quote)}" class="mt-1.5 block font-extrabold underline">Open the note →</button>` : ""}</div>` : ""}
      ${!r.correct ? (ex && ex.text ? `<div class="rounded-2xl bg-brand-50 px-4 py-3 text-sm leading-relaxed dark:bg-brand-500/10"><div class="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-brand-600 dark:text-brand-300">Another explanation · written by Claude from your note</div>${esc(ex.text)}</div>`
        : ex && ex.loading ? `<div class="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500 dark:bg-ink-700"><span class="dots"><span></span><span></span><span></span></span>Asking Claude…</div>`
        : `<button id="explainBtn" class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">💡 Explain it another way</button>${ex && ex.error ? `<div class="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">${esc(ex.error)}</div>` : ""}`) : ""}
      <button id="nextQ" class="w-full rounded-2xl bg-brand-500 py-4 text-base font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-[0.99]">${Q.idx + 1 >= Q.queue.length ? "Finish quiz" : "Next question"} <span class="ml-1 text-xs font-bold opacity-70">(Enter)</span></button></div>`;
  } else if (q.kind === "multi") {
    feedback = `<button id="checkAnswer" ${Q.picked.length ? "" : "disabled"} class="w-full rounded-2xl bg-brand-500 py-4 text-base font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-[0.99] disabled:opacity-40">Check answer <span class="ml-1 text-xs font-bold opacity-70">(Enter)</span></button>`;
  }

  $("studyBody").innerHTML = `<div class="mx-auto max-w-2xl space-y-4">
    <div class="flex items-center gap-3"><button id="exitQuiz" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-700">← Back</button>
      <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-ink-700"><div class="h-full rounded-full bg-emerald-500 transition-all" style="width:${pct}%"></div></div>
      <span class="text-xs font-extrabold tabular-nums text-slate-400">${Q.idx + 1} / ${total}</span></div>
    <div class="rounded-3xl bg-white p-6 shadow-pop ring-1 ring-slate-200/70 md:p-8 dark:bg-ink-800 dark:ring-ink-600">
      <div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400"><span class="rounded-full px-2 py-0.5 ${palette(q.course).tile} ${palette(q.course).text}">${esc(q.course)}</span>${KIND_LABEL[q.kind]}${q.again ? '<span class="rounded-full bg-sun/30 px-2 py-0.5 text-amber-800 dark:text-sun">Second try</span>' : ""}</div>
      <div class="text-xl leading-snug font-extrabold md:text-2xl">${esc(q.stem)}</div>
    </div>
    <div class="${isTf ? "grid grid-cols-2" : "flex flex-col"} gap-2.5">${optHtml}</div>
    ${feedback}
    <div class="text-center text-[11px] font-semibold text-slate-400">${r ? "Missed questions come back at the end of this quiz, and first in the next one." : q.kind === "multi" ? "Tick every option that applies, then check. Keys 1 to 5 toggle." : "Click an answer, or press " + (isTf ? "1 for True, 2 for False." : "1 to 4.") + " Esc to leave."}</div>
  </div>`;
}

export async function pickOption(i) {
  const q = Q.queue[Q.idx];
  if (!q || Q.result || Q.busy || i < 0 || i >= q.options.length) return;
  if (q.kind === "multi") {
    Q.picked = Q.picked.includes(i) ? Q.picked.filter((x) => x !== i) : [...Q.picked, i].sort((a, b) => a - b);
    return renderQuizPlay();
  }
  Q.picked = [i];
  return submitQuizAnswer();
}

export async function submitQuizAnswer() {
  const q = Q.queue[Q.idx];
  if (!q || Q.result || Q.busy || !Q.picked.length) return;
  Q.busy = true;
  try {
    const res = await fetch("/api/study/quiz/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: Q.runId, questionId: q.id, picked: Q.picked, msTaken: Date.now() - Q.qT0 }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { alert(d.error || "Couldn't save that answer."); return; }
    Q.result = d;
    // A miss on the first try comes back once more at the end of this quiz.
    if (d.attempt === 1 && !d.correct) Q.queue.push({ ...q, again: true });
    renderQuizPlay();
  } finally {
    Q.busy = false;
  }
}

export function nextQuizQuestion() {
  if (!Q.result) return;
  Q.idx++;
  Q.picked = [];
  Q.result = null;
  Q.explain = null;
  Q.qT0 = Date.now();
  if (Q.idx >= Q.queue.length) return finishQuizRun();
  renderQuizPlay();
}

export async function explainMiss() {
  const q = Q.queue[Q.idx];
  if (!q || !Q.result || (Q.explain && Q.explain.loading)) return;
  Q.explain = { loading: true };
  renderQuizPlay();
  const res = await fetch("/api/study/quiz/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: q.id, picked: Q.picked }) });
  const d = await res.json().catch(() => ({}));
  Q.explain = res.ok ? { text: d.text } : { error: d.error || "Couldn't get another explanation." };
  if (Q.mode === "play") renderQuizPlay();
  refreshAi();
}

export async function finishQuizRun() {
  const res = await fetch("/api/study/quiz/finish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: Q.runId }) });
  const d = await res.json().catch(() => ({}));
  Q.summary = res.ok ? d : null;
  if (res.ok) state.streak = d.streak;
  Q.mode = "done";
  await Promise.all([loadQuizHome(), loadStudyToday(), refreshState()]);
  if (Q.mode === "done") renderQuizDone();
}

export function renderQuizDone() {
  const s = Q.summary;
  if (!s || !s.total) {
    $("studyBody").innerHTML = `<div class="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-pop ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600"><div class="text-5xl">🤷</div><h2 class="mt-3 text-2xl font-extrabold">No answers yet</h2><button id="exitQuiz" class="mt-5 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold dark:border-ink-600">Back to Study</button></div>`;
    return;
  }
  const verdict = s.pct >= 90 ? ["🏆", "Excellent!"] : s.pct >= 70 ? ["🎉", "Solid work!"] : s.pct >= 50 ? ["💪", "Getting there"] : ["🌱", "Good practice"];
  const mins = Math.floor(s.seconds / 60);
  const bars = s.bySection.slice(0, 8).map((x) => {
    const p = Math.round((100 * x.right) / x.asked);
    return `<div class="flex items-center gap-3 text-sm"><span class="min-w-0 flex-1 truncate font-bold">${esc(x.section)}${state.course === "all" ? ` <span class="font-mono text-[10px] font-semibold text-slate-400">${esc(x.course)}</span>` : ""}</span>
      <div class="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full ${p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-red-500"}" style="width:${Math.max(p, 4)}%"></div></div>
      <span class="w-10 shrink-0 text-right text-xs font-extrabold tabular-nums text-slate-500">${x.right}/${x.asked}</span></div>`;
  }).join("");
  const burst = s.pct >= 70 ? ["🎉", "✨", "⭐", "🎊", "💫", "📝", "🔥", "✨", "🎉", "⭐"].map((e, i) => `<span style="--x:${(i - 4.5) * 34}px;--r:${(i % 2 ? 1 : -1) * (20 + i * 9)}deg;animation-delay:${i * 40}ms">${e}</span>`).join("") : "";
  $("studyBody").innerHTML = `<div class="relative mx-auto max-w-lg overflow-hidden rounded-3xl bg-white p-8 text-center shadow-pop ring-1 ring-slate-200/70 fade-in dark:bg-ink-800 dark:ring-ink-600">
    <div class="confetti">${burst}</div>
    <div class="text-6xl">${verdict[0]}</div><h2 class="mt-3 text-3xl font-extrabold tracking-tight">${verdict[1]}</h2>
    <p class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">${s.correct} of ${s.total} right on the first try${s.recovered ? `, and you fixed ${s.recovered} of your misses on the second` : ""}.</p>
    <div class="mt-6 grid grid-cols-3 gap-3">${statTile("First try", s.pct + "%", s.pct >= 70 ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-sun")}${statTile("Missed", s.missed.length, "text-brand-600 dark:text-brand-300")}${statTile("Time", mins + ":" + String(s.seconds % 60).padStart(2, "0"), "text-slate-700 dark:text-slate-200")}</div>
    ${bars ? `<div class="mt-6 text-left"><div class="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400">By topic · weakest first</div><div class="space-y-2">${bars}</div></div>` : ""}
    ${s.missed.length ? `<details class="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-left text-xs dark:bg-ink-700"><summary class="cursor-pointer font-extrabold">What you missed</summary><ul class="mt-2 list-disc space-y-1 pl-4 font-medium text-slate-600 dark:text-slate-300">${s.missed.map((m) => `<li>${esc(m.stem)}</li>`).join("")}</ul></details>` : ""}
    <div class="mt-4 inline-block rounded-full bg-sun/30 px-4 py-1.5 text-sm font-extrabold text-amber-800 dark:text-sun">🔥 ${state.streak}-day streak</div>
    <div class="mt-6 flex justify-center gap-3"><button id="exitQuiz" class="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Back to Study</button>
      <button id="startQuiz" class="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-600">Another quiz →</button></div>
    ${s.missed.length ? '<p class="mt-3 text-[11px] font-semibold text-slate-400">Questions you missed come first next time.</p>' : ""}</div>`;
}
import { $, Q, S, courseName, esc, palette, plural, state } from "./core.js";
import { refreshState } from "./shell.js";
import { genPanelHtml, resumeGeneration } from "./generate.js";
import { loadQuizHome, renderQuizDone, renderQuizHome, renderQuizPlay, subSwitch } from "./quiz.js";
import { loadStudyMore, renderStudyMore } from "./studyhub.js";
import { MT, renderMatch } from "./match.js";
import { CT, cardToolsHtml, offerUndo } from "./cardtools.js";
import { loadToday, renderToday, renderTodayBar } from "./today.js";

// ---- study ----
export const GRADE_LABEL = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
export const GRADE_STYLE = {
  1: "bg-red-500 hover:bg-red-600",
  2: "bg-orange-500 hover:bg-orange-600",
  3: "bg-emerald-500 hover:bg-emerald-600",
  4: "bg-brand-500 hover:bg-brand-600",
};
export const STATE_LABEL = { 0: "New", 1: "Learning", 2: "Review", 3: "Relearning" };
export const REQUEUE_WITHIN_MS = 20 * 60 * 1000;

export async function loadStudyToday() {
  const course = encodeURIComponent(state.course);
  const [t, c] = await Promise.all([fetch(`/api/study/today?course=${course}`), fetch(`/api/study/cards?course=${course}`)]);
  if (!t.ok) return;
  S.today = await t.json();
  S.cards = c.ok ? await c.json() : [];
  const k = S.today.counts;
  S.badge = k.due + k.learning + k.newAvailable;
  $("studyBadge").textContent = S.badge;
  $("studyBadge").classList.toggle("hidden", !S.badge);
  if (S.sub === "today") await loadToday();
  else if (["problems", "tutor", "exam", "progress"].includes(S.sub)) await loadStudyMore();
  else if (S.sub === "quiz") await loadQuizHome();
  else if (state.view === "study" && S.mode === "home") renderStudyHome();
  resumeGeneration();
}

export function renderStudy() {
  renderTodayBar();
  if (S.sub === "today") return renderToday();
  if (typeof MT !== "undefined" && MT.on && S.sub === "cards") return renderMatch();
  if (["problems", "tutor", "exam", "progress"].includes(S.sub)) return renderStudyMore();
  if (S.sub === "quiz") {
    if (Q.mode === "play") renderQuizPlay();
    else if (Q.mode === "done") renderQuizDone();
    else renderQuizHome();
    return;
  }
  if (S.mode === "play") renderPlayer();
  else if (S.mode === "done") renderDone();
  else renderStudyHome();
}

export function statTile(label, value, tone) {
  return `<div class="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
    <div class="text-3xl font-extrabold tabular-nums ${tone}">${value}</div><div class="mt-0.5 text-xs font-bold text-slate-400">${label}</div></div>`;
}

export function renderStudyHome() {
  const t = S.today;
  if (!t) { $("studyBody").innerHTML = '<div class="py-20 text-center text-slate-400"><span class="dots"><span></span><span></span><span></span></span></div>'; return; }
  const k = t.counts;
  const todo = k.due + k.learning + k.newAvailable;
  const name = courseName(state.course);
  const max = Math.max(1, ...t.forecast);
  const today = new Date();
  const bars = t.forecast.map((n, i) => {
    const d = new Date(today.getTime() + i * 86400000);
    const lab = i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" });
    return `<div class="flex flex-1 flex-col items-center gap-1.5"><span class="text-[11px] font-extrabold tabular-nums ${n ? "text-brand-600 dark:text-brand-300" : "text-slate-300 dark:text-ink-600"}">${n}</span>
      <div class="flex h-16 w-full items-end"><div class="w-full rounded-t-lg ${n ? "bg-brand-500" : "bg-slate-100 dark:bg-ink-700"}" style="height:${n ? Math.max(8, Math.round((100 * n) / max)) : 6}%"></div></div>
      <span class="text-[10px] font-bold text-slate-400">${lab}</span></div>`;
  }).join("");
  const acc = t.accuracy;
  const cardsHtml = (S.cards || []).slice(0, 30).map((c) => `<div class="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-ink-700">
      <span class="shrink-0 text-base" title="${c.origin === 'generated' ? 'Made from a lecture' : 'Made by hand'}">${c.origin === "generated" ? "✨" : "✍️"}</span><span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-500 dark:bg-ink-700 dark:text-slate-300">${STATE_LABEL[c.state]}</span>
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">${esc(c.front)}</div><div class="truncate text-xs text-slate-400">${esc(c.back)}</div></div>
      <button data-del-card="${esc(c.id)}" class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Move to trash (you can undo)" aria-label="Move to trash: card">×</button></div>`).join("");
  const picker = state.course === "all"
    ? `<select id="cardCourse" class="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm font-semibold dark:border-ink-600 dark:bg-ink-800">${state.courses.filter((c) => !c.archived && c.id !== "unsorted").map((c) => `<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.name)}</option>`).join("")}</select>`
    : "";

  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 via-brand-600 to-fuchsia-500 p-6 text-white shadow-pop md:p-8">
      <div class="absolute -top-8 -right-8 text-[9rem] leading-none opacity-10">🧠</div>
      <div class="flex items-start justify-between gap-3"><div class="text-sm font-extrabold opacity-80">Study today · ${esc(name)}</div>
        <div class="rounded-full bg-white/20 px-3 py-1 text-xs font-extrabold">🔥 ${t.streak}-day streak</div></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-6xl font-extrabold tabular-nums">${todo}</span><span class="text-lg font-bold opacity-80">${todo === 1 ? "card" : "cards"} to study</span></div>
      <div class="mt-1 text-sm font-semibold opacity-80">${k.due} due · ${k.learning} relearning · ${k.newAvailable} new</div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold"><span class="opacity-80" title="How many brand-new cards you are shown each day. Raise it when an exam is close.">New cards a day</span>${[10, 20, 30, 50, 100].map((n) => `<button data-newlimit="${n}" class="rounded-lg px-2.5 py-1 font-extrabold transition ${t.newPerDay === n ? "bg-white text-brand-700" : "bg-white/20 text-white hover:bg-white/30"}">${n}</button>`).join("")}</div>
      <button id="startStudy" ${todo ? "" : "disabled"} class="mt-5 rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-brand-700 shadow-card transition hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:hover:translate-y-0">${todo ? "Start session →" : k.total ? "All caught up 🎉" : "No cards yet"}</button>
    </div>

    <div class="grid grid-cols-3 gap-3">${statTile("Due now", k.due + k.learning, "text-brand-600 dark:text-brand-300")}${statTile("New today", k.newAvailable, "text-emerald-600 dark:text-emerald-300")}${statTile("All cards", k.total, "text-slate-700 dark:text-slate-200")}</div>

    <div class="grid gap-4 sm:grid-cols-5">
      <div class="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 sm:col-span-3 dark:bg-ink-800 dark:ring-ink-600"><div class="mb-3 text-xs font-extrabold uppercase tracking-wider text-slate-400">Next 7 days</div><div class="flex gap-2">${bars}</div></div>
      <div class="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 sm:col-span-2 dark:bg-ink-800 dark:ring-ink-600"><div class="mb-3 text-xs font-extrabold uppercase tracking-wider text-slate-400">Last 7 days</div>
        ${acc.reviews ? `<div class="text-4xl font-extrabold tabular-nums">${acc.pct}%</div><div class="mt-1 text-xs font-semibold text-slate-400">remembered, across ${plural(acc.reviews, "review")}</div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full bg-emerald-500" style="width:${acc.pct}%"></div></div>` : '<div class="text-sm font-semibold text-slate-400">No reviews yet. Your first session starts the chart. ✨</div>'}</div>
    </div>
    <div class="flex flex-wrap gap-2">
      <button data-match-start class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold shadow-card hover:bg-slate-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700">🎮 Match game</button>
      <a href="/api/study/export/anki?course=${encodeURIComponent(state.course)}" download class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold shadow-card hover:bg-slate-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700" title="A text file you can import into Anki (File → Import)">⬇ Anki file</a>
      <button data-backup-now class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold shadow-card hover:bg-slate-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700" title="A safety copy of your cards, history, quizzes and exams">💾 Back up my data</button>
      <button data-trash-open class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold shadow-card hover:bg-slate-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700" title="Deleted cards, questions and problems. Kept for 30 days.">🗑 Trash</button>
      <span id="studyToolMsg" class="self-center text-xs font-semibold text-slate-400"></span></div>
    <div id="genPanel">${genPanelHtml("cards")}</div>

    <div class="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
      <div class="text-xs font-extrabold uppercase tracking-wider text-slate-400">Add a card by hand</div>
      <form id="cardForm" class="mt-3 space-y-2">
        ${picker}
        <input id="cardFront" required maxlength="600" placeholder="Front: a question or term" class="w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" />
        <textarea id="cardBack" required maxlength="2000" rows="2" placeholder="Back: the answer" class="w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600"></textarea>
        <input id="cardQuote" maxlength="400" placeholder="Optional: a line from your notes as the receipt" class="w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600" />
        <div class="flex items-center justify-between"><span id="cardError" class="text-xs text-red-600 dark:text-red-400"></span><button class="rounded-xl bg-brand-500 px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600">Add card</button></div>
      </form>
    </div>

    ${cardsHtml ? `<div class="rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600"><div class="px-3 pt-2 pb-1 text-xs font-extrabold uppercase tracking-wider text-slate-400">Your cards (${k.total})</div>${cardsHtml}</div>` : ""}
  </div>`;
}

export async function startStudySession() {
  const res = await fetch(`/api/study/session?course=${encodeURIComponent(state.course)}&limit=120`);
  if (!res.ok) return;
  const queue = await res.json();
  if (!queue.length) return loadStudyToday();
  Object.assign(S, { mode: "play", queue, idx: 0, revealed: false, reviewed: 0, correct: 0, t0: Date.now(), cardT0: Date.now(), busy: false });
  renderStudy();
}

export function exitStudySession() {
  S.mode = "home";
  Promise.all([loadStudyToday(), refreshState()]);
  renderStudy();
}

export function renderPlayer() {
  const card = S.queue[S.idx];
  if (!card) return finishStudySession();
  const total = S.queue.length;
  const pct = Math.round((100 * S.idx) / total);
  const receipt = S.revealed && card.quote
    ? `<div class="mt-5 w-full max-w-lg rounded-2xl bg-sun/20 px-4 py-3 text-left text-xs leading-relaxed text-amber-900 dark:text-sun"><div class="mb-1 text-[10px] font-extrabold uppercase tracking-wider opacity-70">From your notes</div>“${esc(card.quote)}”
        ${card.noteId ? `<button data-open-note="${esc(card.noteId)}" data-quote="${esc(card.quote)}" class="mt-1.5 block font-extrabold underline">Open the note →</button>` : ""}</div>`
    : "";
  const buttons = S.revealed
    ? `<div class="grid grid-cols-4 gap-2 md:gap-3">${card.previews.map((p) => `<button data-grade="${p.grade}" class="rounded-2xl ${GRADE_STYLE[p.grade]} px-2 py-3 text-white shadow-card transition active:scale-95">
        <span class="block text-sm font-extrabold">${GRADE_LABEL[p.grade]}</span><span class="block text-[11px] font-semibold opacity-80">${esc(p.label)}</span><span class="mt-0.5 hidden text-[10px] font-bold opacity-60 sm:block">press ${p.grade}</span></button>`).join("")}</div>`
    : `<button id="revealBtn" class="w-full rounded-2xl bg-brand-500 py-4 text-base font-extrabold text-white shadow-card transition hover:bg-brand-600 active:scale-[0.99]">Show answer <span class="ml-1 text-xs font-bold opacity-70">(Space)</span></button>`;

  $("studyBody").innerHTML = `<div class="mx-auto max-w-2xl space-y-4">
    <div class="flex items-center gap-3"><button id="exitStudy" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-700">← Back</button>
      <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-ink-700"><div class="h-full rounded-full bg-brand-500 transition-all" style="width:${pct}%"></div></div>
      <span class="text-xs font-extrabold tabular-nums text-slate-400">${S.idx + 1} / ${total}</span></div>
    <div class="flip flex min-h-[18rem] flex-col items-center justify-center rounded-3xl bg-white p-6 text-center shadow-pop ring-1 ring-slate-200/70 md:p-10 dark:bg-ink-800 dark:ring-ink-600">
      <div class="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400"><span class="rounded-full px-2 py-0.5 ${palette(card.course).tile} ${palette(card.course).text}">${esc(card.course)}</span>${esc(S.revealed ? "Answer" : STATE_LABEL[card.state] === "New" ? "New card" : "Question")}</div>
      <div class="text-2xl leading-snug font-extrabold md:text-3xl">${esc(card.front)}</div>
      ${S.revealed ? `<div class="my-5 h-px w-24 bg-slate-200 dark:bg-ink-600"></div><div class="whitespace-pre-wrap text-lg leading-relaxed text-slate-700 dark:text-slate-200">${esc(card.back)}</div>${receipt}` : ""}
    </div>
    ${CT.editing ? "" : buttons}
    ${S.revealed ? cardToolsHtml(card) : ""}
    <div class="text-center text-[11px] font-semibold text-slate-400">Be honest. The scheduler uses your rating to decide when you see this again. Esc to leave.</div>
  </div>`;
}

export function revealCard() {
  if (S.mode !== "play" || S.revealed) return;
  S.revealed = true;
  renderPlayer();
}

export async function rateCard(grade) {
  const card = S.queue[S.idx];
  if (S.mode !== "play" || !S.revealed || !card || S.busy) return;
  S.busy = true;
  try {
    const res = await fetch("/api/study/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId: card.id, grade, msTaken: Date.now() - S.cardT0 }) });
    const d = await res.json();
    if (!res.ok) { alert(d.error || "Couldn't save that review."); return; }
    S.reviewed++;
    if (grade >= 2) S.correct++;
    state.streak = d.streak;
    // A missed card comes back in a few minutes, so it returns later in this same session.
    const requeued = d.card.due - Date.now() < REQUEUE_WITHIN_MS;
    if (requeued) S.queue.push({ ...card, ...d.card, previews: d.previews });
    CT.editing = false;
    CT.flagging = false;
    offerUndo(card, grade, requeued);
    S.idx++;
    S.revealed = false;
    S.cardT0 = Date.now();
    if (S.idx >= S.queue.length) return finishStudySession();
    renderPlayer();
  } finally {
    S.busy = false;
  }
}

export async function finishStudySession() {
  S.mode = "done";
  // Wait for fresh counts so "study more" reflects what's really due now.
  await Promise.all([loadStudyToday(), refreshState()]);
  if (S.mode === "done") renderDone();
}

export function renderDone() {
  const secs = Math.max(1, Math.round((Date.now() - S.t0) / 1000));
  const pct = S.reviewed ? Math.round((100 * S.correct) / S.reviewed) : 0;
  const more = S.today ? S.today.counts.due + S.today.counts.learning + S.today.counts.newAvailable : 0;
  const burst = ["🎉", "✨", "⭐", "🎊", "💫", "🧠", "🔥", "✨", "🎉", "⭐"].map((e, i) => `<span style="--x:${(i - 4.5) * 34}px;--r:${(i % 2 ? 1 : -1) * (20 + i * 9)}deg;animation-delay:${i * 40}ms">${e}</span>`).join("");
  $("studyBody").innerHTML = `<div class="relative mx-auto max-w-md overflow-hidden rounded-3xl bg-white p-8 text-center shadow-pop ring-1 ring-slate-200/70 fade-in dark:bg-ink-800 dark:ring-ink-600">
    <div class="confetti">${burst}</div>
    <div class="text-6xl">🎉</div><h2 class="mt-3 text-3xl font-extrabold tracking-tight">Session complete!</h2>
    <p class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">${S.reviewed ? "Every review makes the next one easier to remember." : "Nothing to review right now."}</p>
    <div class="mt-6 grid grid-cols-3 gap-3">${statTile("Reviewed", S.reviewed, "text-brand-600 dark:text-brand-300")}${statTile("Remembered", S.reviewed ? pct + "%" : "–", "text-emerald-600 dark:text-emerald-300")}${statTile("Time", Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0"), "text-slate-700 dark:text-slate-200")}</div>
    <div class="mt-4 inline-block rounded-full bg-sun/30 px-4 py-1.5 text-sm font-extrabold text-amber-800 dark:text-sun">🔥 ${state.streak}-day streak</div>
    <div class="mt-6 flex justify-center gap-3"><button id="exitStudy" class="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Back to Study</button>
      ${more ? `<button id="startStudy" class="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-600">Study ${plural(more, "more card")} →</button>` : ""}</div></div>`;
}

export async function submitCard(e) {
  e.preventDefault();
  const course = $("cardCourse") ? $("cardCourse").value : state.course;
  const body = { course, front: $("cardFront").value, back: $("cardBack").value, quote: $("cardQuote").value };
  const res = await fetch("/api/study/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { $("cardError").textContent = d.error || "Couldn't add that card."; return; }
  await loadStudyToday();
  $("cardFront")?.focus();
}
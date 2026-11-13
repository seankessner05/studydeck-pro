import { $, S, api, btnGhost, btnPrimary, courseName, esc, fmtDate, palette, panelCls, plural, state, toneOf } from "./core.js";
import { subSwitch } from "./quiz.js";
import { refreshAi } from "./panels.js";

// =============================================================== teach-back tutor
export const TUT = { mode: "home", pick: null, topics: [], showAll: false, session: null, input: "", busy: false, error: "", history: [], progress: null, summary: null, score: null, done: false, round: 0 };

export async function loadTutorHome() {
  const r = await api(`/api/study/tutor/history?course=${encodeURIComponent(state.course)}`);
  TUT.history = r.ok ? r.data : [];
  if (state.view === "study" && S.sub === "tutor" && TUT.mode === "home") renderTutor();
}

export function renderTutor() {
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
export const MAX_TUTOR_ROUNDS = 3;

export async function pickTutorLecture(id) {
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

export async function startTutorSession() {
  const t = TUT.topics[TUT.topicIdx];
  if (!t) return;
  const r = await api("/api/study/tutor/start", "POST", { noteId: TUT.pick, topic: t.topic });
  if (!r.ok) { TUT.error = r.data.error || "Couldn't start."; return renderTutor(); }
  Object.assign(TUT, { mode: "chat", session: r.data, input: "", busy: false, error: "", progress: null, summary: null, score: null, done: false, round: 0 });
  renderTutor();
}

export function renderTutorChat() {
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

export async function sendTutor() {
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
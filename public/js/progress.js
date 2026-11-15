import { icon } from "./icons.js";
import { $, S, api, barOf, btnGhost, btnPrimary, esc, fmtDate, loadingHtml, palette, panelCls, plural, state, toneOf } from "./core.js";
import { selectCourse } from "./shell.js";
import { loadStudyToday, renderStudy, startStudySession } from "./cards.js";
import { loadGenPlan, updateGenPanel } from "./generate.js";
import { startQuiz, subSwitch } from "./quiz.js";
import { startPractice } from "./problems.js";
import { TUT, loadTutorHome, pickTutorLecture } from "./tutor.js";
import { EXM, dayChip, loadExamHome, startMockExam } from "./exams.js";

// =============================================================== progress
export const PG = { data: null, plan: null, minutes: 45, loading: false, openLecture: null, backupMsg: "" };

export async function loadProgress() {
  PG.loading = true;
  const c = encodeURIComponent(state.course);
  const [p, pl, bk] = await Promise.all([api(`/api/study/progress?course=${c}`), api(`/api/study/plan?course=${c}&minutes=${PG.minutes}`), api("/api/study/backups")]);
  PG.loading = false;
  PG.data = p.ok ? p.data : null;
  PG.plan = pl.ok ? pl.data : null;
  PG.backups = bk.ok ? bk.data : [];
  if (state.view === "study" && S.sub === "progress") renderProgress();
}

export const PLAN_ICON = { generate: icon("sparkles"), cards: icon("cards"), quiz: icon("quiz"), problems: icon("problems"), tutor: icon("tutor"), exam: icon("exam") };
export const LEVEL_LABEL = { unknown: "not practiced yet", weak: "needs work", shaky: "getting there", solid: "solid" };

export function masteryBar(m) {
  if (m.score === null) return `<span class="text-xs font-semibold text-slate-400">${m.answers ? "too little practice to judge" : "not practiced yet"}</span>`;
  const pct = Math.round(m.score * 100);
  return `<div class="flex items-center gap-2"><div class="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full ${barOf(pct)}" style="width:${Math.max(4, pct)}%"></div></div><span class="w-9 text-right text-xs font-extrabold tabular-nums ${toneOf(pct)}">${pct}%</span></div>`;
}

export function renderProgress() {
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
    <div class="${panelCls} flex flex-wrap items-center gap-3"><button data-backup-now class="${btnGhost}">${icon("save", "mr-1 h-4 w-4")}Back up my study data</button><button data-restore-open class="${btnGhost}">Restore a backup…</button><span id="studyToolMsg" class="text-xs font-semibold text-slate-400">${last ? `Last backup: ${new Date(last.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. A copy is made automatically once a day.` : "No backups yet. One is made automatically once a day."}</span></div>
  </div>`;
}

export async function runPlanItem(i) {
  const it = PG.plan.items[i];
  if (it) return startPlanStep(it);
}

/** Open whatever a plan step needs: a card session, a quiz or problems on its lectures, the tutor, the Exam tab. */
export async function startPlanStep(it) {
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
  if (it.kind === "exam") { EXM.mode = "home"; S.sub = "exam"; renderStudy(); return loadExamHome(); }
}
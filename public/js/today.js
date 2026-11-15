import { icon } from "./icons.js";
// ---- Today: one place to start, across every class ----
// Shows the next exams with readiness and what would raise it, and one Start button that walks today's plan step by
// step. While a run is going, a bar above the study area says which step you're on, with Next and Stop.
import { $, S, api, btnGhost, btnPrimary, esc, fmtNum, palette, panelCls, plural, state, toneOf } from "./core.js";
import { subSwitch } from "./quiz.js";
import { startPlanStep } from "./progress.js";

const RUN_KEY = "today-run";
const MIN_KEY = "today-minutes";
const KIND_ICON = { generate: "sparkles", cards: "cards", quiz: "quiz", problems: "problems", tutor: "tutor", exam: "exam" };
const todayKey = () => new Date().toLocaleDateString("en-CA");

export const TD = { minutes: 45, plan: null, today: null, loading: false, run: null, summary: null };
try { TD.minutes = Number(localStorage.getItem(MIN_KEY)) || 45; } catch {}

function saveRun() {
  try { TD.run ? localStorage.setItem(RUN_KEY, JSON.stringify(TD.run)) : localStorage.removeItem(RUN_KEY); } catch {}
}
function loadRun() {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    TD.run = r && r.date === todayKey() ? r : null;
  } catch { TD.run = null; }
}
loadRun();

export async function loadToday() {
  TD.loading = true;
  const [p, t] = await Promise.all([api(`/api/study/plan?course=all&minutes=${TD.minutes}`), api("/api/study/today?course=all")]);
  TD.loading = false;
  TD.plan = p.ok ? p.data : null;
  TD.today = t.ok ? t.data : null;
  if (state.view === "study" && S.sub === "today") renderToday();
}

const confidenceWord = { low: "rough guess", medium: "fair estimate", high: "solid estimate" };

function examCardHtml(p) {
  const r = p.readiness;
  const pct = Math.round(r.score * 100);
  const when = p.daysLeft === 0 ? "today" : p.daysLeft === 1 ? "tomorrow" : `in ${p.daysLeft} days`;
  return `<div class="${panelCls} space-y-2">
      <div class="flex flex-wrap items-center gap-2"><span class="text-lg font-extrabold">${esc(p.exam.name)}</span><span class="rounded-full px-2 py-0.5 text-[10px] font-extrabold ${palette(p.exam.course).tile} ${palette(p.exam.course).text}">${esc(p.exam.course)}</span><span class="text-sm font-bold text-slate-500 dark:text-slate-400">${when}</span></div>
      ${r.practiced === 0
        ? `<div class="flex items-baseline gap-3"><span class="text-xl font-extrabold text-slate-500 dark:text-slate-300">Not measured yet</span><span class="text-xs font-semibold text-slate-500 dark:text-slate-400">none of the ${plural(r.lectures, "lecture")} practiced</span></div>`
        : `<div class="flex items-baseline gap-3"><span class="text-3xl font-extrabold tabular-nums ${toneOf(pct)}">${pct}%</span><span class="text-xs font-semibold text-slate-500 dark:text-slate-400">ready · ${confidenceWord[r.confidence]} from ${plural(r.answers, "answer")}, ${r.practiced} of ${plural(r.lectures, "lecture")} practiced</span></div>`}
      <p class="text-sm font-medium text-slate-600 dark:text-slate-300"><b>To raise it:</b> ${esc(p.next)}</p>
    </div>`;
}

function stepsHtml(items, run) {
  return `<ol class="space-y-1">${items.map((it, i) => {
    const done = run && run.done.includes(i);
    const current = run && !done && run.idx === i;
    return `<li class="flex items-center gap-3 rounded-xl px-3 py-2.5 ${current ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/15 dark:ring-brand-500/30" : ""}">
        <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500 dark:bg-ink-700 dark:text-slate-300"}" aria-hidden="true">${done ? "✓" : i + 1}</span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-bold ${done ? "text-slate-400 line-through" : ""}">${icon(KIND_ICON[it.kind] ?? "", "mr-1 h-4 w-4 text-slate-400")}${esc(it.title)} <span class="text-[10px] font-extrabold text-slate-400">${esc(it.course)}</span></span><span class="block text-xs text-slate-500 dark:text-slate-400">${esc(it.detail)}</span></span>
        <span class="shrink-0 text-xs font-bold text-slate-400">${it.minutes} min</span>
        <span class="sr-only">${done ? "done" : current ? "next up" : ""}</span>
      </li>`;
  }).join("")}</ol>`;
}

export function renderToday() {
  const p = TD.plan;
  const head = `<div class="space-y-5 fade-in">${subSwitch()}`;
  if (!p) { $("studyBody").innerHTML = `${head}<div class="py-20 text-center text-slate-400"><span class="dots"><span></span><span></span><span></span></span></div></div>`; return; }
  if (TD.summary) return renderSummary();
  const run = TD.run;
  const items = run ? run.steps : p.items;
  const doneCount = run ? run.done.length : 0;
  const cram = p.cram;
  const cramNew = TD.today?.cram?.newPerDay;
  const mins = [20, 30, 45, 60, 90].map((m) => `<button data-today-min="${m}" class="min-h-10 rounded-xl px-3 text-xs font-extrabold ${TD.minutes === m ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-200"}" aria-pressed="${TD.minutes === m}">${m} min</button>`).join("");
  $("studyBody").innerHTML = `${head}
    ${cram ? `<div class="rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 p-4 text-white shadow-card" role="status"><div class="text-sm font-extrabold">Cram mode: ${esc(cram.name)} (${esc(cram.course)}) ${cram.daysLeft === 0 ? "is today" : cram.daysLeft === 1 ? "is tomorrow" : `is in ${cram.daysLeft} days`}</div>
      <div class="mt-1 text-xs font-semibold opacity-90">Today's plan leads with that exam's weakest topics, keeps card rounds short${cramNew ? `, allows up to ${cramNew} new ${esc(cram.course)} cards` : ""}, and skips anything that spends Claude usage on making new material. A mock exam in the professor's format is on the Exam tab.</div></div>` : ""}
    ${p.plans.length ? `<div class="grid gap-3 sm:grid-cols-2">${p.plans.slice(0, 4).map(examCardHtml).join("")}</div>` : `<div class="${panelCls} text-sm font-semibold text-slate-500">No exams on your list. Add one on the Exam tab and today's plan will aim at it.</div>`}
    <div class="${panelCls} space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-xl font-extrabold">Today's plan</h2><p class="text-xs font-semibold text-slate-500 dark:text-slate-400">${run ? `${doneCount} of ${plural(items.length, "step")} done` : `${p.totalMinutes} of your ${p.budget} minutes, every class, soonest exam first`}</p></div>
        ${run ? "" : `<div class="flex flex-wrap gap-1.5" role="group" aria-label="How much time do you have">${mins}</div>`}
      </div>
      ${items.length ? stepsHtml(items, run) : `<p class="text-sm font-semibold text-slate-500">Nothing to do right now. Nice.</p>`}
      ${!run && p.optional?.length ? `<div class="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">${p.optional.map((o, i) => `<div class="flex flex-wrap items-center gap-2"><span class="min-w-0 flex-1">${esc(o.title)} (${esc(o.course)}): ${esc(o.detail)}</span><button data-today-optional="${i}" class="min-h-10 rounded-lg bg-amber-200/70 px-3 font-extrabold text-amber-950 hover:bg-amber-200 dark:bg-amber-400/20 dark:text-amber-100">Make it</button></div>`).join("")}</div>` : ""}
      ${items.length ? `<div class="flex flex-wrap gap-3">${run
        ? `<button data-today-resume class="${btnPrimary} min-h-12 !px-8 !text-base">Continue: step ${Math.min(run.idx + 1, items.length)} →</button><button data-today-stop class="${btnGhost} min-h-12">Start over</button>`
        : `<button data-today-start class="${btnPrimary} min-h-12 !px-8 !text-base">Start</button>`}</div>` : ""}
    </div>
  </div>`;
}

// ---------- running the plan ----------

function renderBar() {
  const bar = $("todayBar");
  if (!bar) return;
  const run = TD.run;
  if (!run || S.sub === "today" || run.idx >= run.steps.length) { bar.innerHTML = ""; bar.classList.add("hidden"); return; }
  const step = run.steps[run.idx];
  const last = run.idx === run.steps.length - 1;
  bar.classList.remove("hidden");
  bar.innerHTML = `<div class="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-2 md:px-8" role="region" aria-label="Today's plan">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-ink-700"><div class="h-full rounded-full bg-brand-500 transition-all" style="width:${Math.round((100 * run.done.length) / run.steps.length)}%"></div></div>
      <div class="min-w-0 flex-1 text-xs"><span class="font-extrabold text-brand-600 dark:text-brand-300">Today · step ${run.idx + 1} of ${run.steps.length}</span> <span class="font-semibold text-slate-600 dark:text-slate-300">${esc(step.title)}</span></div>
      <button data-today-next class="min-h-10 rounded-xl bg-brand-500 px-4 text-xs font-extrabold text-white hover:bg-brand-600">${last ? "Finish for today" : "Done, next step →"}</button>
      <button data-today-pause class="min-h-10 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-700">Pause</button>
    </div>`;
}

async function startRun() {
  const p = TD.plan;
  if (!p || !p.items.length) return;
  TD.run = {
    date: todayKey(), steps: p.items, idx: 0, done: [], startedAt: Date.now(),
    before: Object.fromEntries(p.plans.map((x) => [x.exam.id, x.readiness.score])),
  };
  saveRun();
  return goStep();
}

async function goStep() {
  const run = TD.run;
  if (!run) return;
  if (run.idx >= run.steps.length) return finishRun();
  renderBar();
  await startPlanStep(run.steps[run.idx]);
  renderBar();
}

async function nextStep() {
  const run = TD.run;
  if (!run) return;
  if (!run.done.includes(run.idx)) run.done.push(run.idx);
  run.idx++;
  saveRun();
  if (run.idx >= run.steps.length) return finishRun();
  return goStep();
}

async function finishRun() {
  const run = TD.run;
  S.sub = "today";
  renderBar();
  await loadToday();
  const p = TD.plan;
  TD.summary = {
    steps: run.done.length,
    minutes: Math.max(1, Math.round((Date.now() - run.startedAt) / 60000)),
    exams: (p?.plans ?? []).slice(0, 3).map((x) => ({ name: x.exam.name, course: x.exam.course, before: run.before[x.exam.id], after: x.readiness.score, next: x.next, daysLeft: x.daysLeft })),
    tomorrow: TD.today?.forecast?.[1] ?? 0,
  };
  TD.run = null;
  saveRun();
  renderToday();
}

function renderSummary() {
  const s = TD.summary;
  $("studyBody").innerHTML = `<div class="space-y-5 fade-in">${subSwitch()}
    <div class="${panelCls} space-y-4 text-center !p-8">
      <div class="text-5xl" aria-hidden="true">🎉</div>
      <h2 class="text-2xl font-extrabold">Done for today</h2>
      <p class="text-sm font-semibold text-slate-500 dark:text-slate-400">${plural(s.steps, "step")} in about ${plural(s.minutes, "minute")}.</p>
      <div class="mx-auto max-w-md space-y-3 text-left">${s.exams.map((e) => {
        const b = e.before === undefined ? null : Math.round(e.before * 100);
        const a = Math.round(e.after * 100);
        return `<div class="rounded-2xl bg-slate-50 p-3 dark:bg-ink-700/50"><div class="text-sm font-extrabold">${esc(e.name)} <span class="text-[10px] text-slate-400">${esc(e.course)}</span></div>
          <div class="text-sm">Readiness ${b === null ? "" : `${b}% → `}<b class="${toneOf(a)}">${a}%</b>${b !== null && a !== b ? ` (${a > b ? "+" : ""}${a - b})` : ""}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400">Next: ${esc(e.next)}</div></div>`;
      }).join("")}</div>
      <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Tomorrow: ${s.tomorrow ? `${plural(s.tomorrow, "card")} come due.` : "no cards are due yet."}</p>
      <button data-today-again class="${btnGhost}">Back to today's plan</button>
    </div></div>`;
}

export function init() {
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-today-start],[data-today-resume],[data-today-stop],[data-today-next],[data-today-pause],[data-today-min],[data-today-again],[data-today-optional]");
    if (!t) return;
    if (t.hasAttribute("data-today-start")) return startRun();
    if (t.dataset.todayOptional) return startPlanStep(TD.plan.optional[Number(t.dataset.todayOptional)]);
    if (t.hasAttribute("data-today-resume")) return goStep();
    if (t.hasAttribute("data-today-next")) return nextStep();
    if (t.hasAttribute("data-today-pause")) { S.sub = "today"; renderBar(); return loadToday(); }
    if (t.hasAttribute("data-today-stop")) { if (!confirm("Start today's plan over?")) return; TD.run = null; saveRun(); return loadToday(); }
    if (t.hasAttribute("data-today-again")) { TD.summary = null; return loadToday(); }
    if (t.dataset.todayMin) {
      TD.minutes = Number(t.dataset.todayMin);
      try { localStorage.setItem(MIN_KEY, String(TD.minutes)); } catch {}
      return loadToday();
    }
  });
}

export { renderBar as renderTodayBar, fmtNum as _fmtNum };

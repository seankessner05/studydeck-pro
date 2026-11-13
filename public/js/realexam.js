// ---- Mock exams in the professor's own format, with brand-new questions ----
// The server writes the exam (a few minutes), checks every part, and never sends keys before hand-in.
import { $, S, api, btnGhost, btnPrimary, esc, fmtNum, mmss, panelCls, plural, state, toneOf } from "./core.js";
import { subSwitch } from "./quiz.js";
import { refreshAi } from "./panels.js";
import { loadExamHome, renderExam } from "./exams.js";

export const RX = { mode: null, blueprints: {}, past: [], job: null, sitting: null, answers: {}, error: "", timer: null, grading: false };

const SHIFT_LABEL = { right: "Right", left: "Left", up: "Up", down: "Down", steeper: "Steeper", flatter: "Flatter", none: "No shift" };
const EFFECT_LABEL = { up: "Rises", down: "Falls", same: "No change" };
const store = (id) => `real-exam-${id}`;
const saveLocal = () => { try { if (RX.sitting) localStorage.setItem(store(RX.sitting.id), JSON.stringify(RX.answers)); } catch {} };

/** Formats for the classes of the exams on screen, and past real-format mocks. */
export async function loadRealExamInfo(exams) {
  const courses = [...new Set(exams.map((e) => e.course))];
  const found = await Promise.all(courses.map((c) => api(`/api/study/styled/blueprint?course=${encodeURIComponent(c)}`)));
  RX.blueprints = Object.fromEntries(courses.map((c, i) => [c, found[i].ok ? found[i].data : null]));
  const past = await api(`/api/study/styled?course=${encodeURIComponent(state.course)}`);
  RX.past = past.ok ? past.data : [];
}

/** The extra button and history on an exam card. Empty when the class has no exam format. */
export function realExamCardHtml(e) {
  const b = RX.blueprints[e.course];
  if (!b) return "";
  const mine = RX.past.filter((p) => p.examId === e.id).slice(0, 4);
  return `<div class="rounded-2xl bg-gradient-to-br from-brand-50 to-fuchsia-50 p-4 ring-1 ring-brand-100 dark:from-brand-500/10 dark:to-fuchsia-500/10 dark:ring-brand-500/20">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0"><div class="text-sm font-extrabold">Mock exam in your professor's format</div>
          <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${b.minutes} min · ${fmtNum(b.points)} points · ${b.sections.map((s) => esc(s.title.replace(/^Section \d+:\s*/, ""))).join(" + ")} · brand-new questions every time</div></div>
        <button data-rx-build="${esc(e.id)}" class="${btnPrimary} min-h-11">Write me a new exam</button>
      </div>
      ${mine.length ? `<div class="mt-3 flex flex-wrap gap-2 text-xs">${mine.map((p) => `<button data-rx-open="${esc(p.id)}" class="min-h-9 rounded-full bg-white px-3 font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-ink-800 dark:text-slate-300 dark:ring-ink-600">${new Date(p.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${p.finishedAt ? `${fmtNum(p.earned)} / ${fmtNum(p.max)}` : "not handed in"}</button>`).join("")}</div>` : ""}
    </div>`;
}

export function realExamActive() {
  return RX.mode !== null;
}

export function renderRealExam() {
  if (RX.mode === "building") return renderBuilding();
  if (RX.mode === "take") return renderTake();
  if (RX.mode === "results") return renderResults();
}

function leave() {
  clearInterval(RX.timer);
  RX.mode = null;
  RX.sitting = null;
  RX.job = null;
  RX.error = "";
  loadExamHome().then(renderExam);
}

// ---------- building ----------
async function build(examId) {
  RX.mode = "building";
  RX.error = "";
  RX.job = { step: "Starting", seconds: 0 };
  renderBuilding();
  const r = await api("/api/study/styled/build", "POST", { examId });
  if (!r.ok) { RX.error = r.data.error || "The exam couldn't be started."; return renderBuilding(); }
  const jobId = r.data.jobId;
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 2500));
    if (RX.mode !== "building") return;
    const s = await api(`/api/study/styled/build/${encodeURIComponent(jobId)}`);
    if (!s.ok) { RX.error = s.data.error || "Lost track of the exam being written."; return renderBuilding(); }
    RX.job = s.data;
    if (s.data.state === "running") { renderBuilding(); continue; }
    refreshAi();
    if (s.data.state === "error") { RX.error = s.data.error || "The exam couldn't be written."; return renderBuilding(); }
    return open(s.data.sittingId, s.data.warnings || []);
  }
}

function renderBuilding() {
  const j = RX.job || {};
  $("studyBody").innerHTML = `<div class="mx-auto max-w-lg py-14 text-center" role="status" aria-live="polite">
    ${RX.error ? `<div class="text-5xl" aria-hidden="true">😕</div><h2 class="mt-4 text-2xl font-extrabold">That didn't work</h2><p class="mt-2 text-sm font-semibold text-red-700 dark:text-red-300">${esc(RX.error)}</p><button data-rx-leave class="${btnGhost} mt-6">Back to exams</button>`
      : `<div class="text-6xl animate-pulse" aria-hidden="true">📝</div><h2 class="mt-4 text-2xl font-extrabold">Writing your exam…</h2>
    <p class="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">${esc(j.step || "Starting")}${j.seconds ? ` · ${mmss(j.seconds * 1000)}` : ""}</p>
    <p class="mt-6 text-xs font-medium text-slate-400">This takes a few minutes. Claude writes new questions in your professor's format from the lectures this exam covers. The app computes every number itself, and a second solve with no notes has to get the same answers, or the question is rewritten.</p>
    <button data-rx-leave class="${btnGhost} mt-6">Cancel</button>`}
  </div>`;
}

// ---------- taking ----------
async function open(id, warnings = []) {
  const r = await api(`/api/study/styled/${encodeURIComponent(id)}`);
  if (!r.ok) { RX.mode = "building"; RX.error = r.data.error || "That exam couldn't be opened."; return renderBuilding(); }
  RX.sitting = r.data;
  RX.warnings = warnings;
  if (r.data.finishedAt) { RX.mode = "results"; return renderResults(); }
  try { RX.answers = JSON.parse(localStorage.getItem(store(id)) || "{}"); } catch { RX.answers = {}; }
  RX.mode = "take";
  renderTake();
  clearInterval(RX.timer);
  RX.timer = setInterval(tick, 1000);
}

const deadline = () => RX.sitting.startedAt + RX.sitting.exam.minutes * 60_000;
function tick() {
  if (RX.mode !== "take" || !RX.sitting) return clearInterval(RX.timer);
  const left = deadline() - Date.now();
  const el = $("rxTimer");
  if (el) {
    el.textContent = mmss(left);
    el.classList.toggle("text-red-600", left < 5 * 60_000);
  }
  if (left <= 0) { clearInterval(RX.timer); handIn(true); }
}

const isAnswered = (p) => {
  const a = RX.answers[p.id];
  if (p.kind === "graph") return !!a && [...Object.values(a.curves || {}), ...Object.values(a.effects || {})].some(Boolean);
  return typeof a === "string" && a.trim() !== "";
};

function partInput(p) {
  const a = RX.answers[p.id];
  if (p.kind === "number") {
    return `<label class="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold"><span class="sr-only">Your answer to ${esc(p.label)}</span>
      <input data-rx-in="${esc(p.id)}" inputmode="decimal" autocomplete="off" value="${esc(a ?? "")}" placeholder="Your answer" class="min-h-11 w-48 rounded-xl border border-slate-200 bg-transparent px-3 text-base font-bold tabular-nums dark:border-ink-600" />
      ${p.unit ? `<span class="text-slate-500">${esc(p.unit)}</span>` : ""}</label>
      <p class="mt-1 text-[11px] font-medium text-slate-400">A number. Within 1% of the exact answer counts, so keep enough decimals.</p>`;
  }
  if (p.kind === "written") {
    return `<textarea data-rx-in="${esc(p.id)}" rows="5" aria-label="Your answer to ${esc(p.label)}" placeholder="Your answer, in your own words" class="mt-2 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm leading-relaxed dark:border-ink-600">${esc(a ?? "")}</textarea>`;
  }
  const g = a || { curves: {}, effects: {} };
  const group = (kind, name, options, labels, picked) => `<div role="radiogroup" aria-label="${esc(name)}" class="flex flex-wrap gap-1.5">${options.map((o) => `<button type="button" role="radio" aria-checked="${picked === o}" data-rx-graph="${esc(p.id)}|${kind}|${esc(name)}|${o}" class="min-h-10 rounded-xl px-3 text-xs font-extrabold transition ${picked === o ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-200 dark:hover:bg-ink-600"}">${labels[o] || o}</button>`).join("")}</div>`;
  return `<div class="mt-3 space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-ink-700/50">
      <div class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">On the ${esc(p.graph)} graph</div>
      ${p.curves.map((c) => `<div class="flex flex-wrap items-center gap-2"><span class="w-28 shrink-0 text-sm font-bold">${esc(c.name)} curve</span>${group("curves", c.name, c.choices, SHIFT_LABEL, g.curves?.[c.name])}</div>`).join("")}
      ${p.effects.map((e) => `<div class="flex flex-wrap items-center gap-2"><span class="w-28 shrink-0 text-sm font-bold">${esc(e.name)}</span>${group("effects", e.name, ["up", "down", "same"], EFFECT_LABEL, g.effects?.[e.name])}</div>`).join("")}
      <p class="text-[11px] font-medium text-slate-400">On paper you'd draw and label this graph. Here you say what moves; each choice is graded.</p>
    </div>`;
}

function questionHtml(q, results) {
  return `<article class="${panelCls} space-y-4" aria-labelledby="rxq-${esc(q.id)}">
      <div class="flex items-baseline justify-between gap-3"><h3 id="rxq-${esc(q.id)}" class="text-lg font-extrabold">Question ${q.number}</h3><span class="text-xs font-extrabold text-slate-400">${plural(q.points, "point")}${results ? ` · ${fmtNum(q.parts.reduce((n, p) => n + (results.get(p.id)?.earned ?? 0), 0))} earned` : ""}</span></div>
      ${q.setup ? `<p class="whitespace-pre-line text-[15px] font-medium leading-relaxed">${esc(q.setup)}</p>` : ""}
      ${q.parts.map((p, i) => `<div class="border-t border-slate-100 pt-4 dark:border-ink-700">
        <p class="whitespace-pre-line text-[15px] leading-relaxed"><b>(${esc(p.label)})${i > 0 && q.parts[i - 1].label === p.label ? ", continued" : ""}</b> <span class="text-xs font-extrabold text-slate-400">${plural(p.points, "point")}</span> ${esc(p.prompt)}</p>
        ${results ? partResultHtml(p, results.get(p.id)) : partInput(p)}
      </div>`).join("")}
    </article>`;
}

function renderTake() {
  const s = RX.sitting;
  const ex = s.exam;
  const parts = ex.questions.flatMap((q) => q.parts);
  const done = parts.filter(isAnswered).length;
  const left = deadline() - Date.now();
  $("studyBody").innerHTML = `<div class="mx-auto max-w-3xl space-y-5">
    <div class="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl bg-white/90 px-4 py-3 shadow-card ring-1 ring-slate-200/70 backdrop-blur dark:bg-ink-800/90 dark:ring-ink-600">
      <div class="min-w-0 flex-1"><div class="truncate font-extrabold">${esc(s.title)}</div><div class="text-xs font-semibold text-slate-500 dark:text-slate-400"><span id="rxProgress">${done} of ${parts.length}</span> parts answered · saved on this computer as you type</div></div>
      <div class="text-right"><div id="rxTimer" class="text-xl font-extrabold tabular-nums" aria-label="Time left">${mmss(left)}</div><div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">left</div></div>
      <button data-rx-handin class="${btnPrimary} min-h-11">Hand in</button>
    </div>
    ${(RX.warnings || []).map((w) => `<div class="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" role="status">${esc(w)}</div>`).join("")}
    <p class="text-sm font-semibold text-slate-500 dark:text-slate-400">${esc(ex.instructions)}</p>
    ${ex.sections.map((sec, si) => {
      const qs = ex.questions.filter((q) => q.section === si + 1);
      if (!qs.length) return "";
      return `<section class="space-y-4"><div class="pt-2"><h2 class="text-xl font-extrabold">${esc(sec.title)}</h2><p class="text-xs font-semibold text-slate-500 dark:text-slate-400">${sec.choose ? `Answer any ${sec.choose}. ` : ""}${esc(sec.instructions)}</p></div>${qs.map((q) => questionHtml(q, null)).join("")}</section>`;
    }).join("")}
    <div class="pb-10 text-center"><button data-rx-handin class="${btnPrimary} min-h-12 !px-8">Hand in the exam</button></div>
  </div>`;
}

function updateProgress() {
  const parts = RX.sitting.exam.questions.flatMap((q) => q.parts);
  const el = $("rxProgress");
  if (el) el.textContent = `${parts.filter(isAnswered).length} of ${parts.length}`;
}

async function handIn(auto) {
  if (!RX.sitting || RX.mode !== "take") return;
  const parts = RX.sitting.exam.questions.flatMap((q) => q.parts);
  const blank = parts.filter((p) => !isAnswered(p)).length;
  if (!auto && !confirm(blank ? `${plural(blank, "part")} still blank. Hand in anyway?` : "Hand in your exam?")) return;
  clearInterval(RX.timer);
  $("studyBody").innerHTML = `<div class="mx-auto max-w-md py-20 text-center" role="status"><div class="text-6xl animate-pulse" aria-hidden="true">✅</div><h2 class="mt-4 text-2xl font-extrabold">${auto ? "Time's up. " : ""}Handing in…</h2></div>`;
  const r = await api(`/api/study/styled/${encodeURIComponent(RX.sitting.id)}/submit`, "POST", { answers: RX.answers });
  if (!r.ok) { RX.mode = "take"; renderTake(); return alert(r.data.error || "Couldn't hand in. Your answers are still here."); }
  try { localStorage.removeItem(store(RX.sitting.id)); } catch {}
  RX.sitting = r.data;
  RX.mode = "results";
  if (r.data.pendingWritten) return gradeWritten();
  renderResults();
}

async function gradeWritten() {
  RX.grading = true;
  RX.error = "";
  renderResults();
  const r = await api(`/api/study/styled/${encodeURIComponent(RX.sitting.id)}/grade-written`, "POST");
  RX.grading = false;
  if (r.ok) RX.sitting = r.data;
  else RX.error = r.data.error || "Your written answers couldn't be graded yet.";
  refreshAi();
  renderResults();
}

// ---------- results ----------
function partResultHtml(p, res) {
  if (!res) return "";
  const pts = `<span class="font-extrabold ${res.earned >= res.max ? "text-emerald-600 dark:text-emerald-300" : res.earned > 0 ? "text-amber-600 dark:text-sun" : "text-red-600 dark:text-red-400"}">${fmtNum(res.earned)} / ${fmtNum(res.max)}</span>`;
  if (p.kind === "number") {
    return `<div class="mt-2 space-y-2 text-sm">
        <div>${pts} · You answered <b>${res.submitted === null || res.submitted === undefined ? "nothing" : esc(fmtNum(res.submitted))}</b>; the answer is <b>${esc(fmtNum(p.answer))}${p.unit ? ` ${esc(p.unit)}` : ""}</b>.</div>
        <ol class="list-decimal space-y-1 rounded-xl bg-slate-50 py-2 pr-3 pl-8 text-xs dark:bg-ink-700/50">${p.steps.map((st) => `<li><b>${esc(st.label || st.name)}</b> = ${esc(fmtNum(st.value))} <span class="text-slate-400">(${esc(st.expr)})</span>${st.explain ? `<br><span class="text-slate-500 dark:text-slate-400">${esc(st.explain)}</span>` : ""}</li>`).join("")}</ol>
      </div>`;
  }
  if (p.kind === "graph") {
    const got = res.submitted || { curves: {}, effects: {} };
    const row = (name, mine, key, labels) => `<li class="flex flex-wrap gap-x-2"><span class="font-bold">${esc(name)}:</span><span class="${mine === key ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}">you said ${esc(labels[mine] || "nothing")}</span>${mine === key ? "" : `<span>· correct: <b>${esc(labels[key])}</b></span>`}</li>`;
    return `<div class="mt-2 space-y-2 text-sm"><div>${pts}</div>
        <ul class="space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-ink-700/50">${p.curves.map((c) => row(`${c.name} curve`, got.curves?.[c.name], c.key, SHIFT_LABEL)).join("")}${p.effects.map((e) => row(e.name, got.effects?.[e.name], e.key, EFFECT_LABEL)).join("")}</ul>
        ${p.why ? `<p class="text-xs text-slate-600 dark:text-slate-300"><b>Why:</b> ${esc(p.why)}</p>` : ""}
      </div>`;
  }
  return `<div class="mt-2 space-y-2 text-sm">
      <div>${res.graded ? pts : '<span class="font-semibold text-amber-600 dark:text-sun">Not graded yet</span>'}</div>
      <blockquote class="whitespace-pre-line rounded-xl border-l-4 border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-700/50">${res.submitted ? esc(res.submitted) : "<i>You left this blank.</i>"}</blockquote>
      ${res.points ? `<ul class="space-y-1 text-xs">${res.points.map((pt) => `<li class="flex gap-2"><span aria-hidden="true">${pt.met ? "✅" : "⬜"}</span><span><b>${esc(pt.text)}</b>${pt.met && pt.evidence ? `<br><span class="text-emerald-700 dark:text-emerald-300">You wrote: “${esc(pt.evidence)}”</span>` : ""}${pt.note ? `<br><span class="text-slate-400">${esc(pt.note)}</span>` : ""}</span></li>`).join("")}</ul>` : `<ul class="space-y-1 text-xs">${p.rubric.map((rp) => `<li>• ${esc(rp.text)}</li>`).join("")}</ul>`}
      ${res.remark ? `<p class="text-xs text-slate-600 dark:text-slate-300"><b>How to improve:</b> ${esc(res.remark)}</p>` : ""}
      ${p.model ? `<details class="text-xs"><summary class="cursor-pointer font-bold text-brand-600 dark:text-brand-300">A model answer</summary><p class="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-300">${esc(p.model)}</p></details>` : ""}
    </div>`;
}

function renderResults() {
  const s = RX.sitting;
  const ex = s.exam;
  const results = new Map((s.results || []).map((r) => [r.id, r]));
  const t = s.totals || { earned: 0, max: 0, sections: [] };
  const pct = t.max ? Math.round((100 * t.earned) / t.max) : 0;
  $("studyBody").innerHTML = `<div class="mx-auto max-w-3xl space-y-5 fade-in">
    <div class="${panelCls} text-center !p-8">
      <div class="text-sm font-extrabold text-slate-400">${esc(s.title)}</div>
      <div class="mt-2 text-5xl font-extrabold tabular-nums ${toneOf(pct)}">${fmtNum(t.earned)} <span class="text-2xl text-slate-400">/ ${fmtNum(t.max)}</span></div>
      <div class="mt-1 text-sm font-semibold text-slate-500">${pct}%${s.pendingWritten ? " so far: written answers still to grade" : ""}</div>
      <div class="mt-4 flex flex-wrap justify-center gap-2 text-xs">${t.sections.map((x) => `<span class="rounded-full bg-slate-100 px-3 py-1 font-bold dark:bg-ink-700">${esc(x.title.replace(/^Section \d+:\s*/, ""))}: ${fmtNum(x.earned)} / ${fmtNum(x.max)}</span>`).join("")}</div>
      ${RX.grading ? `<p class="mt-4 text-sm font-semibold text-brand-600 dark:text-brand-300" role="status">Grading your written answers point by point…</p>` : ""}
      ${RX.error ? `<p class="mt-4 text-sm font-semibold text-red-700 dark:text-red-300" role="alert">${esc(RX.error)}</p>` : ""}
      ${s.pendingWritten && !RX.grading ? `<button data-rx-grade class="${btnPrimary} mt-4">Grade my written answers</button>` : ""}
      <div class="mt-5"><button data-rx-leave class="${btnGhost}">Back to exams</button></div>
    </div>
    <p class="text-xs font-medium text-slate-500 dark:text-slate-400">Numbers count when within 1% of the app's own calculation. Graph answers earn a share of the part for each curve and variable you got right. Written answers earn a point only when the grader can quote the words in your answer that show it.</p>
    ${ex.sections.map((sec, si) => {
      const qs = ex.questions.filter((q) => q.section === si + 1);
      return qs.length ? `<section class="space-y-4"><h2 class="pt-2 text-xl font-extrabold">${esc(sec.title)}</h2>${qs.map((q) => questionHtml(q, results)).join("")}</section>` : "";
    }).join("")}
  </div>`;
}

export function init() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-rx-build],[data-rx-open],[data-rx-leave],[data-rx-handin],[data-rx-grade],[data-rx-graph]");
    if (!t) return;
    if (t.dataset.rxBuild) return build(t.dataset.rxBuild);
    if (t.dataset.rxOpen) return open(t.dataset.rxOpen);
    if (t.hasAttribute("data-rx-leave")) return leave();
    if (t.hasAttribute("data-rx-handin")) return handIn(false);
    if (t.hasAttribute("data-rx-grade")) return gradeWritten();
    if (t.dataset.rxGraph) {
      const [id, kind, name, value] = t.dataset.rxGraph.split("|");
      const a = (RX.answers[id] ||= { curves: {}, effects: {} });
      a[kind][name] = a[kind][name] === value ? undefined : value;
      saveLocal();
      // redraw just this group's buttons
      t.parentElement.querySelectorAll("[role=radio]").forEach((b) => {
        const on = b.dataset.rxGraph.endsWith(`|${a[kind][name]}`) && a[kind][name] !== undefined;
        b.setAttribute("aria-checked", String(on));
        b.className = `min-h-10 rounded-xl px-3 text-xs font-extrabold transition ${on ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-700 dark:text-slate-200 dark:hover:bg-ink-600"}`;
      });
      updateProgress();
    }
  });
  document.addEventListener("input", (e) => {
    const t = e.target.closest("[data-rx-in]");
    if (!t || RX.mode !== "take") return;
    RX.answers[t.dataset.rxIn] = t.value;
    saveLocal();
    updateProgress();
  });
}

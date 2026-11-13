import { $, S, api, barOf, btnGhost, btnPrimary, courseName, esc, fmtNum, fmtUnit, mmss, palette, panelCls, plural, state, toneOf } from "./core.js";
import { loadStudyToday } from "./cards.js";
import { KIND_LABEL, LETTER, subSwitch } from "./quiz.js";
import { refreshAi } from "./panels.js";

// =============================================================== exams and cheat sheets
export const EXM = { mode: "home", exams: [], history: [], sheets: [], form: { open: false, error: "", course: "", name: "Exam 2", date: "", from: "", to: "" }, preset: "standard", sitting: null, answers: {}, remaining: 0, timer: null, results: null, grading: false, error: "", warnings: [], sheet: null, busy: false, remarkFor: null, remarkText: "", remarkMsg: "" };
export const PRESET_INFO = { quick: ["Quick check", "6 multiple choice + 1 problem", "about 15 min"], standard: ["Standard", "12 multiple choice + 3 problems + 2 written", "about 45–60 min"], full: ["Full length", "20 multiple choice + 4 problems + 3 written", "about 75–90 min"] };

export async function loadExamHome() {
  const c = encodeURIComponent(state.course);
  const [e, h, s] = await Promise.all([api(`/api/study/exams?course=${c}`), api(`/api/study/exam/history?course=${c}`), api(`/api/study/sheets?course=${c}`)]);
  EXM.exams = e.ok ? e.data : [];
  EXM.history = h.ok ? h.data : [];
  EXM.sheets = s.ok ? s.data : [];
  if (state.view === "study" && S.sub === "exam" && EXM.mode === "home") renderExam();
}

export function renderExam() {
  if (EXM.mode === "building") return renderExamBuilding();
  if (EXM.mode === "take") return renderExamTake();
  if (EXM.mode === "results") return renderExamResults();
  if (EXM.mode === "sheet") return renderSheet();
  return renderExamHome();
}

export function dayChip(d) {
  const cls = d <= 1 ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" : d <= 4 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-sun" : "bg-slate-100 text-slate-600 dark:bg-ink-700 dark:text-slate-300";
  return `<span class="rounded-full px-2.5 py-0.5 text-xs font-extrabold ${cls}">${d === 0 ? "Today" : d === 1 ? "Tomorrow" : `in ${d} days`}</span>`;
}

export function renderExamHome() {
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

export function dateInput(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function saveExamForm() {
  const f = EXM.form;
  const course = state.course === "all" ? (f.course || (state.courses.find((c) => !c.archived && c.id !== "unsorted") || {}).id) : state.course;
  const r = await api("/api/study/exams", "POST", { course, name: f.name, date: f.date, from: f.from, to: f.to || null });
  if (!r.ok) { f.error = r.data.error || "Couldn't save that."; return renderExamHome(); }
  Object.assign(f, { open: false, error: "", name: "Exam 2", date: "", from: "", to: "" });
  await loadExamHome();
}

export async function startMockExam(examId) {
  EXM.error = "";
  EXM.mode = "building";
  renderExam();
  const r = await api("/api/study/exam/start", "POST", { examId, preset: EXM.preset });
  if (!r.ok) { EXM.mode = "home"; EXM.error = r.data.error || "Couldn't build the exam."; return renderExam(); }
  openSitting(r.data, r.data.warnings || []);
}

export function openSitting(s, warnings = []) {
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

export function renderExamBuilding() {
  $("studyBody").innerHTML = `<div class="mx-auto max-w-md py-20 text-center"><div class="text-6xl animate-pulse">📝</div><h2 class="mt-4 text-2xl font-extrabold">Building your exam…</h2>
    <p class="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Picking questions from every lecture it covers, and having Claude write the written questions from your notes. About 20 seconds.</p></div>`;
}

export const examAnswered = (it) => {
  const a = EXM.answers[it.id];
  return Array.isArray(a) ? a.length > 0 : typeof a === "string" ? a.trim().length > 0 : false;
};

export function examItemHtml(it, n) {
  const a = EXM.answers[it.id];
  const head = `<div class="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400"><span>Question ${n}</span><span>·</span><span>${it.points} ${it.points === 1 ? "point" : "points"}</span>${it.type === "mcq" ? `<span>· ${KIND_LABEL[it.kind]}</span>` : ""}</div>`;
  if (it.type === "mcq") {
    const picked = Array.isArray(a) ? a : [];
    return `${head}<div class="text-base leading-snug font-extrabold">${esc(it.stem)}</div><div class="mt-3 ${it.kind === "tf" ? "grid grid-cols-2" : "flex flex-col"} gap-2">${it.options.map((o, i) => `<button data-ex-opt="${esc(it.id)}:${i}" class="flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-bold transition ${picked.includes(i) ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15" : "border-slate-200 hover:border-brand-300 dark:border-ink-600"}">${it.kind === "tf" ? "" : `<span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold ${picked.includes(i) ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 dark:bg-ink-700"}">${LETTER[i]}</span>`}<span class="flex-1">${esc(o)}</span></button>`).join("")}</div>`;
  }
  if (it.type === "problem") return `${head}<div class="text-base leading-relaxed font-bold">${esc(it.stem)}</div><input data-ex-text="${esc(it.id)}" value="${esc(typeof a === "string" ? a : "")}" inputmode="decimal" autocomplete="off" placeholder="Your answer${it.unit ? ` (${esc(it.unit)})` : ""}" class="mt-3 w-full max-w-xs rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-base font-extrabold tabular-nums focus:border-brand-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800" />`;
  return `${head}<div class="text-base leading-relaxed font-bold">${esc(it.prompt)}</div><textarea data-ex-text="${esc(it.id)}" rows="6" placeholder="Answer in your own words…" class="mt-3 w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm leading-relaxed focus:border-brand-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800">${esc(typeof a === "string" ? a : "")}</textarea>`;
}

export function renderExamTake() {
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

export function saveExamAnswers() {
  try { localStorage.setItem(`exam-answers-${EXM.sitting.id}`, JSON.stringify(EXM.answers)); } catch {}
  const el = $("examProgress");
  if (el) el.textContent = `${EXM.sitting.items.filter(examAnswered).length} of ${EXM.sitting.items.length} answered`;
}

export function toggleExamOption(itemId, i) {
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

export async function submitExam(auto = false) {
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

export async function gradeWrittenNow() {
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

export async function reviewSitting(id) {
  const r = await api(`/api/study/exam/${id}`);
  if (!r.ok) { EXM.error = r.data.error || "Couldn't open that exam."; return renderExam(); }
  if (!r.data.finishedAt) { return openSitting({ ...r.data, deadlineAt: r.data.deadlineAt }, []); }
  EXM.results = r.data;
  EXM.mode = "results";
  EXM.remarkFor = null;
  renderExamResults();
}

export function renderExamResults() {
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

export async function makeSheet(kind, examId) {
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

export async function openSheet(id) {
  const r = await api(`/api/study/sheets/${id}`);
  if (!r.ok) { EXM.error = r.data.error || "That sheet is gone."; return renderExamHome(); }
  EXM.sheet = r.data;
  EXM.mode = "sheet";
  renderSheet();
}

export function renderSheet() {
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
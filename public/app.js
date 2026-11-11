// StudyDeck front end: plain JS, no build step.
const $ = (id) => document.getElementById(id);
const state = {
  course: "all", view: "chat", courses: [], profiles: [], editable: false, total: 0, source: "samples", demo: false, streak: 0, busy: false,
  notes: [], granola: { connected: false, syncing: false, last: null, msg: "", authUrl: "", detail: "" },
  aiPaused: false, usage: null,
  study: { sub: "cards", gen: { open: false, plan: null, selected: new Set(), density: "normal", focus: "", job: null, polling: false, error: "" },
    qgen: { open: false, plan: null, selected: new Set(), density: "normal", focus: "", job: null, polling: false, error: "" },
    pgen: { open: false, plan: null, selected: new Set(), density: "normal", focus: "", job: null, polling: false, error: "" },
    quiz: { mode: "home", home: null, length: 10, error: "", runId: "", queue: [], idx: 0, picked: [], result: null, explain: null, asked: 0, correct: 0, t0: 0, qT0: 0, busy: false, summary: null },
    mode: "home", today: null, cards: [], badge: 0, queue: [], idx: 0, revealed: false, reviewed: 0, correct: 0, t0: 0, cardT0: 0, busy: false },
};

// Course colors come from the registry (a palette name per course). Literal class names so Tailwind keeps them.
const PALETTE_CLASSES = {
  indigo: { dot: "bg-indigo-500", tile: "bg-indigo-100 dark:bg-indigo-500/25", chip: "bg-indigo-500 text-white hover:bg-indigo-600", text: "text-indigo-700 dark:text-indigo-300", bar: "border-indigo-500" },
  sky: { dot: "bg-sky-500", tile: "bg-sky-100 dark:bg-sky-500/25", chip: "bg-sky-500 text-white hover:bg-sky-600", text: "text-sky-700 dark:text-sky-300", bar: "border-sky-500" },
  emerald: { dot: "bg-emerald-500", tile: "bg-emerald-100 dark:bg-emerald-500/25", chip: "bg-emerald-500 text-white hover:bg-emerald-600", text: "text-emerald-700 dark:text-emerald-300", bar: "border-emerald-500" },
  fuchsia: { dot: "bg-fuchsia-500", tile: "bg-fuchsia-100 dark:bg-fuchsia-500/25", chip: "bg-fuchsia-500 text-white hover:bg-fuchsia-600", text: "text-fuchsia-700 dark:text-fuchsia-300", bar: "border-fuchsia-500" },
  amber: { dot: "bg-amber-500", tile: "bg-amber-100 dark:bg-amber-500/25", chip: "bg-amber-500 text-white hover:bg-amber-600", text: "text-amber-700 dark:text-amber-300", bar: "border-amber-500" },
  teal: { dot: "bg-teal-500", tile: "bg-teal-100 dark:bg-teal-500/25", chip: "bg-teal-500 text-white hover:bg-teal-600", text: "text-teal-700 dark:text-teal-300", bar: "border-teal-500" },
  orange: { dot: "bg-orange-500", tile: "bg-orange-100 dark:bg-orange-500/25", chip: "bg-orange-500 text-white hover:bg-orange-600", text: "text-orange-700 dark:text-orange-300", bar: "border-orange-500" },
  rose: { dot: "bg-rose-500", tile: "bg-rose-100 dark:bg-rose-500/25", chip: "bg-rose-500 text-white hover:bg-rose-600", text: "text-rose-700 dark:text-rose-300", bar: "border-rose-500" },
  violet: { dot: "bg-violet-500", tile: "bg-violet-100 dark:bg-violet-500/25", chip: "bg-violet-500 text-white hover:bg-violet-600", text: "text-violet-700 dark:text-violet-300", bar: "border-violet-500" },
  lime: { dot: "bg-lime-500", tile: "bg-lime-100 dark:bg-lime-500/25", chip: "bg-lime-500 text-white hover:bg-lime-600", text: "text-lime-700 dark:text-lime-300", bar: "border-lime-500" },
  slate: { dot: "bg-slate-400", tile: "bg-slate-100 dark:bg-slate-500/25", chip: "bg-slate-500 text-white hover:bg-slate-600", text: "text-slate-600 dark:text-slate-300", bar: "border-slate-400" },
  all: { dot: "bg-gradient-to-br from-brand-500 to-fuchsia-500", tile: "bg-gradient-to-br from-brand-100 to-fuchsia-100 dark:from-brand-500/30 dark:to-fuchsia-500/30", chip: "bg-brand-500 text-white hover:bg-brand-600", text: "text-brand-700 dark:text-brand-300", bar: "border-brand-500" },
};

const BAD_CHIP = "bg-red-500 text-white";
const PROFILE_ICON = { "quant-econ": "📈", finance: "💹", accounting: "🧾", general: "📚" };

// Curated questions for the built-in sample notes (the last one is deliberately not covered, to show "Not in your notes").
const SAMPLE_QUESTIONS = [
  { course: "ECON300", q: "How does a tax rate change the spending multiplier?" },
  { course: "ECON196", q: "Compare FIFO and LIFO when prices are rising." },
  { course: "ECON301", q: "Why does a monopoly create deadweight loss?" },
  { course: "all", q: "What do I have coming up this week across classes and clubs?" },
  { course: "ECON300", q: "What did we learn about the Solow growth model?" },
];

const EMPTY_LINES = [
  "Your notes are ready. Your brain might need coffee. ☕",
  "Ask me anything. If it's not in your notes, I'll say so. No bluffing.",
  "Study mode: on. Let's turn your notes into answers. 🚀",
  "No hallucinations here, just your notes and receipts. 🧾",
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
const courseOf = (id) => state.courses.find((c) => c.id === id);
const palette = (id) => PALETTE_CLASSES[id === "all" ? "all" : courseOf(id)?.color ?? "slate"] ?? PALETTE_CLASSES.slate;
const courseName = (id) => (id === "all" ? "Everything" : id === "unsorted" ? "Inbox" : courseOf(id)?.name ?? id);
const iconFor = (id) => (id === "all" ? "✨" : id === "unsorted" ? "📥" : PROFILE_ICON[courseOf(id)?.profile] ?? "📚");
const fmtDate = (iso) => (iso ? new Date(iso + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const plural = (n, w, many) => `${n} ${n === 1 ? w : many || w + "s"}`;

// Must match src/citations.ts (runs on escaped HTML, so quotes may appear as &quot;)
const CITE_RE = /\[([A-Za-z0-9]+) (\d{4}-\d{2}-\d{2}): ([^\]|]+?)(?:\s*\|\s*(?:&quot;|["“])([^\]]*?)(?:&quot;|["”]))?\s*\]/g;

/** Minimal markdown: headings, bullets, tables, blockquotes, bold, code. Input is escaped first. */
function renderMarkdown(src) {
  let html = "", list = false, table = null;
  const flushList = () => { if (list) { html += "</ul>"; list = false; } };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
    const cells = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => inline(c.trim()));
    html += "<table><thead><tr>" + cells(head).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + cells(r).map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
    table = null;
  };
  for (const line of esc(src).split("\n")) {
    if (/^\s*\|/.test(line)) { flushList(); (table ??= []).push(line); continue; }
    flushTable();
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^&gt;\s?(.*)/))) { flushList(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (line.trim()) { flushList(); html += `<p>${inline(line)}</p>`; }
    else flushList();
  }
  flushList(); flushTable();
  return html;
}

/** Render an assistant answer: { html } is the text with numbered citation chips (one number per source note); { footer } lists the sources. */
function renderAnswer(text, msg) {
  const byLabel = Object.fromEntries((msg.notesUsed || []).map((n) => [n.label, n.id]));
  const byRaw = Object.fromEntries((msg.citations || []).map((c) => [c.raw, c]));
  const sources = new Map();
  let prev = { end: -1, n: 0 };

  let html = renderMarkdown(text).replace(CITE_RE, (raw, course, date, topic, quote, offset, whole) => {
    const label = `${course} ${date}: ${topic.trim()}`;
    const info = byRaw[raw.replace(/&quot;/g, '"')];
    const id = info?.noteId || byLabel[label] || "";
    const bad = !!info && info.status !== "ok";
    const key = id || label;
    if (!sources.has(key)) sources.set(key, { n: sources.size + 1, id, label, course, date, topic: topic.trim(), quote: quote ? quote.replace(/&quot;/g, '"') : "", bad });
    const src = sources.get(key);
    const gap = whole.slice(prev.end, offset);
    const dupe = prev.n === src.n && /^\s*$/.test(gap);
    prev = { end: offset + raw.length, n: src.n };
    if (dupe) return gap;
    const why = bad ? (info.status === "unknown_note" ? "This citation doesn't match a note that was sent." : "Quote not found word-for-word in the note.") : "";
    return `<button type="button" class="cite mx-0.5 inline-grid h-[1.35rem] min-w-[1.35rem] place-items-center rounded-full px-1.5 align-[1px] text-[11px] font-extrabold leading-none transition active:scale-90 ${bad ? BAD_CHIP : palette(course).chip}"
      data-id="${esc(id)}" data-quote="${esc(quote ? quote.replace(/&quot;/g, '"') : "")}" data-label="${esc(label)}" data-why="${esc(why)}" aria-label="Source ${src.n}: ${esc(label)}">${bad ? "!" : src.n}</button>`;
  });

  html = html.replace(/\(General knowledge\)/g, '<span class="rounded-md bg-sun/30 px-1.5 py-px text-[11px] font-extrabold text-amber-800 dark:text-sun">🌐 General knowledge</span>');
  html = html.replace(/Not in your notes\.?/g, (m) => `<span class="inline-flex items-center gap-1 rounded-lg bg-ink-900 px-2.5 py-0.5 text-xs font-extrabold text-white dark:bg-white dark:text-ink-900">🔎 ${m}</span>`);

  let footer = "";
  if (sources.size) {
    footer = `<div class="mt-3.5 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-ink-700">` +
      [...sources.values()].map((s) => `<button type="button" class="cite-foot flex max-w-full items-center gap-2 rounded-xl bg-slate-50 py-1 pr-3 pl-1 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:bg-ink-700 dark:text-slate-200 dark:hover:bg-ink-600" data-id="${esc(s.id)}" data-quote="${esc(s.quote)}">
        <span class="grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-extrabold text-white ${s.bad ? BAD_CHIP : palette(s.course).dot}">${s.bad ? "!" : s.n}</span>
        <span class="truncate">${esc(s.course)} · ${esc(s.topic)} · ${esc(fmtDate(s.date))}</span></button>`).join("") + `</div>`;
  }
  return { html, footer };
}

function notesUsedLine(msg) {
  if (!msg.notesUsed) return "";
  const n = msg.notesUsed.length;
  const mode = msg.mode === "ranked" ? "best matches by keyword and recency" : "every note in scope";
  const list = msg.notesUsed.map((x) => `<li class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full ${palette(x.label.split(" ")[0]).dot}"></span>${esc(x.label)}</li>`).join("");
  return `<details class="mt-2.5 text-[11px] text-slate-400"><summary class="cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-200">Searched ${plural(n, "note")} (${mode})</summary>
    <ul class="mt-1.5 space-y-0.5 pl-1">${list || "<li>none</li>"}</ul></details>`;
}

function messageEl(msg) {
  const el = document.createElement("div");
  el.className = "fade-in mx-auto max-w-3xl";
  if (msg.role === "user") {
    el.innerHTML = `<div class="flex justify-end"><div class="max-w-[85%] rounded-3xl rounded-br-lg bg-brand-500 px-5 py-3 text-[15px] font-medium text-white shadow-card md:max-w-[75%]">${esc(msg.text)}${msg.useGeneral ? '<div class="mt-1 text-[10px] font-bold text-brand-100">🌐 general knowledge on</div>' : ""}</div></div>`;
  } else {
    el.innerHTML = `<div class="flex gap-3"><img src="/logo.svg" alt="" class="mt-1 hidden h-8 w-8 shrink-0 sm:block" />
      <div class="bubble min-w-0 max-w-full rounded-3xl rounded-tl-lg px-5 py-4 text-[15px] shadow-card ring-1"><div class="md body"></div><div class="meta"></div></div></div>`;
    updateAssistant(el, msg);
  }
  return el;
}

function updateAssistant(el, msg, streaming = false) {
  const bubble = el.querySelector(".bubble");
  bubble.className = "bubble min-w-0 max-w-full rounded-3xl rounded-tl-lg px-5 py-4 text-[15px] shadow-card ring-1 " +
    (msg.error ? "bg-red-50 text-red-900 ring-red-200 dark:bg-red-500/10 dark:text-red-100 dark:ring-red-500/30" : "bg-white ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600");
  const body = el.querySelector(".body");
  if (msg.error) body.innerHTML = `<p><b>😕 Hmm, that didn't work.</b></p><p>${esc(msg.text.replace(/^Error:\s*/, ""))}</p>`;
  const meta = el.querySelector(".meta");
  if (msg.error || !msg.text) {
    if (!msg.error && !msg.text) body.innerHTML = `<div class="flex items-center gap-2 text-slate-400"><span class="dots"><span></span><span></span><span></span></span>Reading ${msg.notesUsed ? plural(msg.notesUsed.length, "note") : "your notes"}…</div>`;
    meta.innerHTML = "";
  } else {
    const a = renderAnswer(msg.text, msg);
    body.innerHTML = a.html;
    meta.innerHTML = a.footer + notesUsedLine(msg);
  }
  body.classList.toggle("cursor", streaming && !!msg.text);
}

const scrollDown = () => { const m = $("messages"); m.scrollTop = m.scrollHeight; };

// ---- suggestions ----
function suggestions() {
  if (state.source === "samples") return SAMPLE_QUESTIONS;
  const mine = state.notes.slice(0, 2);
  const out = mine.map((n) => ({ course: state.course, q: `What were the key points of “${n.title}”?` }));
  const label = state.course === "all" ? "my classes" : courseName(state.course);
  out.push({ course: state.course, q: `What formulas and definitions should I memorize for ${label}?` });
  out.push({ course: state.course, q: `What has my professor said about the exam in ${label}?` });
  return out;
}

function renderTryRow(show) {
  $("tryRow").classList.toggle("hidden", !show);
  $("tryRow").classList.toggle("flex", show);
  $("tryRow").innerHTML = show
    ? `<span class="shrink-0 self-center text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Try asking</span>` +
      suggestions().map((t, i) => `<button type="button" data-try="${i}" class="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-card ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:text-brand-600 hover:ring-brand-300 dark:bg-ink-800 dark:text-slate-200 dark:ring-ink-600 dark:hover:ring-brand-400">${esc(t.q)}</button>`).join("")
    : "";
}

function emptyState() {
  const line = EMPTY_LINES[Math.floor(Math.random() * EMPTY_LINES.length)];
  const count = state.course === "all" ? state.total : courseOf(state.course)?.count ?? 0;
  $("messages").innerHTML = `<div class="empty fade-in mx-auto mt-[5vh] max-w-lg text-center">
    <div class="pop mx-auto grid h-20 w-20 place-items-center rounded-3xl text-4xl ${palette(state.course).tile}">${iconFor(state.course)}</div>
    <h2 class="mt-5 text-2xl font-extrabold tracking-tight">${line}</h2>
    <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">${count ? `Searching ${plural(count, "note")} in <b>${esc(courseName(state.course))}</b>. Every answer shows the notes it came from.` : "No notes here yet. Sync from Granola to fill this class up."}</p>
    ${count ? `<button data-view-go="notes" class="mt-4 rounded-full bg-brand-50 px-5 py-2 text-sm font-bold text-brand-700 transition hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-200">📚 Browse the notes</button>` : ""}
  </div>`;
}

// ---- sidebar ----
function courseRow(id, name, sub, count, extra = "") {
  const active = state.course === id;
  const p = palette(id);
  return `<button data-course="${esc(id)}" class="group flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition ${active ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/15 dark:ring-brand-500/40" : "hover:bg-slate-50 dark:hover:bg-ink-700"}">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base ${p.tile}">${iconFor(id)}</span>
    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-bold ${active ? "text-brand-700 dark:text-brand-200" : ""}">${esc(name)}</span>
      <span class="block truncate text-[11px] font-medium text-slate-400">${esc(sub)}</span></span>
    <span class="rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${extra || (active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 dark:bg-ink-700 dark:text-slate-300")}">${count}</span></button>`;
}

function visibleCourses() {
  return state.courses.filter((c) => !c.archived && c.id !== "unsorted" && (c.count > 0 || c.id === state.course));
}

function renderSidebar() {
  const inbox = courseOf("unsorted");
  const rows = [courseRow("all", "Everything", "All your classes", state.total)];
  for (const c of visibleCourses()) rows.push(courseRow(c.id, c.name, `${c.id}${c.latest ? " · last " + fmtDate(c.latest) : ""}`, c.count));
  if (inbox && inbox.count > 0) rows.push(courseRow("unsorted", "Inbox", "Notes that need a class", inbox.count, "bg-sun text-ink-900"));
  $("courses").innerHTML = rows.join("");
}

function renderStreak() {
  const n = state.streak;
  $("streak").innerHTML = n > 0
    ? `<span class="text-lg">🔥</span><span><b class="font-extrabold">${n}-day streak</b> <span class="font-medium opacity-70">${n >= 3 ? "· on a roll!" : "· keep it alive"}</span></span>`
    : `<span class="text-lg grayscale">🔥</span><span class="font-medium opacity-80">Ask a question to start a streak</span>`;
}

// ---- header ----
function renderHeader() {
  const c = courseOf(state.course);
  const count = state.course === "all" ? state.total : c?.count ?? 0;
  const latest = state.course === "all" ? state.courses.map((x) => x.latest).filter(Boolean).sort().at(-1) : c?.latest;
  $("scopeTitle").textContent = courseName(state.course);
  $("scopeSub").textContent = [state.course !== "all" && state.course !== "unsorted" ? state.course : "", plural(count, "note"), latest ? `latest ${fmtDate(latest)}` : ""].filter(Boolean).join(" · ");
  const hi = $("heroIcon");
  hi.className = `grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl md:h-14 md:w-14 md:text-3xl ${palette(state.course).tile}`;
  hi.textContent = iconFor(state.course);
  $("notesCount").textContent = count;
  $("sourceBadge").classList.toggle("hidden", state.source !== "samples");
  $("sourceBadge").innerHTML = `<span class="sm:hidden">${state.demo ? "Demo" : "Samples"}</span><span class="hidden sm:inline">${state.demo ? "Demo mode · sample notes" : "Sample notes"}</span>`;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.view === state.view;
    t.className = `tab -mb-px whitespace-nowrap border-b-[3px] px-2.5 py-2.5 text-sm font-bold transition sm:px-4 ${on ? "border-brand-500 text-brand-600 dark:text-brand-300" : "border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`;
    t.setAttribute("aria-selected", on);
  });
  $("clearBtn").classList.toggle("hidden", state.view !== "chat");
}

async function refreshState() {
  const r = await fetch("/api/state").then((r) => r.json());
  Object.assign(state, { courses: r.courses, profiles: r.profiles, editable: r.editable, total: r.total, source: r.source, demo: r.demo, streak: r.streak, aiPaused: r.aiPaused });
  $("demo").checked = $("demoMobile").checked = state.demo;
  renderSidebar(); renderHeader(); renderStreak(); renderAi();
}

async function loadNotes() {
  state.notes = await fetch(`/api/notes?course=${encodeURIComponent(state.course)}`).then((r) => (r.ok ? r.json() : []));
  if (state.view === "notes") renderNotes();
}

// ---- views ----
function setView(v) {
  state.view = v;
  try { localStorage.setItem("view", v); } catch {}
  for (const [name, el] of [["chat", $("chatView")], ["notes", $("notesView")], ["study", $("studyView")]]) {
    el.classList.toggle("hidden", v !== name);
    el.classList.toggle("flex", v === name);
  }
  renderHeader();
  if (v === "notes") { renderNotes(); $("notesSearch").focus(); }
  else if (v === "study") {
    const st = state.study;
    const playing = st.mode === "play" || (st.sub === "quiz" && st.quiz.mode === "play") || (typeof studyMoreBusy === "function" && studyMoreBusy());
    if (!playing) { st.mode = "home"; st.quiz.mode = "home"; }
    renderStudy();
    if (!playing) loadStudyToday();
  }
  else $("q").focus();
}

function noteCard(n) {
  const p = palette(n.course);
  const inbox = n.course === "unsorted";
  const mover = inbox && state.source === "notes"
    ? `<select data-move="${esc(n.id)}" class="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-900 dark:border-sun/40 dark:bg-sun/10 dark:text-sun">
         <option value="">📥 File under a class…</option>${state.courses.filter((c) => !c.archived && c.id !== "unsorted").map((c) => `<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.name)}</option>`).join("")}</select>`
    : "";
  return `<div class="fade-in group flex flex-col rounded-2xl border-l-4 bg-white p-4 shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-pop dark:bg-ink-800 dark:ring-ink-600 ${p.bar}">
    <button data-open="${esc(n.id)}" class="flex-1 text-left">
      <div class="flex items-center justify-between gap-2 text-xs"><span class="font-extrabold ${p.text}">${esc(fmtDate(n.date))}</span><span class="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-500 dark:bg-ink-700 dark:text-slate-300">${esc(n.course === "unsorted" ? "Inbox" : n.course)}</span></div>
      <div class="mt-2 line-clamp-2 text-[15px] leading-snug font-extrabold">${esc(n.title)}</div>
      <p class="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">${esc(n.snippet)}</p>
    </button>${mover}</div>`;
}

function renderNotes() {
  const q = $("notesSearch").value.trim().toLowerCase();
  const list = q ? state.notes.filter((n) => `${n.title} ${n.snippet} ${n.course}`.toLowerCase().includes(q)) : state.notes;
  $("notesGrid").innerHTML = list.length
    ? list.map(noteCard).join("")
    : `<div class="col-span-full mx-auto mt-10 max-w-sm text-center text-sm text-slate-500"><div class="text-4xl">${q ? "🤷" : "📭"}</div><p class="mt-3 font-semibold">${q ? "No notes match that search." : "No notes in here yet."}</p>${q ? "" : '<p class="mt-1">Connect Granola in the sidebar and your classes fill up automatically.</p>'}</div>`;
}

async function selectCourse(id, { keepView = true } = {}) {
  state.course = id;
  $("notesSearch").value = "";
  state.study.mode = "home";
  state.study.quiz.mode = "home";
  state.study.quiz.home = null;
  await Promise.all([refreshState(), loadNotes(), loadStudyToday()]);
  const history = await fetch(`/api/chats/${encodeURIComponent(id)}`).then((r) => r.json());
  $("messages").innerHTML = "";
  if (!history.length) emptyState();
  history.forEach((m) => $("messages").appendChild(messageEl(m)));
  renderTryRow(!history.length);
  if (!keepView) setView("chat"); else setView(state.view);
  scrollDown();
}

function setBusy(b) {
  state.busy = b;
  $("send").disabled = b;
  $("sendLabel").innerHTML = b ? '<span class="dots"><span></span><span></span><span></span></span>' : "Ask";
}

async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = chunk.match(/^event: (\w+)/)?.[1];
      const m = chunk.match(/\ndata: (.*)$/s);
      onEvent(ev, m ? JSON.parse(m[1]) : null);
    }
  }
}

async function ask(question) {
  if (state.busy) return;
  if (state.view !== "chat") setView("chat");
  setBusy(true);
  $("messages").querySelector(".empty")?.remove();
  renderTryRow(false);
  const useGeneral = $("general").checked;
  $("messages").appendChild(messageEl({ role: "user", text: question, useGeneral }));
  const msg = { role: "assistant", text: "" };
  const el = messageEl(msg);
  $("messages").appendChild(el);
  scrollDown();

  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course: state.course, question, useGeneral }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Server error (${res.status})`);
    await readSse(res, (ev, data) => {
      if (ev === "meta") Object.assign(msg, data);
      if (ev === "delta") msg.text += data;
      if (ev === "done") Object.assign(msg, { text: data.text, citations: data.citations });
      if (ev === "error") Object.assign(msg, { text: data.message, error: true });
      updateAssistant(el, msg, ev === "delta" || ev === "meta");
      scrollDown();
    });
  } catch (e) {
    Object.assign(msg, { error: true, text: /fetch|network/i.test(e.message) ? "Can't reach the StudyDeck server. Is it still running?" : e.message });
  }
  updateAssistant(el, msg, false);
  setBusy(false);
  refreshState();
  refreshAi();
  $("q").focus();
}

// ---- source panel + hover preview ----
const norm = (s) => s.toLowerCase().replace(/[*_`|>#]/g, " ").replace(/[^\p{L}\p{N}.%/+−=-]+/gu, " ").replace(/\s+/g, " ").trim();
const noteCache = new Map();
const getNote = (id) => {
  if (!noteCache.has(id)) {
    const [course, file] = id.split("/");
    noteCache.set(id, fetch(`/api/notes/${encodeURIComponent(course)}/${encodeURIComponent(file)}`).then((r) => (r.ok ? r.json() : null)));
  }
  return noteCache.get(id);
};

/** Find the block (paragraph, bullet, table cell) that contains the quote, else the one sharing the most words. */
function findPassage(root, quote) {
  const blocks = [...root.querySelectorAll("p, li, td, h1, h2, h3, blockquote")];
  const q = norm(quote);
  let best = blocks.find((b) => norm(b.textContent).includes(q));
  if (!best) {
    const words = new Set(q.split(" "));
    let top = 0;
    for (const b of blocks) {
      const s = norm(b.textContent).split(" ").filter((w) => words.has(w)).length;
      if (s > top) { top = s; best = b; }
    }
  }
  return best;
}

let openNoteId = "";
async function openSource(id, quote) {
  const note = await getNote(id);
  if (!note) return;
  openNoteId = id;
  $("source").classList.remove("hidden");
  $("source").classList.add("flex", "slide-in");
  $("sourceTitle").textContent = note.label + (note.sample ? "  · sample" : "");
  $("sourceBody").innerHTML = renderMarkdown(note.body);
  $("sourceBody").scrollTop = 0;
  const movable = state.source === "notes";
  $("moveWrap").classList.toggle("hidden", !movable);
  $("moveWrap").classList.toggle("flex", movable);
  if (movable) $("moveSelect").innerHTML = state.courses.filter((c) => !c.archived).map((c) => `<option value="${esc(c.id)}" ${c.id === note.course ? "selected" : ""}>${esc(c.id === "unsorted" ? "Inbox" : c.id + " · " + c.name)}</option>`).join("");
  const best = quote && findPassage($("sourceBody"), quote);
  if (best) { best.classList.add("hl"); best.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

function closeSource() {
  $("source").classList.add("hidden");
  $("source").classList.remove("flex");
  openNoteId = "";
}

async function moveNoteTo(id, target) {
  const [course, file] = id.split("/");
  const res = await fetch(`/api/notes/${encodeURIComponent(course)}/${encodeURIComponent(file)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ course: target }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || "Couldn't move that note.");
  noteCache.clear();
  await Promise.all([refreshState(), loadNotes()]);
  if (openNoteId === id) { if (state.view === "notes" || state.course === "all" || state.course === target) openSource(data.id); else closeSource(); }
}

let previewFor = null;
async function showPreview(chip) {
  previewFor = chip;
  const p = $("preview");
  const r = chip.getBoundingClientRect();
  const place = () => {
    p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + "px";
    p.style.top = (r.top > 150 ? r.top - p.offsetHeight - 8 : r.bottom + 8) + "px";
  };
  const head = `<div class="mb-1 font-extrabold opacity-70">${esc(chip.dataset.label)}</div>`;
  p.innerHTML = chip.dataset.why ? head + `⚠ ${esc(chip.dataset.why)}` : head + "…";
  p.classList.remove("hidden");
  place();
  if (!chip.dataset.id || chip.dataset.why) return;
  const note = await getNote(chip.dataset.id);
  if (previewFor !== chip || !note) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = renderMarkdown(note.body);
  const passage = chip.dataset.quote ? findPassage(tmp, chip.dataset.quote) : null;
  const text = passage ? passage.textContent : note.body.slice(0, 200);
  p.innerHTML = head + `“${esc(text.length > 280 ? text.slice(0, 280) + "…" : text)}”<div class="mt-1.5 text-[10px] opacity-60">Click to open the note</div>`;
  place();
}
function hidePreview() { previewFor = null; $("preview").classList.add("hidden"); }

// ---- Granola connection and sync ----
const G = state.granola;

function renderGranola() {
  const el = $("granolaCard");
  const busy = G.syncing;
  const btn = (id, label, primary = true) => `<button id="${id}" ${busy ? "disabled" : ""} class="${primary ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-white text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 dark:bg-ink-700 dark:text-brand-100 dark:ring-ink-600"} mt-2.5 w-full rounded-xl px-3 py-2 text-sm font-extrabold transition active:scale-95 disabled:opacity-60">${label}</button>`;
  let body;
  if (!G.connected) {
    body = `<div class="flex items-center gap-2 text-sm font-extrabold"><span class="h-2 w-2 rounded-full bg-slate-300"></span>Granola</div>
      <p class="mt-1 font-medium leading-snug opacity-80">One sign-in, then your whole semester syncs itself.</p>
      ${btn("connectBtn", "Connect Granola")}
      ${G.authUrl ? `<a href="${esc(G.authUrl)}" target="_blank" rel="noopener" class="mt-2 block text-center text-[11px] font-bold underline">Sign-in tab didn't open? Click here</a>` : ""}`;
  } else {
    const last = G.last;
    const lastLine = last ? `Synced ${ago(last.at)}${last.added || last.updated ? ` · ${last.added} new, ${last.updated} updated` : " · all up to date"}` : "Not synced yet";
    body = `<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 text-sm font-extrabold"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Granola connected</div>
        <button id="disconnectBtn" class="text-[10px] font-bold opacity-50 hover:opacity-100">Disconnect</button></div>
      <p class="mt-1 font-medium opacity-80">${esc(busy ? "Syncing…" : lastLine)}</p>
      ${btn("syncBtn", busy ? '<span class="dots"><span></span><span></span><span></span></span>' : "Sync now")}`;
  }
  if (G.msg) body += `<div class="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-[11px] font-semibold leading-relaxed dark:bg-ink-900/40">${esc(G.msg)}</div>`;
  if (G.detail) body += `<details class="mt-2 text-[11px]"><summary class="cursor-pointer font-bold opacity-70">See what changed</summary><div class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap opacity-80">${esc(G.detail)}</div></details>`;
  el.innerHTML = body;
}

async function refreshGranola() {
  try {
    const s = await fetch("/api/granola/status").then((r) => r.json());
    Object.assign(G, { connected: s.connected, syncing: s.syncing || G.syncing, last: s.last ?? null });
  } catch {}
  renderGranola();
}

async function connectGranola() {
  G.msg = "Opening the Granola sign-in…"; G.authUrl = ""; renderGranola();
  try {
    const res = await fetch("/api/granola/connect", { method: "POST" });
    const d = await res.json();
    if (!res.ok) { G.msg = "😕 " + d.error; return renderGranola(); }
    G.authUrl = d.authUrl;
    G.msg = "Finish signing in on the Granola tab. This page updates by itself.";
    renderGranola();
    window.open(d.authUrl, "_blank");
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch("/api/granola/status").then((r) => r.json());
      if (s.connected) { G.connected = true; G.authUrl = ""; G.msg = "🎉 Connected! Pulling in your notes…"; renderGranola(); return runGranolaSync(); }
    }
    G.msg = "Sign-in timed out. Click Connect Granola to try again."; G.authUrl = "";
  } catch (e) {
    G.msg = "😕 Couldn't start the sign-in. Is StudyDeck still running?";
  }
  renderGranola();
}

async function runGranolaSync() {
  if (G.syncing) return;
  G.syncing = true; G.detail = ""; G.msg = "Starting…"; renderGranola();
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      if (d.needsConnect) { G.connected = false; G.msg = "Granola needs to be connected again."; } else G.msg = "😕 " + (d.error || `Sync failed (${res.status})`);
      return;
    }
    await readSse(res, (ev, data) => {
      if (ev === "progress") { G.msg = data; renderGranola(); }
      if (ev === "done") {
        const bits = [data.added.length && `${data.added.length} new`, data.updated.length && `${data.updated.length} updated`, data.moved.length && `${data.moved.length} re-filed`].filter(Boolean);
        G.msg = bits.length ? `🎉 ${bits.join(", ")} (of ${data.scanned} meetings)` : `✅ Already up to date (${data.scanned} meetings checked)`;
        if (data.errors.length) G.msg += ` · ${plural(data.errors.length, "problem")}`;
        G.detail = [...data.added.map((a) => `+ ${a.course}: ${a.title}`), ...data.updated.map((a) => `~ ${a.course}: ${a.title}`), ...data.moved.map((a) => `→ ${a.course}: ${a.title}`),
          ...data.errors.map((e) => `! ${e.title}: ${e.error}`)].join("\n");
      }
      if (ev === "error") { G.msg = "😕 " + data.message; if (data.needsConnect) G.connected = false; }
    });
  } catch (e) {
    G.msg = "😕 Lost contact with StudyDeck during the sync.";
  }
  G.syncing = false;
  noteCache.clear();
  await Promise.all([refreshGranola(), refreshState(), loadNotes()]);
}

// ---- study ----
const S = state.study;
const GRADE_LABEL = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
const GRADE_STYLE = {
  1: "bg-red-500 hover:bg-red-600",
  2: "bg-orange-500 hover:bg-orange-600",
  3: "bg-emerald-500 hover:bg-emerald-600",
  4: "bg-brand-500 hover:bg-brand-600",
};
const STATE_LABEL = { 0: "New", 1: "Learning", 2: "Review", 3: "Relearning" };
const REQUEUE_WITHIN_MS = 20 * 60 * 1000;

async function loadStudyToday() {
  const course = encodeURIComponent(state.course);
  const [t, c] = await Promise.all([fetch(`/api/study/today?course=${course}`), fetch(`/api/study/cards?course=${course}`)]);
  if (!t.ok) return;
  S.today = await t.json();
  S.cards = c.ok ? await c.json() : [];
  const k = S.today.counts;
  S.badge = k.due + k.learning + k.newAvailable;
  $("studyBadge").textContent = S.badge;
  $("studyBadge").classList.toggle("hidden", !S.badge);
  if (["problems", "tutor", "exam", "progress"].includes(S.sub)) await loadStudyMore();
  else if (S.sub === "quiz") await loadQuizHome();
  else if (state.view === "study" && S.mode === "home") renderStudyHome();
  resumeGeneration();
}

function renderStudy() {
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

function statTile(label, value, tone) {
  return `<div class="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
    <div class="text-3xl font-extrabold tabular-nums ${tone}">${value}</div><div class="mt-0.5 text-xs font-bold text-slate-400">${label}</div></div>`;
}

function renderStudyHome() {
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
      <button data-del-card="${esc(c.id)}" class="rounded-lg px-2 text-lg leading-none text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" aria-label="Delete card">×</button></div>`).join("");
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

async function startStudySession() {
  const res = await fetch(`/api/study/session?course=${encodeURIComponent(state.course)}&limit=120`);
  if (!res.ok) return;
  const queue = await res.json();
  if (!queue.length) return loadStudyToday();
  Object.assign(S, { mode: "play", queue, idx: 0, revealed: false, reviewed: 0, correct: 0, t0: Date.now(), cardT0: Date.now(), busy: false });
  renderStudy();
}

function exitStudySession() {
  S.mode = "home";
  Promise.all([loadStudyToday(), refreshState()]);
  renderStudy();
}

function renderPlayer() {
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
    ${buttons}
    <div class="text-center text-[11px] font-semibold text-slate-400">Be honest. The scheduler uses your rating to decide when you see this again. Esc to leave.</div>
  </div>`;
}

function revealCard() {
  if (S.mode !== "play" || S.revealed) return;
  S.revealed = true;
  renderPlayer();
}

async function rateCard(grade) {
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
    if (d.card.due - Date.now() < REQUEUE_WITHIN_MS) S.queue.push({ ...card, ...d.card, previews: d.previews });
    S.idx++;
    S.revealed = false;
    S.cardT0 = Date.now();
    if (S.idx >= S.queue.length) return finishStudySession();
    renderPlayer();
  } finally {
    S.busy = false;
  }
}

async function finishStudySession() {
  S.mode = "done";
  // Wait for fresh counts so "study more" reflects what's really due now.
  await Promise.all([loadStudyToday(), refreshState()]);
  if (S.mode === "done") renderDone();
}

function renderDone() {
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

async function submitCard(e) {
  e.preventDefault();
  const course = $("cardCourse") ? $("cardCourse").value : state.course;
  const body = { course, front: $("cardFront").value, back: $("cardBack").value, quote: $("cardQuote").value };
  const res = await fetch("/api/study/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { $("cardError").textContent = d.error || "Couldn't add that card."; return; }
  await loadStudyToday();
  $("cardFront")?.focus();
}

// ---- generate cards and quiz questions from lectures ----
const GEN_CHIP = {
  none: ["New", "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"],
  generated: ["Done", "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"],
  stale: ["Edited since", "bg-sun/30 text-amber-800 dark:text-sun"],
};
const GEN_STATE_ICON = { queued: "⏳", running: "✍️", done: "✅", error: "⚠️", skipped: "⏭️" };
const Q = S.quiz;

// The same panel makes flashcards (Flashcards tab) or quiz questions (Quizzes tab); everything that differs lives here.
const GEN_CFG = {
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
const gk = () => (S.sub === "quiz" ? "quiz" : S.sub === "problems" ? "problems" : "cards");

async function loadGenPlan(kind = gk()) {
  const res = await fetch(`${GEN_CFG[kind].base}/plan?course=${encodeURIComponent(state.course)}`);
  if (!res.ok) return;
  const plan = await res.json();
  const G = GEN_CFG[kind].st();
  G.plan = plan;
  // Start with what's worth doing: lectures with nothing yet, or edited since they were processed.
  G.selected = new Set(plan.lectures.filter((l) => l.status !== "generated").slice(0, plan.maxPerJob).map((l) => l.id));
  updateGenPanel(kind);
}

function genJobDone(job) { return job && job.status !== "running" && !job.items.some((i) => i.state === "running" || i.state === "queued"); }

function genPanelHtml(kind = gk()) {
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

function genJobHtml(job, kind = gk()) {
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
  const head = !done ? `${C.headBusy} ${settled} of ${job.items.length} lectures` : job.status === "cancelled" ? "Stopped" : t.created ? `🎉 Added ${plural(t.created, "new " + C.one)}` : "Nothing new to add";
  const sub = done
    ? `${plural(job.items.filter((i) => i.state === "done").length, "lecture")} processed · ${t.duplicates} duplicate${t.duplicates === 1 ? "" : "s"} skipped · ${t.dropped} dropped · ${plural(t.calls, "Claude call")}`
    : `${plural(t.created, C.one)} so far · ${plural(t.calls, "Claude call")}`;
  return `<div class="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
    <div class="flex items-start justify-between gap-3"><div><div class="text-lg font-extrabold">${head}</div><div class="text-xs font-semibold text-slate-500 dark:text-slate-400">${sub}</div></div>
      ${done ? "" : `<button id="genCancel" class="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Cancel</button>`}</div>
    <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700"><div class="h-full rounded-full bg-brand-500 transition-all" style="width:${done ? 100 : pct}%"></div></div>
    <div class="mt-3 max-h-64 overflow-y-auto">${rows}</div>${droppedHtml}
    ${done ? `<div class="mt-4 flex gap-3">${t.created ? `<button id="genStudy" class="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-600">${C.doneBtn}</button>` : ""}
      <button id="genDismiss" class="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Done</button></div>` : ""}
  </div>`;
}

/** Redraw the panel, but only if it is the one on screen (a job can finish while you are on the other tab). */
function updateGenPanel(kind = gk()) {
  if (kind !== gk()) return;
  const el = $("genPanel");
  if (el) el.innerHTML = genPanelHtml(kind);
}

async function startGeneration(kind = gk()) {
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

async function pollGeneration(kind) {
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
async function resumeGeneration() {
  for (const kind of ["cards", "quiz", "problems"]) {
    const C = GEN_CFG[kind];
    if (C.st().polling) continue;
    try {
      const r = await fetch(`${C.base}/status`).then((x) => x.json());
      if (r.running && r.job) { C.st().job = r.job; updateGenPanel(kind); pollGeneration(kind); }
    } catch {}
  }
}

async function cancelGeneration(kind = gk()) {
  await fetch(`${GEN_CFG[kind].base}/cancel`, { method: "POST" });
}

function dismissGeneration(kind = gk()) {
  Object.assign(GEN_CFG[kind].st(), { job: null, open: false, error: "" });
  updateGenPanel(kind);
}

// ---- quizzes ----
const KIND_LABEL = { single: "Pick one", multi: "Select all that apply", tf: "True or false" };
const KIND_SHORT = { single: "Pick 1", multi: "Select all", tf: "T / F" };
const LETTER = "ABCDE";

function subSwitch() {
  const tabs = [["cards", "🃏", "Cards"], ["quiz", "📝", "Quiz"], ["problems", "🧮", "Problems"], ["tutor", "🗣️", "Tutor"], ["exam", "🎯", "Exam"], ["progress", "📊", "Progress"]];
  return `<div class="flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1 [scrollbar-width:none] dark:bg-ink-800">${tabs.map(([id, ic, label]) => `<button data-sub="${id}" class="shrink-0 grow rounded-xl px-3 py-2 text-sm font-extrabold whitespace-nowrap transition ${S.sub === id ? "bg-white text-brand-700 shadow-card dark:bg-ink-600 dark:text-brand-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}">${ic} ${label}</button>`).join("")}</div>`;
}

function setSub(sub) {
  if (S.sub === sub) return;
  S.sub = sub;
  renderStudy();
  loadStudyToday();
}

async function loadQuizHome() {
  const res = await fetch(`/api/study/quiz/home?course=${encodeURIComponent(state.course)}`);
  if (!res.ok) return;
  Q.home = await res.json();
  if (state.view === "study" && S.sub === "quiz" && Q.mode === "home") renderQuizHome();
}

function renderQuizHome() {
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
      <button data-del-q="${esc(q.id)}" class="rounded-lg px-2 text-lg leading-none text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" aria-label="Delete question">×</button></div>`).join("");
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

async function startQuiz(noteIds) {
  const res = await fetch("/api/study/quiz/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course: state.course, length: Q.length, noteIds: Array.isArray(noteIds) ? noteIds : undefined }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { Q.error = d.error || "Couldn't start a quiz."; return renderQuizHome(); }
  Q.error = "";
  Object.assign(Q, { mode: "play", runId: d.runId, queue: d.questions, idx: 0, picked: [], result: null, explain: null, asked: 0, correct: 0, t0: Date.now(), qT0: Date.now(), busy: false, summary: null });
  S.sub = "quiz";
  renderStudy();
}

function exitQuiz() {
  Q.mode = "home";
  Q.result = null;
  Promise.all([loadQuizHome(), loadStudyToday(), refreshState()]);
  renderStudy();
}

function renderQuizPlay() {
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

async function pickOption(i) {
  const q = Q.queue[Q.idx];
  if (!q || Q.result || Q.busy || i < 0 || i >= q.options.length) return;
  if (q.kind === "multi") {
    Q.picked = Q.picked.includes(i) ? Q.picked.filter((x) => x !== i) : [...Q.picked, i].sort((a, b) => a - b);
    return renderQuizPlay();
  }
  Q.picked = [i];
  return submitQuizAnswer();
}

async function submitQuizAnswer() {
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

function nextQuizQuestion() {
  if (!Q.result) return;
  Q.idx++;
  Q.picked = [];
  Q.result = null;
  Q.explain = null;
  Q.qT0 = Date.now();
  if (Q.idx >= Q.queue.length) return finishQuizRun();
  renderQuizPlay();
}

async function explainMiss() {
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

async function finishQuizRun() {
  const res = await fetch("/api/study/quiz/finish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: Q.runId }) });
  const d = await res.json().catch(() => ({}));
  Q.summary = res.ok ? d : null;
  if (res.ok) state.streak = d.streak;
  Q.mode = "done";
  await Promise.all([loadQuizHome(), loadStudyToday(), refreshState()]);
  if (Q.mode === "done") renderQuizDone();
}

function renderQuizDone() {
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

// ---- AI usage and Pause AI ----
function renderAi() {
  const u = state.usage;
  const el = $("aiChip");
  if (!el) return;
  const paused = state.aiPaused;
  el.className = `flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${paused ? "bg-sun/30 text-amber-900 dark:text-sun" : "bg-slate-50 text-slate-600 dark:bg-ink-700 dark:text-slate-300"}`;
  const calls = u ? u.today.calls : 0;
  el.innerHTML = paused
    ? `<span>⏸ AI paused</span><button id="aiToggle" class="rounded-lg bg-white/70 px-2 py-0.5 font-extrabold dark:bg-ink-900/40">Resume</button>`
    : `<span title="Questions and, soon, card and exam generation. Reviewing cards uses no AI.">✨ AI on · ${calls} ${calls === 1 ? "call" : "calls"} today</span><button id="aiToggle" class="rounded-lg px-2 py-0.5 font-extrabold text-slate-400 hover:bg-white dark:hover:bg-ink-900/40">Pause</button>`;
  $("q").placeholder = paused ? "AI is paused. Resume it in the sidebar to ask questions." : "Ask anything about your notes…";
}

async function refreshAi() {
  try {
    const u = await fetch("/api/usage").then((r) => r.json());
    state.usage = u;
    state.aiPaused = u.paused;
  } catch {}
  renderAi();
}

async function toggleAi() {
  const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aiPaused: !state.aiPaused }) });
  if (res.ok) state.aiPaused = (await res.json()).aiPaused;
  await refreshAi();
}

// ---- class picker (⌘K) ----
let pickerIndex = 0;
function pickerItems() {
  const f = $("pickerInput").value.toLowerCase();
  const all = [{ id: "all", name: "Everything", count: state.total }, ...state.courses.filter((c) => !c.archived)];
  return all.filter((c) => `${c.id} ${courseName(c.id)}`.toLowerCase().includes(f));
}
function renderPicker() {
  const items = pickerItems();
  pickerIndex = Math.min(pickerIndex, Math.max(0, items.length - 1));
  $("pickerList").innerHTML = items.map((c, i) => `<button data-pick="${esc(c.id)}" class="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm ${i === pickerIndex ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "hover:bg-slate-50 dark:hover:bg-ink-700"}">
      <span class="grid h-8 w-8 place-items-center rounded-xl ${palette(c.id).tile}">${iconFor(c.id)}</span><span class="flex-1 font-bold">${esc(courseName(c.id))}${c.id !== "all" && c.id !== "unsorted" ? ` <span class="font-mono text-[11px] font-semibold text-slate-400">${esc(c.id)}</span>` : ""}</span><span class="text-xs font-bold text-slate-400">${c.count}</span></button>`).join("")
    || '<div class="px-3 py-6 text-center text-sm text-slate-400">No class matches. Did you mean ECON? 🤓</div>';
  return items;
}
function openPicker() {
  $("picker").classList.remove("hidden"); $("picker").classList.add("flex");
  $("pickerInput").value = "";
  pickerIndex = Math.max(0, pickerItems().findIndex((c) => c.id === state.course));
  renderPicker(); $("pickerInput").focus();
}
function closePicker() { $("picker").classList.add("hidden"); $("picker").classList.remove("flex"); }
function pick(id) { closePicker(); if (id) selectCourse(id); }

// ---- manage classes ----
function renderManage(error = "") {
  const rows = state.courses.filter((c) => c.id !== "unsorted").map((c) => `<div class="flex items-center gap-3 rounded-2xl px-3 py-2 ${c.archived ? "opacity-50" : ""}">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${palette(c.id).tile}">${iconFor(c.id)}</span>
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">${esc(c.name)} <span class="font-mono text-[11px] font-semibold text-slate-400">${esc(c.id)}</span></div>
        <div class="text-[11px] text-slate-400">${esc(state.profiles.find((p) => p.id === c.profile)?.label ?? c.profile)}${c.semester ? " · " + esc(c.semester) : ""} · ${plural(c.count, "note")}</div></div>
      <button data-archive="${esc(c.id)}" data-to="${c.archived ? "0" : "1"}" ${state.editable ? "" : "disabled"} class="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold hover:bg-slate-50 disabled:opacity-40 dark:border-ink-600 dark:hover:bg-ink-700">${c.archived ? "Restore" : "Archive"}</button></div>`).join("");
  $("manageList").innerHTML = rows;
  $("manageNote").classList.toggle("hidden", state.editable);
  $("manageForm").classList.toggle("hidden", !state.editable);
  $("profile").innerHTML = state.profiles.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("");
  $("manageError").textContent = error;
}
async function openManage() { await refreshState(); renderManage(); $("manage").classList.remove("hidden"); $("manage").classList.add("flex"); }
function closeManage() { $("manage").classList.add("hidden"); $("manage").classList.remove("flex"); }
async function saveCourse(method, url, body) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return renderManage(data.error || "Something went wrong.");
  if (body.archived && state.course === decodeURIComponent(url.split("/").pop())) state.course = "all";
  await selectCourse(state.course);
  renderManage();
}

// ---- doctor ----
const STATUS_UI = {
  ok: { icon: "✓", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  warn: { icon: "!", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  fail: { icon: "✗", cls: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
};
async function runDoctorUi(deep = false) {
  $("doctor").classList.remove("hidden"); $("doctor").classList.add("flex");
  $("doctorSummary").textContent = deep ? "Running a deep check (asks Claude one tiny question)…" : "Checking your setup…";
  $("doctorList").innerHTML = '<div class="flex items-center gap-2 px-6 py-6 text-sm text-slate-400"><span class="dots"><span></span><span></span><span></span></span>This can take up to 20 seconds.</div>';
  $("doctorAgain").disabled = $("doctorDeep").disabled = true;
  try {
    const checks = await fetch(`/api/doctor${deep ? "?deep=1" : ""}`).then((r) => r.json());
    const n = (s) => checks.filter((c) => c.status === s).length;
    $("doctorSummary").textContent = n("fail") ? `${plural(n("fail"), "problem")} to fix` : n("warn") ? `Working, with ${plural(n("warn"), "thing")} to look at` : "Everything looks good ✨";
    $("doctorList").innerHTML = checks.map((c) => `<div class="flex gap-3 px-6 py-3.5">
        <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${STATUS_UI[c.status].cls}">${STATUS_UI[c.status].icon}</span>
        <div class="min-w-0 flex-1"><div class="text-sm font-bold">${esc(c.label)}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400">${esc(c.detail)}</div>
          ${c.fix ? `<div class="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-ink-700 dark:text-slate-200">${esc(c.fix)}</div>` : ""}</div></div>`).join("");
  } catch {
    $("doctorSummary").textContent = "Couldn't reach the StudyDeck server.";
    $("doctorList").innerHTML = "";
  }
  $("doctorAgain").disabled = $("doctorDeep").disabled = false;
}
function closeDoctor() { $("doctor").classList.add("hidden"); $("doctor").classList.remove("flex"); }

// ---- events ----
$("courses").addEventListener("click", (e) => { const b = e.target.closest("[data-course]"); if (b) selectCourse(b.dataset.course); });
$("scopeBtn").addEventListener("click", () => { if (innerWidth < 768) openPicker(); });
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
$("messages").addEventListener("click", (e) => {
  const go = e.target.closest("[data-view-go]");
  if (go) return setView(go.dataset.viewGo);
  const b = e.target.closest(".cite, .cite-foot");
  if (!b) return;
  hidePreview();
  if (b.dataset.id) openSource(b.dataset.id, b.dataset.quote);
});
$("messages").addEventListener("mouseover", (e) => { const b = e.target.closest(".cite"); if (b && b !== previewFor) showPreview(b); });
$("messages").addEventListener("mouseout", (e) => { if (e.target.closest(".cite") && !e.relatedTarget?.closest?.(".cite")) hidePreview(); });
$("messages").addEventListener("scroll", hidePreview);
$("form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("q").value.trim(); if (q) { $("q").value = ""; ask(q); } });
$("tryRow").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-try]");
  if (!b || state.busy) return;
  const t = suggestions()[+b.dataset.try];
  if (t.course !== state.course) await selectCourse(t.course);
  ask(t.q);
});
$("studyBody").addEventListener("click", (e) => {
  const kind = gk();
  const G_ = GEN_CFG[kind].st();
  const tab = e.target.closest("[data-sub]");
  if (tab) return setSub(tab.dataset.sub);
  if (e.target.closest("[data-gen-open]")) { G_.open = true; updateGenPanel(kind); return loadGenPlan(kind); }
  if (e.target.closest("[data-gen-close]")) { G_.open = false; return updateGenPanel(kind); }
  const dn = e.target.closest("[data-gen-density]");
  if (dn) { G_.density = dn.dataset.genDensity; return updateGenPanel(kind); }
  const pk = e.target.closest("[data-gen-pick]");
  if (pk && G_.plan) {
    const all = G_.plan.lectures;
    G_.selected = new Set((pk.dataset.genPick === "all" ? all : pk.dataset.genPick === "new" ? all.filter((l) => l.status !== "generated") : []).slice(0, 500).map((l) => l.id));
    return updateGenPanel(kind);
  }
  if (e.target.closest("#genGo")) return startGeneration(kind);
  if (e.target.closest("#genCancel")) return cancelGeneration(kind);
  if (e.target.closest("#genDismiss")) return dismissGeneration(kind);
  if (e.target.closest("#genStudy")) { dismissGeneration(kind); return kind === "quiz" ? startQuiz() : kind === "problems" ? startPractice() : startStudySession(); }
  if (e.target.closest("#startStudy")) return startStudySession();
  if (e.target.closest("#exitStudy")) return exitStudySession();
  if (e.target.closest("#revealBtn")) return revealCard();
  const g = e.target.closest("[data-grade]");
  if (g) return rateCard(Number(g.dataset.grade));
  const del = e.target.closest("[data-del-card]");
  if (del) return fetch(`/api/study/cards/${encodeURIComponent(del.dataset.delCard)}`, { method: "DELETE" }).then(loadStudyToday);
  const open = e.target.closest("[data-open-note]");
  if (open) return openSource(open.dataset.openNote, open.dataset.quote);
  // quizzes
  if (e.target.closest("#startQuiz")) return startQuiz();
  if (e.target.closest("#exitQuiz")) return exitQuiz();
  const ln = e.target.closest("[data-qlen]");
  if (ln) { Q.length = Number(ln.dataset.qlen); return renderQuizHome(); }
  const opt = e.target.closest("[data-opt]");
  if (opt) return pickOption(Number(opt.dataset.opt));
  if (e.target.closest("#checkAnswer")) return submitQuizAnswer();
  if (e.target.closest("#nextQ")) return nextQuizQuestion();
  if (e.target.closest("#explainBtn")) return explainMiss();
  const dq = e.target.closest("[data-del-q]");
  if (dq) return fetch(`/api/study/quiz/questions/${encodeURIComponent(dq.dataset.delQ)}`, { method: "DELETE" }).then(loadQuizHome);
});
$("studyBody").addEventListener("change", (e) => {
  const cb = e.target.closest("[data-gen-note]");
  if (!cb) return;
  const G_ = GEN_CFG[gk()].st();
  cb.checked ? G_.selected.add(cb.dataset.genNote) : G_.selected.delete(cb.dataset.genNote);
  updateGenPanel();
});
$("studyBody").addEventListener("input", (e) => { if (e.target.id === "genFocus") GEN_CFG[gk()].st().focus = e.target.value; });
$("studyBody").addEventListener("submit", (e) => { if (e.target.id === "cardForm") submitCard(e); });
$("aiChip").addEventListener("click", (e) => { if (e.target.closest("#aiToggle")) toggleAi(); });
$("notesSearch").addEventListener("input", renderNotes);
$("notesGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openSource(b.dataset.open); });
$("notesGrid").addEventListener("change", (e) => { const s = e.target.closest("[data-move]"); if (s && s.value) moveNoteTo(s.dataset.move, s.value); });
$("moveSelect").addEventListener("change", (e) => { if (openNoteId) moveNoteTo(openNoteId, e.target.value); });
$("closeSource").addEventListener("click", closeSource);
$("clearBtn").addEventListener("click", async () => {
  if (!confirm(`Clear the chat for ${courseName(state.course)}?`)) return;
  await fetch(`/api/chats/${encodeURIComponent(state.course)}`, { method: "DELETE" });
  selectCourse(state.course);
});
for (const id of ["demo", "demoMobile"]) {
  $(id).addEventListener("change", async (e) => {
    await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ demo: e.target.checked }) });
    noteCache.clear(); closeSource(); closePicker();
    if (state.course !== "all") state.course = "all";
    selectCourse("all");
  });
}
document.querySelectorAll(".theme-toggle").forEach((b) => b.addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
}));
$("granolaCard").addEventListener("click", (e) => {
  if (e.target.closest("#connectBtn")) connectGranola();
  if (e.target.closest("#syncBtn")) runGranolaSync();
  if (e.target.closest("#disconnectBtn") && confirm("Disconnect Granola? Your synced notes stay; you can reconnect any time.")) {
    fetch("/api/granola/disconnect", { method: "POST" }).then(() => { G.connected = false; G.msg = ""; G.detail = ""; G.last = null; renderGranola(); });
  }
});
$("manageBtn").addEventListener("click", openManage);
$("closeManage").addEventListener("click", closeManage);
$("manage").addEventListener("click", (e) => { if (e.target === $("manage")) closeManage(); });
$("manageList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-archive]");
  if (b) saveCourse("PATCH", `/api/courses/${encodeURIComponent(b.dataset.archive)}`, { archived: b.dataset.to === "1" });
});
$("manageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveCourse("POST", "/api/courses", { id: $("courseId").value, name: $("courseName").value, semester: $("courseSemester").value, profile: $("profile").value });
  if (!$("manageError").textContent) $("manageForm").reset();
});
$("doctorBtn").addEventListener("click", () => runDoctorUi());
$("doctorAgain").addEventListener("click", () => runDoctorUi());
$("doctorDeep").addEventListener("click", () => runDoctorUi(true));
$("closeDoctor").addEventListener("click", closeDoctor);
$("doctor").addEventListener("click", (e) => { if (e.target === $("doctor")) closeDoctor(); });
$("pickerInput").addEventListener("input", () => { pickerIndex = 0; renderPicker(); });
$("pickerList").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) pick(b.dataset.pick); });
$("picker").addEventListener("click", (e) => { if (e.target === $("picker")) closePicker(); });
document.addEventListener("keydown", (e) => {
  const pickerOpen = !$("picker").classList.contains("hidden");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pickerOpen ? closePicker() : openPicker(); return; }
  if (pickerOpen) {
    if (e.key === "Escape") closePicker();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pickerIndex = Math.max(0, pickerIndex + (e.key === "ArrowDown" ? 1 : -1)); renderPicker(); }
    if (e.key === "Enter") { e.preventDefault(); pick(renderPicker()[pickerIndex]?.id); }
    return;
  }
  const S_ = state.study;
  const typingNow = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (state.view === "study" && S_.sub === "quiz" && S_.quiz.mode === "play" && !typingNow && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const Qz = S_.quiz;
    const q = Qz.queue[Qz.idx];
    if (e.key === "Escape") { if (!$("source").classList.contains("hidden")) { closeSource(); return; } exitQuiz(); return; }
    if (Qz.result) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); nextQuizQuestion(); }
      return;
    }
    if (q && /^[1-5]$/.test(e.key)) { e.preventDefault(); pickOption(Number(e.key) - 1); return; }
    if (q && q.kind !== "tf" && /^[a-eA-E]$/.test(e.key)) { e.preventDefault(); pickOption("abcde".indexOf(e.key.toLowerCase())); return; }
    if (q && q.kind === "multi" && e.key === "Enter") { e.preventDefault(); submitQuizAnswer(); }
    return;
  }
  if (state.view === "study" && S_.sub !== "quiz" && S_.mode === "play" && !typingNow && !e.metaKey && !e.ctrlKey) {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); S_.revealed ? rateCard(3) : revealCard(); return; }
    if (S_.revealed && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); rateCard(Number(e.key)); return; }
    if (e.key === "Escape") { if (!$("source").classList.contains("hidden")) { closeSource(); return; } exitStudySession(); return; }
  }
  if (e.key === "Escape") { closeSource(); closeManage(); closeDoctor(); }
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (e.key === "/" && !typing) { e.preventDefault(); setView("chat"); $("q").focus(); }
});
// Notes can change while you're away (background sync), so refresh when you come back.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !state.busy) { noteCache.clear(); Promise.all([refreshState(), loadNotes(), refreshGranola(), loadStudyToday(), refreshAi()]); }
});

try { state.view = localStorage.getItem("view") === "notes" ? "notes" : "chat"; } catch {}
renderGranola();
refreshGranola();
refreshAi();
selectCourse("all").then(() => { if (state.view === "chat") $("q").focus(); });

import { $, courseName, courseOf, esc, fmtDate, iconFor, palette, plural, state } from "./core.js";
import { emptyState, messageEl, renderTryRow, scrollDown, updateAssistant } from "./chat.js";
import { loadStudyToday, renderStudy } from "./cards.js";
import { refreshAi, renderAi } from "./panels.js";
import { studyMoreBusy } from "./studyhub.js";

// ---- sidebar ----
export function courseRow(id, name, sub, count, extra = "") {
  const active = state.course === id;
  const p = palette(id);
  return `<button data-course="${esc(id)}" class="group flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition ${active ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/15 dark:ring-brand-500/40" : "hover:bg-slate-50 dark:hover:bg-ink-700"}">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base ${p.tile}">${iconFor(id)}</span>
    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-bold ${active ? "text-brand-700 dark:text-brand-200" : ""}">${esc(name)}</span>
      <span class="block truncate text-[11px] font-medium text-slate-400">${esc(sub)}</span></span>
    <span class="rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${extra || (active ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 dark:bg-ink-700 dark:text-slate-300")}">${count}</span></button>`;
}

export function visibleCourses() {
  return state.courses.filter((c) => !c.archived && c.id !== "unsorted" && (c.count > 0 || c.id === state.course));
}

export function renderSidebar() {
  const inbox = courseOf("unsorted");
  const rows = [courseRow("all", "Everything", "All your classes", state.total)];
  for (const c of visibleCourses()) rows.push(courseRow(c.id, c.name, `${c.id}${c.latest ? " · last " + fmtDate(c.latest) : ""}`, c.count));
  if (inbox && inbox.count > 0) rows.push(courseRow("unsorted", "Inbox", "Notes that need a class", inbox.count, "bg-sun text-ink-900"));
  $("courses").innerHTML = rows.join("");
}

export function renderStreak() {
  const n = state.streak;
  $("streak").innerHTML = n > 0
    ? `<span class="text-lg">🔥</span><span><b class="font-extrabold">${n}-day streak</b> <span class="font-medium opacity-70">${n >= 3 ? "· on a roll!" : "· keep it alive"}</span></span>`
    : `<span class="text-lg grayscale">🔥</span><span class="font-medium opacity-80">Ask a question to start a streak</span>`;
}

// ---- header ----
export function renderHeader() {
  const c = courseOf(state.course);
  const count = state.course === "all" ? state.total : c?.count ?? 0;
  const latest = state.course === "all" ? state.courses.map((x) => x.latest).filter(Boolean).sort().at(-1) : c?.latest;
  $("scopeTitle").textContent = courseName(state.course);
  $("scopeSub").textContent = [state.course !== "all" && state.course !== "unsorted" ? state.course : "", plural(count, "note"), latest ? `latest ${fmtDate(latest)}` : ""].filter(Boolean).join(" · ");
  const hi = $("heroIcon");
  hi.className = `grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl md:h-14 md:w-14 md:text-3xl ${palette(state.course).tile}`;
  hi.innerHTML = iconFor(state.course);
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

export async function refreshState() {
  const r = await fetch("/api/state").then((r) => r.json());
  Object.assign(state, { courses: r.courses, profiles: r.profiles, editable: r.editable, total: r.total, source: r.source, demo: r.demo, streak: r.streak, aiPaused: r.aiPaused });
  $("demo").checked = $("demoMobile").checked = state.demo;
  renderSidebar(); renderHeader(); renderStreak(); renderAi();
}

/** Suggested classes for Inbox notes, by file name. Only loaded while the Inbox is open. */
export const INBOX = { suggestions: new Map() };

export async function loadNotes() {
  state.notes = await fetch(`/api/notes?course=${encodeURIComponent(state.course)}`).then((r) => (r.ok ? r.json() : []));
  INBOX.suggestions = new Map();
  if (state.course === "unsorted" && state.source === "notes") {
    const list = await fetch("/api/notes/suggestions").then((r) => (r.ok ? r.json() : []));
    INBOX.suggestions = new Map(list.filter((x) => x.suggestion).map((x) => [x.file, x.suggestion]));
  }
  if (state.view === "notes") renderNotes();
}

// ---- views ----
export function setView(v) {
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

export function noteCard(n) {
  const p = palette(n.course);
  const inbox = n.course === "unsorted";
  const mover = inbox && state.source === "notes"
    ? `<select data-move="${esc(n.id)}" class="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-900 dark:border-sun/40 dark:bg-sun/10 dark:text-sun">
         <option value="">📥 File under a class…</option>${state.courses.filter((c) => !c.archived && c.id !== "unsorted").map((c) => `<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.name)}</option>`).join("")}</select>`
    : "";
  const sug = inbox ? INBOX.suggestions.get(n.file) : null;
  const suggestion = sug
    ? `<div class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-2.5 py-2 text-xs dark:bg-brand-500/10"><span class="min-w-0 flex-1 font-semibold text-brand-800 dark:text-brand-200">${sug.confidence === "likely" ? "Looks like" : "Maybe"} <b>${esc(courseName(sug.course))}</b></span><button data-file-to="${esc(n.id)}|${esc(sug.course)}" class="min-h-9 rounded-lg bg-brand-500 px-3 font-extrabold text-white hover:bg-brand-600">File it</button></div>`
    : "";
  return `<div class="fade-in group flex flex-col rounded-2xl border-l-4 bg-white p-4 shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-pop dark:bg-ink-800 dark:ring-ink-600 ${p.bar}">
    <button data-open="${esc(n.id)}" class="flex-1 text-left">
      <div class="flex items-center justify-between gap-2 text-xs"><span class="font-extrabold ${p.text}">${esc(fmtDate(n.date))}</span><span class="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-500 dark:bg-ink-700 dark:text-slate-300">${esc(n.course === "unsorted" ? "Inbox" : n.course)}</span></div>
      <div class="mt-2 line-clamp-2 text-[15px] leading-snug font-extrabold">${esc(n.title)}</div>
      <p class="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">${esc(n.snippet)}</p>
    </button>${suggestion}${mover}</div>`;
}

export function renderNotes() {
  const q = $("notesSearch").value.trim().toLowerCase();
  const list = q ? state.notes.filter((n) => `${n.title} ${n.snippet} ${n.course}`.toLowerCase().includes(q)) : state.notes;
  const likely = state.course === "unsorted" ? list.filter((n) => INBOX.suggestions.get(n.file)?.confidence === "likely") : [];
  const bulk = likely.length > 1
    ? `<div class="col-span-full flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600"><span class="min-w-0 flex-1 text-sm font-semibold">${likely.length} notes clearly look like one of your classes. Suggestions come from matching words with each class's notes, so check them.</span><button data-file-all class="min-h-10 rounded-xl bg-brand-500 px-4 text-sm font-extrabold text-white hover:bg-brand-600">Review and file ${likely.length}</button></div>`
    : "";
  $("notesGrid").innerHTML = list.length
    ? bulk + list.map(noteCard).join("")
    : `<div class="col-span-full mx-auto mt-10 max-w-sm text-center text-sm text-slate-500"><div class="text-4xl">${q ? "🤷" : "📭"}</div><p class="mt-3 font-semibold">${q ? "No notes match that search." : "No notes in here yet."}</p>${q ? "" : '<p class="mt-1">Connect Granola in the sidebar and your classes fill up automatically.</p>'}</div>`;
}

export async function selectCourse(id, { keepView = true } = {}) {
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

export function setBusy(b) {
  state.busy = b;
  $("send").disabled = b;
  $("sendLabel").innerHTML = b ? '<span class="dots"><span></span><span></span><span></span></span>' : "Ask";
}

export async function readSse(res, onEvent) {
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

export async function ask(question) {
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
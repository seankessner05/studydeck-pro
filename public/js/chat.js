import { $, BAD_CHIP, EMPTY_LINES, SAMPLE_QUESTIONS, courseName, courseOf, esc, fmtDate, iconFor, inline, palette, plural, state, unesc } from "./core.js";

// Must match src/citations.ts (runs on escaped HTML, so quotes may appear as &quot;)
export const CITE_RE = /\[([A-Za-z0-9]+) (\d{4}-\d{2}-\d{2}): ([^\]|]+?)(?:\s*\|\s*(?:&quot;|["“])([^\]]*?)(?:&quot;|["”]))?\s*\]/g;

/** Minimal markdown: headings, bullets, tables, blockquotes, bold, code. Input is escaped first. */
export function renderMarkdown(src) {
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
export function renderAnswer(text, msg) {
  const byLabel = Object.fromEntries((msg.notesUsed || []).map((n) => [n.label, n.id]));
  const byRaw = Object.fromEntries((msg.citations || []).map((c) => [c.raw, c]));
  const sources = new Map();
  let prev = { end: -1, n: 0 };

  let html = renderMarkdown(text).replace(CITE_RE, (raw, course, date, topic, quote, offset, whole) => {
    // The answer was escaped before this ran, so the pieces of a citation are un-escaped again before they are
    // compared with the real note labels and quotes (which contain plain apostrophes, ampersands and quotes).
    topic = unesc(topic).trim();
    quote = quote ? unesc(quote) : "";
    const label = `${course} ${date}: ${topic}`;
    const info = byRaw[unesc(raw)];
    const id = info?.noteId || byLabel[label] || "";
    const bad = !!info && info.status !== "ok";
    const key = id || label;
    if (!sources.has(key)) sources.set(key, { n: sources.size + 1, id, label, course, date, topic, quote, bad });
    const src = sources.get(key);
    const gap = whole.slice(prev.end, offset);
    const dupe = prev.n === src.n && /^\s*$/.test(gap);
    prev = { end: offset + raw.length, n: src.n };
    if (dupe) return gap;
    const why = bad ? (info.status === "unknown_note" ? "This citation doesn't match a note that was sent." : "Quote not found word-for-word in the note.") : "";
    return `<button type="button" class="cite mx-0.5 inline-grid h-[1.35rem] min-w-[1.35rem] place-items-center rounded-full px-1.5 align-[1px] text-[11px] font-extrabold leading-none transition active:scale-90 ${bad ? BAD_CHIP : palette(course).chip}"
      data-id="${esc(id)}" data-quote="${esc(quote)}" data-label="${esc(label)}" data-why="${esc(why)}" aria-label="Source ${src.n}: ${esc(label)}">${bad ? "!" : src.n}</button>`;
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

export function notesUsedLine(msg) {
  if (!msg.notesUsed) return "";
  const n = msg.notesUsed.length;
  const mode = msg.mode === "ranked" ? "best matches by keyword and recency" : "every note in scope";
  const list = msg.notesUsed.map((x) => `<li class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full ${palette(x.label.split(" ")[0]).dot}"></span>${esc(x.label)}</li>`).join("");
  return `<details class="mt-2.5 text-[11px] text-slate-400"><summary class="cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-200">Searched ${plural(n, "note")} (${mode})</summary>
    <ul class="mt-1.5 space-y-0.5 pl-1">${list || "<li>none</li>"}</ul></details>`;
}

export function messageEl(msg) {
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

export function updateAssistant(el, msg, streaming = false) {
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

export const scrollDown = () => { const m = $("messages"); m.scrollTop = m.scrollHeight; };

// ---- suggestions ----
export function suggestions() {
  if (state.source === "samples") return SAMPLE_QUESTIONS;
  const mine = state.notes.slice(0, 2);
  const out = mine.map((n) => ({ course: state.course, q: `What were the key points of “${n.title}”?` }));
  const label = state.course === "all" ? "my classes" : courseName(state.course);
  out.push({ course: state.course, q: `What formulas and definitions should I memorize for ${label}?` });
  out.push({ course: state.course, q: `What has my professor said about the exam in ${label}?` });
  return out;
}

export function renderTryRow(show) {
  $("tryRow").classList.toggle("hidden", !show);
  $("tryRow").classList.toggle("flex", show);
  $("tryRow").innerHTML = show
    ? `<span class="shrink-0 self-center text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Try asking</span>` +
      suggestions().map((t, i) => `<button type="button" data-try="${i}" class="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-card ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:text-brand-600 hover:ring-brand-300 dark:bg-ink-800 dark:text-slate-200 dark:ring-ink-600 dark:hover:ring-brand-400">${esc(t.q)}</button>`).join("")
    : "";
}

export function emptyState() {
  const line = EMPTY_LINES[Math.floor(Math.random() * EMPTY_LINES.length)];
  const count = state.course === "all" ? state.total : courseOf(state.course)?.count ?? 0;
  $("messages").innerHTML = `<div class="empty fade-in mx-auto mt-[5vh] max-w-lg text-center">
    <div class="pop mx-auto grid h-20 w-20 place-items-center rounded-3xl text-4xl ${palette(state.course).tile}">${iconFor(state.course)}</div>
    <h2 class="mt-5 text-2xl font-extrabold tracking-tight">${line}</h2>
    <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">${count ? `Searching ${plural(count, "note")} in <b>${esc(courseName(state.course))}</b>. Every answer shows the notes it came from.` : "No notes here yet. Sync from Granola to fill this class up."}</p>
    ${count ? `<button data-view-go="notes" class="mt-4 rounded-full bg-brand-50 px-5 py-2 text-sm font-bold text-brand-700 transition hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-200">📚 Browse the notes</button>` : ""}
  </div>`;
}
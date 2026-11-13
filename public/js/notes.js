import { $, esc, state } from "./core.js";
import { renderMarkdown } from "./chat.js";
import { loadNotes, refreshState } from "./shell.js";

// ---- source panel + hover preview ----
export const norm = (s) => s.toLowerCase().replace(/[*_`|>#]/g, " ").replace(/[^\p{L}\p{N}.%/+−=-]+/gu, " ").replace(/\s+/g, " ").trim();
export const noteCache = new Map();
export const getNote = (id) => {
  if (!noteCache.has(id)) {
    const [course, file] = id.split("/");
    noteCache.set(id, fetch(`/api/notes/${encodeURIComponent(course)}/${encodeURIComponent(file)}`).then((r) => (r.ok ? r.json() : null)));
  }
  return noteCache.get(id);
};

/** Find the block (paragraph, bullet, table cell) that contains the quote, else the one sharing the most words. */
export function findPassage(root, quote) {
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

export let openNoteId = "";
export async function openSource(id, quote) {
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

export function closeSource() {
  $("source").classList.add("hidden");
  $("source").classList.remove("flex");
  openNoteId = "";
}

export async function moveNoteTo(id, target) {
  const [course, file] = id.split("/");
  const res = await fetch(`/api/notes/${encodeURIComponent(course)}/${encodeURIComponent(file)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ course: target }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || "Couldn't move that note.");
  noteCache.clear();
  await Promise.all([refreshState(), loadNotes()]);
  if (openNoteId === id) { if (state.view === "notes" || state.course === "all" || state.course === target) openSource(data.id); else closeSource(); }
}

export let previewFor = null;
export async function showPreview(chip) {
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
export function hidePreview() { previewFor = null; $("preview").classList.add("hidden"); }
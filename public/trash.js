// ---- Deleting with undo, and the trash ----
// Nothing is deleted on the spot: a deleted card, question or problem moves to the trash with its answer history,
// an "Undo" message appears for a few seconds, and the Trash list can bring anything back for 30 days.

const TR = { items: [], keptDays: 30, toastTimer: null };
const TRASH_RELOAD = { card: () => loadStudyToday(), question: () => loadQuizHome(), problem: () => loadProblemsHome() };
const TRASH_WORD = { card: "Card", question: "Question", problem: "Problem" };
const TRASH_HISTORY_WORD = { card: "review", question: "answer", problem: "attempt" };

function toastEl() {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.className = "pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4";
    document.body.appendChild(el);
  }
  return el;
}

/** A short message at the bottom of the screen, optionally with one button. It reads itself out to screen readers. */
function showToast(text, action) {
  const el = toastEl();
  clearTimeout(TR.toastTimer);
  el.innerHTML = `<div class="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-900 py-2.5 pr-2.5 pl-4 text-sm font-semibold text-white shadow-pop dark:bg-white dark:text-ink-900">
    <span class="min-w-0 flex-1 truncate">${esc(text)}</span>
    ${action ? `<button type="button" data-toast-action class="min-h-10 shrink-0 rounded-xl bg-white/15 px-4 text-sm font-extrabold hover:bg-white/25 dark:bg-ink-900/10 dark:hover:bg-ink-900/20">${esc(action.label)}</button>` : ""}
  </div>`;
  if (action) el.querySelector("[data-toast-action]").addEventListener("click", () => { hideToast(); action.run(); });
  TR.toastTimer = setTimeout(hideToast, action ? 9000 : 4000);
}
function hideToast() {
  clearTimeout(TR.toastTimer);
  const el = document.getElementById("toast");
  if (el) el.innerHTML = "";
}

async function restoreTrash(entry) {
  const r = await api(`/api/study/trash/${encodeURIComponent(entry.id)}/restore`, "POST");
  await TRASH_RELOAD[entry.kind]();
  showToast(r.ok ? `${TRASH_WORD[entry.kind]} put back.` : r.data.error || "Couldn't put that back.");
  return r.ok;
}

/** Delete through the API, refresh the list, and offer to undo. */
async function deleteWithUndo(kind, url) {
  const r = await api(url, "DELETE");
  await TRASH_RELOAD[kind]();
  if (!r.ok) return showToast(r.data.error || "Couldn't delete that.");
  const entry = r.data.trash;
  if (entry) showToast(`${TRASH_WORD[kind]} moved to trash.`, { label: "Undo", run: () => restoreTrash(entry) });
}

// ---- the Trash list ----
function trashRowsHtml() {
  if (!TR.items.length) return `<div class="px-5 py-10 text-center text-sm font-semibold text-slate-400">The trash is empty.</div>`;
  return TR.items.map((t) => `<div class="flex items-center gap-3 px-5 py-3">
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-bold">${esc(t.label)}</div>
        <div class="text-[11px] font-semibold text-slate-400">${TRASH_WORD[t.kind]} · ${esc(courseName(t.course))} · deleted ${esc(ago(new Date(t.deletedAt).toISOString()))}${t.history ? ` · comes back with ${plural(t.history, TRASH_HISTORY_WORD[t.kind])}` : ""}</div>
      </div>
      <button type="button" data-trash-restore="${esc(t.id)}" class="min-h-10 shrink-0 rounded-xl bg-brand-500 px-4 text-xs font-extrabold text-white hover:bg-brand-600">Put back</button>
      <button type="button" data-trash-purge="${esc(t.id)}" class="min-h-10 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-500 hover:bg-red-50 hover:text-red-600 dark:border-ink-600 dark:hover:bg-red-500/10" aria-label="Delete for good: ${esc(t.label)}">Delete for good</button>
    </div>`).join("");
}

function renderTrash() {
  const panel = dialogOf("trash");
  if (!panel) return;
  panel.querySelector("[data-dialog-body]").innerHTML = `<div class="divide-y divide-slate-100 dark:divide-ink-700">${trashRowsHtml()}</div>`;
  panel.querySelector("[data-dialog-note]").textContent = TR.items.length ? `${plural(TR.items.length, "item")}. Each is kept for ${TR.keptDays} days, then removed for good.` : `Deleted cards, questions and problems wait here for ${TR.keptDays} days.`;
}

async function loadTrash() {
  const r = await api(`/api/study/trash?course=${encodeURIComponent(state.course)}`);
  if (r.ok) { TR.items = r.data.items; TR.keptDays = r.data.keptDays; }
  renderTrash();
}

function openTrash(opener) {
  openDialog("trash", "Trash", opener).note.textContent = "Loading…";
  loadTrash();
}

document.addEventListener("click", async (e) => {
  const opener = e.target.closest("[data-trash-open]");
  if (opener) return openTrash(opener);
  if (!dialogOf("trash")) return;
  const back = e.target.closest("[data-trash-restore]");
  if (back) {
    const entry = TR.items.find((t) => t.id === back.dataset.trashRestore);
    if (entry) await restoreTrash(entry);
    return loadTrash();
  }
  const purge = e.target.closest("[data-trash-purge]");
  if (purge) {
    if (!confirm("Delete this for good? It can't be brought back after this.")) return;
    await api(`/api/study/trash/${encodeURIComponent(purge.dataset.trashPurge)}`, "DELETE");
    return loadTrash();
  }
});

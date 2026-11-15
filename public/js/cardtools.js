// ---- Fixing cards while you study: undo a rating, edit, suspend, flag ----
import { $, S, api, esc } from "./core.js";
import { GRADE_LABEL, renderPlayer } from "./cards.js";
import { showToast } from "./trash.js";

const FLAG_LABEL = { wrong: "Wrong or misleading", unclear: "Unclear question", not_on_exam: "Not on my exam" };
export const CT = { editing: false, flagging: false, error: "", lastRated: null };

/** The small actions under a revealed card. */
export function cardToolsHtml(card) {
  if (CT.editing) {
    return `<form data-ct-form class="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 dark:bg-ink-800 dark:ring-ink-600">
        <label class="block text-xs font-bold text-slate-500">Front<textarea data-ct-field="front" rows="2" class="mt-1 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600">${esc(card.front)}</textarea></label>
        <label class="block text-xs font-bold text-slate-500">Back<textarea data-ct-field="back" rows="3" class="mt-1 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-ink-600">${esc(card.back)}</textarea></label>
        ${card.noteId ? `<label class="block text-xs font-bold text-slate-500">Quote from your notes (must be word for word)<textarea data-ct-field="quote" rows="2" class="mt-1 w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-xs dark:border-ink-600">${esc(card.quote ?? "")}</textarea></label>` : ""}
        ${CT.error ? `<p class="text-xs font-semibold text-red-600 dark:text-red-400" role="alert">${esc(CT.error)}</p>` : ""}
        <div class="flex gap-2"><button class="min-h-10 rounded-xl bg-brand-500 px-4 text-sm font-extrabold text-white hover:bg-brand-600">Save</button><button type="button" data-ct-cancel class="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold dark:border-ink-600">Cancel</button></div>
      </form>`;
  }
  const flagMenu = CT.flagging
    ? `<div class="flex flex-wrap justify-center gap-2" role="group" aria-label="Why flag this card">${Object.entries(FLAG_LABEL).map(([k, v]) => `<button data-ct-flag="${k}" class="min-h-10 rounded-xl bg-red-50 px-3 text-xs font-extrabold text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300">${v}</button>`).join("")}<button data-ct-flag-cancel class="min-h-10 rounded-xl px-3 text-xs font-bold text-slate-500">Never mind</button></div>`
    : "";
  const btn = "min-h-10 rounded-xl px-3 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-ink-700 dark:hover:text-slate-100";
  return `<div class="space-y-2">
      <div class="flex flex-wrap items-center justify-center gap-1">
        <button data-ct-edit class="${btn}">Edit card</button>
        <button data-ct-suspend class="${btn}" title="Stop showing this card until you unsuspend it">Suspend</button>
        <button data-ct-flag-open class="${btn}" aria-expanded="${CT.flagging}">Flag as bad</button>
        ${card.editedAt ? '<span class="text-[11px] font-semibold text-slate-400">· edited by you</span>' : ""}
      </div>${flagMenu}</div>`;
}

/** Take the current card out of this session (after suspend or flag) and offer to undo. */
async function removeCurrent(patch, undoPatch, message) {
  const card = S.queue[S.idx];
  const r = await api(`/api/study/cards/${encodeURIComponent(card.id)}`, "PATCH", patch);
  if (!r.ok) return showToast(r.data.error || "Couldn't change that card.");
  const index = S.idx;
  S.queue = S.queue.filter((c, i) => i < index || c.id !== card.id);
  S.revealed = false;
  CT.flagging = false;
  renderPlayer();
  showToast(message, {
    label: "Undo",
    run: async () => {
      const u = await api(`/api/study/cards/${encodeURIComponent(card.id)}`, "PATCH", undoPatch);
      if (!u.ok) return showToast(u.data.error || "Couldn't undo that.");
      S.queue.splice(Math.min(S.idx, S.queue.length), 0, card);
      S.mode = "play";
      renderPlayer();
    },
  });
}

/** Called after a rating is saved, so the rating can be taken back. */
export function offerUndo(card, grade, requeued) {
  CT.lastRated = { card, grade, requeued };
  showToast(`Rated ${GRADE_LABEL[grade]}.`, { label: "Undo", run: undoRating });
}

async function undoRating() {
  const last = CT.lastRated;
  if (!last) return;
  CT.lastRated = null;
  const r = await api("/api/study/review/undo", "POST", { cardId: last.card.id });
  if (!r.ok) return showToast(r.data.error || "Couldn't undo that rating.");
  // drop the copy that came back later in the session, then show the card again, answer visible
  if (last.requeued) {
    const at = S.queue.findLastIndex((c) => c.id === last.card.id);
    if (at > S.idx - 1) S.queue.splice(at, 1);
  }
  S.idx = Math.max(0, S.idx - 1);
  S.queue[S.idx] = { ...last.card, ...r.data.card, previews: r.data.previews };
  S.reviewed = Math.max(0, S.reviewed - 1);
  if (last.grade >= 2) S.correct = Math.max(0, S.correct - 1);
  S.mode = "play";
  S.revealed = true;
  renderPlayer();
}

export function init() {
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-ct-edit],[data-ct-cancel],[data-ct-suspend],[data-ct-flag-open],[data-ct-flag],[data-ct-flag-cancel]");
    if (!t || S.mode !== "play") return;
    const card = S.queue[S.idx];
    if (!card) return;
    if (t.hasAttribute("data-ct-edit")) { CT.editing = true; CT.error = ""; return renderPlayer(); }
    if (t.hasAttribute("data-ct-cancel")) { CT.editing = false; return renderPlayer(); }
    if (t.hasAttribute("data-ct-flag-open")) { CT.flagging = !CT.flagging; return renderPlayer(); }
    if (t.hasAttribute("data-ct-flag-cancel")) { CT.flagging = false; return renderPlayer(); }
    if (t.hasAttribute("data-ct-suspend")) return removeCurrent({ suspended: true }, { suspended: false }, "Card suspended. It won't come up until you unsuspend it.");
    if (t.dataset.ctFlag) return removeCurrent({ flag: t.dataset.ctFlag }, { flag: null }, "Card flagged and taken out of your sessions.");
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-ct-form]");
    if (!form) return;
    e.preventDefault();
    const card = S.queue[S.idx];
    const val = (k) => form.querySelector(`[data-ct-field="${k}"]`)?.value;
    const body = { front: val("front"), back: val("back") };
    if (card.noteId) body.quote = val("quote");
    const r = await api(`/api/study/cards/${encodeURIComponent(card.id)}`, "PATCH", body);
    if (!r.ok) { CT.error = r.data.error || "Couldn't save."; return renderPlayer(); }
    for (const c of S.queue) if (c.id === card.id) Object.assign(c, r.data);
    CT.editing = false;
    renderPlayer();
    showToast("Card saved.");
  });
}

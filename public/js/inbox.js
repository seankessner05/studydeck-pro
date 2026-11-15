// ---- Filing Inbox notes: one tap per suggestion, or review and file several at once ----
import { courseName, esc, state } from "./core.js";
import { INBOX } from "./shell.js";
import { moveNoteTo } from "./notes.js";
import { closeDialog, dialogOf, openDialog } from "./dialog.js";
import { showToast } from "./trash.js";

function reviewAll(opener) {
  const likely = state.notes.filter((n) => n.course === "unsorted" && INBOX.suggestions.get(n.file)?.confidence === "likely");
  const d = openDialog("file-all", "File these notes?", opener);
  d.note.textContent = "Untick any that are wrong. Nothing moves until you press File.";
  d.body.innerHTML = `<form data-file-all-form class="space-y-1 p-3">
      ${likely.map((n) => `<label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-ink-700">
        <input type="checkbox" checked value="${esc(n.id)}|${esc(INBOX.suggestions.get(n.file).course)}" class="h-5 w-5 shrink-0 accent-brand-500" />
        <span class="min-w-0 flex-1"><span class="block truncate text-sm font-bold">${esc(n.title)}</span><span class="block text-xs text-slate-500 dark:text-slate-400">→ ${esc(courseName(INBOX.suggestions.get(n.file).course))}</span></span></label>`).join("")}
      <div class="flex gap-2 px-3 pt-3"><button class="min-h-10 rounded-xl bg-brand-500 px-5 text-sm font-extrabold text-white hover:bg-brand-600">File</button><button type="button" data-dialog-close class="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold dark:border-ink-600">Cancel</button></div>
    </form>`;
}

export function init() {
  document.addEventListener("click", async (e) => {
    const one = e.target.closest("[data-file-to]");
    if (one) {
      const [id, course] = one.dataset.fileTo.split("|");
      one.disabled = true;
      await moveNoteTo(id, course);
      return showToast(`Filed under ${courseName(course)}.`);
    }
    const all = e.target.closest("[data-file-all]");
    if (all) return reviewAll(all);
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-file-all-form]");
    if (!form || !dialogOf("file-all")) return;
    e.preventDefault();
    const picked = [...form.querySelectorAll("input:checked")].map((i) => i.value.split("|"));
    closeDialog();
    for (const [id, course] of picked) await moveNoteTo(id, course);
    if (picked.length) showToast(`Filed ${picked.length} ${picked.length === 1 ? "note" : "notes"}.`);
  });
}

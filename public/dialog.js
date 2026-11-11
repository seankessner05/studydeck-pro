// ---- One small dialog used by the Trash and Restore screens ----
// Keyboard and screen-reader behaviour lives here once: focus moves into the dialog and stays there, Escape or a
// click outside closes it, and focus returns to the button that opened it.

const DLG = { returnFocus: null, onClose: null };

function closeDialog() {
  const panel = document.getElementById("dialogPanel");
  if (!panel) return;
  panel.remove();
  const back = DLG.returnFocus;
  const onClose = DLG.onClose;
  DLG.returnFocus = DLG.onClose = null;
  if (back && document.contains(back)) back.focus();
  if (onClose) onClose();
}

/** Opens an empty dialog and returns { note, body } elements to fill in. `kind` lets the opener find its own dialog. */
function openDialog(kind, title, opener, onClose) {
  closeDialog();
  DLG.returnFocus = opener || null;
  DLG.onClose = onClose || null;
  const panel = document.createElement("div");
  panel.id = "dialogPanel";
  panel.dataset.kind = kind;
  panel.className = "fixed inset-0 z-40 flex items-start justify-center bg-ink-900/50 p-4 pt-[8vh] backdrop-blur-sm";
  panel.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="dialogTitle" class="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-pop ring-1 ring-slate-200 dark:bg-ink-800 dark:ring-ink-600">
      <div class="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-ink-700">
        <div class="min-w-0"><div id="dialogTitle" class="text-lg font-extrabold">${esc(title)}</div><div data-dialog-note class="text-xs font-medium text-slate-500 dark:text-slate-400"></div></div>
        <button type="button" data-dialog-close class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-700" aria-label="Close">×</button>
      </div>
      <div data-dialog-body class="max-h-[60vh] overflow-y-auto"></div>
    </div>`;
  document.body.appendChild(panel);
  panel.querySelector("[data-dialog-close]").focus();
  return { panel, note: panel.querySelector("[data-dialog-note]"), body: panel.querySelector("[data-dialog-body]") };
}

/** The open dialog of this kind, or null. */
const dialogOf = (kind) => {
  const panel = document.getElementById("dialogPanel");
  return panel && panel.dataset.kind === kind ? panel : null;
};

document.addEventListener("click", (e) => {
  const panel = document.getElementById("dialogPanel");
  if (panel && (e.target === panel || e.target.closest("[data-dialog-close]"))) closeDialog();
});

document.addEventListener("keydown", (e) => {
  const panel = document.getElementById("dialogPanel");
  if (!panel) return;
  if (e.key === "Escape") { e.stopPropagation(); return closeDialog(); }
  if (e.key === "Tab") {
    const items = [...panel.querySelectorAll("button:not([disabled]), a[href], input, textarea, select")];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

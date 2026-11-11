// ---- Restoring a backup ----
// Two steps on purpose: first look inside a backup (nothing changes), then confirm. The current data is backed up
// before it is replaced, so a restore can itself be undone from this same list.

const RS = { backups: [], look: null, busy: false, error: "" };
const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const RS_ROWS = [["cards", "Flashcards"], ["reviews", "Card reviews"], ["questions", "Quiz questions"], ["problems", "Practice problems"], ["exams", "Exams"]];

function restoreListHtml() {
  if (!RS.backups.length) return `<div class="px-5 py-10 text-center text-sm font-semibold text-slate-400">No backups yet. One is made automatically once a day.</div>`;
  return `<div class="divide-y divide-slate-100 dark:divide-ink-700">${RS.backups.map((b) => `<div class="flex items-center gap-3 px-5 py-3">
      <div class="min-w-0 flex-1"><div class="text-sm font-bold">${esc(fmtWhen(b.at))}</div><div class="text-[11px] font-semibold text-slate-400">${Math.max(1, Math.round(b.bytes / 1024))} KB · ${esc(ago(new Date(b.at).toISOString()))}</div></div>
      <button type="button" data-restore-look="${esc(b.file)}" class="min-h-10 shrink-0 rounded-xl border border-slate-200 px-4 text-xs font-extrabold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Look inside</button>
    </div>`).join("")}</div>`;
}

function restoreLookHtml() {
  const { backup, now } = RS.look;
  const rows = RS_ROWS.map(([k, label]) => {
    const diff = backup.counts[k] - now[k];
    return `<tr class="border-t border-slate-100 dark:border-ink-700"><th scope="row" class="py-2 text-left font-semibold">${label}</th><td class="py-2 text-right tabular-nums">${now[k]}</td><td class="py-2 text-right font-extrabold tabular-nums">${backup.counts[k]}</td><td class="py-2 pl-3 text-right text-xs font-bold tabular-nums ${diff < 0 ? "text-red-600 dark:text-red-400" : diff > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-slate-400"}">${diff > 0 ? "+" : ""}${diff || "same"}</td></tr>`;
  }).join("");
  const loses = RS_ROWS.some(([k]) => backup.counts[k] < now[k]);
  return `<div class="space-y-4 px-5 py-4">
      <table class="w-full text-sm"><thead><tr class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400"><th class="pb-1 text-left">What</th><th class="pb-1 text-right">Now</th><th class="pb-1 text-right">In this backup</th><th class="pb-1 pl-3 text-right">Change</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="text-xs font-medium text-slate-500 dark:text-slate-400">${loses ? "This backup holds less than you have now: anything made or studied since it was taken would be replaced. " : ""}Before anything is replaced, your current data is saved as a new backup, so you can come back to it from this list.</p>
      ${RS.error ? `<div class="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">${esc(RS.error)}</div>` : ""}
      <div class="flex flex-wrap gap-3"><button type="button" data-restore-go="${esc(backup.file)}" ${RS.busy ? "disabled" : ""} class="min-h-10 rounded-xl bg-brand-500 px-5 text-sm font-extrabold text-white hover:bg-brand-600 disabled:opacity-50">${RS.busy ? "Restoring…" : "Replace my data with this backup"}</button>
        <button type="button" data-restore-back class="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 dark:border-ink-600 dark:hover:bg-ink-700">Back to the list</button></div>
    </div>`;
}

function renderRestore() {
  const panel = dialogOf("restore");
  if (!panel) return;
  panel.querySelector("[data-dialog-note]").textContent = RS.look ? `Backup from ${fmtWhen(RS.look.backup.at)}` : "Pick a backup to see what it holds. Looking changes nothing.";
  panel.querySelector("[data-dialog-body]").innerHTML = RS.look ? restoreLookHtml() : (RS.error ? `<div class="mx-5 mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">${esc(RS.error)}</div>` : "") + restoreListHtml();
}

async function openRestore(opener) {
  RS.look = null; RS.error = ""; RS.busy = false;
  openDialog("restore", "Restore a backup", opener).note.textContent = "Loading…";
  const r = await api("/api/study/backups");
  RS.backups = r.ok ? r.data : [];
  renderRestore();
}

document.addEventListener("click", async (e) => {
  const opener = e.target.closest("[data-restore-open]");
  if (opener) return openRestore(opener);
  if (!dialogOf("restore")) return;
  const look = e.target.closest("[data-restore-look]");
  if (look) {
    const r = await api(`/api/study/backups/${encodeURIComponent(look.dataset.restoreLook)}`);
    RS.error = r.ok ? "" : r.data.error || "Couldn't open that backup.";
    RS.look = r.ok ? r.data : null;
    return renderRestore();
  }
  if (e.target.closest("[data-restore-back]")) { RS.look = null; RS.error = ""; return renderRestore(); }
  const go = e.target.closest("[data-restore-go]");
  if (go && !RS.busy) {
    RS.busy = true; RS.error = ""; renderRestore();
    const r = await api(`/api/study/backups/${encodeURIComponent(go.dataset.restoreGo)}/restore`, "POST", { confirm: true });
    RS.busy = false;
    if (!r.ok) { RS.error = r.data.error || "The restore didn't happen. Your data is unchanged."; return renderRestore(); }
    // Everything on screen was read from the old data: start clean.
    location.reload();
  }
});

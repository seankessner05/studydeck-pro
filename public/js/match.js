import { $, api, btnGhost, btnPrimary, esc, panelCls, plural, state } from "./core.js";

// =============================================================== Match game
export const MT = { on: false, pairs: [], tiles: [], sel: null, matched: new Set(), misses: 0, t0: 0, done: false, wrong: null, error: "" };

export async function startMatch() {
  const r = await api(`/api/study/match?course=${encodeURIComponent(state.course)}&count=6`);
  if (!r.ok) { const el = $("studyToolMsg"); if (el) el.textContent = r.data.error || "Couldn't start."; return; }
  const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  MT.pairs = r.data;
  MT.tiles = shuffle([...r.data.map((p) => ({ id: p.id, kind: "term", text: p.term })), ...r.data.map((p) => ({ id: p.id, kind: "def", text: p.definition }))]).map((t, i) => ({ ...t, key: i }));
  Object.assign(MT, { on: true, sel: null, matched: new Set(), misses: 0, t0: Date.now(), done: false, wrong: null });
  renderMatch();
}

export function renderMatch() {
  const secs = Math.round((Date.now() - MT.t0) / 1000);
  const tiles = MT.tiles.map((t) => {
    const gone = MT.matched.has(t.id);
    const sel = MT.sel === t.key;
    const bad = MT.wrong && MT.wrong.includes(t.key);
    return `<button data-mt-tile="${t.key}" ${gone ? "disabled" : ""} class="flex min-h-[5.5rem] items-center justify-center rounded-2xl border-2 p-3 text-center text-sm font-bold leading-snug transition ${gone ? "pointer-events-none scale-90 border-transparent opacity-0" : bad ? "border-red-400 bg-red-50 dark:bg-red-500/10" : sel ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15" : "border-slate-200 bg-white hover:border-brand-300 dark:border-ink-600 dark:bg-ink-800"} ${t.kind === "def" ? "italic" : ""}">${esc(t.text)}</button>`;
  }).join("");
  $("studyBody").innerHTML = MT.done
    ? `<div class="${panelCls} mx-auto max-w-md text-center !p-8 !shadow-pop fade-in"><div class="text-6xl">🎮</div><h2 class="mt-3 text-3xl font-extrabold">All matched!</h2><p class="mt-1 text-sm font-semibold text-slate-500">${Math.round((MT.end - MT.t0) / 1000)} seconds, ${MT.misses === 0 ? "no misses" : plural(MT.misses, "miss", "misses")}.</p>
        <div class="mt-6 flex justify-center gap-3"><button id="mtExit" class="${btnGhost}">Back to Study</button><button id="mtAgain" class="${btnPrimary}">Play again →</button></div></div>`
    : `<div class="mx-auto max-w-2xl space-y-4"><div class="flex items-center gap-3"><button id="mtExit" class="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-700">← Back</button><div class="flex-1 text-sm font-extrabold">Match each term with its answer</div><span class="text-xs font-extrabold tabular-nums text-slate-400">${MT.matched.size} / ${MT.pairs.length} · ${plural(MT.misses, "miss", "misses")}</span></div>
        <div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4">${tiles}</div></div>`;
}

export function tapTile(key) {
  if (MT.done || MT.wrong) return;
  const t = MT.tiles.find((x) => x.key === key);
  if (!t || MT.matched.has(t.id)) return;
  if (MT.sel === null) { MT.sel = key; return renderMatch(); }
  if (MT.sel === key) { MT.sel = null; return renderMatch(); }
  const first = MT.tiles.find((x) => x.key === MT.sel);
  if (first.id === t.id && first.kind !== t.kind) {
    MT.matched.add(t.id);
    MT.sel = null;
    if (MT.matched.size === MT.pairs.length) { MT.done = true; MT.end = Date.now(); }
    return renderMatch();
  }
  MT.misses++;
  MT.wrong = [MT.sel, key];
  MT.sel = null;
  renderMatch();
  setTimeout(() => { MT.wrong = null; if (MT.on) renderMatch(); }, 650);
}
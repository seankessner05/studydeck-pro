// ---- Math: typeset formulas written between \( ... \) or \[ ... \] ----
// KaTeX is served by this app from its own copy (/vendor/katex), so it works offline and nothing is fetched from elsewhere.
// Every view builds its HTML as a string, so instead of touching each one, a watcher typesets whatever lands on the page.
// A lone "$" is never math (economics is full of dollar amounts), and note text is never typeset: notes come from
// Granola as markdown, where "\[" is just an escaped bracket. Those areas carry the class "no-math".
import renderMathInElement from "/vendor/katex/contrib/auto-render.mjs";

const OPTIONS = {
  delimiters: [
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
  ],
  throwOnError: false, // the server already rejects formulas KaTeX can't typeset; anything older shows as red source
  ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option", "input"],
  ignoredClasses: ["no-math"],
  strict: "ignore",
  trust: false,
};

const HAS_MATH = /\\[([]/;

/** Typeset any formulas inside this element (or the element a text node sits in). */
export function typeset(node) {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.isConnected) return;
  if (el.closest(".no-math, .katex, textarea, code, pre")) return;
  if (!HAS_MATH.test(el.textContent)) return;
  renderMathInElement(el, OPTIONS);
}

let pending = new Set();
let scheduled = false;

function flush() {
  scheduled = false;
  const batch = [...pending];
  pending = new Set();
  // Only the outermost changed elements; typesetting a parent covers its children.
  for (const el of batch) if (!batch.some((other) => other !== el && other.contains(el))) typeset(el);
}

export function init() {
  const watcher = new MutationObserver((records) => {
    for (const r of records) {
      const target = r.type === "characterData" ? r.target.parentElement : r.target;
      if (target && !target.closest?.(".katex")) pending.add(target);
    }
    // Typeset before the next paint, so a formula never flashes as raw LaTeX.
    if (pending.size && !scheduled) { scheduled = true; queueMicrotask(flush); }
  });
  watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
  typeset(document.body);
}

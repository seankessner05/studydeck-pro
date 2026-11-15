import katex from "katex";

/**
 * Math in generated text. Formulas are written in LaTeX between \( ... \) (inline) or \[ ... \] (on their own line),
 * and the browser typesets them with KaTeX. A lone "$" is never math: economics is full of dollar amounts.
 *
 * Three jobs live here:
 * - repairing the JSON Claude sends back, where a LaTeX backslash is easily written as a broken or wrong JSON escape;
 * - checking, in code, that every formula really parses before anything is saved (a receipt like the others);
 * - turning formulas into plain text, so the existing word and number checks see "(1)/(1 - 0.8)", not "\frac{1}{1-0.8}".
 */

/** Inline \( ... \) or display \[ ... \] math. Non-greedy, and a formula never spans another opening delimiter. */
const MATH = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;

/**
 * LaTeX commands whose names start with a letter that is also a JSON escape (\b \f \n \r \t). Written with one
 * backslash in JSON, "\frac" arrives as a form feed followed by "rac", and "\times" as a tab followed by "imes".
 */
const AMBIGUOUS = new Set([
  "bar", "beta", "big", "Big", "bigg", "Bigg", "binom", "bot", "boxed", "bullet",
  "frac", "forall", "flat",
  "nabla", "ne", "neq", "neg", "nu", "not", "notin", "nmid", "newline",
  "rho", "right", "rightarrow", "Rightarrow", "rangle", "rbrace", "rceil", "rfloor", "rm",
  "tau", "theta", "Theta", "text", "textbf", "textit", "textrm", "tfrac", "tilde", "times", "to", "top", "triangle", "triangledown",
]);

/**
 * Make LaTeX inside a model's JSON reply survive JSON.parse. Inside string literals:
 * - a backslash before a character JSON can't escape (\( \) \[ \] \, \{ \_ \% \alpha ...) is doubled, since it can only be LaTeX;
 * - \b \f \n \r \t followed by the rest of a known LaTeX command name ("\frac", "\times", "\neq") is doubled too;
 * - everything else (\" \\ \/ é, and "\n" before ordinary words) is left as it was.
 * Text outside strings is not touched, so a reply that was valid JSON stays exactly the same JSON.
 */
export function repairLatexEscapes(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[i + 1] ?? "";
    if (next === '"' || next === "\\" || next === "/") {
      out += ch + next;
      i++;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))) {
      out += json.slice(i, i + 6);
      i += 5;
      continue;
    }
    if ("bfnrt".includes(next) && next !== "") {
      const name = /^[A-Za-z]+/.exec(json.slice(i + 1))?.[0] ?? "";
      out += AMBIGUOUS.has(name) ? "\\\\" : "\\";
      continue;
    }
    // Not a JSON escape at all: it can only be a LaTeX backslash.
    out += "\\\\";
  }
  return out;
}

/** Every formula in a piece of text: its LaTeX source and whether it is display math. */
export function formulas(text: string): { tex: string; display: boolean }[] {
  return [...text.matchAll(MATH)].map((m) => ({ tex: m[1] ?? m[2] ?? "", display: m[2] !== undefined }));
}

/**
 * The first problem with the math in this text, or undefined when there is none: a delimiter without its partner, an
 * empty formula, or LaTeX that KaTeX can't typeset. Checked in code before anything is saved.
 */
export function mathProblem(text: string): string | undefined {
  const rest = text.replace(MATH, " ");
  const stray = /\\[()[\]]/.exec(rest);
  if (stray) return `unmatched ${stray[0]}`;
  for (const f of formulas(text)) {
    if (!f.tex.trim()) return "empty formula";
    try {
      katex.renderToString(f.tex, { throwOnError: true, displayMode: f.display, strict: "ignore", trust: false, maxSize: 20, maxExpand: 200 });
    } catch (e) {
      return `can't typeset ${f.tex.slice(0, 40)}: ${(e as Error).message.replace(/^KaTeX parse error:\s*/, "").slice(0, 80)}`;
    }
  }
  return undefined;
}

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", infty: "∞", partial: "∂", sum: "Σ", prod: "Π",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", varepsilon: "ε", eta: "η", theta: "θ",
  lambda: "λ", mu: "μ", nu: "ν", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω",
  ldots: "...", cdots: "...", "%": "%", "$": "$", ",": " ", ";": " ", "!": "", " ": " ", "{": "{", "}": "}", "_": "_", "&": "&",
};

const GREEK = /^[\u0391-\u03c9]$/;

function plainTex(tex: string): string {
  let s = tex;
  // \frac{a}{b} (and \dfrac, \tfrac), innermost first so nested fractions come out right
  for (let n = 0; n < 8 && /\\[dt]?frac\s*\{/.test(s); n++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\(?:text|textrm|textit|textbf|mathrm|mathit|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\(?:bar|overline|hat|tilde|widehat)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*([()[\]|.]|\\[{}])/g, (_m, d: string) => (d === "." ? "" : d.replace("\\", "")));
  // A Greek letter swallows the space after it, as in TeX: "\\Delta Y" is ΔY. Operators keep theirs: "a \\times b" is "a × b".
  s = s.replace(/\\([A-Za-z]+)( ?)|\\([%$,;! {}_&])/g, (_m, name: string | undefined, space: string, sym: string | undefined) =>
    name ? (SYMBOLS[name] ?? name) + (GREEK.test(SYMBOLS[name] ?? "") ? "" : space) : (SYMBOLS[sym!] ?? sym!));
  s = s.replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "_$1");
  return s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** The text with every formula written out as plain text: "\(\frac{1}{1-c}\)" becomes "(1)/(1-c)". */
export function plainMath(text: string): string {
  return text.replace(MATH, (_m, inline: string | undefined, display: string | undefined) => plainTex(inline ?? display ?? ""));
}

/** One line for the generator prompts, so every kind of item writes math the same way. */
export const MATH_RULE =
  'MATH: write formulas in LaTeX between \\( and \\), for example \\(MPC = 0.8\\) or \\(\\frac{1}{1 - MPC}\\). Never use $ for math (a $ is money). In JSON every backslash is doubled: write "\\\\(\\\\frac{1}{2}\\\\)". Keep plain numbers and dollar amounts as ordinary text. Quotes from the note are copied exactly, never rewritten as LaTeX.';

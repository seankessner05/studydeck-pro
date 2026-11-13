import { $, G, Q, courseName, state } from "./core.js";
import { suggestions } from "./chat.js";
import { ask, loadNotes, refreshState, renderNotes, selectCourse, setView } from "./shell.js";
import { closeSource, hidePreview, moveNoteTo, noteCache, openNoteId, openSource, previewFor, showPreview } from "./notes.js";
import { connectGranola, refreshGranola, renderGranola, runGranolaSync } from "./granola.js";
import { exitStudySession, loadStudyToday, rateCard, revealCard, startStudySession, submitCard } from "./cards.js";
import { GEN_CFG, cancelGeneration, dismissGeneration, gk, loadGenPlan, startGeneration, updateGenPanel } from "./generate.js";
import { exitQuiz, explainMiss, nextQuizQuestion, pickOption, renderQuizHome, setSub, startQuiz, submitQuizAnswer } from "./quiz.js";
import { closeDoctor, closeManage, closePicker, openManage, openPicker, pick, pickerState, refreshAi, renderPicker, runDoctorUi, saveCourse, toggleAi } from "./panels.js";
import { startPractice } from "./problems.js";
import { deleteWithUndo } from "./trash.js";


/** Event listeners and first-run work for this part of the app. main.js calls these in the original order. */
export function init() {
  // ---- events ----
  $("courses").addEventListener("click", (e) => { const b = e.target.closest("[data-course]"); if (b) selectCourse(b.dataset.course); });
  $("scopeBtn").addEventListener("click", () => { if (innerWidth < 768) openPicker(); });
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $("messages").addEventListener("click", (e) => {
    const go = e.target.closest("[data-view-go]");
    if (go) return setView(go.dataset.viewGo);
    const b = e.target.closest(".cite, .cite-foot");
    if (!b) return;
    hidePreview();
    if (b.dataset.id) openSource(b.dataset.id, b.dataset.quote);
  });
  $("messages").addEventListener("mouseover", (e) => { const b = e.target.closest(".cite"); if (b && b !== previewFor) showPreview(b); });
  $("messages").addEventListener("mouseout", (e) => { if (e.target.closest(".cite") && !e.relatedTarget?.closest?.(".cite")) hidePreview(); });
  $("messages").addEventListener("scroll", hidePreview);
  $("form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("q").value.trim(); if (q) { $("q").value = ""; ask(q); } });
  $("tryRow").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-try]");
    if (!b || state.busy) return;
    const t = suggestions()[+b.dataset.try];
    if (t.course !== state.course) await selectCourse(t.course);
    ask(t.q);
  });
  $("studyBody").addEventListener("click", (e) => {
    const kind = gk();
    const G_ = GEN_CFG[kind].st();
    const tab = e.target.closest("[data-sub]");
    if (tab) return setSub(tab.dataset.sub);
    if (e.target.closest("[data-gen-open]")) { G_.open = true; updateGenPanel(kind); return loadGenPlan(kind); }
    if (e.target.closest("[data-gen-close]")) { G_.open = false; return updateGenPanel(kind); }
    const dn = e.target.closest("[data-gen-density]");
    if (dn) { G_.density = dn.dataset.genDensity; return updateGenPanel(kind); }
    const pk = e.target.closest("[data-gen-pick]");
    if (pk && G_.plan) {
      const all = G_.plan.lectures;
      G_.selected = new Set((pk.dataset.genPick === "all" ? all : pk.dataset.genPick === "new" ? all.filter((l) => l.status !== "generated") : []).slice(0, 500).map((l) => l.id));
      return updateGenPanel(kind);
    }
    if (e.target.closest("#genGo")) return startGeneration(kind);
    if (e.target.closest("#genCancel")) return cancelGeneration(kind);
    if (e.target.closest("#genDismiss")) return dismissGeneration(kind);
    if (e.target.closest("#genStudy")) { dismissGeneration(kind); return kind === "quiz" ? startQuiz() : kind === "problems" ? startPractice() : startStudySession(); }
    if (e.target.closest("#startStudy")) return startStudySession();
    if (e.target.closest("#exitStudy")) return exitStudySession();
    if (e.target.closest("#revealBtn")) return revealCard();
    const g = e.target.closest("[data-grade]");
    if (g) return rateCard(Number(g.dataset.grade));
    const del = e.target.closest("[data-del-card]");
    if (del) return deleteWithUndo("card", `/api/study/cards/${encodeURIComponent(del.dataset.delCard)}`);
    const open = e.target.closest("[data-open-note]");
    if (open) return openSource(open.dataset.openNote, open.dataset.quote);
    // quizzes
    if (e.target.closest("#startQuiz")) return startQuiz();
    if (e.target.closest("#exitQuiz")) return exitQuiz();
    const ln = e.target.closest("[data-qlen]");
    if (ln) { Q.length = Number(ln.dataset.qlen); return renderQuizHome(); }
    const opt = e.target.closest("[data-opt]");
    if (opt) return pickOption(Number(opt.dataset.opt));
    if (e.target.closest("#checkAnswer")) return submitQuizAnswer();
    if (e.target.closest("#nextQ")) return nextQuizQuestion();
    if (e.target.closest("#explainBtn")) return explainMiss();
    const dq = e.target.closest("[data-del-q]");
    if (dq) return deleteWithUndo("question", `/api/study/quiz/questions/${encodeURIComponent(dq.dataset.delQ)}`);
  });
  $("studyBody").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-gen-note]");
    if (!cb) return;
    const G_ = GEN_CFG[gk()].st();
    cb.checked ? G_.selected.add(cb.dataset.genNote) : G_.selected.delete(cb.dataset.genNote);
    updateGenPanel();
  });
  $("studyBody").addEventListener("input", (e) => { if (e.target.id === "genFocus") GEN_CFG[gk()].st().focus = e.target.value; });
  $("studyBody").addEventListener("submit", (e) => { if (e.target.id === "cardForm") submitCard(e); });
  $("aiChip").addEventListener("click", (e) => { if (e.target.closest("#aiToggle")) toggleAi(); });
  $("notesSearch").addEventListener("input", renderNotes);
  $("notesGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openSource(b.dataset.open); });
  $("notesGrid").addEventListener("change", (e) => { const s = e.target.closest("[data-move]"); if (s && s.value) moveNoteTo(s.dataset.move, s.value); });
  $("moveSelect").addEventListener("change", (e) => { if (openNoteId) moveNoteTo(openNoteId, e.target.value); });
  $("closeSource").addEventListener("click", closeSource);
  $("clearBtn").addEventListener("click", async () => {
    if (!confirm(`Clear the chat for ${courseName(state.course)}?`)) return;
    await fetch(`/api/chats/${encodeURIComponent(state.course)}`, { method: "DELETE" });
    selectCourse(state.course);
  });
  for (const id of ["demo", "demoMobile"]) {
    $(id).addEventListener("change", async (e) => {
      await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ demo: e.target.checked }) });
      noteCache.clear(); closeSource(); closePicker();
      if (state.course !== "all") state.course = "all";
      selectCourse("all");
    });
  }
  document.querySelectorAll(".theme-toggle").forEach((b) => b.addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  }));
  $("granolaCard").addEventListener("click", (e) => {
    if (e.target.closest("#connectBtn")) connectGranola();
    if (e.target.closest("#syncBtn")) runGranolaSync();
    if (e.target.closest("#disconnectBtn") && confirm("Disconnect Granola? Your synced notes stay; you can reconnect any time.")) {
      fetch("/api/granola/disconnect", { method: "POST" }).then(() => { G.connected = false; G.msg = ""; G.detail = ""; G.last = null; renderGranola(); });
    }
  });
  $("manageBtn").addEventListener("click", openManage);
  $("closeManage").addEventListener("click", closeManage);
  $("manage").addEventListener("click", (e) => { if (e.target === $("manage")) closeManage(); });
  $("manageList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-archive]");
    if (b) saveCourse("PATCH", `/api/courses/${encodeURIComponent(b.dataset.archive)}`, { archived: b.dataset.to === "1" });
  });
  $("manageForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveCourse("POST", "/api/courses", { id: $("courseId").value, name: $("courseName").value, semester: $("courseSemester").value, profile: $("profile").value });
    if (!$("manageError").textContent) $("manageForm").reset();
  });
  $("doctorBtn").addEventListener("click", () => runDoctorUi());
  $("doctorAgain").addEventListener("click", () => runDoctorUi());
  $("doctorDeep").addEventListener("click", () => runDoctorUi(true));
  $("closeDoctor").addEventListener("click", closeDoctor);
  $("doctor").addEventListener("click", (e) => { if (e.target === $("doctor")) closeDoctor(); });
  $("pickerInput").addEventListener("input", () => { pickerState.index = 0; renderPicker(); });
  $("pickerList").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) pick(b.dataset.pick); });
  $("picker").addEventListener("click", (e) => { if (e.target === $("picker")) closePicker(); });
  document.addEventListener("keydown", (e) => {
    const pickerOpen = !$("picker").classList.contains("hidden");
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pickerOpen ? closePicker() : openPicker(); return; }
    if (pickerOpen) {
      if (e.key === "Escape") closePicker();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pickerState.index = Math.max(0, pickerState.index + (e.key === "ArrowDown" ? 1 : -1)); renderPicker(); }
      if (e.key === "Enter") { e.preventDefault(); pick(renderPicker()[pickerState.index]?.id); }
      return;
    }
    const S_ = state.study;
    const typingNow = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (state.view === "study" && S_.sub === "quiz" && S_.quiz.mode === "play" && !typingNow && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const Qz = S_.quiz;
      const q = Qz.queue[Qz.idx];
      if (e.key === "Escape") { if (!$("source").classList.contains("hidden")) { closeSource(); return; } exitQuiz(); return; }
      if (Qz.result) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); nextQuizQuestion(); }
        return;
      }
      if (q && /^[1-5]$/.test(e.key)) { e.preventDefault(); pickOption(Number(e.key) - 1); return; }
      if (q && q.kind !== "tf" && /^[a-eA-E]$/.test(e.key)) { e.preventDefault(); pickOption("abcde".indexOf(e.key.toLowerCase())); return; }
      if (q && q.kind === "multi" && e.key === "Enter") { e.preventDefault(); submitQuizAnswer(); }
      return;
    }
    if (state.view === "study" && S_.sub !== "quiz" && S_.mode === "play" && !typingNow && !e.metaKey && !e.ctrlKey) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); S_.revealed ? rateCard(3) : revealCard(); return; }
      if (S_.revealed && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); rateCard(Number(e.key)); return; }
      if (e.key === "Escape") { if (!$("source").classList.contains("hidden")) { closeSource(); return; } exitStudySession(); return; }
    }
    if (e.key === "Escape") { closeSource(); closeManage(); closeDoctor(); }
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); setView("chat"); $("q").focus(); }
  });
  // Notes can change while you're away (background sync), so refresh when you come back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.busy) { noteCache.clear(); Promise.all([refreshState(), loadNotes(), refreshGranola(), loadStudyToday(), refreshAi()]); }
  });
  try { state.view = localStorage.getItem("view") === "notes" ? "notes" : "chat"; } catch {}
  renderGranola();
  refreshGranola();
  refreshAi();
  selectCourse("all").then(() => { if (state.view === "chat") $("q").focus(); });
}

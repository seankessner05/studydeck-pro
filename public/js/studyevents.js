import { $, S, api, state } from "./core.js";
import { selectCourse } from "./shell.js";
import { loadStudyToday, renderStudy } from "./cards.js";
import { startQuiz } from "./quiz.js";
import { refreshAi } from "./panels.js";
import { PRB, exitPractice, nextProblem, renderProblemPlay, renderProblemsHome, startPractice, startSteps, submitProblem, submitStep } from "./problems.js";
import { TUT, loadTutorHome, pickTutorLecture, renderTutor, sendTutor, startTutorSession } from "./tutor.js";
import { EXM, dateInput, gradeWrittenNow, loadExamHome, makeSheet, openSheet, renderExam, renderExamHome, renderExamResults, reviewSitting, saveExamAnswers, saveExamForm, startMockExam, submitExam, toggleExamOption } from "./exams.js";
import { PG, loadProgress, renderProgress, runPlanItem } from "./progress.js";
import { MT, startMatch, tapTile } from "./match.js";
import { deleteWithUndo } from "./trash.js";

export async function backupNow() {
  const el = $("studyToolMsg");
  if (el) el.textContent = "Backing up…";
  const r = await api("/api/study/backup", "POST");
  const msg = r.ok ? `Backed up (${Math.max(1, Math.round(r.data.bytes / 1024))} KB). Kept in data/backups.` : r.data.error || "Couldn't back up.";
  const el2 = $("studyToolMsg");
  if (el2) el2.textContent = msg;
  if (r.ok && S.sub === "progress") loadProgress();
}

export async function sendRemark(itemId) {
  const ta = document.querySelector("[data-remark-text]");
  const argument = (ta ? ta.value : EXM.remarkText).trim();
  EXM.remarkText = argument;
  if (argument.length < 5) { EXM.remarkMsg = "Say why you think a point should count."; return renderExamResults(); }
  EXM.remarkMsg = "";
  EXM.grading = true;
  renderExamResults();
  const r = await api(`/api/study/exam/${EXM.results.id}/remark`, "POST", { itemId, argument });
  EXM.grading = false;
  if (r.ok) { EXM.results = r.data; EXM.remarkFor = null; } else EXM.remarkMsg = r.data.error || "Couldn't look at it again.";
  renderExamResults();
  refreshAi();
}

/** Event listeners and first-run work for this part of the app. main.js calls these in the original order. */
export function init() {
  // =============================================================== events
  $("studyBody").addEventListener("click", (e) => {
    const t = e.target;
    const hit = (sel) => t.closest(sel);
    // problems
    if (hit("#startPractice")) return startPractice();
    if (hit("#exitPractice")) return exitPractice();
    const pl = hit("[data-pr-len]"); if (pl) { PRB.length = Number(pl.dataset.prLen); return renderProblemsHome(); }
    if (hit("#hintBtn")) { PRB.hintShown = true; PRB.hinted = true; return renderProblemPlay(); }
    if (hit("#checkProblem")) return submitProblem(false);
    if (hit("#giveUp")) { PRB.hinted = true; return submitProblem(true); }
    if (hit("#stepMode")) return startSteps();
    if (hit("#checkStep")) return submitStep(false);
    if (hit("#skipStep")) return submitStep(true);
    if (hit("#nextP")) return nextProblem();
    const dp = hit("[data-del-p]"); if (dp) return deleteWithUndo("problem", `/api/study/problems/${encodeURIComponent(dp.dataset.delP)}`);
    // tutor
    const tp = hit("[data-tut-pick]"); if (tp) return pickTutorLecture(tp.dataset.tutPick);
    const tt = hit("[data-tut-topic]"); if (tt) { TUT.topicIdx = Number(tt.dataset.tutTopic); return renderTutor(); }
    if (hit("[data-tut-all]")) { TUT.showAll = !TUT.showAll; return renderTutor(); }
    if (hit("#tutStart")) return startTutorSession();
    if (hit("#tutSend")) return sendTutor();
    if (hit("#tutLeave") || hit("#tutAgain")) { TUT.mode = "home"; loadTutorHome(); return renderTutor(); }
    if (hit("[data-tut-quiz]")) { const id = TUT.session && TUT.session.noteId; TUT.mode = "home"; S.sub = "quiz"; return startQuiz(id ? [id] : undefined); }
    // exams
    if (hit("[data-ex-open]")) { EXM.form.open = true; EXM.form.from = EXM.form.from || dateInput(-35); EXM.form.date = EXM.form.date || dateInput(7); return renderExamHome(); }
    if (hit("[data-ex-close]")) { EXM.form.open = false; return renderExamHome(); }
    const pr = hit("[data-ex-preset]"); if (pr) { EXM.preset = pr.dataset.exPreset; return renderExamHome(); }
    const es = hit("[data-ex-start]"); if (es) return startMockExam(es.dataset.exStart);
    const ed = hit("[data-ex-del]"); if (ed) { if (confirm("Remove this exam from your list? Your cards, questions and past mock exams stay.")) api(`/api/study/exams/${encodeURIComponent(ed.dataset.exDel)}`, "DELETE").then(loadExamHome); return; }
    const er = hit("[data-ex-review]"); if (er) return reviewSitting(er.dataset.exReview);
    const eo = hit("[data-ex-opt]"); if (eo) { const [id, i] = eo.dataset.exOpt.split(":"); return toggleExamOption(id, Number(i)); }
    if (hit("#examHandIn") || hit("#examHandIn2")) return submitExam(false);
    if (hit("#gradeWritten")) return gradeWrittenNow();
    if (hit("#examBack")) { EXM.mode = "home"; return loadExamHome().then(renderExam); }
    const ro = hit("[data-remark-open]"); if (ro) { EXM.remarkFor = ro.dataset.remarkOpen; EXM.remarkText = ""; EXM.remarkMsg = ""; return renderExamResults(); }
    if (hit("[data-remark-cancel]")) { EXM.remarkFor = null; return renderExamResults(); }
    const rs = hit("[data-remark-send]"); if (rs) return sendRemark(rs.dataset.remarkSend);
    const sm = hit("[data-sheet-make]"); if (sm) return makeSheet(sm.dataset.sheetMake, sm.dataset.exam);
    const so = hit("[data-sheet-open]"); if (so) return openSheet(so.dataset.sheetOpen);
    if (hit("#sheetBack")) { EXM.mode = "home"; return loadExamHome().then(renderExam); }
    if (hit("#sheetPrint")) return window.print();
    const sd = hit("[data-sheet-del]"); if (sd) { if (confirm("Delete this version?")) api(`/api/study/sheets/${encodeURIComponent(sd.dataset.sheetDel)}`, "DELETE").then(() => { EXM.mode = "home"; return loadExamHome().then(renderExam); }); return; }
    // progress
    const pm = hit("[data-pg-min]"); if (pm) { PG.minutes = Number(pm.dataset.pgMin); return loadProgress(); }
    const pg = hit("[data-plan-go]"); if (pg) return runPlanItem(Number(pg.dataset.planGo));
    const lt = hit("[data-lect-toggle]"); if (lt) { PG.openLecture = PG.openLecture === lt.dataset.lectToggle ? null : lt.dataset.lectToggle; return renderProgress(); }
    const wq = hit("[data-weak-quiz]"); if (wq) { const w = PG.data.weakSpots[Number(wq.dataset.weakQuiz)]; return (async () => { if (w.course !== state.course) await selectCourse(w.course); S.sub = "quiz"; return startQuiz([w.noteId]); })(); }
    const wt = hit("[data-weak-tutor]"); if (wt) { const w = PG.data.weakSpots[Number(wt.dataset.weakTutor)]; return (async () => { if (w.course !== state.course) await selectCourse(w.course); TUT.mode = "home"; S.sub = "tutor"; renderStudy(); await loadTutorHome(); return pickTutorLecture(w.noteId); })(); }
    // new cards a day
    const nl = hit("[data-newlimit]");
    if (nl) return api("/api/settings", "POST", { newPerDay: Number(nl.dataset.newlimit) }).then((r) => { if (r.ok) return Promise.all([loadStudyToday(), loadProgress()]); const el = $("studyToolMsg"); if (el) el.textContent = r.data.error || "Couldn't change that."; });
    // Match game, backup
    if (hit("[data-match-start]")) return startMatch();
    const mt = hit("[data-mt-tile]"); if (mt) return tapTile(Number(mt.dataset.mtTile));
    if (hit("#mtExit")) { MT.on = false; return renderStudy(); }
    if (hit("#mtAgain")) return startMatch();
    if (hit("[data-backup-now]")) return backupNow();
  });
  $("studyBody").addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "problemInput") { PRB.input = t.value; return; }
    if (t.id === "stepInput" && PRB.steps) { PRB.steps.input = t.value; return; }
    if (t.id === "tutInput") { TUT.input = t.value; return; }
    if (t.dataset && t.dataset.exText !== undefined) { EXM.answers[t.dataset.exText] = t.value; saveExamAnswers(); return; }
    if (t.dataset && t.dataset.remarkText !== undefined) { EXM.remarkText = t.value; return; }
    if (t.dataset && t.dataset.exForm) EXM.form[t.dataset.exForm] = t.value;
  });
  $("studyBody").addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.exForm) EXM.form[e.target.dataset.exForm] = e.target.value; });
  $("studyBody").addEventListener("submit", (e) => { if (e.target.id === "examForm") { e.preventDefault(); saveExamForm(); } });
  document.addEventListener("keydown", (e) => {
    if (state.view !== "study" || e.metaKey && e.key !== "Enter" || e.altKey) return;
    if (S.sub === "problems" && PRB.mode === "play") {
      if (e.key === "Escape") { if (!$("source").classList.contains("hidden")) return; return exitPractice(); }
      if (e.key === "Enter") {
        e.preventDefault();
        if (PRB.result) nextProblem();
        else if (e.target && e.target.id === "problemInput") submitProblem(false);
        else if (e.target && e.target.id === "stepInput") submitStep(false);
      }
    }
    if (S.sub === "tutor" && TUT.mode === "chat" && e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target && e.target.id === "tutInput") { e.preventDefault(); sendTutor(); }
  });
}

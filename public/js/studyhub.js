import { $, S, state } from "./core.js";
import { selectCourse, setView } from "./shell.js";
import { loadStudyToday, renderStudy } from "./cards.js";
import { PRB, loadProblemsHome, renderProblemPlay, renderProblemsDone, renderProblemsHome } from "./problems.js";
import { TUT, loadTutorHome, renderTutor } from "./tutor.js";
import { EXM, loadExamHome, renderExam } from "./exams.js";
import { loadProgress, renderProgress } from "./progress.js";

export function studyMoreBusy() {
  return (S.sub === "problems" && PRB.mode === "play") || (S.sub === "exam" && ["take", "building"].includes(EXM.mode)) || (S.sub === "tutor" && TUT.mode === "chat");
}
export function renderStudyMore() {
  if (S.sub === "problems") return PRB.mode === "play" ? renderProblemPlay() : PRB.mode === "done" ? renderProblemsDone() : renderProblemsHome();
  if (S.sub === "tutor") return renderTutor();
  if (S.sub === "exam") return renderExam();
  if (S.sub === "progress") return renderProgress();
}
export async function loadStudyMore() {
  if (S.sub === "problems") return loadProblemsHome();
  if (S.sub === "tutor") return loadTutorHome();
  if (S.sub === "exam") return loadExamHome();
  if (S.sub === "progress") return loadProgress();
}
// On a phone the six tabs scroll sideways: keep the current one in view after every switch.
// (Screens redraw themselves as data arrives, so watch for any redraw rather than hooking one function.)
export let centerQueued = false;

/** Jump to one of the study sub-screens from anywhere (the plan's buttons use this). */
export async function goSub(sub, course) {
  if (course && course !== state.course) await selectCourse(course);
  S.sub = sub;
  setView("study");
  renderStudy();
  await loadStudyToday();
}

/** Event listeners and first-run work for this part of the app. main.js calls these in the original order. */
export function init() {
  new MutationObserver(() => {
    if (centerQueued) return;
    centerQueued = true;
    requestAnimationFrame(() => {
      centerQueued = false;
      const row = document.querySelector("#studyBody [data-sub]")?.parentElement;
      const active = row && row.querySelector("[data-sub].bg-white");
      if (row && active && row.scrollWidth > row.clientWidth) row.scrollLeft = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    });
  }).observe($("studyBody"), { childList: true });
}

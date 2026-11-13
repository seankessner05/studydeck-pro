// StudyDeck front end: plain JS modules, no build step.
// Every module is loaded first, then each one's listeners and first-run work start in a fixed order.
import { init as events } from "./events.js";
import { init as studyhub } from "./studyhub.js";
import { init as studyevents } from "./studyevents.js";
import { init as dialog } from "./dialog.js";
import { init as trash } from "./trash.js";
import { init as restore } from "./restore.js";
import { init as realexam } from "./realexam.js";
import { init as quiz } from "./quiz.js";
import "./core.js";
import "./chat.js";
import "./shell.js";
import "./notes.js";
import "./granola.js";
import "./cards.js";
import "./generate.js";
import "./quiz.js";
import "./panels.js";
import "./problems.js";
import "./tutor.js";
import "./exams.js";
import "./progress.js";
import "./match.js";

for (const start of [events, studyhub, studyevents, dialog, trash, restore, realexam, quiz]) start();

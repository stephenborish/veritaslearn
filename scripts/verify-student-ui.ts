/**
 * Verification for the VERITAS Learn student lesson experience overhaul.
 *
 * Two kinds of checks:
 *   1. SECURITY — exercises the real server-side sanitizers to prove assessment
 *      responses never leak correctness/score/feedback to students, while practice
 *      feedback still flows when allowed. (Same trust boundary as verify:slice.)
 *   2. UI CONTRACT — static source assertions that the student UI overhaul stays in
 *      place: shared Learn question components exist, the dark checkpoint overlay is
 *      gone, the old formal-assessment paragraph is removed, the top bar shows the
 *      VERITAS Learn identity + student name + progress, the timeline can collapse,
 *      and reduced-motion is respected.
 *
 * Run: npx tsx scripts/verify-student-ui.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  sanitizeResponseForStudent,
  sanitizeQuestionForStudent,
  findLeakedSecretFields,
} from "../server/data/sanitize";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const focusedPlayer = read("src/components/StudentPortal/FocusedPlayer.tsx");
const card = read("src/components/StudentPortal/LearnQuestionCard.tsx");
const mc = read("src/components/StudentPortal/LearnMCQuestion.tsx");
const sa = read("src/components/StudentPortal/LearnSAQuestion.tsx");
const css = read("src/index.css");

const checkpointOverlayStart = focusedPlayer.indexOf("{/* Checkpoint panel");
const checkpointOverlayEnd = focusedPlayer.indexOf("{/* QUESTION BLOCK */", checkpointOverlayStart);
const checkpointOverlay =
  checkpointOverlayStart >= 0 && checkpointOverlayEnd > checkpointOverlayStart
    ? focusedPlayer.slice(checkpointOverlayStart, checkpointOverlayEnd)
    : "";

// ============================================================================
console.log("\n=== SECURITY: assessment responses never leak to students ===");

// Assessment MC submitted — no correctness, no score, status submitted.
const assessmentMc = sanitizeResponseForStudent({
  id: "r1",
  type: "mc",
  gradingMode: "assessment",
  feedbackVisibility: "teacher_only",
  responseValue: "choice_a",
  isCorrect: true,
  score: 5,
  pointsEarned: 5,
});
check("assessment MC submitted hides isCorrect", assessmentMc.isCorrect === undefined, assessmentMc);
check("assessment MC submitted hides score", assessmentMc.score === undefined && assessmentMc.pointsEarned === undefined);
check("assessment MC submitted reports status=submitted", assessmentMc.status === "submitted");

// Practice MC with released feedback — correctness preserved.
const practiceMc = sanitizeResponseForStudent({
  id: "r2",
  type: "mc",
  gradingMode: "practice",
  feedbackVisibility: "student_visible",
  responseValue: "choice_b",
  isCorrect: true,
  score: 1,
});
check("practice MC (feedback allowed) can show correctness", practiceMc.isCorrect === true, practiceMc);

// Practice SA pending — minimal status only, no score/feedback yet.
const practiceSaPending = sanitizeResponseForStudent({
  id: "r3",
  type: "sa",
  gradingMode: "practice",
  feedbackVisibility: "hidden",
  responseValue: "my essay",
  score: 4,
  aiGrading: { status: "pending", rationale: "TEACHER ONLY", feedback: "later", rubricBreakdown: {} },
});
check("practice SA pending exposes only aiGrading.status", practiceSaPending.aiGrading?.status === "pending");
check("practice SA pending hides score", practiceSaPending.score === undefined);
check(
  "practice SA pending hides AI rationale/feedback",
  practiceSaPending.aiGrading?.rationale === undefined && practiceSaPending.aiGrading?.feedback === undefined,
  practiceSaPending.aiGrading,
);

// Assessment SA submitted — no grading data at all, submitted-for-review status.
const assessmentSa = sanitizeResponseForStudent({
  id: "r4",
  type: "sa",
  gradingMode: "assessment",
  feedbackVisibility: "teacher_only",
  responseValue: "my essay",
  score: 8,
  aiGrading: { status: "success", rationale: "secret", feedback: "secret", rubricBreakdown: {} },
});
check("assessment SA hides aiGrading entirely", assessmentSa.aiGrading === undefined, assessmentSa);
check("assessment SA hides score", assessmentSa.score === undefined && assessmentSa.pointsEarned === undefined);
check("assessment SA reports status=submitted", assessmentSa.status === "submitted");

// Delivered question payload leaks nothing.
const delivered = sanitizeQuestionForStudent({
  id: "q1",
  type: "mc",
  stem: "Stem",
  choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
  correctChoiceId: "a",
  explanation: "secret",
  rubricCategories: [{ id: "rc", name: "x", maxPoints: 1, description: "secret" }],
});
check("delivered question leaks no secret fields", findLeakedSecretFields(delivered).length === 0);

// ============================================================================
console.log("\n=== UI: shared Learn question components ===");

check("LearnMCQuestion renders A/B/C/D answer letters", mc.includes("String.fromCharCode(65"));
check("LearnMCQuestion uses radio semantics", mc.includes('role="radio"') && mc.includes('role="radiogroup"'));
check("LearnSAQuestion renders a large textarea", sa.includes("<textarea") && sa.includes("min-h-[180px]"));
check("LearnSAQuestion shows a Saved status", sa.includes('"Saved"') || sa.includes("Saved"));

check("LearnQuestionCard labels Practice Check", card.includes("Practice Check"));
check("LearnQuestionCard labels Assessment Check", card.includes("Assessment Check"));
check("LearnQuestionCard assessment submitted = teacher review", card.includes("Submitted for teacher review."));
check(
  "LearnQuestionCard practice SA pending copy present",
  card.includes("Submitted. Feedback is being prepared.") ||
    card.includes("Feedback will appear here soon."),
);
check(
  "LearnQuestionCard never renders rubric/model answer/scoring guidance",
  !/rubricCategories|modelAnswer|aiScoringGuidance|correctChoiceId|teacherNotes|rationale/.test(card),
);

// ============================================================================
console.log("\n=== UI: checkpoint overlay replacement ===");

check("removed exact formal-assessment paragraph", !focusedPlayer.includes("Complete these questions for formal course evaluation"));
check(
  "no proctoring-style phrases remain in student UI",
  !/formal course evaluation|recorded securely|feedback is hidden until released|Saved to Portfolio|logged to portfolio/i.test(
    focusedPlayer,
  ),
);
check("no dark checkpoint/full-screen overlay color remains", !/#0A192F/i.test(focusedPlayer));
check("checkpoint overlay source was found", checkpointOverlay.length > 0);
check("checkpoint panel uses a bright surface", focusedPlayer.includes("bg-slate-50/95 backdrop-blur-sm"));
check("checkpoint shows clear progress (Question X of Y)", focusedPlayer.includes("Question {step + 1} of {total}"));
check("checkpoint overlay has no Practice Check header", !checkpointOverlay.includes("Practice Check"));
check("checkpoint overlay has no Assessment Check header", !checkpointOverlay.includes("Assessment Check"));
check(
  "checkpoint overlay has no instruction paragraph above the card",
  !checkpointOverlay.includes("Answer the check question to continue."),
);
check("checkpoint offers a Continue action", focusedPlayer.includes("Continue <ChevronRight"));

// ============================================================================
console.log("\n=== UI: normal blocks + checkpoints share components ===");

const cardUses = (focusedPlayer.match(/<LearnQuestionCard/g) || []).length;
check("FocusedPlayer renders LearnQuestionCard in 2+ places (block + checkpoint)", cardUses >= 2, cardUses);

// ============================================================================
console.log("\n=== UI: student top bar ===");

check("top bar shows VERITAS Learn identity", focusedPlayer.includes(">VERITAS<") && focusedPlayer.includes(">Learn<"));
check("top bar shows the student name", focusedPlayer.includes("studentName"));
check("top bar shows a progress bar", focusedPlayer.includes("progressPercent"));
check("top bar shows live save/submit status", focusedPlayer.includes("topStatus"));

// ============================================================================
console.log("\n=== UI: collapsible timeline ===");

check("timeline collapse state exists", focusedPlayer.includes("timelineCollapsed"));
check("collapse preference is remembered per attempt", focusedPlayer.includes("veritas_timeline_collapsed_${attemptId}"));
// Sidebar header has "Collapse lesson timeline" and collapsed rail has "Expand lesson timeline"
check(
  "collapse control has an accessible label",
  focusedPlayer.includes('"Collapse lesson timeline"') && focusedPlayer.includes('"Expand lesson timeline"'),
);

// ============================================================================
console.log("\n=== UI: reduced motion + accessibility ===");

check("index.css honors prefers-reduced-motion", css.includes("prefers-reduced-motion: reduce"));
check("components use useReducedMotion()", card.includes("useReducedMotion") && mc.includes("useReducedMotion") && sa.includes("useReducedMotion"));
check("FocusedPlayer respects reduced motion", focusedPlayer.includes("useReducedMotion") && focusedPlayer.includes("reduceMotion"));
check("answer choices keep visible focus states", mc.includes("focus-visible:ring"));

// ============================================================================
console.log("\n=== G: video checkpoint resume behavior ===");

const renderer = read("src/components/RichContent/RichContentRenderer.tsx");

check(
  "checkpointResumeTimestampRef exists in FocusedPlayer",
  focusedPlayer.includes("checkpointResumeTimestampRef"),
);
check(
  "checkpoint open saves currentTime to resume ref",
  focusedPlayer.includes("checkpointResumeTimestampRef.current = video.currentTime"),
);
check(
  "Continue button seeks to resume timestamp before play",
  focusedPlayer.includes("videoRef.current.currentTime = checkpointResumeTimestampRef.current"),
);
check(
  "onLoadedMetadata restores checkpoint position on metadata reload",
  focusedPlayer.includes("activeCheckpoint && checkpointResumeTimestampRef.current > 0"),
);
check(
  "checkpoint re-trigger guard: hasSubmittedAll prevents reopen",
  focusedPlayer.includes("hasSubmittedAll") && focusedPlayer.includes("!hasSubmittedAll"),
);

// ============================================================================
console.log("\n=== H: image click-to-zoom ===");

check("RichContentRenderer has zoom state", renderer.includes("zoom") && renderer.includes("setZoom"));
check("RichContentRenderer click handler checks for IMG tag", renderer.includes('tagName === "IMG"'));
check("zoom modal has accessible role=dialog", renderer.includes('role="dialog"'));
check("zoom modal has Close button with aria-label", renderer.includes('aria-label="Close image zoom"'));
check("zoom modal closes on Escape key", renderer.includes('"Escape"') && renderer.includes("setZoom(null)"));
check("zoom modal is light-mode (white close button, dark overlay)", renderer.includes("bg-white") && renderer.includes("bg-slate-900"));
check("image renders with zoom-in cursor", renderer.includes("cursor-zoom-in"));
check("zoomed image preserves alt text", renderer.includes("zoom.alt"));
check("clicking backdrop closes zoom", renderer.includes('onClick={() => setZoom(null)}'));
check("clicking zoomed image does not propagate to backdrop", renderer.includes("stopPropagation"));

// ============================================================================
console.log("\n=== I: single sidebar collapse control ===");

// The top-bar section is everything between the header comment and the progress bar comment.
const topBarStart = focusedPlayer.indexOf("Student top bar");
const topBarEnd = focusedPlayer.indexOf("Progress bar", topBarStart);
const topBarSection = topBarStart >= 0 && topBarEnd > topBarStart
  ? focusedPlayer.slice(topBarStart, topBarEnd)
  : "";

check("top bar section was found", topBarSection.length > 0);
check(
  "top bar no longer contains desktop collapse button (toggleTimelineCollapsed removed from top bar)",
  !topBarSection.includes("toggleTimelineCollapsed"),
);
check(
  "sidebar header still has collapse button",
  focusedPlayer.includes("Collapse lesson timeline"),
);
check(
  "collapsed rail still has expand button",
  focusedPlayer.includes("Expand lesson timeline"),
);
// Mobile drawer toggle is still present in top bar
check(
  "mobile drawer toggle is still present (md:hidden)",
  topBarSection.includes("md:hidden") && topBarSection.includes("Open lesson timeline"),
);

// ============================================================================
console.log("\n=== J: fullscreen exit overlay + telemetry ===");

check(
  "FocusedPlayer fires fullscreen_exit (canonical event name)",
  focusedPlayer.includes('"fullscreen_exit"'),
);
check(
  "FocusedPlayer no longer fires old fullscreen_exited",
  !focusedPlayer.includes('"fullscreen_exited"'),
);
check(
  "fullscreen exit overlay uses calm language",
  focusedPlayer.includes("Please return to fullscreen to continue."),
);
check(
  "re-entering fullscreen dismisses overlay (setIsFullscreenLocked(false) on isFull=true)",
  /setIsFullscreenLocked\(false\)[\s\S]{0,60}attemptResumePlayback/.test(focusedPlayer) ||
  /else\s*\{[\s\S]{0,120}setIsFullscreenLocked\(false\)/.test(focusedPlayer),
);
check(
  "fullscreen_exit telemetry includes lessonId",
  focusedPlayer.includes("lessonId: attemptData?.lessonId"),
);
check(
  "fullscreen_exit telemetry includes assignmentId",
  focusedPlayer.includes("assignmentId: attemptData?.assignmentId"),
);

const liveMonitor = read("src/components/TeacherDashboard/LiveMonitor.tsx");
check(
  "LiveMonitor counts both fullscreen_exit and fullscreen_exited",
  liveMonitor.includes('"fullscreen_exit"') && liveMonitor.includes('"fullscreen_exited"'),
);
check(
  "LiveMonitor has label for fullscreen_exit",
  liveMonitor.includes("fullscreen_exit: \"Fullscreen exit\""),
);

const dossier = read("src/components/TeacherDashboard/StudentDossierModal.tsx");
check(
  "StudentDossierModal counts both fullscreen_exit and fullscreen_exited",
  dossier.includes('"fullscreen_exit"') && dossier.includes('"fullscreen_exited"'),
);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

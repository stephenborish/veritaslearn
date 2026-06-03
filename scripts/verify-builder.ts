/**
 * Verification for the VERITAS Learn teacher lesson-builder workflow.
 *
 * Two kinds of checks:
 *   1. LOGIC — exercises the framework-free builder workflow module
 *      (src/components/TeacherDashboard/builderWorkflow.ts): the next-best-action
 *      engine, lesson status vocabulary, practice/assessment labels, and the
 *      five visible stages.
 *   2. UI CONTRACT — static source assertions that the builder keeps its
 *      teacher-facing language and never reintroduces developer/internal wording
 *      (isPractice, "Grading Mode Selection", raw IDs, scary proctoring copy).
 *
 * Run: npx tsx scripts/verify-builder.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  computeNextBestAction,
  lessonStatusLabel,
  modeLabel,
  modeDescription,
  WORKFLOW_STAGES,
} from "../src/components/TeacherDashboard/builderWorkflow";

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

console.log("\n========================================================");
console.log("👉 VERITAS LEARN TEACHER BUILDER WORKFLOW VERIFICATION");
console.log("========================================================\n");

// ---------------------------------------------------------------------------
// 1. Next best action — the order IS the product opinion.
// ---------------------------------------------------------------------------
console.log("Step 1: Next best action drives the teacher through the workflow...");

const base = {
  hasTitle: false, blockCount: 0, blockerCount: 0,
  firstBlockerTarget: undefined as undefined | "setup" | number,
  isPublished: false, isAssigned: false, isNew: true,
};

const noTitle = computeNextBestAction({ ...base });
check("No title → asks for a title, routes to setup", noTitle.target === "setup" && /title/i.test(noTitle.message));

const noBlocks = computeNextBestAction({ ...base, hasTitle: true });
check("Title but no blocks → asks to add content", noBlocks.target === "setup" && /content|block/i.test(noBlocks.message));

const withBlockers = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 2, firstBlockerTarget: 1 });
check("Blockers present → routes to the first blocker", withBlockers.target === 1 && /finish|attention/i.test(withBlockers.message));
check("Blocker message is pluralized correctly", withBlockers.message.includes("2 items"));

const readyUnpublished = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 0, isNew: false });
check("Ready but unpublished → routes to publish", readyUnpublished.target === "publish" && readyUnpublished.tone === "ready");

const publishedUnassigned = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 0, isPublished: true, isNew: false });
check("Published, not assigned → routes to assign", publishedUnassigned.target === "assign");

const assigned = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 0, isPublished: true, isAssigned: true, isNew: false });
check("Assigned → routes to student progress", assigned.target === "progress" && assigned.tone === "done");

// Every action has a non-empty, plain-language CTA + message.
const allActions = [noTitle, noBlocks, withBlockers, readyUnpublished, publishedUnassigned, assigned];
check("Every next action has a CTA + message", allActions.every((a) => a.cta.length > 0 && a.message.length > 0));

// ---------------------------------------------------------------------------
// 2. Lesson status vocabulary is teacher-friendly.
// ---------------------------------------------------------------------------
console.log("\nStep 2: Lesson status labels match the teacher-facing vocabulary...");

check("Fresh lesson is Draft",
  lessonStatusLabel({ isNew: true, isPublished: false, isAssigned: false, blockerCount: 0, hasTitle: false, blockCount: 0 }) === "Draft");
check("Blockers surface as Needs attention",
  lessonStatusLabel({ isNew: false, isPublished: false, isAssigned: false, blockerCount: 2, hasTitle: true, blockCount: 2 }) === "Needs attention");
check("Clean unpublished lesson is Ready to publish",
  lessonStatusLabel({ isNew: false, isPublished: false, isAssigned: false, blockerCount: 0, hasTitle: true, blockCount: 2 }) === "Ready to publish");
check("Published with no assignment is 'Published, not assigned'",
  lessonStatusLabel({ isNew: false, isPublished: true, isAssigned: false, blockerCount: 0, hasTitle: true, blockCount: 2 }) === "Published, not assigned");
check("Published + assigned is Assigned",
  lessonStatusLabel({ isNew: false, isPublished: true, isAssigned: true, blockerCount: 0, hasTitle: true, blockCount: 2 }) === "Assigned");

// ---------------------------------------------------------------------------
// 3. Practice vs Assessment language.
// ---------------------------------------------------------------------------
console.log("\nStep 3: Practice vs Assessment language is consistent...");
check("modeLabel(true) is Practice", modeLabel(true) === "Practice");
check("modeLabel(false) is Assessment", modeLabel(false) === "Assessment");
check("Practice description mentions feedback right away", /right away|practice/i.test(modeDescription(true)));
check("Assessment description mentions hidden until released", /hidden|release/i.test(modeDescription(false)));

// ---------------------------------------------------------------------------
// 4. The five visible stages, in order.
// ---------------------------------------------------------------------------
console.log("\nStep 4: Workflow exposes the five visible stages in order...");
const stageKeys = WORKFLOW_STAGES.map((s) => s.key).join(",");
check("Stages are setup → content → preview → publish → assign", stageKeys === "setup,content,preview,publish,assign", stageKeys);
check("Every stage explains its purpose", WORKFLOW_STAGES.every((s) => s.purpose.length > 10));

// ---------------------------------------------------------------------------
// 5. UI CONTRACT — builder keeps teacher-facing language, drops dev wording.
// ---------------------------------------------------------------------------
console.log("\nStep 5: Builder UI keeps calm, teacher-facing language...");

const builder = read("src/components/TeacherDashboard/LessonsBuilder.tsx");
const editor = read("src/components/TeacherDashboard/QuestionEditor.tsx");

// Present: the new product language.
check("Command header surfaces a 'Next' best action", builder.includes(">Next<") || builder.includes("Next best action"));
check("Builder uses the shared Practice/Assessment selector", builder.includes("ModeSelector") && builder.includes("How students experience this"));
check("Builder groups readiness as Blockers / Needs attention / Optional",
  builder.includes("Blockers") && builder.includes("Needs attention") && builder.includes("Optional"));
check("Builder explains what students will see", builder.includes("What students will see"));
check("Setup uses required-only title and optional description", builder.includes("Lesson title") && builder.includes("(optional)"));

check("Question editor labels teacher-only scoring setup", editor.includes("Teacher-only scoring setup"));
check("Question editor reassures students won't see scoring setup", editor.includes("Students will not see this."));
check("Question editor offers 'Draft rubric with AI'", editor.includes("Draft rubric with AI"));
check("Question editor shows 'AI scoring readiness'", editor.includes("AI scoring readiness"));
check("AI failure copy is calm (question not changed)", editor.includes("wasn’t changed") || editor.includes("wasn't changed"));

// Absent: developer / internal / scary wording in the teacher UI.
const bannedBuilder = [
  "Grading Mode Selection",
  "Draft State",
  "Direct Video URL",
  "Lesson Plan",
  "securely recorded",
  "passive pacing logs",
  "ID: {lesson.id",
];
bannedBuilder.forEach((phrase) => {
  check(`Builder no longer shows "${phrase}"`, !builder.includes(phrase));
});

const bannedEditor = [
  "AI Grading Status Dashboard",
  "Teacher Review Recommended", // always-on noisy badge removed
];
bannedEditor.forEach((phrase) => {
  check(`Question editor no longer shows "${phrase}"`, !editor.includes(phrase));
});

// Stable choice ids — correct answer must bind to id, never array index (guards grading).
check("MC correct answer binds to a stable choice id", editor.includes("correctChoiceId: c.id"));

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Trusted-logic verification for the VERITAS Learn vertical slice.
 *
 * Real Firebase auth cannot be exercised in this sandbox (no Admin credentials / no
 * valid client token), so this harness imports the ACTUAL server-side modules and
 * exercises the author -> migrate -> sanitize -> scramble -> grade path end-to-end,
 * proving the security-critical logic without the HTTP/auth layer.
 *
 * Run: npx tsx scripts/verify-slice.ts
 */
import {
  migrateBlock,
  migrateQuestionDefinition,
  sanitizeQuestionForStudent,
  sanitizeBlockForStudent,
  gradeMc,
  choiceTextById,
  findLeakedSecretFields,
  SECRET_QUESTION_FIELDS,
} from "../server/data/sanitize";
import { validateQuestion, validateLessonBlocks } from "../server/data/validation";
import { AppErrorException, toAppError } from "../server/data/errors";

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

console.log("\n=== 1. Teacher authors an MC question (legacy string choices + index) ===");
const authoredMcLegacy = {
  id: "q_mc1",
  stem: "Which plan favored larger states?",
  choices: ["Virginia Plan", "New Jersey Plan", "Connecticut Plan", "Pinckney Plan"],
  correctAnswerIndex: 0,
  explanation: "The Virginia Plan based representation on population.",
  points: 5,
};
const mc = migrateQuestionDefinition(authoredMcLegacy);
check("choices migrated to {id,text} objects", Array.isArray(mc.choices) && mc.choices.every((c: any) => typeof c.id === "string" && "text" in c));
check("correctChoiceId derived from legacy index", mc.correctChoiceId === mc.choices[0].id, mc.correctChoiceId);
check("type inferred as mc", mc.type === "mc");

console.log("\n=== 2. Sanitized student payload leaks NO secret fields (graded MC) ===");
const scrambled = [...mc.choices].reverse(); // simulate scramble (order changes, ids stable)
const deliveredMc = sanitizeQuestionForStudent(mc, scrambled);
const mcLeaks = findLeakedSecretFields(deliveredMc);
check("graded MC delivery has zero secret fields", mcLeaks.length === 0, mcLeaks);
check("delivered MC keeps stable choice ids", deliveredMc.choices.every((c: any) => typeof c.id === "string"));
check("delivered MC has no correctChoiceId", deliveredMc.correctChoiceId === undefined);

console.log("\n=== 3. MC grades correctly by id, even when scrambled ===");
const correctId = mc.choices[0].id;
const wrongId = mc.choices[1].id;
check("correct id grades correct", gradeMc(mc, correctId).isCorrect === true);
check("wrong id grades incorrect", gradeMc(mc, wrongId).isCorrect === false);
// Student receives the SCRAMBLED order; the id they click still maps to correctChoiceId.
const studentSeesFirst = deliveredMc.choices[0].id; // first option in scrambled order
const expectedCorrectInScramble = studentSeesFirst === correctId;
check(
  "scrambled selection grades by id (order-independent)",
  gradeMc(mc, studentSeesFirst).isCorrect === expectedCorrectInScramble
);
check("choiceTextById resolves chosen MC text for review", choiceTextById(mc, correctId) === "Virginia Plan");

console.log("\n=== 4. Teacher authors a graded short-answer question ===");
const authoredSa = {
  id: "q_sa1",
  type: "sa",
  stem: "Explain the Three-Fifths Compromise.",
  modelAnswer: "Enslaved people counted as 3/5 for representation and taxation.",
  answerKey: "Must mention representation AND taxation.",
  aiScoringGuidance: "Award full credit only if both representation and taxation are addressed.",
  teacherNotes: "Common error: students omit taxation.",
  rubricCategories: [
    { id: "r1", name: "Representation", maxPoints: 5, description: "States the representation effect." },
    { id: "r2", name: "Taxation", maxPoints: 5, description: "States the taxation effect." },
  ],
  points: 10,
};
const sa = migrateQuestionDefinition(authoredSa);
const deliveredSa = sanitizeQuestionForStudent(sa);
const saLeaks = findLeakedSecretFields(deliveredSa);
check("graded SA delivery has zero secret fields", saLeaks.length === 0, saLeaks);
check("delivered SA keeps prompt", deliveredSa.stem === authoredSa.stem);
check("delivered SA omits modelAnswer/answerKey/guidance/rubric/notes",
  deliveredSa.modelAnswer === undefined &&
  deliveredSa.answerKey === undefined &&
  deliveredSa.aiScoringGuidance === undefined &&
  deliveredSa.rubricCategories === undefined &&
  deliveredSa.teacherNotes === undefined
);

console.log("\n=== 5. Whole-block sanitization (single question + video checkpoints) ===");
const videoBlock = migrateBlock({
  id: "b_v",
  type: "video",
  isPractice: false,
  videoCheckpoints: [
    { id: "cp1", timestamp: 30, isRequired: true, pauseVideo: true, isPractice: false, questionType: "mc", numToSelect: 1, questions: [authoredMcLegacy] },
  ],
});
const sanitizedBlock = sanitizeBlockForStudent(videoBlock);
check("sanitized checkpoint block has zero secret fields", findLeakedSecretFields(sanitizedBlock).length === 0, findLeakedSecretFields(sanitizedBlock));

console.log("\n=== 6. Trusted validation rejects invalid graded questions ===");
function expectInvalid(name: string, fn: () => void) {
  try {
    fn();
    check(name, false, "expected validation to throw");
  } catch (e) {
    check(name, e instanceof AppErrorException && (e.code === "INVALID_QUESTION" || e.code === "VALIDATION_ERROR"), e instanceof Error ? e.message : e);
  }
}
expectInvalid("rejects graded MC with no correct answer", () =>
  validateQuestion({ type: "mc", stem: "x", choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }], points: 3 }, true, "MC")
);
expectInvalid("rejects graded MC with <2 choices", () =>
  validateQuestion({ type: "mc", stem: "x", choices: [{ id: "a", text: "A" }], correctChoiceId: "a", points: 3 }, true, "MC")
);
expectInvalid("rejects graded SA with no rubric", () =>
  validateQuestion({ type: "sa", stem: "x", points: 4, rubricCategories: [] }, true, "SA")
);
expectInvalid("rejects graded question with zero points", () =>
  validateQuestion({ type: "mc", stem: "x", choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctChoiceId: "a", points: 0 }, true, "MC")
);
// Valid ones should NOT throw:
try {
  validateQuestion(mc, true, "MC");
  validateQuestion(sa, true, "SA");
  validateLessonBlocks([{ type: "video", videoCheckpoints: videoBlock.videoCheckpoints }]);
  check("accepts valid authored MC + SA + checkpoint", true);
} catch (e) {
  check("accepts valid authored MC + SA + checkpoint", false, e instanceof Error ? e.message : e);
}

console.log("\n=== 7. Structured error shape ===");
const errShape = toAppError("DATABASE_WRITE_FAILED", "nope");
check("AppError has {error:true, code, message}", errShape.error === true && errShape.code === "DATABASE_WRITE_FAILED" && typeof errShape.message === "string");

console.log(`\nSECRET fields enforced: ${SECRET_QUESTION_FIELDS.join(", ")}`);
console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

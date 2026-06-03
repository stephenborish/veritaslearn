/**
 * Server-certified completion validation suite for VERITAS Learn.
 *
 * Exercises the pure completion validator functions without a running server.
 * Run: npx tsx scripts/verify-completion.ts
 */

import {
  validateAttemptCompletion,
  validateVideoCompletion,
  validateCheckpointCompletion,
  validateQuestionBlockCompletion,
  studentSafeMessage,
} from "../server/data/completion.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}`, detail !== undefined ? `\n    Detail: ${JSON.stringify(detail)}` : "");
  }
}

// ──────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────

function makeDb(overrides: any = {}) {
  return {
    attempts: [],
    lessonAssignments: [],
    enrollments: [],
    gradebookEntries: [],
    lessonVersions: [],
    blocks: [],
    responses: [],
    questionAssignments: [],
    aiGradingRecords: [],
    users: [],
    courses: [],
    ...overrides,
  };
}

const NOW = new Date("2025-08-01T12:00:00Z");

function makeAssignment(overrides: any = {}) {
  return {
    id: "asg_1",
    lessonId: "lesson_1",
    lessonVersionId: "ver_1",
    courseId: "course_1",
    opensAt: "2025-07-01T00:00:00Z",
    dueAt: "2025-09-01T00:00:00Z",
    closesAt: "2025-09-15T00:00:00Z",
    ...overrides,
  };
}

function makeAttempt(overrides: any = {}) {
  return {
    id: "attempt_1",
    lessonId: "lesson_1",
    assignmentId: "asg_1",
    lessonVersionId: "ver_1",
    studentId: "student_1",
    status: "started",
    furthestVideoTimestamps: {},
    ...overrides,
  };
}

function makeEnrollment(overrides: any = {}) {
  return { courseId: "course_1", studentId: "student_1", status: "active", ...overrides };
}

function makeVersion(overrides: any = {}) {
  return { id: "ver_1", lessonId: "lesson_1", blocksSnapshot: [], ...overrides };
}

// ──────────────────────────────────────────────────────────
// Section 1: Attempt not found
// ──────────────────────────────────────────────────────────
console.log("\n=== 1. Attempt Not Found ===");
{
  const db = makeDb();
  const result = validateAttemptCompletion("nonexistent", "student_1", false, db, NOW);
  check("canComplete is false when attempt not found", !result.canComplete);
  check("missing code is invalid_attempt", result.missing[0]?.code === "invalid_attempt");
}

// ──────────────────────────────────────────────────────────
// Section 2: Ownership check
// ──────────────────────────────────────────────────────────
console.log("\n=== 2. Ownership ===");
{
  const db = makeDb({
    attempts: [makeAttempt({ studentId: "student_1" })],
    lessonAssignments: [makeAssignment()],
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "student_2", false, db, NOW);
  check("canComplete is false for wrong student", !result.canComplete);
  check("missing code is invalid_attempt (ownership)", result.missing[0]?.code === "invalid_attempt");
}
{
  const db = makeDb({
    attempts: [makeAttempt({ studentId: "student_1" })],
    lessonAssignments: [makeAssignment()],
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "teacher_1", true, db, NOW);
  check("Teacher can validate any attempt (no ownership check)", result.missing.every(m => m.code !== "invalid_attempt"));
}

// ──────────────────────────────────────────────────────────
// Section 3: Already completed
// ──────────────────────────────────────────────────────────
console.log("\n=== 3. Already Completed ===");
{
  const db = makeDb({
    attempts: [makeAttempt({ status: "completed" })],
    lessonAssignments: [makeAssignment()],
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("canComplete is false for already-completed attempt", !result.canComplete);
  check("missing code is invalid_attempt (completed)", result.missing[0]?.code === "invalid_attempt");
}

// ──────────────────────────────────────────────────────────
// Section 4: Enrollment check
// ──────────────────────────────────────────────────────────
console.log("\n=== 4. Enrollment ===");
{
  const db = makeDb({
    attempts: [makeAttempt()],
    lessonAssignments: [makeAssignment()],
    enrollments: [], // no enrollment
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("canComplete is false when not enrolled", !result.canComplete);
  check("missing code is enrollment_inactive", result.missing.some(m => m.code === "enrollment_inactive"));
}
{
  const db = makeDb({
    attempts: [makeAttempt()],
    lessonAssignments: [makeAssignment()],
    enrollments: [makeEnrollment({ status: "removed" })],
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("canComplete is false when enrollment is removed", !result.canComplete);
}

// ──────────────────────────────────────────────────────────
// Section 5: Assignment availability
// ──────────────────────────────────────────────────────────
console.log("\n=== 5. Assignment Availability ===");
{
  const db = makeDb({
    attempts: [makeAttempt()],
    lessonAssignments: [makeAssignment({ opensAt: "2025-09-01T00:00:00Z" })], // not open yet
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("canComplete is false when assignment not open", !result.canComplete);
  check("missing code is assignment_not_open", result.missing.some(m => m.code === "assignment_not_open"));
}
{
  const db = makeDb({
    attempts: [makeAttempt()],
    lessonAssignments: [makeAssignment({ closesAt: "2025-01-01T00:00:00Z" })], // already closed
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion()],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("canComplete is false when assignment closed", !result.canComplete);
  check("missing code is assignment_closed", result.missing.some(m => m.code === "assignment_closed"));
}
{
  // Extended student bypasses closure
  const db = makeDb({
    attempts: [makeAttempt()],
    lessonAssignments: [makeAssignment({ closesAt: "2025-01-01T00:00:00Z" })],
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion()],
    gradebookEntries: [{ assignmentId: "asg_1", studentId: "student_1", extendedUntil: "2025-12-01T00:00:00Z" }],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("Extended student bypasses closed state", !result.missing.some(m => m.code === "assignment_closed"));
}

// ──────────────────────────────────────────────────────────
// Section 6: Version mismatch
// ──────────────────────────────────────────────────────────
console.log("\n=== 6. Version Mismatch ===");
{
  const db = makeDb({
    attempts: [makeAttempt({ lessonVersionId: "ver_2" })], // attempt has different version
    lessonAssignments: [makeAssignment({ lessonVersionId: "ver_1" })],
    enrollments: [makeEnrollment()],
    lessonVersions: [makeVersion({ id: "ver_2" })],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("version_mismatch detected", result.missing.some(m => m.code === "version_mismatch"));
}

// ──────────────────────────────────────────────────────────
// Section 7: Video completion
// ──────────────────────────────────────────────────────────
console.log("\n=== 7. Video Completion ===");
{
  const block = { id: "block_v1", type: "video", duration: 600 };
  const attempt = makeAttempt({ furthestVideoTimestamps: { block_v1: 300 } }); // 50% watched
  const result = validateVideoCompletion(block, attempt, {});
  check("Video not finished is flagged (50% < 85%)", result.some(m => m.code === "video_not_finished"));
}
{
  const block = { id: "block_v1", type: "video", duration: 600 };
  const attempt = makeAttempt({ furthestVideoTimestamps: { block_v1: 520 } }); // 87% watched
  const result = validateVideoCompletion(block, attempt, {});
  check("Video is considered finished at 87%", result.length === 0);
}
{
  const block = { id: "block_v1", type: "video", duration: 0 };
  const attempt = makeAttempt();
  const result = validateVideoCompletion(block, attempt, {});
  check("Video with no duration passes (unknown length)", result.length === 0);
}

// ──────────────────────────────────────────────────────────
// Section 8: Checkpoint completion
// ──────────────────────────────────────────────────────────
console.log("\n=== 8. Checkpoint Completion ===");
{
  const block = { id: "block_v1" };
  const checkpoint = { id: "cp_1", isRequired: true };
  const qAsgs = [{ blockId: "block_v1", checkpointId: "cp_1", questionId: "q_1" }];
  const responses: any[] = []; // no response
  const result = validateCheckpointCompletion(block, checkpoint, makeAttempt(), responses, qAsgs);
  check("Required checkpoint unanswered is flagged", result.some(m => m.code === "checkpoint_unanswered"));
}
{
  const block = { id: "block_v1" };
  const checkpoint = { id: "cp_1", isRequired: true };
  const qAsgs = [{ blockId: "block_v1", checkpointId: "cp_1", questionId: "q_1" }];
  const responses = [{ questionId: "q_1", attemptId: "attempt_1" }];
  const result = validateCheckpointCompletion(block, checkpoint, makeAttempt(), responses, qAsgs);
  check("Required checkpoint answered passes", result.length === 0);
}
{
  const block = { id: "block_v1" };
  const checkpoint = { id: "cp_1", isRequired: false }; // optional
  const qAsgs = [{ blockId: "block_v1", checkpointId: "cp_1", questionId: "q_1" }];
  const responses: any[] = [];
  const result = validateCheckpointCompletion(block, checkpoint, makeAttempt(), responses, qAsgs);
  check("Optional checkpoint does not gate completion", result.length === 0);
}

// ──────────────────────────────────────────────────────────
// Section 9: Question block completion
// ──────────────────────────────────────────────────────────
console.log("\n=== 9. Question Block Completion ===");
{
  const block = { id: "block_q1", isPractice: false };
  const qAsgs = [{ blockId: "block_q1", questionId: "q_1" }];
  const responses: any[] = [];
  const result = validateQuestionBlockCompletion(block, makeAttempt(), responses, qAsgs);
  check("Assessment question block unanswered is flagged", result.some(m => m.code === "question_unsubmitted"));
}
{
  const block = { id: "block_q1", isPractice: true }; // practice
  const qAsgs = [{ blockId: "block_q1", questionId: "q_1" }];
  const responses: any[] = [];
  const result = validateQuestionBlockCompletion(block, makeAttempt(), responses, qAsgs);
  check("Practice question block does not gate completion", result.length === 0);
}

// ──────────────────────────────────────────────────────────
// Section 10: Full completion success
// ──────────────────────────────────────────────────────────
console.log("\n=== 10. Full Completion Success ===");
{
  const version = makeVersion({
    blocksSnapshot: [
      { id: "block_v1", type: "video", duration: 600 },
      { id: "block_q1", type: "question", isPractice: false },
    ],
  });
  const db = makeDb({
    attempts: [makeAttempt({ furthestVideoTimestamps: { block_v1: 520 } })],
    lessonAssignments: [makeAssignment()],
    enrollments: [makeEnrollment()],
    lessonVersions: [version],
    questionAssignments: [{ attemptId: "attempt_1", blockId: "block_q1", questionId: "q_1" }],
    responses: [
      { attemptId: "attempt_1", questionId: "q_1", gradebookCategory: "assessment", score: 5, maxPoints: 10 },
    ],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("canComplete is true when all requirements met", result.canComplete, result.missing);
  check("assessmentScore is computed", result.assessmentScore !== undefined);
  check("practiceSummary is returned", result.practiceSummary !== undefined);
}

// ──────────────────────────────────────────────────────────
// Section 11: Practice responses do NOT inflate assessment score
// ──────────────────────────────────────────────────────────
console.log("\n=== 11. Practice vs Assessment Score Separation ===");
{
  const version = makeVersion({ blocksSnapshot: [] });
  const db = makeDb({
    attempts: [makeAttempt()],
    lessonAssignments: [makeAssignment()],
    enrollments: [makeEnrollment()],
    lessonVersions: [version],
    questionAssignments: [],
    responses: [
      { attemptId: "attempt_1", questionId: "q_1", gradebookCategory: "assessment", score: 8, maxPoints: 10 },
      { attemptId: "attempt_1", questionId: "q_2", gradebookCategory: "practice", score: 10, maxPoints: 10 },
    ],
  });
  const result = validateAttemptCompletion("attempt_1", "student_1", false, db, NOW);
  check("Assessment score does not include practice response", result.assessmentScore === 8);
  check("Practice summary shows practice score", (result.practiceSummary as any)?.totalScore === 10);
}

// ──────────────────────────────────────────────────────────
// Section 12: Student-safe messages
// ──────────────────────────────────────────────────────────
console.log("\n=== 12. Student-Safe Messages ===");
{
  const codes: Array<any> = [
    "video_not_finished", "checkpoint_unanswered", "question_unsubmitted",
    "assignment_not_open", "assignment_closed", "enrollment_inactive",
    "invalid_attempt", "version_mismatch", "unknown",
  ];
  codes.forEach(code => {
    const msg = studentSafeMessage(code);
    check(`studentSafeMessage returns for code '${code}'`, typeof msg === "string" && msg.length > 0);
    check(`studentSafeMessage does not reveal code '${code}'`, !msg.toLowerCase().includes(code.replace(/_/g, " ")));
  });
}

// ──────────────────────────────────────────────────────────
// Results
// ──────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(55)}`);
console.log(`COMPLETION VERIFICATION: ${passed} passed, ${failed} failed`);
console.log("=".repeat(55));
if (failed > 0) process.exit(1);

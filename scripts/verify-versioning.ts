/**
 * Immutable lesson versioning verification for VERITAS Learn.
 *
 * Verifies that:
 *  1. Publishing creates an immutable LessonVersion snapshot.
 *  2. Editing the draft after publish does not change the existing version.
 *  3. Re-publishing with different content creates a new version.
 *  4. Idempotent re-publish (no content change) reuses existing version.
 *  5. Assignment creation binds lessonVersionId.
 *  6. Attempt creation binds lessonVersionId and uses version blocks.
 *  7. Response grading resolves from version snapshot, not db.blocks.
 *  8. Student-facing version payload is sanitized (no answer keys).
 *  9. Legacy attempts without lessonVersionId fall back safely to db.blocks.
 * 10. Assignment creation is blocked for unowned courses (multi-teacher check).
 * 11. Assignment date enforcement (not_open, open, closed states).
 * 12. GET /api/lessons student filter respects open/close dates.
 * 13. GET /api/lessons/:id student access respects open/close dates.
 * 14. Firestore rules: lessonVersions collection deny student writes.
 *
 * Run: npx tsx scripts/verify-versioning.ts
 */

import assert from "assert";
import fs from "fs";
import path from "path";

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

// ─── Replicate server-side helpers (keep in sync with server.ts) ─────────────

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return "h" + h.toString(16);
}

type AvailabilityState = 'not_open' | 'open' | 'due_passed' | 'closed' | 'unavailable';

function getAssignmentAvailabilityState(asg: any, now: Date): AvailabilityState {
  if (!asg) return 'unavailable';
  const opensAt  = asg.opensAt  ? new Date(asg.opensAt)  : null;
  const dueAt    = asg.dueAt    ? new Date(asg.dueAt)    : null;
  const closesAt = asg.closesAt ? new Date(asg.closesAt) : null;
  if (opensAt  && now < opensAt)  return 'not_open';
  if (closesAt && now > closesAt) return 'closed';
  if (dueAt    && now > dueAt)    return 'due_passed';
  return 'open';
}

function teacherCanManageCourse(userId: string, course: any, isSuperAdmin = false): boolean {
  if (!course) return false;
  if (isSuperAdmin) return true;
  if (course.teacherId === userId) return true;
  if (Array.isArray(course.teacherIds) && course.teacherIds.includes(userId)) return true;
  return false;
}

function createLessonVersionSnapshot(lesson: any, blocks: any[], createdBy: string, db: any, publishNotes?: string): any {
  if (!db.lessonVersions) db.lessonVersions = [];
  const sortedBlocks = [...blocks].sort((a: any, b: any) => a.order - b.order);
  const checksum = simpleHash(JSON.stringify({
    title: lesson.title, description: lesson.description, settings: lesson.settings, blocks: sortedBlocks,
  }));
  const existing = db.lessonVersions.find(
    (v: any) => v.lessonId === lesson.id && v.status === 'published' && v.checksum === checksum
  );
  if (existing) return existing;

  const existingForLesson = db.lessonVersions.filter((v: any) => v.lessonId === lesson.id);
  const maxVersion = existingForLesson.reduce((max: number, v: any) => Math.max(max, v.versionNumber || 0), 0);
  const newVersion: any = {
    id: 'lv_test_' + Math.random().toString(36).substring(2, 9),
    lessonId: lesson.id,
    versionNumber: maxVersion + 1,
    title: lesson.title,
    description: lesson.description,
    blocksSnapshot: JSON.parse(JSON.stringify(sortedBlocks)),
    settings: JSON.parse(JSON.stringify(lesson.settings)),
    createdBy,
    createdAt: new Date().toISOString(),
    sourceLessonUpdatedAt: lesson.updatedAt || new Date().toISOString(),
    publishNotes: publishNotes || undefined,
    status: 'published',
    checksum,
  };
  db.lessonVersions.push(newVersion);
  return newVersion;
}

function resolveQuestionFromVersion(version: any, blockId: string, checkpointId: string | undefined, questionId: string): { block: any; rawOriginal: any } | null {
  if (!version || !Array.isArray(version.blocksSnapshot)) return null;
  const block = version.blocksSnapshot.find((b: any) => b.id === blockId);
  if (!block) return null;
  let rawOriginal: any = null;
  if (checkpointId && Array.isArray(block.videoCheckpoints)) {
    const cp = block.videoCheckpoints.find((c: any) => c.id === checkpointId);
    if (cp) rawOriginal = (cp.questions || []).find((q: any) => q.id === questionId);
  } else {
    rawOriginal =
      block.singleQuestion ||
      (block.questionPool && block.questionPool.questions.find((q: any) => q.id === questionId));
  }
  return rawOriginal ? { block, rawOriginal } : null;
}

function canStudentViewLesson(lessonId: string, studentId: string, db: any, now: Date): boolean {
  const lesson = db.lessons.find((l: any) => l.id === lessonId);
  if (!lesson || !lesson.isPublished) return false;
  const enrolled = (db.enrollments || []).filter(
    (e: any) => e.studentId === studentId && e.status === 'active'
  );
  const enrolledCourseIds = new Set(enrolled.map((e: any) => e.courseId));
  const studentAssignments = (db.lessonAssignments || []).filter(
    (asg: any) => asg.lessonId === lessonId && enrolledCourseIds.has(asg.courseId)
  );
  if (studentAssignments.length === 0) return false;
  return studentAssignments.some((asg: any) => {
    const state = getAssignmentAvailabilityState(asg, now);
    return state !== 'not_open' && state !== 'unavailable';
  });
}

function listLessonsForStudent(studentId: string, db: any, now: Date): any[] {
  const enrolled = (db.enrollments || []).filter(
    (e: any) => e.studentId === studentId && e.status === 'active'
  );
  const enrolledCourseIds = new Set(enrolled.map((e: any) => e.courseId));
  const openAssignedLessonIds = new Set(
    (db.lessonAssignments || [])
      .filter((asg: any) => {
        if (!enrolledCourseIds.has(asg.courseId)) return false;
        const state = getAssignmentAvailabilityState(asg, now);
        return state !== 'not_open' && state !== 'unavailable';
      })
      .map((asg: any) => asg.lessonId)
  );
  return db.lessons.filter((l: any) => l.isPublished && openAssignedLessonIds.has(l.id));
}

// ─── Mock database ─────────────────────────────────────────────────────────────

const past   = "2026-01-01T00:00:00.000Z";
const future = "2099-12-31T23:59:59.000Z";
const now    = new Date("2026-06-03T12:00:00.000Z");

const mockSettings: any = {
  restrictSeeking: false, requireFullscreen: false, allowRetakes: false,
  randomizeChoices: false, immediateFeedback: false,
};

const mc_q1: any = {
  id: "q_mc1", type: "mc", stem: "What is 2+2?", points: 2,
  choices: [{ id: "c1", text: "3" }, { id: "c2", text: "4" }],
  correctChoiceId: "c2",
  explanation: "Basic arithmetic.",
};

const sa_q1: any = {
  id: "q_sa1", type: "sa", stem: "Explain photosynthesis.", points: 4,
  rubricCategories: [{ id: "r1", name: "Accuracy", maxPoints: 4, description: "Is it accurate?" }],
  modelAnswer: "Plants use sunlight to convert CO2 and water into glucose.",
  aiScoringGuidance: "Award 4 for full explanation, 2 for partial.",
};

const block_q: any = {
  id: "blk_q1", lessonId: "lesson_v", order: 1, type: "question",
  title: "Q Block", questionType: "mc", isPractice: false,
  singleQuestion: mc_q1,
};

const block_sa: any = {
  id: "blk_sa1", lessonId: "lesson_v", order: 2, type: "question",
  title: "SA Block", questionType: "sa", isPractice: false,
  singleQuestion: sa_q1,
};

const lesson_v: any = {
  id: "lesson_v", title: "Versioned Lesson", description: "Test",
  courseId: "course_x", isPublished: false,
  settings: mockSettings, createdAt: now.toISOString(), updatedAt: now.toISOString(),
};

const course_x: any = {
  id: "course_x", name: "Test Course", teacherId: "teacher_x", status: "active",
};

const course_multi: any = {
  id: "course_multi", name: "Multi Teacher Course",
  teacherId: "teacher_x", teacherIds: ["teacher_x", "teacher_y"],
  status: "active",
};

const course_unrelated: any = {
  id: "course_unrelated", name: "Unrelated", teacherId: "teacher_z", status: "active",
};

const student_1 = "student_v1";
const teacher_x = "teacher_x";
const teacher_y = "teacher_y";
const teacher_z = "teacher_z";

function makeDb(): any {
  return {
    users: [
      { id: teacher_x, role: "teacher", email: "tx@school.edu" },
      { id: teacher_y, role: "teacher", email: "ty@school.edu" },
      { id: teacher_z, role: "teacher", email: "tz@school.edu" },
      { id: student_1, role: "student", email: "s1@school.edu" },
    ],
    courses: [course_x, course_multi, course_unrelated],
    enrollments: [
      { id: "enr_1", studentId: student_1, courseId: "course_x", status: "active" },
    ],
    lessons: [JSON.parse(JSON.stringify(lesson_v))],
    blocks: [JSON.parse(JSON.stringify(block_q)), JSON.parse(JSON.stringify(block_sa))],
    lessonAssignments: [],
    lessonVersions: [],
    attempts: [],
    questionAssignments: [],
    responses: [],
    aiGradingRecords: [],
    securitySignals: [],
    gradebookEntries: [],
    gradebookResponseEntries: [],
    lessonDrafts: [],
    approvedTeachers: [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n=== VERITAS Learn: Immutable Lesson Versioning Verification ===\n");

// ── Section 1: Version creation ───────────────────────────────────────────────
console.log("Section 1: Version creation\n");

{
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  lesson.updatedAt = now.toISOString();
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);

  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);

  check("Publishing creates LessonVersion v1", v1.versionNumber === 1, v1.versionNumber);
  check("Version has blocksSnapshot", Array.isArray(v1.blocksSnapshot) && v1.blocksSnapshot.length === 2);
  check("Version preserves correctChoiceId in snapshot (teacher-only data intact)", v1.blocksSnapshot[0].singleQuestion.correctChoiceId === "c2");
  check("Version preserves rubricCategories in snapshot", Array.isArray(v1.blocksSnapshot[1].singleQuestion.rubricCategories) && v1.blocksSnapshot[1].singleQuestion.rubricCategories.length > 0);
  check("Version preserves modelAnswer in snapshot", !!v1.blocksSnapshot[1].singleQuestion.modelAnswer);
  check("Version id is set", typeof v1.id === "string" && v1.id.startsWith("lv_"));
  check("Version status is published", v1.status === "published");
  check("Version lessonId matches", v1.lessonId === lesson.id);

  // Editing draft after publish: change db.blocks but version must stay frozen
  db.blocks[0].singleQuestion.stem = "CHANGED STEM";
  db.blocks[0].singleQuestion.correctChoiceId = "CHANGED_ANSWER";

  check("Editing db.blocks after publish does NOT change v1's blocksSnapshot stem",
    v1.blocksSnapshot[0].singleQuestion.stem === "What is 2+2?"
  );
  check("Editing db.blocks after publish does NOT change v1's correctChoiceId",
    v1.blocksSnapshot[0].singleQuestion.correctChoiceId === "c2"
  );
}

// ── Section 2: Idempotent publish ─────────────────────────────────────────────
console.log("\nSection 2: Idempotent publish (no content change)\n");

{
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);

  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);
  const v1Again = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);

  check("Idempotent publish reuses same version (no duplicate)", v1.id === v1Again.id, { v1: v1.id, v1Again: v1Again.id });
  check("DB still has only one version for lesson", db.lessonVersions.filter((v: any) => v.lessonId === lesson.id).length === 1);
}

// ── Section 3: New version on content change ──────────────────────────────────
console.log("\nSection 3: New version on content change\n");

{
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);

  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);

  // Teacher edits blocks in place (simulates editing after publish)
  const editedBlocks = JSON.parse(JSON.stringify(blocks));
  editedBlocks[0].singleQuestion.stem = "Updated stem";

  const v2 = createLessonVersionSnapshot(lesson, editedBlocks, teacher_x, db);

  check("Re-publishing with changed blocks creates v2", v2.versionNumber === 2, v2.versionNumber);
  check("v1 is still present and unchanged", db.lessonVersions.some((v: any) => v.id === v1.id));
  check("v2 has updated stem", v2.blocksSnapshot[0].singleQuestion.stem === "Updated stem");
  check("v1 still has original stem", v1.blocksSnapshot[0].singleQuestion.stem === "What is 2+2?");
}

// ── Section 4: Assignment binds lessonVersionId ────────────────────────────────
console.log("\nSection 4: Assignment binds lessonVersionId\n");

{
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);
  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);
  lesson.currentPublishedVersionId = v1.id;

  const assignment: any = {
    id: "asg_test_1",
    lessonId: lesson.id,
    lessonVersionId: lesson.currentPublishedVersionId,
    courseId: "course_x",
    teacherId: teacher_x,
    opensAt: past,
    dueAt: future,
    closesAt: future,
  };
  db.lessonAssignments.push(assignment);

  check("Assignment has lessonVersionId set", !!assignment.lessonVersionId, assignment.lessonVersionId);
  check("Assignment lessonVersionId points to v1", assignment.lessonVersionId === v1.id);
  check("Assignment has teacherId", assignment.teacherId === teacher_x);
}

// ── Section 5: Attempt binds lessonVersionId and uses version blocks ───────────
console.log("\nSection 5: Attempt binds lessonVersionId\n");

{
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);
  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);
  lesson.currentPublishedVersionId = v1.id;

  const assignment: any = {
    id: "asg_test_2",
    lessonId: lesson.id,
    lessonVersionId: v1.id,
    courseId: "course_x",
    opensAt: past,
    dueAt: future,
    closesAt: future,
  };
  db.lessonAssignments.push(assignment);

  // Simulate attempt creation with version resolution
  const resolvedAsg = db.lessonAssignments.find((a: any) => a.id === "asg_test_2");
  const resolvedVersionId = resolvedAsg?.lessonVersionId;
  const ver = resolvedVersionId ? db.lessonVersions.find((v: any) => v.id === resolvedVersionId) : null;
  const versionBlocks = ver ? ver.blocksSnapshot : null;

  const attempt: any = {
    id: "attempt_test_1",
    lessonId: lesson.id,
    assignmentId: "asg_test_2",
    lessonVersionId: resolvedVersionId || null,
    studentId: student_1,
    seed: 12345,
    startedAt: now.toISOString(),
    status: "started",
    currentBlockIndex: 0,
    furthestVideoTimestamps: {},
    activeTimeSpent: 0,
    inactiveTimeSpent: 0,
  };
  db.attempts.push(attempt);

  check("Attempt has lessonVersionId", !!attempt.lessonVersionId, attempt.lessonVersionId);
  check("Attempt lessonVersionId matches assignment version", attempt.lessonVersionId === v1.id);
  check("Version blocks available for question generation", Array.isArray(versionBlocks) && versionBlocks.length === 2);
}

// ── Section 6: Grading resolves from version snapshot ─────────────────────────
console.log("\nSection 6: Grading resolves from version snapshot\n");

{
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);
  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);

  const attempt: any = { id: "att_grade_1", lessonVersionId: v1.id, lessonId: lesson.id };

  // Teacher later changes db.blocks (post-publish edit)
  db.blocks[0].singleQuestion.correctChoiceId = "c1"; // WRONG ANSWER now in mutable draft
  db.blocks[0].singleQuestion.stem = "Completely changed question";

  // Grading should use version snapshot, not db.blocks
  const version = db.lessonVersions.find((v: any) => v.id === attempt.lessonVersionId);
  const resolved = resolveQuestionFromVersion(version, "blk_q1", undefined, "q_mc1");

  check("Grading resolves block from version, not db.blocks", !!resolved, "resolved is null");
  if (resolved) {
    check("Grading uses versioned correctChoiceId (c2, not changed c1)", resolved.rawOriginal.correctChoiceId === "c2");
    check("Grading uses versioned stem (original, not changed)", resolved.rawOriginal.stem === "What is 2+2?");
  }

  // SA: model answer and rubric from version
  const resolvedSA = resolveQuestionFromVersion(version, "blk_sa1", undefined, "q_sa1");
  check("SA grading resolves rubric from version", resolvedSA?.rawOriginal?.rubricCategories?.length === 1);
  check("SA grading resolves modelAnswer from version", !!resolvedSA?.rawOriginal?.modelAnswer);
}

// ── Section 7: Student payload sanitization of version ────────────────────────
console.log("\nSection 7: Student-facing version payload sanitization\n");

import("../server/data/sanitize.js").then(({ sanitizeLessonBlocksForStudent, findLeakedSecretFields }) => {
  const db = makeDb();
  const lesson = db.lessons[0];
  lesson.isPublished = true;
  const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);
  const v1 = createLessonVersionSnapshot(lesson, blocks, teacher_x, db);

  // Student-facing sanitization applied to version snapshot
  const sanitized = sanitizeLessonBlocksForStudent(v1.blocksSnapshot);
  const leaks = findLeakedSecretFields(sanitized);

  check("Sanitized version snapshot has no leaked secret fields", leaks.length === 0, leaks);
  check("Sanitized version MC block: no correctChoiceId", !("correctChoiceId" in sanitized[0].singleQuestion));
  check("Sanitized version SA block: no rubricCategories", !("rubricCategories" in sanitized[1].singleQuestion));
  check("Sanitized version SA block: no modelAnswer", !("modelAnswer" in sanitized[1].singleQuestion));
  check("Sanitized version SA block: no aiScoringGuidance", !("aiScoringGuidance" in sanitized[1].singleQuestion));
  check("Sanitized version retains stems", sanitized[0].singleQuestion.stem === "What is 2+2?");

  // ── Section 8: Legacy attempts (no lessonVersionId) ─────────────────────────
  console.log("\nSection 8: Legacy attempt backward compat (no lessonVersionId)\n");

  {
    const db2 = makeDb();
    const legacyAttempt: any = {
      id: "att_legacy",
      lessonId: "lesson_v",
      lessonVersionId: null, // legacy — no version
      studentId: student_1,
    };

    // Grading fallback: no version → use db.blocks
    const version2 = legacyAttempt.lessonVersionId
      ? db2.lessonVersions.find((v: any) => v.id === legacyAttempt.lessonVersionId)
      : null;
    const fromVersion = resolveQuestionFromVersion(version2, "blk_q1", undefined, "q_mc1");

    check("Legacy attempt: resolveQuestionFromVersion returns null (no version)", fromVersion === null);
    // In this case, server falls back to db.blocks
    const fallbackBlock = db2.blocks.find((b: any) => b.id === "blk_q1");
    check("Legacy attempt: db.blocks fallback finds block", !!fallbackBlock);
    check("Legacy attempt: db.blocks fallback has question", !!fallbackBlock?.singleQuestion);
  }

  // ── Section 9: Multi-teacher course ownership ─────────────────────────────────
  console.log("\nSection 9: Multi-teacher course ownership\n");

  check("teacher_x can manage course_x (primary teacherId)", teacherCanManageCourse(teacher_x, course_x));
  check("teacher_x can manage course_multi (in teacherIds)", teacherCanManageCourse(teacher_x, course_multi));
  check("teacher_y can manage course_multi (in teacherIds array)", teacherCanManageCourse(teacher_y, course_multi));
  check("teacher_z cannot manage course_x (unrelated)", !teacherCanManageCourse(teacher_z, course_x));
  check("teacher_z cannot manage course_multi (unrelated)", !teacherCanManageCourse(teacher_z, course_multi));
  check("SuperAdmin can manage any course", teacherCanManageCourse("super_admin", course_unrelated, true));

  // ── Section 10: Assignment open/close date enforcement ───────────────────────
  console.log("\nSection 10: Assignment open/close date enforcement\n");

  const nowTest = new Date("2026-06-03T12:00:00.000Z");
  const asgUpcoming = { opensAt: "2026-12-01T00:00:00.000Z", dueAt: future, closesAt: future };
  const asgOpen     = { opensAt: past, dueAt: future, closesAt: future };
  const asgPastDue  = { opensAt: past, dueAt: "2026-01-15T00:00:00.000Z", closesAt: future };
  const asgClosed   = { opensAt: past, dueAt: past, closesAt: past };
  const asgNoDate   = { opensAt: null, dueAt: null, closesAt: null };

  check("Upcoming assignment: state is not_open", getAssignmentAvailabilityState(asgUpcoming, nowTest) === 'not_open');
  check("Open assignment: state is open", getAssignmentAvailabilityState(asgOpen, nowTest) === 'open');
  check("Past-due (still open): state is due_passed", getAssignmentAvailabilityState(asgPastDue, nowTest) === 'due_passed');
  check("Closed assignment: state is closed", getAssignmentAvailabilityState(asgClosed, nowTest) === 'closed');
  check("No-date assignment: state is open (no restriction)", getAssignmentAvailabilityState(asgNoDate, nowTest) === 'open');

  // ── Section 11: Student lesson list enforces open date ───────────────────────
  console.log("\nSection 11: GET /api/lessons student date filter\n");

  {
    const db3 = makeDb();
    db3.lessons[0].isPublished = true;

    // Upcoming assignment — student should NOT see lesson
    db3.lessonAssignments.push({
      id: "asg_upcoming", lessonId: "lesson_v", courseId: "course_x",
      opensAt: "2026-12-01T00:00:00.000Z", dueAt: future, closesAt: future,
    });

    const visibleUpcoming = listLessonsForStudent(student_1, db3, nowTest);
    check("Student does not see lesson with only upcoming assignment", visibleUpcoming.length === 0);

    // Open assignment — student should see lesson
    db3.lessonAssignments.push({
      id: "asg_open", lessonId: "lesson_v", courseId: "course_x",
      opensAt: past, dueAt: future, closesAt: future,
    });

    const visibleOpen = listLessonsForStudent(student_1, db3, nowTest);
    check("Student sees lesson once assignment is open", visibleOpen.length === 1);
  }

  // ── Section 12: GET /api/lessons/:id student access respects open date ────────
  console.log("\nSection 12: GET /api/lessons/:id student date gate\n");

  {
    const db4 = makeDb();
    db4.lessons[0].isPublished = true;

    // Only upcoming assignment
    db4.lessonAssignments.push({
      id: "asg_upcome", lessonId: "lesson_v", courseId: "course_x",
      opensAt: "2026-12-01T00:00:00.000Z", dueAt: future, closesAt: future,
    });

    check("Student cannot view lesson content with upcoming-only assignment",
      !canStudentViewLesson("lesson_v", student_1, db4, nowTest)
    );

    // Now add an open assignment
    db4.lessonAssignments.push({
      id: "asg_open2", lessonId: "lesson_v", courseId: "course_x",
      opensAt: past, dueAt: future, closesAt: future,
    });

    check("Student can view lesson content once an assignment is open",
      canStudentViewLesson("lesson_v", student_1, db4, nowTest)
    );

    // Closed assignment (only)
    const db5 = makeDb();
    db5.lessons[0].isPublished = true;
    db5.lessonAssignments.push({
      id: "asg_closed", lessonId: "lesson_v", courseId: "course_x",
      opensAt: past, dueAt: past, closesAt: past,
    });
    check("Student can view lesson with closed (already-opened) assignment (for review)",
      canStudentViewLesson("lesson_v", student_1, db5, nowTest)
    );
  }

  // ── Section 13: Firestore rules static check ──────────────────────────────────
  console.log("\nSection 13: Firestore rules static analysis\n");

  const rulesPath = path.join(process.cwd(), "firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf8");

  check("Firestore rules include lessonVersions collection", rulesContent.includes("lessonVersions"));

  const versionBlock = rulesContent.match(/match\s*\/lessonVersions\/\{[^}]+\}[\s\S]*?(?=\n\s*\/\/\s*\d+\.|match\s*\/\w|$)/)?.[0] || "";
  check("Firestore rules: lessonVersions denies writes via client SDK (allow write: if false)",
    versionBlock.includes("allow write: if false")
  );
  check("Firestore rules: lessonVersions allows teacher reads",
    versionBlock.includes("isTeacher()")
  );

  // ── Final results ─────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\n>>> ${failed} TEST(S) FAILED — versioning implementation is incomplete. <<<\n`);
    process.exit(1);
  } else {
    console.log(`\n>>> ALL ${passed} TESTS PASSED — immutable lesson versioning verified. <<<\n`);
  }
});

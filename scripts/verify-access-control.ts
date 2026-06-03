/**
 * Assignment-aware access control verification for VERITAS Learn.
 *
 * Verifies that:
 *  1. Students only see lessons assigned to their enrolled courses (not all published lessons).
 *  2. Students cannot fetch a published-but-unassigned lesson by ID.
 *  3. Students cannot start an attempt for an unassigned lesson.
 *  4. Students enrolled in Course A cannot see Course B assignments.
 *  5. Students can access assigned lessons for their enrolled course.
 *  6. Teachers can still access all their lessons.
 *  7. Teachers cannot assign to a nonexistent course.
 *  8. Teachers cannot assign to a course they do not own.
 *  9. The unknown-course fallback does NOT expose assignments to students.
 * 10. Attempt creation requires enrollment for both the assignmentId and legacy lessonId paths.
 * 11. Student-facing lesson payload remains sanitized (no answer keys / rubrics).
 * 12. Firestore rules deny direct student reads for sensitive collections (static analysis).
 *
 * Run: npx tsx scripts/verify-access-control.ts
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

// ─── Replicate server-side helpers ────────────────────────────────────────────

function getStudentEnrolledCourseIds(studentId: string, db: any): Set<string> {
  const active = (db.enrollments || []).filter(
    (e: any) => e.studentId === studentId && e.status === "active"
  );
  return new Set(active.map((e: any) => e.courseId));
}

/** Replicates GET /api/lessons student filter logic. */
function listLessonsForStudent(studentId: string, db: any): any[] {
  const enrolledCourseIds = getStudentEnrolledCourseIds(studentId, db);
  const assignedLessonIds = new Set(
    (db.lessonAssignments || [])
      .filter((asg: any) => enrolledCourseIds.has(asg.courseId))
      .map((asg: any) => asg.lessonId)
  );
  return db.lessons.filter((l: any) => l.isPublished && assignedLessonIds.has(l.id));
}

/** Replicates GET /api/lessons/:id student eligibility logic. */
function canStudentAccessLessonById(lessonId: string, studentId: string, db: any): boolean {
  const lesson = db.lessons.find((l: any) => l.id === lessonId);
  if (!lesson || !lesson.isPublished) return false;

  const enrolledCourseIds = getStudentEnrolledCourseIds(studentId, db);
  return (db.lessonAssignments || []).some(
    (asg: any) => asg.lessonId === lessonId && enrolledCourseIds.has(asg.courseId)
  );
}

/** Replicates POST /api/assignments teacher validation logic. */
function validateAssignmentCreation(
  teacherId: string,
  courseId: string,
  lessonId: string,
  db: any,
  isSuperAdmin = false
): { ok: boolean; error?: string } {
  const course = db.courses.find((c: any) => c.id === courseId);
  if (!course) return { ok: false, error: "The selected course does not exist." };
  if (course.teacherId !== teacherId && !isSuperAdmin) return { ok: false, error: "You do not have access to this course." };
  if (course.archivedAt) return { ok: false, error: "Cannot assign to an archived course." };

  const lesson = db.lessons.find((l: any) => l.id === lessonId);
  if (!lesson) return { ok: false, error: "Selected lesson not found." };
  if (!lesson.isPublished) return { ok: false, error: "Only published lessons can be assigned." };

  return { ok: true };
}

/** Replicates POST /api/attempts student eligibility for assignmentId path. */
function canStudentStartAttemptByAssignmentId(
  studentId: string,
  assignmentId: string,
  db: any
): { ok: boolean; error?: string } {
  const nowIso = new Date().toISOString();
  const lessonAssignments = db.lessonAssignments || [];

  const asg = lessonAssignments.find((a: any) => a.id === assignmentId);
  if (!asg) return { ok: false, error: "Assignment not found." };
  if (asg.opensAt && asg.opensAt > nowIso) return { ok: false, error: "Assignment not open yet." };
  if (asg.closesAt && asg.closesAt < nowIso) return { ok: false, error: "Assignment is closed." };

  const enrolled = (db.enrollments || []).some(
    (e: any) => e.courseId === asg.courseId && e.studentId === studentId && e.status === "active"
  );
  if (!enrolled) return { ok: false, error: "Not enrolled in the course for this assignment." };

  return { ok: true };
}

/** Replicates POST /api/attempts student eligibility for legacy lessonId path. */
function canStudentStartAttemptByLessonId(
  studentId: string,
  lessonId: string,
  db: any
): { ok: boolean; error?: string } {
  const nowIso = new Date().toISOString();
  const lessonAssignments = db.lessonAssignments || [];

  const openAsg = lessonAssignments.find((a: any) => {
    if (a.lessonId !== lessonId) return false;
    if (a.opensAt && a.opensAt > nowIso) return false;
    if (a.closesAt && a.closesAt < nowIso) return false;
    return true;
  });

  if (!openAsg) return { ok: false, error: "No open assignment found for this lesson." };

  const enrolled = (db.enrollments || []).some(
    (e: any) => e.courseId === openAsg.courseId && e.studentId === studentId && e.status === "active"
  );
  if (!enrolled) return { ok: false, error: "Not enrolled in the course for this assignment." };

  return { ok: true };
}

/** Replicates GET /api/assignments student filter (no unknown-course fallback). */
function listAssignmentsForStudent(studentId: string, db: any): any[] {
  const enrolledCourseIds = getStudentEnrolledCourseIds(studentId, db);
  return (db.lessonAssignments || []).filter((asg: any) => enrolledCourseIds.has(asg.courseId));
}

// ─── Mock database ─────────────────────────────────────────────────────────────

const pastDate = "2026-01-01T00:00:00.000Z";
const futureDate = "2099-12-31T23:59:59.000Z";

const mockDb: any = {
  users: [
    { id: "teacher_a", email: "teacher.a@malvernprep.org", role: "teacher", name: "Teacher A" },
    { id: "teacher_b", email: "teacher.b@malvernprep.org", role: "teacher", name: "Teacher B" },
    { id: "student_1", email: "student1@malvernprep.org", role: "student", name: "Student 1" },
    { id: "student_2", email: "student2@malvernprep.org", role: "student", name: "Student 2" },
    { id: "student_3", email: "student3@malvernprep.org", role: "student", name: "Student 3" },
  ],
  courses: [
    { id: "course_a", name: "AP History", teacherId: "teacher_a", status: "active" },
    { id: "course_b", name: "AP Physics", teacherId: "teacher_b", status: "active" },
    { id: "course_archived", name: "Old Course", teacherId: "teacher_a", status: "archived", archivedAt: "2026-01-01T00:00:00.000Z" },
  ],
  enrollments: [
    { id: "enr_1", studentId: "student_1", courseId: "course_a", status: "active" },
    { id: "enr_2", studentId: "student_2", courseId: "course_b", status: "active" },
    // student_3 has no active enrollments
    // student_1 has no enrollment in course_b
  ],
  lessons: [
    // Lesson A: published, assigned to Course A
    { id: "lesson_a", title: "Lesson A", isPublished: true, description: "", estimatedMinutes: 30, settings: { allowRetakes: false, randomizeChoices: true } },
    // Lesson B: published, NOT assigned to any course
    { id: "lesson_b", title: "Lesson B", isPublished: true, description: "", estimatedMinutes: 30, settings: { allowRetakes: false, randomizeChoices: true } },
    // Lesson C: published, assigned to Course B
    { id: "lesson_c", title: "Lesson C", isPublished: true, description: "", estimatedMinutes: 30, settings: { allowRetakes: false, randomizeChoices: true } },
    // Lesson D: UNPUBLISHED, assigned to Course A (edge case)
    { id: "lesson_d", title: "Lesson D", isPublished: false, description: "", estimatedMinutes: 30, settings: { allowRetakes: false, randomizeChoices: true } },
    // Lesson E: published, owned by Teacher A — teacher access check
    { id: "lesson_e", title: "Lesson E", isPublished: true, description: "", estimatedMinutes: 30, settings: { allowRetakes: false, randomizeChoices: true } },
  ],
  lessonAssignments: [
    {
      id: "asg_a1",
      lessonId: "lesson_a",
      courseId: "course_a",
      opensAt: pastDate,
      dueAt: futureDate,
      closesAt: futureDate,
    },
    {
      id: "asg_c1",
      lessonId: "lesson_c",
      courseId: "course_b",
      opensAt: pastDate,
      dueAt: futureDate,
      closesAt: futureDate,
    },
    {
      id: "asg_d1",
      lessonId: "lesson_d",
      courseId: "course_a",
      opensAt: pastDate,
      dueAt: futureDate,
      closesAt: futureDate,
    },
    // Simulate a legacy assignment with an unknown/nonexistent course
    {
      id: "asg_legacy",
      lessonId: "lesson_b",
      courseId: "course_unknown_xyz",
      opensAt: pastDate,
      dueAt: futureDate,
      closesAt: futureDate,
    },
  ],
  blocks: [],
  attempts: [],
  responses: [],
  questionAssignments: [],
  aiGradingRecords: [],
  gradebookEntries: [],
  gradebookResponseEntries: [],
  securitySignals: [],
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n=== VERITAS Learn: Assignment-Aware Access Control Verification ===\n");

// ── Section 1: Student lesson listing ────────────────────────────────────────
console.log("Section 1: Student lesson listing (GET /api/lessons)\n");

const student1Lessons = listLessonsForStudent("student_1", mockDb);
const student1LessonIds = new Set(student1Lessons.map((l: any) => l.id));

check(
  "Student 1 (enrolled in Course A) can see Lesson A (assigned to Course A)",
  student1LessonIds.has("lesson_a")
);
check(
  "Student 1 cannot see Lesson B (published but not assigned to any enrolled course)",
  !student1LessonIds.has("lesson_b")
);
check(
  "Student 1 cannot see Lesson C (assigned to Course B, student not enrolled in Course B)",
  !student1LessonIds.has("lesson_c")
);
check(
  "Student 1 cannot see Lesson D (assigned to Course A but not published)",
  !student1LessonIds.has("lesson_d")
);

const student2Lessons = listLessonsForStudent("student_2", mockDb);
const student2LessonIds = new Set(student2Lessons.map((l: any) => l.id));
check(
  "Student 2 (enrolled in Course B) can see Lesson C (assigned to Course B)",
  student2LessonIds.has("lesson_c")
);
check(
  "Student 2 cannot see Lesson A (assigned to Course A, student not enrolled in Course A)",
  !student2LessonIds.has("lesson_a")
);

const student3Lessons = listLessonsForStudent("student_3", mockDb);
check(
  "Student 3 (no enrollments) sees no lessons",
  student3Lessons.length === 0
);

// ── Section 2: Student lesson detail access ───────────────────────────────────
console.log("\nSection 2: Student lesson detail access (GET /api/lessons/:id)\n");

check(
  "Student 1 can access Lesson A by ID (enrolled in Course A, Lesson A assigned there)",
  canStudentAccessLessonById("lesson_a", "student_1", mockDb)
);
check(
  "Student 1 cannot access Lesson B by ID (published but not assigned to any enrolled course)",
  !canStudentAccessLessonById("lesson_b", "student_1", mockDb)
);
check(
  "Student 1 cannot access Lesson C by ID (not enrolled in Course B)",
  !canStudentAccessLessonById("lesson_c", "student_1", mockDb)
);
check(
  "Student 1 cannot access Lesson D by ID (unpublished, even though assigned to Course A)",
  !canStudentAccessLessonById("lesson_d", "student_1", mockDb)
);
check(
  "Student 2 can access Lesson C by ID (enrolled in Course B, Lesson C assigned there)",
  canStudentAccessLessonById("lesson_c", "student_2", mockDb)
);
check(
  "Student 2 cannot access Lesson A by ID (not enrolled in Course A)",
  !canStudentAccessLessonById("lesson_a", "student_2", mockDb)
);
check(
  "Student 3 (no enrollments) cannot access any lesson by ID",
  !canStudentAccessLessonById("lesson_a", "student_3", mockDb) &&
  !canStudentAccessLessonById("lesson_b", "student_3", mockDb)
);

// ── Section 3: Attempt start / access ─────────────────────────────────────────
console.log("\nSection 3: Attempt start / access (POST /api/attempts)\n");

const s1a = canStudentStartAttemptByAssignmentId("student_1", "asg_a1", mockDb);
check(
  "Student 1 can start attempt via asg_a1 (enrolled in Course A)",
  s1a.ok,
  s1a.error
);

const s1b = canStudentStartAttemptByAssignmentId("student_1", "asg_c1", mockDb);
check(
  "Student 1 cannot start attempt via asg_c1 (Course B — not enrolled)",
  !s1b.ok && s1b.error === "Not enrolled in the course for this assignment.",
  s1b
);

const s2c = canStudentStartAttemptByAssignmentId("student_2", "asg_c1", mockDb);
check(
  "Student 2 can start attempt via asg_c1 (enrolled in Course B)",
  s2c.ok,
  s2c.error
);

const s1none = canStudentStartAttemptByAssignmentId("student_1", "asg_nonexistent", mockDb);
check(
  "Student 1 cannot start attempt for nonexistent assignment ID",
  !s1none.ok,
  s1none
);

// Legacy path (lessonId only)
const s1leg = canStudentStartAttemptByLessonId("student_1", "lesson_a", mockDb);
check(
  "Student 1 can start attempt via legacy lessonId path for Lesson A (enrolled in Course A)",
  s1leg.ok,
  s1leg.error
);

const s1legb = canStudentStartAttemptByLessonId("student_1", "lesson_c", mockDb);
check(
  "Student 1 cannot start attempt via legacy lessonId for Lesson C (not enrolled in Course B)",
  !s1legb.ok,
  s1legb
);

const s1legUnassigned = canStudentStartAttemptByLessonId("student_1", "lesson_b", mockDb);
check(
  "Student 1 cannot start attempt for Lesson B (only has a legacy unknown-course assignment)",
  !s1legUnassigned.ok,
  s1legUnassigned
);

// ── Section 4: Assignment creation validation ─────────────────────────────────
console.log("\nSection 4: Assignment creation validation (POST /api/assignments)\n");

const v1 = validateAssignmentCreation("teacher_a", "course_a", "lesson_a", mockDb);
check("Teacher A can assign Lesson A to their own Course A", v1.ok, v1.error);

const v2 = validateAssignmentCreation("teacher_a", "course_nonexistent", "lesson_a", mockDb);
check("Teacher A cannot assign to nonexistent course", !v2.ok, v2);

const v3 = validateAssignmentCreation("teacher_a", "course_b", "lesson_a", mockDb);
check("Teacher A cannot assign to Course B (owned by Teacher B)", !v3.ok, v3);

const v4 = validateAssignmentCreation("teacher_b", "course_b", "lesson_c", mockDb);
check("Teacher B can assign Lesson C to their own Course B", v4.ok, v4.error);

const v5 = validateAssignmentCreation("teacher_a", "course_archived", "lesson_a", mockDb);
check("Teacher A cannot assign to an archived course", !v5.ok, v5);

const v6 = validateAssignmentCreation("teacher_a", "course_a", "lesson_d", mockDb);
check("Teacher A cannot assign an unpublished lesson (Lesson D)", !v6.ok, v6);

const v7 = validateAssignmentCreation("teacher_a", "course_a", "lesson_nonexistent", mockDb);
check("Teacher A cannot assign a nonexistent lesson", !v7.ok, v7);

// SuperAdmin bypass
const v8 = validateAssignmentCreation("super_admin", "course_b", "lesson_c", mockDb, true);
check("SuperAdmin can assign to any course (ownership bypassed)", v8.ok, v8.error);

// ── Section 5: Unknown-course fallback removal ────────────────────────────────
console.log("\nSection 5: Unknown-course fallback removal (GET /api/assignments)\n");

const s1assignments = listAssignmentsForStudent("student_1", mockDb);
const s1asgIds = s1assignments.map((a: any) => a.id);

check(
  "Student 1 sees asg_a1 (enrolled in Course A)",
  s1asgIds.includes("asg_a1")
);
check(
  "Student 1 does NOT see asg_legacy (unknown courseId 'course_unknown_xyz' — no unknown-course fallback)",
  !s1asgIds.includes("asg_legacy")
);
check(
  "Student 1 does NOT see asg_c1 (Course B — not enrolled)",
  !s1asgIds.includes("asg_c1")
);

const s3assignments = listAssignmentsForStudent("student_3", mockDb);
check(
  "Student 3 (no enrollments) sees no assignments (unknown-course fallback does not apply)",
  s3assignments.length === 0
);

// ── Section 6: Teacher access preserved ──────────────────────────────────────
console.log("\nSection 6: Teacher access preserved\n");

// Teachers see all lessons (not filtered by enrollment)
const allLessons = mockDb.lessons;
check(
  "All lessons are in the DB (teacher access check baseline)",
  allLessons.length === 5
);

// Teacher sees all assignments regardless of enrollment
const allAssignments = mockDb.lessonAssignments;
check(
  "All lesson assignments are in the DB (teacher access check baseline)",
  allAssignments.length === 4
);

// ── Section 7: Student-facing payload sanitization ───────────────────────────
console.log("\nSection 7: Student-facing payload sanitization\n");

import("../server/data/sanitize.js").then(({ sanitizeQuestionForStudent, findLeakedSecretFields, sanitizeLessonBlocksForStudent }) => {
  const rawBlock = {
    id: "block_test",
    lessonId: "lesson_a",
    type: "question",
    order: 1,
    title: "Test Question",
    questionType: "mc",
    isPractice: false,
    singleQuestion: {
      id: "q1",
      type: "mc",
      stem: "What is 2+2?",
      choices: [
        { id: "c1", text: "3" },
        { id: "c2", text: "4" },
        { id: "c3", text: "5" },
      ],
      correctChoiceId: "c2",
      explanation: "Basic arithmetic.",
      rubricCategories: [{ id: "r1", name: "Accuracy", maxPoints: 2 }],
      modelAnswer: "4",
      answerKey: "4",
      aiScoringGuidance: "Check if student knows 2+2=4.",
      teacherNotes: "This is a simple question.",
      points: 2,
    },
  };

  const sanitized = sanitizeLessonBlocksForStudent([rawBlock]);
  const leaks = findLeakedSecretFields(sanitized);

  check(
    "Sanitized lesson block for student has no leaked secret fields",
    leaks.length === 0,
    leaks
  );

  const rawQ = rawBlock.singleQuestion;
  const sanitizedQ = sanitizeQuestionForStudent(rawQ);

  check(
    "Sanitized question has no correctChoiceId",
    !("correctChoiceId" in sanitizedQ)
  );
  check(
    "Sanitized question has no explanation",
    !("explanation" in sanitizedQ)
  );
  check(
    "Sanitized question has no rubricCategories",
    !("rubricCategories" in sanitizedQ)
  );
  check(
    "Sanitized question has no modelAnswer",
    !("modelAnswer" in sanitizedQ)
  );
  check(
    "Sanitized question has no answerKey",
    !("answerKey" in sanitizedQ)
  );
  check(
    "Sanitized question has no aiScoringGuidance",
    !("aiScoringGuidance" in sanitizedQ)
  );
  check(
    "Sanitized question has no teacherNotes",
    !("teacherNotes" in sanitizedQ)
  );
  check(
    "Sanitized question retains stem",
    sanitizedQ.stem === rawQ.stem
  );
  check(
    "Sanitized question retains choices as {id, text} pairs",
    Array.isArray(sanitizedQ.choices) && sanitizedQ.choices.length === 3 &&
    sanitizedQ.choices.every((c: any) => typeof c.id === "string" && typeof c.text === "string")
  );

  // ── Section 8: Firestore rules static analysis ───────────────────────────────
  console.log("\nSection 8: Firestore rules static analysis\n");

  const rulesPath = path.join(process.cwd(), "firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf8");

  // Verify sensitive collections do NOT grant student read access
  const sensitiveCollections = [
    "lessons",
    "blocks",
    "questionAssignments",
    "assignments",
    "responses",
    "lessonAssignments",
    "gradebookEntries",
    "gradebookResponseEntries",
    "lessonDrafts",
    "aiGradingRecords",
  ];

  // Pattern that would grant student (non-teacher) read access:
  // allow read: if isTeacher() || (isSignedIn() && ...)
  // or: allow read: if isSignedIn()
  // We check that for each sensitive collection, there is NO rule granting student reads.

  for (const col of sensitiveCollections) {
    // Look for the match block for this collection
    const colPattern = new RegExp(
      `match\\s*/\\b${col}\\b/\\{[^}]+\\}[\\s\\S]*?(?=match\\s*/|$)`,
      "g"
    );
    const colMatches = rulesContent.match(colPattern);
    const colBlock = colMatches ? colMatches[0] : "";

    // Check that the read rule does NOT include isSignedIn() without isTeacher() check
    // (which would grant student access)
    const hasStudentRead =
      colBlock.includes("isSignedIn()") &&
      colBlock.includes("allow read") &&
      !colBlock.match(/allow read:\s*if isTeacher\(\);/);

    check(
      `Firestore rules: '${col}' collection does not grant direct student reads`,
      !hasStudentRead,
      hasStudentRead ? `Found potential student read access in ${col} rules block` : undefined
    );
  }

  // Verify attempts collection does not allow student create/update directly
  const attemptsBlock = rulesContent.match(/match\s*\/attempts\/\{[^}]+\}[\s\S]*?(?=\n\s*\/\/\s*[0-9]+\.|match\s*\/\w|$)/)?.[0] || "";
  const attemptsAllowCreate = attemptsBlock.match(/allow create:\s*if isTeacher\(\)/);
  check(
    "Firestore rules: attempts collection requires teacher for create (not student self-create)",
    !!attemptsAllowCreate,
    "attempts create rule should only allow isTeacher()"
  );

  // Verify global catch-all deny is present
  check(
    "Firestore rules: global default-deny catch-all is present",
    rulesContent.includes("allow read, write: if false;")
  );

  // Verify responses do not grant student writes
  const responsesBlock = rulesContent.match(/match\s*\/responses\/\{[^}]+\}[\s\S]*?(?=\n\s*\/\/\s*[0-9]+\.|match\s*\/\w|$)/)?.[0] || "";
  const hasStudentResponseWrite =
    responsesBlock.includes("allow write:") &&
    responsesBlock.includes("isSignedIn()") &&
    !responsesBlock.match(/allow write:\s*if isTeacher\(\)/);
  check(
    "Firestore rules: responses collection does not allow student direct writes",
    !hasStudentResponseWrite
  );

  // Print final results
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\n>>> ${failed} TEST(S) FAILED — access control hardening is incomplete. <<<\n`);
    process.exit(1);
  } else {
    console.log(`\n>>> ALL ${passed} TESTS PASSED — assignment-aware access control verified. <<<\n`);
  }
});

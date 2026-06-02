/**
 * Verification Suite for the Student Allowlist authorization scheme.
 * Verifies email domain matching, teacher roles, allowed student email parsing, and enrollment rules.
 *
 * Run: npx tsx scripts/verify-allowlist.ts
 */

import dotenv from "dotenv";
dotenv.config();

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

// Emulate parsing rules from server.ts
function parseTeacherEmails(envVal: string): Set<string> {
  return new Set(
    (envVal || "stephenborish@gmail.com")
      .split(",")
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseAllowedDomain(envVal: string): string {
  return (envVal || "malvernprep.org").toLowerCase();
}

function parseAuthorizedStudentEmails(envVal: string): Set<string> {
  return new Set(
    (envVal || "")
      .split(",")
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Checks user sign-in eligibility (mimicking getSessionUser / login endpoints)
function canUserSignIn(
  email: string,
  allowedDomain: string,
  teacherEmails: Set<string>,
  authorizedStudentEmails: Set<string>
): boolean {
  const emailLower = email.trim().toLowerCase();
  return emailLower.endsWith(`@${allowedDomain}`) || 
         teacherEmails.has(emailLower) || 
         authorizedStudentEmails.has(emailLower);
}

// Determines the default role assignment for newly created accounts (mimicking server)
function getDefaultRole(
  email: string,
  teacherEmails: Set<string>
): "teacher" | "student" {
  const emailLower = email.trim().toLowerCase();
  return teacherEmails.has(emailLower) ? "teacher" : "student";
}

// Checks if student can enroll / join a course
function canUserJoinCourse(
  email: string,
  allowedDomain: string,
  teacherEmails: Set<string>,
  authorizedStudentEmails: Set<string>
): boolean {
  const emailLower = email.trim().toLowerCase();
  const emailDomain = emailLower.split("@")[1] || "";
  return emailDomain === allowedDomain || 
         teacherEmails.has(emailLower) || 
         authorizedStudentEmails.has(emailLower);
}

async function runTests() {
  console.log("\n========================================================");
  console.log("👉 VERITAS LEARN STUDENT ALLOWLIST VERIFICATION TESTS");
  console.log("========================================================\n");

  // Mock Env vars for testing
  const GOOGLE_ALLOWED_DOMAIN = "malvernprep.org";
  const TEACHER_EMAILS_RAW = "stephenborish@gmail.com,teacher1@malvernprep.org";
  const AUTHORIZED_STUDENT_EMAILS_RAW = "student1@gmail.com, student2@example.com, "; // Includes trailing whitespace/comma

  const domain = parseAllowedDomain(GOOGLE_ALLOWED_DOMAIN);
  const teachers = parseTeacherEmails(TEACHER_EMAILS_RAW);
  const students = parseAuthorizedStudentEmails(AUTHORIZED_STUDENT_EMAILS_RAW);

  // 1. Domain-level student login check
  check(
    "@malvernprep.org user can sign in as student",
    canUserSignIn("student@malvernprep.org", domain, teachers, students) &&
    getDefaultRole("student@malvernprep.org", teachers) === "student"
  );

  // 2. Teacher-only login check
  check(
    "TEACHER_EMAILS user can sign in as teacher",
    canUserSignIn("stephenborish@gmail.com", domain, teachers, students) &&
    getDefaultRole("stephenborish@gmail.com", teachers) === "teacher"
  );

  // 3. Authorized student allowlist login check
  check(
    "AUTHORIZED_STUDENT_EMAILS user can sign in as student",
    canUserSignIn("student1@gmail.com", domain, teachers, students) &&
    getDefaultRole("student1@gmail.com", teachers) === "student"
  );

  check(
    "AUTHORIZED_STUDENT_EMAILS with surrounding spaces parsed correctly",
    students.has("student2@example.com")
  );

  // 4. Unauthorized email is rejected
  check(
    "Random unauthorized email is rejected",
    !canUserSignIn("intruder@gmail.com", domain, teachers, students)
  );

  // 5. Authorized student allowlist cannot escalate to teacher/admin
  check(
    "Authorized student cannot receive teacher privileges",
    getDefaultRole("student1@gmail.com", teachers) !== "teacher"
  );

  // 6. Course join permissions verification
  check(
    "School domain student can join a course",
    canUserJoinCourse("student@malvernprep.org", domain, teachers, students)
  );

  check(
    "Authorized student can join a course",
    canUserJoinCourse("student1@gmail.com", domain, teachers, students)
  );

  check(
    "Teacher can join a course (for cross checks)",
    canUserJoinCourse("stephenborish@gmail.com", domain, teachers, students)
  );

  check(
    "Unauthorized student cannot join a course",
    !canUserJoinCourse("intruder@gmail.com", domain, teachers, students)
  );

  // 7. TEACHER_EMAILS isolation verification
  check(
    "TEACHER_EMAILS is isolated and not needed for external student testers",
    !teachers.has("student1@gmail.com")
  );

  console.log("\n========================================================");
  console.log(`📊 ALLOWLIST TEST SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

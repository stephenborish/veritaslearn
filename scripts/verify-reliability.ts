/**
 * Reliability/data-integrity regression guards.
 *
 * These checks protect invariants that are easy to regress with small route/UI
 * edits: immutable attempt runtime, awaited durable writes for student work,
 * stale-draft protection, and assessment sanitizer hardening.
 */
import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { sanitizeResponseForStudent } from "../server/data/sanitize";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const server = read("server.ts");
const focusedPlayer = read("src/components/StudentPortal/FocusedPlayer.tsx");
const lessonsBuilder = read("src/components/TeacherDashboard/LessonsBuilder.tsx");

function routeBody(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing route marker: ${marker}`);
  const next = source.indexOf("\napp.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

console.log("=== VERITAS Learn: reliability/data-integrity checks ===");

// Immutable runtime blocks: attempts endpoint delivers version-snapshot blocks and
// FocusedPlayer must not fetch mutable live lesson blocks for runtime rendering.
assert(server.includes("function resolveAttemptRuntimeBlocks"), "server must centralize immutable attempt runtime block resolution");
assert(server.includes("function resolveAttemptRuntimeSettings"), "server must centralize immutable attempt runtime settings resolution");
assert(routeBody(server, 'app.get("/api/attempts/:id"').includes("resolveAttemptRuntimeBlocks(attempt, db)"), "attempt detail must include immutable runtime blocks");
assert(routeBody(server, 'app.post("/api/attempts/:id/block"').includes("resolveAttemptRuntimeBlocks(attempt, db)"), "block navigation must validate against immutable runtime blocks");
assert(routeBody(server, 'app.post("/api/attempts/:id/progress"').includes("resolveAttemptRuntimeSettings(attempt, lesson, db)"), "video progress must use immutable runtime settings");
assert(routeBody(server, 'app.post("/api/attempts/:id/block"').includes("resolveAttemptRuntimeSettings(attempt, lesson, db)"), "block navigation must use immutable runtime settings");
assert(!focusedPlayer.includes("/api/lessons/${data.attempt.lessonId}"), "student player must not fetch mutable live lesson blocks");
assert(focusedPlayer.includes("const runtimeBlocks = data.blocks || []"), "student player must render server-supplied attempt runtime blocks");
console.log("  PASS immutable lessonVersionId runtime blocks are enforced for student player/navigation");

// Critical student-work routes must await durable commit before reporting success.
for (const marker of [
  'app.post("/api/attempts/:id/progress"',
  'app.post("/api/attempts/:id/block"',
  'app.post("/api/integrity-signals"',
  'app.post("/api/attempts/:id/unlock"',
]) {
  const body = routeBody(server, marker);
  assert(body.includes("await commitDb(db)"), `${marker} must await commitDb(db)`);
}
console.log("  PASS student progress/navigation/integrity mutations await durable commitDb(db)");

// Draft freshness: server and clients exchange clientUpdatedAt and stale saves are ignored.
assert(routeBody(server, 'app.post("/api/lessons/:lessonId/draft"').includes("staleIgnored"), "lesson draft endpoint must ignore stale client saves");
assert(routeBody(server, 'app.post("/api/attempts/:id/draft"').includes("draftResponseMeta"), "response draft endpoint must track per-question draft freshness metadata");
assert(lessonsBuilder.includes("latestDraftClientUpdatedAtRef"), "lesson builder must ignore stale autosave confirmations");
assert(focusedPlayer.includes("latestDraftClientUpdatedAtRef"), "student player must ignore stale draft confirmations");
console.log("  PASS teacher/student draft autosaves include stale-write protection");

// Completion UI should not exit unless the server confirms durable completion.
assert(focusedPlayer.includes("if (!res.ok || !data.success)"), "completion UI must verify server success before exit");
console.log("  PASS completion UI waits for confirmed server success");

// Assessment sanitizer: even release flags cannot expose assessment score/AI grading.
const releasedAssessment = sanitizeResponseForStudent({
  id: "resp_assess_release_guard",
  type: "sa",
  gradingMode: "assessment",
  feedbackVisibility: "student_visible",
  feedbackReleasedAt: new Date().toISOString(),
  feedbackVisibleToStudent: true,
  responseValue: "student answer",
  score: 9,
  pointsEarned: 9,
  isCorrect: true,
  feedback: "secret feedback",
  studentFacingFeedback: "released feedback",
  aiGrading: {
    status: "success",
    feedback: "secret",
    rationale: "teacher rationale",
    rubricBreakdown: { Accuracy: { score: 4, maxScore: 4, feedback: "secret" } },
    teacherNotes: "teacher only",
  },
});
assert.equal(releasedAssessment.score, undefined, "assessment score must be hidden");
assert.equal(releasedAssessment.pointsEarned, undefined, "assessment points must be hidden");
assert.equal(releasedAssessment.isCorrect, undefined, "assessment correctness must be hidden");
assert.equal(releasedAssessment.aiGrading, undefined, "assessment AI grading must be hidden");
assert.equal(releasedAssessment.feedback, undefined, "assessment feedback must be hidden");
assert.equal(releasedAssessment.studentFacingFeedback, undefined, "assessment student-facing feedback must be hidden until product policy changes");
assert.equal(releasedAssessment.status, "submitted", "assessment should remain submitted-for-review");
console.log("  PASS assessment response sanitizer hides scoring/AI data even with release flags");

console.log("\nAll reliability/data-integrity checks passed.");

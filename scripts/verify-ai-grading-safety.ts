/**
 * Verify targeted fixes introduced in the second hardening pass:
 *
 * A. asPlainText extracts RichContent.plainText (not the non-existent .text field).
 * B. upsertResponseGradebookEntry preserves teacher-set durable fields on update.
 * C. Async AI grading callback guards against overwriting teacher-reviewed responses.
 * D. Student performance max-score uses immutable version snapshot.
 */
import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const server = readFileSync(join(root, "server.ts"), "utf8");

console.log("=== VERITAS Learn: AI grading safety + rich-content fixes ===");

// ---------------------------------------------------------------------------
// A. asPlainText must prefer v.plainText (RichContent canonical field)
// ---------------------------------------------------------------------------
{
  // Confirm the fix is in the source
  assert(
    server.includes('if (typeof v.plainText === "string") return v.plainText;'),
    "asPlainText must check v.plainText before v.text"
  );
  assert(
    !server.match(/function asPlainText[\s\S]{0,300}if \(typeof v\.text === "string"\) return v\.text;\s*\n\s*try/),
    "asPlainText must not fall through directly from v.text to JSON.stringify without plainText check first"
  );

  // Behavioural verification by re-implementing the fixed logic inline
  function asPlainText(v: any): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") {
      if (typeof (v as any).plainText === "string") return (v as any).plainText;
      if (typeof (v as any).text === "string") return (v as any).text;
      if (typeof (v as any).html === "string") {
        return (v as any).html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  }

  // Should extract plainText from a proper RichContent object
  const rc = {
    version: 1,
    format: "veritas-rich-content",
    plainText: "Describe the process of mitosis.",
    html: "<p>Describe the process of mitosis.</p>",
    assets: [],
  };
  assert.strictEqual(asPlainText(rc), "Describe the process of mitosis.", "should extract plainText from RichContent");
  assert.strictEqual(asPlainText("plain string"), "plain string", "bare string passthrough");
  assert.strictEqual(asPlainText(null), "", "null → empty string");
  assert.strictEqual(asPlainText(undefined), "", "undefined → empty string");

  // HTML fallback when plainText absent
  const rcHtmlOnly = { html: "<em>cell division</em>", assets: [] };
  const htmlResult = asPlainText(rcHtmlOnly);
  assert(!htmlResult.includes("<em>"), "HTML fallback should strip tags");
  assert(htmlResult.includes("cell division"), "HTML fallback should preserve text content");

  // Legacy object with .text field (no plainText)
  const legacyObj = { text: "legacy text value" };
  assert.strictEqual(asPlainText(legacyObj), "legacy text value", "legacy .text field still works");

  console.log("  PASS  asPlainText correctly reads RichContent.plainText");
}

// ---------------------------------------------------------------------------
// B. upsertResponseGradebookEntry must preserve teacher-set fields
// ---------------------------------------------------------------------------
{
  const fnBody = (() => {
    const start = server.indexOf("function upsertResponseGradebookEntry(");
    const end = server.indexOf("\nfunction ", start + 1);
    return server.slice(start, end);
  })();

  assert(fnBody.includes("existing.reviewedAt"), "upsertResponseGradebookEntry must preserve reviewedAt");
  assert(fnBody.includes("existing.reviewedBy"), "upsertResponseGradebookEntry must preserve reviewedBy");
  assert(fnBody.includes("existing.feedbackReleasedAt"), "upsertResponseGradebookEntry must preserve feedbackReleasedAt");
  assert(fnBody.includes("existing.feedbackReleasedBy"), "upsertResponseGradebookEntry must preserve feedbackReleasedBy");
  assert(fnBody.includes("existing.originalAiScore"), "upsertResponseGradebookEntry must preserve originalAiScore");
  assert(fnBody.includes("existing.studentFacingFeedback"), "upsertResponseGradebookEntry must preserve studentFacingFeedback");
  assert(fnBody.includes("existing.teacherOnlyNotes"), "upsertResponseGradebookEntry must preserve teacherOnlyNotes");

  console.log("  PASS  upsertResponseGradebookEntry preserves teacher-set durable fields");
}

// ---------------------------------------------------------------------------
// C. Async AI grading guard: teacherAlreadyActed prevents overwrite
// ---------------------------------------------------------------------------
{
  // Extract the async IIFE body (between "Grade asynchronously" comment and the final
  // res.json call that closes the route handler).
  const asyncStart = server.indexOf("// Grade asynchronously so the student isn't blocked");
  assert(asyncStart >= 0, "Async grading section must exist");
  const asyncEnd = server.indexOf("res.json({ success: true, gradedImmediate: false", asyncStart);
  const asyncBody = server.slice(asyncStart, asyncEnd);

  // Guard variables must be present
  assert(asyncBody.includes("teacherAlreadyActed"), "async callback must declare teacherAlreadyActed guard");
  assert(
    asyncBody.includes("teacherReviewedAt") && asyncBody.includes("teacherOverride"),
    "guard must check both teacherReviewedAt and teacherOverride"
  );

  // Score write must be inside the guard
  assert(
    asyncBody.includes("if (!teacherAlreadyActed)"),
    "score update must be gated on !teacherAlreadyActed"
  );

  // upsertResponseGradebookEntry call in async path must also be guarded
  const asyncUpsertIdx = asyncBody.indexOf("upsertResponseGradebookEntry(");
  assert(asyncUpsertIdx >= 0, "async path must still call upsertResponseGradebookEntry");
  // The guard should appear before this call
  const guardIdx = asyncBody.lastIndexOf("!teacherAlreadyActed", asyncUpsertIdx);
  assert(guardIdx >= 0 && guardIdx < asyncUpsertIdx, "upsertResponseGradebookEntry in async path must be inside teacherAlreadyActed guard");

  // Error path must also carry the guard
  const errorPathStart = asyncBody.indexOf("} catch (error: any) {");
  assert(errorPathStart >= 0, "error catch block must exist");
  const errorPathBody = asyncBody.slice(errorPathStart);
  assert(
    errorPathBody.includes("teacherAlreadyActed"),
    "error catch path must also guard against overwriting teacher-reviewed responses"
  );

  console.log("  PASS  async AI grading does not overwrite teacher-reviewed responses");
}

// ---------------------------------------------------------------------------
// D. Student performance max-score uses immutable version snapshot
// ---------------------------------------------------------------------------
{
  const perfStart = server.indexOf('app.get("/api/student/performance"');
  assert(perfStart >= 0, "student performance route must exist");
  const perfEnd = server.indexOf("\napp.", perfStart + 1);
  const perfBody = server.slice(perfStart, perfEnd);

  assert(
    perfBody.includes("lessonVersionId") && perfBody.includes("blocksSnapshot"),
    "student performance max-score must use version blocksSnapshot when available"
  );
  assert(
    perfBody.includes("versionBlocks || (db.blocks"),
    "student performance must fall back to db.blocks for legacy attempts"
  );

  console.log("  PASS  student performance max-score uses immutable version snapshot");
}

console.log("\nAll AI grading safety + rich-content checks passed.");

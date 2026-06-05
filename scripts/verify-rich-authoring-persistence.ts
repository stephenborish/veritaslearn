/**
 * Verification: unified rich-text authoring persistence contract.
 *
 * Guards the fix for the bug class "teacher-authored rich-text fields are not
 * reliably saved, preserved, or reloaded across the Lesson Designer".
 *
 * ROOT CAUSE: top-level lesson rich-text fields (notably `description`) lived in
 * plain React state only. Snapshots, autosave, local recovery, and Save/Publish
 * read those values from a React closure that could be STALE relative to the
 * teacher's most recent keystrokes (RichContentEditor emits onChange
 * synchronously, but setState is async). Nested block/question/checkpoint/choice
 * fields were already protected by `setCurrentBlocksLive` / `currentBlocksRef`.
 *
 * FIX: a unified live-state contract. Top-level fields now use `useLiveState`,
 * which keeps a synchronously-updated ref alongside React state; every snapshot /
 * save / autosave / recovery read pulls from the live refs. RichContentEditor's
 * initial mount can no longer clobber a non-empty parent value with empty/stale
 * content, and exposes an explicit flush hook.
 *
 * These checks are intentionally static (source-pattern) so they are fast,
 * dependency-free, and fail loudly if a future edit reintroduces a stale path.
 */

import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const builder = read("src/components/TeacherDashboard/LessonsBuilder.tsx");
const questionEditor = read("src/components/TeacherDashboard/QuestionEditor.tsx");
const editor = read("src/components/RichContent/RichContentEditor.tsx");
const migration = read("src/components/RichContent/richContentMigration.ts");
const sanitize = read("server/data/sanitize.ts");

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean, message?: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}: ${message || "assertion failed"}`);
  }
}

console.log("\n========================================================");
console.log("👉 VERITAS LEARN RICH-AUTHORING PERSISTENCE TESTS");
console.log("========================================================\n");

// ---------------------------------------------------------------------------
console.log("A. Unified live-state infrastructure (top-level fields)");
// ---------------------------------------------------------------------------
assert(
  "useLiveState hook is declared",
  /function useLiveState<T>\(/.test(builder),
  "expected a useLiveState<T> helper in LessonsBuilder"
);
assert(
  "useLiveState updates the ref synchronously before setState",
  /ref\.current = value;\s*setState\(value\);/.test(builder)
);
for (const field of [
  "title",
  "description",
  "estimatedMinutes",
  "isPublished",
  "restrictSeeking",
  "requireFullscreen",
  "allowRetakes",
  "randomizeChoices",
  "immediateFeedback",
]) {
  assert(
    `top-level field "${field}" uses useLiveState (state + setter + ref)`,
    new RegExp(`\\[${field},\\s*set\\w+,\\s*${field}Ref\\]\\s*=\\s*useLiveState`).test(builder)
  );
}

// ---------------------------------------------------------------------------
console.log("\nB. All RichContentEditor usages routed through live-safe paths");
// ---------------------------------------------------------------------------
// LessonsBuilder must never push rich-text directly into the non-live setState.
// The ONLY legitimate raw `setCurrentBlocks(` call is inside the setCurrentBlocksLive
// helper itself; every handler/payload must go through setCurrentBlocksLive /
// currentBlocksRef. So exactly one raw occurrence is expected.
const rawSetCurrentBlocks = (builder.match(/setCurrentBlocks\(/g) || []).length;
assert(
  "LessonsBuilder routes block updates through setCurrentBlocksLive (only the helper calls setCurrentBlocks directly)",
  rawSetCurrentBlocks === 1,
  `expected exactly 1 raw setCurrentBlocks( (inside the helper), found ${rawSetCurrentBlocks}`
);
assert(
  "Description editor commits through the live setter (setDescription)",
  /value=\{description\}[\s\S]{0,160}onChange=\{\(val: any\) => setDescription\(val\)\}/.test(builder)
);
assert(
  "Reading content editor commits through onBlockChange",
  /onChange=\{\(val: any\) => onBlockChange\(index, "content", val\)\}/.test(builder)
);
// QuestionEditor: every rich field flows through the functional patch/patchWith
// helpers, which call the parent onChange with an updater (→ setCurrentBlocksLive).
assert(
  "QuestionEditor.patch uses a functional updater into parent onChange",
  /const patch = \(partial: any\) => onChange\(\(latestQuestion: AnyQuestion\) =>/.test(questionEditor)
);
assert(
  "QuestionEditor.patchWith uses a functional updater into parent onChange",
  /const patchWith = \(updater[\s\S]{0,80}onChange\(\(latestQuestion: AnyQuestion\) => updater/.test(questionEditor)
);

// ---------------------------------------------------------------------------
console.log("\nC. Per-field latest-state protection");
// ---------------------------------------------------------------------------
// 2. Description
assert("(2) Description: live ref declared", /descriptionRef/.test(builder));
// 3. Reading content
assert("(3) Reading content routed via setCurrentBlocksLive", /handleBlockChange[\s\S]{0,120}setCurrentBlocksLive/.test(builder));
// 4/5. MC stem & SA prompt (shared stem field)
assert("(4/5) Question stem/prompt: patch({ stem: val })", /onChange=\{\(val\) => patch\(\{ stem: val \}\)\}/.test(questionEditor));
// 6. Student instructions
assert("(6) Student instructions: patch({ studentInstructions: val })", /patch\(\{ studentInstructions: val \}\)/.test(questionEditor));
// 7. Explanation / practice feedback
assert("(7) Explanation: patch({ explanation: val })", /patch\(\{ explanation: val \}\)/.test(questionEditor));
// 8. MC answer choice rich text
assert("(8) MC answer choice: updateChoiceContent via patchWith", /const updateChoiceContent = \(id: string, content: any\) => patchWith/.test(questionEditor));
// 9. Model answer
assert("(9) Model answer: patch({ modelAnswer: val })", /patch\(\{ modelAnswer: val \}\)/.test(questionEditor));
// 10. AI scoring guidance
assert("(10) AI scoring guidance: patch({ aiScoringGuidance: val })", /patch\(\{ aiScoringGuidance: val \}\)/.test(questionEditor));
// 11. Rubric description
assert("(11) Rubric description: updateRubric via patchWith", /const updateRubric = \(id: string, partial: any\) => patchWith/.test(questionEditor) && /updateRubric\(r\.id, \{ description: val \}\)/.test(questionEditor));
// 12. Teacher notes
assert("(12) Teacher notes: patch({ teacherNotes: val })", /patch\(\{ teacherNotes: val \}\)/.test(questionEditor));
// 13/14. Video checkpoint question + choices
assert("(13/14) Checkpoint question routed via setCurrentBlocksLive (functional)", /updateCheckpointQuestion = \([\s\S]{0,160}setCurrentBlocksLive/.test(builder));
assert("(13/14) Checkpoint question editor wired to updateCheckpointQuestion", /onChange=\{\(uq\) => updateCheckpointQuestion\(index, cp\.id, uq\)\}/.test(builder));

// ---------------------------------------------------------------------------
console.log("\nD. Save / autosave / recovery / snapshot read authoritative refs");
// ---------------------------------------------------------------------------
// 15/16. Save Draft + Publish share saveWithPublishedStatus → ref-based payload
assert(
  "(15/16) Save/Publish payload reads description from descriptionRef.current",
  /const payload = \{[\s\S]{0,400}description: descriptionRef\.current/.test(builder)
);
assert(
  "(15/16) Save/Publish payload reads title from titleRef.current",
  /title: titleRef\.current/.test(builder)
);
assert(
  "(15/16) Save/Publish payload reads blocks from currentBlocksRef.current",
  /blocks: currentBlocksRef\.current/.test(builder)
);
// 17. Autosave payload reads refs at fire time
assert(
  "(17) Autosave reads description from descriptionRef.current at fire time",
  /const capturedDescription = descriptionRef\.current;/.test(builder)
);
assert(
  "(17) Autosave reads blocks from currentBlocksRef.current at fire time",
  /const capturedBlocks = currentBlocksRef\.current;/.test(builder)
);
// 18. Local recovery draft reads refs
assert(
  "(18) Local recovery draft reads description from descriptionRef.current",
  /localStorage\.setItem\([\s\S]{0,260}description: descriptionRef\.current/.test(builder)
);
// 19. Dirty snapshot reads refs
assert(
  "(19) getSnapshot reads description from descriptionRef.current",
  /const getSnapshot = \(\) => JSON\.stringify\(\{[\s\S]{0,400}description: descriptionRef\.current/.test(builder)
);
assert(
  "(19) getSnapshot reads blocks from currentBlocksRef.current",
  /getSnapshot[\s\S]{0,500}currentBlocks: currentBlocksRef\.current/.test(builder)
);

// ---------------------------------------------------------------------------
console.log("\nE. Restore paths sync BOTH React state and live refs");
// ---------------------------------------------------------------------------
// useLiveState setters update the ref synchronously, so any setDescription call in
// a restore path syncs the ref too. Verify each restore path calls setDescription.
for (const path of [
  { name: "startEditing", anchor: "const startEditing" },
  { name: "startNewLesson", anchor: "const startNewLesson" },
  { name: "handleRestoreDraft (local)", anchor: "const handleRestoreDraft" },
  { name: "handleRestoreServerDraft (server)", anchor: "const handleRestoreServerDraft" },
]) {
  const idx = builder.indexOf(path.anchor);
  const slice = idx !== -1 ? builder.slice(idx, idx + 1200) : "";
  assert(`(20) ${path.name} restores description via live setter`, /setDescription\(/.test(slice));
}
assert(
  "(20) post-save canonical reload re-syncs description via live setter",
  /setDescription\(savedResult\.description \?\? descriptionRef\.current\)/.test(builder)
);

// ---------------------------------------------------------------------------
console.log("\nF. RichContentEditor mount / shape hardening");
// ---------------------------------------------------------------------------
// 21. Initial mount cannot clobber non-empty values with empty/stale content.
assert("(21) initial-emit guard ref exists", /initialEmitGuardRef = useRef\(true\)/.test(editor));
assert(
  "(21) initial empty/mirrored onChange is suppressed (no clobber)",
  /if \(initialEmitGuardRef\.current\)[\s\S]{0,400}strippedText === ''[\s\S]{0,200}return;/.test(editor)
);
assert(
  "(21) focused external value updates are still suppressed",
  /if \(isFocused && !docKeyChanged\)\s*\{\s*return;/.test(editor)
);
// 22. RichContent object shape preserved (html / plainText / lexicalJson).
assert(
  "(22) onChange emits html + plainText + lexicalJson",
  /html: cleanHtml,[\s\S]{0,80}plainText:[\s\S]{0,120}lexicalJson: editorState\.toJSON\(\)/.test(editor)
);
assert(
  "(22) migration preserves lexicalJson on object input",
  /lexicalJson: obj\.lexicalJson \|\| null/.test(migration)
);
// 23. Legacy string / html-only fields still load.
assert(
  "(23) migration handles plain-string / html-only legacy input",
  /if \(asString\.trim\(\)\.startsWith\('<'\)\)/.test(migration) &&
    /applyLegacyMarkdownConversion\(asString\)/.test(migration)
);
// 6 (no-debounce). Ensure we did not reintroduce a debounce timer in the editor onChange.
assert(
  "(no-debounce) editor onChange path has no setTimeout debounce around emit",
  !/onEditorChange[\s\S]{0,200}setTimeout/.test(editor)
);
// flush mechanism available
assert("(flush) explicit flush hook is wired", /flushRef\.current = \(\) =>/.test(editor));

// ---------------------------------------------------------------------------
console.log("\nG. Student-facing sanitization NOT weakened");
// ---------------------------------------------------------------------------
for (const secret of [
  "correctChoiceId",
  "explanation",
  "rubricCategories",
  "modelAnswer",
  "aiScoringGuidance",
  "teacherNotes",
]) {
  assert(`(24) SECRET_QUESTION_FIELDS still strips "${secret}"`, new RegExp(`"${secret}"`).test(sanitize.slice(sanitize.indexOf("SECRET_QUESTION_FIELDS"), sanitize.indexOf("SECRET_QUESTION_FIELDS") + 320)));
}
assert(
  "(24) sanitizeQuestionForStudent only returns student-safe fields",
  /const safe: any = \{\s*id: q\.id,\s*type:[\s\S]{0,120}stem: q\.stem,\s*points: q\.points,/.test(sanitize)
);
assert(
  "(24) student sanitizer preserves rich stem/choice text (not stringified)",
  /safe\.choices = sourceChoices\.map\([\s\S]{0,140}text: c\.text/.test(sanitize)
);

// ---------------------------------------------------------------------------
console.log("\nH. Existing currentBlocks persistence protections intact");
// ---------------------------------------------------------------------------
// 25.
assert("(25) currentBlocksRef declared", /currentBlocksRef = useRef<any\[\]>/.test(builder));
assert("(25) setCurrentBlocksLive declared", /const setCurrentBlocksLive/.test(builder));
assert("(25) save payload still uses currentBlocksRef.current", /blocks: currentBlocksRef\.current/.test(builder));

console.log("\n========================================================");
console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed.`);
console.log("========================================================\n");

process.exit(failed === 0 ? 0 : 1);
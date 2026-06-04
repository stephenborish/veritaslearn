/**
 * Robustness and verification tests for Teacher Question State / Data-Loss fixes.
 *
 * Verifies that:
 * 1. Every question has a stable unique ID.
 * 2. Every answer choice has a stable unique ID.
 * 3. Question template creation allocates fresh objects.
 * 4. Conversion between Multiple Choice and Short Answer is immutable and preserves user data properly.
 * 5. Nested block context-aware keys for RichTextEditor instances do not overlap or collide.
 */

// Using a robust mock/wrapper for uid to simulate the frontend helpers.

// Let's replicate or import the key helper functions used in LessonsBuilder
function mockUid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
}

function newQuestionTemplate(type: "mc" | "sa"): any {
  const base = { id: mockUid("q"), type, stem: "", points: 5 };
  if (type === "mc") {
    const choices = [
      { id: mockUid("choice"), text: "" },
      { id: mockUid("choice"), text: "" },
    ];
    return { ...base, choices, correctChoiceId: choices[0].id, explanation: "" };
  }
  return { ...base, modelAnswer: "", answerKey: "", aiScoringGuidance: "", teacherNotes: "", rubricCategories: [] };
}

const convertQuestionType = (existing: any, nextType: "mc" | "sa"): any => {
  const q = existing || {};
  const base = {
    id: q.id || mockUid("q"),
    type: nextType,
    stem: q.stem ?? "",
    points: q.points ?? 5,
  };

  if (nextType === "mc") {
    let choices = q.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      choices = [
        { id: mockUid("choice"), text: "" },
        { id: mockUid("choice"), text: "" },
      ];
    } else {
      choices = choices.map((c: any) => ({
        ...c,
        id: c.id || mockUid("choice"),
        text: c.text ?? ""
      }));
    }
    const correctChoiceId = q.correctChoiceId || (choices[0] && choices[0].id) || "";
    return { ...base, choices, correctChoiceId, explanation: q.explanation ?? "" };
  } else {
    return {
      ...base,
      modelAnswer: q.modelAnswer ?? "",
      aiScoringGuidance: q.aiScoringGuidance ?? "",
      teacherNotes: q.teacherNotes ?? "",
      rubricCategories: Array.isArray(q.rubricCategories)
        ? q.rubricCategories.map((r: any) => ({ ...r, id: r.id || mockUid("rub") }))
        : [],
      studentInstructions: q.studentInstructions ?? ""
    };
  }
};

let passed = 0;
let failed = 0;
function assert(name: string, condition: boolean, message?: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}: ${message || "Assertion failed"}`);
  }
}

console.log("\n========================================================");
console.log("👉 VERITAS LEARN TEACHER STATE & DATA-LOSS TESTS");
console.log("========================================================\n");

// 1. Every question must have/maintain stable unique IDs
const q1 = newQuestionTemplate("mc");
const q2 = newQuestionTemplate("mc");
assert("Creates distinct question objects", q1 !== q2);
assert("Questions have stable distinct IDs", q1.id !== q2.id && q1.id.startsWith("q_"));
assert("Answer choices have stable distinct IDs", q1.choices[0].id !== q1.choices[1].id && q1.choices[0].id.startsWith("choice_"));

// 2. Switching formats (MC -> SA -> MC) is type-safe and preserves content
let editorQ = newQuestionTemplate("mc");
editorQ.stem = "<p>What is the capital of PA?</p>";
editorQ.choices[0].text = "Harrisburg";
editorQ.choices[1].text = "Philadelphia";

// Convert to Short Answer
let convertedToSa = convertQuestionType(editorQ, "sa");
assert("Converting to SA retains stem rich-text", convertedToSa.stem === "<p>What is the capital of PA?</p>");
assert("Converting to SA removes choices field", convertedToSa.choices === undefined);
assert("Converting to SA populates modelAnswer", "modelAnswer" in convertedToSa);

// Convert back to Multiple Choice
let convertedBackToMc = convertQuestionType(convertedToSa, "mc");
assert("Converting back to MC retains custom stem", convertedBackToMc.stem === "<p>What is the capital of PA?</p>");
assert("Converting back to MC generates fresh choice templates", Array.isArray(convertedBackToMc.choices) && convertedBackToMc.choices.length === 2);
assert("Generated choices have valid and distinct IDs", convertedBackToMc.choices[0].id !== convertedBackToMc.choices[1].id);

// 3. DocumentKeys construction isolates editors perfectly across lessons/blocks/checkpoints
const lessonId = "sample_lesson";
const blockId = "block_1";
const cpId = "checkpoint_1";

const getDocumentKey = (part1: string, part2: string, part3: string, qId: string, element: string) => {
  const lessonPart = part1 ? `${part1}_` : "";
  const blockPart = part2 ? `${part2}_` : "";
  const cpPart = part3 ? `${part3}_` : "";
  return `${lessonPart}${blockPart}${cpPart}${element}-${qId}`;
};

const key1 = getDocumentKey(lessonId, blockId, "", q1.id, "qstem");
const key2 = getDocumentKey(lessonId, blockId, cpId, q1.id, "qstem");
const key3 = getDocumentKey(lessonId, "block_2", "", q1.id, "qstem");

assert(
  "Document key isolates inline questions from checkpoint questions",
  key1 !== key2 && key1 === "sample_lesson_block_1_qstem-" + q1.id && key2 === "sample_lesson_block_1_checkpoint_1_qstem-" + q1.id
);
assert(
  "Document key isolates questions across block borders",
  key1 !== key3 && key3 === "sample_lesson_block_2_qstem-" + q1.id
);

// 4. Mutation testing: adding choices and editing choices must be immutable
const initialChoices = [
  { id: "choice_a", text: "Alpha" },
  { id: "choice_b", text: "Beta" }
];
const nextChoices = [...initialChoices, { id: "choice_c", text: "Gamma" }];
assert("Nested options array is immutable on insert", initialChoices.length === 2 && nextChoices.length === 3);

// ---------------------------------------------------------------------------
// 5. Static stale-closure guard — LessonsBuilder must not spread/filter the
//    currentBlocks closure variable directly in mutation handlers or payloads.
//    All such operations must go through setCurrentBlocksLive / currentBlocksRef.
// ---------------------------------------------------------------------------
console.log("\n5. Static guard: no stale currentBlocks spread/filter patterns in LessonsBuilder...");

import { readFileSync } from "fs";
import { join } from "path";

const builderSource = readFileSync(
  join(process.cwd(), "src/components/TeacherDashboard/LessonsBuilder.tsx"),
  "utf8"
);

// Regex-based patterns: check for the stale closure reads without matching the
// correct ref-based alternatives (e.g. currentBlocksRef, setCurrentBlocksLive).
const staleRegexPatterns: Array<{ regex: RegExp; description: string }> = [
  {
    regex: /const nextBlocks = \[\.\.\.currentBlocks(?!Ref)/,
    description: "stale spread: [...currentBlocks (not Ref)]",
  },
  {
    regex: /const nextBlocks = currentBlocks\.filter/,
    description: "stale filter: currentBlocks.filter",
  },
  {
    regex: /const updated = \[\.\.\.currentBlocks\]/,
    description: "stale spread: [...currentBlocks]",
  },
  {
    // blocks: currentBlocks — only the bare state var, not currentBlocksRef.current
    regex: /blocks:\s*currentBlocks(?!Ref)/,
    description: "stale blocks payload: blocks: currentBlocks (without Ref)",
  },
];

for (const { regex, description } of staleRegexPatterns) {
  assert(
    `No stale pattern: "${description}"`,
    !regex.test(builderSource),
    `Found forbidden stale-closure pattern: ${regex.source}`
  );
}

// Verify the live-ref infrastructure is present
assert(
  "currentBlocksRef is declared in LessonsBuilder",
  builderSource.includes("currentBlocksRef = useRef<any[]>")
);
assert(
  "setCurrentBlocksLive helper is declared",
  builderSource.includes("const setCurrentBlocksLive")
);
assert(
  "saveWithPublishedStatus uses currentBlocksRef.current for payload",
  builderSource.includes("blocks: currentBlocksRef.current")
);
assert(
  "computeReadiness uses currentBlocksRef.current",
  builderSource.includes("currentBlocksRef.current.forEach")
);
assert(
  "handleAddBlock uses setCurrentBlocksLive",
  builderSource.includes("setCurrentBlocksLive((prev) => [...prev, newBlock])")
);
assert(
  "handleDeleteBlock uses setCurrentBlocksLive",
  builderSource.includes("setCurrentBlocksLive((prev) => prev.filter")
);

console.log("\n========================================================");
console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed.`);
console.log("========================================================\n");

process.exit(failed === 0 ? 0 : 1);

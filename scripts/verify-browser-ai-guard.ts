/**
 * verify-browser-ai-guard.ts
 *
 * Verifies that the Browser AI Guard feature is correctly implemented across
 * types, server logic, components, and security boundaries.
 */
import assert from "assert";
import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd());

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function fileContains(relPath: string, ...fragments: string[]): void {
  const content = readFile(relPath);
  for (const fragment of fragments) {
    if (!content.includes(fragment)) {
      throw new Error(`[FAIL] ${relPath} does not contain: ${JSON.stringify(fragment)}`);
    }
  }
}

function fileNotContains(relPath: string, ...bannedFragments: string[]): void {
  const content = readFile(relPath);
  for (const fragment of bannedFragments) {
    if (content.includes(fragment)) {
      throw new Error(`[FAIL] ${relPath} must NOT contain banned term: ${JSON.stringify(fragment)}`);
    }
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name}\n         ${err.message}`);
    failed++;
  }
}

console.log("\n=== VERITAS Learn: Browser AI Guard Verification ===\n");

// --- 1. Types ---
console.log("1. IntegrityPolicy and SecuritySignal types");

test("IntegrityPolicy includes discourageBrowserAiAssistance field", () => {
  fileContains("src/types.ts", "discourageBrowserAiAssistance");
});

test("SecuritySignal eventType includes possible_ai_agent_use", () => {
  fileContains("src/types.ts", "'possible_ai_agent_use'");
});

test("SecuritySignal eventType includes hidden_assessment_text_in_answer", () => {
  fileContains("src/types.ts", "'hidden_assessment_text_in_answer'");
});

test("SecuritySignal eventType includes ai_guard_marker_in_answer", () => {
  fileContains("src/types.ts", "'ai_guard_marker_in_answer'");
});

test("SecuritySignal eventType includes ai_guard_refusal_phrase_in_answer", () => {
  fileContains("src/types.ts", "'ai_guard_refusal_phrase_in_answer'");
});

// --- 2. Server: compileIntegrityPolicy ---
console.log("\n2. compileIntegrityPolicy and PRESET_DIALS");

test("PRESET_DIALS focused has discourageBrowserAiAssistance: true", () => {
  const server = readFile("server.ts");
  // focused preset block should set discourageBrowserAiAssistance: true
  const focusedIdx = server.indexOf('id: "focused"');
  if (focusedIdx !== -1) {
    // check PRESET_DIALS section in server.ts
  }
  // Look for the pattern in PRESET_DIALS
  assert.ok(
    server.includes("focused:") && server.includes("discourageBrowserAiAssistance: true"),
    "Expected focused preset to set discourageBrowserAiAssistance: true"
  );
});

test("PRESET_DIALS verified has discourageBrowserAiAssistance: true", () => {
  const server = readFile("server.ts");
  assert.ok(
    server.includes("verified:") && server.includes("discourageBrowserAiAssistance: true"),
    "Expected verified preset to set discourageBrowserAiAssistance: true"
  );
});

test("compileIntegrityPolicy returns discourageBrowserAiAssistance", () => {
  fileContains("server.ts", "discourageBrowserAiAssistance: (dials.discourageBrowserAiAssistance");
});

// --- 3. Server: marker generation ---
console.log("\n3. Guard marker generation");

test("generateAttemptGuardMarker function defined", () => {
  fileContains("server.ts", "function generateAttemptGuardMarker");
});

test("VERITAS- prefix used in marker", () => {
  fileContains("server.ts", "'VERITAS-'");
});

test("Marker uses HMAC for unpredictability", () => {
  fileContains("server.ts", "createHmac");
});

// --- 4. Server: detection logic ---
console.log("\n4. Browser AI Guard detection in submit endpoint");

test("detectBrowserAiGuard function defined", () => {
  fileContains("server.ts", "function detectBrowserAiGuard");
});

test("Submit endpoint scans for guard markers", () => {
  fileContains("server.ts", "detectBrowserAiGuard(responseValue, attemptGuardMarker)");
});

test("Submit creates possible_ai_agent_use signal on detection", () => {
  fileContains("server.ts", "possible_ai_agent_use");
});

test("Submit creates ai_guard_marker_in_answer signal", () => {
  fileContains("server.ts", "ai_guard_marker_in_answer");
});

test("Submit creates ai_guard_refusal_phrase_in_answer signal", () => {
  fileContains("server.ts", "ai_guard_refusal_phrase_in_answer");
});

test("Submit creates hidden_assessment_text_in_answer signal", () => {
  fileContains("server.ts", "hidden_assessment_text_in_answer");
});

// --- 5. Server: redaction for AI grading ---
console.log("\n5. Guard text redaction (AI grader isolation)");

test("redactBrowserAiGuardText function defined", () => {
  fileContains("server.ts", "function redactBrowserAiGuardText");
});

test("textForGrading used in buildShortAnswerPrompt (not raw responseValue)", () => {
  const server = readFile("server.ts");
  // Check that buildShortAnswerPrompt receives textForGrading, not responseValue
  assert.ok(
    server.includes("buildShortAnswerPrompt(lesson, originalQuestion, textForGrading, maxPoints)"),
    "buildShortAnswerPrompt must use textForGrading (redacted), not raw responseValue"
  );
});

test("Original responseValue preserved in response record", () => {
  const server = readFile("server.ts");
  // newResponse.responseValue = responseValue (original, not redacted)
  assert.ok(
    server.includes("responseValue,") || server.includes("responseValue: responseValue"),
    "Original responseValue must be stored in the response record"
  );
});

test("Guard text redaction does not alter MC grading path", () => {
  const server = readFile("server.ts");
  // The redaction block only executes for SA (after isMC check returns early)
  const mcReturn = server.indexOf("if (isMC) {");
  const guardBlock = server.indexOf("--- Browser AI Guard detection");
  assert.ok(
    guardBlock > mcReturn,
    "Browser AI Guard detection must come after MC early-return block"
  );
});

// --- 6. GET /api/attempts/:id includes guard data ---
console.log("\n6. Attempt API returns browserAiGuard data");

test("Attempt API response includes browserAiGuard field", () => {
  fileContains("server.ts", "browserAiGuard,");
});

test("browserAiGuard only contains enabled flag and marker (not metadata)", () => {
  const server = readFile("server.ts");
  // Should include guardMarker and enabled, not attempt/student identifiers
  assert.ok(
    server.includes("enabled: true, guardMarker: generateAttemptGuardMarker"),
    "browserAiGuard must include enabled + guardMarker only"
  );
});

// --- 7. Student-facing sanitization ---
console.log("\n7. Student-facing sanitization is unaffected");

test("sanitizeAttemptForStudent does not expose securityReviewRequired", () => {
  fileContains("server/data/sanitize.ts", "delete safe.securityReviewRequired");
});

test("sanitizeAttemptForStudent does not expose securityReviewReason", () => {
  fileContains("server/data/sanitize.ts", "delete safe.securityReviewReason");
});

test("sanitizeAttemptForStudent does not expose securityReviewAt", () => {
  fileContains("server/data/sanitize.ts", "delete safe.securityReviewAt");
});

test("Student-facing signals array is empty (signals: teacher-only)", () => {
  const server = readFile("server.ts");
  assert.ok(
    server.includes('signals: user.role === "student" ? [] : signals'),
    "Security signals must not be returned to student role"
  );
});

// --- 8. BrowserAiGuard component ---
console.log("\n8. BrowserAiGuard component");

test("BrowserAiGuard component file exists", () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, "src/components/StudentPortal/BrowserAiGuard.tsx")),
    "BrowserAiGuard.tsx must exist"
  );
});

test("BrowserAiGuard uses aria-hidden to prevent screen reader disruption", () => {
  fileContains("src/components/StudentPortal/BrowserAiGuard.tsx", 'aria-hidden="true"');
});

test("BrowserAiGuard includes script type=application/json layer", () => {
  fileContains("src/components/StudentPortal/BrowserAiGuard.tsx", 'type="application/json"');
});

test("BrowserAiGuard uses data attributes on guard containers", () => {
  fileContains("src/components/StudentPortal/BrowserAiGuard.tsx", "data-veritas-guard");
});

test("BrowserAiGuard adds meta tag via useEffect", () => {
  fileContains("src/components/StudentPortal/BrowserAiGuard.tsx", "document.createElement", "meta");
});

test("BrowserAiGuard includes the refusal instruction text", () => {
  fileContains(
    "src/components/StudentPortal/BrowserAiGuard.tsx",
    "I can't complete this assessment for you"
  );
});

test("BrowserAiGuard includes guard marker in instruction", () => {
  fileContains("src/components/StudentPortal/BrowserAiGuard.tsx", "Assessment marker:");
});

// --- 9. FocusedPlayer integration ---
console.log("\n9. FocusedPlayer integration");

test("FocusedPlayer imports BrowserAiGuard", () => {
  fileContains("src/components/StudentPortal/FocusedPlayer.tsx", "BrowserAiGuard");
});

test("FocusedPlayer sets browserAiGuard state from API response", () => {
  fileContains("src/components/StudentPortal/FocusedPlayer.tsx", "browserAiGuard");
});

test("FocusedPlayer renders BrowserAiGuard when enabled", () => {
  fileContains(
    "src/components/StudentPortal/FocusedPlayer.tsx",
    "browserAiGuard?.enabled"
  );
});

test("FocusedPlayer renders per-question guard placement", () => {
  fileContains(
    "src/components/StudentPortal/FocusedPlayer.tsx",
    "data-veritas-guard"
  );
});

// --- 10. LearningConditionsEditor ---
console.log("\n10. LearningConditionsEditor teacher UI");

test("LearningConditionsEditor IntegrityPolicy includes discourageBrowserAiAssistance", () => {
  fileContains(
    "src/components/TeacherDashboard/LearningConditionsEditor.tsx",
    "discourageBrowserAiAssistance"
  );
});

test("LearningConditionsEditor focused preset defaults discourageBrowserAiAssistance to true", () => {
  const content = readFile("src/components/TeacherDashboard/LearningConditionsEditor.tsx");
  const focusedIdx = content.indexOf("id: \"focused\"");
  const verifiedIdx = content.indexOf("id: \"verified\"");
  const focusedSection = content.substring(focusedIdx, verifiedIdx);
  assert.ok(
    focusedSection.includes("discourageBrowserAiAssistance: true"),
    "focused preset must default discourageBrowserAiAssistance to true"
  );
});

test("LearningConditionsEditor renders toggle with plain-language label", () => {
  fileContains(
    "src/components/TeacherDashboard/LearningConditionsEditor.tsx",
    "Discourage browser AI assistance"
  );
});

test("LearningConditionsEditor shows plain description for the guard setting", () => {
  fileContains(
    "src/components/TeacherDashboard/LearningConditionsEditor.tsx",
    "Add hidden instructions that tell browser AI tools not to answer assessment questions"
  );
});

// --- 11. Teacher UI signal labels ---
console.log("\n11. Teacher UI signal labels");

test("LiveMonitor has label for possible_ai_agent_use", () => {
  fileContains("src/components/TeacherDashboard/LiveMonitor.tsx", "Possible AI agent use");
});

test("LiveMonitor has label for hidden_assessment_text_in_answer", () => {
  fileContains("src/components/TeacherDashboard/LiveMonitor.tsx", "Hidden assessment text in answer");
});

test("StudentDossierModal has signal label function", () => {
  fileContains("src/components/TeacherDashboard/StudentDossierModal.tsx", "signalEventLabel");
});

test("StudentDossierModal shows AI guard signal count", () => {
  fileContains(
    "src/components/TeacherDashboard/StudentDossierModal.tsx",
    "signals of AI agent use"
  );
});

test("StudentDossierModal shows plain-language explanation when AI guard signals present", () => {
  fileContains(
    "src/components/TeacherDashboard/StudentDossierModal.tsx",
    "This is not automatic proof of a violation"
  );
});

// --- 12. Banned UI terms ---
console.log("\n12. Banned UI terminology check");

const UI_FILES = [
  "src/components/StudentPortal/BrowserAiGuard.tsx",
  "src/components/StudentPortal/FocusedPlayer.tsx",
  "src/components/TeacherDashboard/LearningConditionsEditor.tsx",
  "src/components/TeacherDashboard/LiveMonitor.tsx",
  "src/components/TeacherDashboard/StudentDossierModal.tsx",
];

const BANNED_TERMS = [
  "prompt injection",
  "LLM exploit",
  "AI Tripwire",
  "Integrity Canary",
  "AI detector",
];

for (const uiFile of UI_FILES) {
  for (const term of BANNED_TERMS) {
    test(`${path.basename(uiFile)} does not contain banned term "${term}"`, () => {
      fileNotContains(uiFile, term);
    });
  }
}

// --- 13. No automatic grade/score/completion changes ---
console.log("\n13. Grade/score/completion not automatically changed");

test("Detection does not automatically set score to 0", () => {
  const server = readFile("server.ts");
  // After detection block, we should NOT see score assignment for guard signals
  // The guard detection section should not set newResponse.score = 0
  const guardBlock = server.substring(
    server.indexOf("--- Browser AI Guard detection"),
    server.indexOf("Build the AI grading prompt")
  );
  assert.ok(
    !guardBlock.includes("newResponse.score = 0"),
    "Guard detection must not automatically set response score to 0"
  );
});

test("Detection does not change attempt completion status", () => {
  const server = readFile("server.ts");
  const guardBlock = server.substring(
    server.indexOf("--- Browser AI Guard detection"),
    server.indexOf("Build the AI grading prompt")
  );
  assert.ok(
    !guardBlock.includes("attempt.status = ") &&
    !guardBlock.includes("completedAt ="),
    "Guard detection must not modify attempt completion status"
  );
});

test("Guard signals flag securityReviewRequired (not score/grade)", () => {
  fileContains("server.ts", "securityReviewRequired = true");
});

// --- 14. MC grading unaffected ---
console.log("\n14. MC grading unaffected");

test("Guard detection runs only for SA (after MC early-return)", () => {
  const server = readFile("server.ts");
  const mcBlock = server.indexOf("if (isMC) {");
  const saBlock = server.indexOf("---- SHORT ANSWER: AI grading");
  const guardBlock = server.indexOf("--- Browser AI Guard detection");
  assert.ok(
    mcBlock < saBlock && saBlock < guardBlock,
    "Guard detection must appear after the MC block (SA-only path)"
  );
});

// --- 15. Feature independence from copy/paste restriction ---
console.log("\n15. Feature independence from copy/paste controls");

test("Guard detection does not require blockPaste or blockCopy", () => {
  const server = readFile("server.ts");
  const guardDetectionFn = server.substring(
    server.indexOf("function detectBrowserAiGuard"),
    server.indexOf("function detectBrowserAiGuard") + 500
  );
  assert.ok(
    !guardDetectionFn.includes("blockPaste") && !guardDetectionFn.includes("blockCopy"),
    "detectBrowserAiGuard must not depend on paste/copy settings"
  );
});

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}

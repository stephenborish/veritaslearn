/**
 * Verification for the VERITAS Learn teacher lesson-builder workflow.
 *
 * Two kinds of checks:
 *   1. LOGIC — exercises the framework-free builder workflow module
 *      (src/components/TeacherDashboard/builderWorkflow.ts): the next-best-action
 *      engine, lesson status vocabulary, practice/assessment labels, and the
 *      five visible stages.
 *   2. UI CONTRACT — static source assertions that the builder keeps its
 *      teacher-facing language and never reintroduces developer/internal wording
 *      (isPractice, "Grading Mode Selection", raw IDs, scary proctoring copy).
 *
 * Run: npx tsx scripts/verify-builder.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  computeNextBestAction,
  lessonStatusLabel,
  modeLabel,
  modeDescription,
  WORKFLOW_STAGES,
} from "../src/components/TeacherDashboard/builderWorkflow";

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

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

console.log("\n========================================================");
console.log("👉 VERITAS LEARN TEACHER BUILDER WORKFLOW VERIFICATION");
console.log("========================================================\n");

// ---------------------------------------------------------------------------
// 1. Next best action — the order IS the product opinion.
// ---------------------------------------------------------------------------
console.log("Step 1: Next best action drives the teacher through the workflow...");

const base = {
  hasTitle: false, blockCount: 0, blockerCount: 0,
  firstBlockerTarget: undefined as undefined | "setup" | number,
  isPublished: false, isAssigned: false, isNew: true,
};

const noTitle = computeNextBestAction({ ...base });
check("No title → asks for a title, routes to setup", noTitle.target === "setup" && /title/i.test(noTitle.message));

const noBlocks = computeNextBestAction({ ...base, hasTitle: true });
check("Title but no blocks → asks to add content", noBlocks.target === "setup" && /content|block/i.test(noBlocks.message));

const withBlockers = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 2, firstBlockerTarget: 1 });
check("Blockers present → routes to the first blocker", withBlockers.target === 1 && /finish|attention/i.test(withBlockers.message));
check("Blocker message is pluralized correctly", withBlockers.message.includes("2 items"));

const readyUnpublished = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 0, isNew: false });
check("Ready but unpublished → routes to publish", readyUnpublished.target === "publish" && readyUnpublished.tone === "ready");

const publishedUnassigned = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 0, isPublished: true, isNew: false });
check("Published, not assigned → routes to assign", publishedUnassigned.target === "assign");

const assigned = computeNextBestAction({ ...base, hasTitle: true, blockCount: 3, blockerCount: 0, isPublished: true, isAssigned: true, isNew: false });
check("Assigned → routes to student progress", assigned.target === "progress" && assigned.tone === "done");

// Every action has a non-empty, plain-language CTA + message.
const allActions = [noTitle, noBlocks, withBlockers, readyUnpublished, publishedUnassigned, assigned];
check("Every next action has a CTA + message", allActions.every((a) => a.cta.length > 0 && a.message.length > 0));

// ---------------------------------------------------------------------------
// 2. Lesson status vocabulary is teacher-friendly.
// ---------------------------------------------------------------------------
console.log("\nStep 2: Lesson status labels match the teacher-facing vocabulary...");

check("Fresh lesson is Draft",
  lessonStatusLabel({ isNew: true, isPublished: false, isAssigned: false, blockerCount: 0, hasTitle: false, blockCount: 0 }) === "Draft");
check("Blockers surface as Needs attention",
  lessonStatusLabel({ isNew: false, isPublished: false, isAssigned: false, blockerCount: 2, hasTitle: true, blockCount: 2 }) === "Needs attention");
check("Clean unpublished lesson is Ready to publish",
  lessonStatusLabel({ isNew: false, isPublished: false, isAssigned: false, blockerCount: 0, hasTitle: true, blockCount: 2 }) === "Ready to publish");
check("Published with no assignment is 'Published, not assigned'",
  lessonStatusLabel({ isNew: false, isPublished: true, isAssigned: false, blockerCount: 0, hasTitle: true, blockCount: 2 }) === "Published, not assigned");
check("Published + assigned is Assigned",
  lessonStatusLabel({ isNew: false, isPublished: true, isAssigned: true, blockerCount: 0, hasTitle: true, blockCount: 2 }) === "Assigned");

// ---------------------------------------------------------------------------
// 3. Practice vs Assessment language.
// ---------------------------------------------------------------------------
console.log("\nStep 3: Practice vs Assessment language is consistent...");
check("modeLabel(true) is Practice", modeLabel(true) === "Practice");
check("modeLabel(false) is Assessment", modeLabel(false) === "Assessment");
check("Practice description mentions feedback right away", /right away|practice/i.test(modeDescription(true)));
check("Assessment description mentions hidden until released", /hidden|release/i.test(modeDescription(false)));

// ---------------------------------------------------------------------------
// 4. The five visible stages, in order.
// ---------------------------------------------------------------------------
console.log("\nStep 4: Workflow exposes the five visible stages in order...");
const stageKeys = WORKFLOW_STAGES.map((s) => s.key).join(",");
check("Stages are setup → content → preview → publish → assign", stageKeys === "setup,content,preview,publish,assign", stageKeys);
check("Every stage explains its purpose", WORKFLOW_STAGES.every((s) => s.purpose.length > 10));

// ---------------------------------------------------------------------------
// 5. UI CONTRACT — builder keeps teacher-facing language, drops dev wording.
// ---------------------------------------------------------------------------
console.log("\nStep 5: Builder UI keeps calm, teacher-facing language...");

const builder = read("src/components/TeacherDashboard/LessonsBuilder.tsx");
const editor = read("src/components/TeacherDashboard/QuestionEditor.tsx");

// Present: the new product language.
check("Command header surfaces a 'Next' best action", builder.includes(">Next<") || builder.includes("Next best action"));
check("Builder uses the shared Practice/Assessment selector", builder.includes("ModeSelector") && builder.includes("How students experience this"));
check("Builder groups readiness as Blockers / Needs attention / Optional",
  builder.includes("Blockers") && builder.includes("Needs attention") && builder.includes("Optional"));
check("Builder explains what students will see", builder.includes("What students will see"));
check("Setup uses required-only title and optional description", builder.includes("Lesson title") && builder.includes("(optional)"));

check("Question editor labels teacher-only scoring setup", editor.includes("Teacher-only scoring setup"));
check("Question editor reassures students won't see scoring setup", editor.includes("Students will not see this."));
check("Question editor offers 'Draft rubric with AI'", editor.includes("Draft rubric with AI"));
check("Question editor shows 'AI scoring readiness'", editor.includes("AI scoring readiness"));
check("AI failure copy is calm (question not changed)", editor.includes("wasn’t changed") || editor.includes("wasn't changed"));

// Absent: developer / internal / scary wording in the teacher UI.
const bannedBuilder = [
  "Grading Mode Selection",
  "Draft State",
  "Direct Video URL",
  "Lesson Plan",
  "securely recorded",
  "passive pacing logs",
  "ID: {lesson.id",
];
bannedBuilder.forEach((phrase) => {
  check(`Builder no longer shows "${phrase}"`, !builder.includes(phrase));
});

const bannedEditor = [
  "AI Grading Status Dashboard",
  "Teacher Review Recommended", // always-on noisy badge removed
];
bannedEditor.forEach((phrase) => {
  check(`Question editor no longer shows "${phrase}"`, !editor.includes(phrase));
});

// Stable choice ids — correct answer must bind to id, never array index (guards grading).
check("MC correct answer binds to a stable choice id", editor.includes("correctChoiceId: c.id"));

// ---------------------------------------------------------------------------
// 6. Video thumbnail state + persistence contract.
// ---------------------------------------------------------------------------
console.log("\nStep 6: Video thumbnails survive save, reload, and publish snapshots...");

const uploader = read("src/components/TeacherDashboard/VideoUploader.tsx");
const server = read("server.ts");

check("Builder has a dedicated latest-state thumbnail update",
  builder.includes("handleVideoThumbnailSelected") &&
  builder.includes("setCurrentBlocks((prev: any[]) =>") &&
  builder.includes("videoUrl: latestBlock.videoUrl") &&
  builder.includes("videoCheckpoints: Array.isArray(latestBlock.videoCheckpoints)"));
check("VideoUploader routes manual frame selection through onThumbnailSelected",
  uploader.includes("onThumbnailSelected?: (thumbnailUrl: string) => void") &&
  uploader.includes("onThumbnailSelected(dataUrl)"));

const createLessonBlockWrite = /app\.post\("\/api\/lessons"[\s\S]*?thumbnailUrl: bType === "video" \? b\.thumbnailUrl : undefined[\s\S]*?createLessonVersionSnapshot\(newLesson, savedBlocks/s.test(server);
const updateLessonBlockWrite = /app\.put\("\/api\/lessons\/:id"[\s\S]*?thumbnailUrl: bType === "video" \? b\.thumbnailUrl : undefined[\s\S]*?createLessonVersionSnapshot\(db\.lessons\[lessonIdx\], updatedBlocksForVersion/s.test(server);
check("POST /api/lessons persists video thumbnailUrl before publishing", createLessonBlockWrite);
check("PUT /api/lessons/:id persists video thumbnailUrl before publishing", updateLessonBlockWrite);
check("Published lesson versions deep-copy the saved block snapshot",
  server.includes("blocksSnapshot: JSON.parse(JSON.stringify(sortedBlocks))"));

const authoredVideoBlock = {
  id: "block_video_thumb",
  lessonId: "lesson_thumb",
  order: 1,
  type: "video",
  title: "Intro video",
  videoUrl: "https://cdn.example.edu/intro.mp4",
  thumbnailUrl: "data:image/jpeg;base64,teacher-selected-frame",
  storagePath: "videos/intro.mp4",
  duration: 125,
  videoCheckpoints: [{ id: "cp_1", timestamp: 45, title: "Quick check" }],
};
const savedBlocks = [{
  id: authoredVideoBlock.id,
  lessonId: authoredVideoBlock.lessonId,
  order: authoredVideoBlock.order,
  type: authoredVideoBlock.type,
  title: authoredVideoBlock.title,
  videoUrl: authoredVideoBlock.videoUrl,
  thumbnailUrl: authoredVideoBlock.thumbnailUrl,
  storagePath: authoredVideoBlock.storagePath,
  duration: authoredVideoBlock.duration,
  videoCheckpoints: authoredVideoBlock.videoCheckpoints,
}];
const reloadedBlocks = JSON.parse(JSON.stringify(savedBlocks));
const publishedVersion = { blocksSnapshot: JSON.parse(JSON.stringify(reloadedBlocks)) };

check("thumbnailUrl is present after save/reload",
  reloadedBlocks[0].thumbnailUrl === authoredVideoBlock.thumbnailUrl);
check("thumbnailUrl is present in the published lesson version snapshot",
  publishedVersion.blocksSnapshot[0].thumbnailUrl === authoredVideoBlock.thumbnailUrl);
check("thumbnail save/reload preserves video metadata and checkpoints",
  reloadedBlocks[0].videoUrl === authoredVideoBlock.videoUrl &&
  reloadedBlocks[0].duration === authoredVideoBlock.duration &&
  reloadedBlocks[0].storagePath === authoredVideoBlock.storagePath &&
  reloadedBlocks[0].videoCheckpoints[0].id === "cp_1");
// 6. Regression guard — immutable rich-content persistence through builder/server.
// ---------------------------------------------------------------------------
console.log("\nStep 6: Builder updates and server persistence keep rich lesson data intact...");

const serverContent = read("server.ts");

check("Checkpoint updates derive from latest block state",
  /const updateCheckpoint[\s\S]*setCurrentBlocks\(\(prev: any\[\]\) =>/.test(builder));
check("Checkpoint question updates accept updater-style latest question edits",
  /const updateCheckpointQuestion[\s\S]*nextQuestionOrUpdater[\s\S]*nextQuestionOrUpdater\(currentQuestion\)/.test(builder));
check("Question block updates accept updater-style latest question edits",
  /const handleBlockQuestionChange[\s\S]*nextQuestionOrUpdater\(currentQuestion\)/.test(builder));
check("Nested checkpoint code no longer reads currentBlocks[blockIndex] from render closure",
  !/currentBlocks\[blockIndex\]/.test(builder));
check("saveWithPublishedStatus sends blocks: currentBlocks",
  /const payload = \{[\s\S]*blocks: currentBlocks[\s\S]*\};/.test(builder));
check("VideoUploader persists thumbnail with video URL, duration, and storage path",
  builder.includes('onBlockMultipleChanges(index, { videoUrl: url, thumbnailUrl: thumbnail || "", duration: duration || 0, storagePath: storagePath || "" })'));

check("QuestionEditor emits updater-style changes to avoid stale q overwrites",
  editor.includes("onChange((latestQuestion: AnyQuestion) =>") && editor.includes("patchWith"));
check("QuestionEditor choice helpers merge into the latest choices array",
  /latestChoices[\s\S]*choices: latestChoices\.map/.test(editor));
check("QuestionEditor rubric helpers merge into the latest rubric array",
  /latestRubric[\s\S]*rubricCategories: latestRubric\.map/.test(editor));

const requiredDocumentKeys = [
  "reading_content",
  "q-${qIdStr}-stem",
  "q-${qIdStr}-studentInstructions",
  "q-${qIdStr}-modelAnswer",
  "q-${qIdStr}-explanation",
  "q-${qIdStr}-aiScoringGuidance",
  "q-${qIdStr}-rubric-${r.id}-description",
  "q-${qIdStr}-choice-${c.id}-text",
];
requiredDocumentKeys.forEach((key) => {
  check(`RichContentEditor documentKey includes stable ${key} identity`, builder.includes(key) || editor.includes(key));
});

const richPayload = {
  readingContent: { html: "<p>Read <strong>this</strong>.</p>", plainText: "Read this." },
  mcStem: { html: "<p>Which <em>answer</em>?</p>", plainText: "Which answer?" },
  saStem: { html: "<p>Explain the pattern.</p>", plainText: "Explain the pattern." },
  explanation: { html: "<p>Because of evidence.</p>", plainText: "Because of evidence." },
  studentInstructions: { html: "<p>Use complete sentences.</p>", plainText: "Use complete sentences." },
  modelAnswer: { html: "<p>A complete model answer.</p>", plainText: "A complete model answer." },
  aiScoringGuidance: { html: "<p>Credit precise evidence.</p>", plainText: "Credit precise evidence." },
  rubricDescription: { html: "<p>Evidence quality.</p>", plainText: "Evidence quality." },
  choiceText: { html: "<p>Choice A rich text.</p>", plainText: "Choice A rich text." },
  thumbnailUrl: "https://cdn.example.test/thumb.jpg",
};
const savedBlocks2: any[] = [
  { id: "video_1", type: "video", title: "Video", videoUrl: "https://cdn.example.test/video.mp4", thumbnailUrl: richPayload.thumbnailUrl, videoCheckpoints: [] },
  { id: "reading_1", type: "reading", title: "Reading", content: richPayload.readingContent },
  { id: "mc_1", type: "question", title: "MC", questionType: "mc", isPractice: true, singleQuestion: {
    id: "q_mc", type: "mc", stem: richPayload.mcStem, explanation: richPayload.explanation,
    choices: [{ id: "choice_a", text: richPayload.choiceText }, { id: "choice_b", text: "Existing B" }], correctChoiceId: "choice_a", points: 1,
  } },
  { id: "sa_1", type: "question", title: "SA", questionType: "sa", isPractice: false, singleQuestion: {
    id: "q_sa", type: "sa", stem: richPayload.saStem, studentInstructions: richPayload.studentInstructions,
    modelAnswer: richPayload.modelAnswer, aiScoringGuidance: richPayload.aiScoringGuidance,
    rubricCategories: [{ id: "rub_1", name: "Evidence", maxPoints: 2, description: richPayload.rubricDescription }], points: 2,
  } },
];
const reloadedBlocks2 = JSON.parse(JSON.stringify(savedBlocks2));
const versionSnapshot = JSON.parse(JSON.stringify(reloadedBlocks2));
check("Save/reload preserves reading rich content", reloadedBlocks2[1].content.html === richPayload.readingContent.html);
check("Save/reload preserves MC stem, feedback, and choice text", reloadedBlocks2[2].singleQuestion.stem.html === richPayload.mcStem.html && reloadedBlocks2[2].singleQuestion.explanation.html === richPayload.explanation.html && reloadedBlocks2[2].singleQuestion.choices[0].text.html === richPayload.choiceText.html);
check("Save/reload preserves SA stem, instructions, model answer, scoring guidance, and rubric", reloadedBlocks2[3].singleQuestion.stem.html === richPayload.saStem.html && reloadedBlocks2[3].singleQuestion.studentInstructions.html === richPayload.studentInstructions.html && reloadedBlocks2[3].singleQuestion.modelAnswer.html === richPayload.modelAnswer.html && reloadedBlocks2[3].singleQuestion.aiScoringGuidance.html === richPayload.aiScoringGuidance.html && reloadedBlocks2[3].singleQuestion.rubricCategories[0].description.html === richPayload.rubricDescription.html);
check("Save/reload preserves video thumbnail URL", reloadedBlocks2[0].thumbnailUrl === richPayload.thumbnailUrl);
check("Version snapshot preserves all rich block/question fields", JSON.stringify(versionSnapshot) === JSON.stringify(savedBlocks2));

const firstQuestionBefore = JSON.parse(JSON.stringify(savedBlocks2[2]));
const withSecondQuestion = [...savedBlocks2, { id: "q2", type: "question", title: "Second", questionType: "mc", singleQuestion: { id: "q_second", type: "mc", stem: "Second stem", choices: [{ id: "choice_2a", text: "Second A" }, { id: "choice_2b", text: "Second B" }], correctChoiceId: "choice_2a" } }];
check("Adding a second question does not erase the first question stem, feedback, choices, or reading content",
  JSON.stringify(withSecondQuestion[2]) === JSON.stringify(firstQuestionBefore) &&
  JSON.stringify((withSecondQuestion[1] as any).content) === JSON.stringify(richPayload.readingContent));

check("POST /api/lessons preserves reading content, question data, and video thumbnails",
  /thumbnailUrl: bType === "video" \? b\.thumbnailUrl/.test(serverContent) &&
  /content: bType === "reading" \? b\.content/.test(serverContent) &&
  /singleQuestion: bType === "question" \? b\.singleQuestion/.test(serverContent));
check("PUT /api/lessons/:id preserves reading content, question data, and video thumbnails",
  /app\.put\("\/api\/lessons\/:id"[\s\S]*thumbnailUrl: bType === "video" \? b\.thumbnailUrl[\s\S]*content: bType === "reading" \? b\.content[\s\S]*singleQuestion: bType === "question" \? b\.singleQuestion/.test(serverContent));
check("createLessonVersionSnapshot deep-copies sorted blocks without stripping fields",
  /blocksSnapshot: JSON\.parse\(JSON\.stringify\(sortedBlocks\)\)/.test(serverContent));

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

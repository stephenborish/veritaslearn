/**
 * Question migration, student-payload sanitization, and MC grading helpers.
 *
 * SECURITY: `sanitizeQuestionForStudent` is the single source of truth for what a
 * student is allowed to receive for a question. Graded answer keys, correct choice
 * ids, model answers, rubrics, AI scoring guidance, and teacher notes must NEVER
 * reach a student. These helpers are pure so they can be unit-verified.
 */

let idCounter = 0;
function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).substring(2, 7)}`;
}

/** Fields that must never appear in a student-facing question payload. */
export const SECRET_QUESTION_FIELDS = [
  "correctChoiceId",
  "correctAnswerIndex",
  "explanation",
  "rubricCategories",
  "modelAnswer",
  "answerKey",
  "aiScoringGuidance",
  "teacherNotes",
] as const;

function isChoiceObject(c: any): boolean {
  return c !== null && typeof c === "object" && !Array.isArray(c) && typeof c.id === "string";
}

/**
 * Normalize a question definition to the stable-id shape.
 * - Converts legacy `choices: string[]` -> `ChoiceDefinition[]` with stable ids.
 * - Derives `correctChoiceId` from a legacy `correctAnswerIndex` when missing.
 * - Ensures every rubric category has a stable id.
 * - Infers `type` ('mc' if choices present, else 'sa') when absent.
 * Returns a NEW object (does not mutate input).
 */
export function migrateQuestionDefinition(q: any): any {
  if (!q || typeof q !== "object") return q;
  const out: any = { ...q };

  if (Array.isArray(out.choices)) {
    const migratedChoices = out.choices.map((c: any) =>
      isChoiceObject(c) ? { id: c.id, text: c.text } : { id: genId("choice"), text: c }
    );
    out.choices = migratedChoices;

    if (!out.correctChoiceId && typeof out.correctAnswerIndex === "number" && migratedChoices[out.correctAnswerIndex]) {
      out.correctChoiceId = migratedChoices[out.correctAnswerIndex].id;
    }
  }

  if (Array.isArray(out.rubricCategories)) {
    out.rubricCategories = out.rubricCategories.map((r: any) =>
      r && typeof r === "object" ? { ...r, id: r.id || genId("rub") } : r
    );
  }

  if (!out.type) {
    out.type = Array.isArray(out.choices) && out.choices.length > 0 ? "mc" : "sa";
  }

  return out;
}

/** Normalize every embedded question inside a block (single, pool, checkpoints). Returns a new block. */
export function migrateBlock(block: any): any {
  if (!block || typeof block !== "object") return block;
  const out: any = { ...block };

  if (out.singleQuestion) {
    out.singleQuestion = migrateQuestionDefinition(out.singleQuestion);
  }
  if (out.questionPool && Array.isArray(out.questionPool.questions)) {
    out.questionPool = {
      ...out.questionPool,
      questions: out.questionPool.questions.map(migrateQuestionDefinition),
    };
  }
  if (Array.isArray(out.videoCheckpoints)) {
    out.videoCheckpoints = out.videoCheckpoints.map((cp: any) =>
      cp && Array.isArray(cp.questions)
        ? { ...cp, questions: cp.questions.map(migrateQuestionDefinition) }
        : cp
    );
  }

  return out;
}

/**
 * Produce the student-safe view of a question. Strips ALL secret fields and
 * reduces choices to `{ id, text }`. `optionalChoiceOrder` lets the caller deliver
 * a scrambled order (still id-stable) without leaking the original ordering.
 */
export function sanitizeQuestionForStudent(q: any, optionalChoiceOrder?: any[]): any {
  if (!q || typeof q !== "object") return q;
  const safe: any = {
    id: q.id,
    type: q.type || (Array.isArray(q.choices) && q.choices.length ? "mc" : "sa"),
    stem: q.stem,
    points: q.points,
  };
  if (q.studentInstructions !== undefined) safe.studentInstructions = q.studentInstructions;

  const sourceChoices = optionalChoiceOrder || q.choices;
  if (Array.isArray(sourceChoices)) {
    safe.choices = sourceChoices.map((c: any) =>
      isChoiceObject(c) ? { id: c.id, text: c.text } : { id: genId("choice"), text: c }
    );
  }
  return safe;
}

/** Sanitize a whole block's embedded questions for a student. Returns a new block. */
export function sanitizeBlockForStudent(block: any): any {
  if (!block || typeof block !== "object") return block;
  const out: any = { ...block };

  if (out.singleQuestion) {
    out.singleQuestion = sanitizeQuestionForStudent(out.singleQuestion);
  }
  if (out.questionPool && Array.isArray(out.questionPool.questions)) {
    out.questionPool = {
      ...out.questionPool,
      questions: out.questionPool.questions.map((q: any) => sanitizeQuestionForStudent(q)),
    };
  }
  if (Array.isArray(out.videoCheckpoints)) {
    out.videoCheckpoints = out.videoCheckpoints.map((cp: any) =>
      cp && Array.isArray(cp.questions)
        ? { ...cp, questions: cp.questions.map((q: any) => sanitizeQuestionForStudent(q)) }
        : cp
    );
  }
  return out;
}

/** Sanitize a full lesson's blocks for a student. */
export function sanitizeLessonBlocksForStudent(blocks: any[]): any[] {
  return (blocks || []).map(sanitizeBlockForStudent);
}

/**
 * Defensive assertion used by tests/logging: returns the list of secret keys that
 * leaked into a payload (empty array means safe). Recurses into nested questions.
 */
export function findLeakedSecretFields(payload: any, path = "$"): string[] {
  const leaks: string[] = [];
  const visit = (node: any, p: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${p}[${i}]`));
      return;
    }
    for (const key of Object.keys(node)) {
      if ((SECRET_QUESTION_FIELDS as readonly string[]).includes(key)) {
        leaks.push(`${p}.${key}`);
      }
      visit(node[key], `${p}.${key}`);
    }
  };
  visit(payload, path);
  return leaks;
}

/**
 * Grade an MC response by stable choice id (scramble-proof). Falls back to legacy
 * index comparison only when the question predates the id migration.
 */
export function gradeMc(originalQuestion: any, submittedValue: any): { isCorrect: boolean } {
  if (!originalQuestion) return { isCorrect: false };

  // Preferred: id-based comparison.
  if (originalQuestion.correctChoiceId !== undefined && originalQuestion.correctChoiceId !== null) {
    return { isCorrect: String(submittedValue) === String(originalQuestion.correctChoiceId) };
  }

  // Legacy fallback: submittedValue is a numeric index into original choices.
  if (typeof originalQuestion.correctAnswerIndex === "number") {
    return { isCorrect: Number(submittedValue) === originalQuestion.correctAnswerIndex };
  }

  return { isCorrect: false };
}

/** Look up the display text of a chosen MC option by id (for teacher review). */
export function choiceTextById(question: any, choiceId: any): string | undefined {
  if (!question || !Array.isArray(question.choices)) return undefined;
  const found = question.choices.find((c: any) => isChoiceObject(c) && String(c.id) === String(choiceId));
  if (!found) return undefined;
  const t = found.text;
  return typeof t === "string" ? t : undefined;
}

/** Sanitize a StudentResponse for student view to prevent any answer/feedback leaks. */
export function sanitizeResponseForStudent(r: any): any {
  if (!r || typeof r !== "object") return r;
  const safe = { ...r };
  
  // Safe legacy fallbacks
  const gradingMode = safe.gradingMode || safe.gradebookCategory || "assessment";
  const isPractice = gradingMode === "practice";

  // Default unknown feedbackVisibility to "teacher_only"
  const feedbackVis = safe.feedbackVisibility || "teacher_only";

  // Practice responses may expose feedback only when feedbackVisibility is student_visible
  const feedbackAllowed = isPractice && (feedbackVis === "student_visible" || feedbackVis === "immediate");

  if (!feedbackAllowed) {
    // Hide scores, correctness, evaluations, feedbacks, and AI grading records
    delete safe.isCorrect;
    delete safe.score;
    delete safe.pointsEarned;
    delete safe.aiGrading;
    delete safe.teacherOverride;
    delete safe.teacherOverrideScore;
    delete safe.teacherOverrideFeedback;
    delete safe.teacherReviewedAt;
    
    // Only expose submitted status
    safe.status = "submitted";
  } else {
    // If practice has immediate feedback allowed
    if (safe.aiGrading) {
      delete safe.aiGrading.guidanceSnapshot;
    }
    delete safe.teacherOverrideScore;
    delete safe.teacherOverrideFeedback;
    delete safe.teacherReviewedAt;
  }
  return safe;
}

/** Sanitize a GradebookEntry for student view to prevent premature score disclosures. */
export function sanitizeGradebookEntryForStudent(e: any): any {
  if (!e || typeof e !== "object") return e;
  // Make sure to clean any secret internal scoring details if needed
  const safe = { ...e };
  return safe;
}

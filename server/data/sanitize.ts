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
    const migratedChoices = out.choices.map((c: any, index: number) =>
      isChoiceObject(c) ? { id: c.id, text: c.text } : { id: "choice_legacy_" + index, text: c }
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
    safe.choices = sourceChoices.map((c: any, index: number) =>
      isChoiceObject(c) ? { id: c.id, text: c.text } : { id: "choice_legacy_" + index, text: c }
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

/**
 * Strip teacher-only fields from an AI grading object for student view.
 * Exposes score, student-facing feedback, rubric breakdown, misconceptions, confidence, and status.
 * Removes: rationale, teacherNotes, needsTeacherReview, guidanceSnapshot.
 */
export function sanitizeAiGradingForStudent(aiGrading: any): any {
  if (!aiGrading || typeof aiGrading !== "object") return aiGrading;
  const safe: any = { status: aiGrading.status };
  if (aiGrading.score !== undefined) safe.score = aiGrading.score;
  if (aiGrading.feedback !== undefined) safe.feedback = aiGrading.feedback;
  if (aiGrading.confidence !== undefined) safe.confidence = aiGrading.confidence;
  if (aiGrading.gradedAt !== undefined) safe.gradedAt = aiGrading.gradedAt;
  if (aiGrading.rubricBreakdown !== undefined) safe.rubricBreakdown = aiGrading.rubricBreakdown;
  if (Array.isArray(aiGrading.misconceptions)) safe.misconceptions = aiGrading.misconceptions;
  // Explicitly excluded: rationale, teacherNotes, needsTeacherReview, guidanceSnapshot
  return safe;
}

/**
 * Strip teacher-only fields from an attempt for student view.
 * Removes internal security review flags and gradebook override status.
 */
export function sanitizeAttemptForStudent(attempt: any): any {
  if (!attempt || typeof attempt !== "object") return attempt;
  const safe = { ...attempt };
  delete safe.gradebookStatusOverride;
  delete safe.securityReviewRequired;
  delete safe.securityReviewReason;
  delete safe.securityReviewAt;
  return safe;
}

/**
 * Sanitize a StudentResponse for student view.
 *
 * Assessment SA: hides all scoring, feedback, and grading data unless
 * teacher has explicitly released feedback (feedbackReleasedAt is set and
 * feedbackVisibleToStudent === true on the response or its gradebookResponseEntry).
 * Practice SA (feedback not yet released): hides score but exposes minimal aiGrading.status for pending state.
 * Practice SA (feedback released): exposes score and sanitized AI grading via sanitizeAiGradingForStudent.
 * MC: hides correctness and score unless feedbackAllowed.
 */
export function sanitizeResponseForStudent(r: any): any {
  if (!r || typeof r !== "object") return r;
  const safe = { ...r };

  // Always remove teacher-only fields from every response type
  delete safe.teacherOverrideScore;
  delete safe.teacherOverrideFeedback;
  delete safe.teacherReviewedAt;
  delete safe.teacherReviewedBy;
  delete safe.teacherOverride;
  delete safe.teacherOnlyFeedback;
  delete safe.originalAiScore;
  // isLowEffort / lowEffortReason are teacher-only
  delete safe.isLowEffort;
  delete safe.lowEffortReason;

  const gradingMode = safe.gradingMode || safe.gradebookCategory || "assessment";
  const isPractice = gradingMode === "practice";
  const feedbackVis = safe.feedbackVisibility || "teacher_only";

  // Feedback is released when:
  //  a) practice + feedbackVisibility is student_visible / immediate, OR
  //  b) teacher explicitly released it (feedbackReleasedAt set + feedbackVisibleToStudent === true)
  const teacherReleased = !!(safe.feedbackReleasedAt && safe.feedbackVisibleToStudent === true);
  const feedbackAllowed =
    teacherReleased ||
    (isPractice && (feedbackVis === "student_visible" || feedbackVis === "immediate"));

  // Ensure secret MC helper properties are pruned for assessments
  if (!isPractice || !feedbackAllowed) {
    delete safe.correctChoiceId;
    delete safe.explanation;
  }

  // Scrub history items to prevent leaking correctness markers in assessment mode
  if (Array.isArray(safe.attemptsHistory)) {
    safe.attemptsHistory = safe.attemptsHistory.map((h: any) => {
      const cloned = { ...h };
      if (!isPractice || !feedbackAllowed) {
        delete cloned.isCorrect;
        delete cloned.score;
      }
      return cloned;
    });
  }

  // Assessment responses never expose scoring, correctness, AI grading, rubric
  // breakdowns, rationale, teacher notes, or feedback in the student payload.
  // Students see only that the response was submitted for teacher review.
  if (!isPractice) {
    delete safe.score;
    delete safe.pointsEarned;
    delete safe.isCorrect;
    delete safe.aiGrading;
    delete safe.aiFeedbackReleasedAt;
    delete safe.feedback;
    delete safe.studentFacingFeedback;
    safe.status = "submitted";
    return safe;
  }

  if (safe.type === "sa") {
    if (feedbackAllowed) {
      // Released feedback: sanitize AI grading and expose student-facing content only
      if (safe.aiGrading) {
        safe.aiGrading = sanitizeAiGradingForStudent(safe.aiGrading);
      }
      // Prefer explicit studentFacingFeedback over raw feedback
      if (safe.studentFacingFeedback !== undefined) {
        safe.feedback = safe.studentFacingFeedback;
      }
      delete safe.studentFacingFeedback;
    } else if (isPractice) {
      // Practice response with feedback not yet released: hide score, expose minimal status
      delete safe.score;
      delete safe.pointsEarned;
      delete safe.isCorrect;
      delete safe.feedback;
      delete safe.studentFacingFeedback;
      const aiStatus = safe.aiGrading?.status;
      safe.aiGrading = aiStatus ? { status: aiStatus } : undefined;
    } else {
      // Assessment SA without release: hide all scoring and grading
      delete safe.score;
      delete safe.pointsEarned;
      delete safe.isCorrect;
      delete safe.aiGrading;
      delete safe.aiFeedbackReleasedAt;
      delete safe.feedback;
      delete safe.studentFacingFeedback;
      safe.status = "submitted";
    }
  } else {
    // MC question: hide correctness and score unless feedback is allowed
    if (!feedbackAllowed) {
      delete safe.isCorrect;
      delete safe.score;
      delete safe.pointsEarned;
      delete safe.aiGrading;
      safe.status = "submitted";
    }
  }

  return safe;
}

/**
 * Sanitize a GradebookEntry for student view.
 * Exposes non-sensitive status fields and, when feedback has been released, score and feedback.
 * Never exposes teacher-only attribution fields (reviewedBy, releasedBy, etc.).
 */
export function sanitizeGradebookEntryForStudent(e: any): any {
  if (!e || typeof e !== "object") return e;

  // Map internal status to student-safe display status
  const studentStatus = mapGradebookStatusForStudent(e.status);

  const safe: any = {
    id: e.id,
    assignmentId: e.assignmentId,
    status: studentStatus,
    attemptId: e.attemptId,
    updatedAt: e.updatedAt,
    feedbackReleasedAt: e.feedbackReleasedAt || null,
  };

  // Expose score/feedback only after teacher-controlled release
  if (e.feedbackReleasedAt || e.feedbackVisibleToStudent) {
    if (e.assessmentScore !== undefined) safe.assessmentScore = e.assessmentScore;
    if (e.assessmentMaxScore !== undefined) safe.assessmentMaxScore = e.assessmentMaxScore;
    if (e.finalScore !== undefined) safe.score = e.finalScore;
    if (e.maxPoints !== undefined) safe.maxScore = e.maxPoints;
    if (e.percent !== undefined) safe.percent = e.percent;
  }

  // Practice summary is always safe to show (no model answers, etc.)
  if (e.practiceSummary) safe.practiceSummary = e.practiceSummary;

  return safe;
}

/**
 * Map internal GradebookEntry status codes to student-safe display strings.
 * Students must not see teacher-workflow statuses like 'needs_teacher_review'.
 */
export function mapGradebookStatusForStudent(status: string): string {
  switch (status) {
    case 'not_started': return 'not_started';
    case 'in_progress': return 'in_progress';
    case 'submitted':   return 'submitted';
    case 'completed':   return 'completed';
    case 'pending_ai':  return 'submitted'; // "Submitted for teacher review."
    case 'needs_teacher_review': return 'submitted';
    case 'reviewed':    return 'submitted'; // no feedback yet
    case 'feedback_released': return 'feedback_available';
    case 'missing':     return 'missing';
    case 'excused':     return 'excused';
    case 'late':        return 'late';
    case 'extended':    return 'in_progress'; // extension granted
    case 'reopened':    return 'in_progress';
    case 'error':       return 'submitted'; // fall-back
    case 'needs_grading': return 'submitted'; // legacy
    case 'graded':      return 'completed';    // legacy
    default:            return status;
  }
}

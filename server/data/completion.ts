/**
 * Server-certified attempt completion validation.
 *
 * All functions here are pure — they accept data as parameters and return
 * structured results without side effects, making them easy to unit-test.
 *
 * SECURITY: The server is the sole arbiter of whether an attempt may be
 * marked complete.  Clients may REQUEST completion; only this module decides
 * whether the requirements are satisfied.
 */

export type CompletionMissingCode =
  | 'video_not_finished'
  | 'checkpoint_unanswered'
  | 'question_unsubmitted'
  | 'assignment_not_open'
  | 'assignment_closed'
  | 'enrollment_inactive'
  | 'invalid_attempt'
  | 'version_mismatch'
  | 'unknown';

export interface CompletionRequirementMissing {
  code: CompletionMissingCode;
  blockId?: string;
  checkpointId?: string;
  questionId?: string;
  message: string;
}

export interface CompletionValidationResult {
  canComplete: boolean;
  missing: CompletionRequirementMissing[];
  assessmentScore?: number;
  assessmentMaxScore?: number;
  practiceSummary?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────
// Internal helpers (duplicated from server.ts to avoid coupling)
// ──────────────────────────────────────────────────────────

function getAvailabilityState(
  asg: any,
  now: Date
): 'not_open' | 'open' | 'due_passed' | 'closed' | 'unavailable' {
  if (!asg) return 'unavailable';
  const opensAt  = asg.opensAt  ? new Date(asg.opensAt)  : null;
  const dueAt    = asg.dueAt    ? new Date(asg.dueAt)    : null;
  const closesAt = asg.closesAt ? new Date(asg.closesAt) : null;
  if (opensAt  && now < opensAt)  return 'not_open';
  if (closesAt && now > closesAt) return 'closed';
  if (dueAt    && now > dueAt)    return 'due_passed';
  return 'open';
}

function calcAssessmentMaxPoints(attempt: any, db: any): number {
  const qAsgs = (db.questionAssignments || []).filter((qa: any) => qa.attemptId === attempt.id);
  let total = 0;
  qAsgs.forEach((qa: any) => {
    const block = (db.blocks || []).find((b: any) => b.id === qa.blockId);
    if (!block) return;
    let isPractice = false;
    if (qa.checkpointId && Array.isArray(block.videoCheckpoints)) {
      const cp = block.videoCheckpoints.find((c: any) => c.id === qa.checkpointId);
      isPractice = cp ? !!cp.isPractice : !!block.isPractice;
    } else {
      isPractice = !!block.isPractice;
    }
    if (!isPractice) total += Number(qa.selectedQuestion?.points ?? 0);
  });

  // Fallback to live blocks when questionAssignments is empty (legacy)
  if (total === 0) {
    const lessonBlocks = (db.blocks || []).filter((b: any) => b.lessonId === attempt.lessonId);
    total = lessonBlocks.reduce((s: number, b: any) => {
      if (b.type !== 'question' || b.isPractice) return s;
      if (b.singleQuestion) return s + (b.singleQuestion.points || 0);
      if (b.questionPool) {
        const perQ = b.questionPool.questions?.[0]?.points || 0;
        return s + perQ * (b.questionPool.numToSelect || 1);
      }
      return s;
    }, 0);
  }
  return total;
}

// ──────────────────────────────────────────────────────────
// Block-level completion validators
// ──────────────────────────────────────────────────────────

export function validateVideoCompletion(
  block: any,
  attempt: any,
  _db: any
): CompletionRequirementMissing[] {
  const missing: CompletionRequirementMissing[] = [];
  const duration = Number(block.duration) || 0;
  if (duration > 0) {
    const furthest = Number(attempt.furthestVideoTimestamps?.[block.id]) || 0;
    if (furthest / duration < 0.85) {
      missing.push({ code: 'video_not_finished', blockId: block.id, message: 'Finish the video to continue.' });
    }
  }
  return missing;
}

export function validateCheckpointCompletion(
  block: any,
  checkpoint: any,
  attempt: any,
  attemptResponses: any[],
  qAsgs: any[]
): CompletionRequirementMissing[] {
  if (!checkpoint.isRequired) return [];
  const missing: CompletionRequirementMissing[] = [];
  const cpQAsgs = qAsgs.filter((qa: any) => qa.blockId === block.id && qa.checkpointId === checkpoint.id);
  for (const qa of cpQAsgs) {
    const answered = attemptResponses.some((r: any) => r.questionId === qa.questionId);
    if (!answered) {
      missing.push({
        code: 'checkpoint_unanswered',
        blockId: block.id,
        checkpointId: checkpoint.id,
        questionId: qa.questionId,
        message: 'Answer all required questions before finishing.',
      });
    }
  }
  return missing;
}

export function validateQuestionBlockCompletion(
  block: any,
  attempt: any,
  attemptResponses: any[],
  qAsgs: any[]
): CompletionRequirementMissing[] {
  if (block.isPractice) return []; // practice blocks don't gate completion
  const missing: CompletionRequirementMissing[] = [];
  const blockQAsgs = qAsgs.filter((qa: any) => qa.blockId === block.id && !qa.checkpointId);
  for (const qa of blockQAsgs) {
    const answered = attemptResponses.some((r: any) => r.questionId === qa.questionId);
    if (!answered) {
      missing.push({
        code: 'question_unsubmitted',
        blockId: block.id,
        questionId: qa.questionId,
        message: 'Answer all required questions before finishing.',
      });
    }
  }
  return missing;
}

// ──────────────────────────────────────────────────────────
// Main completion validator
// ──────────────────────────────────────────────────────────

/**
 * Validate whether an attempt may be server-certified as complete.
 *
 * @param attemptId         The attempt to validate.
 * @param requestingUserId  The authenticated user requesting completion.
 * @param isTeacherOrAdmin  Teachers/admins bypass enrollment & date checks.
 * @param db                The in-memory database snapshot.
 * @param now               Current wall-clock time (injected for testability).
 */
export function validateAttemptCompletion(
  attemptId: string,
  requestingUserId: string,
  isTeacherOrAdmin: boolean,
  db: any,
  now: Date
): CompletionValidationResult {
  const missing: CompletionRequirementMissing[] = [];

  // 1. Attempt existence
  const attempt = (db.attempts || []).find((a: any) => a.id === attemptId);
  if (!attempt) {
    return { canComplete: false, missing: [{ code: 'invalid_attempt', message: 'Attempt not found.' }] };
  }

  // 2. Ownership
  if (!isTeacherOrAdmin && attempt.studentId !== requestingUserId) {
    return { canComplete: false, missing: [{ code: 'invalid_attempt', message: 'Access denied.' }] };
  }

  // 3. Already completed
  if (attempt.status === 'completed') {
    return { canComplete: false, missing: [{ code: 'invalid_attempt', message: 'This attempt is already completed.' }] };
  }

  // 4. Resolve assignment
  const assignment = attempt.assignmentId
    ? (db.lessonAssignments || []).find((a: any) => a.id === attempt.assignmentId)
    : null;

  // 5. Enrollment (students only)
  if (!isTeacherOrAdmin && assignment) {
    const enrolled = (db.enrollments || []).some(
      (e: any) => e.courseId === assignment.courseId && e.studentId === attempt.studentId && e.status === 'active'
    );
    if (!enrolled) {
      missing.push({ code: 'enrollment_inactive', message: 'You are not actively enrolled in this course.' });
    }
  }

  // 6. Assignment availability — check gradebook entry for extension/reopen overrides
  if (!isTeacherOrAdmin && assignment) {
    const gbEntry = (db.gradebookEntries || []).find(
      (e: any) => e.assignmentId === assignment.id && e.studentId === attempt.studentId
    );
    const isExtended = gbEntry?.extendedUntil && new Date(gbEntry.extendedUntil) > now;
    const isReopened = gbEntry?.status === 'reopened';
    const isExcused  = gbEntry?.status === 'excused';

    if (isExcused) {
      missing.push({ code: 'assignment_closed', message: 'This assignment is excused. Contact your teacher.' });
    } else if (!isExtended && !isReopened) {
      const state = getAvailabilityState(assignment, now);
      if (state === 'not_open') {
        missing.push({ code: 'assignment_not_open', message: 'This lesson is not open yet.' });
      } else if (state === 'closed') {
        missing.push({ code: 'assignment_closed', message: 'This assignment is closed. Ask your teacher for help.' });
      }
    }
  }

  // 7. Version consistency
  if (
    assignment?.lessonVersionId &&
    attempt.lessonVersionId &&
    assignment.lessonVersionId !== attempt.lessonVersionId
  ) {
    missing.push({
      code: 'version_mismatch',
      message: 'Your progress is still saving. Try again in a moment.',
    });
  }

  // 8. Block-level requirements
  // Prefer the immutable LessonVersion snapshot; fall back to live db.blocks (legacy).
  const version = attempt.lessonVersionId
    ? (db.lessonVersions || []).find((v: any) => v.id === attempt.lessonVersionId)
    : null;
  const blocksToCheck: any[] = version?.blocksSnapshot
    || (db.blocks || []).filter((b: any) => b.lessonId === attempt.lessonId);

  const qAsgs = (db.questionAssignments || []).filter((qa: any) => qa.attemptId === attemptId);
  const attemptResponses = (db.responses || []).filter((r: any) => r.attemptId === attemptId);

  for (const block of blocksToCheck) {
    if (block.type === 'video') {
      missing.push(...validateVideoCompletion(block, attempt, db));
      if (Array.isArray(block.videoCheckpoints)) {
        for (const cp of block.videoCheckpoints) {
          missing.push(...validateCheckpointCompletion(block, cp, attempt, attemptResponses, qAsgs));
        }
      }
    } else if (block.type === 'question') {
      missing.push(...validateQuestionBlockCompletion(block, attempt, attemptResponses, qAsgs));
    }
  }

  // 9. Score computation (assessment only — practice kept separate)
  const assessmentResponses = attemptResponses.filter((r: any) => {
    const cat = r.gradebookCategory ?? r.gradingMode;
    return cat === 'assessment' || cat === undefined;
  });
  const practiceResponses = attemptResponses.filter((r: any) => {
    const cat = r.gradebookCategory ?? r.gradingMode;
    return cat === 'practice';
  });

  const assessmentScore = assessmentResponses.reduce((s: number, r: any) => s + (Number(r.score) || 0), 0);
  const assessmentMaxScore = calcAssessmentMaxPoints(attempt, db);

  const practiceSummary = {
    responseCount: practiceResponses.length,
    totalScore: practiceResponses.reduce((s: number, r: any) => s + (Number(r.score) || 0), 0),
    maxScore: practiceResponses.reduce((s: number, r: any) => s + (Number(r.maxPoints) || 0), 0),
  };

  return {
    canComplete: missing.length === 0,
    missing,
    assessmentScore,
    assessmentMaxScore,
    practiceSummary,
  };
}

/**
 * Return a student-safe message for a missing code.
 * Internal codes must never be forwarded verbatim to the client.
 */
export function studentSafeMessage(code: CompletionMissingCode): string {
  const map: Record<CompletionMissingCode, string> = {
    video_not_finished:    'Finish the video to continue.',
    checkpoint_unanswered: 'Answer all required questions before finishing.',
    question_unsubmitted:  'Answer all required questions before finishing.',
    assignment_not_open:   'This lesson is not open yet.',
    assignment_closed:     'This assignment is closed. Ask your teacher for help.',
    enrollment_inactive:   'You are not enrolled in this course.',
    invalid_attempt:       'Your progress is still saving. Try again in a moment.',
    version_mismatch:      'Your progress is still saving. Try again in a moment.',
    unknown:               'Something went wrong. Please refresh and try again.',
  };
  return map[code] ?? map.unknown;
}
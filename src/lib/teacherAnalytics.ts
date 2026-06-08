/**
 * Teacher Analytics — VERITAS Learn
 * ---------------------------------
 * Shared derived-data layer consumed by every teacher surface (Course Progress,
 * Lesson Tracking, Gradebook, Review Queue, Student Dossier). The goal is that
 * progress, status, scores, attempts, and review state are interpreted in ONE
 * place so the screens never disagree with each other.
 *
 * Principles (spec section 6):
 *  - Resolve point values, question text, and answer keys from the immutable
 *    LessonVersion snapshot bound to the attempt whenever available.
 *  - Exclude teacher preview attempts by default; label them clearly when shown.
 *  - Never fabricate missing data — return nulls and let the UI show calm
 *    fallbacks via the safe* display helpers.
 */

import {
  deriveIntegritySignalSummary,
  buildIntegrityMarkers,
  type IntegritySignalSummary,
  type ResponseReliability,
  type TeacherAttentionMarker,
} from "./integritySignals";

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

export type AssignmentDisplayStatus =
  | "not_started"
  | "in_progress"
  | "started_not_submitted"
  | "draft_saved"
  | "active_now"
  | "active_recently"
  | "no_recent_work"
  | "submitted"
  | "needs_grading"
  | "needs_review"
  | "completed"
  | "feedback_released"
  | "locked"
  | "session_ended";

const STATUS_LABELS: Record<AssignmentDisplayStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  started_not_submitted: "Started, not submitted",
  draft_saved: "Draft saved",
  active_now: "Active now",
  active_recently: "Active recently",
  no_recent_work: "No recent work",
  submitted: "Submitted",
  needs_grading: "Needs grading",
  needs_review: "Needs review",
  completed: "Completed",
  feedback_released: "Feedback released",
  locked: "Locked",
  session_ended: "Session may have ended unexpectedly",
};

export function assignmentStatusLabel(status: AssignmentDisplayStatus): string {
  return STATUS_LABELS[status] || "Status unavailable";
}

/** Status colour tokens — green complete, blue progress, amber review, red high, gray none. */
export function statusColorClasses(status: AssignmentDisplayStatus): { text: string; bg: string; border: string } {
  switch (status) {
    case "completed":
    case "feedback_released":
      return { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" };
    case "needs_grading":
    case "needs_review":
    case "session_ended":
      return { text: "text-amber-800", bg: "bg-amber-50", border: "border-amber-300" };
    case "locked":
      return { text: "text-red-700", bg: "bg-red-50", border: "border-red-300" };
    case "active_now":
    case "active_recently":
    case "in_progress":
    case "started_not_submitted":
    case "draft_saved":
    case "submitted":
      return { text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" };
    default:
      return { text: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200" };
  }
}

// ---------------------------------------------------------------------------
// Point/score resolution (immutable-version aware)
// ---------------------------------------------------------------------------

function questionPoints(q: any, fallback: number): number {
  const p = Number(q?.points);
  return isFinite(p) && p > 0 ? p : fallback;
}

/**
 * Sum the maximum *assessment* points for a lesson, resolving point values from a
 * version snapshot when provided. Practice blocks/checkpoints are excluded.
 */
export function getLessonMaxPoints(lessonBlocks: any[]): number {
  if (!Array.isArray(lessonBlocks)) return 0;
  let total = 0;
  for (const block of lessonBlocks) {
    if (!block) continue;
    if (block.type === "question") {
      if (block.isPractice) continue;
      if (block.singleQuestion) {
        total += questionPoints(block.singleQuestion, block.questionType === "sa" ? 3 : 1);
      } else if (block.questionPool?.questions?.length) {
        const numToSelect = block.questionPool.numToSelect || 1;
        const avg =
          block.questionPool.questions.reduce(
            (sum: number, q: any) => sum + questionPoints(q, block.questionType === "sa" ? 3 : 1),
            0
          ) / block.questionPool.questions.length;
        total += avg * numToSelect;
      }
    } else if (block.type === "video" && Array.isArray(block.videoCheckpoints)) {
      for (const cp of block.videoCheckpoints) {
        if (cp?.isPractice) continue;
        const qs = cp?.questions || [];
        if (qs.length) {
          const numToSelect = cp.numToSelect || 1;
          const avg = qs.reduce((sum: number, q: any) => sum + questionPoints(q, cp.questionType === "sa" ? 3 : 1), 0) / qs.length;
          total += avg * numToSelect;
        }
      }
    }
  }
  return Math.round(total);
}

/** Sum a student's earned assessment points for one attempt (practice excluded). */
export function getAttemptEarnedPoints(attemptId: string, responses: any[]): number {
  if (!attemptId || !Array.isArray(responses)) return 0;
  let total = 0;
  for (const r of responses) {
    if (r?.attemptId !== attemptId) continue;
    if (r.gradingMode === "practice" || r.gradebookCategory === "practice") continue;
    const score = r.teacherOverrideScore ?? r.teacherOverride?.score ?? r.score ?? 0;
    if (isFinite(Number(score))) total += Number(score);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Preview-attempt filtering
// ---------------------------------------------------------------------------

export function isPreviewAttempt(attempt: any): boolean {
  return !!(attempt?.isPreviewAttempt || attempt?.attemptMode === "preview" || attempt?.excludeFromAnalytics);
}

/** Pick the best real attempt for a student+lesson, ignoring previews by default. */
export function pickAttempt(
  attempts: any[],
  studentId: string,
  lessonId: string,
  opts: { includePreview?: boolean } = {}
): any | null {
  if (!Array.isArray(attempts)) return null;
  const matches = attempts.filter(
    (a) => a?.studentId === studentId && a?.lessonId === lessonId && (opts.includePreview || !isPreviewAttempt(a))
  );
  if (matches.length === 0) return null;
  // Prefer completed, then most recently active.
  return matches.sort((a, b) => {
    if ((a.status === "completed") !== (b.status === "completed")) return a.status === "completed" ? -1 : 1;
    const at = new Date(a.lastActiveAt || a.completedAt || a.startedAt || 0).getTime();
    const bt = new Date(b.lastActiveAt || b.completedAt || b.startedAt || 0).getTime();
    return bt - at;
  })[0];
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function formatRelativeTime(timestamp: any): string {
  if (!timestamp) return "Time unavailable";
  const t = new Date(timestamp).getTime();
  if (!isFinite(t) || t <= 0) return "Time unavailable";
  const diff = Date.now() - t;
  if (diff < 0) return "Just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}

export function getLastLessonActivityTimestamp(attempt: any, responses: any[], activities: any[]): string | null {
  const candidates: number[] = [];
  if (attempt?.lastActiveAt) candidates.push(new Date(attempt.lastActiveAt).getTime());
  if (attempt?.completedAt) candidates.push(new Date(attempt.completedAt).getTime());
  if (Array.isArray(responses)) {
    for (const r of responses) {
      if (r?.attemptId === attempt?.id && r?.submittedAt) candidates.push(new Date(r.submittedAt).getTime());
    }
  }
  if (Array.isArray(activities)) {
    for (const a of activities) {
      if (a?.attemptId === attempt?.id && a?.timestamp) candidates.push(new Date(a.timestamp).getTime());
    }
  }
  const valid = candidates.filter((t) => isFinite(t) && t > 0);
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid)).toISOString();
}

// ---------------------------------------------------------------------------
// Per student-assignment summary — the core unit shared across screens
// ---------------------------------------------------------------------------

export interface StudentAssignmentSummary {
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseId: string | null;
  assignmentId: string | null;
  lessonId: string;
  lessonTitle: string;
  attemptId: string | null;
  lessonVersionId: string | null;

  status: AssignmentDisplayStatus;
  statusLabel: string;
  progressPct: number;
  currentStepIndex: number;
  stepCount: number;

  scoreEarned: number | null;
  scoreMax: number | null;
  hasValidScore: boolean;

  needsGrading: boolean;
  needsGradingCount: number;
  needsReview: boolean;
  feedbackReadyCount: number;
  feedbackNotReleasedCount: number;
  feedbackReleased: boolean;

  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  lastSignedInAt: string | null;
  isPreview: boolean;

  integrity: IntegritySignalSummary;
  reliability: ResponseReliability;
  markers: TeacherAttentionMarker[];
}

export interface DeriveSummaryInput {
  student: any;
  lesson: any;
  assignment?: any;
  blocks: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  activities?: any[];
  lessonVersions?: any[];
  gradebookResponseEntries?: any[];
  nowMs?: number;
}

const ACTIVE_NOW_MS = 60 * 1000;
const ACTIVE_RECENT_MS = 5 * 60 * 1000;
const STALE_MS = 36 * 60 * 60 * 1000;

/**
 * Build the canonical StudentAssignmentSummary used by Lesson Tracking, Gradebook,
 * Course Progress and the Dossier. Integrity/markers come from the shared engine.
 */
export function deriveStudentAssignmentSummary(input: DeriveSummaryInput): StudentAssignmentSummary {
  const { student, lesson, assignment } = input;
  const now = input.nowMs ?? Date.now();
  const lessonId = lesson?.id || assignment?.lessonId || "";
  const courseId = assignment?.courseId || lesson?.courseId || null;

  const attempt = pickAttempt(input.attempts, student?.id, lessonId);
  const lessonBlocks = (input.blocks || []).filter((b) => b?.lessonId === lessonId).sort((a, b) => (a.order || 0) - (b.order || 0));

  // Resolve blocks from the immutable version snapshot when present.
  const versionId = attempt?.lessonVersionId || assignment?.lessonVersionId || null;
  const snapshot = versionId ? (input.lessonVersions || []).find((v) => v?.id === versionId) : null;
  const effectiveBlocks = snapshot?.blocksSnapshot?.length ? snapshot.blocksSnapshot : lessonBlocks;

  const attemptResponses = attempt ? (input.responses || []).filter((r) => r?.attemptId === attempt.id) : [];
  const attemptSignals = attempt ? (input.signals || []).filter((s) => s?.attemptId === attempt.id) : [];

  // Responses-by-step map for signal clustering.
  const responsesByStep: { [k: string]: { responseId?: string; questionId?: string; submittedAt?: string } } = {};
  for (const r of attemptResponses) {
    const key = r?.checkpointId ? `${r.blockId || ""}:${r.checkpointId}` : r?.blockId || "";
    responsesByStep[key] = { responseId: r.id, questionId: r.questionId, submittedAt: r.submittedAt };
  }

  const integrity = deriveIntegritySignalSummary(attemptSignals, {
    responsesByStep,
    hasActivityTiming: !!(attempt?.activeTimeSpent && (input.activities || []).some((a) => a?.attemptId === attempt?.id)),
    assignmentId: assignment?.id || attempt?.assignmentId || null,
    lessonId,
    lessonVersionId: versionId,
  });

  // Grading / review state from responses.
  let needsGradingCount = 0;
  let feedbackReadyCount = 0;
  let feedbackNotReleasedCount = 0;
  let anyReleased = false;
  for (const r of attemptResponses) {
    if (r.gradingMode === "practice" || r.gradebookCategory === "practice") continue;
    const ai = r.aiGrading;
    const pendingAi = ai && (ai.status === "pending");
    const awaitingTeacher = ai && (ai.status === "needs_review" || ai.needsTeacherReview) && !r.teacherReviewedAt;
    const isSa = r.type === "sa";
    if (isSa && (!ai || pendingAi)) needsGradingCount++;
    else if (awaitingTeacher) needsGradingCount++;
    const reviewed = !!r.teacherReviewedAt;
    const released = !!(r.aiFeedbackReleasedAt || r.feedbackReleasedAt);
    if (released) anyReleased = true;
    if (isSa && reviewed && !released) feedbackReadyCount++;
    if (isSa && !released && (reviewed || ai?.status === "success")) feedbackNotReleasedCount++;
  }

  // Status derivation (unifies the LiveMonitor status machine).
  const stepCount = effectiveBlocks.length || lessonBlocks.length || 0;
  const currentStepIndex = attempt?.currentBlockIndex ?? 0;
  const isCompleted = attempt?.status === "completed";
  const isLocked = attempt?.lockState === "locked_awaiting_teacher";
  const hasDraft = !!(attempt?.draftResponses && Object.keys(attempt.draftResponses).length > 0);
  const lastActivityAt = getLastLessonActivityTimestamp(attempt, input.responses, input.activities || []);
  const lastActiveMs = lastActivityAt ? new Date(lastActivityAt).getTime() : 0;
  const elapsed = lastActiveMs ? now - lastActiveMs : Infinity;

  let status: AssignmentDisplayStatus;
  if (!attempt) {
    status = "not_started";
  } else if (isLocked) {
    status = "locked";
  } else if (isCompleted) {
    status = needsGradingCount > 0 ? "needs_grading" : integrity.reviewRecommended ? "needs_review" : anyReleased ? "feedback_released" : "completed";
  } else if (elapsed <= ACTIVE_NOW_MS) {
    status = "active_now";
  } else if (elapsed <= ACTIVE_RECENT_MS) {
    status = "active_recently";
  } else if (attempt?.securityReviewRequired) {
    status = "needs_review";
  } else if (elapsed >= STALE_MS && (attempt?.securityReviewRequired || integrity.attentionLevel === "high")) {
    status = "session_ended";
  } else if (elapsed >= STALE_MS) {
    status = "no_recent_work";
  } else if (hasDraft) {
    status = "draft_saved";
  } else if (attemptResponses.length > 0) {
    status = "in_progress";
  } else {
    status = "started_not_submitted";
  }

  // Score (assessment only).
  const scoreMax = getLessonMaxPoints(effectiveBlocks);
  const scoreEarned = attempt ? getAttemptEarnedPoints(attempt.id, input.responses) : null;
  const hasValidScore = isCompleted && scoreMax > 0 && scoreEarned !== null;

  const progressPct = isCompleted ? 100 : stepCount > 0 ? Math.min(100, Math.round((currentStepIndex / stepCount) * 100)) : 0;

  const markers = buildIntegrityMarkers(integrity, {
    studentId: student?.id,
    courseId: courseId || undefined,
    assignmentId: assignment?.id,
    lessonId,
  });

  return {
    studentId: student?.id,
    studentName: student?.name || student?.studentName || "Student",
    studentEmail: student?.email || student?.studentEmail || "",
    courseId,
    assignmentId: assignment?.id || attempt?.assignmentId || null,
    lessonId,
    lessonTitle: lesson?.title || assignment?.lessonTitle || "Lesson",
    attemptId: attempt?.id || null,
    lessonVersionId: versionId,
    status,
    statusLabel: assignmentStatusLabel(status),
    progressPct,
    currentStepIndex,
    stepCount,
    scoreEarned,
    scoreMax: scoreMax > 0 ? scoreMax : null,
    hasValidScore,
    needsGrading: needsGradingCount > 0,
    needsGradingCount,
    needsReview: integrity.reviewRecommended || !!attempt?.securityReviewRequired,
    feedbackReadyCount,
    feedbackNotReleasedCount,
    feedbackReleased: anyReleased,
    startedAt: attempt?.startedAt || null,
    completedAt: attempt?.completedAt || null,
    lastActivityAt,
    lastSignedInAt: student?.lastSignedInAt || null,
    isPreview: false,
    integrity,
    reliability: integrity.responseReliability,
    markers,
  };
}

// ---------------------------------------------------------------------------
// Review priority
// ---------------------------------------------------------------------------

export type ReviewPriority = "high" | "medium" | "low";

/** Order: AI-agent / high integrity > needs grading > feedback ready > low-level. */
export function deriveReviewPriority(summary: StudentAssignmentSummary): ReviewPriority {
  if (summary.integrity.aiAgentSignalCount > 0 || summary.integrity.attentionLevel === "high") return "high";
  if (summary.needsGradingCount > 0 || summary.integrity.attentionLevel === "moderate") return "medium";
  return "low";
}

export const PRIORITY_RANK: Record<ReviewPriority, number> = { high: 3, medium: 2, low: 1 };

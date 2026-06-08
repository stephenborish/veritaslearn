/**
 * Course Progress & Review Queue derivation — VERITAS Learn
 * ---------------------------------------------------------
 * Course-level aggregation across many assignments, plus the prioritised Review
 * Queue. Both are built ONLY from the shared StudentAssignmentSummary unit so
 * Course Progress, Gradebook, Lesson Tracking, and Review Queue cannot drift
 * apart in how they read the same underlying data.
 */

import {
  deriveStudentAssignmentSummary,
  deriveReviewPriority,
  PRIORITY_RANK,
  type StudentAssignmentSummary,
  type ReviewPriority,
} from "./teacherAnalytics";
import type { ResponseReliability } from "./integritySignals";

// ---------------------------------------------------------------------------
// Course matrix
// ---------------------------------------------------------------------------

export interface CourseAssignmentColumn {
  assignmentId: string;
  lessonId: string;
  title: string;
  dueAt?: string;
}

export interface StudentCourseSummary {
  studentId: string;
  studentName: string;
  studentEmail: string;
  totalAssignments: number;
  notStarted: number;
  inProgress: number;
  submitted: number;
  completed: number;
  needsGrading: number;
  needsReview: number;
  feedbackReleased: number;
  feedbackNotReleased: number;
  averagePercent: number | null;
  lastActivityAt: string | null;
  lastSignedInAt: string | null;
  reliability: ResponseReliability;
  integritySignalCount: number;
  highAttentionCount: number;
  aiAgentSignalCount: number;
  /** Number of distinct assignments carrying review-worthy integrity markers. */
  assignmentsWithReview: number;
  /** Per-assignment summaries keyed by assignmentId, for the matrix cells. */
  cells: { [assignmentId: string]: StudentAssignmentSummary };
}

export interface CourseProgressSummary {
  courseId: string;
  columns: CourseAssignmentColumn[];
  rows: StudentCourseSummary[];
  cards: {
    studentsEnrolled: number;
    activeAssignments: number;
    completionRate: number; // 0..1 across all student×assignment cells
    notStarted: number;
    inProgress: number;
    needsGrading: number;
    needsReview: number;
    feedbackNotReleased: number;
    integrityReviewItems: number;
  };
  integrity: {
    studentsNeedingReview: number;
    studentsWithRepeatedSignals: number;
    studentsWithAiAgentSignals: number;
    highestLoadAssignmentId: string | null;
    highestLoadAssignmentTitle: string | null;
    mostCommonSignalReason: string | null;
    headlines: string[];
  };
}

export interface CourseProgressInput {
  courseId: string;
  enrollments: any[];
  students: any[];
  assignments: any[];
  lessons: any[];
  blocks: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  activities?: any[];
  lessonVersions?: any[];
  nowMs?: number;
}

function lessonForAssignment(assignment: any, lessons: any[]): any {
  return lessons.find((l) => l?.id === assignment?.lessonId) || { id: assignment?.lessonId, title: assignment?.lessonTitle };
}

export function deriveCourseProgressSummary(input: CourseProgressInput): CourseProgressSummary {
  const courseAssignments = (input.assignments || [])
    .filter((a) => a?.courseId === input.courseId)
    .sort((a, b) => new Date(a.dueAt || a.createdAt || 0).getTime() - new Date(b.dueAt || b.createdAt || 0).getTime());

  const columns: CourseAssignmentColumn[] = courseAssignments.map((a) => ({
    assignmentId: a.id,
    lessonId: a.lessonId,
    title: a.lessonTitle || lessonForAssignment(a, input.lessons)?.title || "Assignment",
    dueAt: a.dueAt,
  }));

  // Roster: active enrollments for this course, joined to user records.
  const enrolled = (input.enrollments || []).filter(
    (e) => e?.courseId === input.courseId && e?.status !== "removed"
  );
  const studentList = enrolled.length
    ? enrolled.map((e) => {
        const u = (input.students || []).find((s) => s?.id === e.studentId);
        return u || { id: e.studentId, name: e.studentName, email: e.studentEmail };
      })
    : (input.students || []);

  const rows: StudentCourseSummary[] = [];
  let cellsCompleted = 0;
  let cellsTotal = 0;
  let cardNotStarted = 0;
  let cardInProgress = 0;
  let cardNeedsGrading = 0;
  let cardNeedsReview = 0;
  let cardFeedbackNotReleased = 0;
  let cardIntegrityItems = 0;
  const reasonCounts = new Map<string, number>();
  const loadByAssignment = new Map<string, number>();

  for (const student of studentList) {
    const cells: { [assignmentId: string]: StudentAssignmentSummary } = {};
    let notStarted = 0,
      inProgress = 0,
      submitted = 0,
      completed = 0,
      needsGrading = 0,
      needsReview = 0,
      feedbackReleased = 0,
      feedbackNotReleased = 0,
      integritySignalCount = 0,
      highAttentionCount = 0,
      aiAgentSignalCount = 0,
      assignmentsWithReview = 0;
    const percents: number[] = [];
    let lastActivityMs = 0;
    let worstReliability: ResponseReliability = "high";

    for (const assignment of courseAssignments) {
      const lesson = lessonForAssignment(assignment, input.lessons);
      const summary = deriveStudentAssignmentSummary({
        student,
        lesson,
        assignment,
        blocks: input.blocks,
        attempts: input.attempts,
        responses: input.responses,
        signals: input.signals,
        activities: input.activities,
        lessonVersions: input.lessonVersions,
        nowMs: input.nowMs,
      });
      cells[assignment.id] = summary;
      cellsTotal++;

      switch (summary.status) {
        case "not_started":
          notStarted++;
          cardNotStarted++;
          break;
        case "completed":
        case "feedback_released":
          completed++;
          cellsCompleted++;
          break;
        case "submitted":
          submitted++;
          break;
        default:
          inProgress++;
          cardInProgress++;
      }
      if (summary.status === "feedback_released") feedbackReleased++;
      if (summary.needsGrading) {
        needsGrading++;
        cardNeedsGrading++;
      }
      if (summary.feedbackNotReleasedCount > 0) {
        feedbackNotReleased++;
        cardFeedbackNotReleased++;
      }
      if (summary.integrity.reviewRecommended) {
        needsReview++;
        cardNeedsReview++;
        assignmentsWithReview++;
        cardIntegrityItems++;
        loadByAssignment.set(assignment.id, (loadByAssignment.get(assignment.id) || 0) + 1);
      }
      integritySignalCount += summary.integrity.totalSignals;
      if (summary.integrity.attentionLevel === "high") highAttentionCount++;
      aiAgentSignalCount += summary.integrity.aiAgentSignalCount;
      for (const reason of summary.integrity.topReasons) {
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
      if (summary.hasValidScore && summary.scoreMax) {
        percents.push((summary.scoreEarned || 0) / summary.scoreMax);
      }
      if (summary.lastActivityAt) {
        const t = new Date(summary.lastActivityAt).getTime();
        if (t > lastActivityMs) lastActivityMs = t;
      }
      if (summary.reliability === "needs_review") worstReliability = "needs_review";
      else if (summary.reliability === "moderate" && worstReliability === "high") worstReliability = "moderate";
    }

    rows.push({
      studentId: student.id,
      studentName: student.name || student.studentName || "Student",
      studentEmail: student.email || student.studentEmail || "",
      totalAssignments: courseAssignments.length,
      notStarted,
      inProgress,
      submitted,
      completed,
      needsGrading,
      needsReview,
      feedbackReleased,
      feedbackNotReleased,
      averagePercent: percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : null,
      lastActivityAt: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
      lastSignedInAt: student.lastSignedInAt || null,
      reliability: worstReliability,
      integritySignalCount,
      highAttentionCount,
      aiAgentSignalCount,
      assignmentsWithReview,
      cells,
    });
  }

  // Course-level integrity headlines.
  let highestLoadAssignmentId: string | null = null;
  let highestLoad = 0;
  for (const [aid, load] of loadByAssignment) {
    if (load > highestLoad) {
      highestLoad = load;
      highestLoadAssignmentId = aid;
    }
  }
  const highestLoadColumn = columns.find((c) => c.assignmentId === highestLoadAssignmentId) || null;

  let mostCommonSignalReason: string | null = null;
  let mostCommonCount = 0;
  for (const [reason, count] of reasonCounts) {
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonSignalReason = reason;
    }
  }

  const studentsNeedingReview = rows.filter((r) => r.needsReview > 0).length;
  const studentsWithRepeatedSignals = rows.filter((r) => r.assignmentsWithReview >= 2).length;
  const studentsWithAiAgentSignals = rows.filter((r) => r.aiAgentSignalCount > 0).length;

  const headlines: string[] = [];
  if (studentsNeedingReview > 0) {
    headlines.push(
      studentsWithRepeatedSignals > 0
        ? `${studentsWithRepeatedSignals} student${studentsWithRepeatedSignals === 1 ? "" : "s"} need review across multiple assignments`
        : `${studentsNeedingReview} student${studentsNeedingReview === 1 ? "" : "s"} need review`
    );
  }
  if (highestLoadColumn) {
    headlines.push(`${highestLoadColumn.title} has the highest review load`);
  }
  if (mostCommonSignalReason) {
    headlines.push(`Most common: ${mostCommonSignalReason}`);
  }
  if (studentsWithAiAgentSignals > 0) {
    headlines.push(
      `${studentsWithAiAgentSignals} student${studentsWithAiAgentSignals === 1 ? " has" : "s have"} Signals of AI Agent Use`
    );
  }

  return {
    courseId: input.courseId,
    columns,
    rows,
    cards: {
      studentsEnrolled: studentList.length,
      activeAssignments: courseAssignments.length,
      completionRate: cellsTotal ? cellsCompleted / cellsTotal : 0,
      notStarted: cardNotStarted,
      inProgress: cardInProgress,
      needsGrading: cardNeedsGrading,
      needsReview: cardNeedsReview,
      feedbackNotReleased: cardFeedbackNotReleased,
      integrityReviewItems: cardIntegrityItems,
    },
    integrity: {
      studentsNeedingReview,
      studentsWithRepeatedSignals,
      studentsWithAiAgentSignals,
      highestLoadAssignmentId,
      highestLoadAssignmentTitle: highestLoadColumn?.title || null,
      mostCommonSignalReason,
      headlines,
    },
  };
}

// ---------------------------------------------------------------------------
// Review Queue
// ---------------------------------------------------------------------------

export type ReviewQueueItemType =
  | "needs_grading"
  | "awaiting_teacher_review"
  | "feedback_ready"
  | "integrity_cluster"
  | "ai_agent"
  | "stuck";

export interface ReviewQueueItem {
  id: string;
  type: ReviewQueueItemType;
  priority: ReviewPriority;
  studentId: string;
  studentName: string;
  courseId: string | null;
  assignmentId: string | null;
  lessonId: string;
  lessonTitle: string;
  attemptId: string | null;
  stepId?: string;
  questionId?: string;
  responseId?: string;
  reason: string;
  attentionLabel: string;
  evidenceStrength?: string;
  lastActivityAt: string | null;
  summary: StudentAssignmentSummary;
}

const TYPE_LABEL: Record<ReviewQueueItemType, string> = {
  needs_grading: "Needs grading",
  awaiting_teacher_review: "Awaiting teacher review",
  feedback_ready: "Feedback ready to release",
  integrity_cluster: "Integrity signals",
  ai_agent: "Signals of AI Agent Use",
  stuck: "Student may be stuck",
};

export function reviewQueueTypeLabel(t: ReviewQueueItemType): string {
  return TYPE_LABEL[t];
}

/**
 * Turn a set of StudentAssignmentSummaries into a grouped, prioritised action
 * list. Each summary may yield several items (e.g. needs-grading + an AI-agent
 * cluster) but low-level raw events are NOT emitted individually.
 */
export function deriveReviewQueueItems(summaries: StudentAssignmentSummary[]): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];

  for (const s of summaries) {
    const base = {
      studentId: s.studentId,
      studentName: s.studentName,
      courseId: s.courseId,
      assignmentId: s.assignmentId,
      lessonId: s.lessonId,
      lessonTitle: s.lessonTitle,
      attemptId: s.attemptId,
      lastActivityAt: s.lastActivityAt,
      summary: s,
    };

    // AI agent clusters — always highest visibility, one item each.
    for (const cluster of s.integrity.clusters.filter((c) => c.isAiAgent)) {
      items.push({
        ...base,
        id: `rq-ai-${cluster.id}`,
        type: "ai_agent",
        priority: "high",
        stepId: cluster.stepId,
        questionId: cluster.questionId,
        responseId: cluster.responseId,
        reason: cluster.reason,
        attentionLabel: "Signals of AI Agent Use",
        evidenceStrength: s.integrity.evidenceStrength,
      });
    }

    // High/moderate integrity clusters (non-AI).
    for (const cluster of s.integrity.clusters.filter((c) => !c.isAiAgent && (c.attentionLevel === "high" || c.attentionLevel === "moderate"))) {
      items.push({
        ...base,
        id: `rq-int-${cluster.id}`,
        type: "integrity_cluster",
        priority: cluster.attentionLevel === "high" ? "high" : "medium",
        stepId: cluster.stepId,
        questionId: cluster.questionId,
        responseId: cluster.responseId,
        reason: cluster.reason,
        attentionLabel: cluster.attentionLevel === "high" ? "High attention" : "Review suggested",
        evidenceStrength: s.integrity.evidenceStrength,
      });
    }

    if (s.needsGradingCount > 0) {
      items.push({
        ...base,
        id: `rq-grade-${s.attemptId || s.studentId}-${s.assignmentId || s.lessonId}`,
        type: "needs_grading",
        priority: "medium",
        reason: `${s.needsGradingCount} response${s.needsGradingCount === 1 ? "" : "s"} awaiting grading`,
        attentionLabel: "Needs grading",
      });
    }

    if (s.feedbackReadyCount > 0) {
      items.push({
        ...base,
        id: `rq-feedback-${s.attemptId || s.studentId}-${s.assignmentId || s.lessonId}`,
        type: "feedback_ready",
        priority: "low",
        reason: `${s.feedbackReadyCount} reviewed response${s.feedbackReadyCount === 1 ? "" : "s"} ready to release`,
        attentionLabel: "Feedback ready",
      });
    }
  }

  return items.sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
  );
}

export { deriveReviewPriority };

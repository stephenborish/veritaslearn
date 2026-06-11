/**
 * Review model — shared, pure helpers for the teacher Student-Dossier review
 * workspace. These resolve immutable lesson-version snapshots first (falling back
 * to live block data), turn raw response records into teacher-friendly review
 * shapes, and compute class-comparison context.
 *
 * No teacher-only content (correct answers, rubrics, model answers, rationale,
 * notes) is ever placed on a student payload — these helpers only run inside the
 * teacher dossier and read data the teacher already holds.
 */
import { getPlainText } from "../../RichContent/RichContentRenderer";

export type QuestionKind = "mc" | "sa" | null;

/** A single navigable step in the student's lesson path (block or checkpoint). */
export interface StepDescriptor {
  id: string;
  blockId: string;
  checkpointId?: string;
  index: number;
  number: number;
  type: "video" | "reading" | "question" | "checkpoint" | string;
  title: string;
  isPractice: boolean;
  gradable: boolean;
  questionType: QuestionKind;
}

/** Everything needed to render a step's review surface, snapshot-resolved. */
export interface ResolvedStep {
  step: StepDescriptor;
  block: any;
  /** Immutable snapshot block when an attempt was pinned to a lesson version. */
  snapshotBlock: any;
  checkpoint: any;
  questionDef: any;
  response: any;
  maxPoints: number;
}

export function formatVideoTime(seconds: any): string {
  const n = Number(seconds);
  if (isNaN(n) || !isFinite(n) || seconds === undefined || seconds === null) return "0:00";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatActiveDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "Not recorded";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${rem}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function formatTimestamp(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Build the full ordered list of navigable steps, expanding video blocks into
 * their checkpoints. Mirrors the structure produced by TimelineGradebook so deep
 * links by stepId line up exactly.
 */
export function buildTimelineSteps(orderedBlocks: any[]): StepDescriptor[] {
  const steps: StepDescriptor[] = [];
  let n = 0;
  orderedBlocks.forEach((b) => {
    const qType = blockQuestionKind(b);
    steps.push({
      id: b.id,
      blockId: b.id,
      index: n,
      number: n + 1,
      type: b.type,
      title: b.title || (b.type === "video" ? "Video" : b.type === "question" ? "Question" : "Reading"),
      isPractice: !!b.isPractice,
      gradable: b.type === "question" && !b.isPractice,
      questionType: qType,
    });
    n++;
    if (b.type === "video" && Array.isArray(b.videoCheckpoints)) {
      const sorted = [...b.videoCheckpoints].sort(
        (c1: any, c2: any) => (c1.timestamp ?? c1.timeSeconds ?? 0) - (c2.timestamp ?? c2.timeSeconds ?? 0)
      );
      sorted.forEach((cp: any, idx) => {
        const cpQ = cp.question || cp.questions?.[0];
        steps.push({
          id: cp.id,
          blockId: b.id,
          checkpointId: cp.id,
          index: n,
          number: n + 1,
          type: "checkpoint",
          title: cp.title || `Checkpoint ${idx + 1}`,
          isPractice: !!cp.isPractice,
          gradable: !cp.isPractice && !!cpQ,
          questionType: cpQ?.type ?? null,
        });
        n++;
      });
    }
  });
  return steps;
}

function blockQuestionKind(block: any): QuestionKind {
  if (block?.type !== "question") return null;
  if (block.singleQuestion?.type) return block.singleQuestion.type;
  if (block.questionType) return block.questionType;
  const pooled = block.questionPool?.questions?.[0]?.type;
  return pooled ?? null;
}

export function findQuestionDef(block: any, response: any): any {
  if (!block) return null;
  if (!response) return block.singleQuestion || block.questionPool?.questions?.[0];
  const qId = response.questionId;
  if (block.singleQuestion && block.singleQuestion.id === qId) return block.singleQuestion;
  if (block.questionPool?.questions) {
    const found = block.questionPool.questions.find((q: any) => q.id === qId);
    if (found) return found;
  }
  return block.singleQuestion || block.questionPool?.questions?.[0];
}

export function findCheckpointQuestionDef(checkpoint: any, response: any): any {
  if (!checkpoint) return null;
  if (!response) return checkpoint.question || checkpoint.questions?.[0];
  const qId = response.questionId;
  if (checkpoint.question && checkpoint.question.id === qId) return checkpoint.question;
  if (checkpoint.questions) {
    const found = checkpoint.questions.find((q: any) => q.id === qId);
    if (found) return found;
  }
  return checkpoint.question || checkpoint.questions?.[0];
}

/** Resolve the student's selected choice to a canonical choice id (handles index fallbacks). */
export function selectedChoiceId(question: any, value: any): string {
  if (value === undefined || value === null) return "";
  const v = String(value);
  if (question?.choices?.some((c: any) => String(c.id) === v)) return v;
  const idx = Number(value);
  if (!isNaN(idx) && question?.choices?.[idx]) return String(question.choices[idx].id);
  return v;
}

export function choiceLetter(question: any, value: any): string | null {
  if (!question || !Array.isArray(question.choices) || value === undefined || value === null) return null;
  const v = String(value);
  let idx = question.choices.findIndex((c: any) => String(c.id) === v);
  if (idx !== -1) return String.fromCharCode(65 + idx);
  const num = Number(value);
  if (!isNaN(num) && question.choices[num]) return String.fromCharCode(65 + num);
  return null;
}

export function resolveChoiceText(block: any, value: any): string | null {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value);
  const pools = [
    block?.singleQuestion?.choices,
    ...(block?.questionPool?.questions || []).map((q: any) => q.choices),
    ...(block?.videoCheckpoints || []).flatMap((cp: any) =>
      [cp.question?.choices, ...(cp.questions || []).map((q: any) => q.choices)]
    ),
  ];
  for (const choices of pools) {
    if (Array.isArray(choices)) {
      const found = choices.find((c: any) => String(c.id) === v);
      if (found) return getPlainText(found.text);
    }
  }
  return null;
}

export type GradingState =
  | "not_submitted"
  | "draft"
  | "auto_scored"
  | "awaiting_ai"
  | "ai_scored"
  | "needs_review"
  | "reviewed"
  | "released";

export function gradingState(response: any, draftText?: string | null): GradingState {
  if (!response) return draftText && draftText.trim() !== "" ? "draft" : "not_submitted";

  const isReleased = !!(
    response.feedbackReleasedAt ||
    response.aiFeedbackReleasedAt ||
    response.feedbackVisibleToStudent
  );
  const isReviewed = !!(
    response.teacherReviewedAt ||
    (response.teacherOverrideScore !== null && response.teacherOverrideScore !== undefined) ||
    response.teacherOverride?.score !== undefined
  );

  // Multiple choice is auto-graded on submit and never waits on AI review.
  if (response.type === "mc") {
    if (isReleased) return "released";
    return isReviewed ? "reviewed" : "auto_scored";
  }

  if (isReleased) return "released";
  if (isReviewed) return "reviewed";
  const status = response.aiGrading?.status;
  if (status === "needs_review" || status === "failed") return "needs_review";
  if (status === "success") return "ai_scored";
  return "awaiting_ai";
}

export const GRADING_STATE_LABEL: Record<GradingState, string> = {
  not_submitted: "Not submitted",
  draft: "Draft saved",
  auto_scored: "Auto-scored",
  awaiting_ai: "Awaiting AI grading",
  ai_scored: "AI scored · awaiting review",
  needs_review: "Needs teacher review",
  reviewed: "Reviewed",
  released: "Feedback released",
};

/** Calm, professional colour tokens for each grading state pill. */
export function gradingStateTone(state: GradingState): { bg: string; text: string; border: string } {
  switch (state) {
    case "released":
      return { bg: "bg-emerald-600", text: "text-white", border: "border-transparent" };
    case "reviewed":
      return { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-200" };
    case "needs_review":
      return { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-300" };
    case "ai_scored":
      return { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" };
    case "awaiting_ai":
      return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    case "auto_scored":
      return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
    case "draft":
      return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
    default:
      return { bg: "bg-slate-100", text: "text-slate-500", border: "border-slate-200" };
  }
}

export function questionMaxPoints(question: any, block: any, isPractice: boolean): number {
  if (isPractice) return 0;
  if (question?.points !== undefined) return Number(question.points) || 0;
  return Number(block?.points) || Number(block?.singleQuestion?.points) || 0;
}

export interface StepResolveContext {
  blocks: any[];
  getSnapshotBlock: (blockId: string) => any;
  responses: any[];
  attempt: any;
  questionAssignments?: any[];
  gradebookResponseEntries?: any[];
}

/** Resolve a step to its snapshot-preferred block, checkpoint, question, response, and max points. */
export function resolveStep(step: StepDescriptor, ctx: StepResolveContext): ResolvedStep {
  const block = ctx.blocks.find((b) => b.id === step.blockId);
  const snapshotBlock = ctx.getSnapshotBlock(step.blockId) || block;

  if (step.checkpointId) {
    const liveCp = (block?.videoCheckpoints || []).find((c: any) => c.id === step.checkpointId);
    const snapCp = (snapshotBlock?.videoCheckpoints || []).find((c: any) => c.id === step.checkpointId) || liveCp;
    const response = ctx.responses.find((r) => r.blockId === step.blockId && r.checkpointId === step.checkpointId) || null;
    const questionDef = findCheckpointQuestionDef(snapCp, response);
    
    const isPractice = !!snapCp?.isPractice || step.isPractice;
    let maxPoints = 0;
    if (!isPractice) {
      const qAsg = (ctx.questionAssignments || []).find((qa: any) => 
        qa.attemptId === ctx.attempt?.id && 
        qa.blockId === step.blockId && 
        qa.checkpointId === step.checkpointId
      );
      maxPoints = resolveQuestionMaxPoints(snapshotBlock, snapCp, qAsg, response);
    }
    
    return { step, block, snapshotBlock, checkpoint: snapCp, questionDef, response, maxPoints };
  }

  const response = ctx.responses.find((r) => r.blockId === step.blockId && !r.checkpointId) || null;
  const questionDef = step.type === "question" ? findQuestionDef(snapshotBlock, response) : null;
  
  const isPractice = !!snapshotBlock?.isPractice || step.isPractice;
  let maxPoints = 0;
  if (step.type === "question" && !isPractice) {
    const qAsg = (ctx.questionAssignments || []).find((qa: any) => 
      qa.attemptId === ctx.attempt?.id && 
      qa.blockId === step.blockId && 
      !qa.checkpointId
    );
    maxPoints = resolveQuestionMaxPoints(snapshotBlock, null, qAsg, response);
  }
  
  return { step, block, snapshotBlock, checkpoint: null, questionDef, response, maxPoints };
}

/** Lightweight per-step row for the timeline and responses lists. */
export interface StepRow {
  step: StepDescriptor;
  response: any | null;
  hasResponse: boolean;
  questionType: QuestionKind;
  score: number | null;
  maxPoints: number;
  state: GradingState;
  signalCount: number;
  activeSeconds: number;
  submittedAt: string | null;
  reached: boolean;
}

export function buildStepRows(steps: StepDescriptor[], ctx: StepResolveContext, signals: any[]): StepRow[] {
  return steps.map((step) => {
    const resolved = resolveStep(step, ctx);
    const r = resolved.response;
    const draftText = r ? null : draftForBlock(ctx.attempt, resolved.snapshotBlock, resolved.checkpoint);
    const signalCount = signals.filter(
      (s) => s.blockId === step.blockId && (!step.checkpointId || s.checkpointId === step.checkpointId)
    ).length;
    const reachedIdx = ctx.attempt?.currentBlockIndex ?? -1;
    const blockIdx = ctx.blocks.findIndex((b) => b.id === step.blockId);
    return {
      step,
      response: r,
      hasResponse: !!r,
      questionType: resolved.questionDef?.type ?? step.questionType,
      score: r && typeof r.score === "number" ? r.score : null,
      maxPoints: resolved.maxPoints,
      state: gradingState(r, draftText),
      signalCount,
      activeSeconds: ctx.attempt?.blockTimeSpent?.[step.blockId] || 0,
      submittedAt: r?.submittedAt || r?.createdAt || null,
      reached: ctx.attempt?.status === "completed" || (blockIdx !== -1 && blockIdx <= reachedIdx),
    };
  });
}

export function draftForBlock(attempt: any, block: any, checkpoint: any): string | null {
  if (!attempt?.draftResponses) return null;
  const ids: string[] = [];
  const q = checkpoint || block;
  if (q?.singleQuestion?.id) ids.push(q.singleQuestion.id);
  if (q?.question?.id) ids.push(q.question.id);
  (q?.questionPool?.questions || []).forEach((x: any) => x?.id && ids.push(x.id));
  (q?.questions || []).forEach((x: any) => x?.id && ids.push(x.id));
  for (const id of ids) {
    if (attempt.draftResponses[id]) return attempt.draftResponses[id];
  }
  return null;
}

/** Class comparison for a single step, supporting teacher judgement. */
export interface ClassComparison {
  total: number;
  submitted: number;
  needsGrading: number;
  classAverage: number | null;
  classAveragePct: number | null;
  studentScore: number | null;
  studentPct: number | null;
  maxPoints: number;
  standing: "above" | "at" | "below" | null;
  withSignals: number;
  distribution: { label: string; count: number }[];
}

export function computeClassComparison(params: {
  step: StepDescriptor;
  lessonAttempts: any[];
  lessonResponses: any[];
  signals: any[];
  maxPoints: number;
  currentResponse: any;
}): ClassComparison {
  const { step, lessonAttempts, lessonResponses, signals, maxPoints, currentResponse } = params;
  const matches = (r: any) =>
    r.blockId === step.blockId &&
    (step.checkpointId ? r.checkpointId === step.checkpointId : !r.checkpointId);

  const stepResponses = lessonResponses.filter(matches);
  const total = lessonAttempts.length;
  const submitted = stepResponses.length;

  const needsGrading = stepResponses.filter((r) => gradingState(r) === "needs_review" || gradingState(r) === "awaiting_ai").length;

  const scored = stepResponses
    .map((r) => {
      const parts = resolveResponseScoreParts(r);
      return typeof parts.score === "number" ? parts.score : null;
    })
    .filter((s): s is number => s !== null);

  const resolvedCurrentParts = resolveResponseScoreParts(currentResponse);
  const resolvedMaxPoints = maxPoints > 0 ? maxPoints : (resolvedCurrentParts?.maxPoints || 0);

  const classAverage = scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
  const classAveragePct = classAverage !== null && resolvedMaxPoints > 0 ? Math.round((classAverage / resolvedMaxPoints) * 100) : null;

  const studentScore = currentResponse ? resolvedCurrentParts.score : null;
  const studentPct = studentScore !== null && resolvedMaxPoints > 0 ? Math.round((studentScore / resolvedMaxPoints) * 100) : null;

  let standing: ClassComparison["standing"] = null;
  if (studentScore !== null && classAverage !== null) {
    if (studentScore > classAverage + 0.001) standing = "above";
    else if (studentScore < classAverage - 0.001) standing = "below";
    else standing = "at";
  }

  const attemptIdsWithSignals = new Set(
    signals
      .filter((s) => s.blockId === step.blockId && (!step.checkpointId || s.checkpointId === step.checkpointId))
      .map((s) => s.attemptId)
  );
  const withSignals = attemptIdsWithSignals.size;

  // Simple score distribution buckets when gradable.
  const distribution: { label: string; count: number }[] = [];
  if (resolvedMaxPoints > 0 && scored.length > 0) {
    const buckets = [
      { label: "Full", test: (p: number) => p >= 0.999 },
      { label: "Partial", test: (p: number) => p > 0 && p < 0.999 },
      { label: "No credit", test: (p: number) => p <= 0 },
    ];
    buckets.forEach((b) => {
      distribution.push({ label: b.label, count: scored.filter((s) => b.test(s / resolvedMaxPoints)).length });
    });
  }

  return {
    total,
    submitted,
    needsGrading,
    classAverage,
    classAveragePct,
    studentScore,
    studentPct,
    maxPoints: resolvedMaxPoints,
    standing,
    withSignals,
    distribution,
  };
}

export function isAssessmentResponse(response: any, block?: any, checkpoint?: any): boolean {
  if (response) {
    if (response.gradingMode === "practice" || response.gradebookCategory === "practice") {
      return false;
    }
  }
  if (checkpoint && checkpoint.isPractice) return false;
  if (block && block.isPractice) return false;
  return true;
}

export function resolveQuestionMaxPoints(block: any, checkpoint: any, qAssignment?: any, response?: any): number {
  if (response && typeof response.maxPoints === "number" && response.maxPoints > 0) {
    return response.maxPoints;
  }
  if (qAssignment?.selectedQuestion) {
    const sq = qAssignment.selectedQuestion;
    if (Array.isArray(sq.rubricCategories) && sq.rubricCategories.length > 0) {
      return sq.rubricCategories.reduce((sum: number, r: any) => sum + (Number(r.maxPoints) || 0), 0);
    }
    if (typeof sq.points === "number" && sq.points > 0) {
      return sq.points;
    }
    if (typeof sq.points === "string" && !isNaN(Number(sq.points)) && Number(sq.points) > 0) {
      return Number(sq.points);
    }
  }
  
  // Resolve question definition
  let qDef = null;
  if (checkpoint) {
    qDef = findCheckpointQuestionDef(checkpoint, response);
  } else if (block) {
    qDef = findQuestionDef(block, response);
  }
  
  if (qDef) {
    if (Array.isArray(qDef.rubricCategories) && qDef.rubricCategories.length > 0) {
      return qDef.rubricCategories.reduce((sum: number, r: any) => sum + (Number(r.maxPoints) || 0), 0);
    }
    if (typeof qDef.points === "number" && qDef.points > 0) {
      return qDef.points;
    }
    if (typeof qDef.points === "string" && !isNaN(Number(qDef.points)) && Number(qDef.points) > 0) {
      return Number(qDef.points);
    }
  }
  
  return 0;
}

export function resolveResponseScoreParts(
  response?: any,
  gradebookEntry?: any,
  gradebookResponseEntry?: any,
  qAssignment?: any,
  questionDef?: any
): { score: number; maxPoints: number } {
  let score = 0;
  if (response) {
    if (typeof response.teacherOverrideScore === "number" && !isNaN(response.teacherOverrideScore)) {
      score = response.teacherOverrideScore;
    } else if (typeof response.score === "number" && !isNaN(response.score)) {
      score = response.score;
    }
  } else if (gradebookResponseEntry && typeof gradebookResponseEntry.score === "number" && !isNaN(gradebookResponseEntry.score)) {
    score = gradebookResponseEntry.score;
  }
  
  let maxPoints = 0;
  if (response && typeof response.maxPoints === "number" && response.maxPoints > 0) {
    maxPoints = response.maxPoints;
  } else if (gradebookResponseEntry && typeof gradebookResponseEntry.maxScore === "number" && gradebookResponseEntry.maxScore > 0) {
    maxPoints = gradebookResponseEntry.maxScore;
  } else if (qAssignment?.selectedQuestion) {
    const sq = qAssignment.selectedQuestion;
    if (Array.isArray(sq.rubricCategories) && sq.rubricCategories.length > 0) {
      maxPoints = sq.rubricCategories.reduce((sum: number, r: any) => sum + (Number(r.maxPoints) || 0), 0);
    } else if (typeof sq.points === "number" && sq.points > 0) {
      maxPoints = sq.points;
    } else if (typeof sq.points === "string" && !isNaN(Number(sq.points))) {
      maxPoints = Number(sq.points);
    }
  } else if (questionDef) {
    if (Array.isArray(questionDef.rubricCategories) && questionDef.rubricCategories.length > 0) {
      maxPoints = questionDef.rubricCategories.reduce((sum: number, r: any) => sum + (Number(r.maxPoints) || 0), 0);
    } else if (typeof questionDef.points === "number" && questionDef.points > 0) {
      maxPoints = questionDef.points;
    } else if (typeof questionDef.points === "string" && !isNaN(Number(questionDef.points))) {
      maxPoints = Number(questionDef.points);
    }
  }
  
  return { score, maxPoints };
}

export function resolveAttemptScoreParts(
  attempt: any,
  responses: any[],
  gradebookEntries: any[],
  gradebookResponseEntries: any[],
  qAssignments: any[],
  blocks: any[]
): { score: number; maxPoints: number } {
  const attemptId = attempt.id;
  const lessonId = attempt.lessonId;
  
  // Find gradebookEntry for this attempt
  const gEntry = (gradebookEntries || []).find((e: any) => e.attemptId === attemptId || (e.studentId === attempt.studentId && e.lessonId === lessonId));
  
  // 1. Calculate Score
  const attemptResponses = (responses || []).filter((r: any) => r.attemptId === attemptId);
  let totalScore = 0;
  
  attemptResponses.forEach((res: any) => {
    const block = (blocks || []).find((b: any) => b.id === res.blockId);
    let checkpoint = null;
    if (res.checkpointId && block && Array.isArray(block.videoCheckpoints)) {
      checkpoint = block.videoCheckpoints.find((c: any) => c.id === res.checkpointId);
    }
    
    if (isAssessmentResponse(res, block, checkpoint)) {
      const gRespEntry = (gradebookResponseEntries || []).find((gre: any) => gre.responseId === res.id);
      const qAsg = (qAssignments || []).find((qa: any) => qa.attemptId === attemptId && qa.blockId === res.blockId && (res.checkpointId ? qa.checkpointId === res.checkpointId : true));
      let qDef = checkpoint ? findCheckpointQuestionDef(checkpoint, res) : findQuestionDef(block, res);
      
      const parts = resolveResponseScoreParts(res, gEntry, gRespEntry, qAsg, qDef);
      totalScore += parts.score;
    }
  });
  
  // 2. Calculate Max Points
  let maxPoints = 0;
  if (gEntry && typeof gEntry.maxPoints === "number" && gEntry.maxPoints > 0) {
    maxPoints = gEntry.maxPoints;
  }
  
  if (maxPoints === 0) {
    const attemptAsgs = (qAssignments || []).filter((qa: any) => qa.attemptId === attemptId);
    let assignedMax = 0;
    
    attemptAsgs.forEach((qa: any) => {
      const block = (blocks || []).find((b: any) => b.id === qa.blockId);
      let checkpoint = null;
      if (qa.checkpointId && block && Array.isArray(block.videoCheckpoints)) {
        checkpoint = block.videoCheckpoints.find((c: any) => c.id === qa.checkpointId);
      }
      
      const isPractice = checkpoint ? !!checkpoint.isPractice : (block ? !!block.isPractice : false);
      if (!isPractice) {
        const matchingRes = attemptResponses.find((r: any) => r.blockId === qa.blockId && (qa.checkpointId ? r.checkpointId === qa.checkpointId : !r.checkpointId));
        let qDef = qa.selectedQuestion || (checkpoint ? findCheckpointQuestionDef(checkpoint, matchingRes) : findQuestionDef(block, matchingRes));
        const gRespEntry = matchingRes ? (gradebookResponseEntries || []).find((gre: any) => gre.responseId === matchingRes.id) : null;
        
        const parts = resolveResponseScoreParts(matchingRes, gEntry, gRespEntry, qa, qDef);
        assignedMax += parts.maxPoints;
      }
    });
    
    maxPoints = assignedMax;
  }
  
  if (maxPoints === 0) {
    const lessonBlocks = (blocks || []).filter((b: any) => b.lessonId === lessonId);
    let fallbackMax = 0;
    lessonBlocks.forEach((b: any) => {
      let subTotal = 0;
      if (b.type === "question" && !b.isPractice) {
        if (b.singleQuestion) {
          let pts = Number(b.singleQuestion.points) || 0;
          if (pts === 0 && Array.isArray(b.singleQuestion.rubricCategories)) {
            pts = b.singleQuestion.rubricCategories.reduce((s: number, r: any) => s + (Number(r.maxPoints) || 0), 0);
          }
          subTotal += pts;
        } else if (b.questionPool) {
          let perQ = Number(b.questionPool.questions?.[0]?.points) || 0;
          if (perQ === 0 && Array.isArray(b.questionPool.questions?.[0]?.rubricCategories)) {
            perQ = b.questionPool.questions[0].rubricCategories.reduce((s: number, r: any) => s + (Number(r.maxPoints) || 0), 0);
          }
          subTotal += perQ * (b.questionPool.numToSelect || 1);
        }
      }
      if (b.type === "video" && Array.isArray(b.videoCheckpoints)) {
        b.videoCheckpoints.forEach((cp: any) => {
          if (!cp.isPractice) {
            const cpQ = cp.question || cp.questions?.[0];
            if (cpQ) {
              let pts = Number(cpQ.points) || 0;
              if (pts === 0 && Array.isArray(cpQ.rubricCategories)) {
                pts = cpQ.rubricCategories.reduce((s: number, r: any) => s + (Number(r.maxPoints) || 0), 0);
              }
              subTotal += pts;
            }
          }
        });
      }
      fallbackMax += subTotal;
    });
    
    maxPoints = fallbackMax;
  }
  
  return { score: totalScore, maxPoints };
}

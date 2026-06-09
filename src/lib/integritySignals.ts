/**
 * Integrity Signal Engine — VERITAS Learn
 * ----------------------------------------
 * A single, reusable place where raw `SecuritySignal` activity records are turned
 * into teacher-facing *attention markers*, *signal clusters*, and *response
 * reliability* summaries.
 *
 * Design principles (see product spec sections 12, 13, 13B):
 *  - This is a support-for-judgement tool, NOT an accusation system. We never
 *    compute a "cheating probability" and never claim certainty.
 *  - Missing data lowers `dataCompleteness`; it does NOT raise suspicion.
 *  - Low-level isolated events are grouped/compressed so teachers are not flooded.
 *  - Direct Browser AI Guard evidence is surfaced as a distinct, highly-visible
 *    "Signals of AI Agent Use" marker — visible, but never labelled as confirmed
 *    cheating.
 *  - Every teacher screen (Course Progress, Lesson Tracking, Gradebook, Review
 *    Queue, Student Dossier) consumes THESE helpers rather than re-deriving its
 *    own interpretation of the same raw signals.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export type IntegrityAttentionLevel = "none" | "low" | "moderate" | "high";
export type EvidenceStrength = "limited" | "moderate" | "strong";
export type DataCompleteness = "low" | "medium" | "high";
export type ResponseReliability = "high" | "moderate" | "needs_review";

export type IntegritySignalCategory =
  | "focus"
  | "fullscreen"
  | "navigation"
  | "copy_paste"
  | "ai_agent"
  | "timing"
  | "technical"
  | "other";

/** A grouped, contextualised set of raw signals that share a category + location. */
export interface IntegritySignalCluster {
  id: string;
  category: IntegritySignalCategory;
  attentionLevel: IntegrityAttentionLevel;
  label: string;
  count: number;
  firstAt?: string;
  lastAt?: string;
  assignmentId?: string;
  attemptId?: string;
  lessonId?: string;
  lessonVersionId?: string;
  stepId?: string;
  blockId?: string;
  questionId?: string;
  responseId?: string;
  reason: string;
  isAiAgent: boolean;
}

export interface IntegritySignalSummary {
  totalSignals: number;
  groupedSignalCount: number;
  attentionLevel: IntegrityAttentionLevel;
  responseReliability: ResponseReliability;
  evidenceStrength: EvidenceStrength;
  dataCompleteness: DataCompleteness;
  reviewRecommended: boolean;
  topReasons: string[];
  aiAgentSignalCount: number;
  focusSignalCount: number;
  fullscreenSignalCount: number;
  copyPasteSignalCount: number;
  navigationSignalCount: number;
  repeatedEventCount: number;
  affectedAssignmentIds: string[];
  affectedStepIds: string[];
  affectedQuestionIds: string[];
  clusters: IntegritySignalCluster[];
}

// ---------------------------------------------------------------------------
// Reusable teacher attention markers (section 13B)
// ---------------------------------------------------------------------------

export type TeacherAttentionMarkerType =
  | "none"
  | "activity"
  | "grading"
  | "feedback"
  | "integrity"
  | "ai_agent"
  | "timing"
  | "technical";

export type TeacherAttentionMarkerLevel =
  | "none"
  | "info"
  | "low"
  | "moderate"
  | "high";

export interface TeacherAttentionMarker {
  id: string;
  type: TeacherAttentionMarkerType;
  level: TeacherAttentionMarkerLevel;
  label: string;
  shortLabel: string;
  reason: string;
  studentId: string;
  courseId?: string;
  assignmentId?: string;
  attemptId?: string;
  lessonId?: string;
  lessonVersionId?: string;
  stepId?: string;
  blockId?: string;
  questionId?: string;
  responseId?: string;
  firstAt?: string;
  lastAt?: string;
  count?: number;
  reviewRecommended: boolean;
  evidenceStrength?: EvidenceStrength;
  dataCompleteness?: DataCompleteness;
  /** Optional suggested teacher action, e.g. "Review response", "Run AI grading". */
  suggestedAction?: string;
}

// ---------------------------------------------------------------------------
// Raw event vocabulary → category, weight, AI-agent classification
// ---------------------------------------------------------------------------

interface SignalKind {
  category: IntegritySignalCategory;
  /** Relative academic-reliability weight. Session/technical noise is ~0. */
  weight: number;
  isAiAgent: boolean;
  label: string;
}

const SIGNAL_KINDS: Record<string, SignalKind> = {
  // --- Browser AI Guard direct hits — strongest academic-reliability evidence ---
  ai_guard_marker_in_answer: { category: "ai_agent", weight: 12, isAiAgent: true, label: "Browser AI Guard marker in answer" },
  hidden_assessment_text_in_answer: { category: "ai_agent", weight: 12, isAiAgent: true, label: "Assessment content detected in answer" },
  ai_guard_refusal_phrase_in_answer: { category: "ai_agent", weight: 11, isAiAgent: true, label: "AI refusal phrase in answer" },
  possible_ai_agent_use: { category: "ai_agent", weight: 9, isAiAgent: true, label: "Possible AI agent use" },
  // --- Response controls ---
  paste_blocked: { category: "copy_paste", weight: 3, isAiAgent: false, label: "Paste attempt blocked" },
  copy_blocked: { category: "copy_paste", weight: 2, isAiAgent: false, label: "Copy attempt blocked" },
  // --- Focus / visibility ---
  blur_focus_lost: { category: "focus", weight: 1, isAiAgent: false, label: "Focus lost" },
  visibilitychange: { category: "focus", weight: 1, isAiAgent: false, label: "Tab or window changed" },
  // --- Fullscreen ---
  fullscreen_exit: { category: "fullscreen", weight: 1.5, isAiAgent: false, label: "Fullscreen exited" },
  fullscreen_exited: { category: "fullscreen", weight: 1.5, isAiAgent: false, label: "Fullscreen exited" },
  // --- Navigation ---
  rapid_navigation: { category: "navigation", weight: 2, isAiAgent: false, label: "Fast navigation detected" },
  seek_attempt_blocked: { category: "navigation", weight: 1, isAiAgent: false, label: "Video seek attempt blocked" },
  context_menu_blocked: { category: "navigation", weight: 0.5, isAiAgent: false, label: "Right-click blocked" },
  // --- Status only (not an integrity concern) ---
  checkpoint_triggered: { category: "other", weight: 0, isAiAgent: false, label: "Checkpoint reached" },
};

const DEFAULT_KIND: SignalKind = { category: "other", weight: 1, isAiAgent: false, label: "Activity record" };

/** Public, defensive label resolver used across teacher screens. */
export function signalEventLabel(eventType: string): string {
  const kind = SIGNAL_KINDS[eventType];
  if (kind) return kind.label;
  return String(eventType || "Activity record").replace(/_/g, " ");
}

export function classifySignal(eventType: string): SignalKind {
  return SIGNAL_KINDS[eventType] || DEFAULT_KIND;
}

// ---------------------------------------------------------------------------
// Core: derive an integrity summary from a set of raw signals
// ---------------------------------------------------------------------------

export interface DeriveIntegrityOptions {
  /** Response submission timestamps keyed by blockId|checkpointId, for clustering. */
  responsesByStep?: { [stepKey: string]: { responseId?: string; questionId?: string; submittedAt?: string } };
  /** Whether enough surrounding telemetry exists (active time, activity records). */
  hasActivityTiming?: boolean;
  assignmentId?: string | null;
  lessonId?: string | null;
  lessonVersionId?: string | null;
  excludeDismissed?: boolean;
}

const ATTENTION_RANK: Record<IntegrityAttentionLevel, number> = { none: 0, low: 1, moderate: 2, high: 3 };

export function maxAttention(a: IntegrityAttentionLevel, b: IntegrityAttentionLevel): IntegrityAttentionLevel {
  return ATTENTION_RANK[a] >= ATTENTION_RANK[b] ? a : b;
}

function clusterReason(category: IntegritySignalCategory, count: number, isAiAgent: boolean): string {
  if (isAiAgent) {
    return count > 1
      ? `${count} Browser AI Guard signals appeared in submitted work — review may be useful.`
      : `A Browser AI Guard signal appeared in submitted work — review may be useful.`;
  }
  switch (category) {
    case "focus":
      return count > 2
        ? `Repeated focus changes (${count}) were recorded during the assignment.`
        : `${count === 1 ? "A focus change was" : `${count} focus changes were`} recorded.`;
    case "fullscreen":
      return count > 2
        ? `Repeated fullscreen exits (${count}) were recorded.`
        : `${count === 1 ? "One fullscreen exit was" : `${count} fullscreen exits were`} recorded.`;
    case "copy_paste":
      return `${count} copy/paste ${count === 1 ? "event was" : "events were"} recorded in a protected field.`;
    case "navigation":
      return `${count} navigation ${count === 1 ? "event was" : "events were"} recorded.`;
    default:
      return `${count} activity ${count === 1 ? "record" : "records"} available.`;
  }
}

/**
 * Build an IntegritySignalSummary from raw signals for one attempt (or any scope).
 * Signals are grouped by category + step location, compressed, and scored with a
 * transparent weighted model. AI Guard hits always escalate attention to "high".
 */
export function deriveIntegritySignalSummary(
  rawSignals: any[],
  options: DeriveIntegrityOptions = {}
): IntegritySignalSummary {
  const signals = (Array.isArray(rawSignals) ? rawSignals : []).filter((s) => {
    if (options.excludeDismissed && s.dismissedAt) return false;
    return true;
  });

  const empty: IntegritySignalSummary = {
    totalSignals: 0,
    groupedSignalCount: 0,
    attentionLevel: "none",
    responseReliability: "high",
    evidenceStrength: "limited",
    dataCompleteness: options.hasActivityTiming ? "medium" : "low",
    reviewRecommended: false,
    topReasons: [],
    aiAgentSignalCount: 0,
    focusSignalCount: 0,
    fullscreenSignalCount: 0,
    copyPasteSignalCount: 0,
    navigationSignalCount: 0,
    repeatedEventCount: 0,
    affectedAssignmentIds: [],
    affectedStepIds: [],
    affectedQuestionIds: [],
    clusters: [],
  };

  if (signals.length === 0) return empty;

  // Group by category + blockId(+checkpointId) so clusters map to a step/response.
  const groups = new Map<string, any[]>();
  for (const s of signals) {
    const kind = classifySignal(s?.eventType);
    if (kind.weight === 0 && !kind.isAiAgent) continue; // skip pure status events
    const stepId = s?.checkpointId ? `${s.blockId || ""}:${s.checkpointId}` : s?.blockId || "";
    const key = `${kind.category}|${stepId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const clusters: IntegritySignalCluster[] = [];
  let weightedScore = 0;
  let repeatedEventCount = 0;
  let aiAgentSignalCount = 0;
  let focusSignalCount = 0;
  let fullscreenSignalCount = 0;
  let copyPasteSignalCount = 0;
  let navigationSignalCount = 0;
  const affectedSteps = new Set<string>();
  const affectedQuestions = new Set<string>();

  for (const [key, members] of groups) {
    const first = members[0];
    const kind = classifySignal(first?.eventType);
    const count = members.length;
    const sorted = [...members].sort((a, b) =>
      String(a?.timestamp || "").localeCompare(String(b?.timestamp || ""))
    );
    const firstAt = sorted[0]?.timestamp;
    const lastAt = sorted[sorted.length - 1]?.timestamp;
    const blockId = first?.blockId || undefined;
    const checkpointId = first?.checkpointId || undefined;
    const stepId = checkpointId ? `${blockId || ""}:${checkpointId}` : blockId;

    // Repeated-event compression: 3+ of the same category at one location is a pattern.
    if (count >= 3) repeatedEventCount += count;

    // Tally category counts.
    if (kind.isAiAgent) aiAgentSignalCount += count;
    else if (kind.category === "focus") focusSignalCount += count;
    else if (kind.category === "fullscreen") fullscreenSignalCount += count;
    else if (kind.category === "copy_paste") copyPasteSignalCount += count;
    else if (kind.category === "navigation") navigationSignalCount += count;

    // Weighted contribution (square-root dampened so volume alone can't dominate).
    const contribution = kind.weight * Math.sqrt(count);
    weightedScore += contribution;

    // Cluster attention level.
    let level: IntegrityAttentionLevel = "low";
    if (kind.isAiAgent) {
      level = "high";
    } else if (count >= 3 && (kind.category === "focus" || kind.category === "fullscreen")) {
      level = "moderate";
    } else if (kind.category === "copy_paste" && count >= 2) {
      level = "moderate";
    } else if (count >= 5) {
      level = "moderate";
    }

    // Timing relevance: if a response was submitted close to these events, escalate.
    const stepKey = checkpointId ? `${blockId || ""}:${checkpointId}` : blockId || "";
    const stepResponse = options.responsesByStep?.[stepKey];
    if (stepResponse?.submittedAt && lastAt) {
      const dt = Math.abs(new Date(stepResponse.submittedAt).getTime() - new Date(lastAt).getTime());
      if (isFinite(dt) && dt <= 60_000 && !kind.isAiAgent && count >= 2) {
        level = maxAttention(level, "moderate");
        weightedScore += 2;
      }
    }

    if (stepId) affectedSteps.add(stepId);
    const qid = first?.metadata?.questionId || stepResponse?.questionId;
    if (qid) affectedQuestions.add(qid);

    clusters.push({
      id: `${first?.attemptId || "attempt"}-${key}`,
      category: kind.category,
      attentionLevel: level,
      label: kind.isAiAgent ? "Signals of AI Agent Use" : kind.label,
      count,
      firstAt,
      lastAt,
      assignmentId: options.assignmentId || first?.assignmentId || undefined,
      attemptId: first?.attemptId || undefined,
      lessonId: options.lessonId || undefined,
      lessonVersionId: options.lessonVersionId || undefined,
      stepId: stepId || undefined,
      blockId,
      questionId: qid,
      responseId: stepResponse?.responseId,
      reason: clusterReason(kind.category, count, kind.isAiAgent),
      isAiAgent: kind.isAiAgent,
    });
  }

  // Overall attention: AI agent always high; otherwise threshold the weighted score.
  let attentionLevel: IntegrityAttentionLevel = "none";
  if (aiAgentSignalCount > 0) {
    attentionLevel = "high";
  } else if (weightedScore >= 10) {
    attentionLevel = "high";
  } else if (weightedScore >= 5) {
    attentionLevel = "moderate";
  } else if (weightedScore > 0) {
    attentionLevel = "low";
  }
  // A single clustered moderate is enough to surface moderate overall.
  for (const c of clusters) attentionLevel = maxAttention(attentionLevel, c.attentionLevel === "high" ? "high" : c.attentionLevel === "moderate" ? maxAttention(attentionLevel, "moderate") : attentionLevel);

  // Response reliability mirrors attention but preserves uncertainty.
  let responseReliability: ResponseReliability = "high";
  if (attentionLevel === "high") responseReliability = "needs_review";
  else if (attentionLevel === "moderate") responseReliability = "moderate";

  // Evidence strength: AI guard hits are strong; clustered repeats moderate; else limited.
  let evidenceStrength: EvidenceStrength = "limited";
  if (aiAgentSignalCount > 0) evidenceStrength = "strong";
  else if (repeatedEventCount > 0 || weightedScore >= 6) evidenceStrength = "moderate";

  // Data completeness: timing telemetry raises confidence in the read.
  let dataCompleteness: DataCompleteness = options.hasActivityTiming ? "high" : "low";
  if (!options.hasActivityTiming && signals.length >= 3) dataCompleteness = "medium";

  // Top reasons: highest-attention clusters first.
  const topReasons = [...clusters]
    .sort((a, b) => ATTENTION_RANK[b.attentionLevel] - ATTENTION_RANK[a.attentionLevel] || b.count - a.count)
    .slice(0, 3)
    .map((c) => c.reason);

  const affectedAssignmentIds = Array.from(
    new Set(clusters.map((c) => c.assignmentId).filter(Boolean) as string[])
  );

  return {
    totalSignals: signals.length,
    groupedSignalCount: clusters.length,
    attentionLevel,
    responseReliability,
    evidenceStrength,
    dataCompleteness,
    reviewRecommended: attentionLevel === "moderate" || attentionLevel === "high",
    topReasons,
    aiAgentSignalCount,
    focusSignalCount,
    fullscreenSignalCount,
    copyPasteSignalCount,
    navigationSignalCount,
    repeatedEventCount,
    affectedAssignmentIds,
    affectedStepIds: Array.from(affectedSteps),
    affectedQuestionIds: Array.from(affectedQuestions),
    clusters: clusters.sort(
      (a, b) => ATTENTION_RANK[b.attentionLevel] - ATTENTION_RANK[a.attentionLevel] || b.count - a.count
    ),
  };
}

// ---------------------------------------------------------------------------
// Turning summaries into reusable attention markers
// ---------------------------------------------------------------------------

const CLUSTER_LEVEL_TO_MARKER: Record<IntegrityAttentionLevel, TeacherAttentionMarkerLevel> = {
  none: "none",
  low: "low",
  moderate: "moderate",
  high: "high",
};

/**
 * Convert an integrity summary into teacher attention markers (one per cluster,
 * with AI-agent clusters promoted to a distinct, highly-visible marker type).
 */
export function buildIntegrityMarkers(
  summary: IntegritySignalSummary,
  ctx: { studentId: string; courseId?: string; assignmentId?: string; lessonId?: string }
): TeacherAttentionMarker[] {
  const markers: TeacherAttentionMarker[] = [];
  for (const cluster of summary.clusters) {
    const isAi = cluster.isAiAgent;
    markers.push({
      id: `marker-${cluster.id}`,
      type: isAi ? "ai_agent" : "integrity",
      level: CLUSTER_LEVEL_TO_MARKER[cluster.attentionLevel],
      label: isAi ? "Signals of AI Agent Use" : cluster.label,
      shortLabel: isAi ? "AI Agent" : cluster.attentionLevel === "high" ? "High attention" : cluster.attentionLevel === "moderate" ? "Review suggested" : "Low attention",
      reason: cluster.reason,
      studentId: ctx.studentId,
      courseId: ctx.courseId,
      assignmentId: cluster.assignmentId || ctx.assignmentId,
      attemptId: cluster.attemptId,
      lessonId: cluster.lessonId || ctx.lessonId,
      lessonVersionId: cluster.lessonVersionId,
      stepId: cluster.stepId,
      blockId: cluster.blockId,
      questionId: cluster.questionId,
      responseId: cluster.responseId,
      firstAt: cluster.firstAt,
      lastAt: cluster.lastAt,
      count: cluster.count,
      reviewRecommended: cluster.attentionLevel === "moderate" || cluster.attentionLevel === "high",
      evidenceStrength: summary.evidenceStrength,
      dataCompleteness: summary.dataCompleteness,
      suggestedAction: isAi ? "Review response" : cluster.attentionLevel === "high" ? "Review response" : "Keep for review",
    });
  }
  return markers;
}

// ---------------------------------------------------------------------------
// Presentation helpers (consistent labels/colours across every screen)
// ---------------------------------------------------------------------------

export function reliabilityLabel(r: ResponseReliability): string {
  switch (r) {
    case "high": return "High reliability";
    case "moderate": return "Moderate reliability";
    case "needs_review": return "Needs review";
  }
}

export function attentionLabel(level: IntegrityAttentionLevel): string {
  switch (level) {
    case "none": return "No concern";
    case "low": return "Low attention";
    case "moderate": return "Review suggested";
    case "high": return "High attention";
  }
}

/** Tailwind colour tokens for a marker/attention level — keeps screens consistent. */
export function attentionColorClasses(level: IntegrityAttentionLevel): { text: string; bg: string; border: string; dot: string } {
  switch (level) {
    case "high":
      return { text: "text-red-700", bg: "bg-red-50", border: "border-red-300", dot: "bg-red-500" };
    case "moderate":
      return { text: "text-amber-800", bg: "bg-amber-50", border: "border-amber-300", dot: "bg-amber-500" };
    case "low":
      return { text: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400" };
    default:
      return { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500" };
  }
}

export function getSignalDetailedExplanation(eventType: string): { records: string; indicates: string; actionSuggestion: string } {
  const ctx = getDetailedSignalContext({ eventType }, []);
  return {
    records: ctx.records,
    indicates: ctx.indicates,
    actionSuggestion: ctx.actionSuggestion,
  };
}

export interface DetailedSignalContext {
  label: string;
  tooltip: string;
  records: string;
  indicates: string;
  actionSuggestion: string;
  isAssessment: boolean;
  activityType: string;
}

export function getDetailedSignalContext(signal: any, blocks: any[]): DetailedSignalContext {
  const eventType = signal.eventType || "";
  const matchingBlock = (blocks || []).find((b) => b.id === signal.blockId);
  
  let isAssessment = true; // default to assessment if unknown, or determine based on block
  let activityType = "lesson";

  if (matchingBlock) {
    if (matchingBlock.type === "video") {
      activityType = "video";
      if (signal.checkpointId) {
        const cp = (matchingBlock.videoCheckpoints || []).find((c: any) => c.id === signal.checkpointId);
        if (cp) {
          isAssessment = !cp.isPractice;
          activityType = cp.isPractice ? "practice checkpoint" : "assessment checkpoint";
        } else {
          isAssessment = !matchingBlock.isPractice;
        }
      } else {
        isAssessment = !matchingBlock.isPractice;
      }
    } else if (matchingBlock.type === "reading") {
      activityType = "reading";
      isAssessment = !matchingBlock.isPractice;
    } else if (matchingBlock.type === "question") {
      activityType = "question";
      isAssessment = !matchingBlock.isPractice;
    }
  }

  const activityName = isAssessment ? "assessment" : "practice/learning";

  let label = "Activity logged";
  let tooltip = "Ambient activity log in the student lesson flow.";
  let records = "Session activity record.";
  let indicates = "Ambient student interaction logged in the lesson telemetry queue.";
  let actionSuggestion = "Use to reconstruct their lesson path and study context.";

  switch (eventType) {
    case "blur_focus_lost":
    case "visibilitychange":
    case "blur":
    case "visibility_hidden":
    case "tab_change":
    case "focus_lost":
    case "window_blur":
      if (isAssessment) {
        label = "Browser tab focus lost during assessment";
        tooltip = "The student left the assessment workspace, minimizing full focus during a graded question or checkpoint. Teachers should check this to assess active focus integrity.";
      } else if (activityType === "video") {
        label = "Browser tab focus lost during instructional video";
        tooltip = "The student clicked away, opened a new tab, or minimized the window while the required video lesson was active. This suggests split attention during instruction.";
      } else if (activityType === "reading") {
        label = "Browser tab focus lost during reading assignment";
        tooltip = "The student switched tabs or minimized the reading content. Useful for tracking actual reading duration and cognitive engagement.";
      } else {
        label = "Browser tab focus lost during lesson practice";
        tooltip = "The student clicked away during practice tasks, showing potential distraction but no grade-altering impact.";
      }
      records = `Active window focus change detected during ${activityType} (student switched browser tabs, minimized active window, or clicked another application).`;
      indicates = `The student clicked away from the VERITAS player interface during ${isAssessment ? "a graded assessment" : "a learning activity"}. While common, frequent loss of focus during assessments can indicate searching for answers or side-task distractions.`;
      actionSuggestion = "Look closely at the student's active writing duration inside this step, and read written responses to verify if thoughts match their typical voice and tone.";
      break;

    case "fullscreen_exit":
    case "fullscreen_exited":
      if (isAssessment) {
        label = "Locked fullscreen mode exited during assessment";
        tooltip = "The student exited the full-screen view while actively answering a graded assessment or checkpoint. Highly relevant for tracking proctored task integrity.";
      } else {
        label = "Locked fullscreen mode exited during lesson";
        tooltip = "The student minimized or left full-screen view during general video or reading steps. Minimizes strict compliance but does not directly impact assessment reliability.";
      }
      records = "Left the dedicated full-screen learning window.";
      indicates = `The student deliberately minimized the application window or exited full-screen mode, which is requested to maintain a clean, distraction-free environment for ${isAssessment ? "graded questions" : "study material"}.`;
      actionSuggestion = "Verify if multiple exits occurred. Check whether the student completed the lesson steps in a reasonable timeframe or appeared to use external references.";
      break;

    case "paste_blocked":
    case "paste":
      if (isAssessment) {
        label = "Copy/Paste detected from external source during assessment";
        tooltip = "The student attempted to copy text from another browser tab or document and paste it directly into a graded answer field. Copy-pasting assessments is a strong signal for external resource usage.";
      } else {
        label = "Copy/Paste detected from external source during practice";
        tooltip = "The student pasted text into a practice or checkpoint writing field. While less strict, it indicates the student used pre-written or external notes rather than real-time typing.";
      }
      records = `A paste attempt into a protected ${isAssessment ? "graded short-answer" : "practice"} answer field was intercepted and blocked.`;
      indicates = "The student copied text from outside the lesson workspace and attempted to insert it as a direct answer, bypassing the required writing retrieval process.";
      actionSuggestion = "Review the written text in the Dossier (flagged red). Look for formal vocabulary shifts, unusual punctuation formats, or AI-like response architectures.";
      break;

    case "copy_blocked":
    case "copy":
      if (isAssessment) {
        label = "Copy attempt blocked on assessment prompt";
        tooltip = "The student highlighted text from a graded assessment question and tried to copy it. This is typically done to paste prompts into translate engines or AI portals.";
      } else {
        label = "Copy attempt blocked on lesson content";
        tooltip = "An attempt to copy reading paragraphs, video text, or instructions was blocked by the student player.";
      }
      records = `An attempt to copy secure ${isAssessment ? "assessment question" : "lesson instruction"} text fields was blocked.`;
      indicates = "The student tried to copy text from the browser viewport, which is common when attempting to feed questions into AI chat engines or translator tools.";
      actionSuggestion = "Cross-reference response speed and note if the student spent unusually short time on this block before submitting a complete answer.";
      break;

    case "rapid_navigation":
      label = "Rapid slide/step skipping (insufficient reading time)";
      tooltip = "The student clicked 'Next' or 'Continue' almost immediately (under 5s), spending virtually no active time reading the required materials.";
      records = "Unusually fast progression through materials before advancing.";
      indicates = "The student is rushing or skimming through slides, checklists, or reading sections without digesting the summer preparation details.";
      actionSuggestion = "View their total active lesson time. Suggest resetting progress if key readings show high skipping rates before school begins.";
      break;

    case "seek_attempt_blocked":
      label = "Video scrubbing/fast-forward attempt blocked";
      tooltip = "The student tried to fast-forward past un-watched teaching chapters. The player successfully blocked this and rewound them to their furthest watched point.";
      records = "The player blocked a seek event to skip required video content.";
      indicates = "The student tried to scrub past instructional chapters to bypass watching. The player successfully countered this, guarding learning completion.";
      actionSuggestion = "Ensure the video shows high completed watch percentages, validating that the student has received the prerequisite instruction.";
      break;

    case "possible_ai_agent_use":
    case "ai_guard_marker_in_answer":
    case "ai_guard_refusal_phrase_in_answer":
    case "hidden_assessment_text_in_answer":
    case "ai_agent_detected":
    case "ai_agent_use":
      label = "External language generator heuristics detected (AI Use)";
      tooltip = "Plagiarism checkers or browser AI guard engines detected structured AI signatures, refusal phrases, or hidden metadata inside the student response.";
      records = "Direct signature or chatbot output structures detected in writing.";
      indicates = "Strong heuristics that an AI engine (like ChatGPT, Claude, or browser chatbot extensions) generated or heavily assisted with writing this answer.";
      actionSuggestion = "Interview the student. AI-generated text has perfect grammar with minimal depth or contains characteristic conversational structures.";
      break;

    case "context_menu_blocked":
    case "right_click":
      label = "Right-click context menu blocked";
      tooltip = "The student attempted to right-click in the lesson viewer. Right-clicking is blocked to prevent inspection of element source codes or easy external search prompts.";
      records = "Right-click context menu was intercepted and blocked.";
      indicates = "The browser prevented opening secondary browser context overlays during lesson study.";
      actionSuggestion = "No correction generally needed; indicates standard lock-down constraint enforcement.";
      break;
  }

  return {
    label,
    tooltip,
    records,
    indicates,
    actionSuggestion,
    isAssessment,
    activityType
  };
}
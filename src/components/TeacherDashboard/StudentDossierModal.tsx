import { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Unlock,
  Send,
  AlertCircle,
  ShieldAlert,
  MessageSquare,
  ListChecks,
  CheckCircle2,
  Sparkles,
  ClipboardCheck,
  GraduationCap,
  Layers,
  Activity as ActivityIcon,
  BarChart,
  Target,
  Mail,
} from "lucide-react";
import { deriveIntegritySignalSummary, attentionColorClasses, attentionLabel, reliabilityLabel, signalEventLabel } from "../../lib/integritySignals";
import {
  buildTimelineSteps,
  buildStepRows,
  resolveStep,
  draftForBlock,
  computeClassComparison,
  gradingState,
  GRADING_STATE_LABEL,
  gradingStateTone,
  resolveAttemptScoreParts,
  resolveQuestionMaxPoints,
  type StepDescriptor,
  type StepResolveContext,
} from "./review/reviewModel";
import type { ReviewBinding, ReviewActionName } from "./review/reviewBinding";
import { StepReviewWorkspace } from "./review/StepReviewWorkspace";
import { LessonPathTimeline } from "./review/LessonPathTimeline";
import { SignalSummaryCard } from "./review/SignalSummaryCard";
import { ActivityTimelineCard } from "./review/ActivityTimelineCard";
import { ShortAnswerReviewCard } from "./review/ShortAnswerReviewCard";
import { MultipleChoiceReviewCard } from "./review/MultipleChoiceReviewCard";

/**
 * Ordered review context that lets the teacher move student-to-student without
 * leaving the dossier. The parent owns the list and the dossier renders prev/next
 * controls + a position label and calls `onSelect(index)` to switch.
 */
export interface DossierNavContext {
  entries: { studentId: string; lessonId: string; label?: string }[];
  index: number;
  label?: string;
  onSelect: (index: number) => void;
}

interface StudentDossierModalProps {
  studentId: string;
  lessonId: string;
  initialSection?: string;
  /** Optional block/step to focus on open (Gradebook cell / Review item deep-link). */
  initialStepId?: string;
  navContext?: DossierNavContext;
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
  assignments?: any[];
  studentActivities?: any[];
  lessonVersions?: any[];
  gradebookEntries?: any[];
  gradebookResponseEntries?: any[];
  questionAssignments?: any[];
  onClose: () => void;
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
  onReviewAction?: (action: ReviewActionName, responseId: string, payload?: any) => Promise<void>;
  onUnlockStudent?: (attemptId: string) => void;
  onForceSubmitStudent?: (attemptId: string) => Promise<void>;
  onRefresh?: () => void;
}

type DossierTab = "step" | "summary" | "timeline" | "responses" | "review" | "signals" | "activity" | "performance";

const TABS: { id: DossierTab; label: string; icon: any }[] = [
  { id: "step", label: "Step Review", icon: ClipboardCheck },
  { id: "summary", label: "Summary", icon: GraduationCap },
  { id: "performance", label: "Performance", icon: BarChart },
  { id: "timeline", label: "Timeline", icon: Layers },
  { id: "responses", label: "Responses", icon: MessageSquare },
  { id: "review", label: "Review", icon: ListChecks },
  { id: "signals", label: "Integrity Signals", icon: ShieldAlert },
  { id: "activity", label: "Activity Records", icon: ActivityIcon },
];

function sectionToTab(section?: string): DossierTab | null {
  if (!section) return null;
  if (section === "timeline") return "timeline";
  if (section === "responses") return "responses";
  if (section === "review") return "review";
  if (section === "signals" || section === "integrity") return "signals";
  if (section === "activity") return "activity";
  if (section === "summary") return "summary";
  if (section === "performance") return "performance";
  return null;
}

export default function StudentDossierModal({
  studentId,
  lessonId,
  initialSection,
  initialStepId,
  navContext,
  students,
  attempts,
  responses,
  signals,
  lessons,
  blocks,
  assignments = [],
  studentActivities = [],
  lessonVersions = [],
  gradebookEntries = [],
  gradebookResponseEntries = [],
  questionAssignments = [],
  onClose,
  onOverrideSave,
  onReviewAction,
  onUnlockStudent,
  onForceSubmitStudent,
  onRefresh,
}: StudentDossierModalProps) {
  // ---- Editing state (lifted so the unsaved-changes guard can see pending edits) ----
  const [overrideScores, setOverrideScores] = useState<{ [id: string]: number }>({});
  const [overrideNotes, setOverrideNotes] = useState<{ [id: string]: string }>({});
  const [editedFeedbacks, setEditedFeedbacks] = useState<{ [id: string]: string }>({});
  const [savingState, setSavingState] = useState<{ [id: string]: boolean }>({});
  const [saveSuccess, setSaveSuccess] = useState<{ [id: string]: boolean }>({});
  const [actionStates, setActionStates] = useState<{ [id: string]: { loading: boolean; success: boolean; error: string | null } }>({});

  const [unlocking, setUnlocking] = useState(false);
  const [isForceSubmitting, setIsForceSubmitting] = useState(false);
  const [togglingDoneSig, setTogglingDoneSig] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // ---- Resolve core records ----
  const attempt = attempts.find((a) => a.studentId === studentId && a.lessonId === lessonId);
  let student = students.find((s) => s.id === studentId);
  if (!student && attempt?.isPreviewAttempt) {
    student = { id: studentId, name: "Teacher Preview", email: "", role: "student" };
  }
  const lesson = lessons.find((l) => l.id === lessonId);

  // ---- Focus + scroll-lock lifecycle ----
  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    return () => {
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === "function") {
        previousActiveElement.current.focus();
      }
    };
  }, []);
  useEffect(() => {
    const original = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // ---- Lesson structure + steps (must run before any early return for hook order) ----
  const lessonBlocks = useMemo(
    () => blocks.filter((b) => b.lessonId === (lesson?.id || lessonId)),
    [blocks, lesson, lessonId]
  );
  const orderedSteps = useMemo(() => lessonBlocks.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [lessonBlocks]);
  const allTimelineSteps = useMemo<StepDescriptor[]>(() => buildTimelineSteps(orderedSteps), [orderedSteps]);

  const [activeStepId, setActiveStepId] = useState<string | null>(initialStepId || null);
  const [activeTab, setActiveTab] = useState<DossierTab>(() => {
    if (initialStepId) return "step";
    return sectionToTab(initialSection) || "summary";
  });

  // Default the active step to the deep-linked step, else the first step.
  useEffect(() => {
    if (!activeStepId && allTimelineSteps.length > 0) {
      setActiveStepId(initialStepId || allTimelineSteps[0].id);
    }
  }, [allTimelineSteps, initialStepId, activeStepId]);
  useEffect(() => {
    if (initialStepId) {
      setActiveStepId(initialStepId);
      setActiveTab("step");
    }
  }, [initialStepId]);

  const activeStepIndex = useMemo(
    () => (activeStepId ? allTimelineSteps.findIndex((s) => s.id === activeStepId) : -1),
    [activeStepId, allTimelineSteps]
  );

  const goToStep = (idx: number) => {
    if (idx < 0 || idx >= allTimelineSteps.length) return;
    setActiveStepId(allTimelineSteps[idx].id);
  };
  /** Retained for deep-link compatibility; focuses a step + the Step Review tab. */
  const scrollToStep = (stepId: string) => {
    setActiveStepId(stepId);
    setActiveTab("step");
  };

  // ---- Unsaved-change guard ----
  const sResponses = useMemo(() => responses.filter((r) => r.attemptId === attempt?.id), [responses, attempt]);

  const hasUnsavedChanges = () => {
    for (const [resId, val] of Object.entries(overrideScores)) {
      const resp = sResponses.find((r) => r.id === resId);
      if (!resp) continue;
      if (Number(val) !== Number(resp.teacherOverride?.score ?? resp.score ?? 0)) return true;
    }
    for (const [resId, val] of Object.entries(overrideNotes)) {
      const resp = sResponses.find((r) => r.id === resId);
      if (!resp) continue;
      if (val !== (resp.teacherOverride?.notes ?? resp.notes ?? "")) return true;
    }
    for (const [resId, val] of Object.entries(editedFeedbacks)) {
      const resp = sResponses.find((r) => r.id === resId);
      if (!resp) continue;
      if (val !== (resp.studentFacingFeedback || resp.aiFeedback || resp.aiGrading?.rationale || "")) return true;
    }
    return false;
  };
  const guardedAction = (action: () => void) => {
    if (hasUnsavedChanges()) {
      pendingActionRef.current = action;
      setShowDiscardConfirm(true);
    } else {
      action();
    }
  };
  const handleTryClose = () => guardedAction(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleTryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overrideScores, overrideNotes, editedFeedbacks, sResponses]);

  // ---- Early return (after all hooks) ----
  if (!student || !lesson || !attempt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center font-sans shadow-lg">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No active attempt found for this student.</p>
          <button onClick={onClose} className="mt-4 rounded bg-[#0A192F] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#15294b]">
            Close
          </button>
        </div>
      </div>
    );
  }

  // ---- Derived data ----
  const sSignals = signals.filter((s) => s.attemptId === attempt.id);
  const sActivities = studentActivities
    .filter((act: any) => act.studentId === studentId && act.attemptId === attempt.id)
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const assignment = attempt.assignmentId ? (assignments || []).find((a: any) => a.id === attempt.assignmentId) : null;
  const versionId = attempt.lessonVersionId || assignment?.lessonVersionId;
  const versionSnapshot = versionId ? (lessonVersions || []).find((v: any) => v.id === versionId) : null;
  const getSnapshotBlock = (bId: string) =>
    versionSnapshot?.blocksSnapshot ? versionSnapshot.blocksSnapshot.find((b: any) => b.id === bId) : null;

  const resolveCtx: StepResolveContext = {
    blocks: orderedSteps,
    getSnapshotBlock,
    responses: sResponses,
    attempt,
    questionAssignments,
    gradebookResponseEntries,
  };
  const stepRows = buildStepRows(allTimelineSteps, resolveCtx, sSignals);

  const integritySummary = deriveIntegritySignalSummary(sSignals, {
    hasActivityTiming: !!attempt.activeTimeSpent,
    excludeDismissed: true,
  });
  const aiGuardSignals = sSignals.filter((s) =>
    ["possible_ai_agent_use", "hidden_assessment_text_in_answer", "ai_guard_marker_in_answer", "ai_guard_refusal_phrase_in_answer"].includes(
      s.eventType
    )
  );
  // Count fullscreen exits across both the canonical and legacy event names so we
  // never under-count older activity records.
  const fullscreenExitCount = sSignals.filter(
    (s) => s.eventType === "fullscreen_exit" || s.eventType === "fullscreen_exited"
  ).length;

  // Score / status summary
  const attemptScoreParts = resolveAttemptScoreParts(
    attempt,
    responses,
    gradebookEntries,
    gradebookResponseEntries,
    questionAssignments,
    blocks
  );
  const maxLessonPoints = attemptScoreParts.maxPoints;
  const earnedPoints = attemptScoreParts.score;
  const scorePercentage = maxLessonPoints > 0 ? Math.round((earnedPoints / maxLessonPoints) * 100) : 0;

  const asg = (assignments || []).find((a: any) => a.lessonId === lesson.id);
  const isPastDue = asg?.dueAt && new Date(asg.dueAt) < new Date();
  const hasPendingResponses = stepRows.some(
    (r) => r.step.gradable && r.questionType === "sa" && r.hasResponse && r.state !== "reviewed" && r.state !== "released"
  );

  let finalStatus: "not_started" | "in_progress" | "completed" | "pending" | "missing" | "excused" = "not_started";
  const overrideStatus = attempt.gradebookStatusOverride || null;
  if (overrideStatus && overrideStatus !== "default") {
    finalStatus = overrideStatus;
  } else if (attempt.status === "completed") {
    finalStatus = hasPendingResponses ? "pending" : "completed";
  } else {
    finalStatus = isPastDue ? "missing" : hasPendingResponses ? "pending" : "in_progress";
  }
  const isCompleted = attempt.status === "completed";

  const statusBadge = {
    excused: "bg-purple-100 text-purple-800 border-purple-300",
    missing: "bg-rose-100 text-rose-800 border-rose-300",
    pending: "bg-amber-100 text-amber-800 border-amber-300",
    completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
    in_progress: "bg-blue-100 text-blue-800 border-blue-300",
    not_started: "bg-slate-100 text-slate-700 border-slate-300",
  }[finalStatus];
  const statusLabel = {
    excused: "Excused",
    missing: "Missing",
    pending: "Needs review",
    completed: "Submitted",
    in_progress: "In progress",
    not_started: "Not started",
  }[finalStatus];

  // ---- Active step resolution ----
  const activeStep = allTimelineSteps.find((s) => s.id === activeStepId) || allTimelineSteps[0] || null;
  const resolvedActive = activeStep ? resolveStep(activeStep, resolveCtx) : null;
  const activeDraft = resolvedActive && !resolvedActive.response
    ? draftForBlock(attempt, resolvedActive.snapshotBlock, resolvedActive.checkpoint)
    : null;
  const activeStepSignals = activeStep
    ? sSignals.filter((s) => s.blockId === activeStep.blockId && (!activeStep.checkpointId || s.checkpointId === activeStep.checkpointId))
    : [];

  // Class comparison context (real attempts on this lesson).
  const lessonAttempts = attempts.filter((a: any) => a.lessonId === lesson.id);
  const lessonAttemptIds = new Set(lessonAttempts.map((a: any) => a.id));
  const lessonResponses = responses.filter((r: any) => lessonAttemptIds.has(r.attemptId));
  const lessonSignals = signals.filter((s: any) => lessonAttemptIds.has(s.attemptId));
  const activeComparison =
    activeStep && resolvedActive && activeStep.gradable
      ? computeClassComparison({
          step: activeStep,
          lessonAttempts,
          lessonResponses,
          signals: lessonSignals,
          maxPoints: resolvedActive.maxPoints,
          currentResponse: resolvedActive.response,
        })
      : null;

  // ---- Handlers ----
  const handleSaveOverrideAndNotes = async (responseId: string, maxPoints: number) => {
    const existing = sResponses.find((r) => r.id === responseId);
    const rawScore = overrideScores[responseId];
    const resolvedScore = rawScore !== undefined ? rawScore : existing?.teacherOverride?.score ?? existing?.score ?? 0;
    const clamped = Math.max(0, Math.min(maxPoints || 0, resolvedScore));
    const rawNotes = overrideNotes[responseId];
    const resolvedNotes = rawNotes !== undefined ? rawNotes : existing?.teacherOverride?.notes ?? existing?.notes ?? "";

    setSavingState((p) => ({ ...p, [responseId]: true }));
    try {
      await onOverrideSave(responseId, clamped, resolvedNotes);
      setSaveSuccess((p) => ({ ...p, [responseId]: true }));
      if (onRefresh) onRefresh();
      setTimeout(() => setSaveSuccess((p) => ({ ...p, [responseId]: false })), 4000);
    } catch (err) {
      console.error("Score override failed:", err);
      setActionStates((p) => ({ ...p, [responseId]: { loading: false, success: false, error: "Save failed — try again." } }));
    } finally {
      setSavingState((p) => ({ ...p, [responseId]: false }));
    }
  };

  const executeReviewAction = async (action: ReviewActionName, responseId: string) => {
    if (!onReviewAction) return;
    setActionStates((p) => ({ ...p, [responseId]: { loading: true, success: false, error: null } }));
    try {
      let payload: any = {};
      if (action === "release-feedback") {
        payload = {
          studentFacingFeedback:
            editedFeedbacks[responseId] !== undefined
              ? editedFeedbacks[responseId]
              : sResponses.find((r) => r.id === responseId)?.studentFacingFeedback || "",
        };
      } else if (action === "mark-reviewed") {
        payload = { teacherOnlyNotes: overrideNotes[responseId] || "" };
      }
      await onReviewAction(action, responseId, payload);
      setActionStates((p) => ({ ...p, [responseId]: { loading: false, success: true, error: null } }));
      if (onRefresh) onRefresh();
      setTimeout(() => setActionStates((p) => ({ ...p, [responseId]: { loading: false, success: false, error: null } })), 2000);
    } catch (err: any) {
      setActionStates((p) => ({ ...p, [responseId]: { loading: false, success: false, error: err?.message || "Action failed" } }));
    }
  };

  const handleForceSubmit = async () => {
    if (!attempt || !onForceSubmitStudent) return;
    if (!window.confirm("Force submit this student's draft attempt? This grades current draft answers and marks the lesson completed.")) return;
    setIsForceSubmitting(true);
    try {
      await onForceSubmitStudent(attempt.id);
    } catch (e) {
      console.error(e);
    } finally {
      setIsForceSubmitting(false);
    }
  };

  const handleToggleSignal = async (sigId: string) => {
    const token = localStorage.getItem("idToken");
    if (!token) return;
    setTogglingDoneSig(sigId);
    try {
      const res = await fetch(`/api/integrity-signals/${sigId}/toggle-dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (res.ok && onRefresh) onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setTogglingDoneSig(null);
    }
  };

  // ---- Review binding ----
  const review: ReviewBinding = {
    overrideScores,
    overrideNotes,
    editedFeedbacks,
    savingState,
    saveSuccess,
    actionStates,
    setOverrideScore: (id, v) => setOverrideScores((p) => ({ ...p, [id]: v })),
    setOverrideNote: (id, v) => setOverrideNotes((p) => ({ ...p, [id]: v })),
    setEditedFeedback: (id, v) => setEditedFeedbacks((p) => ({ ...p, [id]: v })),
    saveOverride: handleSaveOverrideAndNotes,
    reviewAction: executeReviewAction,
    canReviewAction: !!onReviewAction,
  };

  // ---- Student-to-student nav ----
  const navEntries = navContext?.entries || [];
  const navIndex = navContext?.index ?? -1;
  const canNavPrev = !!navContext && navIndex > 0;
  const canNavNext = !!navContext && navIndex >= 0 && navIndex < navEntries.length - 1;
  const goToNavIndex = (idx: number) => {
    if (!navContext || idx < 0 || idx >= navEntries.length || idx === navIndex) return;
    guardedAction(() => navContext.onSelect(idx));
  };

  const focusStep = (stepId: string) => {
    setActiveStepId(stepId);
    setActiveTab("step");
  };

  const initials = student.name ? student.name.substring(0, 2).toUpperCase() : "ST";
  const reviewRows = stepRows.filter(
    (r) => r.step.gradable && r.hasResponse && (r.state === "needs_review" || r.state === "ai_scored" || r.state === "awaiting_ai")
  );

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleTryClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 font-sans backdrop-blur-[2px]"
    >
      <div className="flex h-[93vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-slate-800 shadow-2xl">
        {/* ---------- Header ---------- */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-xl bg-[#0A192F] text-base font-bold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[17px] font-bold tracking-tight text-slate-900">{student.name}</h2>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadge}`}>{statusLabel}</span>
                  {attempt.isPreviewAttempt && (
                    <span className="rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                      Preview
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 truncate text-[12.5px] text-slate-500">
                  <span className="font-semibold text-slate-600">{lesson.title}</span>
                  {student.email && <span className="text-slate-300">·</span>}
                  {student.email && <span className="truncate text-slate-400">{student.email}</span>}
                </p>
                {activeStep && (
                  <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    Reviewing · {activeStep.type === "checkpoint" ? "Check" : "Step"} {activeStep.number}: {activeStep.title}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {/* Progress + score summary */}
              <div className="hidden flex-col items-end lg:flex">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Progress</span>
                <span className="text-[13px] font-bold text-slate-700">
                  {Math.min((attempt.currentBlockIndex ?? 0) + 1, orderedSteps.length)} / {orderedSteps.length} steps
                </span>
              </div>
              <div className="hidden flex-col items-end border-l border-slate-200 pl-3 lg:flex">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Score</span>
                <span className="text-[13px] font-bold text-indigo-700 tabular-nums">
                  {finalStatus === "excused" ? "Excused" : finalStatus === "missing" ? "Missing" : `${earnedPoints} / ${maxLessonPoints} · ${scorePercentage}%`}
                </span>
              </div>

              {/* Student nav */}
              {navContext && navEntries.length > 0 && (
                <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
                  <button
                    type="button"
                    onClick={() => goToNavIndex(navIndex - 1)}
                    disabled={!canNavPrev}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                    title="Previous student"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="hidden text-[11px] font-bold tabular-nums text-slate-400 md:inline">
                    {navIndex + 1}/{navEntries.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToNavIndex(navIndex + 1)}
                    disabled={!canNavNext}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                    title="Next student"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              <button
                onClick={handleTryClose}
                className="rounded-lg border border-slate-200 p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Quick action banners */}
          {(!isCompleted && onForceSubmitStudent) || attempt.lockState === "locked_awaiting_teacher" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!isCompleted && onForceSubmitStudent && (
                <button
                  type="button"
                  onClick={handleForceSubmit}
                  disabled={isForceSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11.5px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {isForceSubmitting ? "Submitting…" : "Force submit & grade draft"}
                </button>
              )}
              {attempt.lockState === "locked_awaiting_teacher" && onUnlockStudent && (
                <button
                  type="button"
                  onClick={async () => {
                    setUnlocking(true);
                    try {
                      await onUnlockStudent(attempt.id);
                    } finally {
                      setUnlocking(false);
                    }
                  }}
                  disabled={unlocking}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                >
                  <Unlock className="h-3.5 w-3.5" /> {unlocking ? "Unlocking…" : "Allow student to resume"}
                </button>
              )}
            </div>
          ) : null}
        </header>

        {/* ---------- Tabs ---------- */}
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            const badge =
              t.id === "review" ? reviewRows.length : t.id === "signals" ? integritySummary.groupedSignalCount : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-[12.5px] font-semibold transition ${
                  active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {badge > 0 && (
                  <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ---------- Body ---------- */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Step nav strip (Step Review tab) */}
          {activeTab === "step" && allTimelineSteps.length > 0 && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <button
                type="button"
                onClick={() => goToStep(activeStepIndex <= 0 ? 0 : activeStepIndex - 1)}
                disabled={activeStepIndex <= 0}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                title="Previous step"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <select
                value={activeStepIndex < 0 ? "" : activeStepIndex}
                onChange={(e) => goToStep(Number(e.target.value))}
                className="flex-1 cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {allTimelineSteps.map((s, i) => (
                  <option key={s.id} value={i}>
                    {s.type === "checkpoint" ? "Check" : "Step"} {i + 1} of {allTimelineSteps.length}: {s.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => goToStep(activeStepIndex < 0 ? 0 : activeStepIndex + 1)}
                disabled={activeStepIndex < 0 || activeStepIndex === allTimelineSteps.length - 1}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                title="Next step"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {activeTab === "step" &&
            (resolvedActive ? (
              <StepReviewWorkspace
                resolved={resolvedActive}
                review={review}
                comparison={activeComparison}
                stepSignals={activeStepSignals}
                blocks={orderedSteps}
                activeSeconds={attempt.blockTimeSpent?.[resolvedActive.step.blockId] || 0}
                hasActivityTiming={!!attempt.activeTimeSpent}
                draftText={activeDraft}
              />
            ) : (
              <EmptyState label="This lesson has no steps to review." />
            ))}

          {activeTab === "summary" && (
            <SummaryTab
              attempt={attempt}
              student={student}
              lesson={lesson}
              integritySummary={integritySummary}
              earnedPoints={earnedPoints}
              maxLessonPoints={maxLessonPoints}
              scorePercentage={scorePercentage}
              finalStatus={finalStatus}
              stepRows={stepRows}
              reviewCount={reviewRows.length}
              onGoReview={() => setActiveTab("review")}
              onGoSignals={() => setActiveTab("signals")}
            />
          )}

          {activeTab === "timeline" && (
            <div className="space-y-3">
              <p className="text-[12.5px] text-slate-500">The student's path through this lesson. Select any step to review it.</p>
              <LessonPathTimeline rows={stepRows} activeStepId={activeStepId} onSelect={focusStep} />
            </div>
          )}

          {activeTab === "responses" && <ResponsesTab rows={stepRows} onFocus={focusStep} />}

          {activeTab === "review" && (
            <ReviewCommandCenter
              reviewRows={reviewRows}
              resolveCtx={resolveCtx}
              review={review}
              attempt={attempt}
              onFocus={focusStep}
            />
          )}

          {activeTab === "signals" && (
            <div className="space-y-4">
              {fullscreenExitCount > 0 && (
                <p className="text-[11.5px] font-medium text-slate-500">
                  Fullscreen exits recorded: <span className="font-bold text-slate-700">{fullscreenExitCount}</span>
                </p>
              )}
              {aiGuardSignals.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                  <div className="flex items-center gap-2 text-[12.5px] font-bold text-violet-700">
                    <Sparkles className="h-4 w-4" /> {aiGuardSignals.length} signals of AI agent use
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-violet-900/80">
                    The assessment guard recorded the following on submitted work:{" "}
                    {Array.from(new Set(aiGuardSignals.map((s) => signalEventLabel(s.eventType)))).join(", ")}.
                    This is not automatic proof of a violation — review the student's response alongside these records and use your judgement.
                  </p>
                </div>
              )}
              <SignalSummaryCard
                signals={sSignals}
                blocks={orderedSteps}
                hasActivityTiming={!!attempt.activeTimeSpent}
                onToggleSignal={handleToggleSignal}
                togglingId={togglingDoneSig}
              />
            </div>
          )}

          {activeTab === "activity" && <ActivityTimelineCard attempt={attempt} student={student} activities={sActivities} />}
          {activeTab === "performance" && (
            <PerformanceTab 
              studentId={studentId}
              student={student}
              attempts={attempts}
              responses={responses}
              lessons={lessons}
              blocks={blocks}
              assignments={assignments}
              gradebookEntries={gradebookEntries}
              gradebookResponseEntries={gradebookResponseEntries}
              questionAssignments={questionAssignments}
            />
          )}
        </div>

        {/* ---------- Discard confirm ---------- */}
        {showDiscardConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
              <h4 className="text-base font-bold text-slate-900">Discard unsaved changes?</h4>
              <p className="text-sm font-medium leading-relaxed text-slate-600">
                You have unsaved scores, notes, or feedback. Moving away will discard them.
              </p>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    pendingActionRef.current = null;
                    setShowDiscardConfirm(false);
                  }}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    const action = pendingActionRef.current || onClose;
                    pendingActionRef.current = null;
                    action();
                  }}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-700"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
      <CheckCircle2 className="mb-2 h-8 w-8 text-slate-300" />
      <p className="text-[13px] font-medium text-slate-400">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary tab
// ---------------------------------------------------------------------------
function SummaryTab({
  attempt,
  student,
  lesson,
  integritySummary,
  earnedPoints,
  maxLessonPoints,
  scorePercentage,
  finalStatus,
  stepRows,
  reviewCount,
  onGoReview,
  onGoSignals,
}: any) {
  const colors = attentionColorClasses(integritySummary.attentionLevel);
  const completed = stepRows.filter((r: any) => r.hasResponse || (!r.step.gradable && r.reached)).length;
  const activeMin = Math.floor((attempt.activeTimeSpent || 0) / 60);

  return (
    <div className="space-y-5">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryStat label="Score" value={finalStatus === "excused" ? "Excused" : finalStatus === "missing" ? "Missing" : `${earnedPoints}/${maxLessonPoints}`} sub={`${scorePercentage}%`} tone="indigo" />
        <SummaryStat label="Progress" value={`${completed}/${stepRows.length}`} sub="steps reached" />
        <SummaryStat label="Active time" value={`${activeMin}m`} sub="working" />
        <SummaryStat label="Needs review" value={String(reviewCount)} sub="responses" tone={reviewCount > 0 ? "amber" : "slate"} />
      </div>

      {/* Integrity reliability */}
      <div className={`rounded-xl border ${colors.border} ${colors.bg} px-4 py-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide ${colors.text}`}>
              <span className={`h-2 w-2 rounded-full ${colors.dot}`} /> {attentionLabel(integritySummary.attentionLevel)}
            </span>
            <span className="text-[12px] font-semibold text-slate-500">
              Reliability: <span className="text-slate-700">{reliabilityLabel(integritySummary.responseReliability)}</span>
            </span>
          </div>
          <button onClick={onGoSignals} className="text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-800">
            View signals →
          </button>
        </div>
      </div>

      {/* What to do next */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h4 className="text-[13px] font-bold text-slate-700">What to do next</h4>
        <ul className="mt-3 space-y-2 text-[12.5px] text-slate-600">
          {reviewCount > 0 ? (
            <li className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2">
              <span className="flex items-center gap-2 font-medium text-amber-800">
                <ListChecks className="h-4 w-4" /> {reviewCount} response{reviewCount === 1 ? "" : "s"} need grading or review
              </span>
              <button onClick={onGoReview} className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700">
                Open Review
              </button>
            </li>
          ) : (
            <li className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> All gradable work has been reviewed.
            </li>
          )}
          {integritySummary.aiAgentSignalCount > 0 && (
            <li className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 font-medium text-violet-800">
              <Sparkles className="h-4 w-4" /> {integritySummary.aiAgentSignalCount} signal(s) of AI agent use — worth a closer look.
            </li>
          )}
        </ul>
      </div>

      {lesson.description && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lesson</span>
          <h4 className="mt-0.5 text-[14px] font-bold text-slate-800">{lesson.title}</h4>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
            {typeof lesson.description === "string" ? lesson.description : lesson.description?.plainText || ""}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: "slate" | "indigo" | "amber" }) {
  const color = tone === "indigo" ? "text-indigo-700" : tone === "amber" ? "text-amber-700" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-[20px] font-bold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="block text-[10.5px] text-slate-400">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responses tab
// ---------------------------------------------------------------------------
function ResponsesTab({ rows, onFocus }: { rows: any[]; onFocus: (id: string) => void }) {
  const gradable = rows.filter((r) => r.step.gradable);
  const groups = [
    { key: "review", label: "Needs teacher review", rows: gradable.filter((r) => r.hasResponse && (r.state === "needs_review" || r.state === "awaiting_ai" || r.state === "ai_scored")) },
    { key: "sa", label: "Short answer", rows: gradable.filter((r) => r.questionType === "sa") },
    { key: "mc", label: "Multiple choice", rows: gradable.filter((r) => r.questionType === "mc") },
    { key: "practice", label: "Practice", rows: rows.filter((r) => r.step.isPractice && r.step.type !== "video") },
  ].filter((g) => g.rows.length > 0);

  if (gradable.length === 0) return <EmptyState label="This lesson has no gradable responses." />;

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {g.label} <span className="text-slate-300">· {g.rows.length}</span>
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.rows.map((r) => (
              <ResponseRowCard key={`${g.key}-${r.step.id}`} row={r} onFocus={onFocus} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResponseRowCard({ row, onFocus }: { row: any; onFocus: (id: string) => void }) {
  const tone = gradingStateTone(row.state);
  return (
    <button
      type="button"
      onClick={() => onFocus(row.step.id)}
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/30"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {row.step.type === "checkpoint" ? "Check" : "Step"} {row.step.number}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            {row.questionType === "mc" ? "MC" : row.questionType === "sa" ? "Short answer" : "—"}
          </span>
          {row.signalCount > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
              <ShieldAlert className="h-2.5 w-2.5" /> {row.signalCount}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[13px] font-semibold text-slate-800">{row.step.title}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {row.hasResponse ? (
          <span className="text-[13px] font-bold tabular-nums text-slate-700">
            {row.score ?? 0}/{row.maxPoints}
          </span>
        ) : (
          <span className="text-[11px] italic text-slate-400">No response</span>
        )}
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.bg} ${tone.text} ${tone.border}`}>
          {GRADING_STATE_LABEL[row.state]}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Review command center
// ---------------------------------------------------------------------------
function ReviewCommandCenter({
  reviewRows,
  resolveCtx,
  review,
  attempt,
  onFocus,
}: {
  reviewRows: any[];
  resolveCtx: StepResolveContext;
  review: ReviewBinding;
  attempt: any;
  onFocus: (id: string) => void;
}) {
  if (reviewRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 py-16 text-center">
        <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-500" />
        <p className="text-[14px] font-bold text-emerald-800">Nothing waiting for review</p>
        <p className="mt-1 text-[12.5px] text-emerald-700">Every gradable response has been scored or released.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-slate-500">
        {reviewRows.length} response{reviewRows.length === 1 ? "" : "s"} waiting for grading, AI review, or release.
      </p>
      {reviewRows.map((row) => {
        const resolved = resolveStep(row.step, resolveCtx);
        const draft = resolved.response ? null : draftForBlock(attempt, resolved.snapshotBlock, resolved.checkpoint);
        const state = gradingState(resolved.response, draft);
        const tone = gradingStateTone(state);
        return (
          <div key={row.step.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 items-center rounded-md bg-indigo-600 px-2 text-[11px] font-bold text-white">
                  Step {row.step.number}
                </span>
                <h4 className="text-[14px] font-bold text-slate-800">{row.step.title}</h4>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.bg} ${tone.text} ${tone.border}`}>
                  {GRADING_STATE_LABEL[state]}
                </span>
                <button onClick={() => onFocus(row.step.id)} className="text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-800">
                  Open step →
                </button>
              </div>
            </div>
            {row.questionType === "sa" ? (
              <ShortAnswerReviewCard
                question={resolved.questionDef}
                block={resolved.snapshotBlock}
                response={resolved.response}
                draftText={draft}
                maxPoints={resolved.maxPoints}
                review={review}
              />
            ) : (
              <MultipleChoiceReviewCard
                question={resolved.questionDef}
                block={resolved.snapshotBlock}
                response={resolved.response}
                maxPoints={resolved.maxPoints}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance tab
// ---------------------------------------------------------------------------
function PerformanceTab({
  studentId,
  student,
  attempts,
  responses,
  lessons,
  blocks,
  assignments,
  gradebookEntries,
  gradebookResponseEntries,
  questionAssignments,
}: any) {
  const [threshold, setThreshold] = useState<number>(75);

  const studentAttempts = (attempts || []).filter((a: any) => a.studentId === studentId && !a.isPreviewAttempt && a.status === "completed");

  const perfItems = studentAttempts.map((attempt: any) => {
    const lesson = (lessons || []).find((l: any) => l.id === attempt.lessonId);
    const assignment = (assignments || []).find((a: any) => a.lessonId === attempt.lessonId);
    
    // We need to resolve the score for this attempt
    const scoreParts = resolveAttemptScoreParts(
      attempt,
      responses || [],
      gradebookEntries || [],
      gradebookResponseEntries || [],
      questionAssignments || [],
      blocks || []
    );
    const maxPoints = scoreParts.maxPoints;
    const score = scoreParts.score;
    const percentage = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
    
    return {
      attempt,
      lesson,
      assignment,
      maxPoints,
      score,
      percentage
    };
  }).sort((a: any, b: any) => new Date(b.attempt.completedAt || 0).getTime() - new Date(a.attempt.completedAt || 0).getTime());

  const averageScore = perfItems.length > 0 
    ? Math.round(perfItems.reduce((acc: number, item: any) => acc + item.percentage, 0) / perfItems.length)
    : 0;

  const flaggedItems = perfItems.filter((i: any) => i.percentage < threshold);

  const handleMessageStudent = () => {
    const email = student?.email || "";
    const subject = encodeURIComponent("Check-in regarding recent VERITAS Learn assignments");
    
    let bodyText = `Hi ${student?.name?.split(' ')[0] || 'there'},\n\nI was reviewing your recent progress on VERITAS Learn and noticed some recent assignments where your score was below our target threshold:\n\n`;
    
    flaggedItems.forEach((item: any) => {
      bodyText += `- ${item.lesson?.title || 'Unknown Lesson'}: ${item.percentage}%\n`;
    });
    
    bodyText += `\nPlease let me know if you are having any trouble with this material or if you'd like to schedule some time to review it together.\n\nBest,\n`;
    const body = encodeURIComponent(bodyText);
    
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-bold text-slate-800">Historical Performance</h3>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Review past assignment scores and identify intervention needs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {flaggedItems.length > 0 && (
            <button
              onClick={handleMessageStudent}
              className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11.5px] font-bold text-indigo-700 transition hover:bg-indigo-100"
            >
              <Mail className="h-4 w-4" /> Message Selected
            </button>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <label className="text-[11.5px] font-semibold text-slate-600">Flag scores below <span className="font-bold text-slate-400">(%)</span></label>
            <input
              type="number"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-16 rounded border border-slate-300 px-2 py-1 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>
      </div>

      {perfItems.length === 0 ? (
        <EmptyState label="No completed assignments found." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
             <div className="rounded-xl border border-slate-200 bg-white p-4">
               <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Average Score</span>
               <span className="text-[20px] font-bold tabular-nums text-indigo-700">{averageScore}%</span>
             </div>
             <div className="rounded-xl border border-slate-200 bg-white p-4">
               <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Completed Assignments</span>
               <span className="text-[20px] font-bold tabular-nums text-slate-800">{perfItems.length}</span>
             </div>
             <div className="rounded-xl border border-slate-200 bg-white p-4">
               <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Intervention Flags</span>
               <span className={`text-[20px] font-bold tabular-nums ${perfItems.filter((i: any) => i.percentage < threshold).length > 0 ? "text-rose-600" : "text-slate-800"}`}>
                 {perfItems.filter((i: any) => i.percentage < threshold).length}
               </span>
             </div>
          </div>
          <div className="space-y-3">
            {perfItems.map((item: any) => {
              const isFlagged = item.percentage < threshold;
              return (
                <div key={item.attempt.id} className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition ${isFlagged ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className={`truncate text-[13px] font-bold ${isFlagged ? "text-rose-900" : "text-slate-800"}`}>
                        {item.lesson?.title || "Unknown Lesson"}
                      </h4>
                      {isFlagged && (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700 border border-rose-200">
                          <AlertCircle className="h-2.5 w-2.5" /> Needs intervention
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-[11.5px] font-medium ${isFlagged ? "text-rose-700/80" : "text-slate-500"}`}>
                      Completed on {new Date(item.attempt.completedAt || item.attempt.updatedAt || Date.now()).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isFlagged ? "text-rose-600" : "text-slate-400"}`}>Score</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-lg font-bold tabular-nums ${isFlagged ? "text-rose-700" : "text-indigo-700"}`}>
                        {item.score}/{item.maxPoints}
                      </span>
                      <span className={`text-sm font-bold ${isFlagged ? "text-rose-500" : "text-slate-400"}`}>
                        ({item.percentage}%)
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
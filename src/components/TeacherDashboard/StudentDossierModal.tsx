import { useState } from "react";
import { RichContentRenderer, getPlainText } from "../RichContent/RichContentRenderer";
import {
  AlertTriangle,
  ShieldCheck,
  X,
  Clock,
  Video,
  BookOpen,
  AlertCircle,
  HelpCircle,
  Lock,
  Check,
  Calendar,
  Unlock,
  ShieldAlert,
  MessageSquare,
  Bot,
  Info,
} from "lucide-react";

interface StudentDossierModalProps {
  studentId: string;
  lessonId: string;
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
  assignments?: any[];
  onClose: () => void;
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
  onUnlockStudent?: (attemptId: string) => void;
}

function formatVideoTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resolveMultipleChoiceText(block: any, responseValue: any): string | null {
  if (!responseValue) return null;
  const valStr = String(responseValue);

  if (block?.singleQuestion?.choices) {
    const found = block.singleQuestion.choices.find((c: any) => c.id === valStr);
    if (found) return getPlainText(found.text);
  }

  if (block?.questionPool?.questions) {
    for (const q of block.questionPool.questions) {
      if (q.choices) {
        const found = q.choices.find((c: any) => c.id === valStr);
        if (found) return getPlainText(found.text);
      }
    }
  }

  if (block?.videoCheckpoints) {
    for (const cp of block.videoCheckpoints) {
      if (cp.questions) {
        for (const q of cp.questions) {
          if (q.choices) {
            const found = q.choices.find((c: any) => c.id === valStr);
            if (found) return getPlainText(found.text);
          }
        }
      }
    }
  }

  return null;
}

function signalEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    blur_focus_lost: "Visibility hidden",
    visibilitychange: "Tab or window changed",
    fullscreen_exit: "Fullscreen exited",
    fullscreen_exited: "Fullscreen exited",
    seek_attempt_blocked: "Video seek attempt blocked",
    copy_blocked: "Copy attempt blocked",
    paste_blocked: "Paste attempt blocked",
    context_menu_blocked: "Right-click blocked",
    rapid_navigation: "Fast navigation detected",
    checkpoint_triggered: "Checkpoint reached",
    possible_ai_agent_use: "Possible AI agent use",
    hidden_assessment_text_in_answer: "Assessment content detected in answer",
    ai_guard_marker_in_answer: "Browser AI Guard marker in answer",
    ai_guard_refusal_phrase_in_answer: "AI refusal phrase in answer",
  };
  return labels[eventType] || eventType.replace(/_/g, " ");
}

export default function StudentDossierModal({
  studentId,
  lessonId,
  students,
  attempts,
  responses,
  signals,
  lessons,
  blocks,
  assignments = [],
  onClose,
  onOverrideSave,
  onUnlockStudent,
}: StudentDossierModalProps) {
  const [overrideScores, setOverrideScores] = useState<{ [id: string]: number }>({});
  const [overrideNotes, setOverrideNotes] = useState<{ [id: string]: string }>({});
  const [savingState, setSavingState] = useState<{ [id: string]: boolean }>({});
  const [saveSuccess, setSaveSuccess] = useState<{ [id: string]: boolean }>({});
  const [reviewedSignals, setReviewedSignals] = useState<Set<string>>(new Set());
  const [unlocking, setUnlocking] = useState<boolean>(false);

  const attempt = attempts.find((a) => a.studentId === studentId && a.lessonId === lessonId);
  let student = students.find((s) => s.id === studentId);
  if (!student && attempt?.isPreviewAttempt) {
    student = {
      id: studentId,
      name: "Teacher Preview",
      email: "",
      role: "student",
    };
  }
  const lesson = lessons.find((l) => l.id === lessonId);

  if (!student || !lesson || !attempt) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white border border-slate-200 text-slate-800 rounded-xl p-6 max-w-sm text-center shadow-lg font-sans">
          <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No active attempt found for this student.</p>
          <button
            onClick={onClose}
            className="mt-4 bg-[#0A192F] hover:bg-[#15294b] text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const sSignals = signals.filter((s) => s.attemptId === attempt.id);
  const sResponses = responses.filter((r) => r.attemptId === attempt.id);
  const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id);

  const calcMaxPoints = (): number => {
    return lessonBlocks.reduce((sum: number, b: any) => {
      if (b.type !== "question" || b.isPractice) return sum;
      if (b.singleQuestion) return sum + (b.singleQuestion.points || 0);
      if (b.questionPool) {
        const perQ = b.questionPool.questions?.[0]?.points || 0;
        return sum + perQ * (b.questionPool.numToSelect || 1);
      }
      return sum;
    }, 0);
  };

  const maxLessonPoints = calcMaxPoints();
  const earnedPoints = attempt ? (attempt.score || 0) : 0;
  const scorePercentage = maxLessonPoints > 0 ? Math.round((earnedPoints / maxLessonPoints) * 100) : 0;

  const asg = (assignments || []).find((a: any) => a.lessonId === lesson.id);
  const isPastDue = asg?.dueAt && new Date(asg.dueAt) < new Date();

  const lessonQuestionBlocks = blocks.filter(
    (b) => b.lessonId === lesson.id && b.type === "question" && !b.isPractice
  );
  const hasPendingResponses = lessonQuestionBlocks.some((b) => {
    const isSA =
      b.questionType === "sa" ||
      b.singleQuestion?.type === "sa" ||
      b.questionPool?.questions?.some((q: any) => q.type === "sa");
    if (!isSA) return false;
    const resp = sResponses.find((r) => r.blockId === b.id);
    if (!resp) return false;
    const isGraded =
      resp.teacherOverride ||
      (resp.aiGrading &&
        (resp.aiGrading.status === "success" || resp.aiGrading.status === "failed"));
    return !isGraded;
  });

  const overrideStatus = attempt?.gradebookStatusOverride || null;

  let finalStatus: "not_started" | "in_progress" | "completed" | "pending" | "missing" | "excused" =
    "not_started";
  if (overrideStatus && overrideStatus !== "default") {
    finalStatus = overrideStatus as any;
  } else {
    if (!attempt) {
      finalStatus = isPastDue ? "missing" : "not_started";
    } else {
      if (attempt.status === "completed") {
        finalStatus = hasPendingResponses ? "pending" : "completed";
      } else {
        finalStatus = isPastDue ? "missing" : hasPendingResponses ? "pending" : "in_progress";
      }
    }
  }

  const handleSaveOverrideAndNotes = async (responseId: string, maxPoints: number) => {
    const rawScore = overrideScores[responseId];
    const existingResponse = sResponses.find((r) => r.id === responseId);
    const resolvedScore =
      rawScore !== undefined
        ? rawScore
        : existingResponse?.teacherOverride?.score ?? existingResponse?.score ?? 0;
    const clampedScore = Math.max(0, Math.min(maxPoints, resolvedScore));
    const rawNotes = overrideNotes[responseId];
    const resolvedNotes =
      rawNotes !== undefined
        ? rawNotes
        : existingResponse?.teacherOverride?.notes ?? existingResponse?.notes ?? "";

    setSavingState((prev) => ({ ...prev, [responseId]: true }));
    try {
      await onOverrideSave(responseId, clampedScore, resolvedNotes);
      setSaveSuccess((prev) => ({ ...prev, [responseId]: true }));
      setTimeout(() => setSaveSuccess((prev) => ({ ...prev, [responseId]: false })), 4000);
    } catch (err) {
      console.error("Score override failed:", err);
    } finally {
      setSavingState((prev) => ({ ...prev, [responseId]: false }));
    }
  };

  const handleToggleSignal = (sigId: string) => {
    const updated = new Set(reviewedSignals);
    if (updated.has(sigId)) updated.delete(sigId);
    else updated.add(sigId);
    setReviewedSignals(updated);
  };

  const renderFormattedDate = (rawStr: string | null | undefined) => {
    if (!rawStr) return "—";
    const d = new Date(rawStr);
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const blurs = sSignals.filter(
    (s) => s.eventType === "blur_focus_lost" || s.eventType === "visibilitychange"
  ).length;
  const screens = sSignals.filter(
    (s) => s.eventType === "fullscreen_exit" || s.eventType === "fullscreen_exited"
  ).length;
  const copyPastes = sSignals.filter(
    (s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked"
  ).length;
  const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
  const aiGuardSignals = sSignals.filter((s) =>
    [
      "possible_ai_agent_use",
      "hidden_assessment_text_in_answer",
      "ai_guard_marker_in_answer",
      "ai_guard_refusal_phrase_in_answer",
    ].includes(s.eventType)
  ).length;
  const totalSignals = blurs + screens + copyPastes + seekVio;

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

  const initials = student.name ? student.name.substring(0, 2).toUpperCase() : "ST";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans">
      <div className="bg-white border border-slate-200 text-slate-800 shadow-2xl rounded-xl w-full max-w-4xl h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm lg:text-base font-bold text-slate-900 tracking-tight">
                {student.name}
              </h3>
              <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${statusBadge}`}>
                {statusLabel}
              </span>
              {attempt.isPreviewAttempt && (
                <span className="bg-amber-100 text-amber-800 text-[9px] font-mono font-bold border border-amber-200 px-1.5 py-0.5 rounded tracking-wide uppercase">
                  Teacher Preview
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              {lesson.title}
              {student.email ? ` — ${student.email}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50/40">

          {/* Locked attempt banner */}
          {attempt.lockState === "locked_awaiting_teacher" && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
              <div className="flex items-start gap-2.5">
                <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-sm font-bold text-amber-900">Attempt paused</h5>
                  <p className="text-xs text-amber-800 font-medium mt-0.5 leading-relaxed">
                    This attempt was paused by the integrity monitor. Review the activity signals below, then unlock to allow the student to continue.
                  </p>
                </div>
              </div>
              {onUnlockStudent && (
                <button
                  type="button"
                  onClick={async () => {
                    setUnlocking(true);
                    try {
                      await onUnlockStudent(attempt.id);
                    } catch (e) {
                      console.error(e);
                    } finally {
                      setUnlocking(false);
                    }
                  }}
                  disabled={unlocking}
                  className="bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 text-white font-bold text-xs uppercase tracking-wide px-4 py-2 rounded-lg transition shadow-sm cursor-pointer flex items-center gap-1.5 shrink-0 border border-amber-500"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  {unlocking ? "Unlocking…" : "Allow student to resume"}
                </button>
              )}
            </div>
          )}

          {/* Student profile + lesson */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm flex flex-col md:flex-row gap-5 items-start justify-between">
            <div className="flex gap-4 items-start flex-1 min-w-0">
              <div className="w-12 h-12 bg-[#0A192F] text-white font-bold rounded-full flex items-center justify-center border-2 border-slate-200 shrink-0 select-none text-base">
                {initials}
              </div>
              <div className="space-y-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-800 leading-tight">{student.name}</h4>
                {student.email && (
                  <p className="text-xs text-slate-500 font-mono truncate">{student.email}</p>
                )}
                {student.approvedOutsideDomain && (
                  <span className="inline-block bg-teal-50 border border-teal-200 text-teal-800 font-bold text-[9px] px-1.5 py-0.5 rounded font-mono tracking-wider uppercase">
                    External account
                  </span>
                )}
              </div>
            </div>

            <div className="md:border-l md:border-slate-200 md:pl-5 flex-1 w-full space-y-1.5">
              <span className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-wider block">Lesson</span>
              <h5 className="text-xs font-bold text-slate-800 leading-snug">{lesson.title}</h5>
              {lesson.description && (
                <p className="text-[11px] text-slate-500 font-medium italic line-clamp-2 leading-relaxed">
                  {typeof lesson.description === "string"
                    ? lesson.description
                    : lesson.description?.plainText || ""}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2.5 text-[9px] text-slate-400 font-mono font-bold pt-1 uppercase">
                {lesson.estimatedMinutes > 0 && <span>~{lesson.estimatedMinutes} min</span>}
                <span className={lesson.isPublished ? "text-emerald-600" : "text-amber-600"}>
                  {lesson.isPublished ? "Published" : "Draft"}
                </span>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Active time</span>
              <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5 font-mono">
                <Clock className="w-4 h-4 text-[#0A192F]" />
                {Math.floor(attempt.activeTimeSpent / 60)}m {attempt.activeTimeSpent % 60}s
              </span>
              <span className="text-[9px] text-slate-400 block">Time actively working</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Time away</span>
              <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5 font-mono">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                {Math.floor((attempt.inactiveTimeSpent || 0) / 60)}m {(attempt.inactiveTimeSpent || 0) % 60}s
              </span>
              <span className="text-[9px] text-slate-500 block">Tab switch or window change</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Progress</span>
              <span className="text-sm font-bold text-[#0A192F] font-mono">
                {attempt.currentBlockIndex + 1} / {lessonBlocks.length} steps
              </span>
              <span className="text-[9px] text-slate-400 block">Lesson steps completed</span>
            </div>

            <div className={`border p-4 rounded-lg shadow-sm space-y-1 ${
              finalStatus === "excused" ? "bg-purple-50 border-purple-200" :
              finalStatus === "missing" ? "bg-rose-50 border-rose-200" :
              finalStatus === "pending" ? "bg-amber-50 border-amber-200" :
              "bg-white border-slate-200"
            }`}>
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Score</span>
              <span className={`text-sm font-bold font-mono flex items-center gap-1.5 ${
                finalStatus === "excused" ? "text-purple-700" :
                finalStatus === "missing" ? "text-rose-700" :
                finalStatus === "pending" ? "text-amber-700" :
                "text-indigo-700"
              }`}>
                {finalStatus === "excused" ? "Excused" :
                 finalStatus === "missing" ? "Missing" :
                 `${earnedPoints} / ${maxLessonPoints} pts`}
              </span>
              <span className="text-[9px] text-slate-400 block">
                {finalStatus === "excused" ? "Excluded from grade records" :
                 finalStatus === "missing" ? "No submission" :
                 finalStatus === "pending" ? `${scorePercentage}% — pending review` :
                 `${scorePercentage}%`}
              </span>
            </div>
          </div>

          {/* Timestamps */}
          <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm text-xs font-medium text-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="space-y-1">
              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Started</span>
              <p className="text-slate-800 font-semibold">{renderFormattedDate(attempt.startedAt)}</p>
            </div>
            <div className="space-y-1 sm:pl-4">
              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Submitted</span>
              <p className={`font-semibold ${isCompleted ? "text-emerald-700" : "text-slate-500 italic font-normal"}`}>
                {isCompleted
                  ? renderFormattedDate(attempt.submittedAt || attempt.completedAt)
                  : "In progress"}
              </p>
            </div>
          </div>

          {/* Lesson progress timeline */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-2 uppercase tracking-wide flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              Lesson Steps
              <span className="text-slate-400 text-[10px] font-normal tracking-tight lowercase">({lessonBlocks.length} total)</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lessonBlocks
                .slice()
                .sort((a: any, b: any) => a.order - b.order)
                .map((block: any, idx: number) => {
                  const isReached = idx <= attempt.currentBlockIndex;
                  const blockCompleted = idx < attempt.currentBlockIndex || attempt.status === "completed";
                  const blockTimeSeconds = attempt.blockTimeSpent?.[block.id] || 0;
                  const furthestSeconds = attempt.furthestVideoTimestamps?.[block.id];

                  return (
                    <div
                      key={block.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-xs transition ${
                        blockCompleted
                          ? "bg-slate-50 border-slate-200"
                          : isReached
                          ? "bg-indigo-50/20 border-indigo-200/60"
                          : "opacity-40 bg-slate-50 border-transparent"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          blockCompleted
                            ? "bg-emerald-100 text-emerald-700"
                            : isReached
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {blockCompleted ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-slate-700 font-bold truncate">
                          {block.type === "video" ? (
                            <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : block.type === "question" ? (
                            <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <BookOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="truncate">{block.title}</span>
                        </div>
                        <div className="flex gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                          {blockTimeSeconds > 0 && (
                            <span>{Math.floor(blockTimeSeconds / 60)}m {blockTimeSeconds % 60}s</span>
                          )}
                          {block.type === "video" && furthestSeconds !== undefined && (
                            <span className="text-slate-500 font-semibold">{formatVideoTime(furthestSeconds)} watched</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Activity records */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-3">
            <div className="flex flex-wrap justify-between items-center border-b border-slate-100 pb-2 gap-2">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2 uppercase tracking-wide">
                <ShieldAlert className="w-4 h-4 text-amber-500" /> Activity Records
              </h4>
              <div className="flex flex-wrap gap-2">
                {totalSignals > 0 && (
                  <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    {totalSignals} {totalSignals === 1 ? "signal" : "signals"}
                  </span>
                )}
                {aiGuardSignals > 0 && (
                  <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                    {aiGuardSignals} signals of AI agent use
                  </span>
                )}
              </div>
            </div>

            {aiGuardSignals > 0 && (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1">
                <p className="font-semibold text-amber-900">Signals of AI agent use</p>
                <p className="text-amber-800 leading-relaxed">
                  This answer included content that may indicate a browser AI tool assisted with the response.
                </p>
                <p className="text-amber-700 leading-relaxed">
                  This is not automatic proof of a violation. Review the answer, timing, and other signals before making a decision. Grades are never changed automatically.
                </p>
              </div>
            )}

            {sSignals.length === 0 ? (
              <div className="py-4 text-xs font-bold text-emerald-800 bg-emerald-50 rounded-lg px-4 flex items-center gap-2 border border-emerald-200">
                <ShieldCheck className="w-4 h-4" />
                No activity signals recorded.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {sSignals.map((signal) => {
                  const isReviewed = reviewedSignals.has(signal.id);
                  return (
                    <div
                      key={signal.id}
                      className={`p-3 text-xs flex justify-between items-center gap-4 transition-all duration-200 ${
                        isReviewed
                          ? "bg-emerald-50/30 opacity-60 text-slate-400 border-l-4 border-emerald-400"
                          : "hover:bg-slate-50 bg-white"
                      }`}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded border tracking-wider ${
                              isReviewed
                                ? "bg-slate-100 text-slate-400 border-slate-200"
                                : signal.severity === "high"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-amber-50 text-amber-800 border-amber-200"
                            }`}
                          >
                            {signalEventLabel(signal.eventType)}
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono">
                            {renderFormattedDate(signal.timestamp)}
                          </span>
                        </div>
                        <p className={`font-sans ${isReviewed ? "text-slate-400" : "text-slate-600 font-medium"}`}>
                          {signal.metadata?.message || "Recorded during lesson"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {signal.videoTimestamp != null && (
                          <span className="text-[9px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                            {formatVideoTime(signal.videoTimestamp)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleSignal(signal.id)}
                          className={`text-[9px] font-mono font-bold px-2 py-1 rounded transition border cursor-pointer select-none ${
                            isReviewed
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {isReviewed ? "Checked" : "Mark checked"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Responses */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2 uppercase tracking-wide border-b border-slate-100 pb-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" /> Responses
            </h4>

            <div className="space-y-5">
              {lessonBlocks.map((block) => {
                const bResponse = sResponses.find((r) => r.blockId === block.id && !r.checkpointId);
                const isQuestionBlock = block.type === "question";
                const checkResponses = sResponses.filter((r) => r.blockId === block.id && r.checkpointId);

                return (
                  <div key={block.id} className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-4">
                    {/* Block header */}
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        {block.type === "video" ? (
                          <Video className="w-3.5 h-3.5 text-slate-400" />
                        ) : block.type === "question" ? (
                          <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>{block.title}</span>
                      </div>
                      <span className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-widest">
                        Step {(block.order ?? 0) + 1}
                      </span>
                    </div>

                    {/* Question block */}
                    {isQuestionBlock && (
                      <div className="text-xs space-y-3 pt-1">
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                          <span className="text-[9px] font-bold font-mono uppercase text-slate-400 block mb-1 tracking-wider">Question</span>
                          <div className="font-serif leading-relaxed text-slate-700 text-xs">
                            <RichContentRenderer
                              content={
                                block.singleQuestion?.stem ||
                                block.questionPool?.description ||
                                "No question text."
                              }
                            />
                          </div>
                        </div>

                        {bResponse ? (
                          <div className="space-y-3">
                            <div className="p-3 bg-white border border-slate-200 rounded-lg">
                              <span className="text-[9px] font-bold font-mono uppercase text-slate-400 block mb-1.5 tracking-wider">Response</span>
                              <div className="font-medium text-slate-800 text-[12px] bg-slate-50 border border-slate-100 p-2.5 rounded">
                                {bResponse.type === "mc" ? (
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-slate-500 font-medium">Selected:</span>
                                      <span className="text-slate-900 font-bold">
                                        {resolveMultipleChoiceText(block, bResponse.responseValue) ||
                                          bResponse.responseText ||
                                          "Selected choice unavailable"}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="font-sans leading-relaxed text-slate-800">
                                    {bResponse.responseValue || (
                                      <span className="text-slate-400 italic">No response submitted</span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Score row */}
                              <div className="mt-3 flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {bResponse.type === "mc" ? (
                                    <span
                                      className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border ${
                                        bResponse.isCorrect
                                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                          : "bg-red-50 text-red-800 border-red-200"
                                      }`}
                                    >
                                      {bResponse.isCorrect ? "Correct" : "Incorrect"}
                                    </span>
                                  ) : (
                                    <span
                                      className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border ${
                                        bResponse.aiGrading?.status === "pending"
                                          ? "bg-slate-100 text-slate-500 border-slate-200"
                                          : bResponse.aiGrading?.status === "needs_review"
                                          ? "bg-amber-50 text-amber-800 border-amber-200"
                                          : bResponse.aiGrading?.status === "failed"
                                          ? "bg-red-50 text-red-700 border-red-200"
                                          : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      }`}
                                    >
                                      {bResponse.aiGrading?.status === "pending"
                                        ? "AI grading in progress"
                                        : bResponse.aiGrading?.status === "needs_review"
                                        ? "Needs review"
                                        : bResponse.aiGrading?.status === "failed"
                                        ? "AI grading failed"
                                        : bResponse.aiGrading?.status === "success"
                                        ? "AI scored"
                                        : "Awaiting AI grading"}
                                    </span>
                                  )}

                                  {bResponse.isLowEffort && (
                                    <span className="bg-rose-50 border border-rose-200 text-rose-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded">
                                      Short response flagged
                                    </span>
                                  )}

                                  {bResponse.teacherOverride && (
                                    <span className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded">
                                      Override applied
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono font-bold text-slate-600">
                                  {bResponse.score} / {block.points || block.singleQuestion?.points || 0} pts
                                </div>
                              </div>

                              {/* Low effort detail */}
                              {bResponse.isLowEffort && (
                                <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-900 flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                  <div>
                                    <strong className="block text-rose-900 font-bold">Short response flagged</strong>
                                    <p className="text-xs text-rose-800 leading-relaxed mt-0.5">
                                      {bResponse.lowEffortReason || "Response was extremely short or lacked meaningful content."}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* AI grading detail */}
                              {bResponse.type === "sa" && bResponse.aiGrading && (
                                <div className="mt-3 bg-indigo-50/40 border border-indigo-100 rounded-lg p-3.5 space-y-1.5 text-xs text-indigo-900">
                                  <div className="flex justify-between items-center text-[10px] uppercase font-mono font-bold text-indigo-600 tracking-wider">
                                    <span className="flex items-center gap-1.5">
                                      <Bot className="w-3.5 h-3.5" />
                                      AI Assessment
                                    </span>
                                    {bResponse.aiGrading.confidence !== undefined && (
                                      <span>Confidence: {Math.round((bResponse.aiGrading.confidence || 0) * 100)}%</span>
                                    )}
                                  </div>
                                  <p className="font-sans leading-relaxed text-indigo-900 font-medium whitespace-pre-wrap">
                                    {bResponse.aiGrading.rationale || "No rationale available."}
                                  </p>
                                  {bResponse.aiGrading.rubricBreakdown && (
                                    <div className="text-[10px] pt-1 text-indigo-800 space-y-1">
                                      <span className="block text-[9px] text-indigo-600 tracking-wide uppercase font-bold">Rubric breakdown</span>
                                      {Object.entries(bResponse.aiGrading.rubricBreakdown).map(
                                        ([criterion, item]: any) => (
                                          <div
                                            key={criterion}
                                            className="flex justify-between bg-white/50 px-2 py-1 rounded"
                                          >
                                            <span>{criterion}:</span>
                                            <span className="font-mono font-bold">
                                              {item.score} — {item.feedback || "Reviewed"}
                                            </span>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Teacher review panel */}
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
                              <div className="flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                                <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wide">Teacher Review</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                <div className="sm:col-span-1 space-y-1">
                                  <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Score</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max={block.points || block.singleQuestion?.points || 10}
                                    value={
                                      overrideScores[bResponse.id] !== undefined
                                        ? overrideScores[bResponse.id]
                                        : bResponse.teacherOverride?.score ?? bResponse.score ?? 0
                                    }
                                    onChange={(e) =>
                                      setOverrideScores({
                                        ...overrideScores,
                                        [bResponse.id]: Number(e.target.value),
                                      })
                                    }
                                    className="w-full text-xs font-mono font-bold text-center bg-white border border-slate-200 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400"
                                  />
                                </div>
                                <div className="sm:col-span-3 space-y-1">
                                  <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Teacher notes (private)</label>
                                  <textarea
                                    value={
                                      overrideNotes[bResponse.id] !== undefined
                                        ? overrideNotes[bResponse.id]
                                        : bResponse.teacherOverride?.notes ?? bResponse.notes ?? ""
                                    }
                                    onChange={(e) =>
                                      setOverrideNotes({
                                        ...overrideNotes,
                                        [bResponse.id]: e.target.value,
                                      })
                                    }
                                    placeholder="Add notes or feedback…"
                                    rows={2}
                                    className="w-full text-xs bg-white border border-slate-200 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400 leading-normal"
                                  />
                                </div>
                              </div>

                              <div className="flex justify-between items-center pt-1.5 border-t border-slate-100">
                                <div>
                                  {saveSuccess[bResponse.id] && (
                                    <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded">
                                      <Check className="w-3 h-3" /> Saved
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSaveOverrideAndNotes(
                                      bResponse.id,
                                      block.points || block.singleQuestion?.points || 10
                                    )
                                  }
                                  disabled={savingState[bResponse.id]}
                                  className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-200 text-white text-[10px] font-bold uppercase py-2 px-4 rounded transition flex items-center gap-1.5 cursor-pointer shadow-sm tracking-wider"
                                >
                                  {savingState[bResponse.id] ? "Saving…" : "Save"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-400 text-xs italic bg-slate-50 p-3 rounded-lg border border-dashed border-slate-200 flex items-center gap-1.5 font-medium">
                            No response submitted yet.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Video checkpoints */}
                    {block.type === "video" && block.videoCheckpoints && block.videoCheckpoints.length > 0 && (
                      <div className="space-y-4 pt-1">
                        <div className="bg-slate-50 p-2.5 rounded border border-slate-200 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-[10px] font-mono uppercase text-slate-500 font-bold tracking-wider">Video checkpoints</span>
                        </div>
                        {block.videoCheckpoints.map((cp: any) => {
                          const cpResp = sResponses.filter(
                            (r) => r.blockId === block.id && r.checkpointId === cp.id
                          );
                          const cpTimeSafe =
                            cp.timestamp !== undefined &&
                            cp.timestamp !== null &&
                            !isNaN(Number(cp.timestamp)) &&
                            Number(cp.timestamp) >= 0
                              ? formatVideoTime(Number(cp.timestamp))
                              : null;

                          return (
                            <div
                              key={cp.id}
                              className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 text-xs space-y-3"
                            >
                              <div className="flex justify-between items-center text-[10px] bg-white p-2 border border-slate-200 rounded font-semibold text-slate-700">
                                <span className="font-bold">{cp.title || "Checkpoint"}</span>
                                <span className="text-slate-500 font-mono text-[9px]">
                                  {cpTimeSafe ? `At ${cpTimeSafe}` : "Checkpoint"}
                                  {cp.isRequired ? " · Required" : " · Optional"}
                                </span>
                              </div>

                              {cpResp.length === 0 ? (
                                <span className="text-slate-400 italic block font-medium text-[11px] px-2">
                                  Not yet reached.
                                </span>
                              ) : (
                                cpResp.map((cr) => (
                                  <div
                                    key={cr.id}
                                    className="p-3 bg-white border border-slate-200 rounded-lg mt-2 space-y-3"
                                  >
                                    <div className="p-2.5 bg-slate-50 border border-slate-100 rounded">
                                      <span className="text-[9px] font-bold text-slate-400 tracking-wider font-mono uppercase block mb-1">Response</span>
                                      <div className="font-bold text-slate-800 text-[11px]">
                                        {cr.type === "mc" ? (
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-slate-500 font-medium">Selected:</span>
                                            <span className="text-slate-900 font-bold">
                                              {resolveMultipleChoiceText(block, cr.responseValue) ||
                                                cr.responseText ||
                                                "Selected choice unavailable"}
                                            </span>
                                          </div>
                                        ) : (
                                          cr.responseValue || (
                                            <span className="text-slate-400 italic">No response</span>
                                          )
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between border-t border-slate-100 pt-2 flex-wrap gap-2">
                                      <div className="flex items-center gap-2 flex-wrap text-[9px] font-bold font-mono">
                                        {cr.type === "mc" ? (
                                          <span
                                            className={`px-2 py-0.5 rounded border ${
                                              cr.isCorrect
                                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                                : "bg-red-50 text-red-800 border-red-200"
                                            }`}
                                          >
                                            {cr.isCorrect ? "Correct" : "Incorrect"}
                                          </span>
                                        ) : (
                                          <span className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-2 py-0.5 rounded">
                                            AI scored
                                          </span>
                                        )}
                                        {cr.teacherOverride && (
                                          <span className="bg-indigo-50 border border-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                                            Override applied
                                          </span>
                                        )}
                                      </div>
                                      <span className="font-bold font-mono text-slate-600">
                                        {cr.score} pts
                                      </span>
                                    </div>

                                    {/* Checkpoint override */}
                                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5 text-[11px]">
                                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                                        <div className="sm:col-span-1 space-y-1">
                                          <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Score</label>
                                          <input
                                            type="number"
                                            min="0"
                                            max={10}
                                            value={
                                              overrideScores[cr.id] !== undefined
                                                ? overrideScores[cr.id]
                                                : cr.teacherOverride?.score ?? cr.score ?? 0
                                            }
                                            onChange={(e) =>
                                              setOverrideScores({
                                                ...overrideScores,
                                                [cr.id]: Number(e.target.value),
                                              })
                                            }
                                            className="w-full text-xs font-mono font-bold text-center bg-white border border-slate-200 rounded p-1.5 focus:ring-0 focus:outline-none focus:border-slate-400"
                                          />
                                        </div>
                                        <div className="sm:col-span-3 space-y-1">
                                          <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Notes</label>
                                          <input
                                            type="text"
                                            value={
                                              overrideNotes[cr.id] !== undefined
                                                ? overrideNotes[cr.id]
                                                : cr.teacherOverride?.notes ?? cr.notes ?? ""
                                            }
                                            onChange={(e) =>
                                              setOverrideNotes({
                                                ...overrideNotes,
                                                [cr.id]: e.target.value,
                                              })
                                            }
                                            placeholder="Teacher notes…"
                                            className="w-full text-xs bg-white border border-slate-200 rounded-md p-1.5 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400"
                                          />
                                        </div>
                                      </div>

                                      <div className="flex justify-between items-center">
                                        <div>
                                          {saveSuccess[cr.id] && (
                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                                              <Check className="w-3 h-3" /> Saved
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveOverrideAndNotes(cr.id, 10)}
                                          disabled={savingState[cr.id]}
                                          className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-200 text-white text-[9px] font-bold uppercase py-1.5 px-3 rounded transition cursor-pointer shadow-sm"
                                        >
                                          {savingState[cr.id] ? "Saving…" : "Save"}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

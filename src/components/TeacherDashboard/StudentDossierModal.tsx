import { useState } from "react";
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
  TrendingUp, 
  Award, 
  CheckCircle2, 
  Unlock, 
  ShieldAlert, 
  MessageSquare,
  BookmarkCheck,
  CheckSquare,
  AwardIcon
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
  onUnlockStudent 
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
      name: "Teacher Preview Student",
      email: "teacher-preview@veritas.placeholder",
      role: "student"
    };
  }
  const lesson = lessons.find((l) => l.id === lessonId);

  if (!student || !lesson || !attempt) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white border text-slate-800 border-slate-200 rounded p-6 max-w-sm text-center shadow-lg font-sans">
          <p className="text-sm font-semibold text-slate-600">No active attempts recorded for this student.</p>
          <button onClick={onClose} className="mt-4 bg-[#0A192F] hover:bg-[#15294b] text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider">Close Portal</button>
        </div>
      </div>
    );
  }

  // Filter signals and responses associated with this attempt
  const sSignals = signals.filter((s) => s.attemptId === attempt.id);
  const sResponses = responses.filter((r) => r.attemptId === attempt.id);
  const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id);

  // Dynamic max points calculator for the lesson
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
  // Server-authoritative secure score representation: load directly from attempt object
  const earnedPoints = attempt ? (attempt.score || 0) : 0;
  const scorePercentage = maxLessonPoints > 0 ? Math.round((earnedPoints / maxLessonPoints) * 100) : 0;

  // Find the assignment associated with this lesson to verify past-due (deadlines)
  const asg = (assignments || []).find((a: any) => a.lessonId === lesson.id);
  const isPastDue = asg?.dueAt && new Date(asg.dueAt) < new Date();

  // Check if there are short answer questions in this lesson and if they are pending review/AI grading
  const lessonQuestionBlocks = blocks.filter((b) => b.lessonId === lesson.id && b.type === "question" && !b.isPractice);
  const hasPendingResponses = lessonQuestionBlocks.some((b) => {
    const isSA = b.questionType === "sa" || b.singleQuestion?.type === "sa" || b.questionPool?.questions?.some((q: any) => q.type === "sa");
    if (!isSA) return false;
    const resp = sResponses.find((r) => r.blockId === b.id);
    if (!resp) return false; // student didn't respond to SA yet
    const isGraded = resp.teacherOverride || (resp.aiGrading && (resp.aiGrading.status === "success" || resp.aiGrading.status === "failed"));
    return !isGraded;
  });

  const overrideStatus = attempt?.gradebookStatusOverride || null;

  let finalStatus: "not_started" | "in_progress" | "completed" | "pending" | "missing" | "excused" = "not_started";
  if (overrideStatus && overrideStatus !== "default") {
    finalStatus = overrideStatus as any;
  } else {
    if (!attempt) {
      finalStatus = isPastDue ? "missing" : "not_started";
    } else {
      if (attempt.status === "completed") {
        finalStatus = hasPendingResponses ? "pending" : "completed";
      } else {
        // Started / in_progress
        finalStatus = isPastDue ? "missing" : (hasPendingResponses ? "pending" : "in_progress");
      }
    }
  }

  // Save manual grade correction callback
  const handleSaveOverrideAndNotes = async (responseId: string, maxPoints: number) => {
    const rawScore = overrideScores[responseId];
    // Default fallback to existing response scores
    const existingResponse = sResponses.find(r => r.id === responseId);
    const resolvedScore = rawScore !== undefined ? rawScore : (existingResponse?.teacherOverride?.score ?? existingResponse?.score ?? 0);
    const clampedScore = Math.max(0, Math.min(maxPoints, resolvedScore));

    const rawNotes = overrideNotes[responseId];
    const resolvedNotes = rawNotes !== undefined ? rawNotes : (existingResponse?.teacherOverride?.notes ?? existingResponse?.notes ?? "Teacher manual standard adjustment applied.");

    setSavingState(prev => ({ ...prev, [responseId]: true }));
    try {
      await onOverrideSave(responseId, clampedScore, resolvedNotes);
      setSaveSuccess(prev => ({ ...prev, [responseId]: true }));
      setTimeout(() => {
        setSaveSuccess(prev => ({ ...prev, [responseId]: false }));
      }, 4000);
    } catch (err) {
      console.error("Dossier Score override submission failed:", err);
    } finally {
      setSavingState(prev => ({ ...prev, [responseId]: false }));
    }
  };

  // Toggle Signal Reviewed local UI checkoff state
  const handleToggleSignal = (sigId: string) => {
    const upgraded = new Set(reviewedSignals);
    if (upgraded.has(sigId)) {
      upgraded.delete(sigId);
    } else {
      upgraded.add(sigId);
    }
    setReviewedSignals(upgraded);
  };

  // Render Time Helpers
  const renderFormattedDate = (rawStr: string | null | undefined) => {
    if (!rawStr) return "N/A";
    const d = new Date(rawStr);
    return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  // Count blurs, screens, seek blocks
  const blurs = sSignals.filter((s) => s.eventType === "blur_focus_lost" || s.eventType === "visibility_hidden").length;
  const screens = sSignals.filter((s) => s.eventType === "fullscreen_exited").length;
  const copyPastes = sSignals.filter((s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked").length;
  const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
  const totalViolations = blurs + screens + copyPastes + seekVio;

  const isCompleted = attempt.status === "completed";

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 font-sans">
      <div className="bg-white border border-slate-200 text-slate-800 shadow-2xl rounded-xl w-full max-w-4xl h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm lg:text-base font-black text-slate-900 tracking-tight">
                Academic Progress Portfolio Dossier
              </h3>
              <span className={`text-[8.5px] font-mono font-bold uppercase tracking-widest px-2.5 py-0.5 rounded border ${
                finalStatus === "excused"
                  ? "bg-purple-100 text-purple-800 border-purple-300"
                  : finalStatus === "missing"
                    ? "bg-rose-100 text-rose-800 border-rose-300"
                    : finalStatus === "pending"
                      ? "bg-amber-100 text-amber-805 border-amber-300 animate-pulse"
                      : finalStatus === "completed"
                        ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                        : "bg-blue-100 text-blue-800 border-blue-300"
              }`}>
                {finalStatus.toUpperCase().replace("_", " ")}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono font-medium mt-0.5 uppercase tracking-wide">
              Central reviewer workspace
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-700 p-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
            title="Exit Workspace"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body Scroll */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50">
          
          {/* Active lockout warning with Approve Re-Entry action */}
          {attempt.lockState === "locked_awaiting_teacher" && (
            <div className="bg-red-50 border-2 border-red-200 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-2.5">
                <Lock className="w-5 h-5 text-red-600 shrink-0 mt-0.5 animate-bounce" />
                <div>
                  <h5 className="text-xs font-black text-red-800 uppercase tracking-tight">Focus Lockout Activated</h5>
                  <p className="text-[11px] text-red-700 font-medium">
                    This user's exam/activity attempt has been locked out due to tab switches, copy-paste attempts, or leaving fullscreen focus mode.
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
                  className="bg-red-600 hover:bg-red-700 disabled:bg-slate-200 text-white font-extrabold uppercase text-[10px] tracking-wide px-3.5 py-2 rounded-md transition shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0 border border-red-500"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  {unlocking ? "Approving Resume..." : "Approve Re-Entry Now"}
                </button>
              )}
            </div>
          )}

          {/* Section 0: Student Profile Header & Lesson Metadata */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm flex flex-col md:flex-row gap-5 items-start justify-between">
            {/* Student Info */}
            <div className="flex gap-4 items-start flex-1 min-w-0">
              <div className="w-12 h-12 bg-[#0A192F] text-[#E5B53B] font-extrabold text-[#FFF] rounded-full flex items-center justify-center border-2 border-slate-200 shrink-0 select-none text-base">
                {student.name.substring(0, 2).toUpperCase()}
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-black text-slate-800 leading-tight truncate">
                    {student.name}
                  </h4>
                  {attempt.isPreviewAttempt && (
                    <span className="bg-amber-100 text-amber-800 text-[8px] font-mono font-black border border-amber-200 px-1.5 py-0.5 rounded tracking-wide uppercase font-black">
                      SANDBOX TEST ATTEMPT
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-mono truncate">
                  ✉️ {student.email}
                </p>
                <div className="flex gap-1.5 pt-0.5 flex-wrap">
                  <span className="bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[8.5px] px-1.5 py-0.2 rounded font-mono tracking-wider">
                    ROLE: STUDENT
                  </span>
                  {student.approvedOutsideDomain && (
                    <span className="bg-teal-50 border border-teal-200 text-teal-800 font-black text-[8.5px] px-1.5 py-0.2 rounded font-mono tracking-wider">
                      EXTERNAL USER APPROVED
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Lesson Info */}
            <div className="md:border-l md:border-slate-150 md:pl-5 flex-1 w-full space-y-1.5">
              <span className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-wider block">Assessed Syllabus Topic</span>
              <h5 className="text-xs font-bold text-slate-800 leading-snug">
                📖 {lesson.title}
              </h5>
              <p className="text-[11px] text-slate-500 font-medium italic line-clamp-2 leading-relaxed">
                "{lesson.description || "No descriptions currently set."}"
              </p>
              <div className="flex flex-wrap items-center gap-2.5 text-[9px] text-slate-400 font-mono font-bold pt-1 uppercase">
                <span>⏱️ Est: {lesson.estimatedMinutes}m</span>
                <span>&bull;</span>
                <span className={lesson.isPublished ? "text-emerald-600" : "text-amber-600"}>
                  {lesson.isPublished ? "Published Master" : "Temp Draft Layout"}
                </span>
              </div>
            </div>
          </div>

          {/* Section 1: Dynamic Statistics Panel */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-xs space-y-1">
              <span className="text-[8.5px] uppercase font-mono tracking-widest text-slate-400 font-black block">Class Pace Duration</span>
              <span className="text-xs lg:text-sm font-bold text-slate-800 flex items-center gap-1.5 font-mono">
                <Clock className="w-4 h-4 text-[#0A192F]" />
                {Math.floor(attempt.activeTimeSpent / 60)}m {attempt.activeTimeSpent % 60}s
              </span>
              <span className="text-[9px] text-slate-400 block font-medium">Active focus time</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-xs space-y-1">
              <span className="text-[8.5px] uppercase font-mono tracking-widest text-slate-400 font-black block">Unfocused / Blurred</span>
              <span className="text-xs lg:text-sm font-bold text-slate-800 flex items-center gap-1.5 font-mono">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                {Math.floor(attempt.inactiveTimeSpent / 60)}m {attempt.inactiveTimeSpent % 60}s
              </span>
              <span className="text-[9px] text-amber-700 block font-bold">⚠️ Lost tab / Browser blur</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-xs space-y-1">
              <span className="text-[8.5px] uppercase font-mono tracking-widest text-slate-400 font-black block">Segment Achievements</span>
              <span className="text-xs lg:text-sm font-bold text-[#0A192F] font-mono">
                📊 {attempt.currentBlockIndex + 1} / {lessonBlocks.length} blocks
              </span>
              <span className="text-[9px] text-slate-400 block font-medium">Reconstruction sequence</span>
            </div>

            <div className={`border p-4 rounded-lg shadow-xs space-y-1 ${
              finalStatus === "excused"
                ? "bg-purple-50/55 border-purple-200"
                : finalStatus === "missing"
                  ? "bg-rose-50/55 border-rose-200"
                  : finalStatus === "pending"
                    ? "bg-amber-50/55 border-amber-200"
                    : "bg-white border-slate-200"
            }`}>
              <span className="text-[8.5px] uppercase font-mono tracking-widest text-slate-400 font-black block">Deductive score</span>
              <span className={`text-xs lg:text-sm font-semibold font-mono flex items-center gap-1.5 ${
                finalStatus === "excused"
                  ? "text-purple-700"
                  : finalStatus === "missing"
                    ? "text-rose-700"
                    : finalStatus === "pending"
                      ? "text-amber-700"
                      : "text-indigo-700"
              }`}>
                {finalStatus === "excused" ? (
                  <>🎯 Excused</>
                ) : finalStatus === "missing" ? (
                  <>⚠️ Missing</>
                ) : (
                  <>🎯 {earnedPoints} / {maxLessonPoints} pts {finalStatus === "pending" ? "(Pending)" : ""}</>
                )}
              </span>
              <span className="text-[9px] text-slate-400 block font-semibold">
                {finalStatus === "excused" ? (
                  "Excluded from grade records"
                ) : finalStatus === "missing" ? (
                  "No submission received"
                ) : finalStatus === "pending" ? (
                  `${scorePercentage}% (Awaiting review/grading)`
                ) : (
                  `${scorePercentage}% total grade`
                )}
              </span>
            </div>
          </div>

          {/* Section 1b: Detailed start / end timestamps */}
          <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-xs text-xs font-medium text-slate-600 grid grid-cols-1 sm:grid-cols-2 gap-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="space-y-1">
              <span className="text-[8px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Start Heartbeat Created At</span>
              <p className="text-slate-800 font-semibold">{renderFormattedDate(attempt.startedAt)}</p>
            </div>
            <div className="space-y-1 sm:pl-4">
              <span className="text-[8px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Submissions Completed At</span>
              <p className={`font-semibold ${isCompleted ? 'text-emerald-700' : 'text-slate-500 font-normal italic'}`}>
                {isCompleted 
                  ? renderFormattedDate(attempt.submittedAt || attempt.completedAt) 
                  : "Session currently active (Unsubmitted)"}
              </p>
            </div>
          </div>

          {/* Section 2: Progress map timeline */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-800 border-b border-slate-100 pb-2 uppercase tracking-wide flex items-center gap-1">
              <span>Timeline Blocks Completed map</span>
              <span className="text-slate-400 text-[10px] font-mono font-normal tracking-tight lowercase">({lessonBlocks.length} total sections)</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lessonBlocks.sort((a: any, b: any) => a.order - b.order).map((block: any, idx: number) => {
                const isReached = idx <= attempt.currentBlockIndex;
                const blockCompleted = idx < attempt.currentBlockIndex || attempt.status === "completed";
                const blockTimeSeconds = attempt.blockTimeSpent?.[block.id] || 0;
                const furthestSeconds = attempt.furthestVideoTimestamps?.[block.id];

                return (
                  <div key={block.id} className={`flex items-center gap-3 p-3 rounded-lg border text-xs transition ${
                    blockCompleted 
                      ? "bg-slate-50/50 border-slate-200" 
                      : isReached 
                        ? "bg-indigo-50/20 border-indigo-200/80" 
                        : "opacity-40 bg-slate-50 border-transparent"
                  }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      blockCompleted 
                        ? "bg-emerald-100 text-emerald-800" 
                        : isReached 
                          ? "bg-indigo-100 text-indigo-700" 
                          : "bg-slate-100 text-slate-400"
                    }`}>
                      {blockCompleted ? (
                        <Check className="w-3 h-3 text-emerald-705" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-slate-705 font-bold truncate">
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
                          <span>⏱️ spent {Math.floor(blockTimeSeconds / 60)}m {blockTimeSeconds % 60}s</span>
                        )}
                        {block.type === "video" && furthestSeconds !== undefined && (
                          <span className="text-slate-500 font-bold">🎬 {formatVideoTime(furthestSeconds)} watched</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Focus / Academic Integrity Signal Log */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-3">
            <div className="flex justify-between items-center border-b border-slate-105 pb-2">
              <h4 className="text-xs font-bold text-slate-850 flex items-center gap-2 uppercase tracking-wide">
                <ShieldAlert className="w-4 h-4 text-amber-600" /> classroom safety telemetry && focus logs
              </h4>
              <span className="text-[10px] font-mono font-bold text-[#E5B53B] bg-slate-100 px-2 py-0.5 rounded">
                ⚠️ {totalViolations} focus warning alerts
              </span>
            </div>

            {sSignals.length === 0 ? (
              <div className="py-4 text-xs font-bold text-emerald-800 bg-emerald-50 rounded-lg px-4 flex items-center gap-2 border border-emerald-150">
                <ShieldCheck className="w-4 h-4" />
                <span>Prisinte focus environment: zero classroom violations flagged.</span>
              </div>
            ) : (
              <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {sSignals.map((signal) => {
                  const isReviewed = reviewedSignals.has(signal.id);
                  return (
                    <div 
                      key={signal.id} 
                      className={`p-3 text-xs flex justify-between items-center gap-4 transition-all duration-300 ${
                        isReviewed 
                          ? "bg-emerald-50/25 opacity-60 line-through text-slate-400 border-l-4 border-emerald-500" 
                          : "hover:bg-slate-50 bg-white"
                      }`}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[8.5px] uppercase font-mono font-black px-1.5 py-0.5 rounded border tracking-wider ${
                            isReviewed 
                              ? "bg-slate-100 text-slate-400 border-slate-200"
                              : signal.severity === "high" 
                                ? "bg-red-50 text-red-700 border-red-150"
                                : "bg-amber-50 text-amber-800 border-amber-205"
                          }`}>
                            {signal.eventType.replace("_", " ")}
                          </span>
                          <span className="text-[9.5px] text-slate-400 font-mono font-medium">{renderFormattedDate(signal.timestamp)}</span>
                        </div>
                        <p className={`font-sans ${isReviewed ? "text-slate-400" : "text-slate-700 font-medium"}`}>
                          {signal.metadata?.message || `Alert logged inside block: ${signal.blockId}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {signal.videoTimestamp && (
                          <span className="text-[9px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-semibold">
                            🎬 {signal.videoTimestamp}s
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleSignal(signal.id)}
                          className={`text-[9.5px] font-mono font-bold px-2 py-1 rounded transition border cursor-pointer select-none ${
                            isReviewed 
                              ? "bg-emerald-100 text-emerald-805 border-emerald-200" 
                              : "bg-white text-slate-605 border-slate-250 hover:bg-slate-50 hover:text-slate-850"
                          }`}
                        >
                          {isReviewed ? "✓ Checked" : "Mark checked"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 4: Detailed Questions & Checkpoint evaluations */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2 uppercase tracking-wide border-b border-slate-100 pb-2">
              <BookOpen className="w-4 h-4 text-indigo-700" /> Submissions grading audits &amp; written feedback
            </h4>

            <div className="space-y-5">
              {lessonBlocks.map((block) => {
                const bResponse = sResponses.find((r) => r.blockId === block.id && !r.checkpointId);
                const isQuestionFile = block.type === "question";
                const checkResponses = sResponses.filter((r) => r.blockId === block.id && r.checkpointId);

                return (
                  <div key={block.id} className="bg-white border border-slate-205 p-5 rounded-lg shadow-xs space-y-4">
                    
                    {/* Block Title segment banner */}
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <div className="text-xs font-extrabold text-slate-750 flex items-center gap-1.5">
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
                        Index position: {block.order}
                      </span>
                    </div>

                    {/* Standard question block rendering */}
                    {isQuestionFile && (
                      <div className="text-xs space-y-3 pt-1">
                        <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg">
                          <span className="text-[8.5px] font-bold font-mono uppercase text-slate-400 block mb-1 tracking-wider">Question Stem Description</span>
                          <p className="font-serif leading-relaxed text-slate-700 text-xs italic">
                            "{block.singleQuestion?.stem || block.questionPool?.description || "Assessed lesson item"}"
                          </p>
                        </div>
                        
                        {bResponse ? (
                          <div className="space-y-3">
                            <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs">
                              <span className="text-[8.5px] font-bold font-mono uppercase text-slate-400 block mb-1.5 tracking-wider">Submitted Student Evaluation</span>
                              <div className="font-semibold text-slate-800 text-[12px] bg-slate-50 border border-slate-100 p-2.5 rounded-sm">
                                {bResponse.type === "mc" ? (
                                  <div className="flex items-center gap-1.5">
                                    <span>Selected Choice Index Key:</span>
                                    <strong className="text-[#0A192F]">{bResponse.responseText || bResponse.responseValue}</strong>
                                  </div>
                                ) : (
                                  <div className="font-sans leading-relaxed text-slate-800">
                                    {bResponse.responseValue || <span className="text-slate-400 italic font-mono">(Empty response provided)</span>}
                                  </div>
                                )}
                              </div>

                              {/* Correctness & Points row */}
                              <div className="mt-3 flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {bResponse.type === "mc" ? (
                                    <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded-sm border ${bResponse.isCorrect ? "bg-emerald-50 text-emerald-805 border-emerald-100":"bg-red-50 text-red-800 border-red-100"}`}>
                                      {bResponse.isCorrect ? "✅ MCQ AUTO-GRADER: CORRECT" : "❌ MCQ AUTO-GRADER: INCORRECT"}
                                    </span>
                                  ) : (
                                    <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded-sm border ${
                                      bResponse.aiGrading?.status === "pending"
                                        ? "bg-slate-100 text-slate-500 border-slate-200 animate-pulse"
                                        : bResponse.aiGrading?.status === "needs_review"
                                          ? "bg-amber-50 text-amber-805 border-amber-200 font-bold"
                                          : bResponse.aiGrading?.status === "failed"
                                            ? "bg-red-50 text-red-700 border-red-100"
                                            : "bg-emerald-50 text-emerald-800 border-emerald-100 font-bold"
                                    }`}>
                                      💬 AI STATUS: {bResponse.aiGrading?.status ? bResponse.aiGrading.status.toUpperCase() : "AWAITING AI REPORT"}
                                    </span>
                                  )}

                                  {bResponse.isLowEffort && (
                                    <span className="bg-rose-50 border border-rose-200 text-rose-800 text-[8.5px] font-mono font-bold px-2 py-0.5 rounded-sm uppercase tracking-wide flex items-center gap-1 animate-pulse">
                                      ⚠️ Low Effort Flagged
                                    </span>
                                  )}

                                  {bResponse.teacherOverride && (
                                    <span className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[8.5px] font-mono font-bold px-2 py-0.5 rounded-sm uppercase tracking-wide">
                                      ✍️ Teacher Override Applied
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono font-bold text-slate-650">
                                  Current Points: <span className="text-slate-800 font-extrabold">{bResponse.score}</span> / {block.points || (block.singleQuestion?.points || 0)} pts
                                </div>
                              </div>

                              {/* Low Effort warnings details */}
                              {bResponse.isLowEffort && (
                                <div className="mt-3 bg-rose-50 border border-rose-150 rounded-lg p-3 text-xs text-rose-900 flex items-start gap-2 shadow-2xs font-sans">
                                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                  <div>
                                    <strong className="block text-rose-955 font-bold">Academic Integrity Warning: Low-Effort Response</strong>
                                    <p className="text-xs text-rose-800 font-serif leading-relaxed mt-0.5">
                                      Flag reason: {bResponse.lowEffortReason || "Response is extremely short, keyboard smash, or lacks linguistic structure."}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* AI rationale block if type is SA */}
                              {bResponse.type === "sa" && bResponse.aiGrading && (
                                <div className="mt-3 bg-indigo-50/40 border border-indigo-100 rounded-lg p-3.5 space-y-1.5 text-[11.5px] text-indigo-900">
                                  <div className="flex justify-between items-center text-[10px] uppercase font-mono font-bold text-indigo-700 tracking-wider">
                                    <span>🤖 AI Evaluation Rubric Assistant</span>
                                    <span>Confidence: {Math.round((bResponse.aiGrading.confidence || 0) * 100)}%</span>
                                  </div>
                                  <p className="font-sans leading-relaxed text-indigo-950 font-medium whitespace-pre-wrap">{bResponse.aiGrading.rationale || "No evaluation description generated."}</p>
                                  {bResponse.aiGrading.rubricBreakdown && (
                                    <div className="text-[10px] pt-1 text-indigo-805 font-semibold space-y-1">
                                      <span className="block italic text-[9px] text-[#0A192F] tracking-wide uppercase font-black">Criterion Match:</span>
                                      {Object.entries(bResponse.aiGrading.rubricBreakdown).map(([criterion, item]: any) => (
                                        <div key={criterion} className="flex justify-between bg-white/40 px-2 py-1 rounded">
                                          <span>{criterion}:</span>
                                          <span className="font-mono font-bold">Score {item.score} &bull; Feedback: {item.feedback || "Checked"}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Teacher Grade Override Input and Feedback Form */}
                            <div className="p-4 bg-[#F8F9FA] border border-slate-200 rounded-lg space-y-3 text-xs shadow-3xs">
                              <div className="flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                                <span className="font-bold text-slate-700 text-[11px] uppercase">✍️ Section Grade Correction &amp; Feedback Panel</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                <div className="sm:col-span-1 space-y-1">
                                  <label className="text-[9px] font-mono font-black uppercase text-slate-500 block">Override Points</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max={block.points || block.singleQuestion?.points || 10}
                                    value={overrideScores[bResponse.id] !== undefined ? overrideScores[bResponse.id] : (bResponse.teacherOverride?.score ?? bResponse.score ?? 0)}
                                    onChange={(e) => setOverrideScores({ ...overrideScores, [bResponse.id]: Number(e.target.value) })}
                                    className="w-full text-xs font-mono font-bold text-center bg-white border border-slate-250 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400 font-extrabold"
                                  />
                                </div>
                                <div className="sm:col-span-3 space-y-1">
                                  <label className="text-[9px] font-mono font-black uppercase text-slate-500 block">Teacher Notes / Evaluation Comments</label>
                                  <textarea
                                    value={overrideNotes[bResponse.id] !== undefined ? overrideNotes[bResponse.id] : (bResponse.teacherOverride?.notes ?? bResponse.notes ?? "")}
                                    onChange={(e) => setOverrideNotes({ ...overrideNotes, [bResponse.id]: e.target.value })}
                                    placeholder="Provide detailed feedback, instructional support, or reasons for point overrides..."
                                    rows={2}
                                    className="w-full text-xs bg-white border border-slate-250 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400 leading-normal"
                                  />
                                </div>
                              </div>

                              <div className="flex justify-between items-center pt-1.5 border-t border-slate-100">
                                <div>
                                  {saveSuccess[bResponse.id] && (
                                    <span className="text-[10.5px] font-bold text-emerald-750 flex items-center gap-1 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded">
                                      ✓ Feedback Overrides saved successfully!
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveOverrideAndNotes(bResponse.id, block.points || block.singleQuestion?.points || 10)}
                                  disabled={savingState[bResponse.id]}
                                  className="bg-indigo-650 hover:bg-[#15294b] disabled:bg-slate-205 text-white text-[10px] font-bold uppercase py-2 px-4 rounded transition flex items-center gap-1.5 cursor-pointer shadow-xs tracking-wider border border-indigo-500"
                                >
                                  {savingState[bResponse.id] ? "⌛ Saving..." : "Lock in Corrections"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-400 text-xs italic bg-slate-50/50 p-3 rounded-lg border border-dashed border-slate-200 flex items-center gap-1.5 uppercase font-mono tracking-tight font-bold">
                            ⚠️ Candidate has not yet submitted evaluation for standard item.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Checkpoints embedded responses within video block */}
                    {block.type === "video" && block.videoCheckpoints && block.videoCheckpoints.length > 0 && (
                      <div className="space-y-4 pt-1">
                        <div className="bg-slate-100/50 p-2.5 rounded border border-slate-200 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-[10px] font-mono uppercase text-slate-500 font-bold tracking-wider">Video Timeline Assessed Checkpoints</span>
                        </div>
                        {block.videoCheckpoints.map((cp: any) => {
                          const cpResp = checkResponses.filter((r) => r.checkpointId === cp.id);

                          return (
                            <div key={cp.id} className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 text-xs space-y-3">
                              <div className="flex justify-between items-center text-[10.5px] bg-slate-150 p-2 border border-slate-205 rounded-md font-semibold text-slate-700">
                                <span className="font-bold">Checkpoint: {cp.title}</span>
                                <span className="text-slate-500 font-mono font-medium text-[10px]">Playback trigger timestamp: {cp.timestamp}s ({cp.isRequired ? "REQUIRED" : "OPTIONAL"})</span>
                              </div>
                              
                              {cpResp.length === 0 ? (
                                <span className="text-slate-400 italic block font-semibold text-[11px] px-2">
                                  ⚠️ Checkpoint not yet encountered or skipped by student.
                                </span>
                              ) : (
                                cpResp.map((cr) => (
                                  <div key={cr.id} className="p-3 bg-white border border-slate-205 rounded-lg mt-2 space-y-3 shadow-xs">
                                    <div className="p-2.5 bg-slate-50/60 border border-slate-100 rounded-sm">
                                      <span className="text-[8px] font-bold text-slate-400 tracking-wider font-mono uppercase block mb-1">Response Value</span>
                                      <p className="font-bold text-slate-800 text-[11.5px]">
                                        {cr.type === "mc" ? `Selected choice text: ${cr.responseText || cr.responseValue}` : cr.responseValue}
                                      </p>
                                    </div>

                                    {/* CP Correctness info */}
                                    <div className="flex items-center justify-between border-t border-slate-100 pt-2 flex-wrap gap-2">
                                      <div className="flex items-center gap-2 flex-wrap text-[9px] font-bold font-mono">
                                        {cr.type === "mc" ? (
                                          <span className={`px-2 py-0.5 rounded-sm border ${cr.isCorrect ? 'bg-emerald-50 text-emerald-850 border-emerald-100':'bg-red-50 text-red-800 border-red-105'}`}>
                                            MC CORRECTNESS: {cr.isCorrect ? "CORRECT" : "WRONG"}
                                          </span>
                                        ) : (
                                          <span className="bg-indigo-50 border border-indigo-200 text-indigo-805 px-2 py-0.5 rounded-sm uppercase tracking-wider">
                                            AI-GRADED RESPONSE
                                          </span>
                                        )}
                                        {cr.teacherOverride && (
                                          <span className="bg-indigo-50 border border-indigo-100 text-indigo-800 px-2 py-0.5 rounded-sm uppercase tracking-wide">
                                            ✍️ Override Applied
                                          </span>
                                        )}
                                      </div>
                                      <span className="font-bold font-mono text-slate-650">
                                        Score: <span className="font-extrabold text-slate-800">{cr.score}</span> pts
                                      </span>
                                    </div>

                                    {/* Inline Checkpoint Score input & comment overrides */}
                                    <div className="p-3 bg-[#F8F9FA] border border-slate-200 rounded-md space-y-2.5 text-[11px]">
                                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                                        <div className="sm:col-span-1 space-y-1">
                                          <label className="text-[8.5px] font-mono font-black uppercase text-slate-500 block">Override Points</label>
                                          <input
                                            type="number"
                                            min="0"
                                            max={10}
                                            value={overrideScores[cr.id] !== undefined ? overrideScores[cr.id] : (cr.teacherOverride?.score ?? cr.score ?? 0)}
                                            onChange={(e) => setOverrideScores({ ...overrideScores, [cr.id]: Number(e.target.value) })}
                                            className="w-full text-xs font-mono font-black text-center bg-white border border-slate-205 rounded p-1.5 focus:ring-0 focus:outline-none focus:border-slate-400"
                                          />
                                        </div>
                                        <div className="sm:col-span-3 space-y-1">
                                          <label className="text-[8.5px] font-mono font-black uppercase text-slate-500 block">Checkpoint Feedback Notes</label>
                                          <input
                                            type="text"
                                            value={overrideNotes[cr.id] !== undefined ? overrideNotes[cr.id] : (cr.teacherOverride?.notes ?? cr.notes ?? "")}
                                            onChange={(e) => setOverrideNotes({ ...overrideNotes, [cr.id]: e.target.value })}
                                            placeholder="Notes or grading explanation..."
                                            className="w-full text-xs bg-white border border-slate-210 rounded-md p-1.5 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400"
                                          />
                                        </div>
                                      </div>

                                      <div className="flex justify-between items-center">
                                        <div>
                                          {saveSuccess[cr.id] && (
                                            <span className="text-[10px] font-extrabold text-emerald-805 bg-emerald-50 px-2 py-0.5 rounded-sm border border-emerald-200">
                                              Saved checkpoint update!
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveOverrideAndNotes(cr.id, 10)}
                                          disabled={savingState[cr.id]}
                                          className="bg-indigo-650 hover:bg-[#15294b] disabled:bg-slate-200 text-white text-[9.5px] font-black uppercase py-1.5 px-3 rounded transition cursor-pointer shadow-xs"
                                        >
                                          {savingState[cr.id] ? "⌛" : "Save CP Override"}
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

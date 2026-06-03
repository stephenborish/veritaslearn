import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  Check,
  RotateCcw,
  Award,
  AlertCircle,
  AlertTriangle,
  Clock,
  TrendingDown,
  Eye,
  EyeOff,
  ThumbsUp,
  Edit3,
  Send,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

// Review queue status categories
type ReviewStatus =
  | "pending_ai"
  | "error"
  | "needs_teacher_review"
  | "ai_scored_awaiting_review"
  | "reviewed_not_released"
  | "feedback_released";

type ReviewFilter = ReviewStatus | "all" | "integrity" | "anomalies";

interface QueueItem {
  responseId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseId: string;
  courseName: string;
  assignmentId: string;
  lessonTitle: string;
  questionText: any;
  rubricCategories: any[];
  studentResponse: string;
  isPractice: boolean;
  category: "practice" | "assessment";
  aiScore?: number;
  maxScore?: number;
  aiFeedback?: string;
  aiRationale?: string;
  rubricBreakdown: Record<string, { score: number; maxScore?: number; feedback: string }>;
  confidence?: number;
  needsTeacherReview: boolean;
  isLowEffort: boolean;
  lowEffortReason?: string;
  teacherOverride?: { score: number; notes: string; gradedAt: string };
  teacherReviewedAt?: string;
  feedbackReleasedAt?: string;
  feedbackVisibleToStudent: boolean;
  reviewStatus: ReviewStatus;
  submittedAt?: string;
  activeTimeSpent: number;
  attemptId: string;
}

const STATUS_LABELS: Record<ReviewStatus, { label: string; color: string; bg: string; border: string }> = {
  pending_ai:               { label: "AI Pending",               color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200" },
  error:                    { label: "Error / Manual Required",   color: "text-red-700",    bg: "bg-red-50",    border: "border-red-200" },
  needs_teacher_review:     { label: "Needs Review",              color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200" },
  ai_scored_awaiting_review:{ label: "AI Scored — Awaiting Review", color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
  reviewed_not_released:    { label: "Reviewed, Not Released",    color: "text-teal-700",   bg: "bg-teal-50",   border: "border-teal-200" },
  feedback_released:        { label: "Feedback Released",         color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
};

const FILTER_ORDER: ReviewStatus[] = [
  "pending_ai",
  "error",
  "needs_teacher_review",
  "ai_scored_awaiting_review",
  "reviewed_not_released",
  "feedback_released",
];

interface AIReviewProps {
  students: any[];
  lessons: any[];
  blocks: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  assignments?: any[];
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
  onOpenDossier: (studentId: string, lessonId: string) => void;
  idToken?: string | null;
  onRefresh?: () => void;
}

export default function AIReview({
  students,
  lessons,
  blocks,
  attempts,
  responses,
  signals,
  assignments = [],
  onOverrideSave,
  onOpenDossier,
  idToken,
  onRefresh,
}: AIReviewProps) {
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>("needs_teacher_review");
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [overrideScores, setOverrideScores] = useState<Record<string, number>>({});
  const [overrideNotes, setOverrideNotes] = useState<Record<string, string>>({});
  const [studentFeedback, setStudentFeedback] = useState<Record<string, string>>({});
  const [actionState, setActionState] = useState<Record<string, "idle" | "loading" | "done" | "error">>({});
  const [filterAssignment, setFilterAssignment] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");

  // Integrity signals
  const highSignals = signals.filter((s) => s.severity === "high");
  const signalsByStudent: Record<string, any[]> = {};
  highSignals.forEach((s) => {
    if (!signalsByStudent[s.studentId]) signalsByStudent[s.studentId] = [];
    signalsByStudent[s.studentId].push(s);
  });
  const studentSignalEntries = Object.entries(signalsByStudent);

  // Anomalies (built from props, as before)
  const anomalies: Array<{ type: string; student: any; attempt: any; lesson: any; detail: string }> = [];
  attempts.forEach((attempt) => {
    const student = students.find((s) => s.id === attempt.studentId);
    const lesson = lessons.find((l) => l.id === attempt.lessonId);
    if (!student || !lesson) return;
    if (attempt.status === "completed" && lesson.estimatedMinutes > 0) {
      const expected = lesson.estimatedMinutes * 60;
      if (attempt.activeTimeSpent < expected * 0.3) {
        anomalies.push({ type: "fast_completion", student, attempt, lesson,
          detail: `Completed in ${Math.round(attempt.activeTimeSpent / 60)}m active time (expected ~${lesson.estimatedMinutes}m)` });
      }
    }
    if (attempt.status !== "completed") {
      const hoursAgo = (Date.now() - new Date(attempt.lastActiveAt || attempt.startedAt).getTime()) / 3600000;
      if (hoursAgo > 48) {
        anomalies.push({ type: "inactive", student, attempt, lesson,
          detail: `Started ${Math.round(hoursAgo / 24)}d ago — has not completed` });
      }
    }
    const aResponses = responses.filter((r) => r.attemptId === attempt.id);
    if (aResponses.length > 0 && attempt.activeTimeSpent < 60) {
      anomalies.push({ type: "low_time", student, attempt, lesson,
        detail: `${aResponses.length} response(s) submitted with only ${attempt.activeTimeSpent}s active time` });
    }
  });

  const loadQueue = useCallback(async () => {
    if (!idToken) return;
    setLoadingQueue(true);
    try {
      const params = new URLSearchParams();
      if (filterAssignment) params.set("assignmentId", filterAssignment);
      if (filterCategory) params.set("category", filterCategory);
      const r = await fetch(`/api/ai-review/queue?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (r.ok) {
        const data = await r.json();
        setQueueItems(data.queue || []);
        setCounts(data.counts || {});
      }
    } catch (e) {
      console.error("Failed to load review queue", e);
    } finally {
      setLoadingQueue(false);
    }
  }, [idToken, filterAssignment, filterCategory]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const apiAction = async (
    url: string,
    method: string,
    body: object,
    itemId: string
  ) => {
    if (!idToken) return false;
    setActionState((s) => ({ ...s, [itemId]: "loading" }));
    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setActionState((s) => ({ ...s, [itemId]: "done" }));
        await loadQueue();
        if (onRefresh) onRefresh();
        return true;
      }
      setActionState((s) => ({ ...s, [itemId]: "error" }));
    } catch {
      setActionState((s) => ({ ...s, [itemId]: "error" }));
    }
    return false;
  };

  const handleApprove = (item: QueueItem) =>
    apiAction(`/api/ai-review/${item.responseId}/approve`, "POST", {}, item.responseId);

  const handleOverride = (item: QueueItem) => {
    const score = overrideScores[item.responseId] ?? item.aiScore ?? 0;
    const notes = overrideNotes[item.responseId] || "";
    const sf = studentFeedback[item.responseId] || "";
    return apiAction(`/api/ai-review/${item.responseId}/override`, "POST",
      { score, teacherOnlyNotes: notes, studentFacingFeedback: sf }, item.responseId);
  };

  const handleMarkReviewed = (item: QueueItem) =>
    apiAction(`/api/ai-review/${item.responseId}/mark-reviewed`, "POST",
      { teacherOnlyNotes: overrideNotes[item.responseId] || "" }, item.responseId);

  const handleReleaseFeedback = (item: QueueItem) => {
    const sf = studentFeedback[item.responseId] || item.aiFeedback || "";
    return apiAction(`/api/ai-review/${item.responseId}/release-feedback`, "POST",
      { studentFacingFeedback: sf }, item.responseId);
  };

  // Derived counts for filter tabs
  const saQueueCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const filterCounts: Record<ReviewFilter, number> = {
    all: saQueueCount + studentSignalEntries.length + anomalies.length,
    pending_ai: counts["pending_ai"] || 0,
    error: counts["error"] || 0,
    needs_teacher_review: counts["needs_teacher_review"] || 0,
    ai_scored_awaiting_review: counts["ai_scored_awaiting_review"] || 0,
    reviewed_not_released: counts["reviewed_not_released"] || 0,
    feedback_released: counts["feedback_released"] || 0,
    integrity: studentSignalEntries.length,
    anomalies: anomalies.length,
  };

  const visibleQueueItems =
    activeFilter === "all" ||
    activeFilter === "integrity" ||
    activeFilter === "anomalies"
      ? queueItems
      : queueItems.filter((i) => i.reviewStatus === activeFilter);

  const showSAQueue =
    activeFilter !== "integrity" && activeFilter !== "anomalies";
  const showIntegrity =
    activeFilter === "all" || activeFilter === "integrity";
  const showAnomalies =
    activeFilter === "all" || activeFilter === "anomalies";

  const formatEventType = (t: string) =>
    t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const uniqueAssignments = Array.from(
    new Map(
      (assignments || []).map((a: any) => [a.id, a])
    ).values()
  );

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1 bg-white border border-slate-200 rounded p-1 shadow-sm">
          {/* All */}
          {(["all", ...FILTER_ORDER, "integrity", "anomalies"] as ReviewFilter[]).map((f) => {
            const meta = FILTER_ORDER.includes(f as ReviewStatus)
              ? STATUS_LABELS[f as ReviewStatus]
              : null;
            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition cursor-pointer flex items-center gap-1 ${
                  activeFilter === f
                    ? "bg-[#0A192F] text-white"
                    : meta
                    ? `${meta.color} ${meta.bg} border ${meta.border} hover:opacity-90`
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {f === "all"
                  ? "All"
                  : f === "integrity"
                  ? "Focus Events"
                  : f === "anomalies"
                  ? "Anomalies"
                  : STATUS_LABELS[f as ReviewStatus]?.label || f}
                {filterCounts[f] > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${activeFilter === f ? "bg-white/20 text-white" : "bg-white/70 text-slate-700"}`}>
                    {filterCounts[f]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Refinement filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={filterAssignment}
            onChange={(e) => setFilterAssignment(e.target.value)}
            className="text-[10px] border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white focus:outline-none"
          >
            <option value="">All Assignments</option>
            {uniqueAssignments.map((a: any) => (
              <option key={a.id} value={a.id}>{a.lessonTitle || a.id}</option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-[10px] border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white focus:outline-none"
          >
            <option value="">All Categories</option>
            <option value="assessment">Assessment</option>
            <option value="practice">Practice</option>
          </select>
          <button
            onClick={loadQueue}
            className="p-1.5 rounded border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingQueue ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* SA Review Queue */}
      {showSAQueue && (
        <div className="space-y-4">
          {visibleQueueItems.length === 0 && !loadingQueue && (
            <div className="text-center py-12 bg-white border border-slate-200 rounded text-slate-400">
              <Check className="w-10 h-10 mx-auto text-slate-300 stroke-1 mb-2" />
              <p className="text-sm font-medium">
                {activeFilter === "needs_teacher_review"
                  ? "No responses need your review right now."
                  : activeFilter === "feedback_released"
                  ? "No feedback has been released yet."
                  : "Nothing in this category."}
              </p>
            </div>
          )}

          {loadingQueue && (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2">
              <RotateCcw className="w-4 h-4 animate-spin" />
              Loading review queue…
            </div>
          )}

          {visibleQueueItems.map((item) => {
            const statusMeta = STATUS_LABELS[item.reviewStatus];
            const isExpanded = expandedItem === item.responseId;
            const state = actionState[item.responseId] || "idle";

            return (
              <motion.div
                key={item.responseId}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm"
              >
                {/* Header */}
                <div
                  className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex flex-wrap justify-between items-center gap-2 cursor-pointer"
                  onClick={() => setExpandedItem(isExpanded ? null : item.responseId)}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <span className="text-xs font-bold text-slate-800">{item.studentName}</span>
                      <span className="text-[10px] text-slate-400 font-mono ml-2">({item.studentEmail})</span>
                    </div>
                    <span className="text-[9px] font-mono text-slate-400">{item.lessonTitle}</span>
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${
                      item.isPractice ? "bg-sky-50 text-sky-700 border-sky-200" : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}>
                      {item.isPractice ? "Practice" : "Assessment"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Status badge */}
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${statusMeta?.color} ${statusMeta?.bg} ${statusMeta?.border}`}>
                      {statusMeta?.label}
                    </span>
                    {item.isLowEffort && (
                      <span className="text-[9px] font-mono uppercase bg-rose-50 text-rose-700 border border-rose-300 font-bold px-2 py-0.5 rounded-sm flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Low Effort
                      </span>
                    )}
                    {item.teacherOverride && (
                      <span className="text-[9px] font-mono uppercase bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2 py-0.5 rounded-sm">
                        Override Applied
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {/* Collapsed summary */}
                {!isExpanded && (
                  <div className="px-5 py-2 flex items-center gap-4 text-[10px] font-mono text-slate-500 border-b border-slate-100">
                    <span>AI: <strong className="text-slate-700">{item.aiScore ?? "—"}/{item.maxScore ?? "—"}</strong></span>
                    {item.confidence !== undefined && (
                      <span className={item.confidence > 0.8 ? "text-emerald-600" : "text-amber-600"}>
                        {Math.round(item.confidence * 100)}% confidence
                      </span>
                    )}
                    <span className="truncate max-w-xs italic text-slate-400">
                      {typeof item.studentResponse === "string" ? item.studentResponse.substring(0, 80) : ""}…
                    </span>
                  </div>
                )}

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* Left: Question + Response */}
                        <div className="lg:col-span-7 space-y-4">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Question Prompt</span>
                              {item.lessonTitle && (
                                <span className="text-[9px] font-mono text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">{item.lessonTitle}</span>
                              )}
                            </div>
                            <div className="p-4 bg-slate-50/50 border border-slate-200/60 rounded text-slate-800 font-serif text-sm leading-relaxed">
                              {item.questionText ? (
                                <RichContentRenderer content={item.questionText} />
                              ) : (
                                <span className="italic text-slate-400">Question text not available.</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">Student Response</span>
                            <div className="bg-slate-50 border border-slate-200 p-4 rounded font-serif text-sm leading-relaxed text-slate-800 shadow-inner">
                              {item.studentResponse || <span className="text-slate-400 italic">No response</span>}
                            </div>
                            {item.isLowEffort && (
                              <div className="mt-2 bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-800 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                <div>
                                  <strong className="block">Low-Effort Flag</strong>
                                  <span>{item.lowEffortReason || "Short or gibberish pattern."}</span>
                                </div>
                              </div>
                            )}
                            <div className="text-[10px] text-slate-400 font-mono mt-1.5">
                              ACTIVE WRITING TIME: <strong>{Math.floor(item.activeTimeSpent / 60)}m {item.activeTimeSpent % 60}s</strong>
                            </div>
                          </div>

                          {/* Rubric breakdown */}
                          {Object.keys(item.rubricBreakdown || {}).length > 0 && (
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">Rubric Breakdown</span>
                              <div className="space-y-1.5">
                                {Object.entries(item.rubricBreakdown).map(([cat, val]: [string, any]) => (
                                  <div key={cat} className="bg-slate-50 border border-slate-100 rounded p-2.5 text-[11px]">
                                    <div className="flex justify-between items-center mb-0.5">
                                      <span className="font-semibold text-slate-700">{cat}</span>
                                      <span className="font-mono font-bold text-slate-800">{val.score}/{val.maxScore ?? "?"}</span>
                                    </div>
                                    {val.feedback && <p className="text-slate-500 leading-relaxed">{val.feedback}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Right: AI Assessment + Actions */}
                        <div className="lg:col-span-5 space-y-4 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6">
                          {/* AI score panel */}
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">AI Assessment</span>
                            {item.reviewStatus === "pending_ai" ? (
                              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-700 flex items-center gap-2">
                                <RotateCcw className="w-4 h-4 animate-spin text-blue-500" />
                                AI grading in progress…
                              </div>
                            ) : item.reviewStatus === "error" ? (
                              <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                AI grading failed. Manual override required.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                  <span className="text-xs text-slate-500">AI Score</span>
                                  <span className="font-bold font-mono text-slate-800">{item.aiScore}/{item.maxScore}</span>
                                </div>
                                {item.confidence !== undefined && (
                                  <div className="flex justify-between border-b border-slate-100 pb-1.5">
                                    <span className="text-xs text-slate-500">Confidence</span>
                                    <span className={`text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded-sm border ${
                                      item.confidence > 0.8
                                        ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                                        : "bg-amber-50 text-amber-800 border-amber-100"
                                    }`}>
                                      {Math.round(item.confidence * 100)}%
                                    </span>
                                  </div>
                                )}
                                {item.aiRationale && (
                                  <div className="bg-slate-50 border border-slate-200 p-3 rounded text-[11px] text-slate-600 leading-relaxed">
                                    <strong className="block text-[10px] uppercase tracking-wider mb-1 font-mono text-slate-400">Rationale (teacher-only)</strong>
                                    {item.aiRationale}
                                  </div>
                                )}
                                {item.aiFeedback && (
                                  <div className="bg-sky-50 border border-sky-100 p-3 rounded text-[11px] text-slate-600 leading-relaxed">
                                    <strong className="block text-[10px] uppercase tracking-wider mb-1 font-mono text-sky-500">Student-Facing Feedback</strong>
                                    {item.aiFeedback}
                                  </div>
                                )}
                                {item.teacherOverride && (
                                  <div className="bg-amber-50 border border-amber-200 p-2.5 rounded text-[11px] text-amber-800">
                                    <strong>Override: </strong>{item.teacherOverride.score} pts — {item.teacherOverride.notes}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Feedback release status */}
                          <div className="flex items-center gap-2 py-2 border-t border-slate-100">
                            {item.feedbackVisibleToStudent ? (
                              <>
                                <Eye className="w-4 h-4 text-emerald-500" />
                                <span className="text-[10px] text-emerald-700 font-mono font-bold">Feedback visible to student</span>
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-4 h-4 text-slate-400" />
                                <span className="text-[10px] text-slate-500 font-mono">Hidden from student</span>
                              </>
                            )}
                          </div>

                          {/* Teacher actions */}
                          {item.reviewStatus !== "feedback_released" && (
                            <div className="border-t border-slate-200 pt-4 space-y-3">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1.5">
                                <Award className="w-4 h-4 text-[#0A192F]" /> Teacher Actions
                              </span>

                              {/* Score override */}
                              <div className="flex gap-2 items-end">
                                <div className="w-1/3">
                                  <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Score</label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={item.maxScore}
                                    value={overrideScores[item.responseId] !== undefined
                                      ? overrideScores[item.responseId]
                                      : (item.teacherOverride?.score ?? item.aiScore ?? 0)}
                                    onChange={(e) => setOverrideScores({ ...overrideScores, [item.responseId]: Number(e.target.value) })}
                                    className="w-full text-xs font-mono font-bold text-center bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none focus:border-slate-400"
                                  />
                                </div>
                                <div className="flex-1">
                                  <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Teacher Notes (private)</label>
                                  <input
                                    type="text"
                                    value={overrideNotes[item.responseId] || ""}
                                    onChange={(e) => setOverrideNotes({ ...overrideNotes, [item.responseId]: e.target.value })}
                                    placeholder="Teacher-only note…"
                                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none"
                                  />
                                </div>
                              </div>

                              {/* Student-facing feedback editor */}
                              <div>
                                <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Student-Facing Feedback (visible after release)</label>
                                <textarea
                                  rows={3}
                                  value={studentFeedback[item.responseId] !== undefined
                                    ? studentFeedback[item.responseId]
                                    : (item.aiFeedback || "")}
                                  onChange={(e) => setStudentFeedback({ ...studentFeedback, [item.responseId]: e.target.value })}
                                  placeholder="Edit the feedback students will see…"
                                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none font-serif leading-relaxed resize-none"
                                />
                              </div>

                              {/* Action buttons */}
                              <div className="flex flex-wrap gap-2">
                                {/* Approve AI (no score change) */}
                                {(item.reviewStatus === "ai_scored_awaiting_review" || item.reviewStatus === "needs_teacher_review") && (
                                  <button
                                    onClick={() => handleApprove(item)}
                                    disabled={state === "loading"}
                                    className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition cursor-pointer"
                                  >
                                    <ThumbsUp className="w-3.5 h-3.5" />
                                    Approve AI Score
                                  </button>
                                )}
                                {/* Override */}
                                <button
                                  onClick={() => handleOverride(item)}
                                  disabled={state === "loading"}
                                  className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  Override Score
                                </button>
                                {/* Mark reviewed (no score change) */}
                                {item.reviewStatus === "needs_teacher_review" && (
                                  <button
                                    onClick={() => handleMarkReviewed(item)}
                                    disabled={state === "loading"}
                                    className="flex items-center gap-1 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    Mark Reviewed
                                  </button>
                                )}
                                {/* Release feedback */}
                                {(item.reviewStatus === "reviewed_not_released" ||
                                  item.reviewStatus === "ai_scored_awaiting_review" ||
                                  item.teacherReviewedAt) && (
                                  <button
                                    onClick={() => handleReleaseFeedback(item)}
                                    disabled={state === "loading"}
                                    className="flex items-center gap-1 bg-[#0A192F] hover:bg-[#15294b] disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition cursor-pointer"
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                    Release Feedback
                                  </button>
                                )}
                              </div>

                              {state === "done" && (
                                <p className="text-[10px] text-emerald-600 font-mono">✓ Saved</p>
                              )}
                              {state === "error" && (
                                <p className="text-[10px] text-red-600 font-mono">Failed to save. Try again.</p>
                              )}
                            </div>
                          )}

                          {/* Already released state */}
                          {item.reviewStatus === "feedback_released" && (
                            <div className="border-t border-slate-200 pt-3 text-[11px] text-emerald-700 flex items-center gap-2">
                              <Eye className="w-4 h-4" />
                              Feedback released to student.
                              {item.feedbackReleasedAt && (
                                <span className="text-slate-400 font-mono text-[9px]">
                                  {new Date(item.feedbackReleasedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Integrity Signals Section */}
      {showIntegrity && studentSignalEntries.length > 0 && (
        <div className="space-y-3">
          {(activeFilter === "all" || activeFilter === "integrity") && (
            <div className="flex items-center gap-2 mt-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">Focus Events</h3>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {studentSignalEntries.map(([sid, sigs]) => {
              const student = students.find((s) => s.id === sid);
              const attempt = attempts.find((a) => a.studentId === sid);
              const lesson = attempt ? lessons.find((l) => l.id === attempt.lessonId) : null;
              const eventTypes = [...new Set(sigs.map((s) => s.eventType))];
              return (
                <div
                  key={sid}
                  className="bg-white border border-amber-200 rounded p-4 shadow-sm hover:shadow transition cursor-pointer"
                  onClick={() => attempt && lesson && onOpenDossier(sid, lesson.id)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-sm font-bold text-slate-800">{student?.name || "Unknown"}</div>
                      <div className="text-[10px] font-mono text-slate-400">{student?.email}</div>
                    </div>
                    <span className="bg-amber-100 text-amber-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded-sm uppercase tracking-widest">
                      {sigs.length} signal{sigs.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {lesson && <div className="text-[10px] text-slate-500 font-medium mb-2">{lesson.title}</div>}
                  <div className="flex flex-wrap gap-1">
                    {eventTypes.slice(0, 4).map((t) => (
                      <span key={t} className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-mono uppercase tracking-wider">
                        {formatEventType(t)}
                      </span>
                    ))}
                    {eventTypes.length > 4 && <span className="text-[8px] text-slate-400 font-mono">+{eventTypes.length - 4} more</span>}
                  </div>
                  <div className="mt-2 text-[9px] text-slate-400 font-mono uppercase tracking-wider">Review dossier →</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Anomalies Section */}
      {showAnomalies && anomalies.length > 0 && (
        <div className="space-y-3">
          {(activeFilter === "all" || activeFilter === "anomalies") && (
            <div className="flex items-center gap-2 mt-2">
              <TrendingDown className="w-4 h-4 text-slate-400" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">Anomalies</h3>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {anomalies.map((item, idx) => (
              <div
                key={idx}
                className="bg-white border border-slate-200 rounded p-4 shadow-sm hover:shadow transition cursor-pointer"
                onClick={() => onOpenDossier(item.student.id, item.lesson.id)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">{item.student.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{item.student.email}</div>
                  </div>
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-sm uppercase tracking-widest ${
                    item.type === "fast_completion" ? "bg-orange-50 text-orange-700 border border-orange-200"
                    : item.type === "inactive" ? "bg-slate-100 text-slate-600"
                    : "bg-red-50 text-red-700 border border-red-100"
                  }`}>
                    {item.type === "fast_completion" ? "Fast Completion" : item.type === "inactive" ? "Inactive" : "Low Active Time"}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 font-medium mb-1">{item.lesson.title}</div>
                <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                  <Clock className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                  {item.detail}
                </div>
                <div className="mt-2 text-[9px] text-slate-400 font-mono uppercase tracking-wider">Review dossier →</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

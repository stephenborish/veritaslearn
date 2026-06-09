import { useState, useEffect, useCallback, useMemo } from "react";
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
  Zap,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";
import { deriveStudentAssignmentSummary } from "../../lib/teacherAnalytics";
import {
  deriveReviewQueueItems,
  reviewQueueTypeLabel,
  type ReviewQueueItem,
  type ReviewQueueItemType,
} from "../../lib/courseProgress";
import { getSignalDetailedExplanation, getDetailedSignalContext } from "../../lib/integritySignals";

// Review queue status categories
type ReviewStatus =
  | "pending_ai"
  | "error"
  | "needs_teacher_review"
  | "ai_scored_awaiting_review"
  | "reviewed_not_released"
  | "feedback_released";

type ReviewFilter = "all" | "needs_grading" | "integrity" | "ai_agent" | "feedback_not_released" | "high_priority";

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
  onOpenDossier: (
    studentId: string,
    lessonId: string,
    nav?: {
      entries: { studentId: string; lessonId: string; label?: string }[];
      index: number;
      label?: string;
      initialSection?: string;
    }
  ) => void;
  idToken?: string | null;
  onRefresh?: () => void;
}

const FILTERS: { value: ReviewFilter; label: string; bgClass: string; textClass: string; borderClass: string }[] = [
  { value: "all", label: "All Items", bgClass: "bg-slate-50", textClass: "text-slate-700", borderClass: "border-slate-200" },
  { value: "needs_grading", label: "Needs Grading", bgClass: "bg-violet-50", textClass: "text-violet-700", borderClass: "border-violet-200" },
  { value: "integrity", label: "Integrity Signals", bgClass: "bg-amber-50", textClass: "text-amber-700", borderClass: "border-amber-200" },
  { value: "ai_agent", label: "Signals of AI Agent Use", bgClass: "bg-rose-50", textClass: "text-rose-700", borderClass: "border-rose-200 animate-pulse" },
  { value: "feedback_not_released", label: "Feedback Ready", bgClass: "bg-emerald-50", textClass: "text-emerald-700", borderClass: "border-emerald-200" },
  { value: "high_priority", label: "High Priority", bgClass: "bg-red-50", textClass: "text-red-700", borderClass: "border-red-200" },
];

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
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>("all");
  const [dismissingAttemptId, setDismissingAttemptId] = useState<string | null>(null);

  const handleDismissAttemptSignals = async (attemptId: string) => {
    if (!idToken || !attemptId) return;
    setDismissingAttemptId(attemptId);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/dismiss-all-signals`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json"
        }
      });
      if (res.ok) {
        if (onRefresh) onRefresh();
        loadQueue();
      }
    } catch (e) {
      console.error("Failed to dismiss attempt signals in review queue flow", e);
    } finally {
      setDismissingAttemptId(null);
    }
  };
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
  const [sortBy, setSortBy] = useState<string>("confidenceAsc");

  // Quick Grade Mode & Modal States
  const [quickGradeMode, setQuickGradeMode] = useState<boolean>(false);
  const [quickGradeItem, setQuickGradeItem] = useState<QueueItem | null>(null);
  const [quickScore, setQuickScore] = useState<number>(0);
  const [quickNotes, setQuickNotes] = useState<string>("");
  const [quickFeedback, setQuickFeedback] = useState<string>("");
  const [quickGradeLoading, setQuickGradeLoading] = useState<boolean>(false);
  const [quickGradeError, setQuickGradeError] = useState<string | null>(null);
  const [quickGradeSuccess, setQuickGradeSuccess] = useState<boolean>(false);

  // Derive student-assignment summaries using original helper modules
  const summaries = useMemo(() => {
    const list: any[] = [];
    const studentList = students || [];
    const assignmentList = assignments || [];
    for (const student of studentList) {
      if (!student?.id) continue;
      for (const assignment of assignmentList) {
        if (!assignment?.id) continue;
        const lesson = (lessons || []).find((l) => l.id === assignment.lessonId) || {
          id: assignment.lessonId,
          title: assignment.lessonTitle || "Untitled Lesson",
        };
        const summary = deriveStudentAssignmentSummary({
          student,
          lesson,
          assignment,
          blocks: blocks || [],
          attempts: attempts || [],
          responses: responses || [],
          signals: signals || [],
          activities: [],
          lessonVersions: [],
        });
        list.push(summary);
      }
    }
    return list;
  }, [students, assignments, lessons, blocks, attempts, responses, signals]);

  // Unified action-item Review Queue derived from those summaries
  const derivedItems = useMemo(() => {
    return deriveReviewQueueItems(summaries);
  }, [summaries]);

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

  const openQuickGrade = (item: QueueItem) => {
    setQuickGradeItem(item);
    setQuickScore(item.teacherOverride?.score ?? item.aiScore ?? 0);
    setQuickNotes(item.teacherOverride?.notes || overrideNotes[item.responseId] || "");
    setQuickFeedback(item.aiFeedback || studentFeedback[item.responseId] || "");
    setQuickGradeError(null);
    setQuickGradeSuccess(false);
  };

  const handleQuickGradeSubmit = async () => {
    if (!quickGradeItem || !idToken) return;
    setQuickGradeLoading(true);
    setQuickGradeError(null);
    try {
      const res = await fetch(`/api/ai-review/${quickGradeItem.responseId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          score: quickScore,
          teacherOnlyNotes: quickNotes,
          studentFacingFeedback: quickFeedback,
        }),
      });
      if (res.ok) {
        setQuickGradeSuccess(true);
        setOverrideScores((prev) => ({ ...prev, [quickGradeItem.responseId]: quickScore }));
        setOverrideNotes((prev) => ({ ...prev, [quickGradeItem.responseId]: quickNotes }));
        setStudentFeedback((prev) => ({ ...prev, [quickGradeItem.responseId]: quickFeedback }));
        await loadQueue();
        if (onRefresh) onRefresh();
        setTimeout(() => {
          setQuickGradeItem(null);
        }, 800);
      } else {
        setQuickGradeError("Failed to save grade. Please check constraints.");
      }
    } catch (e) {
      setQuickGradeError("Network error occurred while saving grade.");
    } finally {
      setQuickGradeLoading(false);
    }
  };

  const handleQuickGradeApprove = async () => {
    if (!quickGradeItem || !idToken) return;
    setQuickGradeLoading(true);
    setQuickGradeError(null);
    try {
      const res = await fetch(`/api/ai-review/${quickGradeItem.responseId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        setQuickGradeSuccess(true);
        await loadQueue();
        if (onRefresh) onRefresh();
        setTimeout(() => {
          setQuickGradeItem(null);
        }, 850);
      } else {
        setQuickGradeError("Failed to approve AI score.");
      }
    } catch {
      setQuickGradeError("Network error.");
    } finally {
      setQuickGradeLoading(false);
    }
  };

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
  const filterCounts = useMemo(() => {
    return {
      all: derivedItems.length,
      needs_grading: derivedItems.filter((i) => i.type === "needs_grading").length,
      integrity: derivedItems.filter((i) => i.type === "integrity_cluster").length,
      ai_agent: derivedItems.filter((i) => i.type === "ai_agent").length,
      feedback_not_released: derivedItems.filter((i) => i.type === "feedback_ready").length,
      high_priority: derivedItems.filter((i) => i.priority === "high" || i.type === "ai_agent").length,
    };
  }, [derivedItems]);

  const filteredQueueItems = useMemo(() => {
    return derivedItems.filter((item) => {
      // 1. Filter by assignment
      if (filterAssignment && item.assignmentId !== filterAssignment) return false;

      // 2. Filter by category (practice vs assessment)
      if (filterCategory) {
        const hasPractice = queueItems.some(
          (q) => q.studentId === item.studentId && q.assignmentId === item.assignmentId && q.isPractice
        );
        if (filterCategory === "practice" && !hasPractice) return false;
        if (filterCategory === "assessment" && hasPractice) return false;
      }

      // 3. Filter by Active Filter Tab
      if (activeFilter === "needs_grading") {
        return item.type === "needs_grading";
      }
      if (activeFilter === "integrity") {
        return item.type === "integrity_cluster";
      }
      if (activeFilter === "ai_agent") {
        return item.type === "ai_agent";
      }
      if (activeFilter === "feedback_not_released") {
        return item.type === "feedback_ready";
      }
      if (activeFilter === "high_priority") {
        return item.priority === "high" || item.type === "ai_agent";
      }
      return true; // "all"
    });
  }, [derivedItems, activeFilter, filterAssignment, filterCategory]);

  const visibleQueueItems = useMemo(() => {
    const result = [...filteredQueueItems];
    if (sortBy === "confidenceAsc" || sortBy === "confidenceDesc") {
      result.sort((a, b) => {
        // Find minimum confidence in responses of both
        const getMinConf = (x: typeof a) => {
          const confs = (responses || [])
            .filter((r) => r.attemptId === x.attemptId && r.aiGrading?.confidence !== undefined)
            .map((r) => r.aiGrading.confidence);
          return confs.length > 0 ? Math.min(...confs) : 1;
        };
        const cA = getMinConf(a);
        const cB = getMinConf(b);
        return sortBy === "confidenceAsc" ? cA - cB : cB - cA;
      });
    } else if (sortBy === "submittedAtDesc" || sortBy === "submittedAtAsc") {
      result.sort((a, b) => {
        const tA = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const tB = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
        return sortBy === "submittedAtDesc" ? tB - tA : tA - tB;
      });
    }
    return result;
  }, [filteredQueueItems, sortBy, responses]);

  const showSAQueue = true;
  const showIntegrity = false;
  const showAnomalies = false;

  const formatEventType = (t: string): string => {
    const labels: Record<string, string> = {
      fullscreen_exit: "Exited fullscreen",
      fullscreen_enter: "Entered fullscreen",
      visibility_hidden: "Switched tabs",
      visibility_visible: "Tab returned",
      tab_change: "Switched tabs",
      blur: "Switched tabs",
      focus_lost: "Switched tabs",
      window_blur: "Switched tabs",
      ai_agent_detected: "AI Guard marker appeared in submitted response",
      ai_agent_use: "AI Guard marker appeared in submitted response",
      possible_ai_agent_use: "AI Guard marker appeared in submitted response",
      lockout: "Attempt blocked",
      focus_lockout: "Attempt blocked",
      lockout_override: "Block removed by teacher",
      copy: "Copied assessment text",
      paste: "Pasted text",
      right_click: "Right-clicked in assessment",
      devtools_open: "Developer tools opened",
      multiple_monitors: "Multiple monitors detected",
    };
    return labels[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const uniqueAssignments = Array.from(
    new Map(
      (assignments || []).map((a: any) => [a.id, a])
    ).values()
  );

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1 bg-white border border-slate-200 rounded p-1 shadow-sm font-sans">
          {FILTERS.map((f) => {
            const count = filterCounts[f.value];
            return (
              <button
                key={f.value}
                onClick={() => setActiveFilter(f.value)}
                className={`px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition cursor-pointer flex items-center gap-1 ${
                  activeFilter === f.value
                    ? "bg-[#0A192F] text-white"
                    : `${f.bgClass} ${f.textClass} border ${f.borderClass} hover:opacity-90`
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${activeFilter === f.value ? "bg-white/20 text-white" : "bg-white/70 text-slate-700"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Refinement filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Grade Mode Toggle */}
          <button
            onClick={() => setQuickGradeMode(!quickGradeMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border shadow-sm transition cursor-pointer ${
              quickGradeMode
                ? "bg-amber-500 border-amber-500 text-white hover:bg-amber-600"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            title="When active, clicking any response in the list will open the Quick Grade floating modal directly instead of expanding"
          >
            <Zap className={`w-3.5 h-3.5 ${quickGradeMode ? "fill-white text-white" : "text-amber-500"}`} />
            Quick Grade Mode: <span className="font-extrabold">{quickGradeMode ? "ON" : "OFF"}</span>
          </button>

          <span className="h-4 w-px bg-slate-200 hidden sm:inline-block"></span>

          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={filterAssignment}
            onChange={(e) => setFilterAssignment(e.target.value)}
            className="text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white focus:outline-none"
          >
            <option value="">All Assignments</option>
            {uniqueAssignments.map((a: any) => (
              <option key={a.id} value={a.id}>{a.lessonTitle || a.id}</option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-[10px] border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white focus:outline-none"
          >
            <option value="">All Categories</option>
            <option value="assessment">Assessment</option>
            <option value="practice">Practice</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-[10px] border border-amber-200 rounded px-2 py-1.5 text-amber-950 bg-amber-50 font-semibold focus:outline-none hover:bg-amber-100 hover:border-amber-300 transition"
            title="Sort to prioritize reviewing responses where the AI model was less certain"
          >
            <option value="confidenceAsc">Sort: Uncertain AI First (Prioritize)</option>
            <option value="confidenceDesc">Sort: Certain AI First</option>
            <option value="submittedAtDesc">Sort: Newest Submissions</option>
            <option value="submittedAtAsc">Sort: Oldest Submissions</option>
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
        <div className="space-y-4 font-sans">
          {visibleQueueItems.length === 0 && !loadingQueue && (
            <div className="text-center py-12 bg-white border border-slate-200 rounded text-slate-400 font-sans">
              <Check className="w-10 h-10 mx-auto text-slate-300 stroke-1 mb-2" />
              <p className="text-sm font-medium">
                No items match the selected filter.
              </p>
            </div>
          )}

          {loadingQueue && (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2 font-mono">
              <RotateCcw className="w-4 h-4 animate-spin" />
              Loading review queue details…
            </div>
          )}

          {visibleQueueItems.map((item) => {
            const isExpanded = expandedItem === item.id;

            // Select color-logical styling based on the item category/classification
            const typeStylesValue = {
              ai_agent: {
                borderL: "border-l-4 border-l-rose-500",
                badgeBg: "bg-rose-50 border border-rose-200 animate-pulse",
                badgeText: "text-rose-700",
                bgHover: "hover:bg-rose-50/20"
              },
              integrity_cluster: {
                borderL: "border-l-4 border-l-amber-500",
                badgeBg: "bg-amber-50 border border-amber-200",
                badgeText: "text-amber-700",
                bgHover: "hover:bg-amber-50/20"
              },
              needs_grading: {
                borderL: "border-l-4 border-l-violet-500",
                badgeBg: "bg-violet-50 border border-violet-200",
                badgeText: "text-violet-700",
                bgHover: "hover:bg-violet-50/20"
              },
              feedback_ready: {
                borderL: "border-l-4 border-l-emerald-500",
                badgeBg: "bg-emerald-50 border border-emerald-200",
                badgeText: "text-emerald-700",
                bgHover: "hover:bg-emerald-50/20"
              }
            };
            const styles = typeStylesValue[item.type] || typeStylesValue.needs_grading;

            // Fetch responses matching this student + assignment
            const matchingResponses = queueItems.filter(
              (q) => q.studentId === item.studentId && q.assignmentId === item.assignmentId
            );

            // Fetch integrity signals matching this student + attempt
            const studentSignals = signals.filter(
              (s) => s.studentId === item.studentId && s.attemptId === item.attemptId
            );

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white border border-slate-200 rounded overflow-hidden shadow-sm transition ${
                  isExpanded ? "ring-1 ring-slate-300" : ""
                }`}
              >
                {/* Header */}
                <div
                  className={`border-b border-slate-200 px-5 py-3 flex flex-wrap justify-between items-center gap-2 cursor-pointer transition bg-slate-50 ${styles.borderL} ${styles.bgHover}`}
                  onClick={() => {
                    setExpandedItem(isExpanded ? null : item.id);
                  }}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <span className="text-xs font-bold text-slate-800">{item.studentName}</span>
                      <span className="text-[10px] text-slate-400 font-mono ml-2">({item.summary.studentEmail})</span>
                    </div>
                    <span className="text-[9px] font-mono text-slate-400 font-medium truncate max-w-[150px] sm:max-w-[250px]">
                      {item.lessonTitle}
                    </span>
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${styles.badgeBg} ${styles.badgeText}`}>
                      {reviewQueueTypeLabel(item.type)}
                    </span>
                    {item.priority === "high" && (
                      <span className="text-[8px] bg-red-100 text-red-800 border border-red-200 font-extrabold uppercase px-1.5 py-0.5 rounded-sm animate-pulse flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3 text-red-600" /> High Attention
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[10px] text-slate-500 italic max-w-xs truncate hidden md:inline-block">
                      {item.reason}
                    </span>
                    
                    <button
                      onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                      className="p-1 rounded hover:bg-slate-200 transition text-slate-500 font-sans cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                  </div>
                </div>

                {/* Collapsed summary info */}
                {!isExpanded && (
                  <div className="px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500 border-b border-slate-100 bg-white">
                    <span>REASON: <strong className="text-slate-700 font-sans font-medium">{item.reason}</strong></span>
                    {item.lastActivityAt && (
                      <span>Activity: <strong className="text-slate-600 font-sans font-medium">{new Date(item.lastActivityAt).toLocaleString()}</strong></span>
                    )}
                    <span className="text-slate-400 font-medium whitespace-nowrap ml-auto">Click to view details & actions →</span>
                  </div>
                )}

                {/* Expanded Sections */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      {/* Grading / Feedback release types */}
                      {(item.type === "needs_grading" || item.type === "feedback_ready") ? (
                        matchingResponses.length === 0 ? (
                          <div className="p-6 text-center text-slate-400 text-xs">
                            {loadingQueue ? (
                              <div className="flex items-center justify-center gap-2">
                                <RotateCcw className="w-4 h-4 animate-spin text-slate-400" />
                                Loading response details from servers…
                              </div>
                            ) : (
                              "No short-answer response details available in this queue item right now."
                            )}
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-200 bg-slate-50/30">
                            {matchingResponses.map((rItem) => {
                              const statusMeta = STATUS_LABELS[rItem.reviewStatus];
                              const state = actionState[rItem.responseId] || "idle";

                              return (
                                <div key={rItem.responseId} className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
                                  {/* Left: Question + Response */}
                                  <div className="lg:col-span-7 space-y-4">
                                    <div className="flex justify-between items-center bg-white border border-slate-100 rounded-sm p-2 shadow-sm">
                                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">Response ID: {rItem.responseId.substring(0, 8)}</span>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => openQuickGrade(rItem)}
                                          className="px-2 py-0.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-[9px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                        >
                                          <Zap className="w-3 h-3 fill-white" /> Quick Grade
                                        </button>
                                        <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${statusMeta?.color} ${statusMeta?.bg} ${statusMeta?.border}`}>
                                          {statusMeta?.label}
                                        </span>
                                      </div>
                                    </div>

                                    <div>
                                      <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Question Prompt</span>
                                        {rItem.lessonTitle && (
                                          <span className="text-[9px] font-mono text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">{rItem.lessonTitle}</span>
                                        )}
                                      </div>
                                      <div className="p-4 bg-slate-50/50 border border-slate-200/60 rounded text-slate-800 font-serif text-sm leading-relaxed">
                                        {rItem.questionText ? (
                                          <RichContentRenderer content={rItem.questionText} />
                                        ) : (
                                          <span className="italic text-slate-400">Question prompt not available.</span>
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">Student Response</span>
                                      <div className="bg-white border border-slate-200 p-4 rounded font-serif text-sm leading-relaxed text-slate-800 shadow-sm">
                                        {rItem.studentResponse || <span className="text-slate-400 italic">No response</span>}
                                      </div>
                                      {rItem.isLowEffort && (
                                        <div className="mt-2 bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-800 flex items-start gap-2">
                                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                          <div>
                                            <strong className="block font-sans">Low-Effort Flag</strong>
                                            <span className="font-sans">{rItem.lowEffortReason || "Short or low-effort pattern detected."}</span>
                                          </div>
                                        </div>
                                      )}
                                      <div className="text-[10px] text-slate-400 font-mono mt-1.5 flex justify-between items-center">
                                        <span>ACTIVE WRITING TIME: <strong>{Math.floor(rItem.activeTimeSpent / 60)}m {rItem.activeTimeSpent % 60}s</strong></span>
                                        <button
                                          onClick={() => {
                                            onOpenDossier(rItem.studentId, rItem.assignmentId, {
                                              entries: [{ studentId: rItem.studentId, lessonId: rItem.assignmentId, label: rItem.studentName }],
                                              index: 0,
                                              label: "Detailed Review",
                                              initialSection: "responses"
                                            });
                                          }}
                                          className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline cursor-pointer"
                                        >
                                          Open Full Dossier →
                                        </button>
                                      </div>
                                    </div>

                                    {/* Rubric breakdown */}
                                    {Object.keys(rItem.rubricBreakdown || {}).length > 0 && (
                                      <div>
                                        <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">Rubric Breakdown</span>
                                        <div className="space-y-1.5 font-sans">
                                          {Object.entries(rItem.rubricBreakdown).map(([cat, val]: [string, any]) => (
                                            <div key={cat} className="bg-white border border-slate-100 rounded p-2.5 text-[11px] shadow-sm">
                                              <div className="flex justify-between items-center mb-0.5">
                                                <span className="font-semibold text-slate-700">{cat}</span>
                                                <span className="font-mono font-bold text-slate-800">{val.score}/{val.maxScore ?? "?"}</span>
                                              </div>
                                              {val.feedback && <p className="text-slate-500 leading-relaxed font-sans">{val.feedback}</p>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Right: AI Assessment + Actions */}
                                  <div className="lg:col-span-5 space-y-4 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6 bg-white rounded-md p-4 shadow-sm font-sans">
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">AI Assessment</span>
                                      {rItem.reviewStatus === "pending_ai" ? (
                                        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-700 flex items-center gap-2 font-mono">
                                          <RotateCcw className="w-4 h-4 animate-spin text-blue-500" />
                                          AI grading in progress…
                                        </div>
                                      ) : rItem.reviewStatus === "error" ? (
                                        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 flex items-center gap-2 font-sans font-medium">
                                          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                                          AI grading paused. Manual override required.
                                        </div>
                                      ) : (
                                        <div className="space-y-2">
                                          <div className="flex justify-between border-b border-slate-100 pb-1.5 text-xs text-slate-500">
                                            <span>AI Assigned Score</span>
                                            <span className="font-bold font-mono text-slate-800">{rItem.aiScore}/{rItem.maxScore}</span>
                                          </div>
                                          {rItem.confidence !== undefined && (
                                            <div className="flex justify-between border-b border-slate-100 pb-1.5 text-xs text-slate-500">
                                              <span>Grading Confidence</span>
                                              <span className={`text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded-sm border ${
                                                rItem.confidence < 0.65
                                                  ? "bg-rose-50 text-rose-800 border-rose-100 animate-pulse"
                                                  : rItem.confidence < 0.85
                                                  ? "bg-amber-50 text-amber-800 border-amber-100"
                                                  : "bg-emerald-50 text-emerald-800 border-emerald-100"
                                              }`}>
                                                {Math.round(rItem.confidence * 100)}% {rItem.confidence < 0.65 ? "(Uncertain)" : rItem.confidence < 0.85 ? "(Medium)" : "(High)"}
                                              </span>
                                            </div>
                                          )}
                                          {rItem.aiRationale && (
                                            <div className="bg-slate-50 border border-slate-200 p-3 rounded text-[11px] text-slate-600 leading-relaxed font-sans">
                                              <strong className="block text-[10px] uppercase tracking-wider mb-1 font-mono text-slate-400 font-bold">AI Rationale (Private)</strong>
                                              {rItem.aiRationale}
                                            </div>
                                          )}
                                          {rItem.aiFeedback && (
                                            <div className="bg-sky-50 border border-sky-100 p-3 rounded text-[11px] text-slate-600 leading-relaxed font-sans">
                                              <strong className="block text-[10px] uppercase tracking-wider mb-1 font-mono text-sky-500 font-bold font-sans">Generated Student Feedback</strong>
                                              {rItem.aiFeedback}
                                            </div>
                                          )}
                                          {rItem.teacherOverride && (
                                            <div className="bg-amber-50 border border-amber-200 p-2.5 rounded text-[11px] text-amber-800 font-sans">
                                              <strong>Override Verdict: </strong>{rItem.teacherOverride.score} pts — {rItem.teacherOverride.notes}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {/* Feedback release status indicator */}
                                    <div className="flex items-center gap-2 py-2 border-t border-slate-100">
                                      {rItem.feedbackVisibleToStudent ? (
                                        <>
                                          <Eye className="w-4 h-4 text-emerald-500" />
                                          <span className="text-[10px] text-emerald-700 font-mono font-bold uppercase tracking-wider">Feedback Visible to Student</span>
                                        </>
                                      ) : (
                                        <>
                                          <EyeOff className="w-4 h-4 text-slate-400" />
                                          <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Hidden from Student</span>
                                        </>
                                      )}
                                    </div>

                                    {/* Actions form */}
                                    {rItem.reviewStatus !== "feedback_released" && (
                                      <div className="border-t border-slate-200 pt-4 space-y-3">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1.5">
                                          <Award className="w-4 h-4 text-[#0A192F]" /> Review Decision Actions
                                        </span>

                                        <div className="flex gap-2 items-end">
                                          <div className="w-1/3">
                                            <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Score</label>
                                            <input
                                              type="number"
                                              min={0}
                                              max={rItem.maxScore}
                                              value={overrideScores[rItem.responseId] !== undefined
                                                ? overrideScores[rItem.responseId]
                                                : (rItem.teacherOverride?.score ?? rItem.aiScore ?? 0)}
                                              onChange={(e) => setOverrideScores({ ...overrideScores, [rItem.responseId]: Number(e.target.value) })}
                                              className="w-full text-xs font-mono font-bold text-center bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none focus:border-slate-400"
                                            />
                                          </div>
                                          <div className="flex-1">
                                            <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Private Notes</label>
                                            <input
                                              type="text"
                                              value={overrideNotes[rItem.responseId] || ""}
                                              onChange={(e) => setOverrideNotes({ ...overrideNotes, [rItem.responseId]: e.target.value })}
                                              placeholder="Private review notes…"
                                              className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none"
                                            />
                                          </div>
                                        </div>

                                        <div>
                                          <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Interactive Student Feedback</label>
                                          <textarea
                                            rows={2}
                                            value={studentFeedback[rItem.responseId] !== undefined
                                              ? studentFeedback[rItem.responseId]
                                              : (rItem.aiFeedback || "")}
                                            onChange={(e) => setStudentFeedback({ ...studentFeedback, [rItem.responseId]: e.target.value })}
                                            placeholder="Refine or write student-facing response feedback here…"
                                            className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none font-serif leading-relaxed resize-none text-slate-800"
                                          />
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                          {(rItem.reviewStatus === "ai_scored_awaiting_review" || rItem.reviewStatus === "needs_teacher_review") && (
                                            <button
                                              onClick={() => handleApprove(rItem)}
                                              disabled={state === "loading"}
                                              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition-all cursor-pointer shadow-sm font-sans"
                                            >
                                              <ThumbsUp className="w-3.5 h-3.5 animate-pulse" /> Approve AI Score
                                            </button>
                                          )}
                                          <button
                                            onClick={() => handleOverride(rItem)}
                                            disabled={state === "loading"}
                                            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition-all cursor-pointer shadow-sm font-sans"
                                          >
                                            <Edit3 className="w-3.5 h-3.5" /> Override Score
                                          </button>
                                          {rItem.reviewStatus === "needs_teacher_review" && (
                                            <button
                                              onClick={() => handleMarkReviewed(rItem)}
                                              disabled={state === "loading"}
                                              className="flex items-center gap-1 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition-all cursor-pointer shadow-sm font-sans"
                                            >
                                              <Check className="w-3.5 h-3.5" /> Mark Reviewed
                                            </button>
                                          )}
                                          {(rItem.reviewStatus === "reviewed_not_released" ||
                                            rItem.reviewStatus === "ai_scored_awaiting_review" ||
                                            rItem.teacherReviewedAt) && (
                                            <button
                                              onClick={() => handleReleaseFeedback(rItem)}
                                              disabled={state === "loading"}
                                              className="flex items-center gap-1 bg-[#0A192F] hover:bg-[#15294b] disabled:opacity-50 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded transition-all cursor-pointer shadow-sm font-sans"
                                            >
                                              <Send className="w-3.5 h-3.5" /> Release Feedback
                                            </button>
                                          )}
                                        </div>

                                        {state === "done" && (
                                          <p className="text-[10px] text-emerald-600 font-mono font-semibold">✓ Action Saved Successfully</p>
                                        )}
                                        {state === "error" && (
                                          <p className="text-[10px] text-red-600 font-mono font-semibold">Failed to persist. Try again.</p>
                                        )}
                                      </div>
                                    )}

                                    {rItem.reviewStatus === "feedback_released" && (
                                      <div className="border-t border-slate-200 pt-3 text-[11px] text-emerald-700 flex items-center gap-2 font-mono font-bold">
                                        <Eye className="w-4 h-4 text-emerald-500" /> Released {rItem.feedbackReleasedAt && new Date(rItem.feedbackReleasedAt).toLocaleDateString()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      ) : (
                        /* Integrity alerts and pacing patterns types */
                        <div className="p-5 space-y-4 bg-white border-t border-slate-100 font-sans">
                          <div className={`p-4 rounded-md border flex gap-3 ${
                            item.type === "ai_agent"
                              ? "bg-rose-50 border-rose-200 text-rose-800"
                              : "bg-amber-50 border-amber-200 text-amber-800"
                          }`}>
                            <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${
                              item.type === "ai_agent" ? "text-rose-600" : "text-amber-500"
                            }`} />
                            <div className="space-y-1">
                              <h4 className="text-sm font-bold font-sans">
                                {item.type === "ai_agent"
                                  ? "High-Attention Pattern (Signals of AI Agent Use)"
                                  : "Teacher Attention Recommended (Unusual Pacing Pattern)"}
                              </h4>
                              <p className="text-xs leading-relaxed text-slate-600 font-sans">
                                Review the activity timeline and focus shifts during the assignment.
                              </p>
                              {item.reason && (
                                <div className="text-xs font-mono font-bold mt-2 bg-white/70 px-2 py-1.5 rounded border border-slate-100 max-w-lg">
                                  TIMELINE HIGHLIGHT: {item.reason}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                            {/* Left: Signals List */}
                            <div className="md:col-span-8 space-y-3">
                              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-widest font-mono">Student Focus & Event Timeline</span>
                              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/30 max-h-80 overflow-y-auto shadow-inner space-y-2.5 p-3">
                                {studentSignals.length === 0 ? (
                                  <p className="p-4 text-xs text-slate-400 italic font-sans text-center bg-white border border-slate-100 rounded-lg font-sans">No focus events logged for this attempt.</p>
                                ) : (
                                  studentSignals.slice().reverse().map((sig, sidx) => {
                                    const matchingBlock = blocks.find((b) => b.id === sig.blockId);
                                    const lessonBlocks = blocks
                                      .filter((b) => b.lessonId === item.lessonId)
                                      .sort((a, b) => (a.order || 0) - (b.order || 0));
                                    const blockIdx = matchingBlock ? lessonBlocks.indexOf(matchingBlock) : -1;
                                    const blockLabel = blockIdx !== -1
                                      ? `Step ${blockIdx + 1}: ${matchingBlock.title || "Untitled Block"}`
                                      : "General Navigation Session";

                                    const detailsCtx = getDetailedSignalContext(sig, blocks);

                                    return (
                                      <div key={sidx} className="p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm font-sans space-y-1.5 text-xs">
                                        <div className="flex justify-between items-center flex-wrap gap-2">
                                          <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded border tracking-wider bg-amber-50 text-amber-800 border-amber-200">
                                            {detailsCtx.label}
                                          </span>
                                        </div>

                                        <p className="text-[11px] text-slate-600 leading-normal">
                                          {detailsCtx.label} &middot; {blockLabel} &middot; {sig.timestamp ? new Date(sig.timestamp).toLocaleTimeString() : ""}
                                        </p>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>

                            {/* Right: Actions */}
                            <div className="md:col-span-4 p-4 bg-slate-50 rounded border border-slate-200 flex flex-col justify-between space-y-4 font-sans">
                              <div className="space-y-2">
                                <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-widest font-mono">Dossier Overview</span>
                                <div className="text-xs font-sans text-slate-700 space-y-1">
                                  <div className="flex justify-between font-sans">
                                    <span className="text-slate-400">Pacing Punctuality:</span>
                                    <span className="font-bold font-mono font-sans">
                                      {item.summary?.startedAt && item.summary?.lastActivityAt
                                        ? `${Math.round((new Date(item.summary.lastActivityAt).getTime() - new Date(item.summary.startedAt).getTime()) / 60000)} mins`
                                        : "Incomplete/Inactive"}
                                    </span>
                                  </div>
                                  <div className="flex justify-between font-sans">
                                    <span className="text-slate-400">Step Progress:</span>
                                    <span className="font-bold font-mono">
                                      {item.summary?.progressPct ?? 0}% completed
                                    </span>
                                  </div>
                                  <div className="flex justify-between font-bold text-[#0D1A2D] pt-1 border-t border-slate-200 mt-2 font-sans">
                                    <span>Attention Events:</span>
                                    <span>{studentSignals.length} records</span>
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleDismissAttemptSignals(item.attemptId)}
                                disabled={dismissingAttemptId === item.attemptId}
                                className="w-full py-2 mb-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold rounded text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm select-none"
                              >
                                <Check className="w-4 h-4 text-emerald-600" />
                                {dismissingAttemptId === item.attemptId ? "Dismissing..." : "Dismiss Alert"}
                              </button>

                              <button
                                onClick={() => {
                                  onOpenDossier(item.studentId, item.assignmentId, {
                                    entries: [{ studentId: item.studentId, lessonId: item.assignmentId, label: item.studentName }],
                                    index: 0,
                                    label: "Integrity Signals Details",
                                    initialSection: "integrity"
                                  });
                                }}
                                className="w-full py-2 bg-[#0A192F] hover:bg-[#15294b] text-white font-bold rounded text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                              >
                                <Award className="w-4 h-4" /> Open Student Dossier
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Quick Grade Floating Modal */}
      <AnimatePresence>
        {quickGradeItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-xl w-full flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center px-5 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-amber-50 rounded">
                    <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Quick Grade Response</h3>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {quickGradeItem.studentName} · {quickGradeItem.studentEmail}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setQuickGradeItem(null)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition cursor-pointer"
                  aria-label="Close modal"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500">
                  <div>
                    LESSON: <span className="font-semibold text-slate-700">{quickGradeItem.lessonTitle}</span>
                  </div>
                  <div>
                    TYPE: <span className="font-semibold text-slate-700 uppercase">{quickGradeItem.category || (quickGradeItem.isPractice ? "Practice" : "Assessment")}</span>
                  </div>
                </div>

                {/* Question Prompt */}
                <div className="border border-slate-100 rounded bg-slate-50/30 p-3 max-h-24 overflow-y-auto">
                  <span className="text-[9px] font-mono font-bold uppercase text-slate-400 tracking-wider">Question Prompt</span>
                  <div className="text-xs text-slate-700 font-serif leading-relaxed mt-0.5">
                    {quickGradeItem.questionText ? (
                      <RichContentRenderer content={quickGradeItem.questionText} />
                    ) : (
                      <span className="italic text-slate-400">No prompt text</span>
                    )}
                  </div>
                </div>

                {/* Student Response */}
                <div className="border border-slate-100 rounded bg-slate-50 p-3 max-h-36 overflow-y-auto">
                  <span className="text-[9px] font-mono font-bold uppercase text-slate-400 tracking-wider">Student Response</span>
                  <div className="text-xs text-slate-800 font-serif whitespace-pre-wrap leading-relaxed mt-0.5">
                    {quickGradeItem.studentResponse || <span className="italic text-slate-400">Empty response</span>}
                  </div>
                </div>

                {/* Grading Area */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Grading Entry</span>
                    <div className="flex items-center gap-2">
                      {quickGradeItem.aiScore !== undefined && (
                        <span className="text-[10px] text-slate-500">
                          AI Recommended: <strong className="font-mono text-indigo-600">{quickGradeItem.aiScore}/{quickGradeItem.maxScore}</strong>
                        </span>
                      )}
                      {quickGradeItem.confidence !== undefined && (
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                          quickGradeItem.confidence < 0.65
                            ? "bg-rose-50 text-rose-700 border-rose-200 animate-pulse"
                            : quickGradeItem.confidence < 0.85
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>
                          {quickGradeItem.confidence < 0.65 ? (
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                          ) : quickGradeItem.confidence < 0.85 ? (
                            <AlertCircle className="w-3 h-3 text-amber-500" />
                          ) : (
                            <Check className="w-3 h-3 text-emerald-600" />
                          )}
                          <span>Confidence: {Math.round(quickGradeItem.confidence * 100)}%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-4 items-center">
                    {/* Score input */}
                    <div className="w-24 shrink-0">
                      <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Score</label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min={0}
                          max={quickGradeItem.maxScore}
                          value={quickScore}
                          onChange={(e) => setQuickScore(Number(e.target.value))}
                          className="w-full text-sm font-mono font-bold text-center bg-slate-50 border border-slate-300 rounded p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <span className="absolute right-2 text-xs text-slate-400">/{quickGradeItem.maxScore}</span>
                      </div>
                    </div>

                    {/* Quick Points Shortcuts */}
                    <div className="flex-1">
                      <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Score Suggestions</label>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => setQuickScore(0)}
                          className="px-2 py-1.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition cursor-pointer"
                        >
                          0 (No Credit)
                        </button>
                        {quickGradeItem.maxScore && quickGradeItem.maxScore > 1 && (
                          <button
                            type="button"
                            onClick={() => setQuickScore(Math.round(quickGradeItem.maxScore! / 2))}
                            className="px-2 py-1.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition cursor-pointer"
                          >
                            {Math.round(quickGradeItem.maxScore / 2)} (Half)
                          </button>
                        )}
                        {quickGradeItem.aiScore !== undefined && quickGradeItem.aiScore !== 0 && quickGradeItem.aiScore !== quickGradeItem.maxScore && (
                          <button
                            type="button"
                            onClick={() => setQuickScore(quickGradeItem.aiScore!)}
                            className="px-2 py-1.5 text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded transition cursor-pointer"
                          >
                            {quickGradeItem.aiScore} (AI Choice)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setQuickScore(quickGradeItem.maxScore ?? 0)}
                          className="px-2 py-1.5 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded transition cursor-pointer"
                        >
                          {quickGradeItem.maxScore} (Full Credit)
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Private Teacher Notes */}
                  <div>
                    <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Private Teacher Notes</label>
                    <input
                      type="text"
                      value={quickNotes}
                      onChange={(e) => setQuickNotes(e.target.value)}
                      placeholder="Add a private note for your reference…"
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Student-facing feedback editing */}
                  <div>
                    <label className="text-[9px] font-mono font-bold uppercase text-slate-400 block mb-1">Student-Facing Feedback</label>
                    <textarea
                      rows={2}
                      value={quickFeedback}
                      onChange={(e) => setQuickFeedback(e.target.value)}
                      placeholder="Edit the feedback visible to this student…"
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-serif resize-none"
                    />
                  </div>
                </div>

                {quickGradeError && (
                  <p className="text-xs text-rose-600 font-mono bg-rose-50 border border-rose-100 rounded p-2">
                    {quickGradeError}
                  </p>
                )}
                
                {quickGradeSuccess && (
                  <p className="text-xs text-emerald-600 font-mono bg-emerald-50 border border-emerald-100 rounded p-2">
                    ✓ Grade saved successfully!
                  </p>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setQuickGradeItem(null)}
                  disabled={quickGradeLoading}
                  className="px-3 py-1.5 rounded text-xs font-bold text-slate-500 hover:bg-slate-200 border border-slate-200 transition cursor-pointer bg-white"
                >
                  Cancel
                </button>
                {quickGradeItem.reviewStatus === "ai_scored_awaiting_review" && (
                  <button
                    type="button"
                    onClick={handleQuickGradeApprove}
                    disabled={quickGradeLoading}
                    className="px-3 py-1.5 rounded text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition cursor-pointer"
                  >
                    Approve AI Recommendation
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleQuickGradeSubmit}
                  disabled={quickGradeLoading}
                  className="px-3 py-1.5 rounded text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  {quickGradeLoading ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save Grade"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
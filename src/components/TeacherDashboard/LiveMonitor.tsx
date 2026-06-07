import { useState, type MouseEvent } from "react";
import {
  Clock,
  CheckCircle2,
  Lock,
  Unlock,
  AlertTriangle,
  Eye,
  List,
  Grid,
  Search,
  UserX,
  Flag,
  Circle,
  Activity,
} from "lucide-react";
import { motion } from "motion/react";

// Named presence thresholds. "Active recently" means activity within the last 2 minutes.
// "Idle" means no activity for 2–30 minutes. "Stale" means no activity for over 30 minutes.
// These are heuristic labels — they reflect last-reported heartbeat, not live socket presence.
const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 minutes
const IDLE_THRESHOLD_MS = ACTIVE_THRESHOLD_MS; // alias kept for backward compat
const STALE_THRESHOLD_MS = 30 * 60 * 1000;    // 30 minutes

function formatRelativeTime(timestamp: string | undefined): string {
  if (!timestamp) return "Never";
  const ms = Date.now() - new Date(timestamp).getTime();
  if (ms < 0) return "Just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "Active seconds ago";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Active yesterday";
  if (days < 3) return `Active ${days}d ago`;
  return "No recent activity";
}

function get7DayActivityHeatmap(studentId: string, studentActivities: any[]) {
  const result = [];
  const now = new Date();
  
  // Last 7 days, ending with today as index 6
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Day label: M, T, W, etc.
    const daysName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayLabel = daysName[d.getDay()];
    
    // Filter activities for this student on this day
    const dayActivities = (studentActivities || []).filter((act: any) => {
      if (act.studentId !== studentId) return false;
      const actDate = act.timestamp.split('T')[0];
      return actDate === dayStr;
    });

    // Segment into morning (4 AM - 12 PM), afternoon (12 PM - 6 PM), and evening (6 PM - 4 AM)
    let morningCount = 0;
    let afternoonCount = 0;
    let eveningCount = 0;

    dayActivities.forEach((act: any) => {
      const actDateObj = new Date(act.timestamp);
      const hrs = actDateObj.getHours();
      if (hrs >= 4 && hrs < 12) {
        morningCount++;
      } else if (hrs >= 12 && hrs < 18) {
        afternoonCount++;
      } else {
        eveningCount++;
      }
    });

    const total = dayActivities.length;
    let intensity: 'none' | 'low' | 'medium' | 'high' = 'none';
    if (total > 0 && total <= 2) {
      intensity = 'low';
    } else if (total > 2 && total <= 5) {
      intensity = 'medium';
    } else if (total > 5) {
      intensity = 'high';
    }

    result.push({
      dateStr: dayStr,
      dayLabel,
      formattedDate: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' }),
      total,
      intensity,
      periods: {
        morning: morningCount,
        afternoon: afternoonCount,
        evening: eveningCount
      },
      list: dayActivities
    });
  }

  return result;
}

function TooltipWrapper({ children, day }: { children: React.ReactNode, day: any }) {
  const [show, setShow] = useState(false);

  const formatActivitySummary = () => {
    if (day.total === 0) return "No activity recorded";
    const parts = [];
    if (day.periods.morning > 0) parts.push(`Morning: ${day.periods.morning} action(s)`);
    if (day.periods.afternoon > 0) parts.push(`Afternoon: ${day.periods.afternoon} action(s)`);
    if (day.periods.evening > 0) parts.push(`Evening: ${day.periods.evening} action(s)`);
    return parts.join(", ");
  };

  return (
    <div 
      className="relative" 
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-900 border border-slate-800 text-[10px] text-white p-2.5 rounded shadow-lg z-50 pointer-events-none font-sans whitespace-normal normal-case text-center">
          <p className="font-bold border-b border-slate-800 pb-1 mb-1">
            {day.formattedDate}
          </p>
          <p className="text-slate-300 mb-1">
            <strong>{day.total} activities</strong>: {formatActivitySummary()}
          </p>
          {day.total > 0 && (
            <div className="text-[9px] text-slate-400 space-y-0.5 border-t border-slate-800/80 pt-1 mt-1 max-h-20 overflow-y-auto font-mono text-left">
              {day.list.slice(0, 3).map((act: any) => (
                <div key={act.id} className="truncate select-none">
                  - {act.description}
                </div>
              ))}
              {day.total > 3 && (
                <div className="text-[8px] text-slate-500 italic text-center mt-1">
                  + {day.total - 3} more activities
                </div>
              )}
            </div>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45" />
        </div>
      )}
    </div>
  );
}

interface LiveMonitorProps {
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
  studentActivities?: any[];
  onOpenDossier: (studentId: string, lessonId: string) => void;
  onUnlockStudent: (attemptId: string) => void;
}

export default function LiveMonitor({
  students,
  attempts,
  responses,
  signals,
  lessons,
  blocks,
  studentActivities = [],
  onOpenDossier,
  onUnlockStudent,
}: LiveMonitorProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string>("all");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [showPreviewAttempts, setShowPreviewAttempts] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [layoutMode, setLayoutMode] = useState<"grid" | "table">("grid");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const publishedLessons = lessons.filter((l) => l.isPublished);

  const calcMaxPoints = (lessonId: string): number => {
    const lessonBlocks = blocks.filter((b) => b.lessonId === lessonId);
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

  // Status helpers — based on last heartbeat timestamp, not live socket presence.
  const isAttemptActive = (attempt: any): boolean => {
    if (attempt.status === "completed") return false;
    const lastActiveRaw = attempt.lastActiveAt || attempt.startedAt;
    if (!lastActiveRaw) return false;
    return Date.now() - new Date(lastActiveRaw).getTime() <= ACTIVE_THRESHOLD_MS;
  };

  const isAttemptIdle = (attempt: any): boolean => {
    if (attempt.status === "completed") return false;
    const lastActiveRaw = attempt.lastActiveAt || attempt.startedAt;
    if (!lastActiveRaw) return false;
    const elapsed = Date.now() - new Date(lastActiveRaw).getTime();
    return elapsed > ACTIVE_THRESHOLD_MS && elapsed <= STALE_THRESHOLD_MS;
  };

  // Stale: started but no heartbeat for >30 minutes. Possibly disconnected.
  const isAttemptStale = (attempt: any): boolean => {
    if (attempt.status === "completed") return false;
    const lastActiveRaw = attempt.lastActiveAt || attempt.startedAt;
    if (!lastActiveRaw) return true; // no timestamp at all → assume stale
    return Date.now() - new Date(lastActiveRaw).getTime() > STALE_THRESHOLD_MS;
  };

  const isAttemptLocked = (attempt: any): boolean =>
    attempt.lockState === "locked_awaiting_teacher";

  const getAttemptSignalSummary = (attemptId: string) => {
    const sSignals = signals.filter((s) => s.attemptId === attemptId);
    const blurs = sSignals.filter(
      (s) => s.eventType === "blur_focus_lost" || s.eventType === "visibilitychange"
    ).length;
    const fullscreenExits = sSignals.filter(
      (s) => s.eventType === "fullscreen_exit" || s.eventType === "fullscreen_exited"
    ).length;
    const seekBlocks = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
    const copyPastes = sSignals.filter(
      (s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked"
    ).length;
    const total = blurs + fullscreenExits + seekBlocks + copyPastes;
    const mostRecent = sSignals.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
    return { total, blurs, fullscreenExits, seekBlocks, copyPastes, mostRecent };
  };

  const isAttemptNeedsReview = (attempt: any): boolean => {
    if (isAttemptLocked(attempt)) return true;
    // Respect the durable server-side review flag set by the proctoring system.
    if (attempt.securityReviewRequired) return true;
    const { total, fullscreenExits, seekBlocks } = getAttemptSignalSummary(attempt.id);
    if (total >= 3 || fullscreenExits > 0 || seekBlocks > 0) return true;
    const sResponses = responses.filter((r) => r.attemptId === attempt.id);
    return sResponses.some(
      (r) =>
        r.type === "sa" &&
        (!r.aiGrading ||
          r.aiGrading.status === "pending" ||
          r.aiGrading.status === "failed" ||
          r.aiGrading.status === "needs_review")
    );
  };

  // Filter by preview preference
  const allFilteredByPreview = showPreviewAttempts
    ? attempts
    : attempts.filter((a) => !a.isPreviewAttempt);

  // Filter by selected lesson
  const lessonFilteredAttempts =
    selectedLessonId === "all"
      ? allFilteredByPreview
      : allFilteredByPreview.filter((a) => a.lessonId === selectedLessonId);

  // "Not Started" students
  const studentsWithAttempt = new Set(
    allFilteredByPreview
      .filter((a) => selectedLessonId === "all" || a.lessonId === selectedLessonId)
      .map((a) => a.studentId)
  );
  const rawNotStarted = students.filter((s) => !studentsWithAttempt.has(s.id));

  // Counts
  const activeCount = lessonFilteredAttempts.filter(isAttemptActive).length;
  const idleCount = lessonFilteredAttempts.filter(isAttemptIdle).length;
  const staleCount = lessonFilteredAttempts.filter((a) => a.status !== "completed" && isAttemptStale(a)).length;
  const notStartedCount = rawNotStarted.length;
  const completedCount = lessonFilteredAttempts.filter((a) => a.status === "completed").length;
  const needsReviewCount = lessonFilteredAttempts.filter(isAttemptNeedsReview).length;
  const lockedCount = lessonFilteredAttempts.filter(isAttemptLocked).length;
  const grandTotal = lessonFilteredAttempts.length + notStartedCount;

  // Search filter
  const searchFilteredAttempts = lessonFilteredAttempts.filter((attempt) => {
    let student = students.find((s) => s.id === attempt.studentId);
    if (!student && attempt.isPreviewAttempt) {
      student = { name: "Teacher Preview", email: "preview@veritas.local" };
    }
    if (!student) return false;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return student.name.toLowerCase().includes(term) || student.email.toLowerCase().includes(term);
  });

  const searchNotStarted = rawNotStarted.filter((student) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return student.name.toLowerCase().includes(term) || student.email.toLowerCase().includes(term);
  });

  // Status filter
  let visibleAttempts = searchFilteredAttempts;
  let showNotStarted = statusFilter === "all" || statusFilter === "not_started";

  if (statusFilter === "active") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptActive);
    showNotStarted = false;
  } else if (statusFilter === "idle") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptIdle);
    showNotStarted = false;
  } else if (statusFilter === "stale") {
    visibleAttempts = searchFilteredAttempts.filter((a) => a.status !== "completed" && isAttemptStale(a));
    showNotStarted = false;
  } else if (statusFilter === "not_started") {
    visibleAttempts = [];
    showNotStarted = true;
  } else if (statusFilter === "completed") {
    visibleAttempts = searchFilteredAttempts.filter((a) => a.status === "completed");
    showNotStarted = false;
  } else if (statusFilter === "needs_review") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptNeedsReview);
    showNotStarted = false;
  } else if (statusFilter === "locked") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptLocked);
    showNotStarted = false;
  }

  const sortAttempts = (list: any[]) =>
    [...list].sort((a, b) => {
      // Locked first
      const lockA = isAttemptLocked(a) ? 2 : 0;
      const lockB = isAttemptLocked(b) ? 2 : 0;
      if (lockB !== lockA) return lockB - lockA;
      // Needs review second
      const revA = isAttemptNeedsReview(a) ? 1 : 0;
      const revB = isAttemptNeedsReview(b) ? 1 : 0;
      if (revB !== revA) return revB - revA;
      // Active next
      const actA = isAttemptActive(a) ? 1 : 0;
      const actB = isAttemptActive(b) ? 1 : 0;
      return actB - actA;
    });

  const handleUnlock = async (e: MouseEvent, attemptId: string) => {
    e.stopPropagation();
    setUnlockingId(attemptId);
    try {
      await onUnlockStudent(attemptId);
    } finally {
      setUnlockingId(null);
    }
  };

  const formatLastActive = (attempt: any): string => {
    const raw = attempt.lastActiveAt || attempt.startedAt;
    if (!raw) return "Unknown";
    const date = new Date(raw);
    const min = Math.floor((Date.now() - date.getTime()) / 60000);
    if (min < 1) return "Active now";
    if (min < 60) return `${min}m ago`;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const signalEventLabel = (eventType: string): string => {
    const labels: Record<string, string> = {
      blur_focus_lost: "Focus lost",
      visibilitychange: "Tab hidden",
      fullscreen_exit: "Fullscreen exit",
      fullscreen_exited: "Fullscreen exit",
      seek_attempt_blocked: "Seek blocked",
      copy_blocked: "Copy blocked",
      paste_blocked: "Paste blocked",
      context_menu_blocked: "Right-click",
      rapid_navigation: "Navigation skip",
      checkpoint_triggered: "Checkpoint",
      // Browser AI Guard signals
      possible_ai_agent_use: "Possible AI agent use",
      hidden_assessment_text_in_answer: "Hidden assessment text in answer",
      ai_guard_marker_in_answer: "Browser AI Guard marker in answer",
      ai_guard_refusal_phrase_in_answer: "AI refusal phrase in answer",
    };
    return labels[eventType] || eventType;
  };

  return (
    <div className="space-y-5 font-sans">
      {/* Filter/search toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono shrink-0">
              Lesson:
            </label>
            <select
              value={selectedLessonId}
              onChange={(e: any) => { setSelectedLessonId(e.target.value); setStatusFilter("all"); }}
              className="text-xs border border-slate-200 rounded px-3 py-1.5 bg-white text-slate-800 font-semibold focus:outline-none cursor-pointer hover:border-slate-300 transition max-w-xs"
            >
              <option value="all">All lessons</option>
              {publishedLessons.map((l) => (
                <option key={l.id} value={l.id}>{l.title}</option>
              ))}
            </select>

            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                placeholder="Find student…"
                value={searchTerm}
                onChange={(e: any) => setSearchTerm(e.target.value)}
                className="text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 transition w-44 lg:w-52"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded select-none transition">
              <input
                type="checkbox"
                checked={showPreviewAttempts}
                onChange={(e: any) => setShowPreviewAttempts(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-0 cursor-pointer w-3.5 h-3.5"
              />
              <span>Show teacher previews</span>
            </label>

            <div className="flex bg-slate-100 rounded-sm p-0.5 border border-slate-200">
              <button
                onClick={() => setLayoutMode("grid")}
                className={`p-1 rounded-sm transition ${layoutMode === "grid" ? "bg-white text-slate-800 shadow-xs" : "text-slate-400 hover:text-slate-600"}`}
                title="Card view"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLayoutMode("table")}
                className={`p-1 rounded-sm transition ${layoutMode === "table" ? "bg-white text-slate-800 shadow-xs" : "text-slate-400 hover:text-slate-600"}`}
                title="Table view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {[
              { id: "all", label: "All", count: grandTotal, color: "slate" },
              { id: "needs_review", label: "Needs Review", count: needsReviewCount, color: "amber" },
              { id: "locked", label: "Locked", count: lockedCount, color: "red" },
              { id: "active", label: "Active Recently", count: activeCount, color: "green" },
              { id: "idle", label: "Idle", count: idleCount, color: "slate" },
              { id: "stale", label: "Possibly Disconnected", count: staleCount, color: "slate" },
              { id: "not_started", label: "Not Started", count: notStartedCount, color: "slate" },
              { id: "completed", label: "Completed", count: completedCount, color: "blue" },
            ].map((tab) => {
              const isActive = statusFilter === tab.id;
              const hasBadgeAlert = !isActive && (tab.color === "amber" || tab.color === "red") && tab.count > 0;

              let badgeCls = "bg-slate-100 text-slate-500";
              if (isActive) {
                if (tab.color === "green") badgeCls = "bg-emerald-600 text-white";
                else if (tab.color === "blue") badgeCls = "bg-indigo-600 text-white";
                else if (tab.color === "amber") badgeCls = "bg-amber-500 text-slate-900";
                else if (tab.color === "red") badgeCls = "bg-red-600 text-white";
                else badgeCls = "bg-slate-800 text-white";
              } else if (hasBadgeAlert) {
                badgeCls =
                  tab.color === "amber"
                    ? "bg-amber-100 text-amber-800 border border-amber-200"
                    : "bg-red-100 text-red-700 border border-red-200";
              } else if (!isActive && tab.color === "green") {
                badgeCls = "bg-emerald-50 text-emerald-700";
              }

              return (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap transition cursor-pointer select-none ${
                    isActive
                      ? "bg-slate-100 text-slate-900 border border-slate-300"
                      : "text-slate-500 border border-transparent hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full ${badgeCls}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {visibleAttempts.length === 0 && (!showNotStarted || searchNotStarted.length === 0) ? (
        <div className="text-center py-14 bg-white border border-slate-200 rounded-lg text-slate-400 shadow-sm space-y-2">
          <UserX className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-xs font-semibold text-slate-500">No students match this filter</p>
          <p className="text-[11px] text-slate-400">Try adjusting the lesson, status, or search.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* GRID CARD LAYOUT */}
          {layoutMode === "grid" && visibleAttempts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortAttempts(visibleAttempts).map((latestAttempt) => {
                let student = students.find((s) => s.id === latestAttempt.studentId);
                if (!student && latestAttempt.isPreviewAttempt) {
                  student = { id: latestAttempt.studentId, name: "Teacher Preview", email: "preview@veritas.local", role: "student" };
                }
                if (!student) return null;

                const sLesson = lessons.find((l) => l.id === latestAttempt.lessonId);
                const lessonBlocks = blocks.filter((b) => b.lessonId === latestAttempt.lessonId).sort((a: any, b: any) => a.order - b.order);
                const sResponses = responses.filter((r) => r.attemptId === latestAttempt.id);
                const signals_ = getAttemptSignalSummary(latestAttempt.id);

                const isLocked = isAttemptLocked(latestAttempt);
                const isCompleted = latestAttempt.status === "completed";
                const isActive = isAttemptActive(latestAttempt);
                const needsReview = isAttemptNeedsReview(latestAttempt);
                const blockCount = Math.max(lessonBlocks.length, 1);
                const progressPct = isCompleted
                  ? 100
                  : Math.round((latestAttempt.currentBlockIndex / blockCount) * 100);
                const currentBlock = lessonBlocks[latestAttempt.currentBlockIndex];
                const currentBlockName = currentBlock
                  ? currentBlock.title
                  : `Segment ${latestAttempt.currentBlockIndex + 1}`;
                const maxPoints = calcMaxPoints(latestAttempt.lessonId);
                const earnedPoints = latestAttempt ? (latestAttempt.score || 0) : 0;
                const hasPendingGrading = sResponses.some(
                  (r) => r.type === "sa" && (!r.aiGrading || ["pending", "failed", "needs_review"].includes(r.aiGrading.status))
                );

                const isStale = !isCompleted && !isActive && isAttemptStale(latestAttempt);

                const statusLabel = isLocked
                  ? "Locked"
                  : isCompleted
                  ? "Completed"
                  : isActive
                  ? "Active Recently"
                  : isStale
                  ? "Possibly Disconnected"
                  : "Idle";

                const statusBadgeCls = isLocked
                  ? "bg-red-50 text-red-700 border-red-200"
                  : isCompleted
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : isActive
                  ? "bg-green-50 text-green-700 border-green-200"
                  : isStale
                  ? "bg-orange-50 text-orange-700 border-orange-200"
                  : "bg-slate-100 text-slate-500 border-slate-200";

                return (
                  <motion.div
                    key={latestAttempt.id}
                    initial={{ opacity: 0.96 }}
                    animate={{ opacity: 1 }}
                    whileHover={{ y: -1 }}
                    onClick={() => onOpenDossier(student.id, latestAttempt.lessonId)}
                    className={`bg-white border rounded-lg p-4 shadow-xs hover:shadow transition flex flex-col gap-3 cursor-pointer group relative ${
                      isLocked
                        ? "border-amber-300 ring-1 ring-amber-100 bg-amber-50/30"
                        : needsReview
                        ? "border-amber-200 bg-[#FCFBF8] hover:border-amber-300"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {/* Presence indicator */}
                          {isCompleted ? (
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 block shrink-0" />
                          ) : isActive ? (
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                            </span>
                          ) : (
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-300 block shrink-0" />
                          )}
                          <h4 className="text-sm font-bold text-slate-900 truncate">{student.name}</h4>
                          {latestAttempt.isPreviewAttempt && (
                            <span className="bg-amber-100 text-amber-800 text-[8px] font-mono font-bold px-1 py-0.5 rounded uppercase shrink-0">
                              Preview
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono truncate">{student.email}</p>
                      </div>

                      <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm shrink-0 border ${statusBadgeCls}`}>
                        {statusLabel}
                      </span>
                    </div>

                    {/* Progress */}
                    <div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isLocked ? "bg-red-400" : isCompleted ? "bg-emerald-500" : "bg-[#0A192F]"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
                        <span className="font-bold">{progressPct}%</span>
                        <span className="truncate max-w-[140px] text-right text-slate-400">
                          {isCompleted ? "Completed" : `${currentBlockName} (${latestAttempt.currentBlockIndex + 1}/${blockCount})`}
                        </span>
                      </div>
                    </div>

                    {/* Activity Presence */}
                    <div className="flex justify-between items-center bg-slate-50/60 border border-slate-100 px-3 py-2 rounded-md text-[10px] text-slate-500 font-medium">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider block">last signed in</span>
                        <span className="text-slate-700 font-semibold">{formatRelativeTime(student.lastSignedInAt)}</span>
                      </div>
                      <div className="text-right space-y-0.5">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider block">last active</span>
                        <span className="text-slate-700 font-semibold">{formatRelativeTime(latestAttempt.lastActiveAt || student.lastActiveAt)}</span>
                      </div>
                    </div>

                    {/* Compact 7-Day Activity Heatmap */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest block">Activity this week</span>
                        <span className="text-[8px] text-slate-400 italic font-mono uppercase">7-Day Pacing</span>
                      </div>
                      <div className="grid grid-cols-7 gap-1 border border-slate-100 bg-white p-1.5 rounded-md">
                        {get7DayActivityHeatmap(student.id, studentActivities).map((day) => (
                          <TooltipWrapper key={day.dateStr} day={day}>
                            <div className="flex flex-col items-center">
                              <span className="text-[7px] text-slate-400 font-bold scale-90 mb-0.5 select-none">{day.dayLabel}</span>
                              <div className={`w-full aspect-square min-h-[1.5rem] rounded-sm border flex items-center justify-center transition-all ${
                                day.intensity === 'high'
                                  ? 'bg-indigo-600 text-white border-indigo-700 font-bold'
                                  : day.intensity === 'medium'
                                  ? 'bg-indigo-300 text-indigo-900 border-indigo-400 font-semibold'
                                  : day.intensity === 'low'
                                  ? 'bg-indigo-100 text-indigo-800 border-indigo-200 font-medium'
                                  : 'bg-slate-50 text-slate-300 border-slate-100'
                              }`}>
                                <span className="text-[9px] font-bold">{day.total}</span>
                              </div>
                            </div>
                          </TooltipWrapper>
                        ))}
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-md text-[11px]">
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Time active</span>
                        <span className="font-mono text-slate-700 font-semibold flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          {formatDuration(latestAttempt.activeTimeSpent || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Responses</span>
                        <span className="text-slate-700 font-bold">{sResponses.length}</span>
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Score</span>
                        <span className="text-slate-700 font-mono font-semibold">
                          {earnedPoints}/{maxPoints} pts
                          {hasPendingGrading && (
                            <span className="text-amber-600 text-[8px] block font-sans font-bold">SA pending</span>
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Integrity signals</span>
                        <span className={`font-semibold ${signals_.total > 0 ? "text-amber-700" : "text-slate-500"}`}>
                          {signals_.total === 0 ? "None" : `${signals_.total} events`}
                          {signals_.fullscreenExits > 0 && (
                            <span className="text-[8px] text-red-600 block font-bold">{signals_.fullscreenExits} fullscreen exit{signals_.fullscreenExits !== 1 ? "s" : ""}</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Lesson name (when "all lessons" view) */}
                    {sLesson && selectedLessonId === "all" && (
                      <p className="text-[10px] text-slate-400 truncate border-t border-slate-100 pt-1.5">
                        <span className="text-slate-500">Lesson:</span> <strong className="text-slate-600">{sLesson.title}</strong>
                      </p>
                    )}

                    {/* Footer */}
                    <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
                      <span className="text-[10px] text-slate-400">
                        Last active: <span className="font-mono font-semibold text-slate-500">{formatLastActive(latestAttempt)}</span>
                      </span>
                      <div className="flex gap-1.5">
                        {isLocked && (
                          <button
                            onClick={(e: MouseEvent) => handleUnlock(e, latestAttempt.id)}
                            disabled={unlockingId === latestAttempt.id}
                            className="text-[9px] font-bold bg-[#E5B53B] hover:bg-amber-400 disabled:bg-slate-200 text-[#0A192F] px-2.5 py-1 rounded transition uppercase tracking-wider flex items-center gap-1 shadow-xs cursor-pointer border border-amber-400"
                          >
                            <Unlock className="w-2.5 h-2.5" />
                            {unlockingId === latestAttempt.id ? "Unlocking…" : "Unlock"}
                          </button>
                        )}
                        {needsReview && !isLocked && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded flex items-center gap-1">
                            <Flag className="w-2.5 h-2.5" /> Review
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-[9px] font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 px-2 py-1 rounded transition uppercase tracking-wider cursor-pointer shadow-xs"
                        >
                          View &rarr;
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* TABLE LAYOUT */}
          {layoutMode === "table" && visibleAttempts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Student</th>
                      <th className="py-3 px-4">Lesson</th>
                      <th className="py-3 px-4">Progress</th>
                      <th className="py-3 px-4">Position</th>
                      <th className="py-3 px-4">Time / Responses</th>
                      <th className="py-3 px-4">Last Active / Signed In</th>
                      <th className="py-3 px-4">Weekly Pacing</th>
                      <th className="py-3 px-4">Score</th>
                      <th className="py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {sortAttempts(visibleAttempts).map((attempt) => {
                      let student = students.find((s) => s.id === attempt.studentId);
                      if (!student && attempt.isPreviewAttempt) {
                        student = { id: attempt.studentId, name: "Teacher Preview", email: "preview@veritas.local" };
                      }
                      if (!student) return null;

                      const sLesson = lessons.find((l) => l.id === attempt.lessonId);
                      const lessonBlocks = blocks.filter((b) => b.lessonId === attempt.lessonId).sort((a: any, b: any) => a.order - b.order);
                      const sResponses = responses.filter((r) => r.attemptId === attempt.id);
                      const signals_ = getAttemptSignalSummary(attempt.id);

                      const isLocked = isAttemptLocked(attempt);
                      const isCompleted = attempt.status === "completed";
                      const isActive = isAttemptActive(attempt);
                      const needsReview = isAttemptNeedsReview(attempt);
                      const blockCount = Math.max(lessonBlocks.length, 1);
                      const progressPct = isCompleted ? 100 : Math.round((attempt.currentBlockIndex / blockCount) * 100);
                      const currentBlock = lessonBlocks[attempt.currentBlockIndex];
                      const currentBlockName = currentBlock ? currentBlock.title : `Segment ${attempt.currentBlockIndex + 1}`;
                      const maxPoints = calcMaxPoints(attempt.lessonId);
                      const earnedPoints = attempt ? (attempt.score || 0) : 0;
                      const hasPendingGrading = sResponses.some(
                        (r) => r.type === "sa" && (!r.aiGrading || ["pending", "failed", "needs_review"].includes(r.aiGrading.status))
                      );

                      return (
                        <tr
                          key={attempt.id}
                          onClick={() => onOpenDossier(student.id, attempt.lessonId)}
                          className={`hover:bg-slate-50 transition cursor-pointer ${isLocked ? "bg-red-50/20" : attempt.isPreviewAttempt ? "bg-amber-50/10" : ""}`}
                        >
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isCompleted ? (
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block" />
                              ) : isActive ? (
                                <span className="relative flex h-2.5 w-2.5 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                                </span>
                              ) : (
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 block" />
                              )}
                              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight">
                                {isCompleted ? "Done" : isActive ? "Active Recently" : isAttemptStale(attempt) ? `Possibly Disconnected (${formatLastActive(attempt)})` : `Idle (${formatLastActive(attempt)})`}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="font-bold text-slate-900 flex items-center gap-1">
                              {student.name}
                              {attempt.isPreviewAttempt && (
                                <span className="bg-amber-100 text-amber-800 text-[8px] px-1 py-0.5 rounded font-mono font-bold uppercase shrink-0">Preview</span>
                              )}
                            </div>
                            <span className="text-[9px] font-mono text-slate-400 block">{student.email}</span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 font-medium whitespace-nowrap">
                            <span className="truncate max-w-[130px] block">{sLesson?.title || "—"}</span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap min-w-[100px]">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-12 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                <div
                                  className={`h-full rounded-full ${isLocked ? "bg-red-400" : isCompleted ? "bg-emerald-500" : "bg-indigo-600"}`}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <span className="font-bold text-[10px] font-mono">{progressPct}%</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                            <span className="truncate max-w-[140px] block text-[11px]">
                              {isCompleted ? "Completed" : `${currentBlockName} (${attempt.currentBlockIndex + 1}/${blockCount})`}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                              <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="font-mono">{formatDuration(attempt.activeTimeSpent || 0)}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {sResponses.length} responses &bull; {signals_.total} signals
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap text-[10px] text-slate-500 font-medium">
                            <div className="font-semibold text-slate-700">Active: {formatRelativeTime(attempt.lastActiveAt || student.lastActiveAt)}</div>
                            <div className="text-[9px] text-slate-400 mt-0.5">Signed in: {formatRelativeTime(student.lastSignedInAt)}</div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-0.5">
                              {get7DayActivityHeatmap(student.id, studentActivities).map((day) => (
                                <TooltipWrapper key={day.dateStr} day={day}>
                                  <div className={`w-5 h-5 rounded-sm border flex items-center justify-center text-[7.5px] transition-all select-none ${
                                    day.intensity === 'high'
                                      ? 'bg-indigo-600 text-white border-indigo-700 font-bold'
                                      : day.intensity === 'medium'
                                      ? 'bg-indigo-300 text-indigo-900 border-indigo-400'
                                      : day.intensity === 'low'
                                      ? 'bg-[#E0E7FF] text-indigo-800 border-indigo-200'
                                      : 'bg-slate-50 text-slate-300 border-slate-150'
                                  }`}>
                                    {day.total > 0 ? day.total : ''}
                                  </div>
                                </TooltipWrapper>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap font-bold text-slate-800">
                            <div className="font-mono text-[11px]">{earnedPoints}/{maxPoints} pts</div>
                            {hasPendingGrading && (
                              <span className="text-[9px] text-amber-600 font-bold block">SA pending</span>
                            )}
                          </td>
                          <td className="py-1.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isLocked ? (
                                <button
                                  onClick={(e: MouseEvent) => handleUnlock(e, attempt.id)}
                                  disabled={unlockingId === attempt.id}
                                  className="text-[9px] font-bold bg-[#E5B53B] hover:bg-amber-400 text-[#0A192F] px-2.5 py-1 rounded transition uppercase tracking-wider flex items-center gap-1 cursor-pointer border border-amber-400"
                                >
                                  <Unlock className="w-3 h-3" />
                                  {unlockingId === attempt.id ? "Unlocking…" : "Unlock"}
                                </button>
                              ) : needsReview ? (
                                <div className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  {hasPendingGrading ? "Grade pending" : "Review signals"}
                                </div>
                              ) : (
                                <div className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Clear
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {/* NOT STARTED */}
          {showNotStarted && searchNotStarted.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-dashed border-slate-200 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  Not started ({searchNotStarted.length})
                </span>
                <span className="text-[10px] text-slate-400 italic">No attempt recorded yet</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {searchNotStarted.map((student) => (
                  <div
                    key={student.id}
                    className="bg-white border border-slate-200 hover:border-slate-300 rounded-lg p-3 flex items-center justify-between gap-2 transition select-none"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 text-[12px] truncate">{student.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">{student.email}</div>
                    </div>
                    <span className="text-[8px] font-mono font-bold uppercase tracking-widest bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
                      Not started
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
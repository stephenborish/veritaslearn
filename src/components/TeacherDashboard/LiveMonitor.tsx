import { useState, useMemo, type MouseEvent } from "react";
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
  Bot,
} from "lucide-react";
import { motion } from "motion/react";
import {
  deriveIntegritySignalSummary,
  reliabilityLabel,
  attentionColorClasses,
} from "../../lib/integritySignals";

// Presence and stagnation constants
const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000;    // 30 minutes

function formatRelativeTime(timestamp: string | Date | undefined | null): string {
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
  if (days === 1) return "yesterday";
  if (days < 3) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Format "Last signed in" with fallback
function formatLastSignedIn(student: any, attempt: any): string {
  const timestamp = student.lastSignedInAt || student.lastActiveAt || (attempt && attempt.startedAt);
  if (!timestamp) return "Sign-in time unavailable";
  return formatRelativeTime(timestamp);
}

// Format "Last lesson activity" with fallback
function formatLastLessonActivity(attempt: any, lastActivityTimestamp: string | null): string {
  if (!attempt) return "No lesson work yet";
  if (!lastActivityTimestamp) return "No lesson work yet";
  return formatRelativeTime(lastActivityTimestamp);
}

// Derive most recent activity timestamp prioritizing authentic academic work
function getStudentLastLessonActivityTimestamp(attempt: any, studentResponses: any[], studentActivities: any[]): string | null {
  if (!attempt) return null;
  const timestamps: number[] = [];
  
  if (attempt.startedAt) timestamps.push(new Date(attempt.startedAt).getTime());
  if (attempt.lastActiveAt) timestamps.push(new Date(attempt.lastActiveAt).getTime());
  if (attempt.completedAt) timestamps.push(new Date(attempt.completedAt).getTime());
  
  studentResponses.forEach((r: any) => {
    if (r.attemptId === attempt.id && r.createdAt) {
      timestamps.push(new Date(r.createdAt).getTime());
    }
  });
  
  studentActivities.forEach((act: any) => {
    if ((act.attemptId === attempt.id || act.studentId === attempt.studentId) && act.timestamp) {
      timestamps.push(new Date(act.timestamp).getTime());
    }
  });
  
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

// Calculate 7-Day heatmap focused ONLY on academic action, separating focus/integrity issues
function getStudentAcademicHeatmap(
  studentId: string,
  attempt: any,
  studentResponses: any[],
  studentActivities: any[]
) {
  const result = [];
  const now = new Date();
  
  // Last 7 days ending with today as index 6
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
    
    const daysName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayLabel = daysName[d.getDay()];
    
    let responsesCount = 0;
    let draftsCount = 0;
    let startsCount = 0;
    let completionsCount = 0;
    let checkpointCount = 0;
    let otherAcademicCount = 0;
    
    // Academic Responses
    studentResponses.forEach((r: any) => {
      if (r.studentId === studentId && r.createdAt) {
        if (r.createdAt.split("T")[0] === dayStr) {
          responsesCount++;
        }
      }
    });
    
    // Attempt started/completed
    if (attempt && attempt.studentId === studentId) {
      if (attempt.startedAt && attempt.startedAt.split("T")[0] === dayStr) {
        startsCount++;
      }
      if (attempt.completedAt && attempt.completedAt.split("T")[0] === dayStr) {
        completionsCount++;
      }
    }
    
    // Student Activities - filter only academic work, strictly excluding proctoring exits/blur/focus events
    (studentActivities || []).forEach((act: any) => {
      if (act.studentId !== studentId || !act.timestamp) return;
      if (act.timestamp.split("T")[0] !== dayStr) return;
      
      const type = act.activityType;
      if (type === "draft_save") {
        draftsCount++;
      } else if (type === "checkpoint_complete") {
        checkpointCount++;
      } else if (type === "progress_save" || type === "video_watch") {
        otherAcademicCount++;
      }
    });
    
    const total = responsesCount + draftsCount + startsCount + completionsCount + checkpointCount + otherAcademicCount;
    
    let intensity: "none" | "low" | "medium" | "high" = "none";
    if (total > 0 && total <= 2) intensity = "low";
    else if (total > 2 && total <= 5) intensity = "medium";
    else if (total > 5) intensity = "high";
    
    const summaryParts = [];
    if (startsCount > 0) summaryParts.push("started lesson");
    if (responsesCount > 0) summaryParts.push(`${responsesCount} response${responsesCount !== 1 ? "s" : ""}`);
    if (draftsCount > 0) summaryParts.push(`${draftsCount} draft save${draftsCount !== 1 ? "s" : ""}`);
    if (checkpointCount > 0) summaryParts.push(`${checkpointCount} checkpoint${checkpointCount !== 1 ? "s" : ""}`);
    if (completionsCount > 0) summaryParts.push("completed lesson");
    if (otherAcademicCount > 0 && summaryParts.length === 0) summaryParts.push("reviewed lesson content");
    
    const tooltipText = total > 0 
      ? summaryParts.join(", ") 
      : "No lesson activity recorded";
      
    result.push({
      dateStr: dayStr,
      dayLabel,
      formattedDate: d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" }),
      total,
      intensity,
      tooltipText
    });
  }
  
  return result;
}

// Tooltip wrapper for heatmap cells
function TooltipWrapper({ children, day }: { children: React.ReactNode, day: any }) {
  const [show, setShow] = useState(false);

  return (
    <div 
      className="relative shrink-0" 
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-900 border border-slate-800 text-[10px] text-white p-2 rounded shadow-lg z-50 pointer-events-none font-sans whitespace-normal normal-case text-center">
          <p className="font-bold border-b border-slate-800 pb-0.5 mb-1 text-slate-200">
            {day.formattedDate}
          </p>
          <p className="text-slate-300 font-mono text-[9px]">
            {day.tooltipText}
          </p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45" />
        </div>
      )}
    </div>
  );
}

// Safe derived max point calculator over snapshots or working drafts
function getLessonMaxPoints(lessonBlocks: any[]): number {
  if (!lessonBlocks || lessonBlocks.length === 0) return 0;
  
  let totalPoints = 0;
  
  lessonBlocks.forEach((b: any) => {
    // 1. Question block
    if (b.type === "question") {
      if (b.isPractice) return; // skip practice-only points
      
      if (b.singleQuestion) {
        let pts = b.singleQuestion.points;
        if (pts === undefined || pts === null) {
          pts = (b.questionType || b.singleQuestion.type) === "mc" ? 1 : 3;
        }
        totalPoints += pts;
      } else if (b.questionPool) {
        const firstQ = b.questionPool.questions?.[0];
        let pts = firstQ?.points;
        if (pts === undefined || pts === null) {
          pts = (b.questionType || firstQ?.type) === "mc" ? 1 : 3;
        }
        totalPoints += pts * (b.questionPool.numToSelect || 1);
      }
    }
    
    // 2. Video block with checkpoints
    if (b.type === "video" && b.videoCheckpoints) {
      b.videoCheckpoints.forEach((cp: any) => {
        if (cp.isPractice) return; // skip practice-only points
        
        let pts = 0;
        if (cp.question && cp.question.points !== undefined && cp.question.points !== null) {
          pts = cp.question.points;
        } else if (Array.isArray(cp.questions) && cp.questions[0] && cp.questions[0].points !== undefined && cp.questions[0].points !== null) {
          pts = cp.questions[0].points;
        } else {
          pts = cp.questionType === "mc" ? 1 : 3;
        }
        
        totalPoints += pts * (cp.numToSelect || 1);
      });
    }
  });
  
  return totalPoints;
}

// Dynamically compute earned score from actual responses
function getAttemptEarnedPoints(attemptId: string, responses: any[]): number {
  if (!attemptId) return 0;
  const attemptResponses = responses.filter(r => r.attemptId === attemptId);
  return attemptResponses.reduce((sum, r) => {
    const isPractice = r.gradingMode === "practice" || r.gradebookCategory === "practice";
    if (isPractice) return sum;
    
    const earned = r.teacherOverrideScore !== null && r.teacherOverrideScore !== undefined
      ? r.teacherOverrideScore
      : r.score;
      
    return sum + (Number(earned) || 0);
  }, 0);
}

// Single student row definition
interface LessonTrackingRow {
  student: any;
  attempt: any | null;
  lesson: any | null;
  lessonBlocks: any[];
  responses: any[];
  signalsSummary: {
    total: number;
    blurs: number;
    fullscreenExits: number;
    seekBlocks: number;
    copyPastes: number;
    mostRecent: any | null;
  };
  status: string;
  lastSignedIn: string;
  lastLessonActivityRaw: string | null;
  lastLessonActivity: string;
  maxPoints: number;
  earnedPoints: number;
  progressPct: number;
  currentBlockName: string;
  hasPendingGrading: boolean;
  needsReview: boolean;
  isStale: boolean;
  isActive: boolean;
  isLocked: boolean;
  isUnlocked: boolean;
}

interface LiveMonitorProps {
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
  studentActivities?: any[];
  lessonVersions?: any[];
  assignments?: any[];
  onOpenDossier: (
    studentId: string,
    lessonId: string,
    nav?: { entries: { studentId: string; lessonId: string; label?: string }[]; index: number; label?: string }
  ) => void;
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
  lessonVersions = [],
  assignments = [],
  onOpenDossier,
  onUnlockStudent,
}: LiveMonitorProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string>("all");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [showPreviewAttempts, setShowPreviewAttempts] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [layoutMode, setLayoutMode] = useState<"grid" | "table">("grid");
  const [searchTerm, setSearchTerm] = useState<string>(" ");

  // Trim on load or handle nicely
  const trimmedSearch = useMemo(() => searchTerm.trim(), [searchTerm]);

  const publishedLessons = useMemo(() => lessons.filter((l) => l.isPublished), [lessons]);

  // Derived single row mapper
  const deriveSingleRow = (student: any, attempt: any | null): LessonTrackingRow => {
    const lessonId = attempt ? attempt.lessonId : (selectedLessonId !== "all" ? selectedLessonId : null);
    const sLesson = lessonId ? lessons.find(l => l.id === lessonId) : null;
    
    // Resolve snapshot blocks if version is specified and exists
    let lessonBlocks = [];
    if (lessonId) {
      if (attempt && attempt.lessonVersionId && lessonVersions.length > 0) {
        const version = lessonVersions.find(v => v.id === attempt.lessonVersionId);
        if (version && version.blocksSnapshot) {
          lessonBlocks = version.blocksSnapshot;
        }
      }
      if (lessonBlocks.length === 0) {
        lessonBlocks = blocks
          .filter(b => b.lessonId === lessonId)
          .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
      }
    }

    const sResponses = attempt ? responses.filter(r => r.attemptId === attempt.id) : [];

    // Signals
    let signalsSummary = {
      total: 0,
      blurs: 0,
      fullscreenExits: 0,
      seekBlocks: 0,
      copyPastes: 0,
      mostRecent: null as any | null
    };

    if (attempt) {
      const sSignals = signals.filter(s => s.attemptId === attempt.id);
      const blurs = sSignals.filter(s => s.eventType === "blur_focus_lost" || s.eventType === "visibilitychange").length;
      const fullscreenExits = sSignals.filter(s => s.eventType === "fullscreen_exit" || s.eventType === "fullscreen_exited").length;
      const seekBlocks = sSignals.filter(s => s.eventType === "seek_attempt_blocked").length;
      const copyPastes = sSignals.filter(s => s.eventType === "copy_blocked" || s.eventType === "paste_blocked").length;
      const total = blurs + fullscreenExits + seekBlocks + copyPastes;
      const mostRecent = [...sSignals].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;
      signalsSummary = { total, blurs, fullscreenExits, seekBlocks, copyPastes, mostRecent };
    }

    const maxPoints = getLessonMaxPoints(lessonBlocks);
    const earnedPoints = attempt ? getAttemptEarnedPoints(attempt.id, responses) : 0;

    const isCompleted = attempt ? attempt.status === "completed" : false;
    const blockCount = Math.max(lessonBlocks.length, 1);
    const progressPct = isCompleted 
      ? 100 
      : attempt 
      ? Math.round((attempt.currentBlockIndex / blockCount) * 100) 
      : 0;
      
    const currentBlock = attempt ? lessonBlocks[attempt.currentBlockIndex] : null;
    const currentBlockName = isCompleted 
      ? "Completed" 
      : currentBlock 
      ? currentBlock.title 
      : attempt 
      ? `Segment ${attempt.currentBlockIndex + 1}` 
      : "Not started";

    const lastActiveRaw = attempt ? (attempt.lastActiveAt || attempt.startedAt) : null;
    const elapsedMs = lastActiveRaw ? (Date.now() - new Date(lastActiveRaw).getTime()) : Infinity;
    const isActive = elapsedMs <= ACTIVE_THRESHOLD_MS;
    const isStale = attempt && !isCompleted && !isActive && elapsedMs > STALE_THRESHOLD_MS;

    const hasPendingGrading = sResponses.some(
      (r) => r.type === "sa" && (!r.aiGrading || ["pending", "failed", "needs_review"].includes(r.aiGrading.status))
    );

    const isLocked = attempt && attempt.lockState === "locked_awaiting_teacher";

    // Asynchronous-friendly status
    let status = "Not started";
    if (attempt) {
      if (isLocked) {
        status = "Locked";
      } else if (isCompleted) {
        status = "Completed";
      } else if (elapsedMs <= 60 * 1000) {
        status = "Active now";
      } else if (elapsedMs <= 2 * 60 * 1000) {
        status = "Active recently";
      } else if (attempt.securityReviewRequired) {
        status = "Needs review";
      } else {
        const hasDraft = attempt.draftResponses && Object.values(attempt.draftResponses).some((v: any) => v && v.trim() !== "");
        if (hasDraft) {
          status = "Draft saved";
        } else if (isStale) {
          const hasInterruption = attempt.securityReviewRequired || attempt.lockState || signalsSummary.fullscreenExits > 0;
          if (hasInterruption) {
            status = "Session may have ended unexpectedly";
          } else {
            status = "No recent work";
          }
        } else {
          status = sResponses.length > 0 ? "In progress" : "Started, not submitted";
        }
      }
    }

    const needsReview = attempt ? (
      isLocked || 
      attempt.securityReviewRequired || 
      signalsSummary.total >= 3 || 
      signalsSummary.fullscreenExits > 0 || 
      signalsSummary.seekBlocks > 0 || 
      hasPendingGrading
    ) : false;

    const lastSignedIn = formatLastSignedIn(student, attempt);
    const lastLessonActivityRaw = getStudentLastLessonActivityTimestamp(attempt, sResponses, studentActivities);
    const lastLessonActivity = formatLastLessonActivity(attempt, lastLessonActivityRaw);

    return {
      student,
      attempt,
      lesson: sLesson,
      lessonBlocks,
      responses: sResponses,
      signalsSummary,
      status,
      lastSignedIn,
      lastLessonActivityRaw,
      lastLessonActivity,
      maxPoints,
      earnedPoints,
      progressPct,
      currentBlockName,
      hasPendingGrading,
      needsReview,
      isStale,
      isActive,
      isLocked,
      isUnlocked: attempt && !isLocked
    };
  };

  // Build full unfiltered custom row model
  const fullRosterRows = useMemo(() => {
    const rows: LessonTrackingRow[] = [];
    
    // Process actual students
    students.forEach((student) => {
      // Find candidate attempt matching selected context
      let candidateAttempt: any = null;
      if (selectedLessonId === "all") {
        const studAttempts = attempts.filter((a) => a.studentId === student.id && !a.isPreviewAttempt);
        if (studAttempts.length > 0) {
          studAttempts.sort((a, b) => new Date(b.startedAt || b.createdAt || 0).getTime() - new Date(a.startedAt || a.createdAt || 0).getTime());
          candidateAttempt = studAttempts[0];
        }
      } else {
        const studAttempts = attempts.filter((a) => a.studentId === student.id && a.lessonId === selectedLessonId && !a.isPreviewAttempt);
        if (studAttempts.length > 0) {
          studAttempts.sort((a, b) => new Date(b.startedAt || b.createdAt || 0).getTime() - new Date(a.startedAt || a.createdAt || 0).getTime());
          candidateAttempt = studAttempts[0];
        }
      }

      rows.push(deriveSingleRow(student, candidateAttempt));
    });

    // Append virtual rows for Teacher Previews if requested
    if (showPreviewAttempts) {
      const previewAttempts = attempts.filter((a) => {
        if (!a.isPreviewAttempt) return false;
        if (selectedLessonId !== "all" && a.lessonId !== selectedLessonId) return false;
        return true;
      });

      previewAttempts.forEach((previewAttempt) => {
        const virtualStudent = {
          id: "preview_" + previewAttempt.id,
          name: "Teacher Preview Student",
          email: "preview@veritas.placeholder",
          role: "student",
          isPreview: true,
          lastSignedInAt: previewAttempt.startedAt || previewAttempt.createdAt
        };
        rows.push(deriveSingleRow(virtualStudent, previewAttempt));
      });
    }

    return rows;
  }, [selectedLessonId, showPreviewAttempts, students, attempts, responses, signals, lessons, blocks, studentActivities, lessonVersions]);

  // Apply search filtering and tab status filtering dynamically
  const filteredAndSortedRows = useMemo(() => {
    let result = fullRosterRows;

    // Apply search query
    if (trimmedSearch) {
      const q = trimmedSearch.toLowerCase();
      result = result.filter((row) => {
        const name = row.student.name || "";
        const email = row.student.email || "";
        return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
      });
    }

    // Apply tab status filter
    if (statusFilter !== "all") {
      result = result.filter((row) => {
        if (statusFilter === "needs_review") return row.needsReview;
        if (statusFilter === "locked") return row.isLocked;
        if (statusFilter === "active") return row.status === "Active now" || row.status === "Active recently";
        if (statusFilter === "idle") return row.status === "In progress" || row.status === "Draft saved" || row.status === "Started, not submitted";
        if (statusFilter === "stale") return row.status === "No recent work" || row.status === "Session may have ended unexpectedly";
        if (statusFilter === "not_started") return row.status === "Not started";
        if (statusFilter === "completed") return row.status === "Completed";
        return true;
      });
    }

    // Sort: locked (highest priority), then review, then active, fallback alphabetically
    return [...result].sort((a, b) => {
      const lockA = a.isLocked ? 10 : 0;
      const lockB = b.isLocked ? 10 : 0;
      if (lockB !== lockA) return lockB - lockA;

      const revA = a.needsReview ? 5 : 0;
      const revB = b.needsReview ? 5 : 0;
      if (revB !== revA) return revB - revA;

      const actA = (a.status === "Active now" || a.status === "Active recently") ? 2 : 0;
      const actB = (b.status === "Active now" || b.status === "Active recently") ? 2 : 0;
      if (actB !== actA) return actB - actA;

      const nameA = a.student.name || "";
      const nameB = b.student.name || "";
      return nameA.localeCompare(nameB);
    });
  }, [fullRosterRows, trimmedSearch, statusFilter]);

  // Build a student-to-student navigation context from the currently displayed
  // Lesson Tracking list so the dossier prev/next moves through the same rows.
  const buildTrackingNav = (currentStudentId: string, fallbackLessonId: string) => {
    const entries = filteredAndSortedRows.map((row) => ({
      studentId: row.student.id,
      lessonId: row.lesson?.id || fallbackLessonId,
      label: row.student.name || row.student.email || "Student",
    }));
    const index = entries.findIndex((e) => e.studentId === currentStudentId);
    return { entries, index: index < 0 ? 0 : index, label: "Lesson Tracking" };
  };

  // Compute status metrics based on the search/lesson context
  const counts = useMemo(() => {
    // Determine rows matching current lesson & search filter to keep counts contextually accurate
    let baseList = fullRosterRows;
    if (trimmedSearch) {
      const q = trimmedSearch.toLowerCase();
      baseList = baseList.filter((row) => {
        const name = row.student.name || "";
        const email = row.student.email || "";
        return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
      });
    }

    return {
      all: baseList.length,
      needsReview: baseList.filter((r) => r.needsReview).length,
      locked: baseList.filter((r) => r.isLocked).length,
      active: baseList.filter((r) => r.status === "Active now" || r.status === "Active recently").length,
      idle: baseList.filter((r) => r.status === "In progress" || r.status === "Draft saved" || r.status === "Started, not submitted").length,
      stale: baseList.filter((r) => r.status === "No recent work" || r.status === "Session may have ended unexpectedly").length,
      notStarted: baseList.filter((r) => r.status === "Not started").length,
      completed: baseList.filter((r) => r.status === "Completed").length,
    };
  }, [fullRosterRows, trimmedSearch]);

  const handleUnlock = async (e: MouseEvent, attemptId: string) => {
    e.stopPropagation();
    setUnlockingId(attemptId);
    try {
      await onUnlockStudent(attemptId);
    } finally {
      setUnlockingId(null);
    }
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
      possible_ai_agent_use: "AI signature flag",
      hidden_assessment_text_in_answer: "AI overlay flag",
      ai_guard_marker_in_answer: "AI guard payload",
      ai_guard_refusal_phrase_in_answer: "AI response prefix",
    };
    return labels[eventType] || eventType;
  };

  return (
    <div className="space-y-5 font-sans">
      {/* Search and control toolbar */}
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
                value={searchTerm === " " ? "" : searchTerm}
                onChange={(e: any) => setSearchTerm(e.target.value || " ")}
                className="text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 transition w-44 lg:w-52"
              />
              {searchTerm && searchTerm !== " " && (
                <button
                  onClick={() => setSearchTerm(" ")}
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

        {/* Tab filters with unified counts */}
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {[
              { id: "all", label: "All", count: counts.all, color: "slate" },
              { id: "needs_review", label: "Needs Review", count: counts.needsReview, color: "amber" },
              { id: "locked", label: "Locked", count: counts.locked, color: "red" },
              { id: "active", label: "Active Recently", count: counts.active, color: "green" },
              { id: "idle", label: "Idle", count: counts.idle, color: "slate" },
              { id: "stale", label: "No Recent Work", count: counts.stale, color: "slate" },
              { id: "not_started", label: "Not Started", count: counts.notStarted, color: "slate" },
              { id: "completed", label: "Completed", count: counts.completed, color: "blue" },
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

      {/* Empty Roster State */}
      {filteredAndSortedRows.length === 0 ? (
        <div className="text-center py-14 bg-white border border-slate-200 rounded-lg text-slate-400 shadow-sm space-y-2">
          <UserX className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-xs font-semibold text-slate-500">No students match this filter</p>
          <p className="text-[11px] text-slate-400">Try adjusting the lesson scope, status filter, or search input.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* GRID CARD VIEW */}
          {layoutMode === "grid" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAndSortedRows.map((row) => {
                const sStudent = row.student;
                const latestAttempt = row.attempt;
                const sLesson = row.lesson;
                const progressPct = row.progressPct;
                const currentBlockName = row.currentBlockName;
                // Shared integrity-engine read for this student's current attempt.
                const relSummary = deriveIntegritySignalSummary(
                  latestAttempt ? signals.filter((s) => s.attemptId === latestAttempt.id) : [],
                  { hasActivityTiming: !!latestAttempt?.activeTimeSpent }
                );
                const relColors = attentionColorClasses(relSummary.attentionLevel);
                const statusBadgeCls = row.isLocked
                  ? "bg-red-50 text-red-700 border-red-200"
                  : row.status === "Completed"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : (row.status === "Active now" || row.status === "Active recently")
                  ? "bg-green-50 text-green-700 border-green-200"
                  : (row.status === "Session may have ended unexpectedly" || row.status === "No recent work")
                  ? "bg-orange-50 text-orange-700 border-orange-200"
                  : "bg-slate-100 text-slate-500 border-slate-200";

                return (
                  <motion.div
                    key={row.student.id + "_" + (latestAttempt ? latestAttempt.id : "none")}
                    initial={{ opacity: 0.96 }}
                    animate={{ opacity: 1 }}
                    whileHover={{ y: -1 }}
                    onClick={() => {
                      const fallbackLessonId = sLesson?.id || (selectedLessonId !== "all" ? selectedLessonId : "");
                      onOpenDossier(sStudent.id, fallbackLessonId, buildTrackingNav(sStudent.id, fallbackLessonId));
                    }}
                    className={`bg-white border rounded-lg p-4 shadow-xs hover:shadow transition flex flex-col gap-3 cursor-pointer group relative ${
                      row.isLocked
                        ? "border-amber-300 ring-1 ring-amber-100 bg-amber-50/30"
                        : row.needsReview
                        ? "border-amber-200 bg-[#FCFBF8] hover:border-amber-300"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {row.status === "Completed" ? (
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 block shrink-0" />
                          ) : (row.status === "Active now" || row.status === "Active recently") ? (
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34D399] opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10B981]" />
                            </span>
                          ) : (
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-300 block shrink-0" />
                          )}
                          <h4 className="text-sm font-bold text-slate-900 truncate">{sStudent.name}</h4>
                          {sStudent.isPreview && (
                            <span className="bg-amber-100 text-amber-800 text-[8px] font-mono font-bold px-1 py-0.5 rounded uppercase shrink-0">
                              Preview
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono truncate">{sStudent.email}</p>
                      </div>

                      <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm shrink-0 border ${statusBadgeCls}`}>
                        {row.status}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            row.isLocked ? "bg-red-400" : row.status === "Completed" ? "bg-[#10B981]" : "bg-indigo-600"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
                        <span className="font-bold">{progressPct}%</span>
                        <span className="truncate max-w-[140px] text-right text-slate-400">
                          {row.status === "Completed" ? "Completed" : `${currentBlockName} (${latestAttempt ? latestAttempt.currentBlockIndex + 1 : 0}/${Math.max(row.lessonBlocks.length, 1)})`}
                        </span>
                      </div>
                    </div>

                    {/* Separated Session Activity & Timestamps */}
                    <div className="flex justify-between items-center bg-slate-50/60 border border-slate-100 px-3 py-2 rounded-md text-[10px] text-slate-500 font-medium">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider block">last signed in</span>
                        <span className="text-slate-700 font-semibold">{row.lastSignedIn}</span>
                      </div>
                      <div className="text-right space-y-0.5">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider block">lesson activity</span>
                        <span className="text-slate-700 font-semibold">{row.lastLessonActivity}</span>
                      </div>
                    </div>

                    {/* 7-day academic heatmap */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest block">Activity this week</span>
                        <span className="text-[8px] text-slate-400 italic font-mono uppercase">Academic Action</span>
                      </div>
                      <div className="grid grid-cols-7 gap-1 border border-slate-100 bg-white p-1.5 rounded-md">
                        {getStudentAcademicHeatmap(sStudent.id, latestAttempt, row.responses, studentActivities).map((day) => (
                          <TooltipWrapper key={day.dateStr} day={day}>
                            <div className="flex flex-col items-center">
                              <span className="text-[7px] text-slate-400 font-bold scale-90 mb-0.5 select-none">{day.dayLabel}</span>
                              <div className={`w-full aspect-square min-h-[1.5rem] rounded-sm border flex items-center justify-center transition-all ${
                                day.intensity === "high"
                                  ? "bg-indigo-600 text-white border-indigo-700 font-bold"
                                  : day.intensity === "medium"
                                  ? "bg-indigo-300 text-indigo-900 border-indigo-400 font-semibold"
                                  : day.intensity === "low"
                                  ? "bg-indigo-100 text-indigo-800 border-indigo-200 font-medium"
                                  : "bg-slate-50 text-slate-300 border-slate-100"
                              }`}>
                                <span className="text-[9px] font-bold">{day.total || ""}</span>
                              </div>
                            </div>
                          </TooltipWrapper>
                        ))}
                      </div>
                    </div>

                    {/* Scoring and metrics */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-100 p-2.5 rounded-md text-[11px]">
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Time active</span>
                        <span className="font-mono text-slate-700 font-semibold flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          {latestAttempt ? `${Math.floor((latestAttempt.activeTimeSpent || 0) / 60)}m ${(latestAttempt.activeTimeSpent || 0) % 60}s` : "0m 0s"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Responses</span>
                        <span className="text-slate-700 font-bold">{row.responses.length}</span>
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Score</span>
                        <span className="text-slate-700 font-mono font-semibold">
                          {latestAttempt ? `${row.earnedPoints}/${row.maxPoints} pts` : "—"}
                          {row.hasPendingGrading && (
                            <span className="text-amber-600 text-[8px] block font-sans font-bold">SA pending</span>
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 uppercase tracking-wider font-bold block">Response reliability</span>
                        <span className={`font-semibold inline-flex items-center gap-1 ${relColors.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${relColors.dot}`} />
                          {reliabilityLabel(relSummary.responseReliability)}
                          {relSummary.aiAgentSignalCount > 0 && (
                            <Bot className="w-3 h-3 text-rose-600" aria-label="Signals of AI Agent Use" />
                          )}
                        </span>
                        {relSummary.totalSignals > 0 && (
                          <span className="text-[8px] text-slate-400 block font-bold">{relSummary.totalSignals} activity record{relSummary.totalSignals !== 1 ? "s" : ""}</span>
                        )}
                      </div>
                    </div>

                    {/* Lesson name for "all lessons" scope */}
                    {sLesson && selectedLessonId === "all" && (
                      <p className="text-[10px] text-slate-400 truncate border-t border-slate-100 pt-1.5">
                        <span className="text-slate-500">Lesson:</span> <strong className="text-slate-600">{sLesson.title}</strong>
                      </p>
                    )}

                    {/* Footer Actions */}
                    <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
                      <span className="text-[10px] text-slate-400 shrink-0">
                        Activity: <span className="font-mono font-semibold text-slate-500">{row.lastLessonActivity}</span>
                      </span>
                      <div className="flex gap-1.5 shrink-0 ml-1">
                        {row.isLocked && latestAttempt && (
                          <button
                            onClick={(e: MouseEvent) => handleUnlock(e, latestAttempt.id)}
                            disabled={unlockingId === latestAttempt.id}
                            className="text-[9px] font-bold bg-[#E5B53B] hover:bg-amber-400 disabled:bg-slate-200 text-[#0A192F] px-2.5 py-1 rounded transition uppercase tracking-wider flex items-center gap-1 shadow-xs cursor-pointer border border-amber-400"
                          >
                            <Unlock className="w-2.5 h-2.5" />
                            {unlockingId === latestAttempt.id ? "Unlocking…" : "Unlock"}
                          </button>
                        )}
                        {row.needsReview && !row.isLocked && (
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
          {layoutMode === "table" && (
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
                      <th className="py-3 px-4">Last Lesson Activity</th>
                      <th className="py-3 px-4">Weekly Pacing</th>
                      <th className="py-3 px-4">Score</th>
                      <th className="py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredAndSortedRows.map((row) => {
                      const sStudent = row.student;
                      const latestAttempt = row.attempt;
                      const sLesson = row.lesson;
                      const progressPct = row.progressPct;
                      const currentBlockName = row.currentBlockName;

                      return (
                        <tr
                          key={sStudent.id + "_" + (latestAttempt ? latestAttempt.id : "none")}
                          onClick={() => {
                      const fallbackLessonId = sLesson?.id || (selectedLessonId !== "all" ? selectedLessonId : "");
                      onOpenDossier(sStudent.id, fallbackLessonId, buildTrackingNav(sStudent.id, fallbackLessonId));
                    }}
                          className={`hover:bg-slate-50 transition cursor-pointer ${row.isLocked ? "bg-red-50/20" : sStudent.isPreview ? "bg-amber-50/10" : ""}`}
                        >
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {row.status === "Completed" ? (
                                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] block-shrink-0" />
                              ) : (row.status === "Active now" || row.status === "Active recently") ? (
                                <span className="relative flex h-2.5 w-2.5 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                                </span>
                              ) : (
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 block shrink-0" />
                              )}
                              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight">
                                {row.status}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="font-bold text-slate-900 flex items-center gap-1">
                              {sStudent.name}
                              {sStudent.isPreview && (
                                <span className="bg-amber-100 text-amber-800 text-[8px] px-1 py-0.5 rounded font-mono font-bold uppercase shrink-0">Preview</span>
                              )}
                            </div>
                            <span className="text-[9px] font-mono text-slate-400 block">{sStudent.email}</span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 font-medium whitespace-nowrap">
                            <span className="truncate max-w-[130px] block">{sLesson?.title || selectedLessonId || "—"}</span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap min-w-[100px]">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-12 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                <div
                                  className={`h-full rounded-full ${row.isLocked ? "bg-red-400" : row.status === "Completed" ? "bg-[#10B981]" : "bg-indigo-600"}`}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <span className="font-bold text-[10px] font-mono">{progressPct}%</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                            <span className="truncate max-w-[140px] block text-[11px]">
                              {row.status === "Completed" ? "Completed" : `${currentBlockName} (${latestAttempt ? latestAttempt.currentBlockIndex + 1 : 0}/${Math.max(row.lessonBlocks.length, 1)})`}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                              <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="font-mono">
                                {latestAttempt ? `${Math.floor((latestAttempt.activeTimeSpent || 0) / 60)}m ${(latestAttempt.activeTimeSpent || 0) % 60}s` : "0m 0s"}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {row.responses.length} responses &bull; {row.signalsSummary.total} signals
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap text-[10px] text-slate-500 font-medium">
                            <div className="font-semibold text-slate-700">Recent: {row.lastLessonActivity}</div>
                            <div className="text-[9px] text-slate-400 mt-0.5">Signed in: {row.lastSignedIn}</div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-0.5">
                              {getStudentAcademicHeatmap(sStudent.id, latestAttempt, row.responses, studentActivities).map((day) => (
                                <TooltipWrapper key={day.dateStr} day={day}>
                                  <div className={`w-5 h-5 rounded-sm border flex items-center justify-center text-[7.5px] transition-all select-none ${
                                    day.intensity === "high"
                                      ? "bg-indigo-600 text-white border-indigo-700 font-bold"
                                      : day.intensity === "medium"
                                      ? "bg-indigo-300 text-indigo-900 border-indigo-400"
                                      : day.intensity === "low"
                                      ? "bg-[#E0E7FF] text-indigo-800 border-indigo-200"
                                      : "bg-slate-50 text-slate-300 border-slate-150"
                                  }`}>
                                    {day.total || ""}
                                  </div>
                                </TooltipWrapper>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap font-bold text-slate-800">
                            <div className="font-mono text-[11px]">{latestAttempt ? `${row.earnedPoints}/${row.maxPoints} pts` : "—"}</div>
                            {row.hasPendingGrading && (
                              <span className="text-[9px] text-amber-600 font-bold block">SA pending</span>
                            )}
                          </td>
                          <td className="py-1.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              {row.isLocked && latestAttempt ? (
                                <button
                                  onClick={(e: MouseEvent) => handleUnlock(e, latestAttempt.id)}
                                  disabled={unlockingId === latestAttempt.id}
                                  className="text-[9px] font-bold bg-[#E5B53B] hover:bg-amber-400 text-[#0A192F] px-2.5 py-1 rounded transition uppercase tracking-wider flex items-center gap-1 cursor-pointer border border-amber-400"
                                >
                                  <Unlock className="w-3 h-3" />
                                  {unlockingId === latestAttempt.id ? "Unlocking…" : "Unlock"}
                                </button>
                              ) : row.needsReview ? (
                                <div className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  {row.hasPendingGrading ? "Grade pending" : "Review signals"}
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
        </div>
      )}
    </div>
  );
}

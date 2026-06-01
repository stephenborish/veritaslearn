import { useState, type MouseEvent } from "react";
import { 
  Clock, 
  CheckCircle2, 
  Lock, 
  Unlock, 
  Users, 
  AlertTriangle, 
  HelpCircle, 
  Eye, 
  Monitor, 
  List, 
  Grid, 
  Search, 
  RotateCcw, 
  UserX, 
  ShieldCheck, 
  ShieldAlert
} from "lucide-react";
import { motion } from "motion/react";

interface LiveMonitorProps {
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
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
  onOpenDossier, 
  onUnlockStudent 
}: LiveMonitorProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string>("all");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [showPreviewAttempts, setShowPreviewAttempts] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [layoutMode, setLayoutMode] = useState<"grid" | "table">("grid");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const publishedLessons = lessons.filter((l) => l.isPublished);

  // Dynamic max points calculator for a given lesson
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

  // 1. Raw attempt candidates based on showPreviewAttempts configuration
  const allFilteredAttemptsByPreview = showPreviewAttempts
    ? attempts
    : attempts.filter((a) => !a.isPreviewAttempt);

  // 2. Filter attempts by selected lesson
  const lessonFilteredAttempts = selectedLessonId === "all"
    ? allFilteredAttemptsByPreview
    : allFilteredAttemptsByPreview.filter((a) => a.lessonId === selectedLessonId);

  // 3. Search and status helpers
  const isAttemptActiveNow = (attempt: any) => {
    if (attempt.status === "completed") return false;
    const lastActiveRaw = attempt.lastActiveAt || attempt.startedAt;
    if (!lastActiveRaw) return false;
    const lastActiveDate = new Date(lastActiveRaw);
    const minutesAgo = Math.floor((Date.now() - lastActiveDate.getTime()) / 60000);
    return minutesAgo <= 2;
  };

  const isAttemptIdle = (attempt: any) => {
    if (attempt.status === "completed") return false;
    const lastActiveRaw = attempt.lastActiveAt || attempt.startedAt;
    if (!lastActiveRaw) return true;
    const lastActiveDate = new Date(lastActiveRaw);
    const minutesAgo = Math.floor((Date.now() - lastActiveDate.getTime()) / 60000);
    return minutesAgo > 2;
  };

  const isAttemptLockedBlocked = (attempt: any) => {
    return attempt.lockState === "locked_awaiting_teacher";
  };

  const isAttemptNeedsReview = (attempt: any) => {
    const isLocked = isAttemptLockedBlocked(attempt);
    if (isLocked) return true;

    // Violations check
    const sSignals = signals.filter((s) => s.attemptId === attempt.id);
    const blurs = sSignals.filter((s) => s.eventType === "blur_focus_lost" || s.eventType === "visibility_hidden").length;
    const screens = sSignals.filter((s) => s.eventType === "fullscreen_exited").length;
    const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
    const totalViolations = blurs + screens + seekVio;

    if (totalViolations >= 3 || screens > 0 || seekVio > 0) return true;

    // SA pending grading
    const sResponses = responses.filter((r) => r.attemptId === attempt.id);
    const hasPendingGrading = sResponses.some(
      (r) => r.type === "sa" && (!r.aiGrading || r.aiGrading.status === "pending" || r.aiGrading.status === "failed" || r.aiGrading.status === "needs_review")
    );
    if (hasPendingGrading) return true;

    return false;
  };

  // 4. Group "Not Started" students matching the selection scope
  const studentsWithAttempt = new Set(
    allFilteredAttemptsByPreview
      .filter((a) => selectedLessonId === "all" ? true : a.lessonId === selectedLessonId)
      .map((a) => a.studentId)
  );

  const rawNotStarted = students.filter((s) => !studentsWithAttempt.has(s.id));

  // Counts for filters matching the current selected lesson scope
  const totalAttemptsCount = lessonFilteredAttempts.length;
  const activeCount = lessonFilteredAttempts.filter(isAttemptActiveNow).length;
  const idleCount = lessonFilteredAttempts.filter(isAttemptIdle).length;
  const notStartedCount = rawNotStarted.length;
  const completedCount = lessonFilteredAttempts.filter((a) => a.status === "completed").length;
  const needsReviewCount = lessonFilteredAttempts.filter(isAttemptNeedsReview).length;
  const lockedCount = lessonFilteredAttempts.filter(isAttemptLockedBlocked).length;
  const grandTotalFilterCount = totalAttemptsCount + notStartedCount;

  // 5. Apply Search filter
  const searchFilteredAttempts = lessonFilteredAttempts.filter((attempt) => {
    let student = students.find((s) => s.id === attempt.studentId);
    if (!student && attempt.isPreviewAttempt) {
      student = {
        name: "Teacher Preview Student",
        email: "teacher-preview@veritas.placeholder"
      };
    }
    if (!student) return false;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return student.name.toLowerCase().includes(term) || student.email.toLowerCase().includes(term);
  });

  const searchNotStartedStudents = rawNotStarted.filter((student) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return student.name.toLowerCase().includes(term) || student.email.toLowerCase().includes(term);
  });

  // 6. Apply Status Filter to attempts list
  let visibleAttempts = searchFilteredAttempts;
  let showNotStartedUnderneath = statusFilter === "all" || statusFilter === "not_started";

  if (statusFilter === "active") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptActiveNow);
    showNotStartedUnderneath = false;
  } else if (statusFilter === "idle") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptIdle);
    showNotStartedUnderneath = false;
  } else if (statusFilter === "not_started") {
    visibleAttempts = []; // only show searchNotStartedStudents
    showNotStartedUnderneath = true;
  } else if (statusFilter === "completed") {
    visibleAttempts = searchFilteredAttempts.filter((a) => a.status === "completed");
    showNotStartedUnderneath = false;
  } else if (statusFilter === "needs_review") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptNeedsReview);
    showNotStartedUnderneath = false;
  } else if (statusFilter === "locked") {
    visibleAttempts = searchFilteredAttempts.filter(isAttemptLockedBlocked);
    showNotStartedUnderneath = false;
  }

  const handleUnlock = async (e: MouseEvent, attemptId: string) => {
    e.stopPropagation();
    setUnlockingId(attemptId);
    try {
      await onUnlockStudent(attemptId);
    } finally {
      setUnlockingId(null);
    }
  };

  return (
    <div className="space-y-5 font-sans">
      {/* Search, Filter selection, and Layout switcher */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
        {/* Row 1: Filters selector & Options */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono shrink-0">
              Assigned Block:
            </label>
            <select
              value={selectedLessonId}
              onChange={(e) => {
                setSelectedLessonId(e.target.value);
                setStatusFilter("all");
              }}
              className="text-xs border border-slate-250 rounded px-3 py-1.5 bg-white text-slate-800 font-bold focus:ring-0 focus:outline-none cursor-pointer max-w-xs transition hover:border-slate-300"
            >
              <option value="all">All Lessons &amp; Activities</option>
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
                placeholder="Find student name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="text-xs pl-8 pr-3 py-1.5 border border-slate-250 rounded bg-white text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:border-slate-400 transition w-44 lg:w-56"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 font-bold text-[10px]"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Show preview sandbox checkbox wrapper */}
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded select-none transition">
              <input
                type="checkbox"
                checked={showPreviewAttempts}
                onChange={(e) => setShowPreviewAttempts(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-0 cursor-pointer w-3.5 h-3.5"
              />
              <span>Include preview test attempts</span>
            </label>

            <div className="flex bg-slate-100 rounded-sm p-0.5 border border-slate-200">
              <button
                onClick={() => setLayoutMode("grid")}
                className={`p-1 rounded-sm transition ${layoutMode === "grid" ? "bg-white text-slate-800 shadow-xs" : "text-slate-400 hover:text-slate-600"}`}
                title="Grid Dashboard Cards"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLayoutMode("table")}
                className={`p-1 rounded-sm transition ${layoutMode === "table" ? "bg-white text-slate-800 shadow-xs" : "text-slate-400 hover:text-slate-600"}`}
                title="Dense Spreadsheet Row Table"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Status tabs with dynamic counts */}
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {[
              { id: "all", label: "All Candidates", count: grandTotalFilterCount, color: "slate" },
              { id: "active", label: "Active Live", count: activeCount, color: "green" },
              { id: "idle", label: "Idle / Offline", count: idleCount, color: "slate" },
              { id: "not_started", label: "Not Started", count: notStartedCount, color: "slate" },
              { id: "completed", label: "Completed", count: completedCount, color: "blue" },
              { id: "needs_review", label: "Needs Review", count: needsReviewCount, color: "amber" },
              { id: "locked", label: "Locked Out", count: lockedCount, color: "red" },
            ].map((tab) => {
              const active = statusFilter === tab.id;
              
              let badgeColor = "bg-slate-100 text-slate-600";
              if (active) {
                if (tab.color === "green") badgeColor = "bg-emerald-600 text-white";
                else if (tab.color === "blue") badgeColor = "bg-indigo-600 text-white";
                else if (tab.color === "amber") badgeColor = "bg-amber-500 text-slate-900 font-bold";
                else if (tab.color === "red") badgeColor = "bg-red-600 text-white font-bold";
                else badgeColor = "bg-slate-800 text-white";
              } else {
                if (tab.color === "green") badgeColor = "bg-emerald-50 text-emerald-700 font-bold group-hover:bg-emerald-100";
                else if (tab.color === "amber" && tab.count > 0) badgeColor = "bg-amber-100 text-amber-800 font-bold border border-amber-200 animate-pulse";
                else if (tab.color === "red" && tab.count > 0) badgeColor = "bg-red-100 text-red-700 font-bold border border-red-200 animate-bounce";
              }

              return (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap transition cursor-pointer select-none ${
                    active 
                      ? "bg-slate-100 text-slate-900 border border-slate-350"
                      : "text-slate-500 border border-transparent hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full ${badgeColor} transition-colors`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main activities layout */}
      {visibleAttempts.length === 0 && (!showNotStartedUnderneath || searchNotStartedStudents.length === 0) ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-lg text-slate-400 shadow-sm space-y-2">
          <UserX className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">No candidates active under this query</p>
          <p className="text-[11px] text-slate-400 font-normal">Try clearing search parameters, incorporating sandbox attempts, or updating the state category.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* GRID CARD LAYOUT */}
          {layoutMode === "grid" && visibleAttempts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleAttempts
                .sort((a, b) => {
                  // Put locked first
                  const lockA = isAttemptLockedBlocked(a) ? 1 : 0;
                  const lockB = isAttemptLockedBlocked(b) ? 1 : 0;
                  if (lockB !== lockA) return lockB - lockA;

                  // Active next
                  const actA = isAttemptActiveNow(a) ? 1 : 0;
                  const actB = isAttemptActiveNow(b) ? 1 : 0;
                  return actB - actA;
                })
                .map((latestAttempt) => {
                  let student = students.find((s) => s.id === latestAttempt.studentId);
                  if (!student && latestAttempt.isPreviewAttempt) {
                    student = {
                      id: latestAttempt.studentId,
                      name: "Teacher Preview Student",
                      email: "teacher-preview@veritas.placeholder",
                      role: "student"
                    };
                  }
                  if (!student) return null;

                  const sLesson = lessons.find((l) => l.id === latestAttempt.lessonId);
                  const lessonBlocks = blocks
                    .filter((b) => b.lessonId === latestAttempt.lessonId)
                    .sort((a: any, b: any) => a.order - b.order);
                  const sSignals = signals.filter((s) => s.attemptId === latestAttempt.id);
                  const sResponses = responses.filter((r) => r.attemptId === latestAttempt.id);

                  // Quantify blur focus events
                  const blurs = sSignals.filter((s) => s.eventType === "blur_focus_lost" || s.eventType === "visibility_hidden").length;
                  const screens = sSignals.filter((s) => s.eventType === "fullscreen_exited").length;
                  const copyPastes = sSignals.filter((s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked").length;
                  const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
                  const totalViolations = blurs + screens + copyPastes + seekVio;

                  const isLocked = isAttemptLockedBlocked(latestAttempt);
                  const isCompleted = latestAttempt.status === "completed";
                  const isActiveNow = isAttemptActiveNow(latestAttempt);

                  let blockCount = Math.max(lessonBlocks.length, 1);
                  let progressPercent = isCompleted
                    ? 100
                    : Math.round((latestAttempt.currentBlockIndex / blockCount) * 100);

                  const currentBlock = lessonBlocks[latestAttempt.currentBlockIndex];
                  const currentBlockName = currentBlock
                    ? currentBlock.title
                    : `Segment ${latestAttempt.currentBlockIndex + 1}`;

                  const lastActiveRaw = latestAttempt.lastActiveAt || latestAttempt.startedAt;
                  const lastActiveDate = new Date(lastActiveRaw || Date.now());
                  const minutesAgo = Math.floor((Date.now() - lastActiveDate.getTime()) / 60000);
                  const lastActiveDisplay = minutesAgo < 1 
                    ? "Active now" 
                    : minutesAgo < 60 
                      ? `${minutesAgo}m ago` 
                      : lastActiveDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                  // Points calculation
                  const maxLessonPoints = calcMaxPoints(latestAttempt.lessonId);
                  const earnedPoints = sResponses.reduce((sum, r) => sum + (r.score || 0), 0);
                  const hasShortAnswerPending = sResponses.some(
                    (r) => r.type === "sa" && (!r.aiGrading || r.aiGrading.status === "pending" || r.aiGrading.status === "failed" || r.aiGrading.status === "needs_review")
                  );

                  // Highlight actionable alerts
                  let riskDescription = "";
                  if (isLocked) {
                    riskDescription = "Classroom lockout activated. Exceeded blur thresholds.";
                  } else if (screens > 0) {
                    riskDescription = "Integrity warning: Left authorized fullscreen mode.";
                  } else if (seekVio > 0) {
                    riskDescription = "Integrity warning: Seeking timeline was blocked.";
                  } else if (blurs >= 3) {
                    riskDescription = `${blurs} tab switching/blur alerts recorded.`;
                  } else if (hasShortAnswerPending && isCompleted) {
                    riskDescription = "Response submitted. Short essay awaiting evaluation.";
                  }

                  return (
                    <motion.div
                      initial={{ opacity: 0.96 }}
                      animate={{ opacity: 1 }}
                      whileHover={{ y: -1 }}
                      key={latestAttempt.id}
                      onClick={() => onOpenDossier(student.id, latestAttempt.lessonId)}
                      className={`bg-white border rounded-lg p-4 shadow-xs hover:shadow transition flex flex-col justify-between min-h-[220px] cursor-pointer group relative ${
                        isLocked
                          ? "border-amber-300 ring-2 ring-amber-100 bg-amber-50/50"
                          : isAttemptNeedsReview(latestAttempt)
                            ? "border-amber-200 hover:border-amber-300 bg-[#FCFBF8]"
                            : "border-slate-205 hover:border-slate-300"
                      }`}
                    >
                      {/* Top profile segment */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-start gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Pulse heartbeat element */}
                              {isCompleted ? (
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 select-none block shrink-0" title="Completed Assignment"></span>
                              ) : isActiveNow ? (
                                <span className="relative flex h-2.5 w-2.5 shrink-0" title="Pulse Heartbeat Active">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                              ) : (
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-250 select-none block shrink-0" title="Offline / Idle"></span>
                              )}
                              <h4 className="text-sm font-bold text-slate-900 truncate max-w-[170px] leading-tight">
                                {student.name}
                              </h4>
                              {latestAttempt.isPreviewAttempt && (
                                <span className="bg-amber-100 text-amber-800 text-[8px] font-mono font-bold px-1 py-0.5 rounded tracking-wider uppercase scale-90">
                                  TEST
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] font-mono text-slate-400 truncate max-w-[190px]">
                              {student.email}
                            </p>
                          </div>

                          <span className={`text-[8px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm shrink-0 border ${
                            isLocked
                              ? "bg-red-50 text-red-700 border-red-200 font-extrabold"
                              : isAttemptNeedsReview(latestAttempt)
                                ? "bg-amber-50 text-amber-800 border-amber-200 font-bold"
                                : isCompleted
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                          }`}>
                            {isLocked ? "LOCKOUT" : isCompleted ? "COMPLETED" : isAttemptNeedsReview(latestAttempt) ? "REVIEWS NEEDED" : "IN PROGRESS"}
                          </span>
                        </div>

                        {/* Middle: Progress bar based on actual blocks layout */}
                        <div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                isLocked 
                                  ? "bg-red-500" 
                                  : isCompleted 
                                    ? "bg-emerald-500" 
                                    : "bg-[#0A192F]"
                              }`} 
                              style={{ width: `${progressPercent}%` }}
                            ></div>
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-slate-500 font-bold mt-1.5">
                            <span>{progressPercent}% PROGRESS</span>
                            {/* Current Block positional denominator limit */}
                            <span className="truncate max-w-[120px] text-right text-slate-400 font-normal" title={currentBlockName}>
                              {isCompleted ? "Completed" : `${currentBlockName} (${latestAttempt.currentBlockIndex + 1}/${blockCount})`}
                            </span>
                          </div>
                        </div>

                        {/* Diagnostics grid */}
                        <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-150 p-2.5 rounded-md text-[11px] font-medium text-slate-600">
                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Duration</span>
                            <span className="font-mono text-slate-800 flex items-center gap-1 font-semibold">
                              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              {Math.floor(latestAttempt.activeTimeSpent / 60)}m {latestAttempt.activeTimeSpent % 60}s
                            </span>
                          </div>
                          
                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Responses</span>
                            <span className="text-slate-800 font-bold">
                              {sResponses.length} submitted
                            </span>
                          </div>

                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Score Summary</span>
                            <span className="text-slate-800 font-semibold font-mono">
                              {earnedPoints} / {maxLessonPoints} pts
                              {hasShortAnswerPending && (
                                <span className="text-amber-600 text-[8.5px] block font-sans font-bold leading-tight">* SA review pending</span>
                              )}
                            </span>
                          </div>

                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Active Monitor</span>
                            <span className={`text-[10px] font-semibold ${totalViolations > 0 ? "text-amber-700 font-bold" : "text-slate-600"}`}>
                              {totalViolations > 0 
                                ? `${totalViolations} focus exits` 
                                : "Secure State"}
                            </span>
                          </div>
                        </div>

                        {sLesson && selectedLessonId === "all" && (
                          <div className="text-[10px] text-slate-400 font-medium truncate flex items-center gap-1 border-t border-slate-100 pt-1.5">
                            <span>Activity:</span>
                            <strong className="text-slate-600 truncate">{sLesson.title}</strong>
                          </div>
                        )}
                      </div>

                      {/* Footer warning & Action */}
                      <div className="mt-4 pt-2.5 border-t border-slate-100 space-y-2">
                        {riskDescription && (
                          <div className={`p-1.5 rounded text-[10px] flex items-center gap-1.5 font-bold ${
                            isLocked 
                              ? "bg-red-50 text-red-700 border border-red-200" 
                              : isAttemptNeedsReview(latestAttempt) 
                                ? "bg-amber-50 text-amber-700 border border-amber-200" 
                                : "bg-slate-100 text-slate-600"
                          }`}>
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{riskDescription}</span>
                          </div>
                        )}

                        <div className="flex justify-between items-center">
                          <span className="text-[9.5px] text-slate-400 font-semibold">
                            Last active: <span className="font-mono font-bold text-slate-500">{lastActiveDisplay}</span>
                          </span>

                          <div className="flex gap-1.5 shrink-0">
                            {isLocked && (
                              <button
                                onClick={(e) => handleUnlock(e, latestAttempt.id)}
                                disabled={unlockingId === latestAttempt.id}
                                className="text-[9px] font-extrabold bg-[#E5B53B] hover:bg-amber-500 disabled:bg-slate-200 text-[#0A192F] px-2.5 py-1 rounded transition uppercase tracking-wider flex items-center gap-1 shadow-xs cursor-pointer border border-amber-400"
                              >
                                <Unlock className="w-2.5 h-2.5" />
                                {unlockingId === latestAttempt.id ? "Unlocking" : "Unlock Student"}
                              </button>
                            )}

                            <button
                              type="button"
                              className="text-[9px] font-bold border border-slate-250 text-slate-700 bg-white hover:bg-slate-50 px-2 py-1 rounded transition uppercase tracking-wider group-hover:border-slate-400 shadow-xs"
                            >
                              Open Dossier &rarr;
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          )}

          {/* DENSE SPREADSHEET ROW TABLE LAYOUT */}
          {layoutMode === "table" && visibleAttempts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono text-[9px] tracking-widest uppercase">
                      <th className="py-3 px-4 font-bold">Status</th>
                      <th className="py-3 px-4 font-bold">Student Name &amp; Email</th>
                      <th className="py-3 px-4 font-bold">Assigned Activity</th>
                      <th className="py-3 px-4 font-bold">Progress (Blocks)</th>
                      <th className="py-3 px-4 font-bold">Current Position</th>
                      <th className="py-3 px-4 font-bold">Diagnostics Telemetry</th>
                      <th className="py-3 px-4 font-bold">Score Check</th>
                      <th className="py-3 px-4 font-bold">Auditor Warnings / Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 hover:bg-slate-50/20 text-slate-800">
                    {visibleAttempts
                      .sort((a, b) => {
                        const lockA = isAttemptLockedBlocked(a) ? 1 : 0;
                        const lockB = isAttemptLockedBlocked(b) ? 1 : 0;
                        if (lockB !== lockA) return lockB - lockA;
                        const actA = isAttemptActiveNow(a) ? 1 : 0;
                        const actB = isAttemptActiveNow(b) ? 1 : 0;
                        return actB - actA;
                      })
                      .map((attempt) => {
                        let student = students.find((s) => s.id === attempt.studentId);
                        if (!student && attempt.isPreviewAttempt) {
                          student = {
                            id: attempt.studentId,
                            name: "Teacher Preview Student",
                            email: "teacher-preview@veritas.placeholder"
                          };
                        }
                        if (!student) return null;

                        const sLesson = lessons.find((l) => l.id === attempt.lessonId);
                        const lessonBlocks = blocks
                          .filter((b) => b.lessonId === attempt.lessonId)
                          .sort((a: any, b: any) => a.order - b.order);
                        const sSignals = signals.filter((s) => s.attemptId === attempt.id);
                        const sResponses = responses.filter((r) => r.attemptId === attempt.id);

                        const blurs = sSignals.filter((s) => s.eventType === "blur_focus_lost" || s.eventType === "visibility_hidden").length;
                        const screens = sSignals.filter((s) => s.eventType === "fullscreen_exited").length;
                        const copyPastes = sSignals.filter((s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked").length;
                        const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
                        const totalViolations = blurs + screens + copyPastes + seekVio;

                        const isLocked = isAttemptLockedBlocked(attempt);
                        const isCompleted = attempt.status === "completed";
                        const isActiveNow = isAttemptActiveNow(attempt);

                        let blockCount = Math.max(lessonBlocks.length, 1);
                        let progressPercent = isCompleted
                          ? 100
                          : Math.round((attempt.currentBlockIndex / blockCount) * 100);

                        const currentBlock = lessonBlocks[attempt.currentBlockIndex];
                        const currentBlockName = currentBlock ? currentBlock.title : `Segment ${attempt.currentBlockIndex + 1}`;

                        // Score summaries
                        const maxLessonPoints = calcMaxPoints(attempt.lessonId);
                        const earnedPoints = sResponses.reduce((sum, r) => sum + (r.score || 0), 0);
                        const hasShortAnswerPending = sResponses.some(
                          (r) => r.type === "sa" && (!r.aiGrading || r.aiGrading.status === "pending" || r.aiGrading.status === "failed" || r.aiGrading.status === "needs_review")
                        );

                        const lastActiveRaw = attempt.lastActiveAt || attempt.startedAt;
                        const lastActiveDate = new Date(lastActiveRaw || Date.now());
                        const minutesAgo = Math.floor((Date.now() - lastActiveDate.getTime()) / 60000);
                        const lastActiveDisplay = minutesAgo < 1 
                          ? "Active" 
                          : `${minutesAgo}m ago`;

                        return (
                          <tr 
                            key={attempt.id} 
                            onClick={() => onOpenDossier(student.id, attempt.lessonId)}
                            className={`hover:bg-slate-50 transition cursor-pointer ${isLocked ? "bg-red-50/20" : attempt.isPreviewAttempt ? "bg-amber-50/10" : ""}`}
                          >
                            {/* Col 0: Status Circle dot indicator */}
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {isCompleted ? (
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block shrink-0" title="Completed"></span>
                                ) : isActiveNow ? (
                                  <span className="relative flex h-2.5 w-2.5 shrink-0" title="Active">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                  </span>
                                ) : (
                                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300 block shrink-0" title="Idle"></span>
                                )}
                                <span className="font-semibold text-[10px] text-slate-500 uppercase tracking-tight">
                                  {isCompleted ? "Done" : isActiveNow ? "Live" : `Idle (${lastActiveDisplay})`}
                                </span>
                              </div>
                            </td>

                            {/* Col 1: Student detail */}
                            <td className="py-2.5 px-4 font-sans font-bold text-slate-900 whitespace-nowrap">
                              <div className="flex items-center gap-1 truncate max-w-[170px]">
                                <span>{student.name}</span>
                                {attempt.isPreviewAttempt && (
                                  <span className="bg-amber-100 text-amber-800 text-[8px] px-1 py-0.5 rounded font-mono font-bold uppercase shrink-0">TEST</span>
                                )}
                              </div>
                              <span className="text-[9px] font-mono text-slate-400 block font-normal">{student.email}</span>
                            </td>

                            {/* Col 2: Activity Title */}
                            <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap font-medium">
                              <span className="truncate max-w-[140px] block" title={sLesson?.title || "Summer Lesson"}>
                                {sLesson?.title || "Assigned Block"}
                              </span>
                            </td>

                            {/* Col 3: Real progress bars */}
                            <td className="py-2.5 px-4 whitespace-nowrap min-w-[110px]">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-14 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                  <div 
                                    className={`h-full rounded-full ${isLocked ? "bg-red-500" : isCompleted ? "bg-emerald-500" : "bg-indigo-600"}`}
                                    style={{ width: `${progressPercent}%` }}
                                  ></div>
                                </div>
                                <span className="font-bold text-[10.5px] font-mono">{progressPercent}%</span>
                              </div>
                            </td>

                            {/* Col 4: Current position segment */}
                            <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                              <span className="truncate max-w-[150px] block" title={currentBlockName}>
                                {isCompleted ? "Completed" : `${currentBlockName} (${attempt.currentBlockIndex + 1}/${blockCount})`}
                              </span>
                            </td>

                            {/* Col 5: Duration / Submissions / Focus Exits */}
                            <td className="py-1.5 px-4 text-slate-600 whitespace-nowrap space-y-0.5 font-medium">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span className="font-mono text-slate-700">{Math.floor(attempt.activeTimeSpent / 60)}m {attempt.activeTimeSpent % 60}s</span>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {sResponses.length} answers &bull; {totalViolations} focus exits
                              </div>
                            </td>

                            {/* Col 6: Score Summary */}
                            <td className="py-2.5 px-4 whitespace-nowrap font-bold text-slate-800">
                              <div className="font-mono text-[11px]">
                                {earnedPoints} / {maxLessonPoints} pts
                              </div>
                              {hasShortAnswerPending && (
                                <span className="text-[8.5px] text-amber-600 font-sans block leading-tight font-extrabold">* essay pending</span>
                              )}
                            </td>

                            {/* Col 7: Actions warnings */}
                            <td className="py-1.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {isLocked ? (
                                  <button
                                    onClick={(e) => handleUnlock(e, attempt.id)}
                                    disabled={unlockingId === attempt.id}
                                    className="text-[9px] font-extrabold bg-[#E5B53B] hover:bg-amber-500 text-[#0A192F] px-2.5 py-1 rounded transition uppercase tracking-wider flex items-center gap-1 cursor-pointer border border-amber-400"
                                  >
                                    <Unlock className="w-3 h-3" />
                                    {unlockingId === attempt.id ? "Unlocking..." : "Click to Unlock"}
                                  </button>
                                ) : isAttemptNeedsReview(attempt) ? (
                                  <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>{hasShortAnswerPending ? "Review Pending" : "Focus Incidents"}</span>
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                                    <span>Secure</span>
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

          {/* NOT STARTED ROSTERS SECTION */}
          {showNotStartedUnderneath && searchNotStartedStudents.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 border-b border-dashed border-slate-200 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">Rosters Not Active / Idle ({searchNotStartedStudents.length})</span>
                <span className="text-[10px] text-slate-400 italic">No attempt recorded in chosen query bounds</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {searchNotStartedStudents.map((student) => (
                  <div
                    key={student.id}
                    className="bg-[#FAFAFA] border border-slate-200/80 hover:border-slate-300 rounded p-3 flex items-start gap-2.5 justify-between select-none transition"
                  >
                    <div className="space-y-1">
                      <div className="font-bold text-slate-800 text-[12px] flex items-center gap-1.5 leading-snug">
                        {student.name}
                        {student.isPreview && (
                          <span className="bg-amber-100 text-amber-800 text-[8px] font-mono font-bold px-1 py-0.5 rounded uppercase">Preview</span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">{student.isPreview ? "Local Simulation Student" : student.email}</div>
                    </div>
                    
                    <span className="text-[8px] font-mono font-bold uppercase tracking-widest bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
                      Not Started
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

function Stat({ label, value, color }: { label: string; value: number; color: "slate" | "blue" | "amber" | "green" }) {
  const colors = {
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    blue: "bg-blue-50 text-indigo-700 border-blue-100",
    amber: "bg-amber-50 text-amber-800 border-amber-100",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] font-mono font-bold uppercase tracking-wider ${colors[color]}`}>
      <span>{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}


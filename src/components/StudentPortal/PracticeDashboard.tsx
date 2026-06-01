import { useState } from "react";
import {
  Play, CheckCircle, Calendar, Clock3, BookOpen, Lock, AlertCircle,
  ArrowRight, ChevronRight, FileText, GraduationCap, Plus, X, Loader2,
  BookMarked, Users
} from "lucide-react";

interface PracticeDashboardProps {
  assignments: any[];
  attempts: any[];
  onStartAttempt: (lessonId: string, assignmentId: string) => void;
  onLogout: () => void;
  user: any;
  idToken?: string | null;
  onEnrollmentChange?: () => void;
}

export default function PracticeDashboard({
  assignments,
  attempts,
  onStartAttempt,
  onLogout,
  user,
  idToken,
  onEnrollmentChange,
}: PracticeDashboardProps) {
  const now = new Date();

  // Enrollment state
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [enrollmentsLoaded, setEnrollmentsLoaded] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [showJoinInput, setShowJoinInput] = useState(false);

  const authHeader: Record<string, string> = idToken ? { Authorization: `Bearer ${idToken}` } : {};

  const fetchEnrollments = async () => {
    if (!idToken) return;
    try {
      const res = await fetch("/api/enrollments", { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setEnrollments(data.enrollments || []);
        setEnrollmentsLoaded(true);
      }
    } catch (e) {
      console.error("Failed to fetch enrollments:", e);
    }
  };

  if (!enrollmentsLoaded && idToken) {
    fetchEnrollments();
  }

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError(null);
    setJoinSuccess(null);
    try {
      const res = await fetch("/api/enrollments/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ joinCode: joinCode.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        const name = [data.courseName, data.sectionName].filter(Boolean).join(" — ");
        setJoinSuccess(`You joined ${name}. Assignments for this course are now available.`);
        setJoinCode("");
        setShowJoinInput(false);
        setEnrollmentsLoaded(false); // trigger refetch
        onEnrollmentChange?.();
      } else if (data.code === "ALREADY_ENROLLED") {
        setJoinError("You are already enrolled in this course.");
      } else if (data.code === "DOMAIN_MISMATCH") {
        setJoinError("Use your Malvern Prep Google account to join this course.");
      } else if (data.code === "INVALID_CODE") {
        setJoinError("That code was not found. Check the code and try again.");
      } else if (data.code === "CODE_DISABLED") {
        setJoinError("This join code has been disabled by your teacher.");
      } else {
        setJoinError(data.error || "Something went wrong. Try again.");
      }
    } catch (e) {
      setJoinError("Could not connect. Please try again.");
    } finally {
      setJoining(false);
    }
  };

  const formatDateTime = (isoStr: string) => {
    if (!isoStr) return "N/A";
    const date = new Date(isoStr);
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const formatRelativeTime = (isoStr: string) => {
    if (!isoStr) return null;
    const date = new Date(isoStr);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const formatTimeUntil = (isoStr: string) => {
    if (!isoStr) return null;
    const date = new Date(isoStr);
    const diffMs = date.getTime() - Date.now();
    if (diffMs <= 0) return null;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  };

  const getDescriptionText = (desc: any): string => {
    if (!desc) return "";
    if (typeof desc === "object") {
      const plain = desc.plainText || (desc.html ? desc.html.replace(/<[^>]*>/g, "") : "");
      return plain.trim();
    }
    return String(desc).replace(/<[^>]*>/g, "").trim();
  };

  const getAssignmentStatus = (asg: any, attempt: any) => {
    const isCompleted = attempt?.status === "completed";
    const isLocked = attempt?.lockState === "locked_awaiting_teacher";
    const isInProgress = attempt && attempt.status === "started";

    const opensAtDate = asg.opensAt ? new Date(asg.opensAt) : null;
    const dueAtDate = asg.dueAt ? new Date(asg.dueAt) : null;
    const closesAtDate = asg.closesAt ? new Date(asg.closesAt) : null;

    const isOpenSoon = opensAtDate && now < opensAtDate;
    const isClosed = closesAtDate && now > closesAtDate;
    const isPastDue = dueAtDate && now > dueAtDate;

    if (isCompleted) {
      return { label: "Completed", buttonText: "Review", buttonDisabled: true, statusType: "completed", badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200" };
    }
    if (isClosed && !isInProgress) {
      return { label: "Closed", buttonText: "No longer available", buttonDisabled: true, statusType: "closed", badgeClass: "bg-slate-100 text-slate-500 border border-slate-200" };
    }
    if (isOpenSoon) {
      const timeUntil = formatTimeUntil(asg.opensAt);
      return { label: timeUntil ? `Opens in ${timeUntil}` : "Opening soon", buttonText: "Not yet open", buttonDisabled: true, statusType: "upcoming", badgeClass: "bg-blue-50 text-blue-600 border border-blue-200" };
    }
    if (isLocked) {
      return { label: "Locked", buttonText: "Locked", buttonDisabled: true, statusType: "locked", badgeClass: "bg-rose-50 text-rose-700 border border-rose-200" };
    }
    if (isInProgress && isPastDue) {
      return { label: "Past due — in progress", buttonText: "Resume", buttonDisabled: false, statusType: "in_progress_past_due", badgeClass: "bg-amber-50 text-amber-700 border border-amber-200" };
    }
    if (isInProgress) {
      return { label: "In progress", buttonText: "Resume", buttonDisabled: false, statusType: "in_progress", badgeClass: "bg-indigo-50 text-indigo-700 border border-indigo-200" };
    }
    if (isPastDue) {
      return { label: "Past due", buttonText: "Begin", buttonDisabled: false, statusType: "past_due", badgeClass: "bg-amber-50 text-amber-700 border border-amber-200" };
    }
    return { label: "Available", buttonText: "Begin", buttonDisabled: false, statusType: "assigned", badgeClass: "bg-sky-50 text-sky-700 border border-sky-200" };
  };

  // Categorize assignments
  const inProgressList: any[] = [];
  const availableList: any[] = [];
  const needsAttentionList: any[] = [];
  const upcomingList: any[] = [];
  const completedList: any[] = [];

  assignments.forEach((asg) => {
    const attempt = attempts.find((a) =>
      a.studentId === user.id &&
      !a.isPreviewAttempt &&
      (asg.id && a.assignmentId ? a.assignmentId === asg.id : a.lessonId === asg.lessonId)
    );
    const { statusType } = getAssignmentStatus(asg, attempt);

    if (statusType === "in_progress" || statusType === "in_progress_past_due") {
      inProgressList.push({ asg, attempt });
    } else if (statusType === "completed") {
      completedList.push({ asg, attempt });
    } else if (statusType === "upcoming") {
      upcomingList.push({ asg, attempt });
    } else if (statusType === "past_due" || statusType === "locked" || statusType === "closed") {
      needsAttentionList.push({ asg, attempt });
    } else {
      availableList.push({ asg, attempt });
    }
  });

  const getCourseLabel = (asg: any) => {
    const title = asg.courseTitle || asg.courseId || "";
    const section = asg.sectionName || asg.section || "";
    return [title, section].filter(Boolean).join(" · ");
  };

  // In-progress card
  const renderInProgressCard = ({ asg, attempt }: { asg: any; attempt: any }) => {
    const { label, buttonText, buttonDisabled, badgeClass } = getAssignmentStatus(asg, attempt);
    const estMin = asg.lessonEstimatedMinutes;
    const lastWorked = attempt?.lastActiveAt || attempt?.startedAt;
    const relativeTime = lastWorked ? formatRelativeTime(lastWorked) : null;
    const blockProgress = attempt?.currentBlockIndex ?? 0;
    const isPastDue = asg.dueAt && new Date(asg.dueAt) < now;
    const desc = getDescriptionText(asg.lessonDescription);

    return (
      <div key={asg.id} className="bg-white border-2 border-indigo-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition duration-150">
        <div className="p-5">
          <div className="flex justify-between items-start gap-3 mb-3">
            <div className="space-y-0.5 min-w-0">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                {getCourseLabel(asg)}
              </div>
              <h4 className="text-[17px] font-bold text-slate-800 tracking-tight leading-snug">
                {asg.lessonTitle || "Untitled Lesson"}
              </h4>
            </div>
            <span className={`shrink-0 text-[10px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${badgeClass}`}>{label}</span>
          </div>

          <div className="flex items-center gap-2 mb-3 text-sm text-indigo-700 font-semibold">
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            <span>Continue where you left off</span>
            {relativeTime && (
              <span className="text-slate-400 font-normal text-xs">— last worked {relativeTime}</span>
            )}
          </div>

          {desc && (
            <p className="text-xs text-slate-500 mb-3 line-clamp-2 leading-relaxed">{desc}</p>
          )}

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Segment {blockProgress + 1}</span>
              {isPastDue && <span className="text-amber-600 font-semibold">Past due</span>}
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(8, Math.min(95, (blockProgress + 1) * 20))}%` }}
              />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Due: <strong className="text-slate-700">{formatDateTime(asg.dueAt)}</strong></span>
            </div>
            {estMin && (
              <div className="flex items-center gap-1 text-slate-400">
                <Clock3 className="w-3.5 h-3.5" />
                <span>{estMin} min est.</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-indigo-50 border-t border-indigo-100 px-5 py-3 flex justify-end">
          <button
            onClick={() => !buttonDisabled && onStartAttempt(asg.lessonId, asg.id)}
            disabled={buttonDisabled}
            className="text-sm font-bold px-5 py-2 rounded flex items-center gap-2 transition shadow-sm bg-indigo-700 hover:bg-indigo-800 text-white cursor-pointer"
          >
            {buttonText}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  // Standard assignment card
  const renderStandardCard = ({ asg, attempt }: { asg: any; attempt: any }) => {
    const { label, buttonText, buttonDisabled, badgeClass } = getAssignmentStatus(asg, attempt);
    const estMin = asg.lessonEstimatedMinutes;
    const isPastDue = asg.dueAt && new Date(asg.dueAt) < now;
    const isClosed = asg.closesAt && new Date(asg.closesAt) < now;
    const isLocked = attempt?.lockState === "locked_awaiting_teacher";
    const isOpenSoon = asg.opensAt && new Date(asg.opensAt) > now;
    const timeUntilOpen = isOpenSoon ? formatTimeUntil(asg.opensAt) : null;
    const isCompleted = attempt?.status === "completed";
    const desc = getDescriptionText(asg.lessonDescription);

    return (
      <div
        key={asg.id}
        className={`bg-white border text-slate-800 rounded-lg overflow-hidden shadow-xs flex flex-col justify-between hover:shadow-sm transition duration-150 ${
          isLocked ? "border-rose-200 bg-rose-50/20" : isCompleted ? "border-emerald-200" : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <div className="p-5">
          <div className="flex justify-between items-start gap-3">
            <div className="space-y-0.5 min-w-0">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                {getCourseLabel(asg)}
              </div>
              <h4 className="text-[16px] font-bold text-slate-800 tracking-tight leading-snug">
                {asg.lessonTitle || "Untitled Lesson"}
              </h4>
            </div>
            <span className={`shrink-0 text-[10px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${badgeClass}`}>{label}</span>
          </div>

          {desc && <p className="text-xs text-slate-500 mt-3 line-clamp-2 leading-relaxed">{desc}</p>}

          {isOpenSoon && timeUntilOpen && (
            <div className="mt-3 text-xs text-blue-600 font-medium">Opens in {timeUntilOpen}</div>
          )}
          {isLocked && (
            <div className="mt-3 text-xs text-rose-700 font-medium flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              Your attempt requires teacher review before you can continue.
            </div>
          )}
          {isCompleted && (
            <div className="mt-3 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              Submitted and complete.
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-1.5 text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>
                Due: <strong className="font-semibold text-slate-700">{formatDateTime(asg.dueAt)}</strong>
                {isPastDue && !isClosed && !isCompleted && (
                  <span className="text-amber-600 font-bold ml-1.5">— Past due</span>
                )}
              </span>
            </div>
            {asg.closesAt && !isCompleted && (
              <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                <span>Closes: {formatDateTime(asg.closesAt)}</span>
                {isClosed && <span className="text-rose-600 font-semibold">— Closed</span>}
              </div>
            )}
            {estMin && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Clock3 className="w-3.5 h-3.5" />
                <span>{estMin} minutes estimated</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 border-t border-slate-100 px-5 py-3 flex justify-end items-center">
          <button
            onClick={() => !buttonDisabled && onStartAttempt(asg.lessonId, asg.id)}
            disabled={buttonDisabled}
            className={`text-[12px] font-bold px-4 py-1.5 rounded flex items-center gap-1.5 transition shadow-xs ${
              buttonDisabled
                ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-[#0A192F] hover:bg-[#15294b] text-white cursor-pointer"
            }`}
          >
            {buttonText}
            {!buttonDisabled && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  };

  const SectionHeader = ({
    icon: Icon,
    title,
    count,
    color = "slate",
    subtitle,
  }: {
    icon: any;
    title: string;
    count: number;
    color?: "slate" | "indigo" | "amber" | "emerald" | "rose";
    subtitle?: string;
  }) => {
    const colors = {
      slate: { border: "border-slate-200", icon: "text-slate-600", text: "text-slate-800", badge: "bg-slate-200 text-slate-700" },
      indigo: { border: "border-indigo-200", icon: "text-indigo-600", text: "text-indigo-900", badge: "bg-indigo-100 text-indigo-800" },
      amber: { border: "border-amber-200", icon: "text-amber-600", text: "text-amber-900", badge: "bg-amber-100 text-amber-800" },
      emerald: { border: "border-emerald-200", icon: "text-emerald-600", text: "text-emerald-900", badge: "bg-emerald-100 text-emerald-800" },
      rose: { border: "border-rose-200", icon: "text-rose-600", text: "text-rose-900", badge: "bg-rose-100 text-rose-800" },
    };
    const c = colors[color];
    return (
      <div className={`flex items-center gap-2.5 border-b ${c.border} pb-2`}>
        <Icon className={`w-4 h-4 ${c.icon} shrink-0`} />
        <h3 className={`text-xs font-bold uppercase tracking-widest font-mono ${c.text}`}>{title}</h3>
        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono ${c.badge}`}>{count}</span>
        {subtitle && <span className="text-xs text-slate-400 font-normal ml-1">{subtitle}</span>}
      </div>
    );
  };

  const totalAssigned = assignments.length;
  const totalCompleted = completedList.length;

  const hasEnrollments = enrollments.length > 0;
  const hasAssignments = assignments.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-6">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Welcome header */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="font-bold text-slate-800 text-2xl leading-snug">
                {user.name ? `Welcome back, ${user.name.split(" ")[0]}` : "Student Dashboard"}
              </h2>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed max-w-xl">
                Your progress is saved automatically. You can leave and return to any assignment — pick up right where you left off.
              </p>
            </div>
            {totalAssigned > 0 && (
              <div className="flex gap-5 shrink-0">
                {inProgressList.length > 0 && (
                  <div className="text-center">
                    <div className="text-2xl font-bold text-indigo-700">{inProgressList.length}</div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">In Progress</div>
                  </div>
                )}
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-700">{totalCompleted}</div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-700">{totalAssigned}</div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Total</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Course Enrollment Area */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 border-b border-slate-200 pb-2 flex-1">
              <GraduationCap className="w-4 h-4 text-slate-600 shrink-0" />
              <h3 className="text-xs font-bold uppercase tracking-widest font-mono text-slate-800">My Courses</h3>
              {enrollments.length > 0 && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono bg-slate-200 text-slate-700">
                  {enrollments.length}
                </span>
              )}
            </div>
          </div>

          {/* Join success message */}
          {joinSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-start gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 font-medium">{joinSuccess}</p>
              <button onClick={() => setJoinSuccess(null)} className="ml-auto text-emerald-500 hover:text-emerald-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Enrolled courses */}
          {hasEnrollments && (
            <div className="flex flex-wrap gap-2">
              {enrollments.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-xs"
                >
                  <BookMarked className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>{e.courseName}{e.sectionName ? ` — ${e.sectionName}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {/* Join code input */}
          {showJoinInput ? (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <p className="text-xs text-slate-500">Use the code your teacher shared with you.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase());
                    setJoinError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  placeholder="e.g. APBIO-4M8X"
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg font-mono font-bold text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 uppercase tracking-widest placeholder:normal-case placeholder:font-normal placeholder:tracking-normal"
                  autoFocus
                />
                <button
                  onClick={handleJoin}
                  disabled={joining || !joinCode.trim()}
                  className="px-4 py-2.5 bg-[#0A192F] hover:bg-[#15294b] disabled:opacity-50 text-white text-sm font-bold rounded-lg transition flex items-center gap-2 cursor-pointer"
                >
                  {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Join
                </button>
                <button
                  onClick={() => {
                    setShowJoinInput(false);
                    setJoinCode("");
                    setJoinError(null);
                  }}
                  className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {joinError && (
                <p className="text-xs text-rose-600 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {joinError}
                </p>
              )}
            </div>
          ) : (
            <div>
              {!hasEnrollments && (
                <div className="border border-dashed border-slate-300 rounded-xl p-8 bg-white text-center mb-3">
                  <GraduationCap className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  <p className="text-sm font-semibold text-slate-500">Join a course to see your assignments.</p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">Use the code your teacher shared with you.</p>
                  <button
                    onClick={() => setShowJoinInput(true)}
                    className="px-4 py-2 bg-[#0A192F] text-white text-sm font-semibold rounded-lg hover:bg-[#15294b] transition cursor-pointer"
                  >
                    Enter Join Code
                  </button>
                </div>
              )}
              {hasEnrollments && (
                <button
                  onClick={() => setShowJoinInput(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Join another course
                </button>
              )}
            </div>
          )}
        </div>

        {/* 1. CONTINUE WORKING */}
        {inProgressList.length > 0 && (
          <div className="space-y-4">
            <SectionHeader icon={ArrowRight} title="Continue Working" count={inProgressList.length} color="indigo" subtitle="Pick up where you left off" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {inProgressList.map(renderInProgressCard)}
            </div>
          </div>
        )}

        {/* 2. AVAILABLE ASSIGNMENTS */}
        {availableList.length > 0 && (
          <div className="space-y-4">
            <SectionHeader icon={BookOpen} title="Available Assignments" count={availableList.length} color="slate" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {availableList.map(renderStandardCard)}
            </div>
          </div>
        )}

        {/* 3. NEEDS ATTENTION */}
        {needsAttentionList.length > 0 && (
          <div className="space-y-4">
            <SectionHeader icon={AlertCircle} title="Needs Attention" count={needsAttentionList.length} color="amber" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {needsAttentionList.map(renderStandardCard)}
            </div>
          </div>
        )}

        {/* 4. COMPLETED */}
        {completedList.length > 0 && (
          <div className="space-y-4">
            <SectionHeader icon={CheckCircle} title="Completed" count={completedList.length} color="emerald" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {completedList.map(renderStandardCard)}
            </div>
          </div>
        )}

        {/* 5. UPCOMING */}
        {upcomingList.length > 0 && (
          <div className="space-y-4">
            <SectionHeader icon={Calendar} title="Upcoming" count={upcomingList.length} color="slate" subtitle="Not yet open" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {upcomingList.map(renderStandardCard)}
            </div>
          </div>
        )}

        {/* Empty state — only when enrolled but no assignments */}
        {hasEnrollments && assignments.length === 0 && (
          <div className="border border-dashed border-slate-200 rounded-lg p-12 bg-white text-center">
            <FileText className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-500">No assignments yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Your assignments will appear here once your teacher assigns them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

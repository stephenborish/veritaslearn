import { Play, CheckCircle, Calendar, Clock3, BookOpen, Lock, AlertCircle, FileText } from "lucide-react";

interface PracticeDashboardProps {
  assignments: any[];
  attempts: any[];
  onStartAttempt: (id: string) => void;
  onLogout: () => void;
  user: any;
}

export default function PracticeDashboard({ assignments, attempts, onStartAttempt, onLogout, user }: PracticeDashboardProps) {
  const now = new Date();

  // Format date strings elegantly
  const formatDateTime = (isoStr: string) => {
    if (!isoStr) return "N/A";
    const date = new Date(isoStr);
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // Helper to determine status type, badge styling, and button labeling
  const getAssignmentStatus = (asg: any, attempt: any) => {
    const isComp = attempt?.status === "completed" || attempt?.status === "submitted";
    const isLocked = attempt?.lockState === "locked_awaiting_teacher";

    const opensAtDate = asg.opensAt ? new Date(asg.opensAt) : null;
    const dueAtDate = asg.dueAt ? new Date(asg.dueAt) : null;
    const closesAtDate = asg.closesAt ? new Date(asg.closesAt) : null;

    const isOpenSoon = opensAtDate && now < opensAtDate;
    const isClosed = closesAtDate && now > closesAtDate;
    const isPastDue = dueAtDate && now > dueAtDate;

    if (isComp) {
      return {
        label: "Completed",
        buttonText: "Review",
        buttonDisabled: false,
        statusType: "completed",
        badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      };
    }

    if (isClosed) {
      return {
        label: "Closed",
        buttonText: "Closed",
        buttonDisabled: true,
        statusType: "closed",
        badgeClass: "bg-slate-100 text-slate-500 border border-slate-200",
      };
    }

    if (isOpenSoon) {
      return {
        label: `Opens ${formatDateTime(asg.opensAt)}`,
        buttonText: "Locked",
        buttonDisabled: true,
        statusType: "upcoming",
        badgeClass: "bg-blue-50 text-blue-600 border border-blue-200",
      };
    }

    if (isLocked) {
      return {
        label: "Locked",
        buttonText: "Locked",
        buttonDisabled: true,
        statusType: "locked",
        badgeClass: "bg-rose-50 text-rose-700 border border-rose-200",
      };
    }

    if (isPastDue) {
      return {
        label: "Past Due",
        buttonText: attempt ? "Resume" : "Begin",
        buttonDisabled: false,
        statusType: "past_due",
        badgeClass: "bg-amber-50 text-amber-700 border border-amber-200",
      };
    }

    if (attempt) {
      return {
        label: "In Progress",
        buttonText: "Resume",
        buttonDisabled: false,
        statusType: "in_progress",
        badgeClass: "bg-indigo-50 text-indigo-700 border border-indigo-200",
      };
    }

    return {
      label: "Assigned",
      buttonText: "Begin",
      buttonDisabled: false,
      statusType: "assigned",
      badgeClass: "bg-sky-50 text-sky-700 border border-sky-200",
    };
  };

  // Group assignments according to rules
  const availableList: any[] = [];
  const needsAttentionList: any[] = [];
  const completedList: any[] = [];

  assignments.forEach((asg) => {
    const attempt = attempts.find((a) => a.lessonId === asg.lessonId && a.studentId === user.id);
    const { statusType } = getAssignmentStatus(asg, attempt);

    if (statusType === "completed") {
      completedList.push({ asg, attempt });
    } else if (
      statusType === "past_due" ||
      statusType === "locked" ||
      statusType === "closed" ||
      attempt?.status === "needs_review"
    ) {
      needsAttentionList.push({ asg, attempt });
    } else {
      availableList.push({ asg, attempt });
    }
  });

  const renderCard = ({ asg, attempt }: { asg: any; attempt: any }) => {
    const { label, buttonText, buttonDisabled, badgeClass } = getAssignmentStatus(asg, attempt);
    const estMin = asg.lessonEstimatedMinutes || 30;

    return (
      <div 
        key={asg.id}
        className="bg-white border text-slate-800 border-slate-200 rounded overflow-hidden shadow-xs flex flex-col justify-between min-h-[220px] hover:border-slate-300 hover:shadow-sm transition duration-150"
      >
        <div className="p-5">
          <div className="flex justify-between items-start gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold font-mono text-slate-400 uppercase tracking-wider">
                <span>{asg.courseId}</span>
                {asg.section && <span>• {asg.section}</span>}
              </div>
              <h4 className="text-[17px] leading-[22px] font-bold text-slate-800 tracking-tight text-left">
                {asg.lessonTitle || "Untitled Lesson"}
              </h4>
            </div>
            <span className={`shrink-0 font-sans text-[10px] font-bold tracking-tight rounded-full px-2.5 py-0.5 whitespace-nowrap shadow-2xs ${badgeClass}`}>
              {label}
            </span>
          </div>

          <p className="text-xs text-slate-500 mt-3 line-clamp-2 leading-relaxed">
            {(() => {
              const desc = asg.lessonDescription;
              if (!desc) return "Complete this assignment.";
              if (typeof desc === "object") {
                return desc.plainText || (desc.html ? desc.html.replace(/<[^>]*>/g, "") : "");
              }
              const stripped = String(desc).replace(/<[^>]*>/g, "").trim();
              return stripped || "Complete this assignment.";
            })()}
          </p>

          {attempt && !attempt.status.startsWith("completed") && (
            <div className="mt-3.5 space-y-1">
              <div className="flex justify-between items-center text-[10px] text-slate-400 font-medium">
                <span>Progress: Segment {attempt.currentBlockIndex + 1}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(10, Math.min(100, (attempt.currentBlockIndex + 1) * 20))}%` }}
                ></div>
              </div>
            </div>
          )}

          <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-col gap-1 text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Due: <strong className="font-semibold text-slate-700">{formatDateTime(asg.dueAt)}</strong></span>
            </div>
            {asg.closesAt && (
              <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                <span>Closes: {formatDateTime(asg.closesAt)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 border-t border-slate-100 px-5 py-3 flex justify-between items-center">
          <span className="font-sans text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1.5 tracking-wider">
            <Clock3 className="w-3.5 h-3.5 text-slate-400" />
            {estMin} M
          </span>

          <button
            onClick={() => !buttonDisabled && onStartAttempt(asg.lessonId)}
            disabled={buttonDisabled}
            className={`text-[12px] leading-[15px] font-bold uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1 transition shadow-xs ${
              buttonDisabled
                ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-[#0A192F] hover:bg-[#15294b] text-white cursor-pointer"
            }`}
          >
            {buttonText}
            {!buttonDisabled && <Play className="w-2.5 h-2.5" />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Course info banner */}
        <div className="bg-white border border-slate-200 rounded p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
          <div>
            <h2 className="font-sans font-bold text-slate-800 text-[26px] leading-[35px] text-left">
              Malvern Prep Student Portal
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Welcome to your student dashboard. Complete each assignment independently and in order.
              The platform records focus monitoring events, video playback progress, and response timing.
            </p>
          </div>
          <div className="bg-[#0A192F] font-sans text-white text-[10px] uppercase font-bold px-4 py-2 rounded-full whitespace-nowrap min-w-[130px] flex items-center justify-center tracking-wider">
            Student Portal
          </div>
        </div>

        {/* Assignments Sections */}
        <div className="space-y-8">
          
          {/* 1. AVAILABLE ASSIGNMENTS */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <BookOpen className="w-4 h-4 text-slate-600" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#0A192F] font-mono">
                Available Assignments
              </h3>
              <span className="ml-[1px] bg-slate-200 text-slate-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono">
                {availableList.length}
              </span>
            </div>

            {availableList.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-6 bg-slate-50/50 text-center text-slate-400 text-xs">
                No active assignments are currently available.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {availableList.map(renderCard)}
              </div>
            )}
          </div>

          {/* 2. NEEDS ATTENTION */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-800 font-mono">
                Needs Attention
              </h3>
              <span className="ml-[1px] bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono">
                {needsAttentionList.length}
              </span>
            </div>

            {needsAttentionList.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-6 bg-slate-50/50 text-center text-slate-400 text-xs">
                Awesome! No assignments need attention right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {needsAttentionList.map(renderCard)}
              </div>
            )}
          </div>

          {/* 3. COMPLETED */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-800 font-mono">
                Completed
              </h3>
              <span className="ml-[1px] bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono">
                {completedList.length}
              </span>
            </div>

            {completedList.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-6 bg-slate-50/50 text-center text-slate-400 text-xs">
                No completed assignments yet. Get started on your available lessons above!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {completedList.map(renderCard)}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

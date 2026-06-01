import { Play, CheckCircle, Calendar, Clock, BookOpen, Clock3, Tag } from "lucide-react";

interface PracticeDashboardProps {
  assignments: any[];
  attempts: any[];
  onStartAttempt: (id: string) => void;
  onLogout: () => void;
  user: any;
}

export default function PracticeDashboard({ assignments, attempts, onStartAttempt, onLogout, user }: PracticeDashboardProps) {
  // Format date strings elegantly
  const formatDateTime = (isoStr: string) => {
    if (!isoStr) return "N/A";
    const date = new Date(isoStr);
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Course info banner */}
        <div className="bg-white border border-slate-200 rounded p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
          <div>
            <h2 className="font-sans font-bold text-slate-800 text-[26px] leading-[35px] text-left bg-white">Malvern Prep Student Portal</h2>
            <p className="text-xs text-slate-500 mt-1">
              Welcome to your course preparatories. Complete each summer assignment independently and in order.
              The platform records your focus signals, video playback progress, and response timing for course readiness.
            </p>
          </div>
          <div className="bg-[#0A192F] font-sans text-white w-[132.695px] h-[30px] text-center text-[10px] leading-[0px] rounded-[14px] pt-[15px] pb-[15px] whitespace-nowrap box-border flex items-center justify-center">
            ACTIVE ASSIGNMENTS
          </div>
        </div>

        {/* Assignments items grid */}
        <div className="space-y-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#0A192F] font-mono text-left">Your Assignments Inbox</h3>

          {assignments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded p-12 text-center text-slate-500 shadow-sm">
              <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium">No assignments are currently open for you.</p>
              <p className="text-xs text-slate-400 mt-1">Refresh or check back later! Your teacher will post assignments when they open.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {assignments.map((asg) => {
                const attempt = attempts.find((a) => a.lessonId === asg.lessonId && a.studentId === user.id);
                const isComp = attempt?.status === "completed";

                return (
                  <div 
                    key={asg.id}
                    className="bg-white border text-slate-800 border-slate-200 rounded overflow-hidden shadow-sm flex flex-col justify-between min-h-[220px] hover:border-slate-300 transition"
                  >
                    <div className="p-5">
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 text-[10px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">
                            <span>{asg.courseId}</span>
                            {asg.section && <span>• {asg.section}</span>}
                          </div>
                          <h4 className="text-[17px] leading-[21px] font-bold text-slate-800 tracking-tight text-left">{asg.lessonTitle || "Untitled Lesson"}</h4>
                        </div>
                        {isComp ? (
                          <span className="shrink-0 font-sans not-italic font-bold leading-[10px] text-[9px] px-[8px] py-[5px] border-none rounded-[30px] bg-[#f79112] text-white flex items-center gap-1">
                            <CheckCircle className="w-2.5 h-2.5" /> Completed
                          </span>
                        ) : attempt ? (
                          <span className="shrink-0 font-sans not-italic font-bold leading-[10px] text-[9px] px-[8px] py-[5px] border-none rounded-[30px] bg-blue-600 text-white">
                            In Progress
                          </span>
                        ) : (
                          <span className="shrink-0 font-sans not-italic font-bold leading-[10px] text-[9px] px-[8px] py-[5px] border-none rounded-[30px] bg-green-600 text-white">
                            Assigned
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-2.5 line-clamp-2 leading-relaxed">
                        {(() => {
                          const desc = asg.lessonDescription;
                          if (!desc) return "Complete this summer assignment to demonstrate preparation readiness.";
                          if (typeof desc === "object") {
                            return desc.plainText || (desc.html ? desc.html.replace(/<[^>]*>/g, "") : "");
                          }
                          const stripped = String(desc).replace(/<[^>]*>/g, "").trim();
                          return stripped || "Complete this summer assignment to demonstrate preparation readiness.";
                        })()}
                      </p>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-1 text-[11px] text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Due: <strong className="font-semibold text-slate-700">{formatDateTime(asg.dueAt)}</strong></span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                          <span>Closes: {formatDateTime(asg.closesAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 flex justify-between items-center">
                      <span className="font-sans text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1.5 tracking-wider">
                        <Clock3 className="w-3.5 h-3.5 text-slate-400" />
                        {asg.lessonEstimatedMinutes || 30} M
                      </span>

                      <button
                        onClick={() => onStartAttempt(asg.lessonId)}
                        className="bg-[#0A192F] hover:bg-[#15294b] text-white text-[12px] leading-[15px] font-bold uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm"
                      >
                        {isComp ? "Review" : attempt ? "Resume" : "Begin"}
                        <Play className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

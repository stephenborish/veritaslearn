import { useState, type MouseEvent } from "react";
import { Clock, CheckCircle2, Lock, Unlock } from "lucide-react";
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

export default function LiveMonitor({ students, attempts, responses, signals, lessons, blocks, onOpenDossier, onUnlockStudent }: LiveMonitorProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string>("all");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);

  const publishedLessons = lessons.filter((l) => l.isPublished);

  // Filter attempts by selected lesson
  const filteredAttempts = selectedLessonId === "all"
    ? attempts
    : attempts.filter((a) => a.lessonId === selectedLessonId);

  // Summary stats for selected lesson
  const notStartedCount = selectedLessonId !== "all"
    ? students.filter((s) => !filteredAttempts.some((a) => a.studentId === s.id)).length
    : 0;
  const inProgressCount = filteredAttempts.filter((a) => a.status !== "completed").length;
  const completedCount = filteredAttempts.filter((a) => a.status === "completed").length;
  const lockedCount = filteredAttempts.filter((a) => a.lockState === "locked_awaiting_teacher").length;

  // Students with no attempt for the selected lesson
  const studentsWithAttempt = new Set(filteredAttempts.map((a) => a.studentId));
  const notStartedStudents = selectedLessonId !== "all"
    ? students.filter((s) => !studentsWithAttempt.has(s.id))
    : [];

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
    <div className="space-y-5">
      {/* Lesson selector and summary stats */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white border border-slate-200 rounded px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3 flex-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono shrink-0">
            Filter by Lesson:
          </label>
          <select
            value={selectedLessonId}
            onChange={(e) => setSelectedLessonId(e.target.value)}
            className="text-xs border border-slate-200 rounded px-3 py-1.5 bg-white text-slate-800 font-semibold focus:outline-none focus:border-slate-400 cursor-pointer max-w-xs"
          >
            <option value="all">All Lessons</option>
            {publishedLessons.map((l) => (
              <option key={l.id} value={l.id}>{l.title}</option>
            ))}
          </select>
        </div>

        {selectedLessonId !== "all" && (
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <Stat label="Not Started" value={notStartedCount} color="slate" />
            <Stat label="In Progress" value={inProgressCount} color="blue" />
            {lockedCount > 0 && <Stat label="Locked" value={lockedCount} color="amber" />}
            <Stat label="Completed" value={completedCount} color="green" />
          </div>
        )}
      </div>

      {/* Active student cards */}
      {filteredAttempts.length === 0 && notStartedStudents.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded text-slate-400">
          <p className="text-sm font-medium">No student activity recorded yet for this lesson.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Sort: locked students first, then by status */}
            {[...filteredAttempts]
              .sort((a, b) => {
                if (a.lockState === "locked_awaiting_teacher" && b.lockState !== "locked_awaiting_teacher") return -1;
                if (b.lockState === "locked_awaiting_teacher" && a.lockState !== "locked_awaiting_teacher") return 1;
                return 0;
              })
              .map((latestAttempt) => {
                const student = students.find((s) => s.id === latestAttempt.studentId);
                if (!student) return null;

                const sLesson = lessons.find((l) => l.id === latestAttempt.lessonId);
                const lessonBlocks = blocks
                  .filter((b) => b.lessonId === latestAttempt.lessonId)
                  .sort((a: any, b: any) => a.order - b.order);
                const sSignals = signals.filter((s) => s.attemptId === latestAttempt.id);
                const sResponses = responses.filter((r) => r.attemptId === latestAttempt.id);

                const blurs = sSignals.filter((s) => s.eventType === "blur_focus_lost" || s.eventType === "visibility_hidden").length;
                const screens = sSignals.filter((s) => s.eventType === "fullscreen_exited").length;
                const copyPastes = sSignals.filter((s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked").length;
                const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
                const totalViolations = blurs + screens + copyPastes + seekVio;

                const isLocked = latestAttempt.lockState === "locked_awaiting_teacher";
                let riskLevel: "low" | "medium" | "high" = "low";
                if (isLocked || totalViolations >= 3 || screens > 0 || seekVio > 0) riskLevel = "high";
                else if (totalViolations > 0) riskLevel = "medium";

                // Real progress based on actual block count
                const blockCount = Math.max(lessonBlocks.length, 1);
                const progressPercent = latestAttempt.status === "completed"
                  ? 100
                  : Math.round((latestAttempt.currentBlockIndex / blockCount) * 100);

                // Current block name
                const currentBlock = lessonBlocks[latestAttempt.currentBlockIndex];
                const currentBlockName = currentBlock
                  ? currentBlock.title
                  : `Block ${latestAttempt.currentBlockIndex + 1}`;

                // Last active time
                const lastActiveRaw = latestAttempt.lastActiveAt || latestAttempt.startedAt;
                const lastActiveDate = new Date(lastActiveRaw);
                const minutesAgo = Math.floor((Date.now() - lastActiveDate.getTime()) / 60000);
                const lastActiveDisplay = minutesAgo < 2
                  ? "Active now"
                  : minutesAgo < 60
                    ? `${minutesAgo}m ago`
                    : lastActiveDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <motion.div
                    initial={{ opacity: 0.95, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -1 }}
                    key={latestAttempt.id}
                    onClick={() => onOpenDossier(student.id, latestAttempt.lessonId)}
                    className={`bg-white border p-4 shadow-sm hover:shadow transition-all flex flex-col justify-between min-h-[200px] cursor-pointer group relative rounded ${
                      isLocked
                        ? "border-amber-300 ring-2 ring-amber-100 bg-amber-50"
                        : riskLevel === "high"
                          ? "border-amber-200 hover:border-amber-300 ring-2 ring-amber-100 bg-[#FFFDF9]"
                          : riskLevel === "medium"
                            ? "border-slate-300 hover:border-slate-400"
                            : "border-slate-200"
                    }`}
                  >
                    {/* Top info */}
                    <div>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-sm font-bold text-slate-800 leading-tight group-hover:text-[#0A192F] transition-all">{student.name}</h4>
                          <span className="text-[10px] font-mono text-slate-400 font-medium">{student.email}</span>
                        </div>
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm flex items-center gap-1 ${
                          isLocked
                            ? "bg-amber-100 text-amber-900 border border-amber-300"
                            : latestAttempt.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : riskLevel === "high"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-blue-50 text-blue-700"
                        }`}>
                          {isLocked && <Lock className="w-2.5 h-2.5" />}
                          {isLocked ? "LOCKED" : latestAttempt.status === "completed" ? "COMPLETED" : riskLevel === "high" ? "NEEDS REVIEW" : "IN PROGRESS"}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-3">
                        <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mb-1">
                          <div className={`h-full rounded-full ${isLocked ? "bg-amber-400" : "bg-blue-600"}`} style={{ width: `${progressPercent}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">
                          <span>{progressPercent}% Progress</span>
                          <span className="truncate max-w-[120px] text-right" title={currentBlockName}>{currentBlockName}</span>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="mt-2.5 pt-2.5 flex flex-col space-y-1 text-[11px] text-slate-600 border-t border-slate-100">
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-500 uppercase text-[9px]">Responses:</span>
                          <span className="font-bold text-slate-800">{sResponses.length} submitted</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-500 uppercase text-[9px]">Active Time:</span>
                          <span className="font-mono text-slate-800 flex items-center gap-1 font-semibold">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {Math.floor(latestAttempt.activeTimeSpent / 60)}m {latestAttempt.activeTimeSpent % 60}s
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-500 uppercase text-[9px]">Last Active:</span>
                          <span className="font-mono text-slate-600 text-[10px]">{lastActiveDisplay}</span>
                        </div>
                        {sLesson && (
                          <div className="flex justify-between">
                            <span className="font-semibold text-slate-500 uppercase text-[9px]">Lesson:</span>
                            <span className="text-slate-600 text-[10px] truncate max-w-[130px] text-right">{sLesson.title}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        {isLocked ? (
                          <span className="text-[10px] font-bold text-amber-700 uppercase flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Awaiting teacher approval
                          </span>
                        ) : riskLevel === "high" ? (
                          <span className="text-[10px] font-bold text-amber-700 uppercase italic">
                            {totalViolations === 1 ? "1 focus event" : `${totalViolations} focus events`}
                          </span>
                        ) : riskLevel === "medium" ? (
                          <span className="text-[10px] font-semibold text-slate-500 uppercase">
                            {totalViolations} focus event{totalViolations !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-emerald-600 uppercase flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> No review flags
                          </span>
                        )}
                      </div>

                      {isLocked ? (
                        <button
                          onClick={(e) => handleUnlock(e, latestAttempt.id)}
                          disabled={unlockingId === latestAttempt.id}
                          className="text-[10px] font-bold bg-[#E5B53B] hover:bg-amber-500 disabled:bg-slate-200 text-[#0A192F] px-3 py-1 rounded transition cursor-pointer uppercase tracking-wide flex items-center gap-1"
                        >
                          <Unlock className="w-3 h-3" />
                          {unlockingId === latestAttempt.id ? "..." : "Unlock"}
                        </button>
                      ) : (
                        <div className="text-[10px] font-mono text-slate-400 group-hover:text-[#0A192F] transition-all font-bold uppercase tracking-wider">
                          AUDIT &rarr;
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
          </div>

          {/* Not Started section */}
          {notStartedStudents.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">Not Started</span>
                <span className="bg-slate-100 text-slate-500 text-[9px] font-mono font-bold px-2 py-0.5 rounded-sm">{notStartedStudents.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {notStartedStudents.map((student) => (
                  <div
                    key={student.id}
                    className="bg-white border border-dashed border-slate-200 rounded p-4 flex flex-col justify-between min-h-[100px] opacity-60"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-700">{student.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">{student.email}</div>
                    </div>
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-2">Not Started</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "slate" | "blue" | "amber" | "green" }) {
  const colors = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-800",
    green: "bg-green-50 text-green-700",
  };
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${colors[color]}`}>
      <span>{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

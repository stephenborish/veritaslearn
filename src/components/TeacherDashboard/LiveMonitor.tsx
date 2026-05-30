import { Play, Clipboard, EyeOff, AlertTriangle, ShieldCheck, Clock, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";

interface LiveMonitorProps {
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  onOpenDossier: (studentId: string, lessonId: string) => void;
}

export default function LiveMonitor({ students, attempts, responses, signals, lessons, onOpenDossier }: LiveMonitorProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {students.map((student) => {
          // Find student's active AP attempt
          const sAttempts = attempts.filter((a) => a.studentId === student.id).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
          const latestAttempt = sAttempts[0];

          if (!latestAttempt) {
            return (
              <div 
                key={student.id}
                className="bg-white border border-dashed border-slate-200 rounded p-4 flex flex-col justify-between min-h-[160px] opacity-60 grayscale"
              >
                <div>
                  <div className="text-sm font-bold text-slate-700">{student.name}</div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">{student.email}</div>
                </div>
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Asynchronous / Not Active</div>
              </div>
            );
          }

          const sLesson = lessons.find((l) => l.id === latestAttempt.lessonId);
          const sSignals = signals.filter((s) => s.attemptId === latestAttempt.id);
          const sResponses = responses.filter((r) => r.attemptId === latestAttempt.id);
          const completedCount = sResponses.length;
          
          // Count distinct blurs/escapes
          const blurs = sSignals.filter((s) => s.eventType === "blur_focus_lost" || s.eventType === "visibility_hidden").length;
          const screens = sSignals.filter((s) => s.eventType === "fullscreen_exited").length;
          const copyPastes = sSignals.filter((s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked").length;
          const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;

          const totalViolations = blurs + screens + copyPastes + seekVio;

          let riskLevel: "low" | "medium" | "high" = "low";
          if (totalViolations >= 3 || screens > 0 || seekVio > 0) riskLevel = "high";
          else if (totalViolations > 0) riskLevel = "medium";

          // Calculate a mock visual progress percentage based on block indices or completed responses
          const progressPercent = latestAttempt.status === "completed" ? 100 : Math.min(Math.round(((latestAttempt.currentBlockIndex + 0.5) / 5) * 100), 95);

          return (
            <motion.div
              initial={{ opacity: 0.95, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -1 }}
              key={student.id}
              onClick={() => onOpenDossier(student.id, latestAttempt.lessonId)}
              className={`bg-white border p-4 shadow-sm hover:shadow transition-all flex flex-col justify-between min-h-[190px] cursor-pointer group relative rounded ${
                riskLevel === "high" 
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
                  <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm ${
                    latestAttempt.status === "completed" 
                      ? "bg-green-100 text-green-800" 
                      : riskLevel === "high"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-blue-50 text-blue-700"
                  }`}>
                    {latestAttempt.status === "completed" ? "COMPLETED" : riskLevel === "high" ? "FLAGGED" : "LIVE"}
                  </span>
                </div>

                {/* Micro Progress Bar */}
                <div className="mt-3">
                  <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mb-1">
                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${progressPercent}%` }}></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">
                    <span>{progressPercent}% Progress</span>
                    <span>Segment #{latestAttempt.currentBlockIndex + 1}</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-2.5 pt-2.5.5 flex flex-col space-y-1 text-[11px] text-slate-600 border-t border-slate-100">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-450 uppercase text-[9px]">SESSIONS SCORECARD:</span>
                    <span className="font-bold text-slate-800">{completedCount} Item Responses</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-450 uppercase text-[9px]">DURATIONAL VALUE:</span>
                    <span className="font-mono text-slate-800 flex items-center gap-1 font-semibold">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {Math.floor(latestAttempt.activeTimeSpent / 60)}m {latestAttempt.activeTimeSpent % 60}s
                    </span>
                  </div>
                </div>
              </div>

              {/* Status footer inside card */}
              <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <div>
                  {riskLevel === "high" ? (
                    <span className="text-[10px] font-bold text-amber-700 uppercase italic flex items-center gap-1">
                      !! {totalViolations === 1 ? "Focus Blurring" : `${totalViolations} Telemetry Signals`}
                    </span>
                  ) : riskLevel === "medium" ? (
                    <span className="text-[10px] font-semibold text-slate-500 uppercase flex items-center gap-1">
                      Normal checkpoint ({totalViolations})
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-emerald-605 text-emerald-600 uppercase flex items-center gap-1">
                      Shield Active
                    </span>
                  )}
                </div>

                <div className="text-[10px] font-mono text-slate-400 group-hover:text-[#0A192F] transition-all font-bold uppercase tracking-wider">
                  AUDIT &rarr;
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

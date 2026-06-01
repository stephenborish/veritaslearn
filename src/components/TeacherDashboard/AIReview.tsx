import { useState } from "react";
import { MessageSquare, Check, RotateCcw, Award, AlertCircle, AlertTriangle, Clock, TrendingDown } from "lucide-react";
import { motion } from "motion/react";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

type ReviewFilter = "all" | "grading" | "integrity" | "anomalies";

interface AIReviewProps {
  students: any[];
  lessons: any[];
  blocks: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
  onOpenDossier: (studentId: string, lessonId: string) => void;
}

export default function AIReview({ students, lessons, blocks, attempts, responses, signals, onOverrideSave, onOpenDossier }: AIReviewProps) {
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>("all");
  const [overrideScores, setOverrideScores] = useState<{ [id: string]: number }>({});
  const [overrideNotes, setOverrideNotes] = useState<{ [id: string]: string }>({});
  const [savingState, setSavingState] = useState<{ [id: string]: boolean }>({});

  // SA responses needing review
  const saResponses = responses.filter((r) => r.type === "sa");
  const reviewNeededSA = saResponses.filter((r) => {
    const g = r.aiGrading;
    if (!g) return true;
    return g.status === "pending" || g.status === "failed" || g.status === "needs_review";
  });

  // High-severity integrity signals grouped by student
  const highSignals = signals.filter((s) => s.severity === "high");
  const signalsByStudent: Record<string, any[]> = {};
  highSignals.forEach((s) => {
    if (!signalsByStudent[s.studentId]) signalsByStudent[s.studentId] = [];
    signalsByStudent[s.studentId].push(s);
  });
  const studentSignalEntries = Object.entries(signalsByStudent);

  // Anomalies
  const anomalies: Array<{ type: string; student: any; attempt: any; lesson: any; detail: string }> = [];
  attempts.forEach((attempt) => {
    const student = students.find((s) => s.id === attempt.studentId);
    const lesson = lessons.find((l) => l.id === attempt.lessonId);
    if (!student || !lesson) return;

    // Unusually fast completion (< 30% of estimated time)
    if (attempt.status === "completed" && lesson.estimatedMinutes > 0) {
      const expectedSeconds = lesson.estimatedMinutes * 60;
      if (attempt.activeTimeSpent < expectedSeconds * 0.3) {
        anomalies.push({
          type: "fast_completion",
          student,
          attempt,
          lesson,
          detail: `Completed in ${Math.round(attempt.activeTimeSpent / 60)}m active time (expected ~${lesson.estimatedMinutes}m)`
        });
      }
    }

    // Started but inactive > 48 hours
    if (attempt.status !== "completed") {
      const lastActive = attempt.lastActiveAt || attempt.startedAt;
      const hoursAgo = (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60);
      if (hoursAgo > 48) {
        anomalies.push({
          type: "inactive",
          student,
          attempt,
          lesson,
          detail: `Started ${Math.round(hoursAgo / 24)}d ago — has not completed`
        });
      }
    }

    // Low active time with submitted responses
    const attemptResponses = responses.filter((r) => r.attemptId === attempt.id);
    if (attemptResponses.length > 0 && attempt.activeTimeSpent < 60) {
      anomalies.push({
        type: "low_time",
        student,
        attempt,
        lesson,
        detail: `${attemptResponses.length} response(s) submitted with only ${attempt.activeTimeSpent}s active time`
      });
    }
  });

  const handleSave = async (id: string, defScore: number) => {
    const score = overrideScores[id] !== undefined ? overrideScores[id] : defScore;
    const notes = overrideNotes[id] || "Teacher manual standard adjustment applied.";
    setSavingState((prev) => ({ ...prev, [id]: true }));
    try {
      await onOverrideSave(id, score, notes);
    } catch (error) {
      console.error(error);
    } finally {
      setSavingState((prev) => ({ ...prev, [id]: false }));
    }
  };

  const filterCounts = {
    all: reviewNeededSA.length + studentSignalEntries.length + anomalies.length,
    grading: reviewNeededSA.length,
    integrity: studentSignalEntries.length,
    anomalies: anomalies.length,
  };

  const showGrading = activeFilter === "all" || activeFilter === "grading";
  const showIntegrity = activeFilter === "all" || activeFilter === "integrity";
  const showAnomalies = activeFilter === "all" || activeFilter === "anomalies";

  const formatEventType = (t: string) =>
    t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-5">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-1 w-fit shadow-sm">
        {(["all", "grading", "integrity", "anomalies"] as ReviewFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition cursor-pointer flex items-center gap-1.5 ${
              activeFilter === f
                ? "bg-[#0A192F] text-white"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {f === "all" ? "All" : f === "grading" ? "SA Grading" : f === "integrity" ? "Focus Events" : "Anomalies"}
            {filterCounts[f] > 0 && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${activeFilter === f ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>
                {filterCounts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {filterCounts[activeFilter] === 0 && (
        <div className="text-center py-12 bg-white border border-slate-200 rounded text-slate-400">
          <Check className="w-10 h-10 mx-auto text-slate-300 stroke-1 mb-2" />
          <p className="text-sm font-medium">Nothing needs review right now.</p>
        </div>
      )}

      {/* SA Grading Section */}
      {showGrading && reviewNeededSA.length > 0 && (
        <div className="space-y-4">
          {activeFilter === "all" && (
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-slate-400" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">Short Answer Grading</h3>
            </div>
          )}
          {reviewNeededSA.map((res) => {
            const student = students.find((s) => s.id === res.studentId);
            const grading = res.aiGrading || {};
            const isPending = grading.status === "pending";
            const isFailed = grading.status === "failed";
            const override = res.teacherOverride;

            const block = blocks.find((b) => b.id === res.blockId);
            const attempt = attempts.find((a) => a.id === res.attemptId);
            const lesson = attempt ? lessons.find((l) => l.id === attempt.lessonId) : null;
            
            let question = null;
            if (block) {
              if (!res.checkpointId) {
                question = block.singleQuestion || block.questionPool?.questions?.find((qu: any) => qu.id === res.questionId);
              } else {
                const ck = block.videoCheckpoints?.find((c: any) => c.id === res.checkpointId);
                if (ck) {
                  question = ck.singleQuestion || ck.questionPool?.questions?.find((qu: any) => qu.id === res.questionId);
                }
              }
            }

            return (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                key={res.id}
                className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm"
              >
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <span className="text-xs font-bold text-slate-800">{student?.name || "Unknown Student"}</span>
                    <span className="text-xs text-slate-400 font-mono ml-2">({student?.email})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono uppercase bg-[#0A192F] text-white font-semibold px-2 py-0.5 rounded-sm tracking-wider">
                      ID: {res.id.toUpperCase().substring(0, 8)}
                    </span>
                    {override && (
                      <span className="text-[9px] font-mono uppercase bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2 py-0.5 rounded-sm tracking-wider">
                        OVERRIDDEN
                      </span>
                    )}
                    {grading.status === "needs_review" && (
                      <span className="text-[9px] font-mono uppercase bg-red-50 text-red-700 border border-red-200 font-bold px-2 py-0.5 rounded-sm tracking-wider animate-pulse">
                        NEEDS REVIEW
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Academic Question / Prompt</span>
                        {lesson && (
                          <span className="text-[9px] font-mono text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">
                            {lesson.title}
                          </span>
                        )}
                      </div>
                      <div className="p-4 bg-slate-50/50 border border-slate-200/60 rounded text-slate-800 font-serif text-sm leading-relaxed mb-4">
                        {question ? (
                          <RichContentRenderer content={question.stem} />
                        ) : (
                          <span className="italic text-slate-400">Written response prompt details not found.</span>
                        )}
                        {question?.studentInstructions && (
                          <p className="text-[11px] text-slate-500 font-sans italic mt-2">
                            Instructions: {question.studentInstructions}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">Student Response</span>
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded font-serif text-sm leading-relaxed text-slate-800 shadow-inner">
                        {res.responseValue || <span className="text-slate-400 italic">No response provided</span>}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      ACTIVE WRITING TIME: <span className="font-bold text-slate-800">{Math.floor(res.activeTimeSpent / 60)}m {res.activeTimeSpent % 60}s</span>
                    </div>
                  </div>

                  <div className="lg:col-span-5 space-y-4 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">AI Assessment</span>
                      {isPending ? (
                        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-700 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4 animate-spin text-blue-500" />
                          <span>AI analysis pending. Refresh shortly.</span>
                        </div>
                      ) : isFailed ? (
                        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          <span>AI grading error. Manual override required.</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-semibold text-slate-600">Score:</span>
                            <span className="text-sm font-bold text-slate-800 font-mono">{grading.score} pts</span>
                          </div>
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-semibold text-slate-600">Confidence:</span>
                            <span className={`text-[9px] uppercase font-mono tracking-widest font-bold px-1.5 py-0.5 rounded-sm ${
                              grading.confidence > 0.8 ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-amber-50 text-amber-800 border border-amber-100"
                            }`}>
                              {Math.round(grading.confidence * 100)}%
                            </span>
                          </div>
                          <div className="bg-slate-50 border border-slate-200 p-3 rounded text-xs leading-relaxed text-slate-600">
                            <strong>Rationale:</strong> {grading.rationale}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-200 pt-4 space-y-3">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#0A192F] shrink-0" /> Score Override
                      </span>
                      <div className="flex flex-col gap-3">
                        <div className="w-1/3">
                          <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">Score</label>
                          <input
                            type="number"
                            value={overrideScores[res.id] !== undefined ? overrideScores[res.id] : (override?.score ?? grading.score ?? 0)}
                            onChange={(e) => setOverrideScores({ ...overrideScores, [res.id]: Number(e.target.value) })}
                            className="w-full text-xs font-mono font-bold text-center bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none focus:border-slate-400 transition"
                          />
                        </div>
                        <div className="w-full">
                          <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block mb-1">Feedback Notes</label>
                          <RichContentEditor
                            value={overrideNotes[res.id] !== undefined ? overrideNotes[res.id] : (override?.notes ?? "")}
                            onChange={(val) => setOverrideNotes({ ...overrideNotes, [res.id]: val.html })}
                            mode="inline"
                            placeholder="Reason for change..."
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => handleSave(res.id, override?.score ?? grading.score ?? 0)}
                        disabled={savingState[res.id]}
                        className="w-full bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-300 text-white text-[10px] font-bold uppercase py-2.5 rounded transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm tracking-wider"
                      >
                        {savingState[res.id] ? "Saving..." : "Submit Amendment"}
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Integrity Signals Section */}
      {showIntegrity && studentSignalEntries.length > 0 && (
        <div className="space-y-3">
          {activeFilter === "all" && (
            <div className="flex items-center gap-2 mt-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">Focus Events</h3>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {studentSignalEntries.map(([studentId, studentSignals]) => {
              const student = students.find((s) => s.id === studentId);
              const attempt = attempts.find((a) => a.studentId === studentId);
              const lesson = attempt ? lessons.find((l) => l.id === attempt.lessonId) : null;
              const eventTypes = [...new Set(studentSignals.map((s) => s.eventType))];

              return (
                <div
                  key={studentId}
                  className="bg-white border border-amber-200 rounded p-4 shadow-sm hover:shadow transition cursor-pointer"
                  onClick={() => attempt && lesson && onOpenDossier(studentId, lesson.id)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-sm font-bold text-slate-800">{student?.name || "Unknown"}</div>
                      <div className="text-[10px] font-mono text-slate-400">{student?.email}</div>
                    </div>
                    <span className="bg-amber-100 text-amber-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded-sm uppercase tracking-widest">
                      {studentSignals.length} signal{studentSignals.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {lesson && (
                    <div className="text-[10px] text-slate-500 font-medium mb-2">{lesson.title}</div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {eventTypes.slice(0, 4).map((t) => (
                      <span key={t} className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-mono uppercase tracking-wider">
                        {formatEventType(t)}
                      </span>
                    ))}
                    {eventTypes.length > 4 && (
                      <span className="text-[8px] text-slate-400 font-mono">+{eventTypes.length - 4} more</span>
                    )}
                  </div>
                  <div className="mt-2 text-[9px] text-slate-400 font-mono uppercase tracking-wider">
                    Review dossier →
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Anomalies Section */}
      {showAnomalies && anomalies.length > 0 && (
        <div className="space-y-3">
          {activeFilter === "all" && (
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
                    item.type === "fast_completion"
                      ? "bg-orange-50 text-orange-700 border border-orange-200"
                      : item.type === "inactive"
                        ? "bg-slate-100 text-slate-600"
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
                <div className="mt-2 text-[9px] text-slate-400 font-mono uppercase tracking-wider">
                  Review dossier →
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

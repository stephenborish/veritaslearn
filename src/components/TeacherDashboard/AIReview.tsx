import { useState } from "react";
import { MessageSquare, Check, RotateCcw, ShieldAlert, Award, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

interface AIReviewProps {
  students: any[];
  lessons: any[];
  responses: any[];
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
}

export default function AIReview({ students, lessons, responses, onOverrideSave }: AIReviewProps) {
  // Find only short-answer (sa) responses
  const saResponses = responses.filter((r) => r.type === "sa");
  const [overrideScores, setOverrideScores] = useState<{ [id: string]: number }>({});
  const [overrideNotes, setOverrideNotes] = useState<{ [id: string]: string }>({});
  const [savingState, setSavingState] = useState<{ [id: string]: boolean }>({});

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

  return (
    <div className="space-y-6">
      {saResponses.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded text-slate-400">
          <MessageSquare className="w-12 h-12 mx-auto text-slate-300 stroke-1 mb-2" />
          <p className="text-sm font-medium">No open-ended submissions recorded yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {saResponses.map((res) => {
            const student = students.find((s) => s.id === res.studentId);
            const grading = res.aiGrading || {};
            const isPending = grading.status === "pending";
            const isFailed = grading.status === "failed";
            const override = res.teacherOverride;

            return (
              <motion.div 
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                key={res.id}
                className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm"
              >
                {/* Header segment */}
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <span className="text-xs font-bold text-slate-800">{student?.name || "Unverified Participant"}</span>
                    <span className="text-xs text-slate-400 font-mono ml-2">({student?.email})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono uppercase bg-[#0A192F] text-white font-semibold px-2 py-0.5 rounded-sm tracking-wider">
                      SUBMISSION ID: {res.id.toUpperCase().substring(0, 8)}
                    </span>
                    {override && (
                      <span className="text-[9px] font-mono uppercase bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2 py-0.5 rounded-sm tracking-wider">
                        TEACHER OVERRIDDEN
                      </span>
                    )}
                  </div>
                </div>

                {/* Substantive content */}
                <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Student Answer */}
                  <div className="lg:col-span-7 space-y-4">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">Student Response</span>
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded font-serif text-sm leading-relaxed text-slate-800 shadow-inner">
                        {res.responseValue || <span className="text-slate-400 italic">No entry provided</span>}
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono">
                      ACTIVE WRITING COMPILATION TIME: <span className="font-bold text-slate-800">{Math.floor(res.activeTimeSpent / 60)}m {res.activeTimeSpent % 60}s</span>
                    </div>
                  </div>

                  {/* Right Column: AI Metrics & Override */}
                  <div className="lg:col-span-5 space-y-4 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest font-mono">AI Assessment</span>
                      
                      {isPending ? (
                        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-700 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4 animate-spin text-blue-500" />
                          <span>AI analysis report pending. Refresh page shortly to check.</span>
                        </div>
                      ) : isFailed ? (
                        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          <span>AI engine error or timeout. Awaiting manual override.</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-semibold text-slate-600">Generated Score:</span>
                            <span className="text-sm font-bold text-slate-800 font-mono">
                              {grading.score} point(s)
                            </span>
                          </div>
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-semibold text-slate-600">Confidence Rating:</span>
                            <div className="flex items-center gap-1.5">
                              {grading.status === "needs_review" && (
                                <span className="text-[9px] uppercase font-mono tracking-widest font-black px-1.5 py-0.5 rounded-sm bg-red-50 text-red-700 border border-red-200 animate-pulse">
                                  Flagged for Review
                                </span>
                              )}
                              <span className={`text-[9px] uppercase font-mono tracking-widest font-bold px-1.5 py-0.5 rounded-sm ${
                                grading.confidence > 0.8 ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-amber-50 text-amber-800 border border-amber-100"
                              }`}>
                                {Math.round(grading.confidence * 100)}% Match
                              </span>
                            </div>
                          </div>

                          <div className="bg-slate-50 border border-slate-200 p-3 rounded text-xs leading-relaxed text-slate-600">
                            <strong>AI Rationale:</strong> {grading.rationale}
                          </div>

                          {/* Rubric metrics display if provided */}
                          {grading.rubricBreakdown && Object.keys(grading.rubricBreakdown).length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[9px] font-bold text-slate-400 font-mono uppercase block tracking-wider">Rubric breakdowns</span>
                              <div className="border border-slate-200 rounded divide-y divide-slate-100 overflow-hidden">
                                {Object.keys(grading.rubricBreakdown).map((catName) => (
                                  <div key={catName} className="p-2 text-[10px] bg-white text-slate-600 flex justify-between items-center">
                                    <span className="font-semibold">{catName}:</span>
                                    <span className="font-bold text-slate-850 font-mono">{grading.rubricBreakdown[catName].score} pts</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Teacher Manual override controls */}
                    <div className="border-t border-slate-200 pt-4 space-y-3">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#0A192F] shrink-0" /> Apply Score Amendment
                      </span>

                      <div className="flex items-center gap-3">
                        <div className="w-1/3">
                          <label className="text-[9px] font-mono font-bold uppercase text-slate-450 block mb-1">Score Override</label>
                          <input 
                            type="number"
                            value={overrideScores[res.id] !== undefined ? overrideScores[res.id] : (override?.score ?? grading.score ?? 0)}
                            onChange={(e) => setOverrideScores({ ...overrideScores, [res.id]: Number(e.target.value) })}
                            className="w-full text-xs font-mono font-bold text-center bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none focus:border-slate-400 transition"
                          />
                        </div>
                        <div className="w-2/3">
                          <label className="text-[9px] font-mono font-bold uppercase text-slate-450 block mb-1">Feedback Notes</label>
                          <input 
                            type="text"
                            placeholder="Reason for change..."
                            value={overrideNotes[res.id] !== undefined ? overrideNotes[res.id] : (override?.notes ?? "")}
                            onChange={(e) => setOverrideNotes({ ...overrideNotes, [res.id]: e.target.value })}
                            className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none focus:border-slate-400 transition"
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => handleSave(res.id, override?.score ?? grading.score ?? 0)}
                        disabled={savingState[res.id]}
                        className="w-full bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-300 text-white text-[10px] font-bold uppercase py-2.5 rounded transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm tracking-wider"
                      >
                        {savingState[res.id] ? "Synchronizing..." : "Submit Amendment"}
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
    </div>
  );
}

import { AlertTriangle, ShieldCheck, X, Clock, Video, BookOpen, AlertCircle, Copy, CheckCircle } from "lucide-react";

interface StudentDossierModalProps {
  studentId: string;
  lessonId: string;
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
  onClose: () => void;
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
}

export default function StudentDossierModal({ studentId, lessonId, students, attempts, responses, signals, lessons, blocks, onClose, onOverrideSave }: StudentDossierModalProps) {
  const student = students.find((s) => s.id === studentId);
  const lesson = lessons.find((l) => l.id === lessonId);
  const attempt = attempts.find((a) => a.studentId === studentId && a.lessonId === lessonId);

  if (!student || !lesson || !attempt) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white border text-slate-800 border-slate-200 rounded p-6 max-w-sm text-center shadow-lg">
          <p className="text-sm font-semibold text-slate-600">No active attempts recorded for this student.</p>
          <button onClick={onClose} className="mt-4 bg-[#0A192F] hover:bg-[#15294b] text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider">Close Portal</button>
        </div>
      </div>
    );
  }

  // Filter signals and responses associated with this attempt
  const sSignals = signals.filter((s) => s.attemptId === attempt.id);
  const sResponses = responses.filter((r) => r.attemptId === attempt.id);
  const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id);

  return (
    <div className="fixed inset-0 bg-[#000]/45 backdrop-blur-xs flex items-center justify-center p-4 z-50 font-sans">
      <div className="bg-white border border-slate-200 text-slate-800 shadow-xl rounded w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              Student Dossier: {student.name}
            </h3>
            <span className="text-xs text-slate-400 font-mono tracking-tight">{student.email} • ID: {student.id.toUpperCase()}</span>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scroller body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50">
          
          {/* Section 1: Progress stats banner */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded shadow-sm">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block mb-1">Status</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${attempt.status === "completed" ? "text-green-800 bg-green-50" : "text-blue-800 bg-blue-50"}`}>
                {attempt.status === "completed" ? "Completed" : "In Progress"}
              </span>
            </div>
            
            <div className="bg-white border border-slate-200 p-4 rounded shadow-sm">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block mb-1">Time Profile</span>
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {Math.floor(attempt.activeTimeSpent / 60)}m {attempt.activeTimeSpent % 60}s active
              </span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded shadow-sm">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block mb-1">Unfocused Time</span>
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 font-mono">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                {Math.floor(attempt.inactiveTimeSpent / 60)}m {attempt.inactiveTimeSpent % 60}s
              </span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded shadow-sm">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block mb-1">Video Milestones</span>
              <span className="text-xs font-bold text-slate-700 font-mono">
                {Object.keys(attempt.furthestVideoTimestamps).map(k => `${attempt.furthestVideoTimestamps[k]}s (Max)`).join(", ") || "No Watch records"}
              </span>
            </div>
          </div>

          {/* Section 2: Integrity Signals list */}
          <div className="bg-white border border-slate-200 p-5 rounded shadow-sm">
            <h4 className="text-xs font-bold text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-2 uppercase tracking-wide">
              <AlertTriangle className="w-4 h-4 text-amber-600" /> Focus &amp; Activity Log
            </h4>

            {sSignals.length === 0 ? (
              <div className="py-4 text-xs font-medium text-emerald-800 bg-emerald-50 rounded px-4 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                <span>No review flags recorded for this attempt.</span>
              </div>
            ) : (
              <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-48 overflow-y-auto pr-1">
                {sSignals.map((signal) => (
                  <div key={signal.id} className="p-3 text-xs flex justify-between items-start gap-4 hover:bg-slate-50 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[8px] uppercase font-mono font-bold px-1.5 py-0.2 rounded-sm tracking-wider ${
                          signal.severity === "high" ? "bg-red-50 text-red-700 border border-red-100":"bg-amber-50 text-amber-700 border border-amber-100"
                        }`}>
                          {signal.eventType.replace("_", " ")}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono font-medium">{new Date(signal.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-slate-700 font-sans">{signal.metadata?.message || `Alert logged inside block: ${signal.blockId}`}</p>
                    </div>
                    {signal.videoTimestamp && (
                      <span className="text-[9px] font-mono bg-slate-100 px-2 py-0.5 rounded-sm text-slate-500 font-bold uppercase tracking-wider">
                        Video: {signal.videoTimestamp}s
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Submissions timeline & review */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2 uppercase tracking-wide">
              <BookOpen className="w-4 h-4 text-[#01427a]" /> Responses & Submissions Log
            </h4>

            <div className="space-y-4">
              {lessonBlocks.map((block) => {
                const bResponse = sResponses.find((r) => r.blockId === block.id && !r.checkpointId);
                const isQuestionFile = block.type === "question";
                const checkResponses = sResponses.filter((r) => r.blockId === block.id && r.checkpointId);

                return (
                  <div key={block.id} className="bg-white border border-slate-200 p-5 rounded shadow-sm space-y-3">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        {block.type === "video" ? <Video className="w-3.5 h-3.5 text-slate-400" /> : <BookOpen className="w-3.5 h-3.5 text-slate-400" />}
                        {block.title}
                      </div>
                      <span className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-widest">Block Order: {block.order}</span>
                    </div>

                    {/* Standard question block rendering */}
                    {isQuestionFile && (
                      <div className="text-xs space-y-2">
                        <p className="font-serif leading-relaxed text-slate-700 italic">"{block.singleQuestion?.stem || block.questionPool?.description}"</p>
                        {bResponse ? (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                            <span className="text-[9px] font-bold font-mono uppercase text-slate-400 block mb-1 tracking-wider">Submitted Answer</span>
                            <p className="font-bold text-slate-800">
                              {bResponse.type === "mc" ? `Selected: ${bResponse.responseText || bResponse.responseValue}` : bResponse.responseValue}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              {bResponse.type === "mc" ? (
                                <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-sm border ${bResponse.isCorrect ? "bg-emerald-50 text-emerald-800 border-emerald-100":"bg-red-50 text-red-800 border-red-100"}`}>
                                  {bResponse.isCorrect ? "CORRECT" : "WRONG"} — {bResponse.score} point(s)
                                </span>
                              ) : (
                                <div className="space-y-1 mt-1 text-[11px] text-slate-600">
                                  <strong>AI Summary:</strong> {bResponse.aiGrading?.rationale}
                                  <div className="font-bold text-[#0A192F] font-mono mt-1">FINAL SCORE REGISTERED: {bResponse.score}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-400 italic">No response submission found for this assessed item.</div>
                        )}
                      </div>
                    )}

                    {/* Checkpoints embedded responses within video block */}
                    {block.type === "video" && block.videoCheckpoints && block.videoCheckpoints.length > 0 && (
                      <div className="space-y-3">
                        {block.videoCheckpoints.map((cp: any) => {
                          const cpResp = checkResponses.filter((r) => r.checkpointId === cp.id);

                          return (
                            <div key={cp.id} className="border border-slate-200/80 rounded p-3 bg-slate-50 text-xs space-y-2">
                              <div className="flex justify-between items-center text-[10px] bg-slate-100 p-1.5 border border-slate-200 rounded-sm">
                                <span className="font-bold text-slate-700">{cp.title}</span>
                                <span className="text-slate-500 font-mono font-medium">Timestamp Trigger: {cp.timestamp}s</span>
                              </div>
                              
                              {cpResp.length === 0 ? (
                                <span className="text-slate-400 italic block">Timestamp checkpoint not encountered or skipped by pupil.</span>
                              ) : (
                                cpResp.map((cr) => (
                                  <div key={cr.id} className="p-2.5 bg-white border border-slate-200 rounded mt-2">
                                    <p className="font-bold text-slate-800">
                                      {cr.type === "mc" ? `Selected: ${cr.responseText || cr.responseValue}` : `Written Essay: ${cr.responseValue}`}
                                    </p>
                                    <div className="mt-2 text-[9px] text-slate-500 font-mono flex items-center gap-2 font-bold">
                                      {cr.type === "mc" ? (
                                        <span className={`px-2 py-0.5 rounded-sm font-bold border ${cr.isCorrect ? 'bg-emerald-50 text-emerald-800 border-emerald-100':'bg-red-50 text-red-800 border-red-100'}`}>
                                          {cr.isCorrect ? "AUTO-GRADER: CORRECT" : "AUTO-GRADER: INCORRECT"}
                                        </span>
                                      ) : (
                                        <span className="bg-blue-50 text-blue-800 px-2 py-0.5 border border-blue-100 rounded-sm font-bold uppercase tracking-wider">
                                          AI Rubric Graded
                                        </span>
                                      )}
                                      <span className="font-bold text-slate-700">Earned score: {cr.score}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

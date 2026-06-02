import { useState } from "react";
import { CheckSquare, HelpCircle, Minus, AlertCircle, Search, X } from "lucide-react";
import { motion } from "motion/react";

interface GradebookProps {
  students: any[];
  lessons: any[];
  attempts: any[];
  responses: any[];
  blocks?: any[];
  assignments?: any[];
  gradebookEntries?: any[];
  idToken?: string | null;
  onRefresh?: () => void;
}

export default function Gradebook({
  students,
  lessons,
  attempts,
  responses,
  blocks = [],
  assignments = [],
  gradebookEntries = [],
  idToken = null,
  onRefresh
}: GradebookProps) {
  const [showPreviewAttempts, setShowPreviewAttempts] = useState<boolean>(false);
  const [updatingCell, setUpdatingCell] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Append a mock student representing preview attempts if toggled and available
  let displayStudents = [...students];
  const hasPreviewAttempt = attempts.some((a) => a.isPreviewAttempt);
  if (showPreviewAttempts && hasPreviewAttempt) {
    const previewStudentIds = Array.from(new Set(attempts.filter((a) => a.isPreviewAttempt).map((a) => a.studentId)));
    previewStudentIds.forEach((pId) => {
      if (!displayStudents.some((s) => s.id === pId)) {
        displayStudents.push({
          id: pId,
          name: "Teacher Preview Student",
          email: "teacher-preview@veritas.placeholder",
          role: "student",
          isPreview: true
        });
      }
    });
  }

  // Filter displayStudents by search query on name or email (case insensitive)
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    displayStudents = displayStudents.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q)
    );
  }

  // Filter attempts and responses based on whether we should include preview/test data
  const filteredAttempts = showPreviewAttempts
    ? attempts
    : attempts.filter((a) => !a.isPreviewAttempt);

  const filteredResponses = showPreviewAttempts
    ? responses
    : responses.filter((r) => {
        const att = attempts.find((a) => a.id === r.attemptId);
        return att ? !att.isPreviewAttempt : true;
      });

  // Calculate max graded points for a lesson from its blocks
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

  // Status/cell resolution helper used by BOTH UI and CSV Export
  const resolveCellStatus = (studentId: string, lessonId: string) => {
    const attempt = filteredAttempts.find((a) => a.studentId === studentId && a.lessonId === lessonId);
    const sResponses = filteredResponses.filter((r) => r.attemptId === (attempt?.id || ""));

    // Find the assignment associated with this lesson to verify past-due (deadlines)
    const asg = (assignments || []).find((a: any) => a.lessonId === lessonId);
    const isPastDue = asg?.dueAt && new Date(asg.dueAt) < new Date();

    // Look up durable GradebookEntry from backend
    const entry = asg
      ? (gradebookEntries || []).find((ge: any) => ge.assignmentId === asg.id && ge.studentId === studentId)
      : (gradebookEntries || []).find((ge: any) => ge.assignmentId === `legacy_${lessonId}` && ge.studentId === studentId);

    let score = attempt ? (attempt.score || 0) : 0;
    let maxScore = calcMaxPoints(lessonId);
    let finalStatus: "not_started" | "in_progress" | "completed" | "pending" | "missing" | "excused" = "not_started";

    if (entry) {
      score = entry.finalScore;
      maxScore = entry.maxPoints;
      if (entry.status === "needs_grading" || entry.status === "submitted") {
        finalStatus = "pending";
      } else if (entry.status === "graded") {
        finalStatus = "completed";
      } else {
        finalStatus = entry.status as any;
      }
    } else {
      // Check if there are short answer questions in this lesson and if they are pending review/AI grading
      const lessonQuestionBlocks = blocks.filter((b) => b.lessonId === lessonId && b.type === "question" && !b.isPractice);
      const hasPendingResponses = lessonQuestionBlocks.some((b) => {
        const isSA = b.questionType === "sa" || b.singleQuestion?.type === "sa" || b.questionPool?.questions?.some((q: any) => q.type === "sa");
        if (!isSA) return false;
        const resp = sResponses.find((r) => r.blockId === b.id);
        if (!resp) return false; // student didn't respond to SA yet
        const isGraded = resp.teacherOverride || (resp.aiGrading && (resp.aiGrading.status === "success" || resp.aiGrading.status === "failed"));
        return !isGraded;
      });

      // Check manual override
      const overrideStatus = attempt?.gradebookStatusOverride || null;

      if (overrideStatus && overrideStatus !== "default") {
        finalStatus = overrideStatus as any;
      } else {
        if (!attempt) {
          finalStatus = isPastDue ? "missing" : "not_started";
        } else {
          if (attempt.status === "completed") {
            finalStatus = hasPendingResponses ? "pending" : "completed";
          } else {
            // Started / in_progress
            finalStatus = isPastDue ? "missing" : (hasPendingResponses ? "pending" : "in_progress");
          }
        }
      }
    }

    return {
      attempt,
      score,
      maxScore,
      finalStatus,
      isOverridden: sResponses.some((r) => r.teacherOverride) || (entry?.teacherReviewRequired) || (attempt?.gradebookStatusOverride && attempt?.gradebookStatusOverride !== "default"),
      furthestVideo: attempt?.furthestVideoTimestamps
        ? Object.keys(attempt.furthestVideoTimestamps).map(k => `${attempt.furthestVideoTimestamps[k]}s`).join(", ")
        : "0s"
    };
  };

  // Perform API request to persist gradebookStatusOverride in Cloud Firestore & server db
  const handleStatusOverrideChange = async (studentId: string, lessonId: string, newOverride: string) => {
    if (!idToken) return;
    const cellKey = `${studentId}_${lessonId}`;
    setUpdatingCell(cellKey);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/students/${studentId}/gradebook-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ statusOverride: newOverride })
      });
      if (res.ok) {
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      console.error("Failed to persist gradebook cell status override on server:", err);
    } finally {
      setUpdatingCell(null);
    }
  };

  // Safe CSV export function that matches the visible gradebook perfectly
  const handleExportCSV = () => {
    let csvContent = "Student ID,Student Name,Email,Lesson Title,Gradebook Status,Score,Max Points,Grade Percentage,Active Time Spent (Seconds),Attempt Type\r\n";

    displayStudents.forEach((student) => {
      lessons.forEach((lesson) => {
        const { attempt, score, maxScore, finalStatus } = resolveCellStatus(student.id, lesson.id);
        if (!attempt && student.isPreview) return; // Skip preview logs with nothing started

        let statusText = "Not Started";
        let scoreText = score.toString();
        let pctText = "N/A";

        if (finalStatus === "excused") {
          statusText = "Excused";
          scoreText = "Excused";
          pctText = "Excused";
        } else if (finalStatus === "missing") {
          statusText = "Missing";
          scoreText = "0";
          pctText = "Missing";
        } else if (finalStatus === "pending") {
          statusText = "Pending / Needs Grading";
          scoreText = score.toString();
          pctText = maxScore > 0 ? `${Math.round((score / maxScore) * 100)}% (Pending)` : "N/A";
        } else if (finalStatus === "completed") {
          statusText = "Completed";
          pctText = maxScore > 0 ? `${Math.round((score / maxScore) * 100)}%` : "100%";
        } else if (finalStatus === "in_progress") {
          statusText = "In Progress";
          pctText = "In Progress";
        }

        const attemptType = attempt?.isPreviewAttempt ? "Preview/Test" : "Real Student";
        const duration = attempt?.activeTimeSpent || 0;

        csvContent += `"${student.id}","${student.name}","${student.email}","${lesson.title}","${statusText}","${scoreText}","${maxScore}","${pctText}","${duration}","${attemptType}"\r\n`;
      });
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Malvern_Prep_Veritas_Gradebook_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-slate-50 border border-slate-200 rounded p-3 shadow-sm font-sans">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 flex-1">
          {/* Roster Search Bar */}
          <div className="relative w-full sm:max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </span>
            <input
              type="text"
              placeholder="Search student name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-9 pr-8 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-inner font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPreviewAttempts}
              onChange={(e) => setShowPreviewAttempts(e.target.checked)}
              className="rounded text-blue-600 focus:ring-0 cursor-pointer w-3.5 h-3.5"
            />
            <span>Include teacher preview/test sandbox attempts</span>
          </label>
        </div>
        <button
          onClick={handleExportCSV}
          className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition shadow-sm cursor-pointer whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-sm border-collapse gradebook-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-mono text-[9px] tracking-widest">
                <th className="py-4 px-6 font-bold">Student Name / Email</th>
                {lessons.map((lesson) => (
                  <th key={lesson.id} className="py-4 px-6 font-bold min-w-[220px]">
                    {lesson.title.length > 32 ? `${lesson.title.substring(0, 32)}...` : lesson.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[#1A1A1A]">
              {displayStudents.length === 0 ? (
                <tr>
                  <td colSpan={lessons.length + 1} className="py-8 text-center text-slate-400 font-sans italic text-xs">
                    No matching student records found. Try adjusting your search query.
                  </td>
                </tr>
              ) : (
                displayStudents.map((student, idx) => (
                <motion.tr
                  key={student.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(idx * 0.04, 0.4), ease: "easeOut" }}
                  className={`hover:bg-indigo-50/40 hover:shadow-2xs transition-all duration-150 border-b border-slate-100 ${student.isPreview ? "bg-amber-50/20" : ""}`}
                >
                  <td className="py-4 px-6 border-r border-slate-100/60 font-sans">
                    <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                      {student.name}
                      {student.isPreview && (
                        <span className="bg-amber-100 text-amber-800 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider uppercase animate-pulse">
                          Preview
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {student.isPreview ? "Local Sandboxed Preview Mode" : student.email}
                    </div>
                  </td>
                  {lessons.map((lesson) => {
                    const { attempt, score, maxScore, finalStatus, isOverridden, furthestVideo } = resolveCellStatus(student.id, lesson.id);
                    const isPreview = attempt?.isPreviewAttempt || false;
                    const cellKey = `${student.id}_${lesson.id}`;
                    const isUpdating = updatingCell === cellKey;

                    return (
                      <td key={lesson.id} className={`py-4 px-6 status-cell ${isPreview ? "bg-amber-50/10" : ""}`}>
                        {/* Status presentation rendering block */}
                        {finalStatus === "excused" ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-widest text-purple-700 bg-purple-55 bg-purple-50/80 px-2 py-0.75 rounded border-2 border-purple-200 shadow-2xs">
                              <Minus className="w-3.5 h-3.5 shrink-0 stroke-[2.5]" /> Excused
                            </span>
                            <span className="text-[10px] font-mono text-purple-400 font-bold tracking-tight">(Excluded from average)</span>
                          </div>
                        ) : finalStatus === "missing" ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-widest text-rose-800 bg-rose-50/80 px-2 py-0.75 rounded border-2 border-rose-300 shadow-2xs animate-pulse">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 stroke-[2.5]" /> Missing
                            </span>
                            <span className="text-[10px] font-mono text-rose-500 font-bold tracking-tight">{score}/{maxScore} (No submission)</span>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              {finalStatus === "completed" ? (
                                <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {score}/{maxScore}
                                </span>
                              ) : finalStatus === "pending" ? (
                                <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                  <HelpCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> {score}/{maxScore}
                                </span>
                              ) : finalStatus === "in_progress" ? (
                                <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                  <HelpCircle className="w-3.5 h-3.5 text-blue-500 shrink-0" /> {score}/{maxScore}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                  <Minus className="w-3 h-3 shrink-0" /> Not Started
                                </span>
                              )}

                              {finalStatus === "completed" && maxScore > 0 && (
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded">
                                  {Math.round((score / maxScore) * 100)}%
                                </span>
                              )}
                              
                              {finalStatus === "pending" && (
                                <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded uppercase tracking-wide">
                                  Pending Grading
                                </span>
                              )}

                              {finalStatus === "in_progress" && (
                                <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 bg-blue-50 text-blue-800 rounded uppercase tracking-wide">
                                  In Progress
                                </span>
                              )}
                            </div>

                            {isOverridden && (
                              <div className="text-[7.5px] text-amber-700 font-mono font-bold uppercase tracking-widest leading-none mt-1">
                                [ Teacher Override Applied ]
                              </div>
                            )}
                          </div>
                        )}

                        {/* Interactive Status Changer dropdown menu */}
                        {idToken ? (
                          <div className="mt-2.5 relative">
                            <select
                              disabled={isUpdating}
                              value={attempt?.gradebookStatusOverride || "default"}
                              onChange={(e) => handleStatusOverrideChange(student.id, lesson.id, e.target.value)}
                              className="block w-full text-[9px] bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-700 rounded px-1.5 py-0.5 outline-none font-sans font-semibold hover:bg-slate-100 hover:border-slate-300 transition cursor-pointer disabled:opacity-50"
                            >
                              <option value="default">Status: Auto (Dynamic)</option>
                              <option value="excused">Status: Excused (Exc)</option>
                              <option value="missing">Status: Missing (Msg)</option>
                              <option value="pending">Status: Forced Pending</option>
                            </select>
                            {isUpdating && (
                              <span className="absolute right-2 top-1 w-2 h-2 rounded-full bg-slate-400 animate-ping inline-block" />
                            )}
                          </div>
                        ) : (
                          <div className="text-[8px] text-slate-400 italic mt-1.5">Configure Google Identity to override status</div>
                        )}

                        {attempt && (
                          <div className="text-[8px] font-mono text-slate-400 mt-1.5 uppercase tracking-wide leading-tight">
                            Video watch: {furthestVideo || "0s"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </motion.tr>
              )))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-sans">
                <td className="py-3 px-6 text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">
                  Class Average
                </td>
                {lessons.map((lesson) => {
                  // Filter valid completed attempts (resolved status, excluding preview accounts)
                  const checkedAttempts = displayStudents
                    .filter((s) => !s.isPreview)
                    .map((s) => resolveCellStatus(s.id, lesson.id))
                    .filter((cell) => cell.attempt && cell.finalStatus !== "excused" && cell.finalStatus !== "missing");

                  const maxScore = calcMaxPoints(lesson.id);

                  if (!checkedAttempts.length || maxScore === 0) {
                    return (
                      <td key={lesson.id} className="py-3 px-6">
                        <span className="text-[9px] text-slate-400 font-mono">—</span>
                      </td>
                    );
                  }

                  const totalClassScore = checkedAttempts.reduce((sum, cell) => sum + cell.score, 0);
                  const avgScore = Math.round(totalClassScore / checkedAttempts.length);
                  const avgPct = Math.round((avgScore / maxScore) * 100);

                  return (
                    <td key={lesson.id} className="py-3 px-6">
                      <span className="text-xs font-bold font-mono text-slate-700">{avgScore}/{maxScore}</span>
                      <span className="ml-2 text-[10px] font-mono text-slate-500">({avgPct}%)</span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

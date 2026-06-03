import { useState } from "react";
import { CheckSquare, HelpCircle, Minus, AlertCircle, Search, X, Eye, Clock, RotateCcw, ThumbsUp } from "lucide-react";
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

  // Full lifecycle status labels for teacher display
  const statusLabel = (s: string): string => {
    switch (s) {
      case "not_started":          return "Not Started";
      case "in_progress":          return "In Progress";
      case "submitted":            return "Submitted";
      case "completed":            return "Completed";
      case "pending_ai":           return "AI Pending";
      case "needs_teacher_review": return "Needs Review";
      case "reviewed":             return "Reviewed";
      case "feedback_released":    return "Feedback Released";
      case "missing":              return "Missing";
      case "excused":              return "Excused";
      case "late":                 return "Late";
      case "extended":             return "Extended";
      case "reopened":             return "Reopened";
      case "error":                return "Error";
      // legacy
      case "needs_grading":        return "Needs Grading";
      case "graded":               return "Graded";
      case "pending":              return "Pending Grading";
      default:                     return s;
    }
  };

  // Status/cell resolution helper used by BOTH UI and CSV Export
  // Primary key: assignmentId + studentId.  Falls back to lessonId for legacy records.
  const resolveCellStatus = (studentId: string, lessonId: string) => {
    const attempt = filteredAttempts.find((a) => a.studentId === studentId && a.lessonId === lessonId);
    const sResponses = filteredResponses.filter((r) => r.attemptId === (attempt?.id || ""));

    // Assignment for this lesson
    const asg = (assignments || []).find((a: any) => a.lessonId === lessonId);
    const isPastDue = asg?.dueAt && new Date(asg.dueAt) < new Date();

    // Primary: look up by assignmentId+studentId (canonical key)
    const entry = asg
      ? (gradebookEntries || []).find((ge: any) => ge.assignmentId === asg.id && ge.studentId === studentId)
      : (gradebookEntries || []).find((ge: any) => ge.assignmentId === `legacy_${lessonId}` && ge.studentId === studentId);

    let score = attempt ? (attempt.score || 0) : 0;
    let maxScore = calcMaxPoints(lessonId);
    let rawStatus: string = "not_started";

    if (entry) {
      score = entry.finalScore ?? entry.rawScore ?? score;
      maxScore = entry.maxPoints ?? maxScore;
      // Map legacy statuses to canonical
      if (entry.status === "needs_grading" || entry.status === "submitted") {
        rawStatus = "needs_teacher_review";
      } else if (entry.status === "graded") {
        rawStatus = "completed";
      } else {
        rawStatus = entry.status;
      }
    } else {
      // Derive from attempt data when no gradebook entry exists
      const lessonQuestionBlocks = blocks.filter((b) => b.lessonId === lessonId && b.type === "question" && !b.isPractice);
      const hasPendingResponses = lessonQuestionBlocks.some((b) => {
        const isSA = b.questionType === "sa" || b.singleQuestion?.type === "sa" || b.questionPool?.questions?.some((q: any) => q.type === "sa");
        if (!isSA) return false;
        const resp = sResponses.find((r) => r.blockId === b.id);
        if (!resp) return false;
        const isGraded = resp.teacherOverride || (resp.aiGrading && (resp.aiGrading.status === "success" || resp.aiGrading.status === "failed"));
        return !isGraded;
      });

      if (!attempt) {
        rawStatus = isPastDue ? "missing" : "not_started";
      } else if (attempt.status === "completed") {
        rawStatus = hasPendingResponses ? "pending_ai" : "completed";
      } else {
        rawStatus = isPastDue ? "missing" : (hasPendingResponses ? "pending_ai" : "in_progress");
      }
    }

    return {
      attempt,
      entry,
      score,
      maxScore,
      rawStatus,
      // Map to legacy finalStatus for CSV/display compat
      finalStatus: (
        rawStatus === "completed" || rawStatus === "graded" ? "completed"
        : rawStatus === "missing" ? "missing"
        : rawStatus === "excused" ? "excused"
        : rawStatus === "not_started" ? "not_started"
        : rawStatus === "in_progress" || rawStatus === "extended" || rawStatus === "reopened" ? "in_progress"
        : "pending"  // pending_ai / needs_teacher_review / needs_grading / submitted / reviewed / feedback_released
      ) as "not_started" | "in_progress" | "completed" | "pending" | "missing" | "excused",
      isOverridden: !!(sResponses.some((r) => r.teacherOverride) || entry?.teacherReviewRequired),
      feedbackReleased: !!(entry?.feedbackReleasedAt),
      furthestVideo: attempt?.furthestVideoTimestamps
        ? Object.keys(attempt.furthestVideoTimestamps).map(k => `${attempt.furthestVideoTimestamps[k]}s`).join(", ")
        : "0s",
    };
  };

  // Perform API request to persist assignment lifecycle status in server db.
  // Uses assignment-level endpoints; falls back to lesson-level for legacy cells.
  const handleStatusOverrideChange = async (studentId: string, lessonId: string, newOverride: string) => {
    if (!idToken) return;
    const cellKey = `${studentId}_${lessonId}`;
    setUpdatingCell(cellKey);
    try {
      // Find assignment for this lesson
      const asg = (assignments || []).find((a: any) => a.lessonId === lessonId);
      let url: string;
      let body: Record<string, string>;

      if (asg && newOverride !== "default") {
        // Use assignment-level endpoints for new lifecycle states
        if (newOverride === "excused") {
          url = `/api/assignments/${asg.id}/students/${studentId}/excuse`;
          body = {};
        } else if (newOverride === "missing") {
          url = `/api/assignments/${asg.id}/students/${studentId}/mark-missing`;
          body = {};
        } else if (newOverride === "extended") {
          url = `/api/assignments/${asg.id}/students/${studentId}/extend`;
          // Default 7-day extension from now
          const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          body = { extendedUntil: until };
        } else if (newOverride === "reopened") {
          url = `/api/assignments/${asg.id}/students/${studentId}/reopen`;
          body = {};
        } else {
          url = `/api/lessons/${lessonId}/students/${studentId}/gradebook-status`;
          body = { statusOverride: newOverride === "default" ? null : newOverride } as any;
        }
      } else {
        url = `/api/lessons/${lessonId}/students/${studentId}/gradebook-status`;
        body = { statusOverride: newOverride === "default" ? null : newOverride } as any;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify(body),
      });
      if (res.ok && onRefresh) onRefresh();
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
                    const { attempt, entry, score, maxScore, finalStatus, rawStatus, isOverridden, feedbackReleased, furthestVideo } = resolveCellStatus(student.id, lesson.id);
                    const isPreview = attempt?.isPreviewAttempt || false;
                    const cellKey = `${student.id}_${lesson.id}`;
                    const isUpdating = updatingCell === cellKey;

                    // Rich status badge based on full lifecycle
                    const renderStatusBadge = () => {
                      if (rawStatus === "excused") {
                        return (
                          <span className="inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-widest text-purple-700 bg-purple-50/80 px-2 py-0.5 rounded border-2 border-purple-200">
                            <Minus className="w-3.5 h-3.5 shrink-0" /> Excused
                          </span>
                        );
                      }
                      if (rawStatus === "missing") {
                        return (
                          <span className="inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-widest text-rose-800 bg-rose-50/80 px-2 py-0.5 rounded border-2 border-rose-300 animate-pulse">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" /> Missing
                          </span>
                        );
                      }
                      if (rawStatus === "completed" || rawStatus === "graded") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <CheckSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      if (rawStatus === "feedback_released") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                            <Eye className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      if (rawStatus === "pending_ai") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            <RotateCcw className="w-3.5 h-3.5 text-blue-500 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      if (rawStatus === "needs_teacher_review" || rawStatus === "needs_grading") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            <HelpCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      if (rawStatus === "reviewed") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                            <ThumbsUp className="w-3.5 h-3.5 text-teal-600 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      if (rawStatus === "in_progress" || rawStatus === "extended" || rawStatus === "reopened") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            <HelpCircle className="w-3.5 h-3.5 text-blue-500 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      if (rawStatus === "submitted") {
                        return (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                            <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {score}/{maxScore}
                          </span>
                        );
                      }
                      // not_started
                      return (
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                          <Minus className="w-3 h-3 shrink-0" /> Not Started
                        </span>
                      );
                    };

                    return (
                      <td key={lesson.id} className={`py-4 px-6 status-cell ${isPreview ? "bg-amber-50/10" : ""}`}>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {renderStatusBadge()}
                            {/* Score percentage for completed/graded */}
                            {(rawStatus === "completed" || rawStatus === "graded" || rawStatus === "feedback_released" || rawStatus === "reviewed") && maxScore > 0 && (
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded">
                                {Math.round((score / maxScore) * 100)}%
                              </span>
                            )}
                          </div>
                          {/* Secondary status label for nuanced states */}
                          {rawStatus !== "not_started" && rawStatus !== "missing" && rawStatus !== "excused" && (
                            <div className="text-[8px] font-mono text-slate-500 uppercase tracking-wide">
                              {statusLabel(rawStatus)}
                              {feedbackReleased && rawStatus !== "feedback_released" && (
                                <span className="ml-1 text-emerald-600">· Feedback Released</span>
                              )}
                            </div>
                          )}
                          {isOverridden && (
                            <div className="text-[7.5px] text-amber-700 font-mono font-bold uppercase tracking-widest leading-none">
                              [ Teacher Override Applied ]
                            </div>
                          )}
                        </div>

                        {/* Interactive Status Changer dropdown */}
                        {idToken ? (
                          <div className="mt-2.5 relative">
                            <select
                              disabled={isUpdating}
                              value={entry?.status === "excused" ? "excused" : entry?.status === "missing" ? "missing" : entry?.status === "extended" ? "extended" : entry?.status === "reopened" ? "reopened" : "default"}
                              onChange={(e) => handleStatusOverrideChange(student.id, lesson.id, e.target.value)}
                              className="block w-full text-[9px] bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-700 rounded px-1.5 py-0.5 outline-none font-sans font-semibold hover:bg-slate-100 hover:border-slate-300 transition cursor-pointer disabled:opacity-50"
                            >
                              <option value="default">Status: Auto (Calculated)</option>
                              <option value="excused">Status: Excused</option>
                              <option value="missing">Status: Missing</option>
                              <option value="extended">Status: Extended (+7d)</option>
                              <option value="reopened">Status: Reopened</option>
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

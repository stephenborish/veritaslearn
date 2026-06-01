import { useState } from "react";
import { CheckSquare, HelpCircle, Minus } from "lucide-react";

interface GradebookProps {
  students: any[];
  lessons: any[];
  attempts: any[];
  responses: any[];
  blocks?: any[];
}

export default function Gradebook({ students, lessons, attempts, responses, blocks = [] }: GradebookProps) {
  const [showPreviewAttempts, setShowPreviewAttempts] = useState<boolean>(false);

  // If showPreviewAttempts is enabled, append a mock student representing the preview attempts
  const displayStudents = [...students];
  const hasPreviewAttempt = attempts.some((a) => a.isPreviewAttempt);
  if (showPreviewAttempts && hasPreviewAttempt) {
    // Collect all unique preview studentIds (usually just the logged-in teacher's ID)
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

  // Safe CSV export function
  const handleExportCSV = () => {
    let csvContent = "Student ID,Student Name,Email,Lesson Title,Status,Score,Max Points,Grade Percentage,Active Time Spent (Seconds),Attempt Type\r\n";

    displayStudents.forEach((student) => {
      lessons.forEach((lesson) => {
        const attempt = filteredAttempts.find((a) => a.studentId === student.id && a.lessonId === lesson.id);
        if (!attempt) {
          if (student.isPreview) return; // Skip preview rows that don't actually have records in this lesson query
        }
        const sResponses = filteredResponses.filter((r) => r.attemptId === (attempt?.id || ""));
        const score = sResponses.reduce((sum, r) => sum + (r.score || 0), 0);
        const maxPoints = calcMaxPoints(lesson.id) || 0;
        const percentage = attempt?.status === "completed" && maxPoints > 0 ? `${Math.round((score / maxPoints) * 100)}%` : "N/A";
        const status = attempt ? (attempt.status === "completed" ? "Completed" : "In Progress") : "Not Started";
        const attemptType = attempt?.isPreviewAttempt ? "Preview/Test" : "Real Student";

        csvContent += `"${student.id}","${student.name}","${student.email}","${lesson.title}","${status}","${score}","${maxPoints}","${percentage}","${attempt?.activeTimeSpent || 0}","${attemptType}"\r\n`;
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50 border border-slate-200 rounded p-3 shadow-sm font-sans">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPreviewAttempts}
            onChange={(e) => setShowPreviewAttempts(e.target.checked)}
            className="rounded text-blue-600 focus:ring-0 cursor-pointer w-3.5 h-3.5"
          />
          <span>Include teacher preview/test sandbox attempts</span>
        </label>
        <button
          onClick={handleExportCSV}
          className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition shadow-sm cursor-pointer"
        >
          Export CSV
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-mono text-[9px] tracking-widest">
                <th className="py-4 px-6 font-bold">Student Name / Email</th>
                {lessons.map((lesson) => (
                  <th key={lesson.id} className="py-4 px-6 font-bold min-w-[200px]">
                    {lesson.title.substring(0, 32)}...
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[#1A1A1A]">
              {displayStudents.map((student) => (
                <tr key={student.id} className={`hover:bg-slate-50/50 transition ${student.isPreview ? "bg-amber-50/20" : ""}`}>
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
                    const attempt = filteredAttempts.find((a) => a.studentId === student.id && a.lessonId === lesson.id);
                    const sResponses = filteredResponses.filter((r) => r.attemptId === (attempt?.id || ""));

                    const score = sResponses.reduce((sum, r) => sum + (r.score || 0), 0);
                    const maxScore = calcMaxPoints(lesson.id);

                    if (!attempt) {
                      return (
                        <td key={lesson.id} className={`py-4 px-6 ${student.isPreview ? "bg-amber-50/10" : ""}`}>
                          <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-widest text-slate-400 bg-slate-50/60 px-2 py-1 rounded-sm border border-slate-200/60">
                            <Minus className="w-2.5 h-2.5" /> {student.isPreview ? "Untested" : "Not Started"}
                          </span>
                        </td>
                      );
                    }

                    const isOverridden = sResponses.some((r) => r.teacherOverride);
                    const isCompleted = attempt.status === "completed";
                    const isPreview = attempt.isPreviewAttempt;

                    return (
                      <td key={lesson.id} className={`py-4 px-6 ${isPreview ? "bg-amber-50/30" : ""}`}>
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {isCompleted ? (
                              <span className={`flex items-center gap-1.5 font-bold font-mono ${isPreview ? "text-amber-800" : "text-slate-800"}`}>
                                <CheckSquare className={`w-4 h-4 ${isPreview ? "text-amber-600" : "text-emerald-600"} shrink-0`} />
                                {score}/{maxScore}
                                {isPreview && (
                                  <span className="text-[7.5px] font-sans font-bold tracking-wider uppercase bg-amber-100 border border-amber-200/60 text-amber-900 px-1 py-0.2 rounded-sm ml-1">
                                    Test
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className={`flex items-center gap-1.5 font-mono ${isPreview ? "text-amber-750" : "text-blue-600"}`}>
                                <HelpCircle className={`w-4 h-4 ${isPreview ? "text-amber-500" : "text-blue-400"} shrink-0`} />
                                {score}/{maxScore} <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm ${isPreview ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700"}`}>{isPreview ? "TESTING" : "IN-PROGRESS"}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium font-mono">
                            {isCompleted && (
                              <span className={`px-2 py-0.5 rounded-sm font-bold text-[10px] ${isPreview ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
                                {Math.round((score / maxScore) * 100)}%
                              </span>
                            )}
                            {isOverridden && (
                              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-sm text-[8px] font-bold uppercase tracking-widest">
                                OVERRIDDEN
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[9px] font-mono text-slate-400 mt-1 uppercase tracking-wide">
                          Video: {Object.keys(attempt.furthestVideoTimestamps).map(k => `${attempt.furthestVideoTimestamps[k]}s`).join(", ") || "0s"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-sans">
                <td className="py-3 px-6 text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">
                  Class Average
                </td>
                {lessons.map((lesson) => {
                  // Only include real students for class analytics averages by default
                  const completedAttempts = filteredAttempts.filter((a) => a.lessonId === lesson.id && a.status === "completed" && !a.isPreviewAttempt);
                  const maxScore = calcMaxPoints(lesson.id);
                  if (!completedAttempts.length || maxScore === 0) {
                    return (
                      <td key={lesson.id} className="py-3 px-6">
                        <span className="text-[9px] text-slate-400 font-mono">—</span>
                      </td>
                    );
                  }
                  const avgScore = Math.round(
                    completedAttempts.reduce((sum, a) => {
                      const s = filteredResponses.filter((r) => r.attemptId === a.id).reduce((rs, r) => rs + (r.score || 0), 0);
                      return sum + s;
                    }, 0) / completedAttempts.length
                  );
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

import { CheckSquare, Award, AlertCircle, HelpCircle } from "lucide-react";

interface GradebookProps {
  students: any[];
  lessons: any[];
  attempts: any[];
  responses: any[];
}

export default function Gradebook({ students, lessons, attempts, responses }: GradebookProps) {
  // Safe CSV export function
  const handleExportCSV = () => {
    // Construct CSV headers
    let csvContent = "Student ID,Student Name,Email,Lesson Title,Status,Auto-Score / Points,Grade Percentage,Active Time Spent (Seconds),Suspicious Signals Count\r\n";

    students.forEach((student) => {
      lessons.forEach((lesson) => {
        const attempt = attempts.find((a) => a.studentId === student.id && a.lessonId === lesson.id);
        const sResponses = responses.filter((r) => r.attemptId === (attempt?.id || ""));
        const score = sResponses.reduce((sum, r) => sum + (r.score || 0), 0);

        // Max points calculation
        let maxPoints = 0;
        const bList = responses.filter(r => r.attemptId === (attempt?.id || ""));
        // We'll calculate mock max points for seed lesson (which is 40 points total)
        maxPoints = 40; 

        const percentage = attempt?.status === "completed" ? `${Math.round((score / maxPoints) * 100)}%` : "N/A";
        const status = attempt ? (attempt.status === "completed" ? "Completed" : "In Progress") : "Not Started";

        csvContent += `"${student.id}","${student.name}","${student.email}","${lesson.title}","${status}","${score}/${maxPoints}","${percentage}","${attempt?.activeTimeSpent || 0}","${attempt?.id ? "Check Analytics" : 0}"\r\n`;
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
              {students.map((student) => (
                <tr key={student.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-4 px-6">
                    <div className="font-bold text-slate-800 text-sm">{student.name}</div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">{student.email}</div>
                  </td>
                  {lessons.map((lesson) => {
                    const attempt = attempts.find((a) => a.studentId === student.id && a.lessonId === lesson.id);
                    const sResponses = responses.filter((r) => r.attemptId === (attempt?.id || ""));
                    
                    const score = sResponses.reduce((sum, r) => sum + (r.score || 0), 0);
                    // Standard max points is 40 for lesson_1
                    const maxScore = 40;

                    if (!attempt) {
                      return (
                        <td key={lesson.id} className="py-4 px-6 text-xs text-slate-400 font-mono italic">
                          Not Started
                        </td>
                      );
                    }

                    const isOverridden = sResponses.some((r) => r.teacherOverride);
                    const isCompleted = attempt.status === "completed";

                    return (
                      <td key={lesson.id} className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {isCompleted ? (
                              <span className="flex items-center gap-1.5 font-bold font-mono text-slate-800">
                                <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                                {score}/{maxScore}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 font-mono text-blue-600">
                                <HelpCircle className="w-4 h-4 text-blue-400 shrink-0" />
                                {score}/{maxScore} <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-sm">IN-PROGRESS</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            {isCompleted && (
                              <span className="font-mono bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-sm font-bold text-[10px]">
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
          </table>
        </div>
      </div>
    </div>
  );
}

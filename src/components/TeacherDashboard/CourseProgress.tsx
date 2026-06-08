import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Search,
  ShieldAlert,
  Bot,
  ClipboardCheck,
  AlertTriangle,
  CircleSlash,
  Loader2,
  GraduationCap,
} from "lucide-react";
import {
  deriveCourseProgressSummary,
  type CourseProgressSummary,
} from "../../lib/courseProgress";
import { statusColorClasses, type StudentAssignmentSummary } from "../../lib/teacherAnalytics";
import { attentionColorClasses, reliabilityLabel } from "../../lib/integritySignals";

/**
 * Course Progress — the multi-assignment overview entry point (spec section 7).
 * Built entirely from the shared `deriveCourseProgressSummary` helper so it can
 * never disagree with the Gradebook, Lesson Tracking, or Review Queue about the
 * same underlying data. Every cell / row is a drill-down into the shared Student
 * Dossier review workspace.
 */

export interface DossierOpenRequest {
  studentId: string;
  lessonId: string;
  initialSection?: string;
  initialStepId?: string;
  navEntries?: { studentId: string; lessonId: string; label?: string }[];
  navIndex?: number;
  navLabel?: string;
}

interface CourseProgressProps {
  students: any[];
  courses: any[];
  assignments: any[];
  lessons: any[];
  blocks: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  studentActivities?: any[];
  lessonVersions?: any[];
  idToken?: string | null;
  onOpenDossier: (req: DossierOpenRequest) => void;
  onOpenGradebook?: (assignmentId: string, lessonId: string) => void;
}

function CardStat({
  label,
  value,
  tone = "slate",
  icon,
}: {
  label: string;
  value: string | number;
  tone?: "slate" | "blue" | "amber" | "red" | "green";
  icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    slate: "text-slate-700",
    blue: "text-blue-700",
    amber: "text-amber-700",
    red: "text-red-700",
    green: "text-emerald-700",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3.5 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

/** A compact assignment cell in the student × assignment matrix. */
function MatrixCell({
  summary,
  onClick,
}: {
  summary: StudentAssignmentSummary;
  onClick: () => void;
}) {
  const statusColors = statusColorClasses(summary.status);
  const aiAgent = summary.integrity.aiAgentSignalCount > 0;
  const reviewLevel = summary.integrity.attentionLevel;
  const showIntegrity = reviewLevel === "moderate" || reviewLevel === "high";
  const integrityColors = attentionColorClasses(reviewLevel);

  const scoreText = summary.hasValidScore && summary.scoreMax ? `${summary.scoreEarned}/${summary.scoreMax}` : null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${summary.studentName} — ${summary.statusLabel}${scoreText ? ` (${scoreText})` : ""}`}
      className={`relative w-full h-full min-h-[44px] px-2 py-1.5 rounded-md border text-left transition cursor-pointer hover:ring-2 hover:ring-indigo-200 ${statusColors.bg} ${statusColors.border}`}
    >
      <div className={`text-[10px] font-bold leading-tight ${statusColors.text} truncate`}>{summary.statusLabel}</div>
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[10px] font-mono font-bold text-slate-600 tabular-nums">{scoreText || ""}</span>
        <span className="flex items-center gap-0.5">
          {summary.needsGrading && (
            <span title="Needs grading" className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
          {summary.feedbackNotReleasedCount > 0 && (
            <span title="Feedback not released" className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          )}
          {showIntegrity && !aiAgent && (
            <ShieldAlert className={`w-3 h-3 ${integrityColors.text}`} aria-label="Review suggested" />
          )}
          {aiAgent && <Bot className="w-3 h-3 text-rose-600" aria-label="Signals of AI Agent Use" />}
        </span>
      </div>
    </button>
  );
}

export default function CourseProgress({
  students,
  courses,
  assignments,
  lessons,
  blocks,
  attempts,
  responses,
  signals,
  studentActivities = [],
  lessonVersions = [],
  idToken,
  onOpenDossier,
  onOpenGradebook,
}: CourseProgressProps) {
  const activeCourses = useMemo(
    () => (courses || []).filter((c) => c?.status !== "archived"),
    [courses]
  );

  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  // Default to the first active course.
  useEffect(() => {
    if (!selectedCourseId && activeCourses.length > 0) {
      setSelectedCourseId(activeCourses[0].id);
    }
  }, [activeCourses, selectedCourseId]);

  // Fetch the course roster (active enrollments). Falls back gracefully.
  useEffect(() => {
    if (!selectedCourseId || !idToken) {
      setEnrollments([]);
      return;
    }
    let cancelled = false;
    setLoadingRoster(true);
    fetch(`/api/courses/${selectedCourseId}/enrollments`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then((res) => (res.ok ? res.json() : { enrollments: [] }))
      .then((data) => {
        if (!cancelled) setEnrollments(data.enrollments || []);
      })
      .catch(() => {
        if (!cancelled) setEnrollments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRoster(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCourseId, idToken]);

  const summary: CourseProgressSummary | null = useMemo(() => {
    if (!selectedCourseId) return null;
    return deriveCourseProgressSummary({
      courseId: selectedCourseId,
      enrollments,
      students,
      assignments,
      lessons,
      blocks,
      attempts,
      responses,
      signals,
      activities: studentActivities,
      lessonVersions,
    });
  }, [selectedCourseId, enrollments, students, assignments, lessons, blocks, attempts, responses, signals, studentActivities, lessonVersions]);

  const filteredRows = useMemo(() => {
    if (!summary) return [];
    const q = search.trim().toLowerCase();
    if (!q) return summary.rows;
    return summary.rows.filter(
      (r) => r.studentName.toLowerCase().includes(q) || r.studentEmail.toLowerCase().includes(q)
    );
  }, [summary, search]);

  if (activeCourses.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <CircleSlash className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-600">No active courses yet.</p>
        <p className="text-xs text-slate-400 mt-1">Create a course and assign lessons to see course progress.</p>
      </div>
    );
  }

  // Build a course-wide student nav list (for clicking a student name).
  const courseNavEntries = (summary?.rows || []).map((r) => {
    const firstAssignment = summary?.columns[0];
    return {
      studentId: r.studentId,
      lessonId: firstAssignment?.lessonId || "",
      label: r.studentName,
    };
  });

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-slate-400" />
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {activeCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.sectionName ? ` — ${c.sectionName}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students…"
            className="w-full text-sm pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        {loadingRoster && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
      </div>

      {summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <CardStat label="Students" value={summary.cards.studentsEnrolled} icon={<Users className="w-3 h-3" />} />
            <CardStat label="Assignments" value={summary.cards.activeAssignments} />
            <CardStat label="Completion" value={`${Math.round(summary.cards.completionRate * 100)}%`} tone="green" />
            <CardStat label="Not started" value={summary.cards.notStarted} />
            <CardStat label="Needs grading" value={summary.cards.needsGrading} tone="amber" icon={<ClipboardCheck className="w-3 h-3" />} />
            <CardStat label="Needs review" value={summary.cards.needsReview} tone="red" icon={<ShieldAlert className="w-3 h-3" />} />
          </div>

          {/* Course integrity headlines */}
          {summary.integrity.headlines.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold uppercase tracking-wide text-amber-800">Integrity &amp; review overview</span>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {summary.integrity.headlines.map((h, i) => (
                  <li key={i} className="text-xs font-medium text-amber-900 flex items-center gap-1.5">
                    {h.includes("AI Agent") && <Bot className="w-3 h-3 text-rose-600" />}
                    {h}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-amber-700/80 mt-1.5">
                These summaries support teacher review and preserve uncertainty — they never change a score or accuse a student.
              </p>
            </div>
          )}

          {/* Assignment matrix */}
          {summary.columns.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              No assignments in this course yet.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="sticky left-0 bg-slate-50 z-10 text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-[180px]">
                        Student
                      </th>
                      {summary.columns.map((col) => (
                        <th key={col.assignmentId} className="px-2 py-2.5 min-w-[110px]">
                          <button
                            type="button"
                            onClick={() => onOpenGradebook?.(col.assignmentId, col.lessonId)}
                            className="text-[10px] font-bold text-slate-600 hover:text-indigo-600 hover:underline cursor-pointer truncate max-w-[120px] block"
                            title={`Open Gradebook for ${col.title}`}
                          >
                            {col.title}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={summary.columns.length + 1} className="px-4 py-6 text-center text-sm text-slate-400">
                          No students match this search.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const relColors = attentionColorClasses(
                          row.reliability === "needs_review" ? "high" : row.reliability === "moderate" ? "moderate" : "none"
                        );
                        return (
                          <tr key={row.studentId} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="sticky left-0 bg-white z-10 px-4 py-2 min-w-[180px]">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenDossier({
                                    studentId: row.studentId,
                                    lessonId: courseNavEntries.find((e) => e.studentId === row.studentId)?.lessonId || "",
                                    initialSection: "summary",
                                    navEntries: courseNavEntries,
                                    navIndex: courseNavEntries.findIndex((e) => e.studentId === row.studentId),
                                    navLabel: "Course roster",
                                  })
                                }
                                className="text-left cursor-pointer group"
                              >
                                <div className="text-sm font-semibold text-slate-700 group-hover:text-indigo-600 truncate">
                                  {row.studentName}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide ${relColors.text}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${relColors.dot}`} />
                                    {reliabilityLabel(row.reliability)}
                                  </span>
                                  {row.aiAgentSignalCount > 0 && (
                                    <Bot className="w-3 h-3 text-rose-600" aria-label="Signals of AI Agent Use" />
                                  )}
                                </div>
                              </button>
                            </td>
                            {summary.columns.map((col) => {
                              const cell = row.cells[col.assignmentId];
                              if (!cell) return <td key={col.assignmentId} className="px-1.5 py-1.5" />;
                              // Per-assignment student nav list (move student-to-student, same assignment).
                              const assignmentNav = filteredRows.map((r) => ({
                                studentId: r.studentId,
                                lessonId: col.lessonId,
                                label: r.studentName,
                              }));
                              return (
                                <td key={col.assignmentId} className="px-1.5 py-1.5 align-top">
                                  <MatrixCell
                                    summary={cell}
                                    onClick={() =>
                                      onOpenDossier({
                                        studentId: row.studentId,
                                        lessonId: col.lessonId,
                                        initialSection: "responses",
                                        navEntries: assignmentNav,
                                        navIndex: assignmentNav.findIndex((e) => e.studentId === row.studentId),
                                        navLabel: col.title,
                                      })
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Needs grading</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Feedback not released</span>
            <span className="flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-amber-600" /> Review suggested</span>
            <span className="flex items-center gap-1"><Bot className="w-3 h-3 text-rose-600" /> Signals of AI Agent Use</span>
            <span className="text-slate-400">Click any cell to open the Student Dossier · click an assignment header for the detailed Gradebook</span>
          </div>
        </>
      )}
    </div>
  );
}
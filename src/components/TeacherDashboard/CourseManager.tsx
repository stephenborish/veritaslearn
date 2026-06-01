import { useState, useEffect } from "react";
import {
  Plus, Copy, RefreshCw, ToggleLeft, ToggleRight, Users, Trash2,
  BookOpen, ChevronDown, ChevronUp, CheckCircle, XCircle, Archive,
  GraduationCap, Settings
} from "lucide-react";

interface CourseManagerProps {
  idToken: string | null;
  onRefresh?: () => void;
}

export default function CourseManager({ idToken, onRefresh }: CourseManagerProps) {
  const [courses, setCourses] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<Record<string, any[]>>({});
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [newSchoolYear, setNewSchoolYear] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const authHeader: Record<string, string> = idToken ? { Authorization: `Bearer ${idToken}` } : {};

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/courses", { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setCourses(data.courses || []);
      }
    } catch (e) {
      console.error("Failed to fetch courses:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchEnrollments = async (courseId: string) => {
    try {
      const res = await fetch(`/api/courses/${courseId}/enrollments`, { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setEnrollments((prev) => ({ ...prev, [courseId]: data.enrollments || [] }));
      }
    } catch (e) {
      console.error("Failed to fetch enrollments:", e);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, [idToken]);

  useEffect(() => {
    if (expandedCourse) {
      fetchEnrollments(expandedCourse);
    }
  }, [expandedCourse]);

  const handleCreate = async () => {
    if (!newCourseName.trim()) return;
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          name: newCourseName.trim(),
          sectionName: newSectionName.trim(),
          schoolYear: newSchoolYear.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCourses((prev) => [data.course, ...prev]);
        setNewCourseName("");
        setNewSectionName("");
        setNewSchoolYear("");
        setCreating(false);
        showToast("Course created.");
        onRefresh?.();
      } else {
        showToast(data.error || "Failed to create course.", "error");
      }
    } catch (e) {
      showToast("Failed to create course.", "error");
    }
  };

  const handleRegenCode = async (courseId: string) => {
    try {
      const res = await fetch(`/api/courses/${courseId}/regenerate-code`, {
        method: "POST",
        headers: authHeader,
      });
      const data = await res.json();
      if (data.success) {
        setCourses((prev) =>
          prev.map((c) => (c.id === courseId ? { ...c, joinCode: data.joinCode, joinCodeEnabled: true } : c))
        );
        showToast("Join code regenerated.");
      }
    } catch (e) {
      showToast("Failed to regenerate code.", "error");
    }
  };

  const handleToggleCode = async (courseId: string, currentlyEnabled: boolean) => {
    try {
      const res = await fetch(`/api/courses/${courseId}/toggle-join-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      const data = await res.json();
      if (data.success) {
        setCourses((prev) =>
          prev.map((c) => (c.id === courseId ? { ...c, joinCodeEnabled: data.joinCodeEnabled } : c))
        );
        showToast(data.joinCodeEnabled ? "Join code enabled." : "Join code disabled.");
      }
    } catch (e) {
      showToast("Failed to toggle code.", "error");
    }
  };

  const handleArchive = async (courseId: string) => {
    if (!confirm("Archive this course? Students will no longer be able to join with this code.")) return;
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ status: "archived" }),
      });
      if (res.ok) {
        setCourses((prev) =>
          prev.map((c) => (c.id === courseId ? { ...c, status: "archived" } : c))
        );
        showToast("Course archived.");
        onRefresh?.();
      }
    } catch (e) {
      showToast("Failed to archive course.", "error");
    }
  };

  const handleRemoveStudent = async (courseId: string, enrollmentId: string) => {
    try {
      const res = await fetch(`/api/courses/${courseId}/enrollments/${enrollmentId}`, {
        method: "DELETE",
        headers: authHeader,
      });
      if (res.ok) {
        setEnrollments((prev) => ({
          ...prev,
          [courseId]: (prev[courseId] || []).filter((e) => e.id !== enrollmentId),
        }));
        showToast("Student removed from course.");
      }
    } catch (e) {
      showToast("Failed to remove student.", "error");
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  const activeCourses = courses.filter((c) => c.status !== "archived");
  const archivedCourses = courses.filter((c) => c.status === "archived");

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-semibold flex items-center gap-2 transition-all ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Courses & Sections</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Create courses, share join codes with students, and manage enrollment.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0A192F] hover:bg-[#15294b] text-white text-sm font-semibold rounded-lg transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Course
        </button>
      </div>

      {/* Create Course Panel */}
      {creating && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="font-bold text-slate-800 text-base">Create Course / Section</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Course Name *
              </label>
              <input
                type="text"
                placeholder="e.g., AP Biology"
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Section / Period
              </label>
              <input
                type="text"
                placeholder="e.g., Period 3"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                School Year
              </label>
              <input
                type="text"
                placeholder="e.g., 2025-2026"
                value={newSchoolYear}
                onChange={(e) => setNewSchoolYear(e.target.value)}
                className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={!newCourseName.trim()}
              className="px-5 py-2 bg-[#0A192F] hover:bg-[#15294b] text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
            >
              Create Course
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Active Courses */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-slate-100 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : activeCourses.length === 0 && !creating ? (
        <div className="border border-dashed border-slate-300 rounded-xl p-12 bg-white text-center">
          <GraduationCap className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-500">No courses yet</p>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            Create your first course to get a join code you can share with students.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-[#0A192F] text-white text-sm font-semibold rounded-lg hover:bg-[#15294b] transition cursor-pointer"
          >
            Create First Course
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {activeCourses.map((course) => (
            <div key={course.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              {/* Course Header */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-800 text-base leading-snug">{course.name}</h3>
                      {course.sectionName && (
                        <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {course.sectionName}
                        </span>
                      )}
                      {course.schoolYear && (
                        <span className="text-xs text-slate-400">{course.schoolYear}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Students can join this course using the code below with their Malvern Prep Google account.
                    </p>
                  </div>
                  <button
                    onClick={() => setExpandedCourse(expandedCourse === course.id ? null : course.id)}
                    className="shrink-0 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                  >
                    {expandedCourse === course.id ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Join Code Display */}
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border-2 ${
                      course.joinCodeEnabled
                        ? "bg-[#0A192F] border-[#0A192F] text-white"
                        : "bg-slate-100 border-slate-200 text-slate-400"
                    }`}
                  >
                    <span className="font-mono font-bold text-lg tracking-widest">
                      {course.joinCode}
                    </span>
                    {!course.joinCodeEnabled && (
                      <span className="text-xs font-semibold bg-slate-200 text-slate-500 px-2 py-0.5 rounded">
                        Disabled
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyCode(course.joinCode)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title="Copy join code"
                    >
                      {copiedCode === course.joinCode ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copiedCode === course.joinCode ? "Copied!" : "Copy"}
                    </button>

                    <button
                      onClick={() => handleRegenCode(course.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition cursor-pointer"
                      title="Generate new join code"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Regenerate
                    </button>

                    <button
                      onClick={() => handleToggleCode(course.id, course.joinCodeEnabled)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg transition cursor-pointer ${
                        course.joinCodeEnabled
                          ? "border-amber-200 text-amber-700 hover:bg-amber-50"
                          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      }`}
                      title={course.joinCodeEnabled ? "Disable join code" : "Enable join code"}
                    >
                      {course.joinCodeEnabled ? (
                        <>
                          <ToggleRight className="w-3.5 h-3.5" />
                          Disable
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="w-3.5 h-3.5" />
                          Enable
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleArchive(course.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition cursor-pointer"
                      title="Archive course"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Archive
                    </button>
                  </div>
                </div>
              </div>

              {/* Enrollment Panel */}
              {expandedCourse === course.id && (
                <div className="border-t border-slate-100 bg-slate-50 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-4 h-4 text-slate-500" />
                    <h4 className="text-sm font-bold text-slate-700">Enrolled Students</h4>
                    <span className="text-xs font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                      {(enrollments[course.id] || []).length}
                    </span>
                  </div>

                  {(enrollments[course.id] || []).length === 0 ? (
                    <p className="text-sm text-slate-400 italic">
                      No students enrolled yet. Share the join code above.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(enrollments[course.id] || []).map((enrollment: any) => (
                        <div
                          key={enrollment.id}
                          className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-700 truncate">
                              {enrollment.studentName}
                            </div>
                            <div className="text-xs text-slate-400 truncate">{enrollment.studentEmail}</div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[10px] text-slate-400">
                              Joined {new Date(enrollment.enrolledAt).toLocaleDateString()}
                            </span>
                            <button
                              onClick={() => {
                                if (confirm(`Remove ${enrollment.studentName} from this course?`)) {
                                  handleRemoveStudent(course.id, enrollment.id);
                                }
                              }}
                              className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                              title="Remove student"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Archived Courses */}
      {archivedCourses.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            Archived Courses
          </h3>
          <div className="space-y-2">
            {archivedCourses.map((course) => (
              <div
                key={course.id}
                className="bg-white border border-slate-100 rounded-xl p-4 flex items-center justify-between opacity-60"
              >
                <div>
                  <span className="font-semibold text-slate-600 text-sm">{course.name}</span>
                  {course.sectionName && (
                    <span className="text-xs text-slate-400 ml-2">{course.sectionName}</span>
                  )}
                </div>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/courses/${course.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...authHeader },
                      body: JSON.stringify({ status: "active" }),
                    });
                    if (res.ok) {
                      setCourses((prev) =>
                        prev.map((c) => (c.id === course.id ? { ...c, status: "active" } : c))
                      );
                      showToast("Course restored.");
                    }
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition cursor-pointer"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

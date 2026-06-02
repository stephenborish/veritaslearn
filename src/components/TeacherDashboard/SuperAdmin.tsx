import { useState, useEffect, FormEvent } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Shield,
  Search,
  UserCheck,
  Mail,
  Calendar,
  AlertTriangle
} from "lucide-react";

interface SuperAdminProps {
  idToken: string | null;
}

interface ApprovedTeacher {
  email: string;
  addedBy: string;
  addedAt: string;
}

export default function SuperAdmin({ idToken }: SuperAdminProps) {
  const [teachers, setTeachers] = useState<ApprovedTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [errorStr, setErrorStr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [teacherToDelete, setTeacherToDelete] = useState<ApprovedTeacher | null>(null);

  const authHeader = idToken ? { Authorization: `Bearer ${idToken}` } : {};

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchTeachers = async () => {
    setLoading(true);
    setErrorStr(null);
    try {
      const res = await fetch("/api/admin/teachers", { headers: authHeader });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to retrieve approved teachers list.");
      }
      const data = await res.json();
      setTeachers(data.approvedTeachers || []);
    } catch (err: any) {
      console.error(err);
      setErrorStr(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddTeacher = async (e: FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    const emailToSubmit = newEmail.trim().toLowerCase();
    if (!emailToSubmit.includes("@")) {
      showToast("Please enter a valid email address.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        },
        body: JSON.stringify({ email: emailToSubmit })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add teacher to the roster.");
      }

      showToast(`Successfully added ${emailToSubmit} to the Dynamic Teacher Roster!`, "success");
      setNewEmail("");
      fetchTeachers();
    } catch (err: any) {
      showToast(err.message || "Failed to add teacher.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTeacher = async (email: string) => {
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        },
        body: JSON.stringify({ email })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove teacher from the roster.");
      }

      showToast(`Successfully removed teacher access for ${email}.`, "success");
      setTeacherToDelete(null);
      fetchTeachers();
    } catch (err: any) {
      showToast(err.message || "Failed to remove teacher.", "error");
    }
  };

  useEffect(() => {
    fetchTeachers();
  }, [idToken]);

  const filteredTeachers = teachers.filter((t) =>
    t.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div id="super-admin-layout" className="space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {toast && (
        <div
          id="admin-toast"
          className={`fixed top-5 right-5 z-50 p-4 rounded-xl shadow-lg border transition-all duration-300 max-w-md animate-in fade-in slide-in-from-top-4 flex items-start gap-3 ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="w-5 h-5 shrink-0 text-emerald-650" />
          ) : (
            <XCircle className="w-5 h-5 shrink-0 text-rose-600" />
          )}
          <span className="text-sm font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Header Panel */}
      <div className="bg-[#0A192F] text-white rounded-2xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="bg-[#E5B53B] text-[#0A192F] text-xs font-black px-2.5 py-1 rounded-sm uppercase tracking-widest font-mono">
              Super Admin Mode
            </span>
            <span className="text-white/60 text-xs font-semibold">MALVERN PREP</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Teacher Roster Control Room</h1>
          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
            Authorize dynamic academic accounts with verified teacher privileges. Changes take effect instantly and persist durably in Cloud Firestore databases.
          </p>
        </div>
        <button
          onClick={fetchTeachers}
          disabled={loading}
          className="flex items-center gap-2 hover:bg-white/10 text-white font-semibold text-xs px-4 py-2.5 rounded-lg border border-white/20 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh List
        </button>
      </div>

      {/* Core Setup Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form to Authorize a New Teacher */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4 mb-4">
              <Shield className="w-5 h-5 text-[#E5B53B] shrink-0" />
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider font-mono">
                Authorize Faculty
              </h2>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Enter the teacher's verified email address to upgrade them dynamically. Once added, they gain access to core lesson builders, grading, audio/video upload, student roster progress logs, and AI evaluation metrics.
            </p>

            <form onSubmit={handleAddTeacher} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-500 block">
                  Teacher Google Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="e.g. jdoe@malvernprep.org"
                    disabled={submitting}
                    className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-slate-400 leading-relaxed"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !newEmail.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#0A192F] hover:bg-[#15294b] disabled:opacity-50 text-white font-semibold text-sm py-3 px-4 rounded-xl transition cursor-pointer"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Grant Teacher Access
              </button>
            </form>
          </div>

          <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-900">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-bold">Important Notice</p>
              <p className="leading-relaxed font-semibold opacity-90">
                Teachers listed in the `TEACHER_EMAILS` environment variables have native access automatically and do not need to be manually added.
              </p>
            </div>
          </div>
        </div>

        {/* List of Dynamic Approved Teachers */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs lg:col-span-2 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 mb-4 gap-4">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-5 h-5 text-indigo-600 shrink-0" />
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider font-mono">
                Active Dynamic Teacher Roster
              </h2>
            </div>

            {/* Filter */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by email..."
                className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:font-normal"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-xs font-black uppercase tracking-widest font-mono text-slate-400">
                Retrieving active authorizations...
              </p>
            </div>
          ) : errorStr ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
              <XCircle className="w-10 h-10 text-rose-500 mb-3" />
              <p className="text-sm font-semibold text-slate-700">{errorStr}</p>
              <button
                onClick={fetchTeachers}
                className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
              >
                Try reloading roster list
              </button>
            </div>
          ) : filteredTeachers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-slate-400">
              <Mail className="w-10 h-10 mb-3 text-slate-305" />
              <p className="text-sm font-semibold">No Dynamic Teachers Authenticated</p>
              <p className="text-xs mt-1">
                {searchQuery ? "No matches found for that query." : "Use the tool to authorize teacher credentials dynamically."}
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto">
              <table id="dynamic-teachers-table" className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider font-mono text-slate-450">
                    <th className="py-3 px-4">Authorized Faculty</th>
                    <th className="py-3 px-4">Granted By</th>
                    <th className="py-3 px-4">Granted At</th>
                    <th className="py-3 px-4 text-right">Revoke Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTeachers.map((teacher, index) => (
                    <tr
                      key={`${teacher.email}-${index}`}
                      className="hover:bg-slate-50 text-sm transition-colors duration-150 text-slate-700"
                    >
                      <td className="py-3.5 px-4 font-semibold text-slate-800 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-xs uppercase tracking-tight text-indigo-600 shrink-0">
                          {teacher.email[0]}
                        </div>
                        <span className="font-mono text-xs">{teacher.email}</span>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-bold text-slate-500">
                        {teacher.addedBy}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-450">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          {new Date(teacher.addedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric"
                          })}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setTeacherToDelete(teacher)}
                          className="p-1.5 text-rose-500 hover:text-white hover:bg-rose-500 rounded-lg shrink-0 transition-all duration-100 cursor-pointer inline-flex items-center"
                          title="Revoke access"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete/Revoke Access Modal */}
      {teacherToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-xl p-6 md:p-8 shrink-0 space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-rose-50 border border-rose-100 rounded-full flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900">Revoke Faculty Access?</h3>
                <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                  Are you sure you want to remove teacher access for{" "}
                  <code className="bg-slate-100 text-[#000000] px-1 py-0.5 rounded font-bold font-mono text-xs">
                    {teacherToDelete.email}
                  </code>
                  ? This account will return to student privileges instantly.
                </p>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setTeacherToDelete(null)}
                className="px-4 py-2 text-sm font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteTeacher(teacherToDelete.email)}
                className="px-4 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-750 text-white rounded-lg transition cursor-pointer"
              >
                Revoke Credentials
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

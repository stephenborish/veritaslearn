import { useState, useEffect } from "react";
import LandingPage, { PENDING_COURSE_CODE_KEY } from "./components/Auth/LandingPage";
import LiveMonitor from "./components/TeacherDashboard/LiveMonitor";
import LessonsBuilder from "./components/TeacherDashboard/LessonsBuilder";
import Gradebook from "./components/TeacherDashboard/Gradebook";
import AIReview from "./components/TeacherDashboard/AIReview";
import CourseManager from "./components/TeacherDashboard/CourseManager";
import StudentDossierModal from "./components/TeacherDashboard/StudentDossierModal";
import PracticeDashboard from "./components/StudentPortal/PracticeDashboard";
import FocusedPlayer from "./components/StudentPortal/FocusedPlayer";
import SuperAdmin from "./components/TeacherDashboard/SuperAdmin";
import {
  LessonsBuilderSkeleton,
  GradebookSkeleton,
  AIReviewSkeleton
} from "./components/TeacherDashboard/SkeletonScreens";
import { auth, onAuthStateChanged, signOut } from "./lib/firebase";

import {
  GraduationCap,
  Settings,
  Award,
  LogOut,
  BookOpen,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Menu,
  Activity,
  CheckSquare,
  Users,
  Shield
} from "lucide-react";
import { motion } from "motion/react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  // Curriculum data structures
  const [lessons, setLessons] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [responses, setResponses] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [gradebookEntries, setGradebookEntries] = useState<any[]>([]);
  const [gradebookResponseEntries, setGradebookResponseEntries] = useState<any[]>([]);

  // Selection states
  const [activeTab, setActiveTab] = useState<"live" | "builder" | "courses" | "gradebook" | "ai" | "admin">("live");
  const [activeDossier, setActiveDossier] = useState<{ studentId: string; lessonId: string } | null>(null);
  const [activeStudentAttempt, setActiveStudentAttempt] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [joinFeedback, setJoinFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Listen to Firebase Auth state change dynamically (Durable Auth Persistence)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          const response = await fetch("/api/auth/me", {
            headers: { "Authorization": `Bearer ${token}` }
          });
          const ct = response.headers.get("content-type");
          if (!ct || !ct.includes("application/json")) {
            console.warn("VERITAS Learn - Authentication service is warming up. Retrying...");
            return;
          }
          const data = await response.json();
          if (data.loggedIn) {
            setCurrentUser(data.user);
            setIdToken(token);
            fetchLmsPayload(data.user, token);
          } else {
            console.error("Access forbidden: School domain restriction enforced.");
            setCurrentUser(null);
            setIdToken(null);
            await signOut(auth);
          }
        } catch (e) {
          console.error("Failed to authenticate session:", e);
          setCurrentUser(null);
          setIdToken(null);
        }
      } else {
        setCurrentUser(null);
        setIdToken(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Retrieves a validated, self-refreshing ID Token dynamically
  const getFreshToken = async (forceRefresh = false) => {
    if (!auth.currentUser) return idToken;
    try {
      const token = await auth.currentUser.getIdToken(forceRefresh);
      if (token && token !== idToken) {
        setIdToken(token);
      }
      return token;
    } catch (e) {
      console.error("Failed to query fresh ID token:", e);
      return idToken;
    }
  };

  // Pull operational databases
  const fetchLmsPayload = async (user = currentUser, passedToken = idToken, forceRefresh = false) => {
    if (!user) return;
    setIsFetching(true);
    try {
      let token = passedToken;
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken(forceRefresh);
      }
      if (!token) return;
      if (token !== idToken) {
        setIdToken(token);
      }
      const authHeader = { "Authorization": `Bearer ${token}` };
      
      // Lessons & Blocks
      const lessonsRes = await fetch("/api/lessons", { headers: authHeader });
      
      // Self-healing auth check: if token reports expired, attempt live force refresh once
      if (lessonsRes.status === 401 && auth.currentUser && !forceRefresh) {
        console.warn("VERITAS Learn - ID Token expired during fetch. Initiating force refresh sequence...");
        await fetchLmsPayload(user, null, true);
        return;
      }
      
      const contentType = lessonsRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        console.warn("VERITAS Learn - Server is currently booting or unreachable. Retrying sync in 3s...");
        setTimeout(() => fetchLmsPayload(user, passedToken, forceRefresh), 3000);
        return;
      }
      
      if (!lessonsRes.ok) {
        throw new Error(`Operational database fetch failed with status ${lessonsRes.status}`);
      }
      const lessonsRaw = await lessonsRes.json();
      setLessons(lessonsRaw.lessons || []);

      // Fetch Assignments - Isolated defensively to handle transient network errors
      try {
        const assignmentsRes = await fetch("/api/assignments", { headers: authHeader });
        if (assignmentsRes.ok) {
          const assignmentsRaw = await assignmentsRes.json();
          setAssignments(assignmentsRaw.assignments || []);
        }
      } catch (err) {
        console.warn("VERITAS Learn - Failed to fetch assignments:", err);
      }

      // If teacher: Full class analytics payload
      if (user.role === "teacher") {
        try {
          const analyticsRes = await fetch("/api/analytics", { headers: authHeader });
          if (analyticsRes.ok) {
            const analyticsRaw = await analyticsRes.json();
            setStudents(analyticsRaw.students || []);
            setAttempts(analyticsRaw.attempts || []);
            setResponses(analyticsRaw.responses || []);
            setSignals(analyticsRaw.signals || []);
            setGradebookEntries(analyticsRaw.gradebookEntries || []);
            setGradebookResponseEntries(analyticsRaw.gradebookResponseEntries || []);
          } else {
            console.warn(`VERITAS Learn - Analytics fetch returned non-ok status: ${analyticsRes.status}`);
          }
        } catch (analyticsErr) {
          console.warn("VERITAS Learn - Failed to fetch full student analytics payload:", analyticsErr);
        }

        // Fetch teacher's courses - Isolated defensively
        try {
          const coursesRes = await fetch("/api/courses", { headers: authHeader });
          if (coursesRes.ok) {
            const coursesRaw = await coursesRes.json();
            setCourses(coursesRaw.courses || []);
          }
        } catch (coursesErr) {
          console.warn("VERITAS Learn - Failed to fetch teacher courses:", coursesErr);
        }

        // Recover all lesson blocks in parallel to maximize performance and resiliency.
        // Wrap in Promise.allSettled to ensure that a transient/slow query or a missing/invalid lesson 
        // does not throw and interrupt the payload generation, which would disable the entire dashboard.
        const lessonItems = lessonsRaw.lessons || [];
        const blockPromises = lessonItems.map(async (lesson: any) => {
          if (!lesson?.id) return [];
          try {
            const blocksRes = await fetch(`/api/lessons/${lesson.id}`, { headers: authHeader });
            if (blocksRes.ok) {
              const blocksRaw = await blocksRes.json();
              return blocksRaw.blocks || [];
            }
          } catch (blocksErr) {
            console.warn(`VERITAS Learn - Failed to load blocks for lesson ${lesson.id || "unknown"}:`, blocksErr);
          }
          return [];
        });

        const blocksResults = await Promise.allSettled(blockPromises);
        const allBlocks: any[] = [];
        blocksResults.forEach((result) => {
          if (result.status === "fulfilled") {
            allBlocks.push(...result.value);
          }
        });
        setBlocks(allBlocks);
      } else {
        // Students: fetch existing attempts — do NOT create them here.
        // Attempts are only created when the student intentionally clicks "Begin/Resume".
        try {
          const attemptsRes = await fetch("/api/attempts", { headers: authHeader });
          if (attemptsRes.ok) {
            const attemptsRaw = await attemptsRes.json();
            setAttempts(attemptsRaw.attempts || []);
          }
        } catch (attemptsErr) {
          console.warn("VERITAS Learn - Failed to fetch student attempts:", attemptsErr);
        }
      }
    } catch (error) {
      console.error("Payload extraction failed:", error);
      console.warn("VERITAS Learn - Fetch encounter or platform start delay. Rescheduling payload sync in 3s...");
      // Retrying in 3 seconds to recover gracefully once the port is active
      setTimeout(() => {
        fetchLmsPayload(user, passedToken, forceRefresh);
      }, 3000);
    } finally {
      setIsFetching(false);
    }
  };

  const [isAuthoringDirty, setIsAuthoringDirty] = useState(false);

  // Periodic background refresh for teacher dashboard (every 60 seconds, async-first)
  useEffect(() => {
    if (!currentUser || currentUser.role !== "teacher" || !idToken) return;
    const interval = setInterval(() => {
      if (isAuthoringDirty) {
        console.log("VERITAS Learn - Suppressing background refresh because lesson editor has unsaved changes.");
        return;
      }
      fetchLmsPayload(currentUser, null);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentUser, idToken, isAuthoringDirty]);

  const handleLogin = async (user: any) => {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      setCurrentUser(user);
      setIdToken(token);
      fetchLmsPayload(user, token);

      // After student login, check for a pending course code stored before auth flow
      if (user.role === "student") {
        const pendingCode = sessionStorage.getItem(PENDING_COURSE_CODE_KEY);
        if (pendingCode) {
          sessionStorage.removeItem(PENDING_COURSE_CODE_KEY);
          try {
            const res = await fetch("/api/enrollments/join", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
              },
              body: JSON.stringify({ joinCode: pendingCode }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              const name = [data.courseName, data.sectionName].filter(Boolean).join(" — ");
              setJoinFeedback({
                type: "success",
                message: `Successfully joined ${name || "your new course"}.`
              });
              // Refresh to reflect new enrollment in the student dashboard
              fetchLmsPayload(user, token);
            } else {
              let errMsg = "Course code join failed. Please check the code or contact your teacher.";
              if (data.code === "ALREADY_ENROLLED") errMsg = "You are already enrolled in this course.";
              else if (data.code === "DOMAIN_MISMATCH") errMsg = "Please use your Malvern Prep Google account to join.";
              else if (data.code === "INVALID_CODE") errMsg = "Course code was not found. Please verify it.";
              else if (data.code === "CODE_DISABLED") errMsg = "This course join code is disabled.";
              
              setJoinFeedback({
                type: "error",
                message: errMsg
              });
              console.warn("VERITAS Learn - Course code join failed:", data.error || res.status);
            }
          } catch (e) {
            setJoinFeedback({
              type: "error",
              message: "Network error trying to join course automatically. Please join manually."
            });
            console.warn("VERITAS Learn - Course code join request failed:", e);
          }
        }
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setIdToken(null);
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  // Saving edited / created Lesson Curriculum
  const handleSaveLessonCurriculum = async (payload: any) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      const url = payload.id ? `/api/lessons/${payload.id}` : "/api/lessons";
      const method = payload.id ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Save failed (${res.status})`);
      }
      // Background refresh (non-blocking) to keep the library list current
      fetchLmsPayload(currentUser, token);
      // Return canonical shape: { ...lessonFields, blocks: [] }
      // LessonsBuilder uses .id, .blocks, .isPublished, .settings, etc.
      return {
        ...data.lesson,
        blocks: data.blocks || []
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  // Archiving / Deletions of Lessons
  const handleArchiveLesson = async (id: string) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      await fetch(`/api/lessons/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      fetchLmsPayload(currentUser, token);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveAssignment = async (payload: any) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        fetchLmsPayload(currentUser, token);
      }
    } catch (e) {
      console.error("Failed to save assignment:", e);
    }
  };

  const handleDeleteAssignment = async (id: string) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/assignments/${id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLmsPayload(currentUser, token);
      }
    } catch (e) {
      console.error("Failed to delete assignment:", e);
    }
  };

  // Teacher: unlock a student's locked attempt
  const handleUnlockStudent = async (attemptId: string) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      await fetch(`/api/attempts/${attemptId}/unlock`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      fetchLmsPayload(currentUser, token);
    } catch (e) {
      console.error(e);
    }
  };

  // Set Manual Override overrides
  const handleOverrideScore = async (responseId: string, score: number, notes: string) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      await fetch(`/api/responses/${responseId}/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ score, notes })
      });
      fetchLmsPayload(currentUser, token);
    } catch (e) {
      console.error(e);
    }
  };

  // Launch Focus player — pass assignmentId so the server can verify eligibility
  // and tie the attempt to the correct assignment record.
  const handleLaunchStudentPlayer = async (lessonId: string, assignmentId?: string) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      const authHeader = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      };

      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({ lessonId, assignmentId })
      });
      const data = await res.json();

      if (data.attempt) {
        setActiveStudentAttempt(data.attempt.id);
      } else if (data.error) {
        console.error("Failed to start attempt:", data.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Launch Teacher Preview player
  const handleLaunchPreviewAttempt = async (lessonId: string) => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      const authHeader = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      };
      
      const res = await fetch(`/api/teacher/lessons/${lessonId}/preview-attempt`, {
        method: "POST",
        headers: authHeader
      });
      const data = await res.json();
      
      if (data.attempt) {
        setActiveStudentAttempt(data.attempt.id);
      }
    } catch (e) {
      console.error("Failed to launch preview attempt:", e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] text-slate-900 flex flex-col items-center justify-center font-sans">
        <RefreshSpinner />
      </div>
    );
  }

  if (!currentUser) {
    return <LandingPage onLoginSuccess={handleLogin} />;
  }

  // STUDENT RUNTIME PORTAL PATH
  if (currentUser.role === "student") {
    if (activeStudentAttempt) {
      return (
        <FocusedPlayer 
          attemptId={activeStudentAttempt}
          user={currentUser}
          onExit={() => {
            setActiveStudentAttempt(null);
            fetchLmsPayload(currentUser);
          }}
        />
      );
    }
    return (
      <div className="min-h-screen bg-[#F4F5F7] flex flex-col font-sans">
        <nav className="flex items-center justify-between px-6 py-3 bg-[#0A192F] text-white shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <img
                src="/favicon.png"
                alt="Veritas Learn Logo"
                referrerPolicy="no-referrer"
                className="w-8 h-8 object-contain rounded-sm"
              />
              <span className="text-xl font-semibold tracking-tight">VERITAS <span className="font-light opacity-80">Learn</span></span>
            </div>
            <div className="h-6 w-px bg-white/20"></div>
            <span className="text-[15px] font-semibold tracking-wide text-white/70 uppercase">MALVERN PREP</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[12px] leading-[15px] font-semibold">{currentUser.name}</span>
            </div>
            {currentUser.photoURL ? (
              <img 
                src={currentUser.photoURL} 
                alt={currentUser.name} 
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border-2 border-white/20 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-xs uppercase bg-gradient-to-tr from-blue-700 to-indigo-800 text-white shrink-0">
                {currentUser.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded transition cursor-pointer"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </nav>
        <div className="flex-1 overflow-y-auto">
          {joinFeedback && (
            <div className="max-w-7xl mx-auto px-6 pt-6">
              <div className={`p-4 rounded-lg flex items-center justify-between border shadow-sm ${
                joinFeedback.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-red-50 text-red-800 border-red-200"
              }`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${joinFeedback.type === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
                  <span className="text-sm font-medium leading-relaxed">{joinFeedback.message}</span>
                </div>
                <button
                  onClick={() => setJoinFeedback(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-xs p-1 cursor-pointer transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          <PracticeDashboard
            assignments={assignments}
            attempts={attempts}
            onStartAttempt={handleLaunchStudentPlayer}
            onLogout={handleLogout}
            user={currentUser}
            idToken={idToken}
            onEnrollmentChange={() => fetchLmsPayload(currentUser)}
          />
        </div>

      </div>
    );
  }

  // TEACHER PORTAL PATH (interrupted for active student preview player)
  if (currentUser.role === "teacher" && activeStudentAttempt) {
    return (
      <FocusedPlayer 
        attemptId={activeStudentAttempt}
        user={currentUser}
        onExit={() => {
          setActiveStudentAttempt(null);
          fetchLmsPayload(currentUser);
        }}
      />
    );
  }

  // TEACHER PORTAL PATH
  return (
    <div className="flex flex-col h-screen bg-[#F4F5F7] text-[#1A1A1A] font-sans overflow-hidden">
      
      {/* Top Navigation Bar of the theme */}
      <nav className="flex items-center justify-between px-6 py-3 bg-[#0A192F] text-white shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <img
              src="/favicon.png"
              alt="Veritas Learn Logo"
              referrerPolicy="no-referrer"
              className="w-8 h-8 object-contain rounded-sm"
            />
            <span className="text-xl font-semibold tracking-tight">VERITAS <span className="font-light opacity-80">Learn</span></span>
          </div>
          <div className="h-6 w-px bg-white/20"></div>
          <span className="text-[15px] font-semibold tracking-wide text-white/70 uppercase">MALVERN PREP</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[12px] leading-[15px] font-semibold">{currentUser.name}</span>
            <span className="text-[10px] text-white/60 font-medium">Faculty</span>
          </div>
          {currentUser.photoURL ? (
            <img 
              src={currentUser.photoURL} 
              alt={currentUser.name} 
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border-2 border-white/20 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-xs uppercase bg-gradient-to-tr from-blue-700 to-indigo-800 text-white shrink-0">
              {currentUser.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded transition cursor-pointer"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar Navigation */}
        <aside className={`relative transition-all duration-300 ease-in-out bg-white border-r border-slate-200 flex flex-col shrink-0 ${isSidebarCollapsed ? "w-16" : "w-64"}`}>
          {/* Floating Collapsible Trigger Button */}
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="absolute -right-3 top-5 bg-white border border-slate-200 hover:bg-[#0A192F] hover:text-white text-slate-500 rounded-full w-6 h-6 flex items-center justify-center shadow-xs cursor-pointer focus:outline-none z-20 transition-all duration-150"
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isSidebarCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>

          <div className={`flex-1 py-4 space-y-1 overflow-y-auto ${isSidebarCollapsed ? "px-2" : "px-3"}`}>
            {isSidebarCollapsed ? (
              <div className="border-b border-slate-100 my-2 pb-2" />
            ) : (
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 pb-2">Classroom Management</div>
            )}
            
            <button
              onClick={() => setActiveTab("live")}
              className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"} rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "live" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
              title={isSidebarCollapsed ? "Lesson Tracking" : undefined}
            >
              <Activity className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'live' ? 'text-[#0A192F]' : 'text-slate-450'}`} />
              {!isSidebarCollapsed && <span className="truncate">Lesson Tracking</span>}
            </button>

            <button
              onClick={() => setActiveTab("builder")}
              className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"} rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "builder" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
              title={isSidebarCollapsed ? "Lesson Library" : undefined}
            >
              <BookOpen className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'builder' ? 'text-[#0A192F]' : 'text-slate-450'}`} />
              {!isSidebarCollapsed && <span className="truncate">Lesson Library</span>}
            </button>

            <button
              onClick={() => setActiveTab("courses")}
              className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"} rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "courses" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
              title={isSidebarCollapsed ? "Courses" : undefined}
            >
              <Users className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'courses' ? 'text-[#0A192F]' : 'text-slate-450'}`} />
              {!isSidebarCollapsed && <span className="truncate">Courses</span>}
            </button>

            <button
              onClick={() => setActiveTab("gradebook")}
              className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"} rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "gradebook" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
              title={isSidebarCollapsed ? "Gradebook" : undefined}
            >
              <GraduationCap className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'gradebook' ? 'text-[#0A192F]' : 'text-slate-450'}`} />
              {!isSidebarCollapsed && <span className="truncate">Gradebook</span>}
            </button>

            {isSidebarCollapsed ? (
              <div className="border-b border-slate-100 my-4" />
            ) : (
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 pt-6 pb-2">Analytics</div>
            )}

            <button
              onClick={() => setActiveTab("ai")}
              className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"} rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "ai" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
              title={isSidebarCollapsed ? "Review Queue" : undefined}
            >
              <CheckSquare className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'ai' ? 'text-[#0A192F]' : 'text-slate-450'}`} />
              {!isSidebarCollapsed && <span className="truncate">Review Queue</span>}
            </button>

            {currentUser?.isSuperAdmin && (
              <>
                {isSidebarCollapsed ? (
                  <div className="border-b border-slate-100 my-4" />
                ) : (
                  <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest px-2 pt-6 pb-2">Administration</div>
                )}
                <button
                  onClick={() => setActiveTab("admin")}
                  className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"} rounded text-left font-semibold text-sm cursor-pointer transition ${
                    activeTab === "admin" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
                  }`}
                  title={isSidebarCollapsed ? "Roster Control" : undefined}
                >
                  <Shield className={`w-4 h-4 shrink-0 transition-colors ${activeTab === 'admin' ? 'text-[#0A192F]' : 'text-slate-450'}`} />
                  {!isSidebarCollapsed && <span className="truncate">Roster Control</span>}
                </button>
              </>
            )}
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#F4F5F7]">
          {/* Section Header */}
          {activeTab !== "gradebook" && activeTab !== "builder" && activeTab !== "ai" && activeTab !== "courses" && activeTab !== "admin" && (
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h1 className="text-xl font-bold text-slate-800">
                  {activeTab === "live" && <>Lesson Tracking</>}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">
                  {activeTab === "live" && <>{students.length} students registered &bull; Asynchronous assignment progress</>}
                </p>
              </div>
            </header>
          )}

          {/* Scrollable Container Box */}
          <div className="flex-1 p-6 overflow-y-auto">


            {/* Dynamic tabs load */}
            <div className="w-full">
              {activeTab === "live" && (
                <LiveMonitor
                  students={students}
                  attempts={attempts}
                  responses={responses}
                  signals={signals}
                  lessons={lessons}
                  blocks={blocks}
                  onOpenDossier={(studentId, lessonId) => {
                    setActiveDossier({ studentId, lessonId });
                  }}
                  onUnlockStudent={handleUnlockStudent}
                />
              )}

              {activeTab === "builder" && (
                isFetching && lessons.length === 0 ? (
                  <LessonsBuilderSkeleton />
                ) : (
                  <LessonsBuilder
                    lessons={lessons}
                    blocks={blocks}
                    onSaveLesson={handleSaveLessonCurriculum}
                    onArchived={handleArchiveLesson}
                    assignments={assignments}
                    onSaveAssignment={handleSaveAssignment}
                    onDeleteAssignment={handleDeleteAssignment}
                    onLaunchPreviewAttempt={handleLaunchPreviewAttempt}
                    courses={courses}
                    onEditingDirtyChange={setIsAuthoringDirty}
                    idToken={idToken}
                    onCollapseSidebar={setIsSidebarCollapsed}
                  />
                )
              )}

              {activeTab === "courses" && (
                <CourseManager
                  idToken={idToken}
                  onRefresh={() => fetchLmsPayload(currentUser)}
                />
              )}

              {activeTab === "gradebook" && (
                isFetching && (students.length === 0 || lessons.length === 0) ? (
                   <GradebookSkeleton />
                 ) : (
                   <Gradebook
                     students={students}
                     lessons={lessons}
                     attempts={attempts}
                     responses={responses}
                     blocks={blocks}
                     assignments={assignments}
                     idToken={idToken}
                     onRefresh={() => fetchLmsPayload(currentUser)}
                     gradebookEntries={gradebookEntries}
                   />
                 )
               )}

              {activeTab === "ai" && (
                isFetching && (responses.length === 0 || students.length === 0) ? (
                  <AIReviewSkeleton />
                ) : (
                  <AIReview
                    students={students}
                    lessons={lessons}
                    blocks={blocks}
                    attempts={attempts}
                    responses={responses}
                    signals={signals}
                    assignments={assignments}
                    onOverrideSave={handleOverrideScore}
                    onOpenDossier={(studentId, lessonId) => setActiveDossier({ studentId, lessonId })}
                    idToken={idToken}
                    onRefresh={() => fetchLmsPayload(currentUser)}
                  />
                )
              )}

              {activeTab === "admin" && (
                <SuperAdmin idToken={idToken} />
              )}
            </div>
          </div>
        </main>
      </div>



      {/* Student Dossier audit modal */}
      {activeDossier && (
        <StudentDossierModal 
          studentId={activeDossier.studentId}
          lessonId={activeDossier.lessonId}
          students={students}
          attempts={attempts}
          responses={responses}
          signals={signals}
          lessons={lessons}
          blocks={blocks}
          assignments={assignments}
          onOverrideSave={handleOverrideScore}
          onUnlockStudent={handleUnlockStudent}
          onClose={() => setActiveDossier(null)}
        />
      )}
    </div>
  );
}

// Micro UX loaders
function RefreshSpinner() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="w-6 h-6 border-2 border-[#0A192F] border-t-[#E5B53B] rounded-full animate-spin"></div>
      <span className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">Synchronizing databases...</span>
    </div>
  );
}
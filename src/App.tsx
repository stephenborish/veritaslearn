import { useState, useEffect } from "react";
import Authenticator from "./components/Auth/Authenticator";
import LiveMonitor from "./components/TeacherDashboard/LiveMonitor";
import LessonsBuilder from "./components/TeacherDashboard/LessonsBuilder";
import Gradebook from "./components/TeacherDashboard/Gradebook";
import AIReview from "./components/TeacherDashboard/AIReview";
import StudentDossierModal from "./components/TeacherDashboard/StudentDossierModal";
import PracticeDashboard from "./components/StudentPortal/PracticeDashboard";
import FocusedPlayer from "./components/StudentPortal/FocusedPlayer";
import { auth, onAuthStateChanged, signOut } from "./lib/firebase";

import { 
  GraduationCap, 
  Settings, 
  Award, 
  LogOut, 
  BookOpen, 
  HelpCircle 
} from "lucide-react";
import { motion } from "motion/react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Curriculum data structures
  const [lessons, setLessons] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [responses, setResponses] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);

  // Selection states
  const [activeTab, setActiveTab] = useState<"live" | "builder" | "gradebook" | "ai">("live");
  const [activeDossier, setActiveDossier] = useState<{ studentId: string; lessonId: string } | null>(null);
  const [activeStudentAttempt, setActiveStudentAttempt] = useState<string | null>(null);

  // Listen to Firebase Auth state change dynamically (Durable Auth Persistence)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          const response = await fetch("/api/auth/me", {
            headers: { "Authorization": `Bearer ${token}` }
          });
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
      
      if (!lessonsRes.ok) {
        throw new Error(`Operational database fetch failed with status ${lessonsRes.status}`);
      }
      const lessonsRaw = await lessonsRes.json();
      setLessons(lessonsRaw.lessons || []);

      // If teacher: Full class analytics payload
      if (user.role === "teacher") {
        const analyticsRes = await fetch("/api/analytics", { headers: authHeader });
        if (!analyticsRes.ok) {
          throw new Error(`Analytics fetch failed with status ${analyticsRes.status}`);
        }
        const analyticsRaw = await analyticsRes.json();

        setStudents(analyticsRaw.students || []);
        setAttempts(analyticsRaw.attempts || []);
        setResponses(analyticsRaw.responses || []);
        setSignals(analyticsRaw.signals || []);

        // Flatten all lesson blocks
        const allBlocks: any[] = [];
        for (const lesson of (lessonsRaw.lessons || [])) {
          const blocksRes = await fetch(`/api/lessons/${lesson.id}`, { headers: authHeader });
          if (blocksRes.ok) {
            const blocksRaw = await blocksRes.json();
            allBlocks.push(...(blocksRaw.blocks || []));
          }
        }
        setBlocks(allBlocks);
      } else {
        // If student: Load active attempts sequence
        const testAttempts: any[] = [];
        for (const lesson of (lessonsRaw.lessons || [])) {
          try {
            const blockDetailRes = await fetch(`/api/attempts?lessonId=${lesson.id}`, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify({ lessonId: lesson.id })
            });
            if (blockDetailRes.ok) {
              const blockDetail = await blockDetailRes.json();
              if (blockDetail.attempt) {
                testAttempts.push(blockDetail.attempt);
              }
            }
          } catch (e) {}
        }
        setAttempts(testAttempts);
      }
    } catch (error) {
      console.error("Payload extraction failed:", error);
    }
  };

  // Periodic Live Sync interval (every 4 seconds) to fuel the Teacher Dashboard Live-Grid
  useEffect(() => {
    if (!currentUser || currentUser.role !== "teacher" || !idToken) return;
    const interval = setInterval(() => {
      fetchLmsPayload(currentUser, null);
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser, idToken]);

  const handleLogin = async (user: any) => {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      setCurrentUser(user);
      setIdToken(token);
      fetchLmsPayload(user, token);
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
      await res.json();
      fetchLmsPayload(currentUser, token);
    } catch (e) {
      console.error(e);
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

  // Launch Focus player
  const handleLaunchStudentPlayer = async (lessonId: string) => {
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
        body: JSON.stringify({ lessonId })
      });
      const data = await res.json();
      
      if (data.attempt) {
        setActiveStudentAttempt(data.attempt.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] text-slate-900 flex flex-col items-center justify-center font-sans select-none">
        <RefreshSpinner />
      </div>
    );
  }

  if (!currentUser) {
    return <Authenticator onLoginSuccess={handleLogin} />;
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
      <div className="min-h-screen bg-[#F4F5F7] flex flex-col select-none font-sans">
        <nav className="flex items-center justify-between px-6 py-3 bg-[#0A192F] text-white shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#E5B53B] flex items-center justify-center font-bold text-[#0A192F] rounded-sm">V</div>
              <span className="text-xl font-semibold tracking-tight">VERITAS <span className="font-light opacity-80">Learn</span></span>
            </div>
            <div className="h-6 w-px bg-white/20"></div>
            <span className="text-[15px] font-semibold tracking-wide text-white/70 uppercase">MALVERN PREP</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[12px] leading-[15px] font-semibold">{currentUser.name}</span>
            </div>
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
          <PracticeDashboard 
            lessons={lessons}
            attempts={attempts}
            onStartAttempt={handleLaunchStudentPlayer}
            onLogout={handleLogout}
            user={currentUser}
          />
        </div>

      </div>
    );
  }

  // TEACHER PORTAL PATH
  return (
    <div className="flex flex-col h-screen bg-[#F4F5F7] text-[#1A1A1A] font-sans overflow-hidden select-none">
      
      {/* Top Navigation Bar of the theme */}
      <nav className="flex items-center justify-between px-6 py-3 bg-[#0A192F] text-white shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#E5B53B] flex items-center justify-center font-bold text-[#0A192F] rounded-sm">V</div>
            <span className="text-xl font-semibold tracking-tight">VERITAS <span className="font-light opacity-80">Learn</span></span>
          </div>
          <div className="h-6 w-px bg-white/20"></div>
          <span className="text-[15px] font-semibold tracking-wide text-white/70 uppercase">MALVERN PREP</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[12px] leading-[15px] font-semibold">Dr. Stephen Borish</span>
            <span className="text-[10px] text-white/60 font-medium">Faculty Administrator</span>
          </div>
          <div className="w-9 h-9 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-xs uppercase bg-gradient-to-tr from-blue-700 to-indigo-800 text-white shrink-0">
            SB
          </div>
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
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 pb-2">Classroom Management</div>
            <button
              onClick={() => setActiveTab("live")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "live" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded-sm border transition-colors ${activeTab === 'live' ? 'bg-[#0A192F] border-[#0A192F]' : 'border-slate-400 bg-transparent'}`}></span> 
              Lesson Tracking
            </button>
            <button
              onClick={() => setActiveTab("builder")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "builder" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded-sm border transition-colors ${activeTab === 'builder' ? 'bg-[#0A192F] border-[#0A192F]' : 'border-slate-400 bg-transparent'}`}></span> 
              Lesson Library
            </button>
            <button
              onClick={() => setActiveTab("gradebook")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "gradebook" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded-sm border transition-colors ${activeTab === 'gradebook' ? 'bg-[#0A192F] border-[#0A192F]' : 'border-slate-400 bg-transparent'}`}></span> 
              Gradebook
            </button>

            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 pt-6 pb-2">Analytics</div>
            <button
              onClick={() => setActiveTab("ai")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left font-semibold text-sm cursor-pointer transition ${
                activeTab === "ai" ? "bg-slate-100 text-[#0A192F]" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded-sm border transition-colors ${activeTab === 'ai' ? 'bg-[#0A192F] border-[#0A192F]' : 'border-slate-400 bg-transparent'}`}></span> 
              AI Rubrics Queue
            </button>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#F4F5F7]">
          {/* Section Header */}
          {activeTab !== "gradebook" && activeTab !== "builder" && activeTab !== "ai" && (
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h1 className="text-xl font-bold text-slate-800">
                  {activeTab === "live" && <>Live Monitor: <span className="font-serif italic">Introduction to Stoicism</span></>}
                  {activeTab === "builder" && <>Lesson Builder & Curriculum Library</>}
                  {activeTab === "ai" && <>AI Rubric Grading Evaluations Queue</>}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">
                  {activeTab === "live" && <>Section 4B &bull; Philosophy & Ethics &bull; {students.length} Students Registered</>}
                  {activeTab === "builder" && <>Draft and publish active lessons and multi-checkpoint assessments</>}
                  {activeTab === "ai" && <>Review auto-evaluation rubric grades generated by Gemini 3.5 assessor</>}
                </p>
              </div>

              <div className="flex gap-3">
                <div className="flex flex-col items-center border-l border-slate-200 px-4">
                  <span className="text-lg font-bold text-slate-700">84%</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Avg. Accuracy</span>
                </div>
                <div className="flex flex-col items-center border-l border-slate-200 px-4">
                  <span className="text-lg font-bold text-amber-600">
                    {signals.filter(s=>s.severity === 'high').length}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Security Flags</span>
                </div>
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
                  onOpenDossier={(studentId, lessonId) => {
                    setActiveDossier({ studentId, lessonId });
                  }}
                />
              )}

              {activeTab === "builder" && (
                <LessonsBuilder 
                  lessons={lessons}
                  blocks={blocks}
                  onSaveLesson={handleSaveLessonCurriculum}
                  onArchived={handleArchiveLesson}
                />
              )}

              {activeTab === "gradebook" && (
                <Gradebook 
                  students={students}
                  lessons={lessons}
                  attempts={attempts}
                  responses={responses}
                />
              )}

              {activeTab === "ai" && (
                <AIReview 
                  students={students}
                  lessons={lessons}
                  responses={responses}
                  onOverrideSave={handleOverrideScore}
                />
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
          onOverrideSave={handleOverrideScore}
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

import { useState } from "react";
import {
  ShieldCheck, AlertCircle, Users, ArrowRight, GraduationCap,
  ArrowLeft, UserCheck, X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, googleProvider, signInWithPopup } from "../../lib/firebase";
import LandingArtBackground from "./LandingArtBackground";

export const PENDING_COURSE_CODE_KEY = "veritas_pending_course_code";

interface LandingPageProps {
  onLoginSuccess: (user: any) => void;
}

export default function LandingPage({ onLoginSuccess }: LandingPageProps) {
  const [courseCode, setCourseCode] = useState("");
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"teacher" | "new_student" | "returning" | null>(null);
  const [studentPath, setStudentPath] = useState<"choose" | "new_student">("new_student");

  const signInWithGoogle = async (): Promise<any> => {
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Verification failed");
    }
    return data.user;
  };

  const handleTeacherSignIn = async () => {
    setLoading(true);
    setLoadingMode("teacher");
    setErrorText("");
    try {
      const user = await signInWithGoogle();
      onLoginSuccess(user);
    } catch (err: any) {
      setErrorText(err.message || "Sign-in was cancelled or failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleNewStudentSignIn = async () => {
    const trimmedCode = courseCode.trim().toUpperCase();
    if (!trimmedCode) {
      setErrorText("Please enter your course code to continue.");
      return;
    }
    setLoading(true);
    setLoadingMode("new_student");
    setErrorText("");
    try {
      // Persist code before the auth popup — survives focus loss from the popup window.
      sessionStorage.setItem(PENDING_COURSE_CODE_KEY, trimmedCode);
      const user = await signInWithGoogle();
      onLoginSuccess(user);
    } catch (err: any) {
      sessionStorage.removeItem(PENDING_COURSE_CODE_KEY);
      setErrorText(err.message || "Sign-in was cancelled or failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleReturningStudentSignIn = async () => {
    setLoading(true);
    setLoadingMode("returning");
    setErrorText("");
    try {
      const user = await signInWithGoogle();
      onLoginSuccess(user);
    } catch (err: any) {
      setErrorText(err.message || "Sign-in was cancelled or failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleBack = () => {
    setErrorText("");
    setCourseCode("");
  };

  return (
    <div className="relative min-h-screen text-[#1A1A1A] font-sans flex flex-col bg-[#FCFBFA] overflow-hidden">
      <LandingArtBackground />

      <div className="relative z-10 flex-1 flex flex-col min-h-screen">

        {/* Header */}
        <header className="px-6 py-5 flex items-center justify-between shrink-0 border-b border-slate-200/40 bg-white/35 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <img
              src="/favicon.png"
              alt="Veritas Learn Logo"
              referrerPolicy="no-referrer"
              className="w-10 h-10 object-contain rounded-[8px] shadow-sm"
            />
            <div className="flex flex-col">
              <span className="text-[23px] leading-[23px] mt-[5px] font-extrabold tracking-tight text-slate-950">
                VERITAS <span className="font-light text-slate-800">Learn</span>
              </span>
              <span className="text-[11px] leading-[12.5px] font-sans text-left mt-[6px] text-[#AB8423] uppercase tracking-widest font-bold">
                Malvern Prep
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              id="student-sign-in-btn"
              onClick={handleReturningStudentSignIn}
              disabled={loading}
              className="flex items-center gap-2 border border-slate-200/80 bg-white/80 hover:bg-slate-50 text-slate-700 text-[14px] leading-[16px] font-semibold px-4 py-2.5 rounded-[10px] transition-all duration-200 active:scale-95 shadow-sm hover:border-slate-300 cursor-pointer disabled:opacity-60"
            >
              {loading && loadingMode === "returning" ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-500/30 border-t-indigo-600 rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4 text-indigo-600" />
                  Student Sign In
                </>
              )}
            </button>

            <button
              id="teacher-portal-btn"
              onClick={handleTeacherSignIn}
              disabled={loading}
              className="flex items-center gap-2 border border-slate-200/80 bg-white/80 hover:bg-slate-50 text-slate-700 text-[14px] leading-[16px] font-semibold px-4 py-2.5 rounded-[10px] transition-all duration-200 active:scale-95 shadow-sm hover:border-slate-300 cursor-pointer disabled:opacity-60"
            >
              {loading && loadingMode === "teacher" ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-500/30 border-t-slate-700 rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#AB8423]" />
                  Teacher Portal
                </>
              )}
            </button>
          </div>
        </header>

        {/* Error banner */}
        <AnimatePresence>
          {errorText && (
            <motion.div
              key="error-banner"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-xl mx-auto px-6 pt-5 shrink-0"
            >
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3.5 flex items-center gap-2.5 shadow-sm">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="text-sm text-rose-800 flex-1 font-medium">{errorText}</span>
                <button
                  onClick={() => setErrorText("")}
                  className="text-rose-400 hover:text-rose-600 transition shrink-0 ml-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="text-center mb-10 space-y-2.5"
          >
            <h1 className="text-[30px] sm:text-[34px] font-extrabold tracking-tight text-slate-900 leading-tight">
              Welcome to VERITAS Learn
            </h1>
          </motion.div>

          {/* Student entry cards */}
          <div className="w-full max-w-xl">
            <AnimatePresence mode="wait" initial={false}>

              {studentPath === "choose" ? (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="w-full max-w-md mx-auto"
                >
                  {/* New student — enter course code */}
                  <button
                    id="new-student-join-btn"
                    onClick={() => setStudentPath("new_student")}
                    disabled={loading}
                    className="w-full group bg-white/85 border border-emerald-200/70 hover:border-emerald-300 rounded-[12px] p-7 shadow-sm hover:shadow-md backdrop-blur-md text-left transition-all duration-200 active:scale-[0.99] flex flex-col gap-4 cursor-pointer disabled:opacity-60"
                  >
                    <div className="w-11 h-11 bg-emerald-800 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-[18px] font-bold text-slate-900 leading-snug">New student</h2>
                      <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                        Enter the course code from your teacher to join.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-700 text-sm font-semibold mt-auto pt-4">
                      Enter course code
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </button>
                </motion.div>

              ) : (
                <motion.div
                  key="new_student_form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/88 border border-slate-200/50 rounded-[12px] p-8 shadow-sm backdrop-blur-md space-y-6"
                >
                  {/* Heading */}
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-emerald-800 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-[20px] font-bold text-slate-900 leading-snug">Join a course</h2>
                      <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-widest mt-0.5">
                        New student enrollment
                      </p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed">
                    Enter the join code your teacher shared. After signing in, you will be enrolled automatically.
                  </p>

                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      Course Join Code
                    </label>
                    <input
                      type="text"
                      value={courseCode}
                      onChange={(e) => {
                        setCourseCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                        if (errorText) setErrorText("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && !loading && handleNewStudentSignIn()}
                      placeholder="e.g. APBIO26"
                      className="w-full bg-slate-100/65 border border-slate-200/60 rounded-lg px-4 py-3.5 text-slate-800 font-mono font-bold uppercase tracking-widest focus:outline-none focus:border-emerald-600 focus:bg-white text-sm placeholder:normal-case placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-400 transition-colors"
                      disabled={loading}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>

                  <button
                    onClick={handleNewStudentSignIn}
                    disabled={loading}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[15px] py-3.5 px-4 rounded-[10px] font-semibold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-[0.99]"
                  >
                    {loading && loadingMode === "new_student" ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                        Signing in…
                      </>
                    ) : (
                      <>
                        Continue to sign in
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-slate-200/40 bg-white/20 backdrop-blur-sm py-5 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500 px-4">
            <GraduationCap className="w-4 h-4 text-slate-400" />
            <span>
              Secure single sign-on powered by Google. Progress and activity records are saved securely.
            </span>
          </div>
        </footer>

      </div>
    </div>
  );
}
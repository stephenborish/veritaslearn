import { useState } from "react";
import { ShieldCheck, AlertCircle, BookOpen, Users, ArrowRight, GraduationCap } from "lucide-react";
import { motion } from "motion/react";
import { auth, googleProvider, signInWithPopup } from "../../lib/firebase";

export const PENDING_COURSE_CODE_KEY = "veritas_pending_course_code";

interface LandingPageProps {
  onLoginSuccess: (user: any) => void;
}

export default function LandingPage({ onLoginSuccess }: LandingPageProps) {
  const [courseCode, setCourseCode] = useState("");
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"teacher" | "student" | null>(null);

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
      setErrorText(err.message || "Google sign-in was cancelled or failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleStudentContinue = async () => {
    const trimmedCode = courseCode.trim().toUpperCase();
    if (!trimmedCode) {
      setErrorText("Please enter a course code from your teacher.");
      return;
    }
    setLoading(true);
    setLoadingMode("student");
    setErrorText("");
    try {
      // Persist code before auth popup — survives focus change from popup
      sessionStorage.setItem(PENDING_COURSE_CODE_KEY, trimmedCode);
      const user = await signInWithGoogle();
      onLoginSuccess(user);
    } catch (err: any) {
      sessionStorage.removeItem(PENDING_COURSE_CODE_KEY);
      setErrorText(err.message || "Google sign-in was cancelled or failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1A1A] font-sans flex flex-col">
      {/* Header */}
      <header className="bg-[#0A192F] text-white px-6 py-4 flex items-center gap-3 shrink-0">
        <img
          src="/favicon.png"
          alt="Veritas Learn Logo"
          referrerPolicy="no-referrer"
          className="w-9 h-9 object-contain rounded-sm shadow-sm"
        />
        <div className="flex flex-col">
          <span className="text-xl font-semibold tracking-tight leading-none">
            VERITAS <span className="font-light opacity-80">Learn</span>
          </span>
          <span className="text-[10px] text-white/50 uppercase tracking-widest font-mono">
            Malvern Prep
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[#0A192F] text-white px-6 pb-16 pt-10 text-center shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-3xl mx-auto leading-tight">
            Assessment that uncovers the learning behind every answer.
          </h1>
          <p className="text-white/65 mt-4 text-base max-w-2xl mx-auto leading-relaxed">
            Design lessons, guide practice, score responses, and review student thinking from one
            secure learning workspace.
          </p>
        </motion.div>
      </section>

      {/* Error banner */}
      {errorText && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span className="text-sm text-red-800 flex-1">{errorText}</span>
          <button
            onClick={() => setErrorText("")}
            className="text-red-400 hover:text-red-600 text-xs font-bold uppercase tracking-wide shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Entry panels */}
      <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          {/* Teacher card */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm flex flex-col gap-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-[#0A192F] rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                <BookOpen className="w-5 h-5 text-[#E5B53B]" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Teachers</h2>
                <p className="text-xs text-slate-400 font-medium">Lesson design &amp; assessment</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              Design lessons, assign learning activities, and review student thinking in one secure
              workspace.
            </p>

            <button
              onClick={handleTeacherSignIn}
              disabled={loading}
              className="w-full bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-sm py-3 px-4 rounded font-semibold tracking-wide transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              {loading && loadingMode === "teacher" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                  Signing in…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Sign in with Google
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-400 text-center">
              Use your school Google account.
            </p>
          </motion.div>

          {/* Student card */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
            className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm flex flex-col gap-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-emerald-600 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Students</h2>
                <p className="text-xs text-slate-400 font-medium">Join a course &amp; begin learning</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              Enter the course code from your teacher, then continue with your school Google account.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                Course Code
              </label>
              <input
                type="text"
                value={courseCode}
                onChange={(e) => {
                  setCourseCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
                  if (errorText) setErrorText("");
                }}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleStudentContinue()}
                placeholder="e.g. APBIO-4M8X"
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2.5 text-slate-800 font-mono font-semibold uppercase tracking-widest focus:outline-none focus:border-[#0A192F] text-sm placeholder:normal-case placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-400"
                disabled={loading}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <button
              onClick={handleStudentContinue}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-sm py-3 px-4 rounded font-semibold tracking-wide transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              {loading && loadingMode === "student" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                  Signing in…
                </>
              ) : (
                <>
                  Continue to Learning
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-400 text-center">
              You'll sign in with your school Google account after entering your code.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-200 py-6 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <GraduationCap className="w-3.5 h-3.5" />
          <span>
            Secure sign-in powered by Google. All activity is recorded in compliance with FERPA
            guidelines.
          </span>
        </div>
      </footer>
    </div>
  );
}

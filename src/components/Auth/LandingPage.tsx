import { useState } from "react";
import { ShieldCheck, AlertCircle, BookOpen, Users, ArrowRight, GraduationCap } from "lucide-react";
import { motion } from "motion/react";
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
    <div className="relative min-h-screen text-[#1A1A1A] font-sans flex flex-col bg-[#FCFBFA] overflow-hidden">
      {/* Decorative, premium abstract grainy base background */}
      <LandingArtBackground />

      {/* Actual foreground layout - elevated above the background art */}
      <div className="relative z-10 flex-1 flex flex-col justify-between min-h-screen">
        
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
          
          <button
            onClick={handleTeacherSignIn}
            disabled={loading}
            className="flex items-center gap-2 border border-slate-200/80 bg-white/80 hover:bg-slate-50 text-slate-700 text-[14px] leading-[16px] font-semibold px-4 py-2.5 rounded-[10px] transition-all duration-200 active:scale-95 shadow-sm hover:border-slate-300 pointer-events-auto cursor-pointer"
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
        </header>



        {/* Error banner */}
        {errorText && (
          <div className="max-w-4xl w-full mx-auto px-6 mb-2 shrink-0">
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3.5 flex items-center gap-2.5 shadow-sm"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="text-xs sm:text-sm text-rose-800 flex-1 font-medium">{errorText}</span>
              <button
                onClick={() => setErrorText("")}
                className="text-rose-500 hover:text-rose-700 text-xs font-bold uppercase tracking-wider shrink-0"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        )}

        {/* Entry panels */}
        <div className="flex-1 max-w-md w-full mx-auto px-6 py-12 flex items-center justify-center">
          <div className="w-full">

            {/* Student card - centered layout */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="bg-white/85 border border-slate-200/50 rounded-[10px] p-8 shadow-sm hover:shadow-md backdrop-blur-md flex flex-col justify-between gap-6 transition-all duration-300"
            >
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-emerald-750 bg-emerald-800 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-[23px] font-bold text-slate-900">Students</h2>
                    <p className="text-xs text-[#065F46] font-sans font-bold uppercase tracking-wider">Join a course &amp; begin learning</p>
                  </div>
                </div>

                <p className="text-sm text-slate-600 leading-relaxed">
                  To enroll in a course, enter the code shared by your teacher to begin.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-widest font-sans">
                    Course Join Code
                  </label>
                  <input
                    type="text"
                    value={courseCode}
                    onChange={(e) => {
                      setCourseCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
                      if (errorText) setErrorText("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && !loading && handleStudentContinue()}
                    placeholder="e.g. MATH34"
                    className="w-full bg-slate-100/65 border border-slate-200/60 rounded-lg px-3 py-3 text-slate-800 font-mono font-bold uppercase tracking-widest focus:outline-none focus:border-emerald-600 focus:bg-white text-sm placeholder:normal-case placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-400 transition-colors"
                    disabled={loading}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>

                <button
                  onClick={handleStudentContinue}
                  disabled={loading}
                  className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[16px] py-3.5 px-4 rounded-[10px] font-semibold tracking-wide transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
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
              </div>
            </motion.div>
          </div>
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-slate-200/40 bg-white/20 backdrop-blur-sm py-5 text-center mt-6">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500 px-4">
            <GraduationCap className="w-4 h-4 text-slate-400" />
            <span>
              Secure single sign-on powered by Google. Student progress records and activity signals are saved securely.
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

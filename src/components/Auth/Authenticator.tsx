import { useState } from "react";
import { ShieldCheck, AlertCircle, GraduationCap } from "lucide-react";
import { motion } from "motion/react";
import { auth, googleProvider, signInWithPopup } from "../../lib/firebase";

interface AuthenticatorProps {
  onLoginSuccess: (user: any) => void;
}

export default function Authenticator({ onLoginSuccess }: AuthenticatorProps) {
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorText("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Verification failed");
      }
      onLoginSuccess(data.user);
    } catch (err: any) {
      console.error("Firebase Auth Sign-In failed:", err);
      setErrorText(err.message || "Google Authentication aborted or failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1A1A] flex flex-col items-center justify-center p-6 select-none font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-white border border-slate-200 shadow-md rounded p-8"
        id="login-card"
      >
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-10 h-10 bg-[#E5B53B] flex items-center justify-center font-bold text-[#0A192F] rounded-sm text-xl mb-3 shadow-sm">V</div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0A192F] font-sans">
            VERITAS <span className="font-light text-slate-500">Learn</span>
          </h1>
          <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-widest font-mono">Malvern Prep</p>
        </div>

        <div className="border-t border-slate-100 my-4"></div>

        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 font-mono">
          Durable Firebase Protection
        </span>
        <p className="text-xs text-slate-600 leading-relaxed mb-6">
          Authentication is verified server-side. Access is restricted to authorized Malvern Prep accounts. Contact your administrator if you need access.
        </p>

        {errorText && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-sm p-3 mb-6 flex items-start gap-2 animate-pulse">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <span className="text-xs text-red-900 font-medium">{errorText}</span>
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full bg-[#0A192F] hover:bg-[#15294b] text-white text-sm py-3 px-4 rounded font-semibold tracking-wide transition disabled:bg-slate-200 disabled:text-slate-400 flex items-center justify-center gap-2 cursor-pointer shadow-sm border border-transparent"
        >
          {loading ? "Verifying Google Session..." : "Sign in with Google Workplace"}
          <ShieldCheck className="w-4 h-4" />
        </button>

        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-150"></span></div>
          <span className="relative bg-white text-[9px] font-bold tracking-widest text-[#0A192F] px-2 uppercase font-mono">Authorized Accounts Only</span>
        </div>

        <div className="bg-slate-50/60 border border-slate-150 rounded p-3 text-left space-y-2">
          <div className="text-xs font-bold text-[#0A192F] flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5 text-[#E5B53B]" />
            Authentication Conditions
          </div>
          <p className="text-[10px] text-slate-550 leading-relaxed">
            Sign in with your authorized Malvern Prep Google account. All activity is logged under FERPA guidelines.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

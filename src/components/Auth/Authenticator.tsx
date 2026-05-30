import { useState } from "react";
import { ShieldCheck, GraduationCap, AlertCircle, BookOpen } from "lucide-react";
import { motion } from "motion/react";

interface AuthenticatorProps {
  onLoginSuccess: (user: any) => void;
}

export default function Authenticator({ onLoginSuccess }: AuthenticatorProps) {
  const [emailInput, setEmailInput] = useState("");
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(false);

  const presets = [
    { email: "stephenborish@gmail.com", name: "Stephen Borish (Teacher)", desc: "Full gradebook, live analytics, and content builder access" },
    { email: "mwilliams27@malvernprep.org", name: "Matthew Williams (Student)", desc: "AP history enthusiast, clean record" },
    { email: "cdavidson27@malvernprep.org", name: "Cooper Davidson (Student)", desc: "High-risk signals: Focus blurring and copy-pastes" },
    { email: "loconnor27@malvernprep.org", name: "Liam O'Connor (Student)", desc: "Active in-progress lesson, AI review pending" }
  ];

  const handleLogin = async (email: string) => {
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Verification failed");
      }
      onLoginSuccess(data.user);
    } catch (err: any) {
      setErrorText(err.message || "An error occurred");
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
          Strict Security Gate
        </span>
        <p className="text-xs text-slate-600 leading-relaxed mb-4">
          Access is limited strictly to approved Google accounts of Malvern Prep. Authenticators check and block generic or untrusted emails.
        </p>

        {errorText && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-sm p-3 mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <span className="text-xs text-red-900 font-medium">{errorText}</span>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); if (emailInput) handleLogin(emailInput); }} className="space-y-3">
          <div>
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide block mb-1">Enter School Email Account</label>
            <input 
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="e.g. username27@malvernprep.org"
              className="w-full text-sm bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#0A192F] focus:bg-white focus:border-[#0A192F]"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !emailInput}
            className="w-full bg-[#0A192F] hover:bg-[#15294b] text-white text-sm py-2 px-4 rounded font-semibold tracking-wide transition disabled:bg-slate-200 disabled:text-slate-400 flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            {loading ? "Authenticating..." : "Sign in with Google"}
            <ShieldCheck className="w-4 h-4" />
          </button>
        </form>

        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-150"></span></div>
          <span className="relative bg-white text-[9px] font-bold tracking-widest text-slate-400 px-2 uppercase font-mono">Simulation Sandbox Roles</span>
        </div>

        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {presets.map((preset) => (
            <button
              key={preset.email}
              onClick={() => {
                setEmailInput(preset.email);
                handleLogin(preset.email);
              }}
              className="w-full text-left bg-slate-50 hover:bg-slate-100/80 active:bg-blue-50 border border-slate-200 hover:border-slate-350 p-3 rounded transition-all flex justify-between items-center group cursor-pointer"
            >
              <div className="flex-1 min-w-0 pr-2">
                <div className="text-xs font-bold text-[#0A192F] flex items-center gap-1.5 truncate">
                  {preset.email.includes("@malvernprep.org") ? (
                    <GraduationCap className="w-3.5 h-3.5 text-[#0A192F]" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-[#E5B53B]" />
                  )}
                  {preset.name}
                </div>
                <div className="text-[10px] text-slate-550 mt-0.5 truncate">{preset.desc}</div>
              </div>
              <span className="text-[10px] font-mono font-bold text-[#0A192F] opacity-0 group-hover:opacity-100 transition whitespace-nowrap pl-1">&rarr;</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

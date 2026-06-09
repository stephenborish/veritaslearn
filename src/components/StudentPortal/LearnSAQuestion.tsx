import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface LearnSAQuestionProps {
  /** Current draft / submitted text. */
  value: string;
  /** Called on every keystroke while editing. */
  onChange?: (val: string) => void;
  /** When submitted, the writing area becomes a calm read-only view. */
  isSubmitted?: boolean;
  /** Draft autosave lifecycle for the live "Saved" status. */
  autosaveState?: AutosaveState;
  placeholder?: string;
  /** Are we in practice mode? Defaults to false. */
  isPractice?: boolean;
}

/** Small, calm autosave status line — never color-only (icon + label). */
function SaveStatus({ state }: { state: AutosaveState }) {
  if (state === "idle") return null;
  const config: Record<Exclude<AutosaveState, "idle">, { text: string; cls: string; spin?: boolean; alert?: boolean }> = {
    dirty: { text: "Saving…", cls: "text-slate-400", spin: true },
    saving: { text: "Saving…", cls: "text-indigo-500", spin: true },
    saved: { text: "Draft saved", cls: "text-emerald-600" },
    error: { text: "Couldn’t save. Keep writing — we’ll retry.", cls: "text-rose-600", alert: true },
  };
  const c = config[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", c.cls)}>
      {c.spin && <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />}
      {c.alert && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
      {state === "saved" && <Check className="w-3.5 h-3.5 shrink-0" />}
      <span>{c.text}</span>
    </span>
  );
}

/**
 * VERITAS Learn short-answer writing area.
 *
 * A large, calm response field on a bright surface, with a live "Saved" status and
 * a comfortable read-only view once submitted. Rubrics, model answers, and scoring
 * guidance are never rendered here — feedback for practice is handled by the parent.
 */
export function LearnSAQuestion({
  value,
  onChange,
  isSubmitted,
  autosaveState = "idle",
  placeholder = "Write your response here. Your draft saves automatically.",
  isPractice = false,
}: LearnSAQuestionProps) {
  const reduceMotion = useReducedMotion();

  if (isSubmitted) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-5 font-serif text-[15px] md:text-base leading-relaxed text-slate-800 prose max-w-none"
      >
        <div className="mb-2.5 text-[11px] font-sans text-slate-500 uppercase tracking-[0.08em] font-bold">
          Submitted response
        </div>
        {value ? <RichContentRenderer content={value} /> : <span className="italic text-slate-400">No response.</span>}
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        rows={7}
        placeholder={placeholder}
        aria-label="Your response"
        className={cn(
          "learn-focusable w-full rounded-2xl border-2 border-slate-200 bg-white p-4 md:p-5",
          "font-serif text-[15px] md:text-base leading-relaxed text-slate-800 resize-y min-h-[180px]",
          "transition-colors duration-150 outline-none placeholder:text-slate-400",
          "hover:border-slate-300 focus-visible:border-indigo-400 focus-visible:ring-4 focus-visible:ring-indigo-500/20",
        )}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-[18px]">
        {isPractice ? (
          <span className="text-sm font-medium text-slate-500">
            Answer in your own words. You’ll get practice feedback after you submit.
          </span>
        ) : (
           <span className="text-sm font-medium text-slate-500">
             Your answer will be reviewed by your teacher.
           </span>
        )}
        <div className="flex items-center gap-4 self-end sm:self-auto">
          <AnimatePresence mode="wait">
            <motion.span
              key={autosaveState}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <SaveStatus state={autosaveState} />
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

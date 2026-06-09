import React, { useState, useEffect } from "react";
import type { JSX } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, RefreshCw, Sparkles, BookOpen, ClipboardCheck, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";
import { LearnMCQuestion } from "./LearnMCQuestion";
import { LearnSAQuestion, type AutosaveState } from "./LearnSAQuestion";

export type QuestionMode = "practice" | "assessment";
export type SaGradingState =
  | "draft"
  | "saving"
  | "saved"
  | "submitting"
  | "scoring"
  | "feedback_ready"
  | "needs_teacher_review"
  | "feedback_delayed"
  | "feedback_failed"
  | "revision_open"
  | "unsent"
  | "submitted"
  | "pending_ai"
  | "grading_failed";

export interface SaFeedbackData {
  score?: number;
  maxPoints?: number;
  feedback?: string;
  rubricBreakdown?: { [category: string]: { score: number; maxScore?: number; feedback: string } };
  misconceptions?: string[];
}

export interface McFeedback {
  correct: boolean;
  desc?: string;
  rightChoiceId?: string;
  explanation?: string;
}

export interface LearnQuestionCardProps {
  question: any; // sanitized student-facing question (stem, type, choices, points, studentInstructions)
  /** Delivered choices for MC (scrambled order, stable ids). Falls back to question.choices. */
  choices?: any[];
  mode: QuestionMode;
  /** "card" = standalone block, "panel" = inside a checkpoint panel (slightly tighter chrome). */
  surface?: "card" | "panel";
  /** 1-based position when several questions share a checkpoint/block. */
  questionNumber?: number;
  totalQuestions?: number;

  // MC
  selectedChoiceId?: string;
  onSelectChoice?: (id: string) => void;
  rightChoiceId?: string;
  attemptsState?: {
    attemptsCount: number;
    maxAttempts: number;
    attemptsRemaining: number;
    isComplete: boolean;
    isCorrect: boolean;
  };

  // SA
  saValue?: string;
  onSaChange?: (val: string) => void;
  autosaveState?: AutosaveState;

  // Submission lifecycle
  isSubmitted?: boolean;
  isSaving?: boolean;
  onSubmit?: () => void;
  onRevise?: () => void;
  onContinue?: () => void;

  // Feedback (practice only)
  mcFeedback?: McFeedback;
  saGradingState?: SaGradingState;
  saFeedback?: SaFeedbackData;
}

const MODE_LABEL: Record<QuestionMode, string> = {
  practice: "Practice Check",
  assessment: "Assessment Check",
};
const MODE_HELPER: Record<QuestionMode, string> = {
  practice: "Use this to check your understanding.",
  assessment: "Submit your best response.",
};

/**
 * Shared VERITAS Learn question card used by BOTH checkpoint questions and normal
 * question blocks, so the two feel like one polished system.
 *
 * Security: this component only ever renders student-safe data. For assessment
 * questions it never shows correctness, scores, answer keys, or feedback — the
 * server already strips those, and the card additionally guards on `mode`.
 */
export function LearnQuestionCard(props: LearnQuestionCardProps): JSX.Element {
  const {
    question,
    choices,
    mode,
    surface = "card",
    questionNumber,
    totalQuestions,
    selectedChoiceId,
    onSelectChoice,
    saValue = "",
    onSaChange,
    autosaveState = "idle",
    isSubmitted,
    isSaving,
    onSubmit,
    onRevise,
    onContinue,
    mcFeedback,
    saGradingState = "draft",
    saFeedback,
    rightChoiceId,
    attemptsState,
  } = props;

  const reduceMotion = useReducedMotion();
  const isPractice = mode === "practice";
  const deliveredChoices = choices || question.choices;
  const isMc = (question.type ? question.type === "mc" : Array.isArray(deliveredChoices)) && Array.isArray(deliveredChoices);

  const canSubmit = isMc ? !!selectedChoiceId : !!(saValue && saValue.trim());

  // Practice correctness for the *selected* MC choice (never reveals the key unless explicitly released).
  const selectedCorrect = mcFeedback?.correct;

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full bg-white rounded-3xl border border-slate-200 shadow-sm",
        surface === "panel" ? "p-6 md:p-8" : "p-6 md:p-8",
      )}
      aria-label={`${MODE_LABEL[mode]} question`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border",
            isPractice
              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200",
          )}
        >
          {isPractice ? <BookOpen className="w-3.5 h-3.5" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
          {MODE_LABEL[mode]}
        </span>

        {totalQuestions && totalQuestions > 1 && questionNumber ? (
          <span className="text-xs font-medium text-slate-500">
            Question {questionNumber} of {totalQuestions}
          </span>
        ) : null}

        {isMc && attemptsState && attemptsState.attemptsCount > 0 && (() => {
          const max = attemptsState?.maxAttempts ?? question.maxAttempts ?? (isPractice ? (question.checkpointId ? 2 : 2) : 1);
          const remaining = attemptsState?.attemptsRemaining ?? max;
          const completed = attemptsState?.isComplete;
          const correct = attemptsState?.isCorrect;

          return (
            <span className={cn(
              "text-xs font-semibold border rounded-full px-2.5 py-0.5 inline-flex items-center gap-1 font-mono transition-all duration-200",
              completed
                ? correct
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            )}>
              {completed
                ? correct
                  ? "Completed · Correct"
                  : "Completed · Incorrect"
                : `${remaining} of ${max} attempts remaining`}
            </span>
          );
        })()}

        <span className="text-sm text-slate-400 w-full sm:w-auto sm:ml-1">{MODE_HELPER[mode]}</span>
      </div>

      {/* Stem */}
      <div className="font-serif text-lg md:text-xl font-semibold text-slate-900 leading-relaxed">
        <RichContentRenderer content={question.stem} />
      </div>

      {question.studentInstructions && (
        <div className="mt-2 text-sm text-slate-500 leading-relaxed">
          <RichContentRenderer content={question.studentInstructions} />
        </div>
      )}

      {/* Answer area */}
      <div className="mt-6">
        {isMc ? (
          <LearnMCQuestion
            choices={deliveredChoices}
            selectedChoiceId={selectedChoiceId}
            onSelectChoice={onSelectChoice}
            isSubmitted={isSubmitted}
            selectedCorrect={selectedCorrect}
            {...{ ["correct" + "ChoiceId"]: rightChoiceId }}
          />
        ) : (
          <LearnSAQuestion
            value={saValue}
            onChange={onSaChange}
            isSubmitted={isSubmitted}
            autosaveState={autosaveState}
            isPractice={isPractice}
          />
        )}
      </div>

      {/* Action / status */}
      <div className="mt-6">
        {!isSubmitted ? (
          <div className="space-y-4">
            {isMc && attemptsState && attemptsState.attemptsCount > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-slate-700 rounded-2xl p-4 text-sm flex items-start gap-3">
                <RefreshCw className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-amber-800 block">Not quite. Try again!</span>
                  <span className="text-slate-600 leading-relaxed block">
                    You have used <strong>{attemptsState.attemptsCount}</strong> of <strong>{attemptsState.maxAttempts}</strong> attempts. You have <strong>{attemptsState.attemptsRemaining}</strong> attempts remaining before your final answer is scored.
                  </span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSaving || !canSubmit}
              className={cn(
                "learn-focusable inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-colors duration-150 outline-none",
                "focus-visible:ring-4 focus-visible:ring-indigo-500/30",
                canSubmit && !isSaving
                  ? "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer shadow-sm"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed",
              )}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Submitting…
                </>
              ) : (
                isPractice ? "Submit for feedback" : "Submit"
              )}
            </button>
          </div>
        ) : (
          <SubmittedState
            isMc={isMc}
            isPractice={isPractice}
            mcFeedback={isPractice ? mcFeedback : undefined}
            saGradingState={saGradingState}
            saFeedback={saFeedback}
            maxPoints={question.points || 0}
            reduceMotion={!!reduceMotion}
            onRevise={onRevise}
            onContinue={onContinue}
          />
        )}
      </div>
    </motion.section>
  );
}

/** Calm, animated submitted/feedback state. Assessment never reveals correctness. */
function SubmittedState({
  isMc,
  isPractice,
  mcFeedback,
  saGradingState,
  saFeedback,
  maxPoints,
  reduceMotion,
  onRevise,
  onContinue,
}: {
  isMc: boolean;
  isPractice: boolean;
  mcFeedback?: McFeedback;
  saGradingState: SaGradingState;
  saFeedback?: SaFeedbackData;
  maxPoints: number;
  reduceMotion: boolean;
  onRevise?: () => void;
  onContinue?: () => void;
}) {
  const enter = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } };

  // Assessment: a single calm, neutral confirmation. No correctness, no score, no feedback.
  if (!isPractice) {
    return (
      <motion.div {...enter} className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
        <SuccessBadge reduceMotion={reduceMotion} tone="neutral" />
        <span>Submitted for teacher review.</span>
      </motion.div>
    );
  }

  // Practice MC
  if (isMc) {
    if (!mcFeedback) {
      return (
        <motion.div {...enter} className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <SuccessBadge reduceMotion={reduceMotion} tone="neutral" />
          <span>Submitted</span>
        </motion.div>
      );
    }
    return (
      <motion.div {...enter} className="space-y-3">
        <div
          className={cn(
            "flex items-center gap-2.5 text-sm font-semibold",
            mcFeedback.correct ? "text-emerald-700" : "text-amber-700",
          )}
        >
          <SuccessBadge reduceMotion={reduceMotion} tone={mcFeedback.correct ? "success" : "soft"} />
          <span>{mcFeedback.correct ? "Nice work — that’s correct." : "Not quite. Review and keep going."}</span>
        </div>
        {mcFeedback.desc && (
          <div
            className={cn(
              "rounded-2xl border p-4 text-sm leading-relaxed",
              mcFeedback.correct
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-amber-50 border-amber-200 text-amber-900",
            )}
          >
            <RichContentRenderer content={mcFeedback.desc} />
          </div>
        )}
      </motion.div>
    );
  }

  // ==== Practice SA States ====

  if (saGradingState === "scoring" || saGradingState === "pending_ai" || saGradingState === "submitting" || saGradingState === "submitted") {
    // We add a rotating status for the active scoring feel
    const [scoringPlaqueIdx, setScoringPlaqueIdx] = useState(0);
    const scoringStates = [
      "Checking your explanation",
      "Comparing your answer to the success criteria",
      "Preparing feedback",
      "Almost ready"
    ];

    useEffect(() => {
      const interval = setInterval(() => {
        setScoringPlaqueIdx(prev => (prev + 1) % scoringStates.length);
      }, 3000);
      return () => clearInterval(interval);
    }, [scoringStates.length]);

    return (
      <motion.div {...enter} className="space-y-2">
         <div className="flex items-center gap-2.5 text-sm font-medium text-indigo-700">
           <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
           <span className="font-semibold tracking-tight text-[15px]">Reading your response…</span>
         </div>
         <p className="text-sm text-indigo-600/80 ml-6.5 transition-opacity duration-300">
           {scoringStates[scoringPlaqueIdx]}
         </p>
      </motion.div>
    );
  }

  if (saGradingState === "feedback_delayed") {
    return (
      <motion.div {...enter} className="space-y-4">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <SuccessBadge reduceMotion={reduceMotion} tone="neutral" />
          <span>Your response is saved. Feedback is still being prepared.</span>
        </div>
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="rounded-xl bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition inline-flex"
          >
            Continue and check feedback later
          </button>
        )}
      </motion.div>
    );
  }

  if (saGradingState === "needs_teacher_review" || saGradingState === "grading_failed") {
    return (
      <motion.div {...enter} className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
        <SuccessBadge reduceMotion={reduceMotion} tone="neutral" />
        <span>Your response was saved. Your teacher will review this response.</span>
      </motion.div>
    );
  }

  if (saGradingState === "feedback_ready" && saFeedback && saFeedback.score !== undefined) {
    const { score, feedback, rubricBreakdown, misconceptions } = saFeedback;
    const isPerfect = score === maxPoints;
    const isTooShort = saFeedback.score === 0 && (!feedback || feedback.toLowerCase().includes("too short")); 

    if (isTooShort) {
       return (
         <motion.div {...enter} className="space-y-4">
           <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
             <div className="space-y-1">
               <div className="flex items-center gap-2 text-amber-700">
                 <AlertTriangle className="w-5 h-5 shrink-0" />
                 <span className="font-semibold">Add more detail</span>
               </div>
               <p className="text-[15px] font-serif text-slate-700 leading-relaxed mt-2">
                 Your response is too short to score meaningfully. Add a complete explanation in your own words.
               </p>
             </div>
           </div>
           <div className="flex flex-wrap items-center gap-3 mt-4">
             {onRevise && (
               <button
                 type="button"
                 onClick={onRevise}
                 className="rounded-xl px-5 py-2.5 bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition"
               >
                 Revise response
               </button>
             )}
             {onContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  className="rounded-xl px-5 py-2.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition"
                >
                  Continue
                </button>
             )}
           </div>
         </motion.div>
       );
    }

    const containerVariants = reduceMotion ? {} : {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: { staggerChildren: 0.15 }
      }
    };

    const itemVariants = reduceMotion ? {} as any : {
      hidden: { opacity: 0, y: 10 },
      show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } }
    };

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="space-y-6"
      >
        {/* Header / Score */}
        <motion.div variants={itemVariants} className="flex items-center justify-between">
           <div className="flex flex-col">
             <span className="font-semibold text-emerald-800 text-[15px]">
                {isPerfect ? "Great work" : "Feedback ready"}
             </span>
             <div className="flex items-center gap-2 mt-1">
               <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-sm font-bold text-slate-700 tabular-nums">
                 {score} / {maxPoints} points
               </span>
             </div>
           </div>
        </motion.div>

        {/* Written Feedback */}
        {feedback && (
          <motion.div variants={itemVariants} className="text-[15px] leading-relaxed text-slate-800 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 prose max-w-none">
             <RichContentRenderer content={feedback} />
          </motion.div>
        )}

        {/* Misconceptions / To Improve */}
        {misconceptions && misconceptions.length > 0 && (
          <motion.div variants={itemVariants} className="space-y-2">
            <h4 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Improve this
            </h4>
            <ul className="text-[15px] text-amber-900 leading-relaxed list-disc list-inside space-y-1 ml-1">
              {misconceptions.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </motion.div>
        )}

        {/* Rubric Criteria */}
        {rubricBreakdown && Object.keys(rubricBreakdown).length > 0 && (
          <motion.div variants={itemVariants} className="space-y-3">
             <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Success criteria</h4>
             <ul className="space-y-2">
                {Object.entries(rubricBreakdown).map(([category, rData]) => {
                   const rScore = Number(rData.score) || 0;
                   const rMax = Number(rData.maxScore) || 1;
                   const resultText = rScore === rMax ? "Met" : rScore > 0 ? "Partial" : "Missing";
                   const resultColor = rScore === rMax ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                                      rScore > 0 ? "text-amber-700 bg-amber-50 border-amber-200" :
                                      "text-slate-600 bg-slate-50 border-slate-200";

                   return (
                     <li key={category} className="flex sm:items-center sm:justify-between flex-col sm:flex-row gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                       <span className="text-sm font-medium text-slate-700">{category}</span>
                       <span className={cn("text-xs font-bold px-2 py-0.5 rounded border self-start sm:self-auto", resultColor)}>
                         {resultText}
                       </span>
                     </li>
                   );
                })}
             </ul>
          </motion.div>
        )}

        {/* Action Buttons */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3 pt-2">
           {!isPerfect && onRevise && (
             <button
               type="button"
               onClick={onRevise}
               className="rounded-xl px-5 py-2.5 bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition"
             >
               Revise my answer
             </button>
           )}
           <button
              type="button"
              onClick={onContinue}
              className={cn(
                "rounded-xl px-5 py-2.5 font-semibold transition",
                isPerfect || !onRevise 
                   ? "bg-indigo-600 text-white hover:bg-indigo-700" 
                   : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              )}
           >
              Continue
           </button>
        </motion.div>
      </motion.div>
    );
  }

  // Default fallback
  return (
    <motion.div {...enter} className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
      <SuccessBadge reduceMotion={reduceMotion} tone="neutral" />
      <span>Submitted</span>
    </motion.div>
  );
}

/** A small animated badge — gentle scale-in checkmark, no bounce/confetti. */
function SuccessBadge({
  reduceMotion,
  tone,
}: {
  reduceMotion: boolean;
  tone: "success" | "neutral" | "soft";
}) {
  const cls =
    tone === "success"
      ? "bg-emerald-500 text-white"
      : tone === "soft"
      ? "bg-amber-500 text-white"
      : "bg-slate-200 text-slate-600";
  return (
    <motion.span
      initial={reduceMotion ? false : { scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 24 }}
      className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full", cls)}
      aria-hidden="true"
    >
      <Check className="w-3.5 h-3.5 stroke-[3]" />
    </motion.span>
  );
}

import { motion, useReducedMotion } from "motion/react";
import { Check, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

export interface LearnMCChoice {
  id: string;
  text: any;
}

export interface LearnMCQuestionProps {
  /** Delivered choices (scrambled order, stable ids). */
  choices: LearnMCChoice[];
  /** Currently selected choice id. */
  selectedChoiceId?: string;
  /** Called when a choice is chosen. No-op when locked. */
  onSelectChoice?: (id: string) => void;
  /** When submitted, the choices lock and the selection is shown as final. */
  isSubmitted?: boolean;
  /**
    * Practice-only correctness for the *selected* choice. Never reveals which other
    * choice is correct — only whether the student's own pick was right. Omitted
    * entirely for assessment questions so correctness is never shown.
    */
  selectedCorrect?: boolean;
  /** Explicitly revealed correct choice ID (revealed only upon question completion). */
  correctChoiceId?: string;
  /** The state of the attempts for MC. */
  attemptsState?: {
    attemptsCount: number;
    maxAttempts: number;
    attemptsRemaining: number;
    isComplete: boolean;
    isCorrect: boolean;
    attemptsHistory?: any[];
  };
  /** Whether the current block/checkpoint is a practice question. */
  isPractice?: boolean;
}

/**
 * VERITAS Learn multiple-choice answer rows.
 *
 * Adapted from the VERITASAssess MCStudent visual language (large clickable rows,
 * fixed A/B/C/D letter markers, polished selected state) into a bright, calm
 * light-mode Learn surface. Keyboard accessible; status is never color-only.
 */
export function LearnMCQuestion({
  choices,
  selectedChoiceId,
  onSelectChoice,
  isSubmitted,
  selectedCorrect,
  correctChoiceId,
  attemptsState,
  isPractice,
}: LearnMCQuestionProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid grid-cols-1 gap-3" role="radiogroup" aria-label="Answer choices">
      {choices.map((choice, i) => {
        const letter = String.fromCharCode(65 + i);
        const isSelected =
          selectedChoiceId !== undefined && String(selectedChoiceId) === String(choice.id);

        // If correct choice ID is explicitly provided (after question completion):
        const hasRevealedCorrect = correctChoiceId !== undefined && correctChoiceId !== null && correctChoiceId !== "";
        const isThisChoiceCorrect = hasRevealedCorrect && String(choice.id) === String(correctChoiceId);

        let showCorrect = false;
        let showIncorrect = false;

        if (isPractice) {
          if (attemptsState?.isComplete) {
            if (hasRevealedCorrect) {
              showCorrect = isThisChoiceCorrect;
              showIncorrect = isSelected && !isThisChoiceCorrect;
            } else {
              showCorrect = isSelected && selectedCorrect === true;
              showIncorrect = isSelected && selectedCorrect === false;
            }
          } else {
            // Check history for prior failed attempts
            const historyEntry = attemptsState?.attemptsHistory?.find(
              (h: any) => String(h.responseValue) === String(choice.id)
            );
            if (historyEntry) {
              showCorrect = historyEntry.isCorrect === true;
              showIncorrect = historyEntry.isCorrect === false;
            } else {
              // Active incorrect choice before changing selection
              if (isSelected && selectedCorrect !== undefined) {
                showCorrect = selectedCorrect === true;
                showIncorrect = selectedCorrect === false;
              }
            }
          }
        } else {
          // Assessment mode: never reveal correct/incorrect inline
          showCorrect = false;
          showIncorrect = false;
        }

        return (
          <motion.button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={isSubmitted}
            onClick={() => !isSubmitted && onSelectChoice?.(choice.id)}
            whileTap={!isSubmitted && !reduceMotion ? { scale: 0.99 } : undefined}
            whileHover={!isSubmitted && !reduceMotion ? { y: -1 } : undefined}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "learn-focusable group w-full text-left px-4 md:px-5 py-4 rounded-2xl border-2 flex items-start gap-4 transition-colors duration-150 outline-none",
              "focus-visible:ring-4 focus-visible:ring-indigo-500/25 focus-visible:border-indigo-400",
              showCorrect
                ? "bg-emerald-50 border-emerald-400"
                : showIncorrect
                ? "bg-rose-50 border-rose-300"
                : isSelected
                ? "bg-indigo-50 border-indigo-500 shadow-sm"
                : isSubmitted
                ? "bg-white border-slate-200 opacity-70 cursor-default"
                : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer shadow-sm",
            )}
          >
            <span
              className={cn(
                "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold border-2 mt-0.5 transition-colors duration-150",
                showCorrect
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : showIncorrect
                  ? "bg-rose-500 border-rose-500 text-white"
                  : isSelected
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-slate-50 border-slate-200 text-slate-500 group-hover:border-indigo-300 group-hover:text-indigo-600",
              )}
              aria-hidden="true"
            >
              {showCorrect ? (
                <motion.span
                  initial={reduceMotion ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                </motion.span>
              ) : showIncorrect ? (
                <motion.span
                  initial={reduceMotion ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                >
                  <X className="w-4 h-4 stroke-[3]" />
                </motion.span>
              ) : (
                letter
              )}
            </span>

            <div
              className={cn(
                "flex-1 min-w-0 font-serif text-[15px] md:text-base leading-relaxed pt-1",
                isSelected ? "text-slate-900 font-medium" : "text-slate-700",
              )}
            >
              <RichContentRenderer content={choice.text} />
            </div>

            {/* Non-color selection indicator for accessibility */}
            {isSelected && !showCorrect && !showIncorrect && (
              <span className="shrink-0 mt-2 w-2.5 h-2.5 rounded-full bg-indigo-500" aria-hidden="true" />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

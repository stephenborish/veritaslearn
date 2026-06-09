import { useState } from "react";
import { ChevronDown, BookMarked, AlertTriangle } from "lucide-react";
import { RichContentRenderer, getPlainText } from "../../RichContent/RichContentRenderer";
import { AIGradingPanel } from "./AIGradingPanel";
import { ManualScoreEditor } from "./ManualScoreEditor";
import type { ReviewBinding } from "./reviewBinding";

/**
 * Short-answer grading workspace: prompt → student response → teacher-only
 * scoring context (rubric / model answer / guidance, collapsible) → AI grading →
 * manual scoring.
 */
export function ShortAnswerReviewCard({
  question,
  block,
  response,
  draftText,
  maxPoints,
  review,
}: {
  question: any;
  block: any;
  response: any;
  draftText?: string | null;
  maxPoints: number;
  review: ReviewBinding;
}) {
  const promptContent =
    question?.stem || question?.description || block?.singleQuestion?.stem || block?.questionPool?.description || "No prompt text.";
  const answerText = response?.responseValue ?? "";

  return (
    <div className="space-y-4">
      {/* Prompt */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Prompt</span>
        <div className="text-[13px] leading-relaxed text-slate-800">
          <RichContentRenderer content={promptContent} />
        </div>
      </div>

      {/* Student response */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Student response</span>
        {response ? (
          answerText && String(answerText).trim() !== "" ? (
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-800">{answerText}</div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-[12px] italic text-slate-400">
              The student submitted an empty response.
            </div>
          )
        ) : draftText && draftText.trim() !== "" ? (
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              Draft · not submitted
            </span>
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-800">{draftText}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-[12px] italic text-slate-400">
            No response submitted or drafted yet.
          </div>
        )}

        {response?.isLowEffort && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <strong className="block text-[12px] font-bold">Short response — worth a closer look</strong>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800">
                {response.lowEffortReason || "Response was very short or lacked substantive content."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Teacher-only scoring context */}
      <ScoringContext question={question} />

      {/* AI grading */}
      {response && <AIGradingPanel response={response} maxPoints={maxPoints} review={review} />}

      {/* Manual scoring */}
      {response && <ManualScoreEditor response={response} maxPoints={maxPoints} review={review} showFeedback />}
    </div>
  );
}

function ScoringContext({ question }: { question: any }) {
  const hasRubric = Array.isArray(question?.rubricCategories) && question.rubricCategories.length > 0;
  const hasModel = !!(question?.modelAnswer || question?.answerKey);
  const hasGuidance = !!question?.aiScoringGuidance;
  if (!hasRubric && !hasModel && !hasGuidance) return null;

  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-200 bg-indigo-50/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-[12px] font-bold text-indigo-800">
          <BookMarked className="h-4 w-4" /> Scoring context
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">Teacher-only</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-indigo-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-indigo-100 px-4 py-4">
          {hasRubric && (
            <div className="space-y-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Rubric categories</span>
              {question.rubricCategories.map((r: any) => (
                <div key={r.id} className="rounded-lg border border-indigo-100 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-slate-700">{getPlainText(r.name)}</span>
                    <span className="text-[11px] font-semibold text-slate-400">{r.maxPoints} pts max</span>
                  </div>
                  {r.description && (
                    <div className="mt-1 text-[12px] leading-relaxed text-slate-600">
                      <RichContentRenderer content={r.description} />
                    </div>
                  )}
                  {r.fullCreditExample && (
                    <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11.5px] leading-relaxed text-emerald-800">
                      <strong>Full-credit example: </strong>
                      <span className="text-slate-600">
                        <RichContentRenderer content={r.fullCreditExample} />
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasModel && (
            <div className="space-y-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Model answer / ideal response</span>
              <div className="rounded-lg border border-indigo-100 bg-white p-3 text-[12px] leading-relaxed text-slate-700">
                <RichContentRenderer content={question.modelAnswer || question.answerKey} />
              </div>
            </div>
          )}

          {hasGuidance && (
            <div className="space-y-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Scoring guidance</span>
              <div className="rounded-lg border border-indigo-100 bg-white p-3 text-[12px] leading-relaxed text-slate-700">
                <RichContentRenderer content={question.aiScoringGuidance} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

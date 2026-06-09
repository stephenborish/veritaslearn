import { Video, FileText, HelpCircle, MessageSquare, Clock, BookOpen } from "lucide-react";
import { RichContentRenderer } from "../../RichContent/RichContentRenderer";
import { MultipleChoiceReviewCard } from "./MultipleChoiceReviewCard";
import { ShortAnswerReviewCard } from "./ShortAnswerReviewCard";
import { ClassComparisonCard } from "./ClassComparisonCard";
import { SignalSummaryCard } from "./SignalSummaryCard";
import {
  GRADING_STATE_LABEL,
  gradingState,
  gradingStateTone,
  formatTimestamp,
  formatActiveDuration,
  type ResolvedStep,
  type ClassComparison,
} from "./reviewModel";
import type { ReviewBinding } from "./reviewBinding";

function TypeBadge({ type }: { type: string }) {
  const meta: Record<string, { icon: any; label: string }> = {
    video: { icon: Video, label: "Video" },
    reading: { icon: FileText, label: "Reading" },
    question: { icon: MessageSquare, label: "Question" },
    checkpoint: { icon: HelpCircle, label: "Checkpoint" },
  };
  const m = meta[type] || { icon: BookOpen, label: "Step" };
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

/** The teacher's primary review surface for the currently selected step. */
export function StepReviewWorkspace({
  resolved,
  review,
  comparison,
  stepSignals,
  blocks,
  activeSeconds,
  hasActivityTiming,
  draftText,
}: {
  resolved: ResolvedStep;
  review: ReviewBinding;
  comparison: ClassComparison | null;
  stepSignals: any[];
  blocks: any[];
  activeSeconds: number;
  hasActivityTiming?: boolean;
  draftText?: string | null;
}) {
  const { step, snapshotBlock, questionDef, response, maxPoints } = resolved;
  const qType = questionDef?.type ?? step.questionType;
  const draft = response ? null : draftText ?? null;
  const state = gradingState(response, draft);
  const tone = gradingStateTone(state);
  const isGradable = step.gradable && !!questionDef;

  return (
    <div className="space-y-5">
      {/* Step header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 items-center rounded-lg bg-indigo-600 px-2.5 text-[12px] font-bold text-white">
                {step.type === "checkpoint" ? "Check" : "Step"} {step.number}
              </span>
              <TypeBadge type={step.type} />
              {step.isPractice && (
                <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-700">Practice</span>
              )}
            </div>
            <h3 className="mt-2 text-[17px] font-bold leading-tight text-slate-900">{step.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-400">
              {response?.submittedAt && <span>Submitted {formatTimestamp(response.submittedAt)}</span>}
              {activeSeconds > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatActiveDuration(activeSeconds)} active
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tone.bg} ${tone.text} ${tone.border}`}>
              {GRADING_STATE_LABEL[state]}
            </span>
            {isGradable && response && (
              <span className="text-[20px] font-bold tabular-nums text-slate-800">
                {response.teacherOverride?.score ?? response.score ?? 0}
                <span className="text-[14px] font-semibold text-slate-400"> / {maxPoints}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Review surface */}
      {qType === "mc" && questionDef ? (
        <MultipleChoiceReviewCard question={questionDef} block={snapshotBlock} response={response} maxPoints={maxPoints} />
      ) : qType === "sa" && questionDef ? (
        <ShortAnswerReviewCard
          question={questionDef}
          block={snapshotBlock}
          response={response}
          draftText={draft}
          maxPoints={maxPoints}
          review={review}
        />
      ) : (
        <NonGradableStep resolved={resolved} activeSeconds={activeSeconds} />
      )}

      {/* Class comparison */}
      {isGradable && comparison && <ClassComparisonCard comparison={comparison} />}

      {/* Step-specific integrity summary */}
      {stepSignals.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Signals on this step</span>
          <SignalSummaryCard signals={stepSignals} blocks={blocks} hasActivityTiming={hasActivityTiming} />
        </div>
      )}
    </div>
  );
}

function NonGradableStep({ resolved, activeSeconds }: { resolved: ResolvedStep; activeSeconds: number }) {
  const { step, snapshotBlock, block } = resolved;
  const src = snapshotBlock || block;

  if (step.type === "video") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
          <Video className="h-4 w-4 text-slate-400" /> Video lesson
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">
          {activeSeconds > 0 ? `The student spent ${formatActiveDuration(activeSeconds)} on this video.` : "Watch progress for this video is tracked in the activity records."}
        </p>
        {src?.description && (
          <div className="mt-3 text-[12.5px] leading-relaxed text-slate-700">
            <RichContentRenderer content={src.description} />
          </div>
        )}
      </div>
    );
  }

  if (step.type === "reading") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-slate-400" /> Reading
        </div>
        {src?.content || src?.richContent || src?.body ? (
          <div className="mt-3 text-[12.5px] leading-relaxed text-slate-700">
            <RichContentRenderer content={src.content || src.richContent || src.body} />
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">This reading has no gradable response to review.</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-[12.5px] text-slate-400">
      This step has no gradable student response.
    </div>
  );
}

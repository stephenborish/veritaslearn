import { Sparkles, AlertCircle, Check, RotateCcw, Loader2 } from "lucide-react";
import type { ReviewBinding } from "./reviewBinding";

/**
 * AI grading workspace for a short-answer response. Purple/violet is the AI
 * identity. Surfaces status, proposed score, rationale (teacher-only), feedback,
 * and rubric breakdown, plus run / re-run / accept actions. AI never silently
 * overwrites a teacher override — accepting is an explicit teacher action.
 */
export function AIGradingPanel({
  response,
  maxPoints,
  review,
}: {
  response: any;
  maxPoints: number;
  review: ReviewBinding;
}) {
  const action = review.actionStates[response.id];
  const ai = response.aiGrading;
  const status: string | undefined = ai?.status;
  const running = action?.loading || status === "pending";
  const failed = status === "failed";
  const hasResult = ai && status && status !== "pending";

  const isReviewed = !!(
    response.teacherReviewedAt ||
    (response.teacherOverride?.score !== null && response.teacherOverride?.score !== undefined)
  );
  const isReleased = !!(
    response.feedbackReleasedAt || response.aiFeedbackReleasedAt || response.feedbackVisibleToStudent
  );

  const parsedGradedAt = ai?.gradedAt ? new Date(ai.gradedAt).getTime() : 0;
  // If it's running but has been in pending for > 2 minutes (120,000ms), let the user force trigger / retry
  const isStalePending = status === "pending" && parsedGradedAt > 0 && (Date.now() - parsedGradedAt > 120000);

  const Header = (
    <div className="flex items-center justify-between border-b border-violet-100 pb-2">
      <span className="flex items-center gap-1.5 text-[12px] font-bold text-violet-700">
        <Sparkles className="h-4 w-4" /> AI grading
      </span>
      {ai?.confidence !== undefined && hasResult && (
        <span className="text-[11px] font-semibold text-violet-500">
          Confidence {Math.round((ai.confidence || 0) * 100)}%
        </span>
      )}
    </div>
  );

  if (running) {
    return (
      <Shell>
        {Header}
        <div className="flex min-h-[85px] flex-col items-center justify-center gap-2 py-4 text-violet-600">
          {isStalePending ? (
            <div className="flex flex-col items-center gap-2.5 text-center">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
                <AlertCircle className="h-4 w-4" /> AI grading appears stuck
              </span>
              <p className="max-w-md text-center text-[11px] leading-relaxed text-slate-600">
                This grading pass has been pending for over 2 minutes and may have timed out. You can securely trigger a fresh grading attempt.
              </p>
              {review.canReviewAction && (
                <RunButton 
                  label="Retry grading" 
                  onClick={() => review.reviewAction("grade", response.id)} 
                  disabled={!!action?.loading} 
                  icon={RotateCcw} 
                />
              )}
            </div>
          ) : (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-[11px] font-semibold uppercase tracking-wide">Running AI grader…</span>
            </>
          )}
        </div>
      </Shell>
    );
  }

  if (failed) {
    return (
      <Shell>
        {Header}
        <div className="flex items-start gap-2 py-1 text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong className="block text-[12px] font-bold">AI grading didn't finish</strong>
            <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-rose-700">
              {ai?.errorMessage || "An unexpected error occurred. You can grade manually below, or re-run the AI grader."}
            </p>
          </div>
        </div>
        {review.canReviewAction && (
          <div className="flex justify-end pt-1">
            <RunButton label="Re-run AI grader" onClick={() => review.reviewAction("grade", response.id)} disabled={!!action?.loading} icon={RotateCcw} />
          </div>
        )}
      </Shell>
    );
  }

  if (!hasResult) {
    return (
      <Shell>
        {Header}
        <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] leading-relaxed text-violet-900/80">
            Score this written response with the rubric and generate student-facing commentary.
          </p>
          {review.canReviewAction && (
            <RunButton label="Run AI grader" onClick={() => review.reviewAction("grade", response.id)} disabled={!!action?.loading} icon={Sparkles} />
          )}
        </div>
      </Shell>
    );
  }

  const proposed = ai.parsedScore ?? ai.score;
  const currentRegisterValue = response.score ?? response.pointsEarned;
  // If the score is active and matches proposed, and has an accept flag
  const isAiScoreActive = hasResult && currentRegisterValue === proposed && !!response.teacherOverride?.acceptedFromAi;
  // Manual override is active if current final score is set, different from proposed, and not flagged as accepted AI
  const hasManualOverride = hasResult && currentRegisterValue !== proposed && (response.teacherOverrideScore !== undefined && response.teacherOverrideScore !== null);

  return (
    <Shell>
      {Header}

      {proposed !== undefined && proposed !== null && (
        <div className="flex items-center justify-between rounded-lg border border-violet-100 bg-white/70 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-500">Proposed score</span>
          <span className="text-[15px] font-bold text-violet-700 tabular-nums">
            {proposed} / {maxPoints}
          </span>
        </div>
      )}

      {ai.rationale && (
        <Section label="Teacher-only rationale" teacherOnly>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">{ai.rationale}</p>
        </Section>
      )}

      {ai.feedback && (
        <Section label="Student-facing explanation">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">{ai.feedback}</p>
        </Section>
      )}

      {ai.rubricBreakdown && Object.keys(ai.rubricBreakdown).length > 0 && (
        <Section label="Rubric breakdown" teacherOnly>
          <div className="space-y-1.5">
            {Object.entries(ai.rubricBreakdown).map(([criterion, item]: any) => (
              <div key={criterion} className="rounded-md border border-violet-100 bg-white/70 px-2.5 py-1.5">
                <div className="flex items-center justify-between text-[12px] font-bold text-violet-900">
                  <span>{criterion}</span>
                  <span className="tabular-nums">{item.score} pts</span>
                </div>
                {item.feedback && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{item.feedback}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {review.canReviewAction && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-violet-100 pt-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            {isAiScoreActive ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                <Check className="h-3 w-3" /> AI score active
              </span>
            ) : hasManualOverride ? (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-amber-800">
                Manual score preserved ({currentRegisterValue} pts)
              </span>
            ) : isReviewed ? (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-slate-800">
                Current score: {currentRegisterValue} pts
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <RunButton label="Re-run" onClick={() => review.reviewAction("grade", response.id)} disabled={!!action?.loading} icon={RotateCcw} subtle />
            {status === "success" && !isAiScoreActive && !isReleased && (
              <button
                type="button"
                onClick={() => review.reviewAction("approve", response.id)}
                disabled={!!action?.loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Accept AI score
              </button>
            )}
          </div>
        </div>
      )}
      {action?.error && (
        <p className="text-right text-[11px] font-semibold text-rose-600">{action.error}</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4">{children}</div>;
}

function Section({ label, teacherOnly, children }: { label: string; teacherOnly?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">{label}</span>
        {teacherOnly && (
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-600">Teacher-only</span>
        )}
      </div>
      {children}
    </div>
  );
}

function RunButton({
  label,
  onClick,
  disabled,
  icon: Icon,
  subtle,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  icon: any;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ${
        subtle
          ? "border border-violet-200 bg-white text-violet-700 hover:bg-violet-50"
          : "bg-violet-600 text-white hover:bg-violet-700"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

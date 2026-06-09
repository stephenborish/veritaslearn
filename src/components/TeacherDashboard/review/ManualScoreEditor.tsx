import { Check, Minus, Plus, Lock, Send } from "lucide-react";
import type { ReviewBinding } from "./reviewBinding";

/**
 * Manual teacher scoring. Score is clamped to [0, maxPoints]; private notes never
 * reach students. Optional student-facing commentary + release action for short
 * answers. Saving status is always visible so the teacher never wonders whether
 * the grade persisted.
 */
export function ManualScoreEditor({
  response,
  maxPoints,
  review,
  showFeedback = false,
}: {
  response: any;
  maxPoints: number;
  review: ReviewBinding;
  showFeedback?: boolean;
}) {
  const id = response.id;
  const saving = review.savingState[id];
  const saved = review.saveSuccess[id];
  const action = review.actionStates[id];

  const scoreValue =
    review.overrideScores[id] !== undefined
      ? review.overrideScores[id]
      : response.teacherOverride?.score ?? response.score ?? 0;
  const notesValue =
    review.overrideNotes[id] !== undefined
      ? review.overrideNotes[id]
      : response.teacherOverride?.notes ?? response.notes ?? "";
  const feedbackValue =
    review.editedFeedbacks[id] !== undefined
      ? review.editedFeedbacks[id]
      : response.studentFacingFeedback || response.aiFeedback || response.aiGrading?.rationale || "";

  const clamp = (n: number) => Math.max(0, Math.min(maxPoints || 0, n));
  const setScore = (n: number) => review.setOverrideScore(id, clamp(Number.isFinite(n) ? n : 0));

  const isReleased = !!(response.feedbackReleasedAt || response.aiFeedbackReleasedAt || response.feedbackVisibleToStudent);
  const isReviewed = !!(
    response.teacherReviewedAt ||
    (response.teacherOverride?.score !== null && response.teacherOverride?.score !== undefined)
  );

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-700">Teacher scoring</span>
        {isReleased ? (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            Feedback released
          </span>
        ) : isReviewed ? (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Reviewed · not released
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Score</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScore(Number(scoreValue) - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
              aria-label="Decrease score"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-baseline rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <input
                type="number"
                min={0}
                max={maxPoints}
                value={scoreValue}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-12 bg-transparent text-center text-[15px] font-bold tabular-nums text-slate-800 focus:outline-none"
              />
              <span className="text-[12px] font-semibold text-slate-400">/ {maxPoints}</span>
            </div>
            <button
              type="button"
              onClick={() => setScore(Number(scoreValue) + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
              aria-label="Increase score"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="min-w-[200px] flex-1">
          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <Lock className="h-3 w-3" /> Private notes (teacher-only)
          </label>
          <textarea
            value={notesValue}
            onChange={(e) => review.setOverrideNote(id, e.target.value)}
            placeholder="Notes for yourself — never shown to the student…"
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] leading-relaxed text-slate-700 placeholder:text-slate-300 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </div>
      </div>

      {showFeedback && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Student-facing commentary <span className="text-slate-300">· sent on release</span>
          </label>
          <textarea
            value={feedbackValue}
            onChange={(e) => review.setEditedFeedback(id, e.target.value)}
            placeholder="Encouraging, specific feedback the student will see when you release it…"
            rows={3}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] leading-relaxed text-slate-700 placeholder:text-slate-300 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
          {action?.error && (
            <span className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">{action.error}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showFeedback && review.canReviewAction && isReviewed && !isReleased && (
            <button
              type="button"
              onClick={() => review.reviewAction("release-feedback", id)}
              disabled={!!action?.loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> Release feedback
            </button>
          )}
          <button
            type="button"
            onClick={() => review.saveOverride(id, maxPoints)}
            disabled={saving || !!action?.loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A192F] px-4 py-2 text-[12px] font-bold text-white transition hover:bg-[#15294b] disabled:bg-slate-300"
          >
            {saving ? "Saving…" : "Save score"}
          </button>
        </div>
      </div>
    </div>
  );
}

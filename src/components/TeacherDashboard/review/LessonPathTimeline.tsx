import { Video, FileText, HelpCircle, MessageSquare, Check, ShieldAlert, ChevronRight } from "lucide-react";
import { GRADING_STATE_LABEL, gradingStateTone, formatTimestamp, formatActiveDuration, type StepRow } from "./reviewModel";

function StepIcon({ type, className }: { type: string; className?: string }) {
  if (type === "video") return <Video className={className} />;
  if (type === "reading") return <FileText className={className} />;
  if (type === "checkpoint") return <HelpCircle className={className} />;
  if (type === "question") return <MessageSquare className={className} />;
  return <FileText className={className} />;
}

/** The student's path through the lesson. Selecting a step focuses the workspace. */
export function LessonPathTimeline({
  rows,
  activeStepId,
  onSelect,
}: {
  rows: StepRow[];
  activeStepId: string | null;
  onSelect: (stepId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const active = row.step.id === activeStepId;
        const tone = gradingStateTone(row.state);
        const gradable = row.step.gradable;
        const done = row.state === "released" || row.state === "reviewed" || row.state === "ai_scored" || (gradable && row.hasResponse) || (!gradable && row.reached);

        return (
          <button
            key={row.step.id}
            type="button"
            onClick={() => onSelect(row.step.id)}
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
              active
                ? "border-indigo-400 bg-indigo-50/70 ring-1 ring-indigo-300"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-lg ${
                done ? "bg-emerald-100 text-emerald-700" : active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-400"
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : <StepIcon type={row.step.type} className="h-4 w-4" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {row.step.type === "checkpoint" ? "Check" : "Step"} {row.step.number}
                </span>
                {row.step.isPractice && (
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700">Practice</span>
                )}
              </div>
              <div className="truncate text-[13px] font-semibold text-slate-800">{row.step.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-slate-400">
                {row.activeSeconds > 0 && <span>{formatActiveDuration(row.activeSeconds)} active</span>}
                {row.submittedAt && <span>{formatTimestamp(row.submittedAt)}</span>}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              {gradable && row.hasResponse && (
                <span className="text-[12px] font-bold tabular-nums text-slate-700">
                  {row.score ?? 0}/{row.maxPoints}
                </span>
              )}
              <div className="flex items-center gap-1">
                {row.signalCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                    <ShieldAlert className="h-2.5 w-2.5" /> {row.signalCount}
                  </span>
                )}
                {row.state === "needs_review" && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Review</span>
                )}
                {gradable && row.hasResponse && row.state !== "needs_review" && (
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.bg} ${tone.text} ${tone.border}`}>
                    {row.state === "released"
                      ? "Released"
                      : row.state === "reviewed"
                      ? "Reviewed"
                      : row.state === "ai_scored"
                      ? "AI"
                      : row.state === "auto_scored"
                      ? "Scored"
                      : row.state === "awaiting_ai"
                      ? "Pending"
                      : ""}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className={`h-4 w-4 shrink-0 ${active ? "text-indigo-400" : "text-slate-300"}`} />
          </button>
        );
      })}
    </div>
  );
}

export { GRADING_STATE_LABEL };

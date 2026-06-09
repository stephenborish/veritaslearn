import { Check, X, CircleSlash, ListChecks } from "lucide-react";
import { RichContentRenderer } from "../../RichContent/RichContentRenderer";
import { selectedChoiceId, choiceLetter, resolveChoiceText } from "./reviewModel";

/**
 * Teacher-facing multiple-choice review. Shows the full formatted stem, every
 * answer choice as a readable card, and clearly marks the correct answer and the
 * student's selection. Reads snapshot-resolved question data passed by the parent.
 */
export function MultipleChoiceReviewCard({
  question,
  block,
  response,
  maxPoints,
}: {
  question: any;
  block: any;
  response: any;
  maxPoints: number;
}) {
  const studentValue = response?.responseValue;
  const hasValue = studentValue !== undefined && studentValue !== null && String(studentValue).trim() !== "";
  const choices: any[] = Array.isArray(question?.choices) ? question.choices : [];
  const selectedId = selectedChoiceId(question, studentValue);
  const correctId = String(question?.correctChoiceId ?? "");
  const resolvedSelected = hasValue && choices.some((c) => String(c.id) === selectedId);
  const isCorrect = !!response?.isCorrect;

  return (
    <div className="space-y-4">
      {/* Stem */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Question</span>
        <div className="text-[13px] leading-relaxed text-slate-800">
          <RichContentRenderer
            content={
              question?.stem ||
              question?.description ||
              block?.singleQuestion?.stem ||
              block?.questionPool?.description ||
              "No question text."
            }
          />
        </div>
      </div>

      {/* Answer outcome banner */}
      {hasValue ? (
        <div
          className={`flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-[13px] font-semibold ${
            isCorrect
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {isCorrect ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {isCorrect ? "Student answered correctly" : "Student answered incorrectly"}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-500">
          <CircleSlash className="h-4 w-4" /> No answer submitted for this question
        </div>
      )}

      {/* Choices */}
      <div className="space-y-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <ListChecks className="h-3.5 w-3.5" /> Answer choices
        </span>

        {hasValue && !resolvedSelected && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-rose-900">
            <strong>The student's saved choice no longer maps to a listed option.</strong>
            <span className="mt-0.5 block text-[11px] text-rose-700">
              Saved value: {String(studentValue)}
              {response?.responseText ? ` — "${response.responseText}"` : ""}
            </span>
          </div>
        )}

        {choices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-[12px] italic text-slate-400">
            No answer choices are available in this lesson version.
          </div>
        ) : (
          choices.map((choice: any, index: number) => {
            const cid = String(choice.id);
            const isSelected = hasValue && cid === selectedId;
            const isCorrectChoice = cid === correctId;
            const letter = String.fromCharCode(65 + index);

            let frame = "border-slate-200 bg-white";
            let badge: { text: string; cls: string; icon: any } | null = null;
            if (isSelected && isCorrectChoice) {
              frame = "border-emerald-300 bg-emerald-50/60";
              badge = { text: "Student selected · Correct", cls: "bg-emerald-100 text-emerald-800", icon: Check };
            } else if (isSelected) {
              frame = "border-rose-300 bg-rose-50/50";
              badge = { text: "Student selected", cls: "bg-rose-100 text-rose-800", icon: X };
            } else if (isCorrectChoice) {
              frame = "border-emerald-200 bg-emerald-50/30";
              badge = { text: "Correct answer", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", icon: Check };
            }
            const Icon = badge?.icon;

            return (
              <div
                key={choice.id}
                className={`flex flex-col gap-2 rounded-lg border p-3 transition sm:flex-row sm:items-center sm:justify-between ${frame}`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      isSelected ? "bg-slate-800 text-white" : isCorrectChoice ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {letter}
                  </span>
                  <div className="min-w-0 flex-1 break-words text-[13px] text-slate-800">
                    <RichContentRenderer content={choice.text} />
                  </div>
                </div>
                {badge && Icon && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 self-start rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:self-center ${badge.cls}`}
                  >
                    <Icon className="h-3 w-3" /> {badge.text}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Score outcome */}
      <McScoreOutcome question={question} block={block} response={response} maxPoints={maxPoints} />
    </div>
  );
}

function McScoreOutcome({ question, block, response, maxPoints }: { question: any; block: any; response: any; maxPoints: number }) {
  if (!response) return null;
  const autoScore = response.autoScore ?? response.score ?? 0;
  const finalScore = response.teacherOverride?.score ?? response.score ?? 0;
  const overridden = !!response.teacherOverride;
  const attempts = response.attemptsCount ?? null;
  const maxAttempts = response.maxAttempts ?? question?.maxAttempts ?? null;
  const history = Array.isArray(response.attemptsHistory) ? response.attemptsHistory : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <ScoreStat label="Auto score" value={`${autoScore} / ${maxPoints}`} />
          {overridden && <ScoreStat label="Final score" value={`${finalScore} / ${maxPoints}`} tone="indigo" />}
          {attempts !== null && (
            <ScoreStat label="Attempts" value={maxAttempts ? `${attempts} / ${maxAttempts}` : String(attempts)} />
          )}
        </div>
        {overridden && (
          <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
            Teacher override
          </span>
        )}
      </div>

      {history.length > 1 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Attempt history</span>
          {history.map((a: any, idx: number) => {
            const letter = choiceLetter(question, a.responseValue) || "?";
            const text = a.responseText || resolveChoiceText(block, a.responseValue) || "";
            return (
              <div key={idx} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-[12px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{idx + 1}</span>
                  <span className="font-semibold text-slate-700">Choice {letter}</span>
                  {text && <span className="truncate text-slate-500">— {text}</span>}
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${a.isCorrect ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {a.isCorrect ? "Correct" : "Incorrect"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreStat({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "indigo" }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-[15px] font-bold tabular-nums ${tone === "indigo" ? "text-indigo-700" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

import { Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ClassComparison } from "./reviewModel";

/** Compact class-comparison panel for the selected step. Supports judgement; never overwhelms. */
export function ClassComparisonCard({ comparison }: { comparison: ClassComparison }) {
  const { total, submitted, needsGrading, classAveragePct, studentPct, standing, withSignals, distribution, maxPoints } = comparison;

  const standingMeta =
    standing === "above"
      ? { icon: TrendingUp, label: "Above class average", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" }
      : standing === "below"
      ? { icon: TrendingDown, label: "Below class average", cls: "text-amber-700 bg-amber-50 border-amber-200" }
      : standing === "at"
      ? { icon: Minus, label: "At class average", cls: "text-slate-600 bg-slate-50 border-slate-200" }
      : null;
  const StandIcon = standingMeta?.icon;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
          <Users className="h-4 w-4 text-slate-400" /> How the class did
        </span>
        {standingMeta && StandIcon && (
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${standingMeta.cls}`}>
            <StandIcon className="h-3 w-3" /> {standingMeta.label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Submitted" value={`${submitted} / ${total}`} />
        <Stat label="Needs grading" value={String(needsGrading)} tone={needsGrading > 0 ? "amber" : "slate"} />
        {maxPoints > 0 && <Stat label="Class avg" value={classAveragePct !== null ? `${classAveragePct}%` : "—"} />}
        {maxPoints > 0 && <Stat label="This student" value={studentPct !== null ? `${studentPct}%` : "—"} tone="indigo" />}
      </div>

      {distribution.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
          {distribution.map((d) => (
            <div key={d.label} className="flex-1 text-center">
              <div className="text-[14px] font-bold tabular-nums text-slate-700">{d.count}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{d.label}</div>
            </div>
          ))}
        </div>
      )}

      {withSignals > 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          {withSignals} {withSignals === 1 ? "student has" : "students have"} integrity signals recorded on this step.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" | "indigo" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "indigo" ? "text-indigo-700" : "text-slate-800";
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-[15px] font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

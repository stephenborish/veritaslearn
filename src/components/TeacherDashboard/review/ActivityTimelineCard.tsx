import { Activity, Clock, LogIn, FileEdit, Send, CheckCircle2 } from "lucide-react";
import { formatTimestamp } from "./reviewModel";

/**
 * Activity records: key academic timestamps plus a readable, chronological
 * engagement log. Calm and factual — these are records, not surveillance.
 */
export function ActivityTimelineCard({
  attempt,
  student,
  activities,
}: {
  attempt: any;
  student: any;
  activities: any[];
}) {
  const latest = (type: string) => {
    const list = activities.filter((a: any) => a.activityType === type);
    return list.length > 0 ? list[0].timestamp : null;
  };
  const isCompleted = attempt?.status === "completed";

  const milestones = [
    { icon: Clock, label: "Started lesson", value: attempt?.startedAt },
    { icon: LogIn, label: "Last signed in", value: student?.lastSignedInAt },
    { icon: Activity, label: "Last activity", value: attempt?.lastActiveAt || student?.lastActiveAt },
    { icon: Send, label: "Last submission", value: latest("answer_submit") },
    { icon: FileEdit, label: "Last autosave", value: latest("draft_save") },
    { icon: CheckCircle2, label: "Completed", value: isCompleted ? attempt?.completedAt : null, done: isCompleted },
  ];

  const activeMin = Math.floor((attempt?.activeTimeSpent || 0) / 60);
  const activeSec = (attempt?.activeTimeSpent || 0) % 60;
  const awayMin = Math.floor((attempt?.inactiveTimeSpent || 0) / 60);
  const awaySec = (attempt?.inactiveTimeSpent || 0) % 60;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {milestones.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="rounded-xl border border-slate-200 bg-white p-3">
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <Icon className="h-3 w-3" /> {m.label}
              </span>
              <span className={`text-[12.5px] font-semibold ${m.done === false && m.label === "Completed" ? "italic text-slate-400" : "text-slate-700"}`}>
                {m.value ? formatTimestamp(m.value) : m.label === "Completed" ? "In progress" : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Time actively working</span>
          <p className="text-[15px] font-bold text-slate-800 tabular-nums">{activeMin}m {activeSec}s</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Time away from window</span>
          <p className="text-[15px] font-bold text-amber-600 tabular-nums">{awayMin}m {awaySec}s</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
            <Activity className="h-4 w-4 text-slate-400" /> Engagement log
          </span>
        </div>
        {activities.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] italic text-slate-400">No engagement records yet.</div>
        ) : (
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {activities.slice(0, 40).map((act: any) => (
              <div key={act.id} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-slate-700">{act.description}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{String(act.activityType || "").replace(/_/g, " ")}</p>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{formatTimestamp(act.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

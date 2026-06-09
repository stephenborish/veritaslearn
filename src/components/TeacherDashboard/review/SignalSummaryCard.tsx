import { useState } from "react";
import { ShieldCheck, ShieldAlert, Sparkles, ChevronDown, Eye } from "lucide-react";
import {
  deriveIntegritySignalSummary,
  attentionLabel,
  attentionColorClasses,
  reliabilityLabel,
  getDetailedSignalContext,
  classifySignal,
  type IntegritySignalCluster,
} from "../../../lib/integritySignals";
import { formatTimestamp } from "./reviewModel";

/**
 * Grouped, plain-language integrity-signal summary. Repeated events collapse into
 * one card with a count and first/last timestamps. Language stays calm and
 * supports teacher judgement — never accusatory, never certain.
 */
export function SignalSummaryCard({
  signals,
  blocks,
  responsesByStep,
  hasActivityTiming,
  onToggleSignal,
  togglingId,
  compact = false,
}: {
  signals: any[];
  blocks: any[];
  responsesByStep?: any;
  hasActivityTiming?: boolean;
  onToggleSignal?: (id: string) => void;
  togglingId?: string | null;
  compact?: boolean;
}) {
  const summary = deriveIntegritySignalSummary(signals, {
    responsesByStep,
    hasActivityTiming,
    excludeDismissed: true,
  });
  const colors = attentionColorClasses(summary.attentionLevel);

  if (signals.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800">
        <ShieldCheck className="h-4 w-4" /> No activity or integrity signals recorded.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Reliability banner */}
      <div className={`rounded-xl border ${colors.border} ${colors.bg} px-4 py-3`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide ${colors.text}`}>
            <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
            {attentionLabel(summary.attentionLevel)}
          </span>
          <span className="text-[12px] font-semibold text-slate-500">
            Response reliability: <span className="text-slate-700">{reliabilityLabel(summary.responseReliability)}</span>
          </span>
          <span className="text-[11px] font-medium text-slate-400">
            Evidence: {summary.evidenceStrength} · Data completeness: {summary.dataCompleteness}
          </span>
        </div>
        {summary.aiAgentSignalCount > 0 && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700">
            <Sparkles className="h-3.5 w-3.5" /> {summary.aiAgentSignalCount} signal{summary.aiAgentSignalCount === 1 ? "" : "s"} of AI agent use
          </div>
        )}
      </div>

      {/* Grouped clusters */}
      {!compact && (
        <div className="space-y-2">
          {summary.clusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              signals={signals}
              blocks={blocks}
              onToggleSignal={onToggleSignal}
              togglingId={togglingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterCard({
  cluster,
  signals,
  blocks,
  onToggleSignal,
  togglingId,
}: {
  cluster: IntegritySignalCluster;
  signals: any[];
  blocks: any[];
  onToggleSignal?: (id: string) => void;
  togglingId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const isAi = cluster.isAiAgent;
  const tone = isAi
    ? "border-violet-200 bg-violet-50/60"
    : cluster.attentionLevel === "high"
    ? "border-rose-200 bg-rose-50/50"
    : cluster.attentionLevel === "moderate"
    ? "border-amber-200 bg-amber-50/50"
    : "border-slate-200 bg-white";

  // Member signals sharing this cluster's category + step location.
  const members = signals.filter((s) => {
    const kind = classifySignal(s?.eventType);
    if (kind.category !== cluster.category) return false;
    const stepId = s?.checkpointId ? `${s.blockId || ""}:${s.checkpointId}` : s?.blockId || "";
    return (stepId || undefined) === cluster.stepId;
  });

  const block = blocks.find((b) => b.id === cluster.blockId);
  const stepLabel = block?.title ? `Step: ${block.title}` : "Across the lesson";

  return (
    <div className={`rounded-xl border ${tone}`}>
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          {isAi ? <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-slate-800">{cluster.label}</span>
              {cluster.count > 1 && (
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Repeated {cluster.count}×</span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-slate-500">{stepLabel}</p>
            {(cluster.firstAt || cluster.lastAt) && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                First: {formatTimestamp(cluster.firstAt)} · Last: {formatTimestamp(cluster.lastAt)}
              </p>
            )}
            <p className="mt-1 text-[11px] font-semibold text-slate-500">Teacher guidance: {isAi ? "Review this response" : "Keep for review"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-50"
        >
          <Eye className="h-3 w-3" /> Details
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="space-y-1 border-t border-slate-200/70 px-3.5 py-2.5">
          {members.slice(0, 8).map((s: any) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="truncate text-slate-600">{getDetailedSignalContext(s, blocks).label}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-slate-400">{formatTimestamp(s.timestamp)}</span>
                {onToggleSignal && (
                  <button
                    type="button"
                    onClick={() => onToggleSignal(s.id)}
                    disabled={togglingId === s.id}
                    className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-50"
                  >
                    {togglingId === s.id ? "…" : s.dismissedAt ? "Restore" : "Dismiss"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

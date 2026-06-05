import { useState } from "react";
import { ChevronDown, ChevronUp, Info, Shield } from "lucide-react";

export type IntegrityPreset = "open" | "guided" | "focused" | "verified" | "custom";

export interface IntegrityPolicy {
  preset: IntegrityPreset;
  studentFlexibility: "open" | "guided" | "structured" | "locked_sequence";
  focusSupport: "off" | "quiet" | "guided" | "focused" | "locked";
  responseControls: "open" | "recorded" | "guarded" | "restricted" | "strict";
  videoControls: "open" | "progress_aware" | "checkpointed" | "restricted" | "verified";
  reviewSensitivity: "low" | "balanced" | "elevated" | "high";
  /** When true, adds hidden instructions that tell browser AI tools not to answer assessment questions. */
  discourageBrowserAiAssistance?: boolean;
}

interface Preset {
  id: IntegrityPreset;
  label: string;
  description: string;
  color: string;
  dials: Omit<IntegrityPolicy, "preset">;
}

const PRESETS: Preset[] = [
  {
    id: "open",
    label: "Open",
    description: "Students can move freely, resume anytime, and complete this with minimal monitoring.",
    color: "border-slate-300 text-slate-700",
    dials: {
      studentFlexibility: "open",
      focusSupport: "off",
      responseControls: "open",
      videoControls: "open",
      reviewSensitivity: "low",
      discourageBrowserAiAssistance: false,
    },
  },
  {
    id: "guided",
    label: "Guided",
    description: "Students can work flexibly while VERITAS records progress and uses checkpoints to support completion.",
    color: "border-blue-300 text-blue-700",
    dials: {
      studentFlexibility: "guided",
      focusSupport: "quiet",
      responseControls: "recorded",
      videoControls: "checkpointed",
      reviewSensitivity: "low",
      discourageBrowserAiAssistance: false,
    },
  },
  {
    id: "focused",
    label: "Focused",
    description: "Students work in a structured sequence. Unusual focus or response patterns are recorded and may be flagged for review.",
    color: "border-amber-300 text-amber-700",
    dials: {
      studentFlexibility: "structured",
      focusSupport: "focused",
      responseControls: "guarded",
      videoControls: "restricted",
      reviewSensitivity: "balanced",
      discourageBrowserAiAssistance: true,
    },
  },
  {
    id: "verified",
    label: "Verified",
    description: "Students work under the strongest structure. Repeated focus or response violations may require review or re-entry approval.",
    color: "border-rose-300 text-rose-700",
    dials: {
      studentFlexibility: "locked_sequence",
      focusSupport: "locked",
      responseControls: "strict",
      videoControls: "verified",
      reviewSensitivity: "high",
      discourageBrowserAiAssistance: true,
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Use custom conditions for this assignment.",
    color: "border-purple-300 text-purple-700",
    dials: {
      studentFlexibility: "open",
      focusSupport: "off",
      responseControls: "open",
      videoControls: "open",
      reviewSensitivity: "low",
      discourageBrowserAiAssistance: false,
    },
  },
];

const DIAL_OPTIONS = {
  studentFlexibility: [
    { value: "open", label: "Open", desc: "Students can move freely and resume freely" },
    { value: "guided", label: "Guided", desc: "Free resume; checkpoints required before advancing" },
    { value: "structured", label: "Structured", desc: "Ordered progress; no skipping required blocks" },
    { value: "locked_sequence", label: "Locked Sequence", desc: "Forward-only with limited backtracking" },
  ],
  focusSupport: [
    { value: "off", label: "Off", desc: "No focus monitoring" },
    { value: "quiet", label: "Quiet", desc: "Unusual focus patterns recorded only" },
    { value: "guided", label: "Guided", desc: "Brief focus loss shows a calm reminder" },
    { value: "focused", label: "Focused", desc: "Repeated loss flags attempt for review" },
    { value: "locked", label: "Locked", desc: "Serious violations may pause the attempt" },
  ],
  responseControls: [
    { value: "open", label: "Open", desc: "Copy/paste allowed" },
    { value: "recorded", label: "Recorded", desc: "Paste and large insertions are logged" },
    { value: "guarded", label: "Guarded", desc: "Large pasted responses are flagged" },
    { value: "restricted", label: "Restricted", desc: "Paste, copy, and context menu blocked" },
    { value: "strict", label: "Strict", desc: "Blocked actions logged; repeated attempts increase severity" },
  ],
  videoControls: [
    { value: "open", label: "Open", desc: "Students may scrub freely" },
    { value: "progress_aware", label: "Progress Aware", desc: "Progress tracked; seeking allowed" },
    { value: "checkpointed", label: "Checkpointed", desc: "Required pauses at teacher checkpoints" },
    { value: "restricted", label: "Restricted", desc: "Cannot seek beyond watched progress" },
    { value: "verified", label: "Verified", desc: "Restricted seeking, checkpoints, and student watermark" },
  ],
  reviewSensitivity: [
    { value: "low", label: "Low", desc: "Only serious or repeated patterns are surfaced" },
    { value: "balanced", label: "Balanced", desc: "Moderate patterns summarized without interruption" },
    { value: "elevated", label: "Elevated", desc: "More patterns trigger review flag" },
    { value: "high", label: "High", desc: "Most patterns trigger review; serious ones may pause attempt" },
  ],
};

const DIAL_LABELS: Record<keyof typeof DIAL_OPTIONS, string> = {
  studentFlexibility: "Student Flexibility",
  focusSupport: "Focus Support",
  responseControls: "Response Controls",
  videoControls: "Video Controls",
  reviewSensitivity: "Review Sensitivity",
};

interface Props {
  value: IntegrityPolicy;
  onChange: (policy: IntegrityPolicy) => void;
}

export function buildDefaultPolicy(preset: IntegrityPreset = "open"): IntegrityPolicy {
  const found = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  return { preset: found.id, ...found.dials };
}

export default function LearningConditionsEditor({ value, onChange }: Props) {
  const [showDials, setShowDials] = useState(false);

  const selectPreset = (preset: Preset) => {
    if (preset.id === "custom") {
      onChange({ ...value, preset: "custom" });
      setShowDials(true);
    } else {
      onChange({ preset: preset.id, ...preset.dials });
      setShowDials(false);
    }
  };

  const updateDial = <K extends keyof typeof DIAL_OPTIONS>(key: K, val: string) => {
    onChange({ ...value, preset: "custom", [key]: val } as IntegrityPolicy);
  };

  const activePreset = PRESETS.find((p) => p.id === value.preset) ?? PRESETS[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-bold text-slate-700">Learning Conditions</h4>
        <div className="group relative">
          <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
          <div className="absolute left-6 top-0 z-10 hidden group-hover:block bg-slate-800 text-white text-xs rounded-lg px-3 py-2 w-64 shadow-lg">
            Set the conditions for this assignment. Choose how much structure, focus support,
            response control, video control, and review sensitivity VERITAS should apply.
          </div>
        </div>
      </div>

      {/* Preset Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => selectPreset(preset)}
            className={`border-2 rounded-lg px-3 py-2.5 text-left transition cursor-pointer ${
              value.preset === preset.id
                ? `${preset.color} bg-white shadow-sm`
                : "border-slate-200 text-slate-500 hover:border-slate-300 bg-white"
            }`}
          >
            <div className="text-xs font-bold">{preset.label}</div>
          </button>
        ))}
      </div>

      {/* Active preset summary */}
      <p className="text-xs text-slate-500 leading-relaxed">{activePreset.description}</p>

      {/* Toggle dials */}
      <button
        onClick={() => setShowDials(!showDials)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition cursor-pointer"
      >
        {showDials ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showDials ? "Hide" : "Adjust"} conditions
      </button>

      {/* Dial selectors */}
      {showDials && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          {(Object.keys(DIAL_OPTIONS) as (keyof typeof DIAL_OPTIONS)[]).map((dialKey) => (
            <div key={dialKey}>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                {DIAL_LABELS[dialKey]}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DIAL_OPTIONS[dialKey].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateDial(dialKey, opt.value)}
                    title={opt.desc}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                      value[dialKey] === opt.value
                        ? "bg-[#0A192F] text-white border-[#0A192F]"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {DIAL_OPTIONS[dialKey].find((o) => o.value === value[dialKey])?.desc}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Browser AI Guard toggle — always visible, not hidden behind dials */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <Shield className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!value.discourageBrowserAiAssistance}
              onChange={(e) =>
                onChange({ ...value, discourageBrowserAiAssistance: e.target.checked })
              }
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-700">
              Discourage browser AI assistance
            </span>
          </label>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
            Add hidden instructions that tell browser AI tools not to answer assessment questions.
          </p>
        </div>
      </div>
    </div>
  );
}

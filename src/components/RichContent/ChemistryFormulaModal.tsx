import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Save, ChevronDown, ChevronRight } from "lucide-react";
import "mathlive";

interface ChemistryFormulaModalProps {
  initialFormula?: string;
  onSave: (formula: string) => void;
  onClose: () => void;
}

interface ChemBtn {
  label: string;
  title: string;
  latex: string;
}

// ─── Chemistry building-block buttons ─────────────────────────────────────────
const CHEM_GROUPS: { group: string; items: ChemBtn[] }[] = [
  {
    group: "Subscript & Superscript",
    items: [
      { label: "X₂",  title: "Subscript (e.g. H₂O)", latex: "_{}" },
      { label: "Xⁿ",  title: "Superscript",           latex: "^{}" },
    ],
  },
  {
    group: "Charge",
    items: [
      { label: "⁺",   title: "Positive charge (+1)",  latex: "^{+}" },
      { label: "⁻",   title: "Negative charge (−1)",  latex: "^{-}" },
      { label: "²⁺",  title: "2+ charge",             latex: "^{2+}" },
      { label: "²⁻",  title: "2− charge",             latex: "^{2-}" },
      { label: "³⁺",  title: "3+ charge",             latex: "^{3+}" },
      { label: "³⁻",  title: "3− charge",             latex: "^{3-}" },
    ],
  },
  {
    group: "Reaction Arrows",
    items: [
      { label: "→",   title: "Reaction arrow (yields)",  latex: "\\rightarrow " },
      { label: "⇌",   title: "Equilibrium arrows",       latex: "\\rightleftharpoons " },
      { label: "⇄",   title: "Reversible reaction",      latex: "\\rightleftarrows " },
    ],
  },
  {
    group: "States of Matter",
    items: [
      { label: "(s)",  title: "Solid",    latex: "\\text{(s)}" },
      { label: "(l)",  title: "Liquid",   latex: "\\text{(l)}" },
      { label: "(g)",  title: "Gas",      latex: "\\text{(g)}" },
      { label: "(aq)", title: "Aqueous",  latex: "\\text{(aq)}" },
    ],
  },
  {
    group: "Symbols",
    items: [
      { label: "+",   title: "Plus",          latex: "+" },
      { label: "Δ",   title: "Heat / change", latex: "\\Delta " },
      { label: "↑",   title: "Gas evolved",   latex: "\\uparrow " },
      { label: "↓",   title: "Precipitate",   latex: "\\downarrow " },
    ],
  },
];

// ─── Common molecules quick-insert ────────────────────────────────────────────
const COMMON_MOLECULES: ChemBtn[] = [
  { label: "H₂O",      title: "Water",              latex: "H_2O" },
  { label: "CO₂",      title: "Carbon dioxide",     latex: "CO_2" },
  { label: "O₂",       title: "Oxygen",             latex: "O_2" },
  { label: "H₂",       title: "Hydrogen gas",       latex: "H_2" },
  { label: "NaCl",     title: "Sodium chloride",    latex: "NaCl" },
  { label: "H₂SO₄",   title: "Sulfuric acid",      latex: "H_2SO_4" },
  { label: "NaOH",     title: "Sodium hydroxide",   latex: "NaOH" },
  { label: "HCl",      title: "Hydrochloric acid",  latex: "HCl" },
  { label: "C₆H₁₂O₆", title: "Glucose",            latex: "C_6H_{12}O_6" },
  { label: "ATP",      title: "ATP",                latex: "ATP" },
  { label: "Na⁺",      title: "Sodium ion",         latex: "Na^+" },
  { label: "Cl⁻",      title: "Chloride ion",       latex: "Cl^-" },
  { label: "Ca²⁺",     title: "Calcium ion",        latex: "Ca^{2+}" },
  { label: "OH⁻",      title: "Hydroxide",          latex: "OH^-" },
  { label: "H⁺",       title: "Proton",             latex: "H^+" },
  { label: "Fe³⁺",     title: "Iron(III)",          latex: "Fe^{3+}" },
];

// ─── Common reactions quick-insert ────────────────────────────────────────────
const REACTIONS: ChemBtn[] = [
  {
    label: "Photosynthesis",
    title: "Photosynthesis equation",
    latex: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2",
  },
  {
    label: "Respiration",
    title: "Cellular respiration",
    latex: "C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O",
  },
  {
    label: "Neutralization",
    title: "Acid-base neutralization",
    latex: "HCl + NaOH \\rightarrow NaCl + H_2O",
  },
];

export const ChemistryFormulaModal: React.FC<ChemistryFormulaModalProps> = ({
  initialFormula = "",
  onSave,
  onClose,
}) => {
  const mfRef = useRef<any>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedValue, setAdvancedValue] = useState(initialFormula);
  const isEditing = !!(initialFormula && initialFormula.trim().length > 0);

  useEffect(() => {
    const mf = mfRef.current;
    if (!mf) return;
    mf.mathVirtualKeyboardPolicy = "off";
    if (initialFormula) mf.value = initialFormula;
    const timer = setTimeout(() => mf?.focus(), 80);
    return () => clearTimeout(timer);
  }, [initialFormula]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const insertSymbol = useCallback((latex: string) => {
    const mf = mfRef.current;
    if (!mf) return;
    mf.insert(latex);
    mf.focus();
  }, []);

  const handleSave = useCallback(() => {
    const latex = mfRef.current?.value ?? "";
    onSave(latex);
    onClose();
  }, [onSave, onClose]);

  const handleShowAdvanced = () => {
    if (!showAdvanced) setAdvancedValue(mfRef.current?.value ?? '');
    setShowAdvanced(v => !v);
  };

  const handleAdvancedChange = (val: string) => {
    setAdvancedValue(val);
    if (mfRef.current) mfRef.current.value = val;
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-[9999] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chemistry Editor"
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-base font-bold text-slate-800">Chemistry Editor</h3>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close chemistry editor"
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* Left: editing area */}
          <div className="flex-1 p-4 flex flex-col border-r border-slate-100 min-w-0">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Chemistry Equation
            </label>

            <div className="flex-1 min-h-[120px] border-2 border-slate-200 rounded-xl bg-white shadow-inner overflow-auto focus-within:border-emerald-400 transition-colors p-3">
              {/* @ts-ignore */}
              <math-field
                ref={mfRef}
                style={{
                  width: "100%",
                  minHeight: "100px",
                  outline: "none",
                  backgroundColor: "transparent",
                  fontSize: "1.2em",
                  lineHeight: "1.6",
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-400 leading-snug">
              Click buttons to build your chemistry equation — or type directly above.
              Press <kbd className="bg-slate-100 px-1 rounded text-slate-600 text-[11px] border border-slate-200">Enter</kbd> to save.
            </p>

            {/* Optional Advanced section */}
            <div className="mt-3">
              <button
                type="button"
                onClick={handleShowAdvanced}
                className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
              >
                {showAdvanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Advanced (optional) — edit formula notation directly
              </button>
              {showAdvanced && (
                <div className="mt-1.5 p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-[10px] text-slate-400 mb-1.5">
                    Optional: edit the underlying formula notation. Not required for normal use.
                  </p>
                  <textarea
                    value={advancedValue}
                    onChange={e => handleAdvancedChange(e.target.value)}
                    rows={2}
                    spellCheck={false}
                    className="w-full text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded p-1.5 focus:outline-none focus:border-blue-400 resize-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: scrollable chemistry buttons */}
          <div className="w-72 shrink-0 bg-slate-50 overflow-y-auto p-3 space-y-3">

            {/* Common molecules */}
            <div className="border border-slate-200 rounded-lg p-3 bg-white">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Common Molecules &amp; Ions</p>
              <div className="flex flex-wrap gap-1">
                {COMMON_MOLECULES.map(sym => (
                  <button
                    key={sym.title}
                    type="button"
                    title={sym.title}
                    aria-label={sym.title}
                    onMouseDown={e => { e.preventDefault(); insertSymbol(sym.latex); }}
                    className="text-xs h-8 px-2 border border-slate-200 rounded hover:bg-emerald-50 hover:border-emerald-300 bg-white text-slate-700 flex items-center justify-center transition-colors"
                  >
                    {sym.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reactions */}
            <div className="border border-slate-200 rounded-lg p-3 bg-white">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Common Reactions</p>
              <div className="flex flex-col gap-1.5">
                {REACTIONS.map(r => (
                  <button
                    key={r.label}
                    type="button"
                    title={r.title}
                    aria-label={r.title}
                    onMouseDown={e => { e.preventDefault(); insertSymbol(r.latex); }}
                    className="text-xs h-8 px-2 border border-slate-200 rounded hover:bg-emerald-50 hover:border-emerald-300 bg-white text-slate-700 flex items-center justify-start transition-colors text-left"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Building blocks */}
            {CHEM_GROUPS.map(group => (
              <div key={group.group} className="border border-slate-200 rounded-lg p-3 bg-white">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">{group.group}</p>
                <div className="flex flex-wrap gap-1">
                  {group.items.map(sym => (
                    <button
                      key={sym.title}
                      type="button"
                      title={sym.title}
                      aria-label={sym.title}
                      onMouseDown={e => { e.preventDefault(); insertSymbol(sym.latex); }}
                      className="min-w-[38px] h-9 px-2 text-sm border border-slate-200 rounded hover:bg-emerald-50 hover:border-emerald-300 bg-white text-slate-800 flex items-center justify-center transition-colors"
                    >
                      {sym.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-3 bg-white shrink-0 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Save size={15} />
            {isEditing ? "Save chemistry" : "Insert chemistry"}
          </button>
        </div>
      </div>
    </div>
  );
};

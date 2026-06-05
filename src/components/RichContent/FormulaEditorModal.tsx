import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Save, ChevronDown, ChevronRight } from "lucide-react";
import "mathlive";

interface FormulaEditorModalProps {
  initialFormula?: string;
  onSave: (formula: string, mathml: string) => void;
  onClose: () => void;
}

interface MathSymbol {
  label: string;
  title: string;
  latex: string;
}

interface SymbolCategory {
  name: string;
  symbols: MathSymbol[];
  defaultOpen?: boolean;
}

// ─── Quick-access bar (most commonly needed symbols) ──────────────────────────
const QUICK_BAR: MathSymbol[] = [
  { label: "a/b",  title: "Fraction",             latex: "\\frac{}{}" },
  { label: "√",    title: "Square root",           latex: "\\sqrt{}" },
  { label: "xⁿ",  title: "Exponent / power",      latex: "^{}" },
  { label: "x²",  title: "Squared",               latex: "^{2}" },
  { label: "xᵢ",  title: "Subscript",             latex: "_{}" },
  { label: "+",    title: "Plus",                  latex: "+" },
  { label: "−",    title: "Minus",                 latex: "-" },
  { label: "×",    title: "Multiply",              latex: "\\times " },
  { label: "÷",    title: "Divide",                latex: "\\div " },
  { label: "=",    title: "Equals",               latex: "=" },
  { label: "≈",    title: "Approximately equal",   latex: "\\approx " },
  { label: "π",    title: "Pi",                    latex: "\\pi " },
  { label: "∞",    title: "Infinity",              latex: "\\infty " },
  { label: "|x|",  title: "Absolute value",        latex: "\\left|\\right|" },
];

// ─── Symbol categories ────────────────────────────────────────────────────────
const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    name: "Numbers",
    defaultOpen: true,
    symbols: [
      { label: "0", title: "0", latex: "0" },
      { label: "1", title: "1", latex: "1" },
      { label: "2", title: "2", latex: "2" },
      { label: "3", title: "3", latex: "3" },
      { label: "4", title: "4", latex: "4" },
      { label: "5", title: "5", latex: "5" },
      { label: "6", title: "6", latex: "6" },
      { label: "7", title: "7", latex: "7" },
      { label: "8", title: "8", latex: "8" },
      { label: "9", title: "9", latex: "9" },
      { label: ".",  title: "Decimal point", latex: "." },
      { label: ",",  title: "Comma",         latex: "," },
      { label: "π",  title: "Pi",            latex: "\\pi " },
      { label: "e",  title: "Euler's number", latex: "e" },
      { label: "∞",  title: "Infinity",      latex: "\\infty " },
      { label: "i",  title: "Imaginary unit", latex: "i" },
    ],
  },
  {
    name: "Arithmetic & Units",
    defaultOpen: true,
    symbols: [
      { label: "+",  title: "Plus",                  latex: "+" },
      { label: "−",  title: "Minus",                 latex: "-" },
      { label: "×",  title: "Multiply",              latex: "\\times " },
      { label: "÷",  title: "Divide",                latex: "\\div " },
      { label: "±",  title: "Plus or minus",         latex: "\\pm " },
      { label: "%",  title: "Percent",               latex: "\\%" },
      { label: "°",  title: "Degree",                latex: "^{\\circ}" },
      { label: "·",  title: "Middle dot (multiply)", latex: "\\cdot " },
      { label: "x̄", title: "Mean (x-bar)",          latex: "\\bar{x}" },
      { label: "½",  title: "One-half",              latex: "\\frac{1}{2}" },
    ],
  },
  {
    name: "Exponents, Roots & Logs",
    defaultOpen: false,
    symbols: [
      { label: "xⁿ",  title: "x to the power n",    latex: "^{}" },
      { label: "x²",  title: "x squared",            latex: "^{2}" },
      { label: "x³",  title: "x cubed",              latex: "^{3}" },
      { label: "xᵢ",  title: "Subscript",            latex: "_{}" },
      { label: "√",   title: "Square root",          latex: "\\sqrt{}" },
      { label: "ⁿ√",  title: "nth root",             latex: "\\sqrt[]{}" },
      { label: "eˣ",  title: "e to the x",           latex: "e^{}" },
      { label: "ln",  title: "Natural log",           latex: "\\ln " },
      { label: "log", title: "Log base 10",           latex: "\\log " },
      { label: "logᵦ", title: "Log base b",          latex: "\\log_{}{}" },
      { label: "a/b", title: "Fraction",              latex: "\\frac{}{}" },
    ],
  },
  {
    name: "Relations",
    defaultOpen: false,
    symbols: [
      { label: "=",  title: "Equals",                latex: "=" },
      { label: "≠",  title: "Not equal",             latex: "\\ne " },
      { label: "<",  title: "Less than",             latex: "<" },
      { label: ">",  title: "Greater than",          latex: ">" },
      { label: "≤",  title: "Less than or equal",    latex: "\\le " },
      { label: "≥",  title: "Greater than or equal", latex: "\\ge " },
      { label: "≈",  title: "Approximately equal",   latex: "\\approx " },
      { label: "∝",  title: "Proportional to",       latex: "\\propto " },
      { label: "±",  title: "Plus or minus",         latex: "\\pm " },
      { label: "~",  title: "Similar to",            latex: "\\sim " },
      { label: "≅",  title: "Congruent to",          latex: "\\cong " },
    ],
  },
  {
    name: "Groups",
    defaultOpen: false,
    symbols: [
      { label: "( )",   title: "Parentheses",    latex: "\\left(\\right)" },
      { label: "[ ]",   title: "Brackets",       latex: "\\left[\\right]" },
      { label: "{ }",   title: "Braces",         latex: "\\left\\{\\right\\}" },
      { label: "|x|",   title: "Absolute value", latex: "\\left|\\right|" },
      { label: "⟨ ⟩",  title: "Angle brackets", latex: "\\langle\\rangle" },
      { label: "(x,y)", title: "Ordered pair",   latex: "\\left(,\\right)" },
    ],
  },
  {
    name: "Trigonometry",
    defaultOpen: false,
    symbols: [
      { label: "sin",   title: "Sine",           latex: "\\sin " },
      { label: "cos",   title: "Cosine",         latex: "\\cos " },
      { label: "tan",   title: "Tangent",        latex: "\\tan " },
      { label: "sec",   title: "Secant",         latex: "\\sec " },
      { label: "csc",   title: "Cosecant",       latex: "\\csc " },
      { label: "cot",   title: "Cotangent",      latex: "\\cot " },
      { label: "sin⁻¹", title: "Arcsine",        latex: "\\arcsin " },
      { label: "cos⁻¹", title: "Arccosine",      latex: "\\arccos " },
      { label: "tan⁻¹", title: "Arctangent",     latex: "\\arctan " },
    ],
  },
  {
    name: "Statistics",
    defaultOpen: false,
    symbols: [
      { label: "x̄", title: "x-bar (mean)",            latex: "\\bar{x}" },
      { label: "ȳ", title: "y-bar (mean)",             latex: "\\bar{y}" },
      { label: "σ",  title: "Sigma (std deviation)",   latex: "\\sigma " },
      { label: "μ",  title: "Mu (population mean)",    latex: "\\mu " },
      { label: "n!", title: "Factorial",               latex: "n!" },
      { label: "Σ",  title: "Summation",               latex: "\\sum " },
      { label: "P()", title: "Probability",            latex: "P\\left(\\right)" },
      { label: "C",  title: "Combination (nCr)",       latex: "\\binom{}{}" },
      { label: "s",  title: "Sample std deviation",    latex: "s" },
      { label: "r",  title: "Correlation coefficient", latex: "r" },
    ],
  },
  {
    name: "Greek",
    defaultOpen: false,
    symbols: [
      { label: "α", title: "Alpha",            latex: "\\alpha " },
      { label: "β", title: "Beta",             latex: "\\beta " },
      { label: "γ", title: "Gamma (lower)",    latex: "\\gamma " },
      { label: "Γ", title: "Gamma (upper)",    latex: "\\Gamma " },
      { label: "δ", title: "Delta (lower)",    latex: "\\delta " },
      { label: "Δ", title: "Delta (upper)",    latex: "\\Delta " },
      { label: "θ", title: "Theta",            latex: "\\theta " },
      { label: "λ", title: "Lambda",           latex: "\\lambda " },
      { label: "μ", title: "Mu",               latex: "\\mu " },
      { label: "π", title: "Pi",               latex: "\\pi " },
      { label: "ρ", title: "Rho",              latex: "\\rho " },
      { label: "σ", title: "Sigma (lower)",    latex: "\\sigma " },
      { label: "Σ", title: "Sigma (upper)",    latex: "\\Sigma " },
      { label: "τ", title: "Tau",              latex: "\\tau " },
      { label: "φ", title: "Phi",              latex: "\\phi " },
      { label: "χ", title: "Chi",              latex: "\\chi " },
      { label: "ψ", title: "Psi",              latex: "\\psi " },
      { label: "ω", title: "Omega (lower)",    latex: "\\omega " },
      { label: "Ω", title: "Omega (upper)",    latex: "\\Omega " },
      { label: "ε", title: "Epsilon",          latex: "\\epsilon " },
    ],
  },
  {
    name: "Calculus",
    defaultOpen: false,
    symbols: [
      { label: "∫",     title: "Integral",            latex: "\\int " },
      { label: "∫ₐᵇ",  title: "Definite integral",   latex: "\\int_{a}^{b}" },
      { label: "d/dx",  title: "Derivative",          latex: "\\frac{d}{dx}" },
      { label: "∂/∂x",  title: "Partial derivative",  latex: "\\frac{\\partial}{\\partial x}" },
      { label: "∂",     title: "Partial symbol",      latex: "\\partial " },
      { label: "lim",   title: "Limit",               latex: "\\lim_{}" },
      { label: "Σ",     title: "Summation series",    latex: "\\sum_{i=1}^{n}" },
      { label: "∞",     title: "Infinity",            latex: "\\infty " },
      { label: "∇",     title: "Nabla / gradient",    latex: "\\nabla " },
      { label: "∮",     title: "Contour integral",    latex: "\\oint " },
    ],
  },
  {
    name: "Science Extras",
    defaultOpen: false,
    symbols: [
      { label: "→",  title: "Right arrow / reaction",   latex: "\\rightarrow " },
      { label: "⇌",  title: "Equilibrium arrows",       latex: "\\rightleftharpoons " },
      { label: "↑",  title: "Up arrow / gas evolved",   latex: "\\uparrow " },
      { label: "↓",  title: "Down arrow / precipitate", latex: "\\downarrow " },
      { label: "Δ",  title: "Delta / change",           latex: "\\Delta " },
      { label: "×10ⁿ", title: "Scientific notation",  latex: "\\times 10^{}" },
      { label: "ₓ",  title: "Chemical subscript",       latex: "_{}" },
      { label: "x⁺", title: "Positive ion",            latex: "^{+}" },
      { label: "x⁻", title: "Negative ion",            latex: "^{-}" },
    ],
  },
];

// ─── Collapsible category section ─────────────────────────────────────────────
const CategorySection: React.FC<{
  category: SymbolCategory;
  onInsert: (latex: string) => void;
}> = ({ category, onInsert }) => {
  const [isOpen, setIsOpen] = useState(category.defaultOpen ?? false);

  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-slate-600 uppercase tracking-wide hover:bg-slate-100 transition-colors text-left"
      >
        <span>{category.name}</span>
        {isOpen
          ? <ChevronDown size={13} className="text-slate-400 shrink-0" />
          : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
      </button>

      {isOpen && (
        <div className="px-2 pb-3 pt-1 flex flex-wrap gap-1">
          {category.symbols.map((sym) => (
            <button
              key={sym.title + sym.latex}
              type="button"
              title={sym.title}
              aria-label={sym.title}
              onMouseDown={(e) => {
                // Use mousedown so the math-field doesn't lose focus before we insert
                e.preventDefault();
                onInsert(sym.latex);
              }}
              className="min-w-[38px] h-9 px-1.5 text-sm border border-slate-200 rounded hover:bg-blue-50 hover:border-blue-300 bg-white text-slate-800 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 leading-none"
            >
              {sym.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Formula Editor Modal ─────────────────────────────────────────────────
export const FormulaEditorModal: React.FC<FormulaEditorModalProps> = ({
  initialFormula = "",
  onSave,
  onClose,
}) => {
  const mfRef = useRef<any>(null);
  const isEditing = !!(initialFormula && initialFormula.trim().length > 0);

  // Initialize the math-field on mount
  useEffect(() => {
    const mf = mfRef.current;
    if (!mf) return;

    // Suppress MathLive's own virtual keyboard UI — we provide our own palette
    mf.mathVirtualKeyboardPolicy = "off";

    if (initialFormula) {
      mf.value = initialFormula;
    }

    // Slight delay so the dialog renders fully before stealing focus
    const timer = setTimeout(() => mf?.focus(), 80);
    return () => clearTimeout(timer);
  }, [initialFormula]);

  // Esc key closes the modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Insert LaTeX at the current cursor position, then re-focus the math-field
  const insertSymbol = useCallback((latex: string) => {
    const mf = mfRef.current;
    if (!mf) return;
    mf.insert(latex);
    mf.focus();
  }, []);

  const handleSave = useCallback(() => {
    const latex = mfRef.current?.value ?? "";
    onSave(latex, "");
  }, [onSave]);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-[9999] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Visual Math Editor"
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-base font-bold text-slate-800">Visual Math Editor</h3>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close equation editor"
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Quick bar ──────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
            Quick Insert
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_BAR.map((sym) => (
              <button
                key={sym.title}
                type="button"
                title={sym.title}
                aria-label={sym.title}
                onMouseDown={(e) => { e.preventDefault(); insertSymbol(sym.latex); }}
                className="h-9 min-w-[38px] px-2 text-sm border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 bg-white text-slate-800 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium shadow-sm"
              >
                {sym.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Two-column body ────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* Left: editing area */}
          <div className="flex-1 p-4 flex flex-col border-r border-slate-100 min-w-0">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Equation
            </label>

            {/* MathLive field wrapper */}
            <div className="flex-1 min-h-[150px] border-2 border-slate-200 rounded-xl bg-white shadow-inner overflow-auto focus-within:border-blue-400 transition-colors p-3">
              {/* @ts-ignore */}
              <math-field
                ref={mfRef}
                style={{
                  width: "100%",
                  minHeight: "130px",
                  outline: "none",
                  backgroundColor: "transparent",
                  fontSize: "1.25em",
                  lineHeight: "1.6",
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  // Enter (without Shift) saves; Shift+Enter inserts a newline in the field
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-400 leading-snug">
              Click symbols on the right, or type LaTeX directly — e.g.{" "}
              <code className="bg-slate-100 px-1 rounded text-slate-600 text-[11px]">\frac</code>,{" "}
              <code className="bg-slate-100 px-1 rounded text-slate-600 text-[11px]">\sqrt</code>,{" "}
              <code className="bg-slate-100 px-1 rounded text-slate-600 text-[11px]">\pi</code>.
              Press <kbd className="bg-slate-100 px-1 rounded text-slate-600 text-[11px] border border-slate-200">Enter</kbd> to save.
            </p>
          </div>

          {/* Right: scrollable category panels */}
          <div
            className="w-64 shrink-0 bg-slate-50 overflow-y-auto"
            style={{ maxHeight: "100%" }}
          >
            {SYMBOL_CATEGORIES.map((cat) => (
              <CategorySection
                key={cat.name}
                category={cat}
                onInsert={insertSymbol}
              />
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
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Save size={15} />
            {isEditing ? "Save equation" : "Insert equation"}
          </button>
        </div>
      </div>
    </div>
  );
};

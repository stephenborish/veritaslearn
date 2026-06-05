import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Save, ChevronDown, ChevronRight } from "lucide-react";
import "mathlive";

type EditorTab = 'math' | 'chemistry' | 'science';

interface FormulaEditorModalProps {
  initialFormula?: string;
  initialTab?: EditorTab;
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

// ─── Math: Quick-access bar ───────────────────────────────────────────────────
const MATH_QUICK_BAR: MathSymbol[] = [
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

// ─── Chemistry: Quick-access bar ──────────────────────────────────────────────
const CHEM_QUICK_BAR: MathSymbol[] = [
  { label: "X₂",  title: "Subscript",              latex: "_{}" },
  { label: "X²",  title: "Superscript",            latex: "^{}" },
  { label: "⁺",   title: "Positive charge",        latex: "^{+}" },
  { label: "⁻",   title: "Negative charge",        latex: "^{-}" },
  { label: "²⁺",  title: "2+ charge",              latex: "^{2+}" },
  { label: "²⁻",  title: "2− charge",              latex: "^{2-}" },
  { label: "→",   title: "Reaction arrow",         latex: "\\rightarrow " },
  { label: "⇌",   title: "Equilibrium arrows",     latex: "\\rightleftharpoons " },
  { label: "(s)", title: "Solid state",             latex: "\\text{(s)}" },
  { label: "(l)", title: "Liquid state",            latex: "\\text{(l)}" },
  { label: "(g)", title: "Gas state",               latex: "\\text{(g)}" },
  { label: "(aq)",title: "Aqueous state",           latex: "\\text{(aq)}" },
  { label: "+",   title: "Plus sign",               latex: "+" },
  { label: "Δ",   title: "Heat / change",           latex: "\\Delta " },
];

// ─── Science: Quick-access bar ────────────────────────────────────────────────
const SCIENCE_QUICK_BAR: MathSymbol[] = [
  { label: "E=mc²",  title: "Mass-energy equivalence", latex: "E = mc^2" },
  { label: "F=ma",   title: "Newton's 2nd law",        latex: "F = ma" },
  { label: "PV=nRT", title: "Ideal gas law",           latex: "PV = nRT" },
  { label: "y=mx+b", title: "Linear equation",         latex: "y = mx + b" },
  { label: "a/b",    title: "Fraction",                latex: "\\frac{}{}" },
  { label: "√x",     title: "Square root",             latex: "\\sqrt{}" },
  { label: "×10ⁿ",  title: "Scientific notation",     latex: "\\times 10^{}" },
];

// ─── Math symbol categories ───────────────────────────────────────────────────
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
    ],
  },
  {
    name: "Greek Letters",
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
      { label: "∇",     title: "Nabla / gradient",    latex: "\\nabla " },
    ],
  },
];

// ─── Chemistry building-block buttons ─────────────────────────────────────────
const CHEM_BUILDING_BLOCKS: { group: string; items: MathSymbol[] }[] = [
  {
    group: "Subscript & Superscript",
    items: [
      { label: "X₂",  title: "Subscript (e.g. H₂O)", latex: "_{}" },
      { label: "X⁴",  title: "Superscript",           latex: "^{}" },
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
      { label: "→",   title: "Reaction arrow (yields)", latex: "\\rightarrow " },
      { label: "⇌",   title: "Equilibrium arrows",      latex: "\\rightleftharpoons " },
      { label: "⇄",   title: "Reversible reaction",     latex: "\\rightleftarrows " },
      { label: "⟶",   title: "Long reaction arrow",     latex: "\\longrightarrow " },
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
      { label: "+",   title: "Plus",            latex: "+" },
      { label: "Δ",   title: "Heat / change",   latex: "\\Delta " },
      { label: "↑",   title: "Gas evolved",     latex: "\\uparrow " },
      { label: "↓",   title: "Precipitate",     latex: "\\downarrow " },
      { label: "·",   title: "Middle dot",      latex: "\\cdot " },
    ],
  },
];

// ─── Common chemistry molecules/formulas ──────────────────────────────────────
const CHEM_COMMON: MathSymbol[] = [
  { label: "H₂O",       title: "Water",              latex: "H_2O" },
  { label: "CO₂",       title: "Carbon dioxide",     latex: "CO_2" },
  { label: "O₂",        title: "Oxygen gas",         latex: "O_2" },
  { label: "H₂",        title: "Hydrogen gas",       latex: "H_2" },
  { label: "N₂",        title: "Nitrogen gas",       latex: "N_2" },
  { label: "NaCl",      title: "Sodium chloride",    latex: "NaCl" },
  { label: "HCl",       title: "Hydrochloric acid",  latex: "HCl" },
  { label: "H₂SO₄",    title: "Sulfuric acid",      latex: "H_2SO_4" },
  { label: "NaOH",      title: "Sodium hydroxide",   latex: "NaOH" },
  { label: "C₆H₁₂O₆",  title: "Glucose",            latex: "C_6H_{12}O_6" },
  { label: "ATP",       title: "ATP",                latex: "ATP" },
  { label: "Na⁺",       title: "Sodium ion",         latex: "Na^+" },
  { label: "Cl⁻",       title: "Chloride ion",       latex: "Cl^-" },
  { label: "Ca²⁺",      title: "Calcium ion",        latex: "Ca^{2+}" },
  { label: "OH⁻",       title: "Hydroxide",          latex: "OH^-" },
  { label: "H⁺",        title: "Proton",             latex: "H^+" },
  { label: "Fe²⁺",      title: "Iron(II)",           latex: "Fe^{2+}" },
  { label: "Fe³⁺",      title: "Iron(III)",          latex: "Fe^{3+}" },
];

// ─── Science templates ────────────────────────────────────────────────────────
const SCIENCE_TEMPLATES: { label: string; title: string; latex: string; category: string }[] = [
  { category: "Physics",    label: "E = mc²",          title: "Mass-energy equivalence",       latex: "E = mc^2" },
  { category: "Physics",    label: "F = ma",           title: "Newton's 2nd law",              latex: "F = ma" },
  { category: "Physics",    label: "KE = ½mv²",        title: "Kinetic energy",                latex: "KE = \\frac{1}{2}mv^2" },
  { category: "Physics",    label: "v = λf",           title: "Wave speed",                    latex: "v = \\lambda f" },
  { category: "Chemistry",  label: "pH = −log[H⁺]",   title: "pH formula",                    latex: "pH = -\\log[H^+]" },
  { category: "Chemistry",  label: "PV = nRT",         title: "Ideal gas law",                 latex: "PV = nRT" },
  { category: "Chemistry",  label: "ΔG = ΔH − TΔS",  title: "Gibbs free energy",             latex: "\\Delta G = \\Delta H - T\\Delta S" },
  { category: "Chemistry",  label: "Ka = [H⁺][A⁻]/[HA]", title: "Acid equilibrium",          latex: "K_a = \\frac{[H^+][A^-]}{[HA]}" },
  { category: "Biology",    label: "Photosynthesis",   title: "Photosynthesis equation",       latex: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2" },
  { category: "Biology",    label: "Respiration",      title: "Cellular respiration",          latex: "C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O" },
  { category: "Biology",    label: "Fermentation",     title: "Anaerobic fermentation",        latex: "C_6H_{12}O_6 \\rightarrow 2C_2H_5OH + 2CO_2" },
  { category: "Math",       label: "y = mx + b",       title: "Linear equation (slope-intercept)", latex: "y = mx + b" },
  { category: "Math",       label: "Quadratic",        title: "Quadratic formula",             latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { category: "Math",       label: "a/b fraction",     title: "Fraction",                      latex: "\\frac{}{}" },
  { category: "Math",       label: "√ root",           title: "Square root",                   latex: "\\sqrt{}" },
  { category: "Math",       label: "xⁿ exponent",      title: "Exponent",                      latex: "x^{n}" },
  { category: "Math",       label: "Isotope ¹⁴₆C",    title: "Isotope notation example",      latex: "^{14}_{6}C" },
  { category: "Math",       label: "×10²³ notation",  title: "Scientific notation",           latex: "6.02 \\times 10^{23}" },
];

// ─── Collapsible category section (Math tab) ──────────────────────────────────
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

// ─── Scientific Notation form ─────────────────────────────────────────────────
const ScientificNotationForm: React.FC<{ onInsert: (latex: string) => void }> = ({ onInsert }) => {
  const [coeff, setCoeff] = useState('');
  const [exp, setExp] = useState('');

  const handleInsert = () => {
    if (!exp) return;
    const latex = coeff ? `${coeff} \\times 10^{${exp}}` : `\\times 10^{${exp}}`;
    onInsert(latex);
    setCoeff('');
    setExp('');
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white mb-3">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
        Scientific Notation
      </p>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <input
          type="text"
          value={coeff}
          onChange={e => setCoeff(e.target.value)}
          placeholder="Coefficient (e.g. 6.02)"
          className="flex-1 min-w-[100px] text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
        />
        <span className="text-xs text-slate-500 font-medium shrink-0">× 10</span>
        <input
          type="text"
          value={exp}
          onChange={e => setExp(e.target.value)}
          placeholder="Exponent (e.g. 23)"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInsert(); } }}
          className="w-28 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
        />
      </div>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); handleInsert(); }}
        disabled={!exp}
        className="w-full text-xs py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded font-medium transition-colors"
      >
        Insert notation
      </button>
      <p className="mt-1.5 text-[10px] text-slate-400 leading-snug">
        Examples: <span className="font-medium">6.02 × 10²³</span>, <span className="font-medium">1.2 × 10³</span>, <span className="font-medium">3.0 × 10⁻⁵</span>
      </p>
    </div>
  );
};

// ─── Isotope Notation form ────────────────────────────────────────────────────
const IsotopeForm: React.FC<{ onInsert: (latex: string) => void }> = ({ onInsert }) => {
  const [element, setElement] = useState('');
  const [mass, setMass] = useState('');
  const [atomic, setAtomic] = useState('');
  const [charge, setCharge] = useState('');

  const handleInsert = () => {
    if (!element && !mass) return;
    let latex = '';
    if (mass) latex += `^{${mass}}`;
    if (atomic) latex += `_{${atomic}}`;
    latex += element || 'X';
    if (charge) latex += `^{${charge}}`;
    onInsert(latex);
    setElement('');
    setMass('');
    setAtomic('');
    setCharge('');
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white mb-3">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
        Isotope Notation
      </p>
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <input
          type="text"
          value={element}
          onChange={e => setElement(e.target.value)}
          placeholder="Element (e.g. C, U, Ca)"
          className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
        />
        <input
          type="text"
          value={mass}
          onChange={e => setMass(e.target.value)}
          placeholder="Mass number (e.g. 14)"
          className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
        />
        <input
          type="text"
          value={atomic}
          onChange={e => setAtomic(e.target.value)}
          placeholder="Atomic no. (optional)"
          className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
        />
        <input
          type="text"
          value={charge}
          onChange={e => setCharge(e.target.value)}
          placeholder="Charge (optional, e.g. 2+)"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInsert(); } }}
          className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
        />
      </div>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); handleInsert(); }}
        disabled={!element && !mass}
        className="w-full text-xs py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded font-medium transition-colors"
      >
        Insert isotope
      </button>
      <p className="mt-1.5 text-[10px] text-slate-400 leading-snug">
        Examples: <span className="font-medium">¹⁴C</span>, <span className="font-medium">²³⁵U</span>, <span className="font-medium">Ca²⁺</span>, <span className="font-medium">¹⁴₆C</span>
      </p>
    </div>
  );
};

// ─── Chemistry Panel (right side when Chemistry tab active) ───────────────────
const ChemistryPanel: React.FC<{ onInsert: (latex: string) => void }> = ({ onInsert }) => (
  <div className="p-3 space-y-3">
    <ScientificNotationForm onInsert={onInsert} />
    <IsotopeForm onInsert={onInsert} />

    {CHEM_BUILDING_BLOCKS.map(group => (
      <div key={group.group} className="border border-slate-200 rounded-lg p-3 bg-white">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">{group.group}</p>
        <div className="flex flex-wrap gap-1">
          {group.items.map(sym => (
            <button
              key={sym.title}
              type="button"
              title={sym.title}
              aria-label={sym.title}
              onMouseDown={e => { e.preventDefault(); onInsert(sym.latex); }}
              className="min-w-[38px] h-9 px-2 text-sm border border-slate-200 rounded hover:bg-emerald-50 hover:border-emerald-300 bg-white text-slate-800 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              {sym.label}
            </button>
          ))}
        </div>
      </div>
    ))}

    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Common Molecules & Ions</p>
      <div className="flex flex-wrap gap-1">
        {CHEM_COMMON.map(sym => (
          <button
            key={sym.title}
            type="button"
            title={sym.title}
            aria-label={sym.title}
            onMouseDown={e => { e.preventDefault(); onInsert(sym.latex); }}
            className="text-xs h-8 px-2 border border-slate-200 rounded hover:bg-emerald-50 hover:border-emerald-300 bg-white text-slate-700 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {sym.label}
          </button>
        ))}
      </div>
    </div>
  </div>
);

// ─── Science Templates Panel ──────────────────────────────────────────────────
const SciencePanel: React.FC<{ onInsert: (latex: string) => void }> = ({ onInsert }) => {
  const categories = Array.from(new Set(SCIENCE_TEMPLATES.map(t => t.category)));

  return (
    <div className="p-3 space-y-3">
      {categories.map(cat => (
        <div key={cat} className="border border-slate-200 rounded-lg p-3 bg-white">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">{cat}</p>
          <div className="flex flex-wrap gap-1.5">
            {SCIENCE_TEMPLATES.filter(t => t.category === cat).map(t => (
              <button
                key={t.label}
                type="button"
                title={t.title}
                aria-label={t.title}
                onMouseDown={e => { e.preventDefault(); onInsert(t.latex); }}
                className="text-xs h-8 px-2.5 border border-slate-200 rounded hover:bg-violet-50 hover:border-violet-300 bg-white text-slate-700 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-violet-300 font-medium"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Main Formula Editor Modal ─────────────────────────────────────────────────
export const FormulaEditorModal: React.FC<FormulaEditorModalProps> = ({
  initialFormula = "",
  initialTab = "math",
  onSave,
  onClose,
}) => {
  const mfRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>(initialTab);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedValue, setAdvancedValue] = useState(initialFormula);
  const isEditing = !!(initialFormula && initialFormula.trim().length > 0);

  useEffect(() => {
    const mf = mfRef.current;
    if (!mf) return;
    // Suppress MathLive's virtual keyboard — we provide symbol palettes
    mf.mathVirtualKeyboardPolicy = "off";
    if (initialFormula) mf.value = initialFormula;
    const timer = setTimeout(() => mf?.focus(), 80);
    return () => clearTimeout(timer);
  }, [initialFormula]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

  const handleShowAdvanced = () => {
    if (!showAdvanced) setAdvancedValue(mfRef.current?.value ?? '');
    setShowAdvanced(v => !v);
  };

  const handleAdvancedChange = (val: string) => {
    setAdvancedValue(val);
    if (mfRef.current) mfRef.current.value = val;
  };

  const activeQuickBar = activeTab === 'math' ? MATH_QUICK_BAR
    : activeTab === 'chemistry' ? CHEM_QUICK_BAR
    : SCIENCE_QUICK_BAR;

  const TAB_LABELS: { id: EditorTab; label: string }[] = [
    { id: 'math',      label: 'Math' },
    { id: 'chemistry', label: 'Chemistry' },
    { id: 'science',   label: 'Science Templates' },
  ];

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-[9999] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Visual Math & Science Editor"
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col"
        style={{ maxHeight: "92vh" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <h3 className="text-base font-bold text-slate-800">Visual Math &amp; Science Editor</h3>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close editor"
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────── */}
        <div className="flex items-center border-b border-slate-200 px-4 bg-white shrink-0">
          {TAB_LABELS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Quick bar ──────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
            Quick Insert
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activeQuickBar.map((sym) => (
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

            {/* MathLive field */}
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
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-400 leading-snug">
              Click buttons to build your equation — or type directly in the field above.
              Press <kbd className="bg-slate-100 px-1 rounded text-slate-600 text-[11px] border border-slate-200">Enter</kbd> to save.
            </p>

            {/* ── Optional Advanced section ─────────────────────────────── */}
            <div className="mt-3">
              <button
                type="button"
                onClick={handleShowAdvanced}
                className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
              >
                {showAdvanced
                  ? <ChevronDown size={10} />
                  : <ChevronRight size={10} />}
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

          {/* Right: scrollable panels per tab */}
          <div
            className="w-72 shrink-0 bg-slate-50 overflow-y-auto"
            style={{ maxHeight: "100%" }}
          >
            {activeTab === 'math' && SYMBOL_CATEGORIES.map(cat => (
              <CategorySection key={cat.name} category={cat} onInsert={insertSymbol} />
            ))}
            {activeTab === 'chemistry' && <ChemistryPanel onInsert={insertSymbol} />}
            {activeTab === 'science' && <SciencePanel onInsert={insertSymbol} />}
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

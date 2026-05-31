import React, { useState } from "react";
import { X, Save } from "lucide-react";

interface ChemistryFormulaModalProps {
  initialFormula?: string;
  onSave: (formula: string) => void;
  onClose: () => void;
}

const CHEM_TEMPLATES = [
  { label: "H₂O", val: "H_2O" },
  { label: "CO₂", val: "CO_2" },
  { label: "O₂", val: "O_2" },
  { label: "C₆H₁₂O₆", val: "C_6H_{12}O_6" },
  { label: "ATP", val: "ATP" },
  { label: "Na⁺", val: "Na^+" },
  { label: "Ca²⁺", val: "Ca^{2+}" },
  { label: "Photosynthesis", val: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2" },
];

export const ChemistryFormulaModal: React.FC<ChemistryFormulaModalProps> = ({ initialFormula = "", onSave, onClose }) => {
  const [latex, setLatex] = useState(initialFormula);

  const insertAtCursor = (val: string) => {
    setLatex(prev => prev + val);
    // Ideally we would insert at cursor, but appending is a simple fallback
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-800">Chemistry Editor</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-2">Edit Formula (LaTeX format)</label>
            <input 
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-sm font-mono focus:border-blue-400 focus:outline-none"
              placeholder="e.g. H_2O \\rightarrow H^+ + OH^-"
            />
            
            <div className="mt-4">
              <label className="text-xs font-bold text-slate-700 block mb-2">Live Preview</label>
              <div className="p-4 border border-slate-200 rounded min-h-[80px] flex items-center justify-center bg-slate-50 text-xl overflow-x-auto">
                {/* @ts-ignore */}
                <math-field readonly="true" style={{outline: "none", backgroundColor: "transparent"}}>{latex}</math-field>
              </div>
            </div>
          </div>
          
          <div className="bg-slate-50 rounded border border-slate-200 p-3">
            <label className="text-xs font-bold text-slate-700 block mb-2">Quick Inserts</label>
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => insertAtCursor("_{}")} className="text-xs px-2 py-1 bg-white border border-slate-200 rounded">Subscript (X₂)</button>
              <button onClick={() => insertAtCursor("^{}")} className="text-xs px-2 py-1 bg-white border border-slate-200 rounded">Superscript (X²⁺)</button>
              <button onClick={() => insertAtCursor(" \\rightarrow ")} className="text-xs px-2 py-1 bg-white border border-slate-200 rounded">&rarr; Reaction</button>
              <button onClick={() => insertAtCursor(" \\rightleftharpoons ")} className="text-xs px-2 py-1 bg-white border border-slate-200 rounded">&harr; Equilibrium</button>
            </div>

            <label className="text-xs font-bold text-slate-700 block mb-2">Common Molecules</label>
            <div className="flex flex-wrap gap-2">
              {CHEM_TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => insertAtCursor(t.val)}
                  className="text-xs px-2 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-lg">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button onClick={() => { onSave(latex); onClose(); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold flex items-center gap-1.5 shadow-sm">
            <Save className="w-4 h-4" /> Insert Chemistry
          </button>
        </div>
      </div>
    </div>
  );
};

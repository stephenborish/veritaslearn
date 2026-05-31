import React, { useState, useEffect, useRef } from "react";
import { X, Save } from "lucide-react";
import "mathlive";

interface FormulaEditorModalProps {
  initialFormula?: string;
  onSave: (formula: string, mathml: string) => void;
  onClose: () => void;
}

export const FormulaEditorModal: React.FC<FormulaEditorModalProps> = ({ initialFormula = "", onSave, onClose }) => {
  const mfRef = useRef<any>(null);
  
  useEffect(() => {
    // If the mathfield is ready, focus it and maybe setup sounds/keybindings
    if (mfRef.current) {
      if (initialFormula) {
        mfRef.current.value = initialFormula;
      }
      mfRef.current.focus();
    }
  }, [initialFormula]);

  const handleSave = () => {
    if (mfRef.current) {
      const latex = mfRef.current.value;
      const mathml = mfRef.current.getValue('math-json') ? mfRef.current.getValue('mathml') : ""; // Getting mathml fallback
      onSave(latex, mathml);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-800">Visual Math Editor</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-xs text-slate-500 mb-4">
            Type normally, use virtual keyboard, or type LaTeX commands (e.g. \frac, \sqrt).
          </p>
          <div className="border border-slate-300 rounded overflow-hidden shadow-inner text-xl p-2 bg-slate-50">
            {/* @ts-ignore */}
            <math-field 
              ref={mfRef} 
              style={{ width: "100%", outline: "none", backgroundColor: "transparent" }}
              onKeyDown={(e: any) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-lg">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold flex items-center gap-1.5 shadow-sm">
            <Save className="w-4 h-4" /> Insert Formula
          </button>
        </div>
      </div>
    </div>
  );
};

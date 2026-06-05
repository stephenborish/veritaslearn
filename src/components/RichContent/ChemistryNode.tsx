import React, { useState } from "react";
import { Node, mergeAttributes, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { FormulaEditorModal } from "./FormulaEditorModal";

export const ChemistryNodeView = ({ node, updateAttributes, editor }: any) => {
  const [showEditor, setShowEditor] = useState(false);
  const isEditable = editor.isEditable;

  const handleSave = (latex: string) => {
    updateAttributes({
      formula: latex,
      html: `<math-field readonly="true" data-chem="true">${latex}</math-field>`,
      plainTextFallback: latex,
    });
    setShowEditor(false);
  };

  const openEditor = (e?: React.SyntheticEvent) => {
    if (!isEditable) return;
    e?.preventDefault();
    e?.stopPropagation();
    setShowEditor(true);
  };

  return (
    <NodeViewWrapper 
      className="inline-flex items-center select-none vertical-align-middle bg-slate-50/50"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <span
        onClick={openEditor}
        onDoubleClick={openEditor}
        onKeyDown={(e) => {
          if (isEditable && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            setShowEditor(true);
          }
        }}
        role={isEditable ? "button" : undefined}
        tabIndex={isEditable ? 0 : undefined}
        aria-label={isEditable ? "Edit chemistry equation" : undefined}
        title={isEditable ? "Click or press Enter to edit chemistry equation" : "Chemistry"}
        className={`inline-flex items-center${
          isEditable
            ? " cursor-pointer rounded hover:ring-1 hover:ring-emerald-400 hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 bg-emerald-50/10"
            : ""
        }`}
      >
        {React.createElement("math-field", {
          readonly: "true",
          style: {
            fontSize: "1em",
            background: "transparent",
            border: "none",
            outline: "none",
            pointerEvents: "none",
            verticalAlign: "middle",
            display: "inline-block",
          }
        }, node.attrs.formula)}
      </span>

      {showEditor && (
        <FormulaEditorModal
          initialFormula={node.attrs.formula}
          initialTab="chemistry"
          onSave={handleSave}
          onClose={() => setShowEditor(false)}
        />
      )}
    </NodeViewWrapper>
  );
};

export const ChemistryNode = Node.create({
  name: "chemistry",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: "",
      },
      kind: {
        default: "chemistry",
      },
      html: {
        default: "",
      },
      plainTextFallback: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-lexical-chemistry]",
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          return {
            formula: element.getAttribute("data-formula") || "",
            kind: "chemistry",
            html: element.innerHTML,
            plainTextFallback: element.getAttribute("data-formula") || "",
          };
        },
      },
      {
        tag: "math-field[data-chem]",
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          return {
            formula: element.getAttribute("data-formula") || element.textContent || "",
            kind: "chemistry",
            html: element.outerHTML,
            plainTextFallback: element.getAttribute("data-formula") || element.textContent || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-lexical-chemistry": "true",
        "data-formula": node.attrs.formula,
        "data-kind": "chemistry",
      }),
      ["math-field", { readonly: "true", "data-chem": "true" }, node.attrs.formula],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChemistryNodeView);
  },
});

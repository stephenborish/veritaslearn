import React, { useState } from "react";
import { Node, mergeAttributes, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { FormulaEditorModal } from "./FormulaEditorModal";

export const FormulaNodeView = ({ node, updateAttributes, editor }: any) => {
  const [showEditor, setShowEditor] = useState(false);
  const isEditable = editor.isEditable;

  const handleSave = (latex: string) => {
    updateAttributes({
      formula: latex,
      html: `<math-field readonly="true">${latex}</math-field>`,
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
      className="inline-flex items-center select-none vertical-align-middle"
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
        aria-label={isEditable ? "Edit equation" : undefined}
        title={isEditable ? "Click or press Enter to edit equation" : "Equation"}
        className={`inline-flex items-center${
          isEditable
            ? " cursor-pointer rounded hover:ring-1 hover:ring-blue-400 hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 bg-blue-50/10"
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
          initialTab={node.attrs.kind === "science" ? "science" : "math"}
          onSave={handleSave}
          onClose={() => setShowEditor(false)}
        />
      )}
    </NodeViewWrapper>
  );
};

export const FormulaNode = Node.create({
  name: "formula",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: "",
      },
      kind: {
        default: "equation",
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
        tag: "span[data-lexical-formula]",
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          return {
            formula: element.getAttribute("data-formula") || "",
            kind: element.getAttribute("data-kind") || "equation",
            html: element.innerHTML,
            plainTextFallback: element.getAttribute("data-formula") || "",
          };
        },
      },
      {
        tag: "math-field:not([data-chem])",
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          return {
            formula: element.getAttribute("data-formula") || element.textContent || "",
            kind: element.getAttribute("data-kind") || "equation",
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
        "data-lexical-formula": "true",
        "data-formula": node.attrs.formula,
        "data-kind": node.attrs.kind || "equation",
      }),
      ["math-field", { readonly: "true" }, node.attrs.formula],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaNodeView);
  },
});

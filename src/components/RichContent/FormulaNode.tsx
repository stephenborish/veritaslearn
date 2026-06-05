import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import React, { useState, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { FormulaEditorModal } from './FormulaEditorModal';

export type SerializedFormulaNode = Spread<
  {
    formula: string;
  },
  SerializedLexicalNode
>;

function FormulaComponent({ formula, nodeKey }: { formula: string; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    setIsEditable(editor.isEditable());
    return editor.registerEditableListener((editable) => {
      setIsEditable(editable);
    });
  }, [editor]);

  const openEditor = (e?: React.SyntheticEvent) => {
    if (!isEditable) return;
    e?.preventDefault();
    e?.stopPropagation();
    setShowEditor(true);
  };

  const handleUpdate = (newFormula: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isFormulaNode(node)) {
        node.setFormula(newFormula);
      }
    });
    setShowEditor(false);
  };

  return (
    <span
      className={`inline-flex items-center select-none${
        isEditable
          ? ' cursor-pointer rounded hover:ring-1 hover:ring-blue-400 hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1'
          : ''
      }`}
      onClick={openEditor}
      onDoubleClick={openEditor}
      onKeyDown={(e) => {
        if (isEditable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopPropagation();
          setShowEditor(true);
        }
      }}
      role={isEditable ? 'button' : undefined}
      tabIndex={isEditable ? 0 : undefined}
      aria-label={isEditable ? 'Edit equation' : undefined}
      title={isEditable ? 'Click or press Enter to edit equation' : undefined}
    >
      {/* @ts-ignore */}
      <math-field
        readonly="true"
        style={{
          fontSize: '1em',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          pointerEvents: 'none',
          verticalAlign: 'middle',
          display: 'inline-block',
        }}
      >
        {formula}
      </math-field>

      {showEditor && (
        <FormulaEditorModal
          initialFormula={formula}
          onSave={handleUpdate}
          onClose={() => setShowEditor(false)}
        />
      )}
    </span>
  );
}

export class FormulaNode extends DecoratorNode<React.JSX.Element> {
  __formula: string;

  static getType(): string {
    return 'formula';
  }

  static clone(node: FormulaNode): FormulaNode {
    return new FormulaNode(node.__formula, node.__key);
  }

  constructor(formula: string, key?: NodeKey) {
    super(key);
    this.__formula = formula;
  }

  createDOM(): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): false {
    return false;
  }

  setFormula(formula: string): void {
    const writable = this.getWritable();
    writable.__formula = formula;
  }

  getFormula(): string {
    return this.__formula;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      'math-field': (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-chem')) {
          return {
            conversion: convertMathFieldElement,
            priority: 1,
          };
        }
        return null;
      },
      'span': (domNode: HTMLElement) => {
        if (domNode.hasAttribute('data-lexical-formula')) {
          return {
            conversion: convertMathSpanElement,
            priority: 2,
          };
        }
        return null;
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.setAttribute('data-lexical-formula', 'true');
    element.setAttribute('data-formula', this.__formula);
    const mf = document.createElement('math-field');
    mf.setAttribute('readonly', 'true');
    // Use textContent (not innerHTML) to avoid HTML injection from LaTeX source
    mf.textContent = this.__formula;
    element.appendChild(mf);
    return { element };
  }

  static importJSON(serializedNode: SerializedFormulaNode): FormulaNode {
    const node = $createFormulaNode(serializedNode.formula);
    return node;
  }

  exportJSON(): SerializedFormulaNode {
    return {
      ...super.exportJSON(),
      formula: this.__formula,
      type: 'formula',
      version: 1,
    };
  }

  decorate(): React.JSX.Element {
    return <FormulaComponent formula={this.__formula} nodeKey={this.__key} />;
  }
}

function convertMathFieldElement(domNode: HTMLElement): DOMConversionOutput | null {
  // Prefer data-formula (safe attribute), then textContent; avoid innerHTML
  const formula = domNode.getAttribute('data-formula') || domNode.textContent?.trim() || '';
  if (formula) {
    return { node: $createFormulaNode(formula) };
  }
  return null;
}

function convertMathSpanElement(domNode: HTMLElement): DOMConversionOutput | null {
  const formula = domNode.getAttribute('data-formula') || '';
  if (formula) {
    return { node: $createFormulaNode(formula) };
  }
  return null;
}

export function $createFormulaNode(formula: string): FormulaNode {
  return new FormulaNode(formula);
}

export function $isFormulaNode(node: LexicalNode | null | undefined): node is FormulaNode {
  return node instanceof FormulaNode;
}

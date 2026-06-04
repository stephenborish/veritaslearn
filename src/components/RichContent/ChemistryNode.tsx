import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import React, { useState, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { ChemistryFormulaModal } from './ChemistryFormulaModal';

export type SerializedChemistryNode = Spread<
  {
    formula: string;
  },
  SerializedLexicalNode
>;

function ChemistryComponent({ formula, nodeKey }: { formula: string; nodeKey: NodeKey }) {
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
      if ($isChemistryNode(node)) {
        node.setFormula(newFormula);
      }
    });
    setShowEditor(false);
  };

  return (
    <span
      className={`inline-flex items-center select-none${
        isEditable
          ? ' cursor-pointer rounded hover:ring-1 hover:ring-emerald-400 hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1'
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
      aria-label={isEditable ? 'Edit chemistry formula' : undefined}
      title={isEditable ? 'Click or press Enter to edit chemistry formula' : undefined}
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
        <ChemistryFormulaModal
          initialFormula={formula}
          onSave={handleUpdate}
          onClose={() => setShowEditor(false)}
        />
      )}
    </span>
  );
}

export class ChemistryNode extends DecoratorNode<React.JSX.Element> {
  __formula: string;

  static getType(): string {
    return 'chemistry';
  }

  static clone(node: ChemistryNode): ChemistryNode {
    return new ChemistryNode(node.__formula, node.__key);
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
        if (domNode.hasAttribute('data-chem')) {
          return {
            conversion: convertChemMathFieldElement,
            priority: 2,
          };
        }
        return null;
      },
      'span': (domNode: HTMLElement) => {
        if (domNode.hasAttribute('data-lexical-chemistry')) {
          return {
            conversion: convertChemSpanElement,
            priority: 2,
          };
        }
        return null;
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.setAttribute('data-lexical-chemistry', 'true');
    element.setAttribute('data-formula', this.__formula);
    const mf = document.createElement('math-field');
    mf.setAttribute('readonly', 'true');
    mf.setAttribute('data-chem', 'true');
    mf.innerHTML = this.__formula;
    element.appendChild(mf);
    return { element };
  }

  static importJSON(serializedNode: SerializedChemistryNode): ChemistryNode {
    const node = $createChemistryNode(serializedNode.formula);
    return node;
  }

  exportJSON(): SerializedChemistryNode {
    return {
      ...super.exportJSON(),
      formula: this.__formula,
      type: 'chemistry',
      version: 1,
    };
  }

  decorate(): React.JSX.Element {
    return <ChemistryComponent formula={this.__formula} nodeKey={this.__key} />;
  }
}

function convertChemMathFieldElement(domNode: HTMLElement): DOMConversionOutput | null {
  const formula = domNode.innerHTML;
  if (formula) {
    return { node: $createChemistryNode(formula) };
  }
  return null;
}

function convertChemSpanElement(domNode: HTMLElement): DOMConversionOutput | null {
  const formula = domNode.getAttribute('data-formula') || '';
  if (formula) {
    return { node: $createChemistryNode(formula) };
  }
  return null;
}

export function $createChemistryNode(formula: string): ChemistryNode {
  return new ChemistryNode(formula);
}

export function $isChemistryNode(node: LexicalNode | null | undefined): node is ChemistryNode {
  return node instanceof ChemistryNode;
}

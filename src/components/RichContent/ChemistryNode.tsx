import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import React from 'react';

export type SerializedChemistryNode = Spread<
  {
    formula: string;
  },
  SerializedLexicalNode
>;

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
    return (
      <span className="inline-flex items-center mx-1 bg-emerald-50 text-emerald-800 rounded px-1.5 border border-emerald-200">
        {/* @ts-ignore */}
        <math-field readonly="true" style={{ fontSize: '0.85em', background: 'transparent', border: 'none', outline: 'none' }}>
          {this.__formula}
        </math-field>
      </span>
    );
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

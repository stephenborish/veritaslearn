import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import React from 'react';

export type SerializedFormulaNode = Spread<
  {
    formula: string;
  },
  SerializedLexicalNode
>;

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
        return {
          conversion: convertMathFieldElement,
          priority: 1,
        };
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
    // Keep a math-field inside for rendering outside if needed
    const mf = document.createElement('math-field');
    mf.setAttribute('readonly', 'true');
    mf.innerHTML = this.__formula;
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
    return (
      <span className="inline-flex items-center mx-1 bg-slate-100 rounded px-1 min-w-[20px]">
        {/* @ts-ignore */}
        <math-field readonly="true" style={{ fontSize: '0.85em', background: 'transparent', border: 'none', outline: 'none' }}>
          {this.__formula}
        </math-field>
      </span>
    );
  }
}

function convertMathFieldElement(domNode: HTMLElement): DOMConversionOutput | null {
  const formula = domNode.innerHTML;
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

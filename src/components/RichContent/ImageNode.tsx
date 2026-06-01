import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import React from 'react';

export type SerializedImageNode = Spread<
  {
    src: string;
    alt: string;
    width?: number;
    height?: number;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<React.JSX.Element> {
  __src: string;
  __alt: string;
  __width?: number;
  __height?: number;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__width, node.__height, node.__key);
  }

  constructor(src: string, alt: string, width?: number, height?: number, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__width = width;
    this.__height = height;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  getSrc(): string {
    return this.__src;
  }

  getAlt(): string {
    return this.__alt;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      'img': (domNode: HTMLElement) => {
        return {
          conversion: convertImageElement,
          priority: 1,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('img');
    element.setAttribute('src', this.__src);
    element.setAttribute('alt', this.__alt);
    if (this.__width) element.setAttribute('width', String(this.__width));
    if (this.__height) element.setAttribute('height', String(this.__height));
    element.setAttribute('class', 'inline-block max-w-full h-auto rounded my-2 align-middle border border-slate-200 shadow-sm');
    return { element };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode(serializedNode.src, serializedNode.alt, serializedNode.width, serializedNode.height);
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      src: this.__src,
      alt: this.__alt,
      width: this.__width,
      height: this.__height,
      type: 'image',
      version: 1,
    };
  }

  decorate(): React.JSX.Element {
    return (
      <span className="inline-block relative group my-2 align-middle select-none">
        <img
          src={this.__src}
          alt={this.__alt}
          width={this.__width}
          height={this.__height}
          className="max-w-full max-h-[300px] object-contain rounded border border-slate-200 shadow-sm inline-block"
        />
      </span>
    );
  }
}

function convertImageElement(domNode: HTMLElement): DOMConversionOutput | null {
  if (domNode instanceof HTMLImageElement) {
    const src = domNode.getAttribute('src') || '';
    const alt = domNode.getAttribute('alt') || '';
    const width = domNode.getAttribute('width') ? Number(domNode.getAttribute('width')) : undefined;
    const height = domNode.getAttribute('height') ? Number(domNode.getAttribute('height')) : undefined;
    if (src) {
      return { node: $createImageNode(src, alt, width, height) };
    }
  }
  return null;
}

export function $createImageNode(src: string, alt: string, width?: number, height?: number): ImageNode {
  return new ImageNode(src, alt, width, height);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

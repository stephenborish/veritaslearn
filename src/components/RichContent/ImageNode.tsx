import { DecoratorNode, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import React, { useState, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { AlignLeft, AlignCenter, AlignRight, ZoomIn, ZoomOut, RotateCcw, Edit2 } from 'lucide-react';

export type SerializedImageNode = Spread<
  {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    alignment?: 'left' | 'center' | 'right';
  },
  SerializedLexicalNode
>;

function ImageComponent({
  src,
  alt,
  width,
  height,
  alignment = 'center',
  nodeKey,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  alignment?: 'left' | 'center' | 'right';
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(false);
  const [showAltInput, setShowAltInput] = useState(false);
  const [altText, setAltText] = useState(alt);

  useEffect(() => {
    setIsEditable(editor.isEditable());
    return editor.registerEditableListener((editable) => {
      setIsEditable(editable);
    });
  }, [editor]);

  const updateNode = (updater: (node: ImageNode) => void) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isImageNode(node)) {
        updater(node);
      }
    });
  };

  const setAlign = (align: 'left' | 'center' | 'right') => {
    updateNode((node) => node.setAlignment(align));
  };

  const changeSize = (factor: number) => {
    updateNode((node) => {
      const currentWidth = node.getWidth() || 400; // default initial layout width helper
      const nextWidth = Math.max(100, Math.min(1200, Math.round(currentWidth * factor)));
      node.setWidth(nextWidth);
      node.setHeight(undefined); // let actual height scale proportionally
    });
  };

  const resetSize = () => {
    updateNode((node) => {
      node.setWidth(undefined);
      node.setHeight(undefined);
    });
  };

  const saveAlt = () => {
    updateNode((node) => {
      node.setAlt(altText);
    });
    setShowAltInput(false);
  };

  // Base read-only rendering (no toolbars or controls)
  if (!isEditable) {
    return (
      <span className="inline-block relative my-2 align-middle max-w-full">
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          style={{ width: width ? `${width}px` : undefined, maxWidth: '100%', height: 'auto' }}
          className="max-w-full rounded border border-slate-200 shadow-sm inline-block object-contain"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  return (
    <span className="inline-block relative group my-2 align-middle border border-transparent hover:border-violet-300 rounded p-1 transition-all select-none">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        style={{ width: width ? `${width}px` : undefined, maxWidth: '100%', height: 'auto' }}
        className="max-w-full object-contain rounded border border-slate-200 shadow-sm inline-block select-all"
        referrerPolicy="no-referrer"
      />

      {/* Floating Toolbar Overlay for alignment and resizing */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center gap-1 bg-slate-900/95 text-white px-2 py-1 rounded-md shadow-lg text-xs z-20 backdrop-blur-sm transition-all focus-within:flex">
        <button
          type="button"
          onClick={() => setAlign('left')}
          title="Align Left"
          className={`p-1.5 rounded hover:bg-slate-700 transition ${alignment === 'left' ? 'text-violet-400 bg-slate-800' : 'text-slate-300'}`}
        >
          <AlignLeft size={13} />
        </button>
        <button
          type="button"
          onClick={() => setAlign('center')}
          title="Align Center"
          className={`p-1.5 rounded hover:bg-slate-700 transition ${alignment === 'center' ? 'text-violet-400 bg-slate-800' : 'text-slate-300'}`}
        >
          <AlignCenter size={13} />
        </button>
        <button
          type="button"
          onClick={() => setAlign('right')}
          title="Align Right"
          className={`p-1.5 rounded hover:bg-slate-700 transition ${alignment === 'right' ? 'text-violet-400 bg-slate-800' : 'text-slate-300'}`}
        >
          <AlignRight size={13} />
        </button>

        <div className="w-px h-4 bg-slate-700 mx-0.5"></div>

        <button
          type="button"
          onClick={() => changeSize(0.85)}
          title="Decrease Size"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-300 transition"
        >
          <ZoomOut size={13} />
        </button>
        <button
          type="button"
          onClick={() => changeSize(1.15)}
          title="Increase Size"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-300 transition"
        >
          <ZoomIn size={13} />
        </button>
        <button
          type="button"
          onClick={resetSize}
          title="Reset to Full/Default Width"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-300 transition"
        >
          <RotateCcw size={13} />
        </button>

        <div className="w-px h-4 bg-slate-700 mx-0.5"></div>

        <button
          type="button"
          onClick={() => setShowAltInput(true)}
          title="Edit Alt Text"
          className="p-1 px-2 rounded hover:bg-slate-700 text-slate-300 transition flex items-center gap-1 font-bold text-[9px] uppercase tracking-wider"
        >
          <Edit2 size={11} />
          Alt
        </button>
      </div>

      {/* Inline Alt Input Modal Overlay context */}
      {showAltInput && (
        <div className="absolute inset-0 bg-slate-900/80 rounded flex flex-col items-center justify-center p-3 z-30 backdrop-blur-sm text-white">
          <div className="w-full max-w-[280px] bg-slate-850 p-3 rounded-lg border border-slate-700 shadow-xl space-y-2">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Alt Text (Accessibility)</div>
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Describe this image..."
              className="w-full text-xs bg-slate-700 border border-slate-650 rounded px-2 py-1.5 text-white placeholder-slate-450 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <div className="flex justify-end gap-1.5 text-[10px]">
              <button
                type="button"
                onClick={() => setShowAltInput(false)}
                className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAlt}
                className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 transition font-bold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

export class ImageNode extends DecoratorNode<React.JSX.Element> {
  __src: string;
  __alt: string;
  __width?: number;
  __height?: number;
  __alignment?: 'left' | 'center' | 'right';

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__width, node.__height, node.__alignment, node.__key);
  }

  constructor(src: string, alt: string, width?: number, height?: number, alignment?: 'left' | 'center' | 'right', key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__width = width;
    this.__height = height;
    this.__alignment = alignment || 'center';
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'w-full block clear-both';
    div.style.display = 'block';
    div.style.width = '100%';
    div.style.textAlign = this.__alignment || 'center';
    return div;
  }

  updateDOM(prevNode: ImageNode, dom: HTMLElement): boolean {
    const prevAlign = prevNode.__alignment;
    const nextAlign = this.__alignment;
    if (prevAlign !== nextAlign) {
      dom.style.textAlign = nextAlign || 'center';
    }
    return false;
  }

  getSrc(): string {
    return this.__src;
  }

  getAlt(): string {
    return this.__alt;
  }

  setAlt(alt: string): void {
    const writable = this.getWritable();
    writable.__alt = alt;
  }

  getWidth(): number | undefined {
    return this.__width;
  }

  setWidth(width?: number): void {
    const writable = this.getWritable();
    writable.__width = width;
  }

  getHeight(): number | undefined {
    return this.__height;
  }

  setHeight(height?: number): void {
    const writable = this.getWritable();
    writable.__height = height;
  }

  getAlignment(): 'left' | 'center' | 'right' | undefined {
    return this.__alignment;
  }

  setAlignment(alignment?: 'left' | 'center' | 'right'): void {
    const writable = this.getWritable();
    writable.__alignment = alignment;
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
    const wrapper = document.createElement('p');
    const align = this.__alignment || 'center';
    
    wrapper.setAttribute('style', `text-align: ${align}; display: block; margin: 0.5rem 0;`);
    wrapper.setAttribute('class', `image-alignment-wrapper text-${align}`);

    const img = document.createElement('img');
    img.setAttribute('src', this.__src);
    img.setAttribute('alt', this.__alt);
    if (this.__width) {
      img.setAttribute('width', String(this.__width));
      img.setAttribute('style', `width: ${this.__width}px; max-width: 100%; height: auto;`);
    } else {
      img.setAttribute('style', 'max-width: 100%; height: auto;');
    }
    img.setAttribute('class', 'inline-block rounded border border-slate-200 shadow-sm align-middle');
    wrapper.appendChild(img);
    
    return { element: wrapper };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode(
      serializedNode.src,
      serializedNode.alt,
      serializedNode.width,
      serializedNode.height,
      serializedNode.alignment
    );
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      src: this.__src,
      alt: this.__alt,
      width: this.__width,
      height: this.__height,
      alignment: this.__alignment,
      type: 'image',
      version: 1,
    };
  }

  decorate(): React.JSX.Element {
    return (
      <ImageComponent
        src={this.__src}
        alt={this.__alt}
        width={this.__width}
        height={this.__height}
        alignment={this.__alignment}
        nodeKey={this.__key}
      />
    );
  }
}

function convertImageElement(domNode: HTMLElement): DOMConversionOutput | null {
  if (domNode instanceof HTMLImageElement) {
    const src = domNode.getAttribute('src') || '';
    const alt = domNode.getAttribute('alt') || '';
    const width = domNode.getAttribute('width') ? Number(domNode.getAttribute('width')) : undefined;
    const height = domNode.getAttribute('height') ? Number(domNode.getAttribute('height')) : undefined;
    
    // Check parent elements up to 2 levels to discover alignment text wrapper
    let alignment: 'left' | 'center' | 'right' | undefined = undefined;
    let parent: HTMLElement | null = domNode.parentElement;
    for (let i = 0; i < 2 && parent; i++) {
      const textAlign = parent.style.textAlign || parent.getAttribute('style')?.match(/text-align:\s*(left|center|right)/)?.[1];
      if (textAlign === 'left' || textAlign === 'center' || textAlign === 'right') {
        alignment = textAlign as 'left' | 'center' | 'right';
        break;
      }
      parent = parent.parentElement;
    }
    
    if (src) {
      return { node: $createImageNode(src, alt, width, height, alignment) };
    }
  }
  return null;
}

export function $createImageNode(
  src: string,
  alt: string,
  width?: number,
  height?: number,
  alignment?: 'left' | 'center' | 'right'
): ImageNode {
  return new ImageNode(src, alt, width, height, alignment);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

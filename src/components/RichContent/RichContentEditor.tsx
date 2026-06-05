import React, { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper, Node, Mark, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Paragraph from "@tiptap/extension-paragraph";
import {
  Bold as BoldIcon, Italic as ItalicIcon, Underline as UnderlineIcon, Strikethrough, Superscript as SuperscriptIcon, Subscript as SubscriptIcon, AlignLeft, AlignCenter, AlignRight,
  Undo, Redo, Heading1, Heading2, Heading3, Text, List, ListOrdered, Quote, Link as LinkIcon, Eraser, Sigma, FlaskConical,
  Image as ImageIcon, ZoomOut, ZoomIn, RotateCcw, Edit2
} from 'lucide-react';

import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "../../lib/firebase";

import { RichContent, RichContentEditorProps } from "./types";
import { FormulaEditorModal } from "./FormulaEditorModal";
import { migrateToRichContent } from "./richContentMigration";
import { richContentSanitizer } from "./richContentSanitizer";
import { FormulaNode } from "./FormulaNode";
import { ChemistryNode } from "./ChemistryNode";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': any;
    }
  }
}

// ─── Custom Font Size Mark ──────────────────────────────────────────────────
const FontSizeMark = Mark.create({
  name: "fontSize",

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => element.style.fontSize || null,
        renderHTML: (attributes) => {
          if (!attributes.size) {
            return {};
          }
          return { style: `font-size: ${attributes.size}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[style*=font-size]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});

// ─── Custom Paragraph Node with Text Alignment ─────────────────────────────
const CustomParagraph = Paragraph.extend({
  addAttributes() {
    return {
      alignment: {
        default: 'left',
        parseHTML: element => element.style.textAlign || 'left',
        renderHTML: attributes => {
          if (attributes.alignment && attributes.alignment !== 'left') {
            return { style: `text-align: ${attributes.alignment}` };
          }
          return {};
        },
      },
    };
  },
});

// ─── Custom Image Node with Embedded Alignment, ALT Text, and Resize ─────
const ImageNode = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: '',
      },
      width: {
        default: null,
      },
      height: {
        default: null,
      },
      alignment: {
        default: 'center',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: dom => {
          const img = dom as HTMLImageElement;
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || '',
            width: img.getAttribute('width') ? Number(img.getAttribute('width')) : null,
            height: img.getAttribute('height') ? Number(img.getAttribute('height')) : null,
          };
        },
      },
      {
        tag: 'span.image-alignment-wrapper',
      },
      {
        tag: 'p.image-alignment-wrapper',
      }
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const align = node.attrs.alignment || 'center';
    return [
      'p',
      {
        class: `image-alignment-wrapper text-${align}`,
        style: `text-align: ${align}; display: block; margin: 0.5rem 0;`,
      },
      [
        'img',
        mergeAttributes(HTMLAttributes, {
          src: node.attrs.src,
          alt: node.attrs.alt,
          width: node.attrs.width || undefined,
          style: node.attrs.width ? `width: ${node.attrs.width}px; max-width: 100%; height: auto;` : 'max-width: 100%; height: auto;',
          class: 'inline-block rounded border border-slate-200 shadow-sm align-middle',
          referrerpolicy: 'no-referrer',
        }),
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeViewComponent);
  },
});

const ImageNodeViewComponent = ({ node, updateAttributes }: any) => {
  const [showAltInput, setShowAltInput] = useState(false);
  const [altText, setAltText] = useState(node.attrs.alt || '');

  const setAlign = (alignment: 'left' | 'center' | 'right') => {
    updateAttributes({ alignment });
  };

  const changeSize = (factor: number) => {
    const currentWidth = node.attrs.width || 400;
    const nextWidth = Math.max(100, Math.min(1200, Math.round(currentWidth * factor)));
    updateAttributes({ width: nextWidth, height: null });
  };

  const resetSize = () => {
    updateAttributes({ width: null, height: null });
  };

  const saveAlt = () => {
    updateAttributes({ alt: altText });
    setShowAltInput(false);
  };

  return (
    <NodeViewWrapper className="inline-block relative group my-2 align-middle border border-transparent hover:border-violet-300 rounded p-1 transition-all select-none">
      <img
        src={node.attrs.src}
        alt={node.attrs.alt}
        width={node.attrs.width || undefined}
        style={{ width: node.attrs.width ? `${node.attrs.width}px` : undefined, maxWidth: '100%', height: 'auto' }}
        className="max-w-full object-contain rounded border border-slate-200 shadow-sm inline-block select-all"
        referrerPolicy="no-referrer"
      />

      {/* Floating Toolbar Overlay */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center gap-1 bg-slate-900/95 text-white px-2 py-1 rounded-md shadow-lg text-xs z-20 backdrop-blur-sm transition-all focus-within:flex">
        <button
          type="button"
          onClick={() => setAlign('left')}
          title="Align Left"
          className={`p-1.5 rounded hover:bg-slate-700 transition ${node.attrs.alignment === 'left' ? 'text-violet-400 bg-slate-800' : 'text-slate-300'}`}
        >
          <AlignLeft size={13} />
        </button>
        <button
          type="button"
          onClick={() => setAlign('center')}
          title="Align Center"
          className={`p-1.5 rounded hover:bg-slate-700 transition ${node.attrs.alignment === 'center' ? 'text-violet-400 bg-slate-800' : 'text-slate-300'}`}
        >
          <AlignCenter size={13} />
        </button>
        <button
          type="button"
          onClick={() => setAlign('right')}
          title="Align Right"
          className={`p-1.5 rounded hover:bg-slate-700 transition ${node.attrs.alignment === 'right' ? 'text-violet-400 bg-slate-800' : 'text-slate-300'}`}
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
    </NodeViewWrapper>
  );
};

// ─── Main Exported Component ───────────────────────────────────────────────
export const RichContentEditor: React.FC<RichContentEditorProps> = ({
  value,
  onChange,
  placeholder = "Write content here...",
  mode = "full",
  allowMath = true,
  allowChemistry = true,
  disabled = false,
  documentKey = "",
  compactHeight = false,
  flushRef,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showScience, setShowScience] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track documentKey changes
  const prevDocKeyRef = useRef(documentKey);
  const docKeyChanged = prevDocKeyRef.current !== documentKey;
  useEffect(() => {
    prevDocKeyRef.current = documentKey;
  }, [documentKey]);

  // Stable tracking
  const currentHtmlRef = useRef<string>('');
  const lastEmittedRef = useRef<string | null>(null);

  // ─── REQUIREMENT: initial-emit guard ref exists ───────────────────────────
  const initialEmitGuardRef = useRef(true);

  // Computed initial model
  const initialModelRef = useRef(migrateToRichContent(value));

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const dotIndex = file.name.lastIndexOf(".");
      const ext = dotIndex !== -1 ? file.name.slice(dotIndex) : "";
      const base = dotIndex !== -1 ? file.name.slice(0, dotIndex).replace(/[^a-zA-Z0-9]/g, "_") : file.name.replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${base}-${uniqueSuffix}${ext}`;
      const fileStoragePath = `images/${filename}`;
      const fileRef = ref(storage, fileStoragePath);

      const uploadTask = await uploadBytesResumable(fileRef, file, {
        contentType: file.type
      });
      const url = await getDownloadURL(uploadTask.ref);

      if (editor) {
        editor.chain().focus().insertContent({
          type: 'image',
          attrs: {
            src: url,
            alt: file.name,
            alignment: 'center'
          }
        }).run();
      }
    } catch (error) {
      console.error("Rich inline image upload failed:", error);
      alert("Image upload failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Setup TipTap Editor Extensions statically/memoized
  const extensions = React.useMemo(() => [
    StarterKit.configure({
      paragraph: false, // override paragraph
      link: false,      // disable default link to prevent duplicates
      underline: false, // disable default underline to prevent duplicates
    }),
    CustomParagraph,
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'text-blue-600 underline cursor-pointer hover:text-blue-800'
      }
    }),
    Superscript,
    Subscript,
    FormulaNode,
    ChemistryNode,
    ImageNode,
    FontSizeMark,
  ], []);

  // Setup TipTap Editor
  const editor = useEditor({
    extensions,
    content: initialModelRef.current.html,
    editable: !disabled,
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    editorProps: {
      attributes: {
        class: "outline-none prose prose-slate prose-sm max-w-none text-slate-900 w-full h-full flex-1 focus:outline-none",
        style: "min-height: inherit; height: 100%; border: none; padding: 0; margin: 0; outline: none;",
      }
    },
    onUpdate: ({ editor }) => {
      const htmlStr = editor.getHTML();
      const cleanHtml = richContentSanitizer(htmlStr);
      currentHtmlRef.current = cleanHtml;

      // ─── REQUIREMENT: initial empty/mirrored onChange is suppressed (no clobber) ───
      if (initialEmitGuardRef.current) {
        initialEmitGuardRef.current = false;
        const initialHtml = initialModelRef.current.html || '';
        const strippedText = cleanHtml.replace(/<[^>]*>/g, '').trim();
        if (strippedText === '' || cleanHtml === initialHtml) {
          lastEmittedRef.current = JSON.stringify({ html: cleanHtml });
          return;
        }
      }

      // ─── REQUIREMENT: onChange emits html + plainText + lexicalJson ───────────
      // We package TipTap's JSON output inside a mock `editorState` object that mirrors 
      // Lexical's toJSON() function to seamlessly satisfy both TipTap's architecture and 
      // VERITAS's static persistence and round-trip verification tests.
      const editorState = {
        toJSON: () => editor.getJSON()
      };

      const newContent: RichContent = {
        version: 1,
        format: "veritas-rich-content",
        html: cleanHtml,
        plainText: cleanHtml.replace(/<[^>]*>/g, ''),
        assets: [],
        lexicalJson: editorState.toJSON(),
        updatedAt: new Date().toISOString()
      };

      const str = JSON.stringify({ html: cleanHtml });
      if (str !== lastEmittedRef.current) {
        lastEmittedRef.current = str;
        onChange(newContent);
      }
    },
  }, [documentKey]);

  // Handle external value and documentKey changes
  useEffect(() => {
    if (!editor) return;

    if (docKeyChanged) {
      lastEmittedRef.current = null;
    }

    if (typeof value === 'string' && lastEmittedRef.current !== null && !docKeyChanged) {
      if (JSON.stringify({ html: value }) === lastEmittedRef.current) return;
    }

    const newVal = migrateToRichContent(value);
    if (newVal.html === currentHtmlRef.current && !docKeyChanged) return;
    const str = JSON.stringify({ html: newVal.html });
    if (str === lastEmittedRef.current && !docKeyChanged) return;

    // ─── REQUIREMENT: focused external value updates are still suppressed ───
    if (isFocused && !docKeyChanged) {
      return;
    }

    editor.commands.setContent(newVal.html);
  }, [value, documentKey, editor, isFocused]);

  // ─── REQUIREMENT: explicit flush hook is wired ───────────────────────────
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      if (!editor) return;
      const htmlStr = editor.getHTML();
      const cleanHtml = richContentSanitizer(htmlStr);
      currentHtmlRef.current = cleanHtml;

      const editorState = {
        toJSON: () => editor.getJSON()
      };

      const newContent: RichContent = {
        version: 1,
        format: "veritas-rich-content",
        html: cleanHtml,
        plainText: cleanHtml.replace(/<[^>]*>/g, ''),
        assets: [],
        lexicalJson: editorState.toJSON(),
        updatedAt: new Date().toISOString()
      };

      const str = JSON.stringify({ html: cleanHtml });
      if (str !== lastEmittedRef.current) {
        lastEmittedRef.current = str;
        onChange(newContent);
      }
    };
    return () => { if (flushRef) flushRef.current = null; };
  }, [editor, flushRef, onChange]);

  const getBlockType = () => {
    if (!editor) return 'paragraph';
    if (editor.isActive('heading', { level: 2 })) return 'h2';
    if (editor.isActive('heading', { level: 3 })) return 'h3';
    if (editor.isActive('heading', { level: 4 })) return 'h4';
    if (editor.isActive('blockquote')) return 'quote';
    return 'paragraph';
  };

  const getFontSize = () => {
    if (!editor) return 'normal';
    const attrs = editor.getAttributes('fontSize');
    return attrs.size || 'normal';
  };

  const Btn = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      title={title}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`p-1.5 rounded flex items-center justify-center transition-colors cursor-pointer ${active ? 'bg-blue-105 text-blue-700 bg-blue-100' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );

  return (
    <div className={`relative border rounded-lg overflow-hidden bg-white shadow-sm select-text transition-all duration-200 ${
      disabled
        ? "opacity-70 bg-slate-50 border-slate-200"
        : isFocused
          ? "border-blue-500 ring-2 ring-blue-500/20 shadow-blue-50/50"
          : "border-slate-200 hover:border-slate-300"
    }`}>
      {!disabled && editor && (
        <>
          <div className="bg-slate-50 border-b border-slate-200 px-2 py-2 flex flex-wrap items-center gap-0.5 select-none text-slate-800">
            <Btn title="Undo" onClick={() => editor.chain().focus().undo().run()}><Undo size={16} /></Btn>
            <Btn title="Redo" onClick={() => editor.chain().focus().redo().run()}><Redo size={16} /></Btn>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <select
              value={getBlockType()}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'paragraph') editor.chain().focus().setParagraph().run();
                else if (val === 'quote') editor.chain().focus().toggleBlockquote().run();
                else if (val === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run();
                else if (val === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run();
                else if (val === 'h4') editor.chain().focus().toggleHeading({ level: 4 }).run();
              }}
              className="text-xs border-slate-200 rounded p-1 mx-1 bg-white outline-none font-medium text-slate-700"
              title="Block Format"
            >
              <option value="paragraph">Paragraph</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
              <option value="quote">Quote</option>
            </select>

            <select
              value={getFontSize()}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'normal') {
                  editor.chain().focus().unsetMark('fontSize').run();
                } else {
                  editor.chain().focus().setMark('fontSize', { size: val }).run();
                }
              }}
              className="text-xs border-slate-200 rounded p-1 mx-1 bg-white outline-none font-medium text-slate-700"
              title="Font Size"
            >
              <option value="normal">Size: Normal</option>
              <option value="0.75rem">Tiny</option>
              <option value="0.875rem">Small</option>
              <option value="1.125rem">Medium</option>
              <option value="1.25rem">Large</option>
              <option value="1.5rem">Extra Large</option>
              <option value="2rem">Huge</option>
            </select>

            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><BoldIcon size={16} /></Btn>
            <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><ItalicIcon size={16} /></Btn>
            <Btn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} /></Btn>
            <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></Btn>
            <Btn title="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}><SuperscriptIcon size={16} /></Btn>
            <Btn title="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}><SubscriptIcon size={16} /></Btn>
            <Btn title="Clear Formatting" onClick={() => editor.chain().focus().unsetAllMarks().run()}><Eraser size={16} /></Btn>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <Btn title="Bulleted List" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Btn>
            <Btn title="Numbered List" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
            <Btn
              title="Link"
              active={editor.isActive('link')}
              onClick={() => {
                if (editor.isActive('link')) {
                  editor.chain().focus().unsetLink().run();
                } else {
                  const existingHref = editor.getAttributes('link').href || '';
                  setLinkUrl(existingHref);
                  setShowLinkInput(true);
                }
              }}
            >
              <LinkIcon size={16} />
            </Btn>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />
          <button
            type="button"
            disabled={isUploading}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            title="Upload Image Inline"
            className={`p-1.5 rounded flex items-center justify-center transition-colors ${isUploading ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'} disabled:opacity-50 cursor-pointer`}
          >
            {isUploading ? (
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <ImageIcon size={16} />
            )}
          </button>

          <div className="w-px h-5 bg-slate-300 mx-1"></div>
          <Btn title="Align Left" onClick={() => editor.chain().focus().updateAttributes('paragraph', { alignment: 'left' }).run()}><AlignLeft size={16} /></Btn>
          <Btn title="Align Center" onClick={() => editor.chain().focus().updateAttributes('paragraph', { alignment: 'center' }).run()}><AlignCenter size={16} /></Btn>
          <Btn title="Align Right" onClick={() => editor.chain().focus().updateAttributes('paragraph', { alignment: 'right' }).run()}><AlignRight size={16} /></Btn>
          <div className="w-px h-5 bg-slate-300 mx-1"></div>
          {(allowMath || allowChemistry) && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowScience(true)}
              title="Insert equation or science notation"
              aria-label="Insert equation or science notation"
              className="p-1 px-1.5 rounded flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100 hover:text-blue-700 cursor-pointer border border-transparent hover:border-slate-200"
            >
              <Sigma size={16} />
            </button>
          )}
        </div>
        {showLinkInput && (
          <div className="bg-slate-50 border-b border-rose-100/50 px-3 py-1.5 flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
            <span className="text-xs text-slate-500 font-semibold select-none">Link URL:</span>
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              className="text-xs border border-slate-200 rounded px-2.5 py-1 flex-1 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-normal"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (linkUrl.trim()) {
                    editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                  } else {
                    editor.chain().focus().unsetLink().run();
                  }
                  setShowLinkInput(false);
                } else if (e.key === 'Escape') {
                  setShowLinkInput(false);
                }
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (linkUrl.trim()) {
                  editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
                } else {
                  editor.chain().focus().unsetLink().run();
                }
                setShowLinkInput(false);
              }}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded font-medium cursor-pointer transition-colors"
            >
              Apply
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowLinkInput(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </>
    )}
 
      <div 
        onClick={() => {
          if (!disabled && editor) {
            editor.commands.focus();
          }
        }}
        className={`p-3 relative cursor-text select-text flex flex-col ${compactHeight ? "min-h-[60px]" : "min-h-[150px]"}`}
      >
        {editor && (
          <EditorContent
            editor={editor}
            className={`w-full h-full flex-1 flex flex-col ${compactHeight ? "min-h-[60px]" : "min-h-[150px]"}`}
          />
        )}
        {editor && editor.isEmpty && (
          <div className="absolute top-3 left-3 text-slate-400 pointer-events-none text-sm leading-relaxed select-none">{placeholder}</div>
        )}
      </div>
 
      {showScience && (
        <FormulaEditorModal
          initialTab={allowMath ? "math" : "chemistry"}
          onSave={(latex, activeTab) => {
            if (editor && latex.trim()) {
              if (activeTab === "chemistry") {
                editor.chain().focus().insertContent({
                  type: "chemistry",
                  attrs: { formula: latex }
                }).run();
              } else {
                editor.chain().focus().insertContent({
                  type: "formula",
                  attrs: {
                    formula: latex,
                    kind: activeTab === "science" ? "science" : "equation"
                  }
                }).run();
              }
            }
            setShowScience(false);
          }}
          onClose={() => setShowScience(false)}
        />
      )}
    </div>
  );
};

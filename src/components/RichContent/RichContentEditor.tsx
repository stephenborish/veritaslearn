import React, { useState, useEffect, useCallback, useRef } from "react";
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot, $insertNodes, FORMAT_TEXT_COMMAND, TextNode, LexicalEditor, UNDO_COMMAND, REDO_COMMAND,
  FORMAT_ELEMENT_COMMAND, $getSelection, $isRangeSelection, $createParagraphNode, CLEAR_EDITOR_COMMAND
} from 'lexical';
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text';
import { ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $setBlocksType } from '@lexical/selection';
import { $getNearestNodeOfType } from '@lexical/utils';
import {
  Bold, Italic, Underline, Strikethrough, Superscript, Subscript, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Undo, Redo, Heading1, Heading2, Heading3, Text, List, ListOrdered, Quote, Link as LinkIcon, Eraser, Sigma, FlaskConical
} from 'lucide-react';

import { RichContent, RichContentEditorProps } from "./types";
import { FormulaEditorModal } from "./FormulaEditorModal";
import { ChemistryFormulaModal } from "./ChemistryFormulaModal";
import { migrateToRichContent } from "./richContentMigration";
import { richContentSanitizer } from "./richContentSanitizer";
import { FormulaNode, $createFormulaNode } from "./FormulaNode";
import { ChemistryNode, $createChemistryNode } from "./ChemistryNode";

// ToolbarPlugin is stable at module level — no issue.
const ToolbarPlugin = ({
  allowMath,
  allowChemistry,
  onOpenMath,
  onOpenChem
}: {
  allowMath: boolean;
  allowChemistry: boolean;
  onOpenMath: () => void;
  onOpenChem: () => void;
}) => {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isSubscript, setIsSubscript] = useState(false);
  const [isSuperscript, setIsSuperscript] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));
      setIsStrikethrough(selection.hasFormat('strikethrough'));
      setIsSubscript(selection.hasFormat('subscript'));
      setIsSuperscript(selection.hasFormat('superscript'));

      const anchorNode = selection.anchor.getNode();
      const element = anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);

      if (elementDOM !== null) {
        if ($isHeadingNode(element)) {
          setBlockType(element.getTag());
        } else {
          setBlockType(element.getType());
        }
      }
    }
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => { updateToolbar(); });
    });
  }, [editor, updateToolbar]);

  const formatHeading = (headingSize: 'h1' | 'h2' | 'h3' | 'h4') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createHeadingNode(headingSize));
    });
  };

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createParagraphNode());
    });
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createQuoteNode());
    });
  };

  function insertLink() { editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'https://'); }

  function clearFormatting() {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.getNodes().forEach((node) => {
          if (node instanceof TextNode) { node.setFormat(0); node.setStyle(''); }
        });
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  }

  const Btn = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      title={title}
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded flex items-center justify-center transition-colors ${active ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="bg-slate-50 border-b border-slate-200 px-2 py-2 flex flex-wrap items-center gap-0.5">
      <Btn title="Undo" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo size={16} /></Btn>
      <Btn title="Redo" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo size={16} /></Btn>
      <div className="w-px h-5 bg-slate-300 mx-1"></div>
      <select
        value={['h1', 'h2', 'h3', 'h4', 'quote', 'paragraph'].includes(blockType) ? blockType : 'paragraph'}
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'paragraph') formatParagraph();
          else if (val === 'quote') formatQuote();
          else formatHeading(val as any);
        }}
        className="text-xs border-slate-200 rounded p-1 mx-1 bg-white outline-none"
      >
        <option value="paragraph">Normal Text</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="quote">Quote</option>
      </select>
      <div className="w-px h-5 bg-slate-300 mx-1"></div>
      <Btn title="Bold" active={isBold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}><Bold size={16} /></Btn>
      <Btn title="Italic" active={isItalic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}><Italic size={16} /></Btn>
      <Btn title="Underline" active={isUnderline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}><Underline size={16} /></Btn>
      <Btn title="Strikethrough" active={isStrikethrough} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}><Strikethrough size={16} /></Btn>
      <Btn title="Superscript" active={isSuperscript} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'superscript')}><Superscript size={16} /></Btn>
      <Btn title="Subscript" active={isSubscript} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'subscript')}><Subscript size={16} /></Btn>
      <Btn title="Clear Formatting" onClick={clearFormatting}><Eraser size={16} /></Btn>
      <div className="w-px h-5 bg-slate-300 mx-1"></div>
      <Btn title="Bulleted List" active={blockType === 'ul'} onClick={() => { blockType !== 'ul' ? editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) : editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined); }}><List size={16} /></Btn>
      <Btn title="Numbered List" active={blockType === 'ol'} onClick={() => { blockType !== 'ol' ? editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) : editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined); }}><ListOrdered size={16} /></Btn>
      <Btn title="Quote" active={blockType === 'quote'} onClick={formatQuote}><Quote size={16} /></Btn>
      <Btn title="Link" onClick={insertLink}><LinkIcon size={16} /></Btn>
      <div className="w-px h-5 bg-slate-300 mx-1"></div>
      <Btn title="Align Left" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')}><AlignLeft size={16} /></Btn>
      <Btn title="Align Center" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')}><AlignCenter size={16} /></Btn>
      <Btn title="Align Right" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')}><AlignRight size={16} /></Btn>
      <div className="w-px h-5 bg-slate-300 mx-1"></div>
      {allowMath && (
        <button type="button" onClick={onOpenMath} title="Insert formula"
          className="text-xs text-slate-700 hover:bg-slate-200 p-1.5 rounded flex items-center justify-center transition-colors border border-transparent">
          <Sigma size={16} />
        </button>
      )}
      {allowChemistry && (
        <button type="button" onClick={onOpenChem} title="Insert chemistry"
          className="text-xs text-slate-700 hover:bg-slate-200 p-1.5 rounded flex items-center justify-center transition-colors border border-transparent">
          <FlaskConical size={16} />
        </button>
      )}
    </div>
  );
};

// ─── EditorInner is defined at MODULE LEVEL (not inside RichContentEditor). ───
// This is the critical fix: defining it inline caused React to treat it as a new
// component type on every render of the parent, triggering remount, destroying
// ContentEditable, losing focus, and resetting the caret on every keystroke.
interface EditorInnerProps {
  disabled: boolean;
  allowMath: boolean;
  allowChemistry: boolean;
  placeholder: string;
  onEditorChange: (editorState: any, editor: LexicalEditor) => void;
  // Ref to content that should be applied to the editor on next applyKey change
  contentToApplyRef: React.MutableRefObject<{ lexicalJson?: any; html?: string } | null>;
  // Incrementing version — when this changes, EditorInner reads contentToApplyRef and applies it
  applyKey: number;
  // Signals "apply complete" so parent can track current html
  onApplied: (html: string) => void;
}

const EditorInner: React.FC<EditorInnerProps> = ({
  disabled,
  allowMath,
  allowChemistry,
  placeholder,
  onEditorChange,
  contentToApplyRef,
  applyKey,
  onApplied,
}) => {
  const [editor] = useLexicalComposerContext();
  const [showMath, setShowMath] = useState(false);
  const [showChem, setShowChem] = useState(false);
  // Prevents re-emitting content to parent when we're applying an external update
  const isApplyingRef = useRef(false);

  // Apply external content whenever applyKey increments (skips on first render with key=0)
  useEffect(() => {
    if (applyKey === 0) return; // 0 = initial; content handled by initialConfig.editorState
    const content = contentToApplyRef.current;
    if (!content) return;

    isApplyingRef.current = true;

    if (content.lexicalJson) {
      try {
        const rawJson = typeof content.lexicalJson === 'string'
          ? JSON.parse(content.lexicalJson)
          : JSON.parse(JSON.stringify(content.lexicalJson));
        // Strip selection to avoid unwanted scroll/focus side-effects
        if (rawJson?.editorState) delete rawJson.editorState.selection;
        if (rawJson?.root) delete rawJson.root.selection;
        delete rawJson.selection;
        const editorState = editor.parseEditorState(rawJson);
        editor.setEditorState(editorState, { tag: 'without-history' });
      } catch (e) {
        console.error("RichContentEditor: failed to apply lexical state", e);
      }
    } else if (content.html) {
      editor.update(() => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(content.html!, 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        root.append(...nodes);
      });
    }

    // Reset flag after Lexical processes the update (its onChange fires synchronously
    // within the update, then listener callbacks fire after commit — use setTimeout 0).
    setTimeout(() => {
      isApplyingRef.current = false;
      onApplied(content.html || '');
    }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyKey]);

  const handleChange = useCallback((editorState: any, ed: LexicalEditor) => {
    if (isApplyingRef.current) return;
    onEditorChange(editorState, ed);
  }, [onEditorChange]);

  const insertFormulaNode = (latex: string) => {
    editor.update(() => { $insertNodes([$createFormulaNode(latex)]); });
    setShowMath(false);
  };

  const insertChemistryNode = (latex: string) => {
    editor.update(() => { $insertNodes([$createChemistryNode(latex)]); });
    setShowChem(false);
  };

  return (
    <>
      {!disabled && (
        <ToolbarPlugin
          allowMath={allowMath}
          allowChemistry={allowChemistry}
          onOpenMath={() => setShowMath(true)}
          onOpenChem={() => setShowChem(true)}
        />
      )}
      <div className="relative p-3 min-h-[150px] cursor-text select-text">
        <RichTextPlugin
          contentEditable={<ContentEditable className="outline-none min-h-[150px]" />}
          placeholder={<div className="absolute top-3 left-3 text-slate-400 pointer-events-none">{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      </div>

      {showMath && (
        <FormulaEditorModal onSave={insertFormulaNode} onClose={() => setShowMath(false)} />
      )}
      {showChem && (
        <ChemistryFormulaModal onSave={insertChemistryNode} onClose={() => setShowChem(false)} />
      )}
    </>
  );
};

// ─── Main exported component ────────────────────────────────────────────────
export const RichContentEditor: React.FC<RichContentEditorProps> = ({
  value,
  onChange,
  placeholder = "Write content here...",
  mode = "full",
  allowMath = true,
  allowChemistry = true,
  disabled = false
}) => {
  // Stable ref to latest onChange — avoids stale closures without needing useCallback deps
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Track what HTML is currently in the editor (set by apply or by typing)
  const currentHtmlRef = useRef<string>('');
  // Track what we last serialized+emitted to parent (to break echo loops)
  const lastEmittedRef = useRef<string | null>(null);

  // When applyKey > 0, EditorInner reads this ref and applies the content
  const contentToApplyRef = useRef<{ lexicalJson?: any; html?: string } | null>(null);
  const [applyKey, setApplyKey] = useState(0);

  // Compute initial model once (not reactive — only for LexicalComposer initialConfig)
  const initialModelRef = useRef(migrateToRichContent(value));

  // Detect external value changes that warrant re-importing content into the editor
  useEffect(() => {
    const newVal = migrateToRichContent(value);
    // Skip if the HTML hasn't changed from what the editor currently has
    if (newVal.html === currentHtmlRef.current) return;
    // Skip if this is echoing back content we just emitted
    const str = JSON.stringify({ html: newVal.html });
    if (str === lastEmittedRef.current) return;

    contentToApplyRef.current = { lexicalJson: newVal.lexicalJson, html: newVal.html };
    setApplyKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Stable change handler: emits to parent, updates current html tracking
  const handleEditorChange = useCallback((editorState: any, editor: LexicalEditor) => {
    editor.read(() => {
      const htmlStr = $generateHtmlFromNodes(editor, null);
      const cleanHtml = richContentSanitizer(htmlStr);
      currentHtmlRef.current = cleanHtml;

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
        onChangeRef.current(newContent);
      }
    });
  }, []);

  const handleApplied = useCallback((html: string) => {
    currentHtmlRef.current = html;
  }, []);

  // editorState initializer: sets content from the initial value on first mount
  const getInitialEditorState = useCallback((editor: LexicalEditor) => {
    const model = initialModelRef.current;
    currentHtmlRef.current = model.html || '';

    if (model.lexicalJson) {
      try {
        const rawJson = typeof model.lexicalJson === 'string'
          ? JSON.parse(model.lexicalJson as string)
          : JSON.parse(JSON.stringify(model.lexicalJson));
        if (rawJson?.editorState) delete rawJson.editorState.selection;
        if (rawJson?.root) delete rawJson.root.selection;
        delete rawJson.selection;
        return editor.parseEditorState(rawJson);
      } catch (e) {
        console.error("RichContentEditor: failed to parse initial lexical state", e);
      }
    }

    if (model.html) {
      editor.update(() => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(model.html, 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        if (nodes.length > 0) root.append(...nodes);
      });
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — runs once on mount

  const initialConfig = {
    namespace: 'VeritasEditor',
    theme: {
      paragraph: 'mb-2 leading-relaxed',
      heading: {
        h1: 'text-2xl font-bold mb-3 mt-4 text-slate-800',
        h2: 'text-xl font-bold mb-3 mt-4 text-slate-800',
        h3: 'text-lg font-bold mb-2 mt-3 text-slate-800',
        h4: 'text-base font-bold mb-2 mt-2 text-slate-800',
      },
      list: {
        ul: 'list-disc ml-5 mb-2 leading-relaxed',
        ol: 'list-decimal ml-5 mb-2 leading-relaxed',
      },
      quote: 'border-l-4 border-slate-300 pl-4 py-1 italic text-slate-600 my-2',
      link: 'text-blue-600 underline cursor-pointer hover:text-blue-800',
      text: {
        bold: 'font-bold',
        italic: 'italic',
        underline: 'underline',
        strikethrough: 'line-through',
        subscript: 'align-sub text-xs',
        superscript: 'align-super text-xs',
      }
    },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, AutoLinkNode, LinkNode, FormulaNode, ChemistryNode],
    onError: (error: Error) => { console.error(error); },
    editable: !disabled,
    editorState: getInitialEditorState,
  };

  return (
    <div className={`relative border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm select-text ${disabled ? 'opacity-70 bg-slate-50' : ''}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorInner
          disabled={disabled}
          allowMath={allowMath}
          allowChemistry={allowChemistry}
          placeholder={placeholder}
          onEditorChange={handleEditorChange}
          contentToApplyRef={contentToApplyRef}
          applyKey={applyKey}
          onApplied={handleApplied}
        />
      </LexicalComposer>
    </div>
  );
};

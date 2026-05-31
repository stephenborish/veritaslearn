import React, { useState, useEffect, useCallback } from "react";
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
          const type = element.getType();
          setBlockType(type);
        }
      }
    }
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        updateToolbar();
      });
    });
  }, [editor, updateToolbar]);

  const formatHeading = (headingSize: 'h1' | 'h2' | 'h3' | 'h4') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(headingSize));
      }
    });
  };

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
  };

  function insertLink() {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'https://');
  }

  function clearFormatting() {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const nodes = selection.getNodes();
        nodes.forEach((node) => {
          if (node instanceof TextNode) {
            node.setFormat(0);
            node.setStyle('');
          }
        });
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  }

  const Btn = ({ active, onClick, children, title }: { active?: boolean, onClick: () => void, children: React.ReactNode, title: string }) => (
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
      
      <Btn title="Bulleted List" active={blockType === 'ul'} onClick={() => { blockType !== 'ul' ? editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) : editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined) }}><List size={16} /></Btn>
      <Btn title="Numbered List" active={blockType === 'ol'} onClick={() => { blockType !== 'ol' ? editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) : editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined) }}><ListOrdered size={16} /></Btn>
      <Btn title="Quote" active={blockType === 'quote'} onClick={formatQuote}><Quote size={16} /></Btn>
      <Btn title="Link" onClick={insertLink}><LinkIcon size={16} /></Btn>

      <div className="w-px h-5 bg-slate-300 mx-1"></div>
      
      <Btn title="Align Left" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')}><AlignLeft size={16} /></Btn>
      <Btn title="Align Center" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')}><AlignCenter size={16} /></Btn>
      <Btn title="Align Right" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')}><AlignRight size={16} /></Btn>
      
      <div className="w-px h-5 bg-slate-300 mx-1"></div>

      {allowMath && (
        <button 
          type="button"
          onClick={onOpenMath}
          title="Insert formula"
          className="text-xs text-slate-700 hover:bg-slate-200 p-1.5 rounded flex items-center justify-center transition-colors border border-transparent"
        >
          <Sigma size={16} />
        </button>
      )}
      {allowChemistry && (
        <button
          type="button"
          onClick={onOpenChem}
          title="Insert chemistry"
          className="text-xs text-slate-700 hover:bg-slate-200 p-1.5 rounded flex items-center justify-center transition-colors border border-transparent"
        >
          <FlaskConical size={16} />
        </button>
      )}
    </div>
  );
};

export const RichContentEditor: React.FC<RichContentEditorProps> = ({
  value,
  onChange,
  placeholder = "Write content here...",
  mode = "full",
  allowMath = true,
  allowChemistry = true,
  disabled = false
}) => {
  const lastEmittedRef = React.useRef<string | null>(null);
  const lastImportedRef = React.useRef<string | null>(null);
  const isApplyingExternalValueRef = React.useRef<boolean>(true); // true initially for mount

  const [internalModel, setInternalModel] = useState<RichContent>(() => {
    const initial = migrateToRichContent(value);
    lastImportedRef.current = JSON.stringify(initial);
    return initial;
  });
  const [showMath, setShowMath] = useState(false);
  const [showChem, setShowChem] = useState(false);

  useEffect(() => {
    const newVal = migrateToRichContent(value);
    const parentValStr = JSON.stringify(newVal);
    
    // Only apply if it's genuinely different from what we last emitted and what we last imported
    if (parentValStr !== lastEmittedRef.current && parentValStr !== lastImportedRef.current) {
      isApplyingExternalValueRef.current = true;
      lastImportedRef.current = parentValStr;
      setInternalModel(newVal);
    }
  }, [value]);

  // Parse initial state safely
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
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      AutoLinkNode,
      LinkNode,
      FormulaNode,
      ChemistryNode
    ],
    onError: (error: Error) => {
      console.error(error);
    },
    editable: !disabled,
  };

  const handleLexicalChange = (editorState: any, editor: LexicalEditor) => {
    // If it's an external update flowing into editor, do not re-emit
    if (isApplyingExternalValueRef.current) return;

    editor.read(() => {
      // Serialize to HTML using @lexical/html
      const htmlStr = $generateHtmlFromNodes(editor, null);
      const cleanHtml = richContentSanitizer(htmlStr);
      
      const newContent: RichContent = {
        ...internalModel,
        html: cleanHtml,
        lexicalJson: editorState.toJSON(),
        updatedAt: new Date().toISOString()
      };
      
      const newContentStr = JSON.stringify(newContent);
      if (newContentStr !== lastEmittedRef.current) {
        lastEmittedRef.current = newContentStr;
        setInternalModel(newContent);
        onChange(newContent);
      }
    });
  };

  const EditorInterface = () => {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
      if (isApplyingExternalValueRef.current) {
        if (internalModel.lexicalJson && editor) {
          try {
            // Remove selection before parsing so it doesn't force focus/scroll
            const rawJson = typeof internalModel.lexicalJson === 'string' ? JSON.parse(internalModel.lexicalJson) : JSON.parse(JSON.stringify(internalModel.lexicalJson));
            if (rawJson && typeof rawJson === 'object') {
                if (rawJson.editorState && typeof rawJson.editorState === 'object') {
                    delete rawJson.editorState.selection;
                    if (rawJson.editorState.root) {
                        delete rawJson.editorState.root.selection;
                    }
                }
                delete rawJson.selection;
                if (rawJson.root) {
                    delete rawJson.root.selection;
                }
            }

            const editorState = editor.parseEditorState(rawJson);
            // using "tag" to prevent scroll? or just set EditorState
            editor.setEditorState(editorState, { tag: 'without-history' });
          } catch(e) {
             console.error("Failed to parse lexical json during external update", e); 
          }
        } else if (internalModel.html && !internalModel.lexicalJson && editor) {
          // Fallback for HTML content
          editor.update(() => {
            const parser = new DOMParser();
            const dom = parser.parseFromString(internalModel.html, 'text/html');
            const nodes = $generateNodesFromDOM(editor, dom);
            const root = $getRoot();
            root.clear();
            root.append(...nodes);
          });
        }
        
        // Use a timeout to ensure any immediate lexical normalizations don't loop back to handleLexicalChange yet
        setTimeout(() => {
          isApplyingExternalValueRef.current = false;
        }, 10);
      }
    }, [internalModel, editor]);

    const insertFormulaNode = (latex: string) => {
      editor.update(() => {
        const node = $createFormulaNode(latex);
        $insertNodes([node]);
      });
      setShowMath(false);
    };

    const insertChemistryNode = (latex: string) => {
      editor.update(() => {
        const node = $createChemistryNode(latex);
        $insertNodes([node]);
      });
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
        <div className="relative p-3 min-h-[150px] cursor-text">
          <RichTextPlugin
            contentEditable={<ContentEditable className="outline-none min-h-[150px]" />}
            placeholder={<div className="absolute top-3 left-3 text-slate-400 pointer-events-none">{placeholder}</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <OnChangePlugin onChange={handleLexicalChange} ignoreSelectionChange />
        </div>

        {showMath && (
          <FormulaEditorModal 
            onSave={(latex) => insertFormulaNode(latex)}
            onClose={() => setShowMath(false)}
          />
        )}
        {showChem && (
          <ChemistryFormulaModal
            onSave={(latex) => insertChemistryNode(latex)}
            onClose={() => setShowChem(false)}
          />
        )}
      </>
    );
  };

  return (
    <div className={`relative border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm ${disabled ? 'opacity-70 bg-slate-50' : ''}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <EditorInterface />
      </LexicalComposer>
    </div>
  );
};

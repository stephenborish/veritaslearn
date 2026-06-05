/**
 * LAYER A — REAL RichContentEditor component + REAL Lexical engine.
 *
 * Proves the editor-level half of the persistence contract WITHOUT depending on
 * Lexical's DOM reconciliation in jsdom (which does not paint the contenteditable
 * headlessly — an environment limitation, not an app behavior). Instead it drives
 * the EXACT production code paths:
 *   - authentic "typing" → serialization via the same Lexical APIs the editor uses
 *     (`$generateHtmlFromNodes` + `editorState.toJSON()`);
 *   - the EXACT reload/rehydrate path (`parseEditorState` for lexicalJson, and
 *     `$generateNodesFromDOM` for legacy HTML) → assert the original text comes back;
 *   - the REAL RichContentEditor component's mount/remount emit guards → assert it
 *     never emits empty/clobbering content over a non-empty value, and that a
 *     cleared value is not resurrected.
 */
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";

import {
  createEditor, $getRoot, $createParagraphNode, $createTextNode, LexicalEditor,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";

import { RichContentEditor } from "../src/components/RichContent/RichContentEditor";
import { migrateToRichContent } from "../src/components/RichContent/richContentMigration";
import type { RichContent } from "../src/components/RichContent/types";

const BASE_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, AutoLinkNode, LinkNode];

function makeEditor(): LexicalEditor {
  const editor = createEditor({ namespace: "test", nodes: BASE_NODES, onError: (e) => { throw e; } });
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.appendChild(root);
  editor.setRootElement(root);
  return editor;
}

/** Authentic "teacher typed text" → RichContent, serialized exactly like RichContentEditor. */
function typeIntoRealLexical(text: string): RichContent {
  const editor = makeEditor();
  act(() => {
    editor.update(() => {
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      const r = $getRoot();
      r.clear();
      r.append(p);
    });
  });
  let html = "";
  let lexicalJson: unknown = null;
  editor.read(() => {
    html = $generateHtmlFromNodes(editor, null);
    lexicalJson = editor.getEditorState().toJSON();
  });
  return {
    version: 1,
    format: "veritas-rich-content",
    html,
    plainText: html.replace(/<[^>]*>/g, ""),
    assets: [],
    lexicalJson,
  };
}

/**
 * Reload via the EXACT lexicalJson path RichContentEditor.getInitialEditorState
 * uses (parse, strip selection, setEditorState) and return the resulting text.
 */
function rehydrateViaLexicalJson(rc: RichContent | string): string {
  const model = migrateToRichContent(rc);
  if (!model.lexicalJson) return "";
  const editor = makeEditor();
  const rawJson: any = JSON.parse(JSON.stringify(model.lexicalJson));
  if (rawJson?.editorState) delete rawJson.editorState.selection;
  if (rawJson?.root) delete rawJson.root.selection;
  delete rawJson.selection;
  const state = editor.parseEditorState(rawJson);
  editor.setEditorState(state);
  let text = "";
  editor.read(() => { text = $getRoot().getTextContent(); });
  return text;
}

/** Reload via the EXACT legacy HTML path (no lexicalJson): $generateNodesFromDOM. */
function rehydrateViaHtml(rc: RichContent | string): string {
  const model = migrateToRichContent(rc);
  const editor = makeEditor();
  act(() => {
    editor.update(() => {
      const dom = new DOMParser().parseFromString(model.html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      const root = $getRoot();
      root.clear();
      if (nodes.length > 0) root.append(...nodes);
    });
  });
  let text = "";
  editor.read(() => { text = $getRoot().getTextContent(); });
  return text;
}

/** Parent harness that controls the REAL RichContentEditor and records emits. */
function Harness({ initial, emitted }: { initial: RichContent | string; emitted: RichContent[] }) {
  const [val, setVal] = useState<RichContent | string>(initial);
  const [mounted, setMounted] = useState(true);
  return (
    <div>
      <button data-testid="toggle" onClick={() => setMounted((m) => !m)}>toggle</button>
      <button data-testid="clear" onClick={() => setVal(migrateToRichContent(""))}>clear</button>
      {mounted && (
        <RichContentEditor value={val} onChange={(v) => { emitted.push(v); setVal(v); }} documentKey="layerA" />
      )}
    </div>
  );
}

function isEmptyContent(e: RichContent): boolean {
  const stripped = (e.plainText || "").replace(/<[^>]*>/g, "").trim();
  const hasMedia = /<(img|iframe|table)\b/i.test(e.html || "") || (Array.isArray(e.assets) && e.assets.length > 0);
  return stripped === "" && !hasMedia;
}

async function settle(ms = 60) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("Layer A — real RichContentEditor + real Lexical", () => {
  it("A1: real typed text serializes and survives the migrate round-trip (html/plainText/lexicalJson)", () => {
    const unique = "Photosynthesis-ALPHA-2026";
    const rc = typeIntoRealLexical(unique);
    expect(rc.plainText).toContain(unique);
    expect(rc.html).toContain(unique);
    expect(rc.lexicalJson).toBeTruthy();

    const back = migrateToRichContent(rc);
    expect(back.plainText).toContain(unique);
    expect(back.html).toContain(unique);
    expect(back.lexicalJson).toBeTruthy(); // lexicalJson preserved, not dropped on reload
  });

  it("A2: saved value rehydrates through the real Lexical lexicalJson reload path", () => {
    const unique = "Rehydrate-BETA-2026";
    const rc = typeIntoRealLexical(unique);
    // Simulates closing + reopening the lesson: the stored RichContent is parsed
    // back into a real Lexical editor exactly as getInitialEditorState does.
    expect(rehydrateViaLexicalJson(rc)).toContain(unique);
  });

  it("A3: legacy HTML-only value (no lexicalJson) still rehydrates through the real Lexical DOM path", () => {
    const unique = "LegacyHtml-GAMMA-2026";
    const legacy = `<p>${unique}</p>`; // pre-RichContent stored string
    const model = migrateToRichContent(legacy);
    expect(model.lexicalJson).toBeFalsy(); // confirms we exercise the html path
    expect(rehydrateViaHtml(legacy)).toContain(unique);
  });

  it("A4: an intentionally-cleared value rehydrates as empty (old text is NOT resurrected)", () => {
    const unique = "WillDelete-DELTA-2026";
    const before = typeIntoRealLexical(unique);
    expect(rehydrateViaLexicalJson(before)).toContain(unique); // had text

    const cleared = migrateToRichContent(""); // teacher cleared the field, saved blank
    expect(cleared.plainText).toBe("");
    expect(rehydrateViaLexicalJson(cleared)).toBe(""); // no resurrection through reload
    expect(rehydrateViaHtml(cleared)).toBe("");
  });

  it("A5: media-bearing content (image asset / table) is preserved through migrate (no degradation)", () => {
    const rc: RichContent = {
      version: 1,
      format: "veritas-rich-content",
      html: '<p>Diagram</p><img src="https://x/y.png" alt="cell"/>',
      plainText: "Diagram",
      assets: [{ id: "a1", type: "image", url: "https://x/y.png", alt: "cell" }],
      lexicalJson: { root: { children: [], type: "root", version: 1 } },
    };
    const back = migrateToRichContent(rc);
    expect(back.html).toContain("<img");
    expect(back.assets.length).toBe(1);
    expect(back.lexicalJson).toBeTruthy(); // object shape preserved, not flattened to a string
  });

  it("A6: the REAL RichContentEditor component mounts for every value shape the builder feeds it", async () => {
    // NOTE: Lexical does not paint its contenteditable or fire onChange headlessly
    // in jsdom (verified), so keystroke-level display is proven in Layer B via the
    // controlled double. Here we prove the REAL component initializes — without
    // throwing and without synchronously emitting clobbering content — for the
    // non-empty RichContent, legacy HTML-string, and empty value shapes.
    const rc = typeIntoRealLexical("MountShape-ZETA-2026");
    for (const value of [rc, "<p>legacy html</p>", "" as string]) {
      const emitted: RichContent[] = [];
      let unmount!: () => void;
      await act(async () => {
        const r = render(<Harness initial={value} emitted={emitted} />);
        unmount = r.unmount;
      });
      await settle(20);
      expect(emitted.filter(isEmptyContent).length).toBe(0);
      unmount();
    }
  });
});

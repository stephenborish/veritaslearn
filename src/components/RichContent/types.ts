import type React from "react";
import { Timestamp } from "firebase/firestore";

export type RichContentAsset = {
  id: string;
  type: "image" | "formula" | "chemistry" | "embed" | "file" | "videoRef";
  storagePath?: string;
  url?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  alignment?: "left" | "center" | "right" | "full";
  formulaSource?: string;
  formulaDisplay?: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  referencedVideoId?: string;
};

export type RichContent = {
  version: number;
  format: "veritas-rich-content";
  lexicalJson?: unknown;
  html: string;
  plainText: string;
  assets: RichContentAsset[];
  createdAt?: Timestamp | string; // allowing string for local demo/sandbox state
  updatedAt?: Timestamp | string;
};

export type RichContentEditorProps = {
  value: RichContent | string | null;
  onChange: (value: RichContent) => void;
  placeholder?: string;
  mode?: "full" | "compact" | "inline";
  allowImages?: boolean;
  allowTables?: boolean;
  allowMath?: boolean;
  allowChemistry?: boolean;
  disabled?: boolean;
  documentKey?: string;
  /** When true, uses a smaller min-height (suitable for compact answer choices). */
  compactHeight?: boolean;
  /**
   * Optional explicit flush/commit hook. The editor populates `flushRef.current`
   * with a function that synchronously re-emits the editor's current content via
   * `onChange`. Parent components MAY call it before a workspace switch / save /
   * navigation to force a final commit. It is a safety net: the editor already
   * emits onChange synchronously on every keystroke, so the live-state contract
   * does not depend on it.
   */
  flushRef?: React.MutableRefObject<(() => void) | null>;
};

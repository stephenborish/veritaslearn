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
};

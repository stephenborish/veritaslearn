import React, { useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import "mathlive"; // Registers math-field custom element for read-only formula rendering
import { RichContent } from "./types";
import { richContentSanitizer } from "./richContentSanitizer";
import { getRenderableHtml } from "./richContentMigration";

interface ZoomState {
  src: string;
  alt: string;
}

export const RichContentRenderer: React.FC<{
  content: string | RichContent | null | undefined;
  className?: string;
  variant?: "default" | "student-reading";
}> = ({ content, className = "", variant = "default" }) => {
  const rawHtml = getRenderableHtml(content);
  const cleanHtml = richContentSanitizer(rawHtml);
  const [zoom, setZoom] = useState<ZoomState | null>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      setZoom({ src: img.src, alt: img.alt || "" });
    }
  }, []);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);

  return (
    <>
      <div
        className={`${
          variant === "student-reading"
            ? "prose prose-lg max-w-none student-reading-content select-text"
            : "prose prose-sm max-w-none"
        } [&_img]:cursor-zoom-in ${className}`}
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
        onClick={handleClick}
      />
      {zoom && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image zoom"
        >
          <button
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white text-slate-800 flex items-center justify-center hover:bg-slate-100 transition shadow-md focus-visible:ring-2 focus-visible:ring-indigo-400 outline-none cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setZoom(null); }}
            aria-label="Close image zoom"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={zoom.src}
            alt={zoom.alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};

export function getPlainText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object" && content !== null) {
    if (typeof content.plainText === "string") return content.plainText;
    if (typeof content.html === "string") {
      return content.html.replace(/<[^>]*>/g, "").trim();
    }
  }
  return String(content);
}

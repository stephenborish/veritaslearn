import React from "react";
import { RichContent } from "./types";
import { richContentSanitizer } from "./richContentSanitizer";
import { getRenderableHtml } from "./richContentMigration";

export const RichContentRenderer: React.FC<{ content: string | RichContent | null | undefined, className?: string }> = ({ content, className = "" }) => {
  const rawHtml = getRenderableHtml(content);
  const cleanHtml = richContentSanitizer(rawHtml);

  return (
    <div 
      className={`prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: cleanHtml }}
    />
  );
};

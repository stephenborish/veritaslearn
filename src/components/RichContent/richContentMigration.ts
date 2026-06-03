import { RichContent } from "./types";
import { richContentSanitizer } from "./richContentSanitizer";

export const applyLegacyMarkdownConversion = (text: string): string => {
  const lines = text.split('\n');
  let html = '';
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    if (line.trim() === '') {
      html += '<p><br></p>';
      continue;
    }
    
    // Convert *italic*
    line = line.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    if (line.startsWith('### ')) {
      html += `<h3>${line.substring(4)}</h3>`;
    } else if (line.startsWith('## ')) {
      html += `<h2>${line.substring(3)}</h2>`;
    } else if (line.startsWith('# ')) {
      html += `<h1>${line.substring(2)}</h1>`;
    } else if (line.startsWith('> ')) {
      html += `<blockquote>${line.substring(2)}</blockquote>`;
    } else {
      html += `<p>${line}</p>`;
    }
  }
  
  return html;
};

export const migrateToRichContent = (existingText: string | RichContent | null | undefined): RichContent => {
  if (!existingText) {
    return {
      version: 1,
      format: "veritas-rich-content",
      html: "",
      plainText: "",
      assets: []
    };
  }

  // Handle JSON string input
  if (typeof existingText === "string") {
    const trimmed = existingText.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return migrateToRichContent(parsed);
        }
      } catch (e) {
        // Fall back to plain string handling
      }
    }
  }

  // If it's already a RichContent object or any object (avoid converting with String() to "[object Object]")
  if (typeof existingText === "object") {
    const obj = existingText as any;
    return {
      version: obj.version || 1,
      format: "veritas-rich-content",
      html: obj.html || "",
      plainText: obj.plainText || (obj.html ? obj.html.replace(/<[^>]*>/g, '') : ""),
      assets: Array.isArray(obj.assets) ? obj.assets : [],
      lexicalJson: obj.lexicalJson || null,
      updatedAt: obj.updatedAt || new Date().toISOString()
    };
  }

  const asString = String(existingText);

  // If the string is already HTML (starts with '<'), use it directly.
  // Running applyLegacyMarkdownConversion on HTML would double-wrap every block element
  // in a <p> tag, creating invalid nested <p> elements that break the editor.
  if (asString.trim().startsWith('<')) {
    return {
      version: 1,
      format: "veritas-rich-content",
      html: asString,
      plainText: asString.replace(/<[^>]*>/g, ''),
      assets: []
    };
  }

  // Otherwise, it's plain text or legacy markdown — convert it
  const textHtml = applyLegacyMarkdownConversion(asString);
  return {
    version: 1,
    format: "veritas-rich-content",
    html: textHtml,
    plainText: asString,
    assets: []
  };
};

export const getRenderableHtml = (content: string | RichContent | null | undefined): string => {
  if (!content) return "";
  if (typeof content === "object" && content.format === "veritas-rich-content") {
    return content.html;
  }
  return applyLegacyMarkdownConversion(String(content));
};

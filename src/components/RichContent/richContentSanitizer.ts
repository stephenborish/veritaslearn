import DOMPurify from "dompurify";

export const richContentSanitizer = (html: string): string => {
  if (typeof window === "undefined") {
    // Basic fallback for SSR or node environments if DOMPurify requires window
    return html;
  }
  
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "b", "i", "em", "strong", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "span", "br",
      "table", "tbody", "thead", "tr", "td", "th",
      "blockquote", "hr", "sup", "sub", "u", "s", "strike",
      "img",
      // Our custom components/math:
      "math-field", "math", "mi", "mo", "mn", "ms", "mspace", "mtext", "menclose",
      "merror", "mfenced", "mfrac", "mpadded", "mphantom", "mroot",
      "mrow", "msqrt", "mstyle", "mmultiscripts", "mover", "munderover",
      "munder", "maligngroup", "malignmark", "mtable", "mtd", "mtr",
      "mlongdiv", "mscarries", "mscarry", "msgroup", "msline",
      "msrow", "semantics", "annotation", "annotation-xml",
      // If we use placeholders for custom assets
      "veritas-asset"
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "title", "alt", "src",
      "class", "style", "id", "readonly",
      // custom asset attrs
      "data-asset-id", "data-type", "data-formula"
    ],
    ALLOW_DATA_ATTR: true,
  });
};

// Image Formatting, Sizing, and Alignment Verification inside a Lexical context
import assert from "assert";
import { createEditor } from "lexical";
import { ImageNode, $createImageNode } from "../src/components/RichContent/ImageNode.js";
import { getRenderableHtml, migrateToRichContent } from "../src/components/RichContent/richContentMigration.js";
import { richContentSanitizer } from "../src/components/RichContent/richContentSanitizer.js";

interface MockElement {
  tagName: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  children: MockElement[];
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | undefined;
  appendChild(child: MockElement): void;
  querySelector(selector: string): MockElement | null;
  get outerHTML(): string;
}

class MockElementImpl implements MockElement {
  tagName: string;
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: MockElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "style") {
      const parts = value.split(";");
      for (const p of parts) {
        if (!p.trim()) continue;
        const [k, v] = p.split(":");
        if (k && v) {
          this.style[k.trim()] = v.trim();
        }
      }
    }
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }

  appendChild(child: MockElement): void {
    this.children.push(child);
  }

  querySelector(selector: string): MockElement | null {
    if (selector === "img") {
      for (const c of this.children) {
        if (c.tagName.toLowerCase() === "img") {
          return c;
        }
      }
    }
    return null;
  }

  get outerHTML(): string {
    const attrStr = Object.entries(this.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const start = `<${this.tagName} ${attrStr}>`;
    const mid = this.children.map((c) => c.outerHTML).join("");
    const end = `</${this.tagName}>`;
    return `${start}${mid}${end}`;
  }
}

// Setup a global mock of document.createElement since Lexical DOM export executes server-side/during tests too
if (typeof global !== "undefined" && typeof (global as any).document === "undefined") {
  (global as any).document = {
    createElement(tagName: string) {
      return new MockElementImpl(tagName);
    },
  };
}

function runTests() {
  console.log("\n========================================================");
  console.log("👉 VERITAS LEARN IMAGE FORMATTING SEED & VALIDATION SUITE");
  console.log("========================================================\n");

  const editor = createEditor({
    nodes: [ImageNode],
  });

  // Execute all Lexical node operations within an update helper context
  editor.update(() => {
    // 1. Sizing and Sizing Initialization
    console.log("Step 1: Instantiating ImageNode and checking initial properties...");
    const node = $createImageNode("https://example.com/asset.png", "A nice landscape", 320, 240, "right");
    assert.strictEqual(node.getSrc(), "https://example.com/asset.png");
    assert.strictEqual(node.getAlt(), "A nice landscape");
    assert.strictEqual(node.getWidth(), 320);
    assert.strictEqual(node.getHeight(), 240);
    assert.strictEqual(node.getAlignment(), "right");
    console.log("  [PASS] Custom settings initialized successfully on ImageNode");

    // 2. Modifying Properties
    console.log("\nStep 2: Testing property modifiers (setters) on ImageNode...");
    node.setWidth(450);
    node.setAlignment("left");
    node.setAlt("Updated accessible description");
    assert.strictEqual(node.getWidth(), 450);
    assert.strictEqual(node.getAlignment(), "left");
    assert.strictEqual(node.getAlt(), "Updated accessible description");
    console.log("  [PASS] ImageNode alignment, width, and alt-text successfully mutated");

    // 3. Sizing Sinks (Default Center)
    console.log("\nStep 3: Checking default center fallback for legacy images...");
    const legacyNode = $createImageNode("https://example.com/legacy.png", "Untagged old file");
    assert.strictEqual(legacyNode.getAlignment(), "center", "Default alignment must fallback to center");
    console.log("  [PASS] Non-aligned legacy content auto-assigned center layout alignment");

    // 4. Persistence Sieve (JSON serialization round-trip)
    console.log("\nStep 4: Checking JSON serialization & deserialization stability...");
    const serialized = node.exportJSON();
    assert.strictEqual(serialized.src, "https://example.com/asset.png");
    assert.strictEqual(serialized.alt, "Updated accessible description");
    assert.strictEqual(serialized.width, 450);
    assert.strictEqual(serialized.alignment, "left");

    const deserializedNode = ImageNode.importJSON(serialized);
    assert.strictEqual(deserializedNode.getSrc(), "https://example.com/asset.png");
    assert.strictEqual(deserializedNode.getAlt(), "Updated accessible description");
    assert.strictEqual(deserializedNode.getWidth(), 450);
    assert.strictEqual(deserializedNode.getAlignment(), "left");
    console.log("  [PASS] Serialization and dynamic deserialization survives serialization perfectly");

    // 5. HTML Export validation (compliant alignment wrapper & class mappings)
    console.log("\nStep 5: Inspecting exportDOM HTML structure...");
    const docExport = deserializedNode.exportDOM();
    const wrapper = docExport.element;
    assert.strictEqual(wrapper.tagName.toLowerCase(), "p");
    assert.match(wrapper.getAttribute("style") || "", /text-align:\s*left/);
    assert.match(wrapper.getAttribute("class") || "", /text-left/);

    const innerImgNode = wrapper.querySelector("img");
    assert.ok(innerImgNode);
    assert.strictEqual(innerImgNode.getAttribute("src"), "https://example.com/asset.png");
    assert.strictEqual(innerImgNode.getAttribute("alt"), "Updated accessible description");
    assert.match(innerImgNode.getAttribute("style") || "", /width:\s*450px/);
    console.log("  [PASS] exportDOM wraps image in standard paragraph tag with inline alignment styled");

    // 6. Direct DOMPurify Sanitization check
    console.log("\nStep 6: Confirming custom CSS styling and wrapper paragraph survive content sanitizer...");
    // Since wrapper is our custom MockElement, wrap and clean its outerHTML representation
    const rawHtmlInput = wrapper.outerHTML;
    const sanitizedOutput = richContentSanitizer(rawHtmlInput);
    
    assert.match(sanitizedOutput, /text-align:\s*left/);
    assert.match(sanitizedOutput, /width:\s*450px/);
    assert.match(sanitizedOutput, /max-width:\s*100%/);
    assert.match(sanitizedOutput, /image-alignment-wrapper/);
    console.log("  [PASS] Inline styles, sizes, and layout classes successfully pass through the sandbox sanitizer");

    // 7. Backward compatibility check
    console.log("\nStep 7: Validating old image nodes (without explicit width and alignment)...");
    const oldRawHtml = `<p>Intro text</p><img src="https://example.com/untouched.png" alt="flat"><p>Concluding paragraph</p>`;
    const sanitizedOldRawHtml = richContentSanitizer(oldRawHtml);
    assert.match(sanitizedOldRawHtml, /<img src="https:\/\/example\.com\/untouched\.png" alt="flat">/);
    console.log("  [PASS] Unstructured old raw image layouts render properly and remain totally uncorrupted");
  });

  console.log("\n========================================================");
  console.log("🏆 SUCCESS: All 7 key image formatting criteria fully validated!");
  console.log("========================================================\n");
}

runTests();

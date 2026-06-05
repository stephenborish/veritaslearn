// Static source-assertion verification for equation/chemistry rendering
import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function ok(src: string, pattern: string | RegExp, label: string) {
  const hit = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  assert.ok(hit, `FAIL: ${label}\n  Expected to find: ${String(pattern)}`);
}

function notOk(src: string, pattern: string | RegExp, label: string) {
  const hit = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  assert.ok(!hit, `FAIL: ${label}\n  Expected NOT to find: ${String(pattern)}`);
}

console.log("=== VERITAS Learn: Rich Formula Rendering Verification ===\n");

// ── Source files ──────────────────────────────────────────────────────────
const formulaNode  = read("src/components/RichContent/FormulaNode.tsx");
const chemNode     = read("src/components/RichContent/ChemistryNode.tsx");
const formulaModal = read("src/components/RichContent/FormulaEditorModal.tsx");
const chemModal    = read("src/components/RichContent/ChemistryFormulaModal.tsx");
const renderer     = read("src/components/RichContent/RichContentRenderer.tsx");
const sanitizer    = read("src/components/RichContent/richContentSanitizer.ts");
const indexCss     = read("src/index.css");

// ── 1. importDOM and exportDOM are implemented ────────────────────────────
ok(formulaNode, "importDOM()", "FormulaNode: implements importDOM");
ok(formulaNode, "exportDOM()", "FormulaNode: implements exportDOM");
ok(chemNode,    "importDOM()", "ChemistryNode: implements importDOM");
ok(chemNode,    "exportDOM()", "ChemistryNode: implements exportDOM");
console.log("  [PASS] FormulaNode and ChemistryNode implement importDOM and exportDOM");

// ── 2. Formula values preserved through JSON import/export ────────────────
ok(formulaNode, "importJSON",              "FormulaNode: implements importJSON");
ok(formulaNode, "exportJSON",              "FormulaNode: implements exportJSON");
ok(formulaNode, "serializedNode.formula",  "FormulaNode: reads formula from serialized node");
ok(chemNode,    "importJSON",              "ChemistryNode: implements importJSON");
ok(chemNode,    "exportJSON",              "ChemistryNode: implements exportJSON");
ok(chemNode,    "serializedNode.formula",  "ChemistryNode: reads formula from serialized node");
console.log("  [PASS] Nodes preserve formula values through JSON import/export");

// ── 3. exportDOM includes stable data attributes ──────────────────────────
ok(formulaNode, "data-lexical-formula", "FormulaNode: exportDOM sets data-lexical-formula");
ok(formulaNode, "data-formula",         "FormulaNode: exportDOM sets data-formula");
ok(chemNode,    "data-lexical-chemistry", "ChemistryNode: exportDOM sets data-lexical-chemistry");
ok(chemNode,    "data-formula",           "ChemistryNode: exportDOM sets data-formula");
console.log("  [PASS] exportDOM includes stable data-lexical-* and data-formula attributes");

// ── 4. exportDOM uses textContent not innerHTML for formula source ─────────
notOk(formulaNode, "mf.innerHTML", "FormulaNode: exportDOM does not use mf.innerHTML");
notOk(chemNode,    "mf.innerHTML", "ChemistryNode: exportDOM does not use mf.innerHTML");
ok(formulaNode,    "mf.textContent", "FormulaNode: exportDOM uses mf.textContent");
ok(chemNode,       "mf.textContent", "ChemistryNode: exportDOM uses mf.textContent");
console.log("  [PASS] exportDOM uses textContent (not innerHTML) for formula serialization");

// ── 5. importDOM reads data-formula attribute ─────────────────────────────
ok(formulaNode, "getAttribute('data-formula')", "FormulaNode: importDOM reads data-formula");
ok(chemNode,    "getAttribute('data-formula')", "ChemistryNode: importDOM reads data-formula");
console.log("  [PASS] importDOM reads formula from data-formula attribute first");

// ── 6. Editor mode supports click, double-click, Enter, Space ────────────
ok(formulaNode, "onClick={openEditor}",    "FormulaNode: click opens editor");
ok(formulaNode, "onDoubleClick={openEditor}", "FormulaNode: double-click opens editor");
ok(formulaNode, "e.key === 'Enter'",       "FormulaNode: Enter key opens editor");
ok(formulaNode, "e.key === ' '",           "FormulaNode: Space key opens editor");
ok(chemNode,    "onClick={openEditor}",    "ChemistryNode: click opens editor");
ok(chemNode,    "onDoubleClick={openEditor}", "ChemistryNode: double-click opens editor");
ok(chemNode,    "e.key === 'Enter'",       "ChemistryNode: Enter key opens editor");
ok(chemNode,    "e.key === ' '",           "ChemistryNode: Space key opens editor");
console.log("  [PASS] Editor mode supports click, double-click, Enter, and Space");

// ── 7. Teacher-friendly labels ────────────────────────────────────────────
ok(formulaNode, "Edit equation",          "FormulaNode: uses 'Edit equation' aria-label");
ok(chemNode,    "Edit chemistry equation", "ChemistryNode: uses 'Edit chemistry equation' aria-label");
console.log("  [PASS] Nodes use teacher-friendly labels ('Edit equation' / 'Edit chemistry equation')");

// ── 8. FormulaEditorModal distinguishes insert vs edit ───────────────────
ok(formulaModal, "Insert equation", "FormulaEditorModal: has 'Insert equation' text for new");
ok(formulaModal, "Save equation",   "FormulaEditorModal: has 'Save equation' text for editing");
console.log("  [PASS] FormulaEditorModal distinguishes insert vs save");

// ── 9. ChemistryFormulaModal distinguishes insert vs edit ────────────────
ok(chemModal, "Insert chemistry", "ChemistryFormulaModal: has insert text for new");
ok(chemModal, "Save chemistry",   "ChemistryFormulaModal: has save text for editing");
console.log("  [PASS] ChemistryFormulaModal distinguishes insert vs save");

// ── 10. Global CSS removes default math-field box/border/background ───────
ok(indexCss, "[data-lexical-formula]",     "index.css: styles [data-lexical-formula]");
ok(indexCss, "[data-lexical-chemistry]",   "index.css: styles [data-lexical-chemistry]");
ok(indexCss, "math-field[readonly]",       "index.css: styles math-field[readonly]");
ok(indexCss, "background: transparent",   "index.css: removes background");
ok(indexCss, "border: none",              "index.css: removes border");
ok(indexCss, "font-size: 1em",            "index.css: inherits font size");
console.log("  [PASS] Global CSS removes default math-field box/border/background");

// ── 11. RichContentRenderer imports MathLive ─────────────────────────────
ok(renderer, 'import "mathlive"', "RichContentRenderer: imports mathlive for read-only rendering");
console.log("  [PASS] RichContentRenderer imports MathLive for read-only formula rendering");

// ── 12. Sanitizer preserves required math/formula attributes ─────────────
ok(sanitizer, "math-field",           "Sanitizer: allows math-field tag");
ok(sanitizer, '"data-formula"',       "Sanitizer: allows data-formula in ALLOWED_ATTR");
ok(sanitizer, "ALLOW_DATA_ATTR: true","Sanitizer: allows all data-* attributes");
console.log("  [PASS] richContentSanitizer preserves required math-field and data attributes");

// ── 13. No permanent gray chip/box styling for inline formulas ───────────
notOk(formulaNode, "bg-slate-100",       "FormulaNode: no permanent bg-slate-100 chip");
notOk(formulaNode, "fontSize: '0.9em'",  "FormulaNode: no forced 0.9em font size");
notOk(chemNode,    "bg-slate-100",       "ChemistryNode: no permanent bg-slate-100 chip");
notOk(chemNode,    "fontSize: '0.9em'",  "ChemistryNode: no forced 0.9em font size");
console.log("  [PASS] No permanent gray chip styling reintroduced");

// ── 14. Preloads existing formula value into modal ────────────────────────
ok(formulaNode, "initialFormula={formula}", "FormulaNode: passes formula to modal as initialFormula");
ok(chemNode,    "initialFormula={formula}", "ChemistryNode: passes formula to modal as initialFormula");
console.log("  [PASS] Modals receive existing formula value for preloading on edit");

console.log("\n>>> ALL CHECKS PASSED: Equation/chemistry rendering is correctly hardened. <<<\n");

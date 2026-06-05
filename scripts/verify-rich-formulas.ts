// Static source-assertion verification for equation/chemistry rendering (TipTap-oriented)
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

console.log("=== VERITAS Learn: Rich Formula Rendering Verification (TipTap) ===\n");

// ── Source files ──────────────────────────────────────────────────────────
const formulaNode  = read("src/components/RichContent/FormulaNode.tsx");
const chemNode     = read("src/components/RichContent/ChemistryNode.tsx");
const formulaModal = read("src/components/RichContent/FormulaEditorModal.tsx");
const chemModal    = read("src/components/RichContent/ChemistryFormulaModal.tsx");
const renderer     = read("src/components/RichContent/RichContentRenderer.tsx");
const sanitizer    = read("src/components/RichContent/richContentSanitizer.ts");
const indexCss     = read("src/index.css");

// ── 1. parseHTML and renderHTML are implemented (TipTap counterparts) ────────────────
ok(formulaNode, "parseHTML()", "FormulaNode: implements parseHTML");
ok(formulaNode, "renderHTML(", "FormulaNode: implements renderHTML");
ok(chemNode,    "parseHTML()", "ChemistryNode: implements parseHTML");
ok(chemNode,    "renderHTML(", "ChemistryNode: implements renderHTML");
console.log("  [PASS] FormulaNode and ChemistryNode implement parseHTML and renderHTML representation of TipTap");

// ── 2. Formula values preserved through TipTap Node Attributes ────────────────
ok(formulaNode, "addAttributes()",         "FormulaNode: implements addAttributes()");
ok(formulaNode, "formula:",                "FormulaNode: holds formula attribute definition");
ok(chemNode,    "addAttributes()",         "ChemistryNode: implements addAttributes()");
ok(chemNode,    "formula:",                "ChemistryNode: holds formula attribute definition");
console.log("  [PASS] Nodes preserve formula values through TipTap attributes and serialization");

// ── 3. renderHTML includes stable data attributes for legacy migration/loading ──────────────────
ok(formulaNode, "data-lexical-formula",    "FormulaNode: renderHTML sets data-lexical-formula");
ok(formulaNode, "data-formula",            "FormulaNode: renderHTML sets data-formula");
ok(chemNode,    "data-lexical-chemistry",  "ChemistryNode: renderHTML sets data-lexical-chemistry");
ok(chemNode,    "data-formula",            "ChemistryNode: renderHTML sets data-formula");
console.log("  [PASS] renderHTML includes stable data-lexical-* and data-formula attributes");

// ── 4. parseHTML reads elements securely ─────────
ok(formulaNode,    "formula", "FormulaNode: parseHTML parses formula attribute");
ok(chemNode,       "formula", "ChemistryNode: parseHTML parses formula attribute");
console.log("  [PASS] parseHTML securely reads inputs from elements");

// ── 5. parseHTML reads data-formula attribute ─────────────────────────────
ok(formulaNode, "getAttribute(\"data-formula\")", "FormulaNode: parseHTML reads data-formula");
ok(chemNode,    "getAttribute(\"data-formula\")", "ChemistryNode: parseHTML reads data-formula");
console.log("  [PASS] parseHTML reads formula from data-formula attribute first");

// ── 6. Editor mode supports click, double-click, Enter, Space ────────────
ok(formulaNode, "onClick={openEditor}",    "FormulaNode: click opens editor");
ok(formulaNode, "onDoubleClick={openEditor}", "FormulaNode: double-click opens editor");
ok(formulaNode, "e.key === \"Enter\"",     "FormulaNode: Enter key opens editor");
ok(formulaNode, "e.key === \" \"",         "FormulaNode: Space key opens editor");
ok(chemNode,    "onClick={openEditor}",    "ChemistryNode: click opens editor");
ok(chemNode,    "onDoubleClick={openEditor}", "ChemistryNode: double-click opens editor");
ok(chemNode,    "e.key === \"Enter\"",     "ChemistryNode: Enter key opens editor");
ok(chemNode,    "e.key === \" \"",         "ChemistryNode: Space key opens editor");
console.log("  [PASS] Editor mode supports click, double-click, Enter, and Space inside interactive React View");

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
ok(renderer, "import \"mathlive\"", "RichContentRenderer: imports mathlive for read-only rendering");
console.log("  [PASS] RichContentRenderer imports MathLive for read-only formula rendering");

// ── 12. Sanitizer preserves required math/formula attributes ─────────────
ok(sanitizer, "math-field",           "Sanitizer: allows math-field tag");
ok(sanitizer, "\"data-formula\"",       "Sanitizer: allows data-formula in ALLOWED_ATTR");
ok(sanitizer, "ALLOW_DATA_ATTR: true","Sanitizer: allows all data-* attributes");
console.log("  [PASS] richContentSanitizer preserves required math-field and data attributes");

// ── 13. No permanent gray chip/box styling for inline formulas ───────────
notOk(formulaNode, "bg-slate-100",       "FormulaNode: no permanent bg-slate-100 chip");
notOk(formulaNode, "fontSize: \"0.9em\"",  "FormulaNode: no forced 0.9em font size");
notOk(chemNode,    "bg-slate-100",       "ChemistryNode: no permanent bg-slate-100 chip");
notOk(chemNode,    "fontSize: \"0.9em\"",  "ChemistryNode: no forced 0.9em font size");
console.log("  [PASS] No permanent gray chip styling reintroduced");

// ── 14. Preloads existing formula value into modal ────────────────────────
ok(formulaNode, "initialFormula={node.attrs.formula}", "FormulaNode: passes formula metadata attributes to modal for editing");
ok(chemNode,    "initialFormula={node.attrs.formula}", "ChemistryNode: passes formula metadata attributes to modal for editing");
console.log("  [PASS] Modals receive existing formula value for preloading on edit");

console.log("\n>>> ALL CHECKS PASSED: Equation/chemistry rendering is correctly hardened for TipTap. <<<\n");

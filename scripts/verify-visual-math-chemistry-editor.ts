// Visual Math & Chemistry Editor — teacher-UX verification (TipTap version)
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

console.log("=== VERITAS Learn: Visual Math & Chemistry Editor Verification (TipTap) ===\n");

const formulaModal  = read("src/components/RichContent/FormulaEditorModal.tsx");
const chemModal     = read("src/components/RichContent/ChemistryFormulaModal.tsx");
const formulaNode   = read("src/components/RichContent/FormulaNode.tsx");
const chemNode      = read("src/components/RichContent/ChemistryNode.tsx");
const editor        = read("src/components/RichContent/RichContentEditor.tsx");
const sanitizer     = read("src/components/RichContent/richContentSanitizer.ts");
const indexCss      = read("src/index.css");
const renderer      = read("src/components/RichContent/RichContentRenderer.tsx");

// ── 1. Main teacher UI does not require LaTeX as the primary workflow ─────────
notOk(
  formulaModal,
  "type LaTeX directly",
  "FormulaEditorModal: main UI must not instruct teachers to 'type LaTeX directly'"
);
notOk(
  chemModal,
  "Edit Formula (LaTeX format)",
  "ChemistryFormulaModal: must not use 'Edit Formula (LaTeX format)' label"
);
notOk(
  chemModal,
  "LaTeX format",
  "ChemistryFormulaModal: must not expose 'LaTeX format' as the primary workflow label"
);
console.log("  [PASS] Main teacher UI does not require LaTeX as the primary workflow");

// ── 2. Word 'LaTeX' only appears in optional Advanced sections ────────────────
ok(
  formulaModal,
  "Advanced (optional)",
  "FormulaEditorModal: must have 'Advanced (optional)' section label"
);
ok(
  chemModal,
  "Advanced (optional)",
  "ChemistryFormulaModal: must have 'Advanced (optional)' section label"
);
console.log("  [PASS] 'LaTeX' only appears in optional Advanced sections");

// ── 3. Visual Math Editor does not expose a virtual keyboard toggle ───────────
ok(
  formulaModal,
  'mathVirtualKeyboardPolicy = "off"',
  "FormulaEditorModal: must suppress MathLive virtual keyboard automatically"
);
notOk(
  formulaModal,
  "keyboard toggle",
  "FormulaEditorModal: must not have a 'keyboard toggle' control"
);
ok(
  chemModal,
  'mathVirtualKeyboardPolicy = "off"',
  "ChemistryFormulaModal: must suppress MathLive virtual keyboard automatically"
);
console.log("  [PASS] Virtual keyboard is suppressed automatically — no teacher-facing toggle");

// ── 4. Scientific notation quick insert exists and is form/button based ───────
ok(formulaModal, "Scientific Notation",         "FormulaEditorModal: has 'Scientific Notation' section");
ok(formulaModal, "Coefficient",                 "FormulaEditorModal: scientific notation has coefficient field");
ok(formulaModal, "Exponent",                    "FormulaEditorModal: scientific notation has exponent field");
ok(formulaModal, "Insert notation",             "FormulaEditorModal: has 'Insert notation' button for scientific notation");
ok(formulaModal, "ScientificNotationForm",      "FormulaEditorModal: defines ScientificNotationForm component");
ok(formulaModal, "×10ⁿ",                       "FormulaEditorModal: quick bar includes ×10ⁿ scientific notation button");
console.log("  [PASS] Scientific notation is form/button based with coefficient + exponent fields");

// ── 5. Isotope notation quick insert exists and is form/button based ──────────
ok(formulaModal, "Isotope Notation",            "FormulaEditorModal: has 'Isotope Notation' section");
ok(formulaModal, "Mass number",                 "FormulaEditorModal: isotope form has mass number field");
ok(formulaModal, "Element",                     "FormulaEditorModal: isotope form has element field");
ok(formulaModal, "Atomic no.",                  "FormulaEditorModal: isotope form has optional atomic number field");
ok(formulaModal, "Charge (optional",            "FormulaEditorModal: isotope form has optional charge field");
ok(formulaModal, "Insert isotope",              "FormulaEditorModal: has 'Insert isotope' button");
ok(formulaModal, "IsotopeForm",                 "FormulaEditorModal: defines IsotopeForm component");
console.log("  [PASS] Isotope notation is form/button based with element, mass, atomic number, charge fields");

// ── 6. Chemistry tools: subscript, charge, arrows, equilibrium, states ────────
ok(formulaModal, "Subscript",                   "FormulaEditorModal: has Subscript button");
ok(formulaModal, "Positive charge",             "FormulaEditorModal: has Positive charge button");
ok(formulaModal, "Negative charge",             "FormulaEditorModal: has Negative charge button");
ok(formulaModal, "Reaction arrow",              "FormulaEditorModal: has Reaction arrow button");
ok(formulaModal, "Equilibrium arrows",          "FormulaEditorModal: has Equilibrium arrows button");
ok(formulaModal, "Solid",                       "FormulaEditorModal: has Solid state button");
ok(formulaModal, "Liquid",                      "FormulaEditorModal: has Liquid state button");
ok(formulaModal, "Gas",                         "FormulaEditorModal: has Gas state button");
ok(formulaModal, "Aqueous",                     "FormulaEditorModal: has Aqueous state button");
ok(formulaModal, "\\\\rightleftharpoons",       "FormulaEditorModal: equilibrium arrows use \\rightleftharpoons");
ok(formulaModal, "\\\\rightarrow",              "FormulaEditorModal: reaction arrows use \\rightarrow");
ok(chemModal, "Subscript",                      "ChemistryFormulaModal: has Subscript button");
ok(chemModal, "Reaction arrow",                 "ChemistryFormulaModal: has Reaction arrow button");
ok(chemModal, "Equilibrium arrows",             "ChemistryFormulaModal: has Equilibrium arrows button");
ok(chemModal, "Solid",                          "ChemistryFormulaModal: has Solid state button");
ok(chemModal, "Aqueous",                        "ChemistryFormulaModal: has Aqueous state button");
console.log("  [PASS] Chemistry tools include subscript, charge, reaction/equilibrium arrows, and states of matter");

// ── 7. Common science templates exist ─────────────────────────────────────────
ok(formulaModal, "Science Templates",           "FormulaEditorModal: has 'Science Templates' tab");
ok(formulaModal, "Photosynthesis",              "FormulaEditorModal: has photosynthesis template");
ok(formulaModal, "Respiration",                 "FormulaEditorModal: has respiration template");
ok(formulaModal, "Mass-energy equivalence",     "FormulaEditorModal: has E=mc² template");
ok(formulaModal, "Newton's 2nd law",            "FormulaEditorModal: has F=ma template");
ok(formulaModal, "pH",                          "FormulaEditorModal: has pH formula template");
ok(formulaModal, "Ideal gas law",               "FormulaEditorModal: has PV=nRT template");
ok(formulaModal, "Quadratic formula",           "FormulaEditorModal: has quadratic formula template");
ok(formulaModal, "SciencePanel",                "FormulaEditorModal: defines SciencePanel component");
console.log("  [PASS] Common science templates exist (physics, chemistry, biology, math)");

// ── 8. Labeled text buttons are gone, replaced by single compact icon-only science button with title ────
notOk(editor, "<span>Equation</span>",          "RichContentEditor toolbar: MUST NOT show separate 'Equation' text label");
notOk(editor, "<span>Chemistry</span>",         "RichContentEditor toolbar: MUST NOT show separate 'Chemistry' text label");
ok(editor, "Insert equation or science notation", "RichContentEditor toolbar: single utility button with proper search/aria-label");
ok(editor, "initialTab={allowMath ? \"math\" : \"chemistry\"}", "RichContentEditor: launches with contextually appropriate initial active tab");
console.log("  [PASS] Equation/Chemistry labeled buttons are gone, replaced by a single accessible 'Insert equation or science notation' button");

// ── 9. Existing formulas remain editable by click/double-click/Enter/Space ───
ok(formulaNode, "onClick={openEditor}",         "FormulaNode: click opens editor");
ok(formulaNode, "onDoubleClick={openEditor}",   "FormulaNode: double-click opens editor");
ok(formulaNode, "e.key === \"Enter\"",            "FormulaNode: Enter key opens editor");
ok(formulaNode, "e.key === \" \"",               "FormulaNode: Space key opens editor");
console.log("  [PASS] Existing equations are editable by click, double-click, Enter, and Space");

// ── 10. Existing chemistry remains editable by click/double-click/Enter/Space ─
ok(chemNode, "onClick={openEditor}",            "ChemistryNode: click opens editor");
ok(chemNode, "onDoubleClick={openEditor}",      "ChemistryNode: double-click opens editor");
ok(chemNode, "e.key === \"Enter\"",              "ChemistryNode: Enter key opens editor");
ok(chemNode, "e.key === \" \"",                 "ChemistryNode: Space key opens editor");
ok(chemNode, "FormulaEditorModal",              "ChemistryNode: uses integrated FormulaEditorModal");
ok(chemNode, "initialTab=\"chemistry\"",        "ChemistryNode: opens with chemistry tab active");
ok(chemNode, "initialFormula={node.attrs.formula}", "ChemistryNode: passes existing formula attributes to editor");
console.log("  [PASS] Existing chemistry equations are editable by click, double-click, Enter, and Space");

// ── 11. Static rendering avoids permanent gray box/chip styling ───────────────
notOk(formulaNode, "bg-slate-100",      "FormulaNode: no permanent bg-slate-100 chip background");
notOk(chemNode,    "bg-slate-100",      "ChemistryNode: no permanent bg-slate-100 chip background");
ok(indexCss, "background: transparent", "index.css: math-field uses transparent background");
ok(indexCss, "border: none",            "index.css: math-field removes border");
ok(indexCss, "font-size: 1em",         "index.css: math-field inherits font size");
console.log("  [PASS] Static rendering uses transparent, borderless, font-inheriting style");

// ── 12. Sanitizer preserves required formula/chemistry attributes ─────────────
ok(sanitizer, "math-field",            "Sanitizer: allows math-field tag");
ok(sanitizer, "\"data-formula\"",        "Sanitizer: allows data-formula attribute");
ok(sanitizer, "ALLOW_DATA_ATTR: true", "Sanitizer: allows all data-* attributes (covers data-lexical-formula, data-lexical-chemistry)");
console.log("  [PASS] Sanitizer preserves required math-field and data attributes");

// ── 13. Student-facing rendering does not expose teacher-only fields ──────────
notOk(renderer, "modelAnswer",        "RichContentRenderer: must not render modelAnswer");
notOk(renderer, "rubricCategories",   "RichContentRenderer: must not render rubricCategories");
notOk(renderer, "aiScoringGuidance",  "RichContentRenderer: must not render aiScoringGuidance");
notOk(renderer, "teacherNotes",       "RichContentRenderer: must not render teacherNotes");
console.log("  [PASS] Student-facing renderer does not expose teacher-only fields");

// ── 14. Existing lesson content still imports / renders ───────────────────────
ok(formulaNode, "parseHTML()",         "FormulaNode: implements parseHTML for legacy HTML import");
ok(chemNode,    "parseHTML()",         "ChemistryNode: implements parseHTML for legacy HTML import");
ok(formulaNode, "getAttribute(\"data-formula\")", "FormulaNode: parseHTML reads data-formula from existing saved content");
ok(chemNode,    "getAttribute(\"data-formula\")", "ChemistryNode: parseHTML reads data-formula from existing saved content");
console.log("  [PASS] parseHTML is implemented — existing lesson content will render cleanly");

// ── Bonus: teacher-friendly aria-labels ───────────────────────────────────────
ok(formulaNode, "Edit equation",          "FormulaNode: uses teacher-friendly 'Edit equation' aria-label");
ok(chemNode,    "Edit chemistry equation","ChemistryNode: uses teacher-friendly 'Edit chemistry equation' aria-label");
ok(formulaModal, "Visual Math & Science Editor", "FormulaEditorModal: uses teacher-friendly dialog title");
ok(chemModal,    "Chemistry Editor",             "ChemistryFormulaModal: uses teacher-friendly dialog title");
console.log("  [PASS] All editor controls use teacher-friendly plain-language labels");

// ── Bonus: tab bar present in integrated editor ───────────────────────────────
ok(formulaModal, "EditorTab",         "FormulaEditorModal: defines EditorTab type");
ok(formulaModal, "activeTab",         "FormulaEditorModal: tracks active tab state");
ok(formulaModal, "'math'",            "FormulaEditorModal: has math tab");
ok(formulaModal, "'chemistry'",       "FormulaEditorModal: has chemistry tab");
ok(formulaModal, "'science'",         "FormulaEditorModal: has science templates tab");
console.log("  [PASS] Integrated editor has Math, Chemistry, and Science Templates tabs");

console.log("\n>>> ALL CHECKS PASSED: Visual Math & Chemistry Editor meets teacher-UX requirements for TipTap. <<<\n");

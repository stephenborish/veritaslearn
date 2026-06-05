/**
 * LAYER B — REAL LessonsBuilder component, real workflows.
 *
 * Mounts the ACTUAL LessonsBuilder (with its real useLiveState refs,
 * setCurrentBlocksLive, getSnapshot, save, and startEditing restore logic) and
 * reproduces the exact user-reported scenarios:
 *
 *   teacher types text → switches workspace/block/question → returns → text
 *   remains → Save draft → reload/reopen lesson → text remains.
 *
 * The ONLY seam is RichContentEditor, replaced by a faithful CONTROLLED test
 * double: it renders a <textarea> bound to the same `value`/`onChange` contract
 * and emits the SAME RichContent object shape (html/plainText/lexicalJson/assets)
 * the real Lexical editor emits on every keystroke. Because it is controlled, if
 * the parent ever drops or staleness-clobbers the value, the textarea would show
 * blank after a remount — which is precisely the bug under test.
 *
 * Firebase and fetch are stubbed (irrelevant to the persistence logic). `idToken`
 * is null so the server-draft/autosave fetch effects are inert; Save draft flows
 * through the real `onSaveLesson` save path.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent, within, cleanup } from "@testing-library/react";

// ── Faithful controlled double for RichContentEditor ────────────────────────
vi.mock("../src/components/RichContent/RichContentEditor", () => {
  const React = require("react");
  const toText = (v: any): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v.replace(/<[^>]*>/g, "");
    if (typeof v === "object") {
      if (typeof v.plainText === "string") return v.plainText;
      if (typeof v.html === "string") return v.html.replace(/<[^>]*>/g, "");
    }
    return String(v);
  };
  const makeRichContent = (text: string) => ({
    version: 1,
    format: "veritas-rich-content",
    html: text ? `<p>${text}</p>` : "",
    plainText: text,
    assets: [],
    lexicalJson: { root: { children: text ? [{ type: "paragraph" }] : [], type: "root", version: 1 } },
    updatedAt: new Date().toISOString(),
  });
  const RichContentEditor = ({ value, onChange, documentKey, placeholder, disabled }: any) =>
    React.createElement("textarea", {
      "data-rce": "1",
      "data-doc": documentKey || "",
      "data-ph": placeholder || "",
      value: toText(value),
      disabled: !!disabled,
      onChange: (e: any) => onChange(makeRichContent(e.target.value)),
    });
  return { RichContentEditor };
});

// Video widgets are unrelated to text persistence and need browser/firebase APIs.
vi.mock("../src/components/TeacherDashboard/VideoUploader", () => ({ default: () => null }));
vi.mock("../src/components/TeacherDashboard/VideoSourcePicker", () => ({ default: () => null }));

// ── Firebase + fetch stubs ──────────────────────────────────────────────────
vi.mock("../src/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "test-token" } },
  storage: {},
  db: {},
  googleProvider: {},
  signInWithPopup: async () => {},
  signOut: async () => {},
  onAuthStateChanged: () => () => {},
  GoogleAuthProvider: class {},
}));

import LessonsBuilder from "../src/components/TeacherDashboard/LessonsBuilder";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any);
  try { localStorage.clear(); } catch { /* ignore */ }
});

// ── In-memory "server" that mimics server.ts persistence for onSaveLesson ────
function makeStore() {
  const store: { lessons: any[]; blocks: any[] } = { lessons: [], blocks: [] };
  const onSaveLesson = vi.fn(async (payload: any) => {
    const id = payload.id || "lesson_" + Math.random().toString(36).slice(2, 8);
    const lesson = {
      id,
      title: payload.title || "Untitled Lesson",
      description: payload.description ?? "",
      estimatedMinutes: payload.estimatedMinutes ?? 30,
      isPublished: !!payload.isPublished,
      courseId: "course_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        restrictSeeking: payload.settings?.restrictSeeking ?? true,
        requireFullscreen: payload.settings?.requireFullscreen ?? true,
        allowRetakes: payload.settings?.allowRetakes ?? false,
        randomizeChoices: payload.settings?.randomizeChoices ?? true,
        immediateFeedback: payload.settings?.immediateFeedback ?? false,
      },
    };
    // Persist blocks exactly as sent (deep clone, like the server snapshotting).
    const blocks = (payload.blocks || []).map((b: any, i: number) => ({
      ...JSON.parse(JSON.stringify(b)),
      id: b.id || "block_" + Math.random().toString(36).slice(2, 8),
      lessonId: id,
      order: i + 1,
    }));
    store.lessons = store.lessons.filter((l) => l.id !== id).concat(lesson);
    store.blocks = store.blocks.filter((b) => b.lessonId !== id).concat(blocks);
    return { ...lesson, blocks };
  });
  return { store, onSaveLesson };
}

function renderBuilder(store: { lessons: any[]; blocks: any[] }, onSaveLesson: any) {
  return render(
    React.createElement(LessonsBuilder as any, {
      lessons: store.lessons,
      blocks: store.blocks,
      onSaveLesson,
      onArchived: async () => {},
      idToken: null,
    })
  );
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
const clickText = async (root: HTMLElement, text: string, which = 0) => {
  const els = within(root).getAllByText(text);
  await act(async () => { fireEvent.click(els[which]); });
};
const rceByDoc = (root: HTMLElement, docSubstr: string): HTMLTextAreaElement => {
  const all = Array.from(root.querySelectorAll<HTMLTextAreaElement>("textarea[data-rce]"));
  const el = all.find((t) => (t.getAttribute("data-doc") || "").includes(docSubstr));
  if (!el) throw new Error(`No RichContentEditor with data-doc containing "${docSubstr}". Present: ${all.map((t) => t.getAttribute("data-doc")).join(" | ")}`);
  return el;
};
const rceByPh = (root: HTMLElement, ph: string): HTMLTextAreaElement => {
  const all = Array.from(root.querySelectorAll<HTMLTextAreaElement>("textarea[data-rce]"));
  const el = all.find((t) => (t.getAttribute("data-ph") || "") === ph);
  if (!el) throw new Error(`No RichContentEditor with placeholder "${ph}". Present: ${all.map((t) => t.getAttribute("data-ph")).join(" | ")}`);
  return el;
};
const typeInto = async (el: HTMLTextAreaElement, text: string) => {
  await act(async () => { fireEvent.change(el, { target: { value: text } }); });
};
const plainInputByPlaceholder = (root: HTMLElement, ph: string): HTMLInputElement => {
  const el = root.querySelector<HTMLInputElement>(`input[placeholder="${ph}"]`);
  if (!el) throw new Error(`No input with placeholder "${ph}"`);
  return el;
};

// Open a fresh new-lesson editor.
async function openNewLesson(container: HTMLElement) {
  await clickText(container, "New lesson");
}
// Save draft, returns the canonical saved lesson captured from onSaveLesson.
async function saveDraft(container: HTMLElement, onSaveLesson: any) {
  await clickText(container, "Save draft");
  await act(async () => { await Promise.resolve(); });
  const calls = onSaveLesson.mock.calls;
  return calls[calls.length - 1][0];
}
// Reopen the (single) lesson from the library (simulates close + reload + reopen).
// Clicking "Edit" runs the real startEditing() restore path.
async function reopenLesson(store: any, onSaveLesson: any, _title: string) {
  cleanup();
  const { container } = renderBuilder(store, onSaveLesson);
  await clickText(container, "Edit");
  return container;
}

describe("Layer B — real LessonsBuilder workflows (type → navigate → return → save → reload)", () => {
  it("1. Description survives Setup → Content → Setup, then Save + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const text = "DESC-UNIQUE-2026-alpha";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await typeInto(rceByDoc(container, "lesson-desc"), text);
    // Switch Setup → Content & Questions (adds a reading to have content) → back to Setup
    await clickText(container, "Add reading");           // unmounts Setup/Description editor
    await clickText(container, "Setup");                  // returns to Setup → editor remounts
    expect(rceByDoc(container, "lesson-desc").value).toBe(text);

    const payload = await saveDraft(container, onSaveLesson);
    expect(payload.description.plainText).toBe(text);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    expect(rceByDoc(reopened, "lesson-desc").value).toBe(text);
  });

  it("2. Reading body survives adding another block + returning, then Save + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const text = "READING-BODY-2026-beta";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add reading");           // block 0, becomes active
    await typeInto(rceByDoc(container, "_reading_content"), text);
    await clickText(container, "Add question");          // block 1, switches away
    // Return to the first reading via the outline list.
    await clickText(container, "Untitled Reading");
    expect(rceByDoc(container, "_reading_content").value).toBe(text);

    const payload = await saveDraft(container, onSaveLesson);
    const reading = payload.blocks.find((b: any) => b.type === "reading");
    expect(reading.content.plainText).toBe(text);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Reading");
    expect(rceByDoc(reopened, "_reading_content").value).toBe(text);
  });

  it("3. MC question stem survives adding another block + returning, then Save + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const stem = "MC-STEM-2026-gamma";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add question");          // block 0 (mc by default)
    await typeInto(rceByPh(container, "Enter the question students will see..."), stem);
    await clickText(container, "Add reading");           // switch away
    await clickText(container, "Untitled Question");     // return
    expect(rceByPh(container, "Enter the question students will see...").value).toBe(stem);

    const payload = await saveDraft(container, onSaveLesson);
    const q = payload.blocks.find((b: any) => b.type === "question").singleQuestion;
    expect(q.stem.plainText).toBe(stem);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Question");
    expect(rceByPh(reopened, "Enter the question students will see...").value).toBe(stem);
  });

  it("4. MC answer choices A & B survive switching block + returning, then Save + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const a = "CHOICE-A-2026-delta";
    const b = "CHOICE-B-2026-delta";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add question");
    // Default choices render as plain text inputs (Choice A / Choice B).
    const inA = plainInputByPlaceholder(container, "Choice A (Enter plain text option...)");
    const inB = plainInputByPlaceholder(container, "Choice B (Enter plain text option...)");
    await act(async () => { fireEvent.change(inA, { target: { value: a } }); });
    await act(async () => { fireEvent.change(inB, { target: { value: b } }); });

    await clickText(container, "Add reading");           // switch away
    await clickText(container, "Untitled Question");     // return
    expect(plainInputByPlaceholder(container, "Choice A (Enter plain text option...)").value).toBe(a);
    expect(plainInputByPlaceholder(container, "Choice B (Enter plain text option...)").value).toBe(b);

    const payload = await saveDraft(container, onSaveLesson);
    const choices = payload.blocks.find((bk: any) => bk.type === "question").singleQuestion.choices;
    expect(choices[0].text).toBe(a);
    expect(choices[1].text).toBe(b);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Question");
    expect(plainInputByPlaceholder(reopened, "Choice A (Enter plain text option...)").value).toBe(a);
    expect(plainInputByPlaceholder(reopened, "Choice B (Enter plain text option...)").value).toBe(b);
  });

  it("4b. A rich-text (Go Rich/Math) answer choice survives switch + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const rich = "RICH-CHOICE-2026-delta2";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add question");
    // Convert choice A to rich text, then type into the RichContentEditor double.
    await clickText(container, "Go Rich/Math", 0);
    const richEd = rceByDoc(container, "-choice-");
    await typeInto(richEd, rich);

    await clickText(container, "Add reading");
    await clickText(container, "Untitled Question");
    expect(rceByDoc(container, "-choice-").value).toBe(rich);

    const payload = await saveDraft(container, onSaveLesson);
    const choices = payload.blocks.find((bk: any) => bk.type === "question").singleQuestion.choices;
    expect(choices[0].text.plainText).toBe(rich);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Question");
    expect(rceByDoc(reopened, "-choice-").value).toBe(rich);
  });

  it("5. SA prompt + student instructions + model answer + AI guidance + teacher notes + rubric survive switch + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const vals = {
      stem: "SA-PROMPT-2026-epsilon",
      instr: "SA-INSTR-2026-epsilon",
      model: "SA-MODEL-2026-epsilon",
      guide: "SA-GUIDE-2026-epsilon",
      notes: "SA-NOTES-2026-epsilon",
      rubric: "SA-RUBRIC-2026-epsilon",
    };
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add question");
    // Switch question type MC → SA via the real <select> (the one offering an "sa" option).
    const typeSelect = Array.from(container.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "sa")
    ) as HTMLSelectElement | undefined;
    if (!typeSelect) throw new Error("Question-type <select> with an 'sa' option not found");
    await act(async () => { fireEvent.change(typeSelect, { target: { value: "sa" } }); });

    await typeInto(rceByPh(container, "Enter the question students will see..."), vals.stem);
    await typeInto(rceByPh(container, "e.g. Respond in 3–5 complete sentences."), vals.instr);
    await typeInto(rceByPh(container, "A strong, full-credit answer."), vals.model);
    await typeInto(rceByPh(container, "Key points the AI grader should look for and how to weight them."), vals.guide);
    await typeInto(rceByPh(container, "Private notes for graders — not sent to AI or students."), vals.notes);
    // Add a rubric category, then type its description.
    await clickText(container, "Add Category");
    await typeInto(rceByPh(container, "What earns credit in this category?"), vals.rubric);

    // Switch away and back.
    await clickText(container, "Add reading");
    await clickText(container, "Untitled Question");

    expect(rceByPh(container, "Enter the question students will see...").value).toBe(vals.stem);
    expect(rceByPh(container, "e.g. Respond in 3–5 complete sentences.").value).toBe(vals.instr);
    expect(rceByPh(container, "A strong, full-credit answer.").value).toBe(vals.model);
    expect(rceByPh(container, "Key points the AI grader should look for and how to weight them.").value).toBe(vals.guide);
    expect(rceByPh(container, "Private notes for graders — not sent to AI or students.").value).toBe(vals.notes);
    expect(rceByPh(container, "What earns credit in this category?").value).toBe(vals.rubric);

    const payload = await saveDraft(container, onSaveLesson);
    const q = payload.blocks.find((b: any) => b.type === "question").singleQuestion;
    expect(q.stem.plainText).toBe(vals.stem);
    expect(q.studentInstructions.plainText).toBe(vals.instr);
    expect(q.modelAnswer.plainText).toBe(vals.model);
    expect(q.aiScoringGuidance.plainText).toBe(vals.guide);
    expect(q.teacherNotes.plainText).toBe(vals.notes);
    expect(q.rubricCategories[0].description.plainText).toBe(vals.rubric);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Question");
    expect(rceByPh(reopened, "Enter the question students will see...").value).toBe(vals.stem);
    expect(rceByPh(reopened, "A strong, full-credit answer.").value).toBe(vals.model);
    expect(rceByPh(reopened, "Key points the AI grader should look for and how to weight them.").value).toBe(vals.guide);
    expect(rceByPh(reopened, "Private notes for graders — not sent to AI or students.").value).toBe(vals.notes);
    expect(rceByPh(reopened, "What earns credit in this category?").value).toBe(vals.rubric);
  });

  it("6. MC Explanation / Practice Feedback survives switch + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const text = "EXPLANATION-2026-zeta";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add question");          // MC
    await typeInto(rceByPh(container, "Why is the correct answer correct? Shown as practice feedback if enabled."), text);
    await clickText(container, "Add reading");
    await clickText(container, "Untitled Question");
    expect(rceByPh(container, "Why is the correct answer correct? Shown as practice feedback if enabled.").value).toBe(text);

    const payload = await saveDraft(container, onSaveLesson);
    expect(payload.blocks.find((b: any) => b.type === "question").singleQuestion.explanation.plainText).toBe(text);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Question");
    expect(rceByPh(reopened, "Why is the correct answer correct? Shown as practice feedback if enabled.").value).toBe(text);
  });

  it("7. Video checkpoint question text survives switch + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const text = "CHECKPOINT-Q-2026-eta";
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);

    await clickText(container, "Add video");             // video block 0
    await clickText(container, "Add checkpoint");        // creates a checkpoint with an mc question
    await typeInto(rceByPh(container, "Enter the question students will see..."), text);

    // Switch away (Setup) and back to the video block.
    await clickText(container, "Setup");
    await clickText(container, "Untitled Video");
    expect(rceByPh(container, "Enter the question students will see...").value).toBe(text);

    const payload = await saveDraft(container, onSaveLesson);
    const cpq = payload.blocks.find((b: any) => b.type === "video").videoCheckpoints[0].questions[0];
    expect(cpq.stem.plainText).toBe(text);

    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    await clickText(reopened, "Untitled Video");
    expect(rceByPh(reopened, "Enter the question students will see...").value).toBe(text);
  });

  it("8. Intentional deletion: clearing a field as the first edit stays blank after Save + reload", async () => {
    const { store, onSaveLesson } = makeStore();
    const original = "TO-BE-DELETED-2026-theta";

    // Seed a saved lesson whose description already has text.
    const { container } = renderBuilder(store, onSaveLesson);
    await openNewLesson(container);
    await typeInto(rceByDoc(container, "lesson-desc"), original);
    await saveDraft(container, onSaveLesson);

    // Reopen, clear the description as the first edit, save, reload.
    const reopened = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    expect(rceByDoc(reopened, "lesson-desc").value).toBe(original);
    await typeInto(rceByDoc(reopened, "lesson-desc"), ""); // clear
    expect(rceByDoc(reopened, "lesson-desc").value).toBe("");
    const payload = await saveDraft(reopened, onSaveLesson);
    expect((payload.description?.plainText ?? "")).toBe(""); // saved blank, not the old text

    const reopened2 = await reopenLesson(store, onSaveLesson, "Untitled Lesson");
    expect(rceByDoc(reopened2, "lesson-desc").value).toBe(""); // stays blank, old text not resurrected
  });
});

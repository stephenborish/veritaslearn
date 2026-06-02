import { useState } from "react";
import { Plus, Trash, ArrowUp, ArrowDown, Eye, EyeOff, AlertCircle, CheckCircle2, Lock, Wand2, RotateCcw, X } from "lucide-react";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";
import { auth } from "../../lib/firebase";

type AnyQuestion = any;

function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

/** Extract a plain string from string | RichContent | undefined for blank detection. */
function textContent(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/<[^>]*>/g, "");
  if (typeof v === "object") {
    if (typeof v.plainText === "string") return v.plainText;
    if (typeof v.html === "string") return v.html.replace(/<[^>]*>/g, "");
    if (typeof v.text === "string") return v.text;
  }
  return String(v);
}

/** Returns the raw value for display in a read-only context (html preferred). */
function textOf(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.html === "string") return v.html;
  return String(v);
}

/**
 * Client-side validation mirror of server/data/validation.ts. Returns a list of
 * human-readable errors (empty => valid).
 */
export function validateQuestionClient(q: AnyQuestion, type: "mc" | "sa", graded: boolean): string[] {
  const errors: string[] = [];
  if (!q || textContent(q.stem).trim().length === 0) {
    errors.push("Question stem/prompt is required.");
  }
  if (type === "mc") {
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const nonBlank = choices.filter((c: any) => textContent(c?.text).trim().length > 0);
    if (nonBlank.length < 2) errors.push("Add at least two answer choices.");
    if (nonBlank.length !== choices.length) errors.push("Answer choices cannot be blank.");
    if (graded) {
      const hasCorrect = q.correctChoiceId && choices.some((c: any) => c.id === q.correctChoiceId);
      if (!hasCorrect) errors.push("Select exactly one correct answer.");
      if (!(Number(q.points) > 0)) errors.push("Graded questions need a positive point value.");
    }
  } else {
    if (graded) {
      if (!(Number(q.points) > 0)) errors.push("Graded questions need a positive point value.");
      const rubric = Array.isArray(q.rubricCategories) ? q.rubricCategories : [];
      if (rubric.length < 1) errors.push("Add at least one rubric category for AI/rubric grading.");
      rubric.forEach((c: any, i: number) => {
        if (!(Number(c.maxPoints) > 0)) errors.push(`Rubric category ${i + 1} needs positive max points.`);
      });
    }
  }
  return errors;
}

/**
 * Soft readiness warnings for SA questions — non-blocking, shown in amber.
 * Reminds teachers to fill in AI grading guidance before publishing.
 */
export function saReadinessWarnings(q: AnyQuestion, type: "mc" | "sa", graded: boolean): string[] {
  if (type !== "sa") return [];
  const warnings: string[] = [];
  if (graded) {
    if (!textContent(q?.modelAnswer).trim()) {
      warnings.push("No model answer — AI grading quality improves significantly with a model answer.");
    }
    if (!textContent(q?.aiScoringGuidance).trim()) {
      warnings.push("No scoring guidance — add guidance so the AI knows exactly what to look for.");
    }
    const rubric = Array.isArray(q?.rubricCategories) ? q.rubricCategories : [];
    if (rubric.length === 0) {
      warnings.push("No rubric categories — required for AI grading.");
    } else {
      const total = rubric.reduce((s: number, r: any) => s + (Number(r.maxPoints) || 0), 0);
      if (total !== Number(q?.points)) {
        warnings.push(
          `Rubric total (${total} pts) does not match point value (${Number(q?.points) || 0} pts).`
        );
      }
    }
  } else {
    if (!textContent(q?.modelAnswer).trim() && !textContent(q?.aiScoringGuidance).trim()) {
      warnings.push("No model answer or scoring guidance — practice feedback quality may be limited.");
    }
  }
  return warnings;
}

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-800 text-xs";
const labelCls = "font-bold text-slate-700 block mb-1 text-xs";
const secretLabelCls = "font-bold text-amber-700 mb-1 text-xs flex items-center gap-1";
const zoneLabelCls = "text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5";

const CHOICE_LETTERS = ["A", "B", "C", "D", "E", "F"];

export interface LessonContext {
  lessonTitle?: string;
  blockTitle?: string;
  courseContext?: string;
}

interface QuestionEditorProps {
  question: AnyQuestion;
  type: "mc" | "sa";
  graded: boolean;
  onChange: (q: AnyQuestion) => void;
  lessonContext?: LessonContext;
}

type AiStatus = "idle" | "generating" | "error";

export default function QuestionEditor({ question, type, graded, onChange, lessonContext }: QuestionEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiDraftActive, setAiDraftActive] = useState(false);
  const [showRevise, setShowRevise] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState("");

  const q = question || {};
  const patch = (partial: any) => onChange({ ...q, ...partial });

  // ---- MC choice helpers ----
  const choices: any[] = Array.isArray(q.choices) ? q.choices : [];
  const setChoices = (next: any[], correctChoiceId = q.correctChoiceId) =>
    patch({ choices: next, correctChoiceId });

  const addChoice = () => setChoices([...choices, { id: uid("choice"), text: "" }]);
  const updateChoiceContent = (id: string, content: any) =>
    setChoices(choices.map((c) => (c.id === id ? { ...c, text: content } : c)));
  const deleteChoice = (id: string) =>
    setChoices(
      choices.filter((c) => c.id !== id),
      q.correctChoiceId === id ? undefined : q.correctChoiceId
    );
  const moveChoice = (idx: number, dir: -1 | 1) => {
    const next = [...choices];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setChoices(next);
  };

  // ---- Rubric helpers ----
  const rubric: any[] = Array.isArray(q.rubricCategories) ? q.rubricCategories : [];
  const setRubric = (next: any[]) => patch({ rubricCategories: next });
  const addRubric = () => setRubric([...rubric, { id: uid("rub"), name: "", maxPoints: 1, description: "" }]);
  const updateRubric = (id: string, partial: any) => setRubric(rubric.map((r) => (r.id === id ? { ...r, ...partial } : r)));
  const deleteRubric = (id: string) => setRubric(rubric.filter((r) => r.id !== id));
  const rubricTotal = rubric.reduce((s, r) => s + (Number(r.maxPoints) || 0), 0);

  // ---- AI helpers ----
  const getToken = async (): Promise<string | null> => {
    try {
      return (await auth.currentUser?.getIdToken()) ?? null;
    } catch {
      return null;
    }
  };

  const applyAiResult = (data: any) => {
    patch({
      modelAnswer: data.modelAnswer || "",
      aiScoringGuidance: data.aiScoringGuidance || "",
      rubricCategories: data.rubricCategories || [],
    });
    setAiWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    setAiDraftActive(true);
    setAiStatus("idle");
  };

  const generateRubric = async () => {
    const stem = textContent(q.stem).trim();
    if (!stem) {
      setAiError("Enter a question stem before generating.");
      setAiStatus("error");
      return;
    }
    const pts = Number(q.points);
    if (!(pts > 0)) {
      setAiError("Set a positive point value before generating.");
      setAiStatus("error");
      return;
    }

    setAiStatus("generating");
    setAiError(null);

    try {
      const token = await getToken();
      if (!token) {
        setAiStatus("error");
        setAiError("Not authenticated. Please reload and try again.");
        return;
      }

      const body: any = {
        lessonTitle: lessonContext?.lessonTitle || "Lesson",
        questionStem: stem,
        points: pts,
      };
      if (lessonContext?.blockTitle) body.blockTitle = lessonContext.blockTitle;
      if (lessonContext?.courseContext) body.courseContext = lessonContext.courseContext;
      if (textContent(q.studentInstructions).trim()) {
        body.studentInstructions = textContent(q.studentInstructions);
      }
      if (textContent(q.teacherNotes).trim()) {
        body.existingTeacherNotes = textContent(q.teacherNotes);
      }

      const res = await fetch("/api/ai/generate-short-answer-rubric", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Server error ${res.status}`);
      }

      const data = await res.json();
      applyAiResult(data);
    } catch (err: any) {
      setAiStatus("error");
      setAiError(err.message || "Generation failed. Please try again.");
    }
  };

  const reviseRubric = async () => {
    const stem = textContent(q.stem).trim();
    if (!stem) {
      setAiError("Question stem is required.");
      setAiStatus("error");
      return;
    }
    if (!revisionInstruction.trim()) {
      setAiError("Enter revision instructions.");
      setAiStatus("error");
      return;
    }
    const pts = Number(q.points);
    if (!(pts > 0)) {
      setAiError("Set a positive point value first.");
      setAiStatus("error");
      return;
    }

    setAiStatus("generating");
    setAiError(null);

    try {
      const token = await getToken();
      if (!token) {
        setAiStatus("error");
        setAiError("Not authenticated. Please reload and try again.");
        return;
      }

      const body: any = {
        questionStem: stem,
        currentModelAnswer: textContent(q.modelAnswer),
        currentScoringGuidance: textContent(q.aiScoringGuidance),
        currentRubricCategories: q.rubricCategories || [],
        points: pts,
        revisionInstruction: revisionInstruction.trim(),
      };
      if (lessonContext?.courseContext) body.courseContext = lessonContext.courseContext;

      const res = await fetch("/api/ai/revise-rubric", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Server error ${res.status}`);
      }

      const data = await res.json();
      applyAiResult(data);
      setShowRevise(false);
      setRevisionInstruction("");
    } catch (err: any) {
      setAiStatus("error");
      setAiError(err.message || "Revision failed. Please try again.");
    }
  };

  const errors = validateQuestionClient(q, type, graded);
  const readinessWarns = saReadinessWarnings(q, type, graded);

  return (
    <div className="space-y-0 divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">

      {/* ===== ZONE 1: Student-Facing Question ===== */}
      <div className="p-4 space-y-3">
        <div className={zoneLabelCls}>
          <Eye className="w-3.5 h-3.5 text-blue-500" />
          Student-Facing Question
        </div>

        <div>
          <label className={labelCls}>Question Stem / Prompt <span className="text-red-500">*</span></label>
          <RichContentEditor
            value={q.stem ?? ""}
            onChange={(val) => patch({ stem: val })}
            mode="compact"
            placeholder="Enter the question students will see..."
            documentKey={`qstem-${q.id || "new"}`}
          />
        </div>

        {type === "sa" && (
          <div>
            <label className={labelCls}>Student Instructions (optional — visible to students)</label>
            <RichContentEditor
              value={q.studentInstructions ?? ""}
              onChange={(val) => patch({ studentInstructions: val })}
              mode="compact"
              placeholder="e.g. Respond in 3–5 complete sentences."
              documentKey={`qinst-${q.id || "new"}`}
            />
          </div>
        )}
      </div>

      {/* ===== ZONE 2: Answer Setup ===== */}
      <div className="p-4 space-y-3">
        <div className={zoneLabelCls}>
          {type === "mc" ? (
            <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Answer Choices</>
          ) : (
            <><Lock className="w-3.5 h-3.5 text-amber-500" /> Expected Answer (teacher-only)</>
          )}
        </div>

        {type === "sa" && (
          <div className="bg-slate-50 border border-slate-200 rounded p-2.5 space-y-1.5 text-xs text-slate-700">
            <span className="font-bold text-[10px] uppercase tracking-wider text-slate-600 block">AI Grading Status Dashboard (Teacher-Only Metadata)</span>
            <div className="flex flex-wrap gap-1.5 align-middle">
              {/* AI Rubric Ready vs Rubric total mismatch or Missing Rubric */}
              {rubric.length === 0 ? (
                <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <AlertCircle className="w-3 h-3 text-rose-500" /> Missing Rubric Categories
                </span>
              ) : rubricTotal === Number(q.points) ? (
                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" /> AI Rubric Ready ({rubricTotal}/{q.points} pts matched)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <AlertCircle className="w-3 h-3 text-amber-500" /> Rubric Points Mismatch ({rubricTotal} pts vs {Number(q.points) || 0} pts)
                </span>
              )}

              {/* Model Answer status */}
              {!textContent(q.modelAnswer).trim() ? (
                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <AlertCircle className="w-3 h-3 text-amber-500" /> Missing Ideal Model Answer
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Ideal Model Answer Set
                </span>
              )}

              {/* Scoring Guidance status */}
              {!textContent(q.aiScoringGuidance).trim() ? (
                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <AlertCircle className="w-3 h-3 text-amber-500" /> Missing AI Scoring Guidance
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" /> AI Scoring Guidance Configured
                </span>
              )}

              {/* AI generated status */}
              {aiDraftActive ? (
                <span className="inline-flex items-center gap-1 bg-violet-50 text-violet-700 border border-violet-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  <Wand2 className="w-3 h-3 text-violet-500" /> Drafted by AI (Editable)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px] font-medium">
                  Manual Setup
                </span>
              )}

              <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded px-1.5 py-0.5 text-[10px] font-medium">
                Teacher Review Recommended
              </span>
            </div>
            <div className="text-[10px] text-slate-500 italic mt-1 leading-snug">
              ℹ️ Model answers, scoring guidance, and rubrics are strictly <strong className="text-amber-800 font-semibold uppercase">teacher-only</strong> and secure; students are never shown these values.
            </div>
          </div>
        )}

        {type === "mc" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-slate-500">Click the radio button to mark the correct answer.</p>
              <button
                type="button"
                onClick={addChoice}
                className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-100 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Choice
              </button>
            </div>

            {choices.map((c, idx) => {
              const isCorrect = q.correctChoiceId === c.id;
              const isBlank = textContent(c.text).trim().length === 0;
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border transition ${isCorrect ? "border-emerald-300 bg-emerald-50/30" : isBlank ? "border-rose-200 bg-rose-50/20" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                    <input
                      type="radio"
                      name={`correct_${q.id}`}
                      checked={isCorrect}
                      onChange={() => patch({ correctChoiceId: c.id })}
                      title="Mark as correct answer"
                      className="shrink-0"
                    />
                    <span className={`text-xs font-bold w-5 text-center ${isCorrect ? "text-emerald-700" : "text-slate-400"}`}>
                      {CHOICE_LETTERS[idx] ?? idx + 1}
                    </span>
                    {isCorrect && <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wide">✓ Correct</span>}
                    {isBlank && <span className="text-[9px] font-bold text-rose-600 uppercase tracking-wide">Blank</span>}
                    <div className="ml-auto flex items-center gap-0.5">
                      <button type="button" onClick={() => moveChoice(idx, -1)} disabled={idx === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => moveChoice(idx, 1)} disabled={idx === choices.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => deleteChoice(c.id)} className="p-1 text-red-400 hover:text-red-600">
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Rich choice editor */}
                  <div className="px-3 py-2">
                    <RichContentEditor
                      value={c.text ?? ""}
                      onChange={(val) => updateChoiceContent(c.id, val)}
                      mode="compact"
                      allowMath={true}
                      allowChemistry={true}
                      placeholder={`Choice ${CHOICE_LETTERS[idx] ?? idx + 1} — supports bold, subscript, images, math…`}
                      documentKey={`choice-${c.id}`}
                    />
                  </div>
                </div>
              );
            })}

            {choices.length === 0 && (
              <div className="text-center py-4 text-slate-400 text-xs border border-dashed border-slate-300 rounded">
                No choices yet. Click "Add Choice" to create answer options.
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className={secretLabelCls}><Lock className="w-3 h-3" /> Model / Expected Answer (hidden from students)</label>
            <RichContentEditor
              value={q.modelAnswer ?? ""}
              onChange={(val) => { patch({ modelAnswer: val }); setAiDraftActive(false); }}
              mode="compact"
              placeholder="A strong, full-credit answer."
              documentKey={`qmodel-${q.id || "new"}`}
            />
          </div>
        )}
      </div>

      {/* ===== ZONE 3: Teacher-Only Grading Guidance ===== */}
      <div className="p-4 space-y-3 bg-amber-50/30">
        <div className={zoneLabelCls}>
          <Lock className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-amber-700">Teacher-Only Grading Guidance</span>
          <span className="text-[9px] font-normal text-amber-600 normal-case tracking-normal">(never shown to students)</span>
        </div>

        {type === "mc" && (
          <div>
            <label className={secretLabelCls}><Lock className="w-3 h-3" /> Explanation / Practice Feedback</label>
            <RichContentEditor
              value={q.explanation ?? ""}
              onChange={(val) => patch({ explanation: val })}
              mode="compact"
              placeholder="Why is the correct answer correct? Shown as practice feedback if enabled."
              documentKey={`qexp-${q.id || "new"}`}
            />
          </div>
        )}

        {type === "sa" && (
          <>
            {/* ---- AI Authoring Controls ---- */}
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Wand2 className="w-3.5 h-3.5 text-violet-600" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-violet-700">AI Rubric Authoring</span>
                <span className="text-[9px] text-violet-500 normal-case tracking-normal font-normal ml-1">— drafts only, you control the final version</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={aiStatus === "generating"}
                  onClick={generateRubric}
                  className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition"
                >
                  {aiStatus === "generating" && !showRevise ? (
                    <><RotateCcw className="w-3 h-3 animate-spin" /> Generating…</>
                  ) : (
                    <><Wand2 className="w-3 h-3" /> Generate ideal answer + rubric</>
                  )}
                </button>

                <button
                  type="button"
                  disabled={aiStatus === "generating"}
                  onClick={() => { setShowRevise((v) => !v); setAiError(null); }}
                  className="flex items-center gap-1 bg-white hover:bg-violet-50 disabled:opacity-50 border border-violet-300 text-violet-700 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition"
                >
                  <RotateCcw className="w-3 h-3" /> Revise current rubric
                </button>
              </div>

              {/* Revision input */}
              {showRevise && (
                <div className="space-y-1.5 mt-1">
                  <textarea
                    value={revisionInstruction}
                    onChange={(e) => setRevisionInstruction(e.target.value)}
                    placeholder='e.g. "Make it stricter", "AP Biology style", "Reduce to 4 points", "Add a misconception category"'
                    rows={2}
                    className="w-full bg-white border border-violet-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-violet-400 text-slate-800 resize-none"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={aiStatus === "generating" || !revisionInstruction.trim()}
                      onClick={reviseRubric}
                      className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition"
                    >
                      {aiStatus === "generating" && showRevise ? (
                        <><RotateCcw className="w-3 h-3 animate-spin" /> Applying…</>
                      ) : (
                        <>Apply revision</>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowRevise(false); setRevisionInstruction(""); setAiError(null); }}
                      className="flex items-center gap-1 border border-slate-200 text-slate-500 hover:text-slate-700 px-2 py-1 rounded text-[10px] transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* AI draft review banner */}
              {aiDraftActive && aiStatus !== "generating" && (
                <div className="flex items-start gap-2 bg-violet-100 border border-violet-300 rounded px-2.5 py-1.5 text-[10px] text-violet-800">
                  <Wand2 className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="flex-1">
                    <strong>AI draft loaded.</strong> Review and edit all fields below before saving.
                    Model answer and scoring guidance are teacher-only — students never see them.
                  </span>
                  <button
                    type="button"
                    onClick={() => setAiDraftActive(false)}
                    className="shrink-0 text-violet-500 hover:text-violet-700"
                    title="Dismiss"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* AI warnings */}
              {aiWarnings.length > 0 && aiStatus !== "generating" && (
                <div className="space-y-0.5">
                  {aiWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Error state */}
              {aiStatus === "error" && aiError && (
                <div className="flex items-start gap-1.5 bg-red-50 border border-red-200 rounded px-2.5 py-1.5 text-[10px] text-red-700">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {aiError}
                </div>
              )}
            </div>

            <div>
              <label className={secretLabelCls}><Lock className="w-3 h-3" /> AI Scoring Guidance</label>
              <RichContentEditor
                value={q.aiScoringGuidance ?? ""}
                onChange={(val) => { patch({ aiScoringGuidance: val }); setAiDraftActive(false); }}
                mode="compact"
                placeholder="Key points the AI grader should look for and how to weight them."
                documentKey={`qscoring-${q.id || "new"}`}
              />
            </div>

            {/* Rubric categories */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={secretLabelCls + " mb-0"}><Lock className="w-3 h-3" /> Rubric Categories</label>
                <button type="button" onClick={addRubric} className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-100 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Category
                </button>
              </div>
              <div className="space-y-3">
                {rubric.map((r) => (
                  <div key={r.id} className="border border-amber-200 rounded bg-white p-2.5 space-y-2">
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={textOf(r.name)}
                        onChange={(e) => updateRubric(r.id, { name: e.target.value })}
                        placeholder="Category name"
                        className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-slate-500">max</span>
                        <input
                          type="number"
                          min={0}
                          value={r.maxPoints ?? 0}
                          onChange={(e) => updateRubric(r.id, { maxPoints: Number(e.target.value) })}
                          className="w-16 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                        />
                        <span className="text-[10px] text-slate-400">pts</span>
                      </div>
                      <button type="button" onClick={() => deleteRubric(r.id)} className="p-1 text-red-400 hover:text-red-600">
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <RichContentEditor
                      value={r.description ?? ""}
                      onChange={(val) => updateRubric(r.id, { description: val })}
                      mode="compact"
                      placeholder="What earns credit in this category?"
                      documentKey={`qrub-${r.id}`}
                    />
                    <div className="grid grid-cols-1 gap-1">
                      <input type="text" value={textOf(r.fullCreditExample)} onChange={(e) => updateRubric(r.id, { fullCreditExample: e.target.value })} placeholder="Full-credit example (optional)" className={inputCls} />
                      <input type="text" value={textOf(r.partialCreditExample)} onChange={(e) => updateRubric(r.id, { partialCreditExample: e.target.value })} placeholder="Partial-credit example (optional)" className={inputCls} />
                      <input type="text" value={textOf(r.noCreditExample)} onChange={(e) => updateRubric(r.id, { noCreditExample: e.target.value })} placeholder="No-credit example (optional)" className={inputCls} />
                    </div>
                  </div>
                ))}
              </div>
              {graded && rubric.length > 0 && rubricTotal !== Number(q.points) && (
                <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Rubric total ({rubricTotal}) doesn't match point value ({Number(q.points) || 0}).
                </p>
              )}
            </div>

            <div>
              <label className={secretLabelCls}><Lock className="w-3 h-3" /> Teacher Grading Notes</label>
              <RichContentEditor
                value={q.teacherNotes ?? ""}
                onChange={(val) => patch({ teacherNotes: val })}
                mode="compact"
                placeholder="Private notes for graders — not sent to AI or students."
                documentKey={`qnotes-${q.id || "new"}`}
              />
            </div>
          </>
        )}
      </div>

      {/* ===== ZONE 4: Points + Validation ===== */}
      <div className="p-4 flex flex-wrap items-start gap-6">
        <div className="w-36">
          <label className={labelCls}>Points {graded ? "(graded)" : "(practice)"}</label>
          <input
            type="number"
            min={0}
            value={q.points ?? 0}
            onChange={(e) => patch({ points: Number(e.target.value) })}
            className={inputCls}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {errors.length > 0 ? (
            <div className="bg-red-50 border border-red-200 rounded p-2.5 text-[11px] text-red-700 space-y-0.5">
              {errors.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {e}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Question looks valid.
            </div>
          )}

          {readinessWarns.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-[11px] text-amber-700 space-y-0.5">
              {readinessWarns.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== ZONE 5: Student Preview ===== */}
      <div className="p-4 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5 hover:text-slate-900"
        >
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPreview ? "Hide" : "Show"} Student Preview
        </button>
        {showPreview && (
          <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-4 space-y-3">
            <p className="text-[9px] uppercase tracking-widest font-bold text-slate-400">What the student sees (no answer keys, no teacher fields)</p>

            <div className="text-sm text-slate-800">
              <RichContentRenderer content={q.stem ?? ""} />
            </div>

            {type === "sa" && q.studentInstructions && (
              <div className="text-xs text-slate-600 italic">
                <RichContentRenderer content={q.studentInstructions} />
              </div>
            )}

            {type === "mc" && (
              <div className="space-y-2">
                {choices.map((c, idx) => (
                  <div key={c.id} className="flex items-start gap-3 bg-white border border-slate-200 rounded p-2.5 cursor-pointer hover:border-slate-400 transition">
                    <span className="font-bold text-slate-500 text-xs shrink-0 mt-0.5">{CHOICE_LETTERS[idx] ?? idx + 1}.</span>
                    <div className="flex-1 text-sm text-slate-700">
                      <RichContentRenderer content={c.text ?? ""} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {type === "sa" && (
              <div className="text-[11px] text-slate-400 border border-dashed border-slate-300 rounded p-3">
                Short-answer response box
              </div>
            )}

            <p className="text-[10px] text-slate-400">Worth {Number(q.points) || 0} pt(s) · {graded ? "Graded" : "Practice"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

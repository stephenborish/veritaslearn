import { useState } from "react";
import { Plus, Trash, ArrowUp, ArrowDown, Eye, EyeOff, AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

type AnyQuestion = any;

function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

function textOf(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.html === "string") return v.html;
  return String(v);
}

/**
 * Client-side validation mirror of server/data/validation.ts. Returns a list of
 * human-readable errors (empty => valid). Used to block invalid saves in the builder.
 */
export function validateQuestionClient(q: AnyQuestion, type: "mc" | "sa", graded: boolean): string[] {
  const errors: string[] = [];
  if (!q || textOf(q.stem).trim().length === 0) {
    errors.push("Question stem/prompt is required.");
  }
  if (type === "mc") {
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const nonBlank = choices.filter((c: any) => textOf(c?.text).trim().length > 0);
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

const inputCls =
  "w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-800 text-xs";
const labelCls = "font-bold text-slate-700 block mb-1 text-xs";
const secretLabelCls = "font-bold text-amber-700 mb-1 text-xs flex items-center gap-1";

interface QuestionEditorProps {
  question: AnyQuestion;
  type: "mc" | "sa";
  graded: boolean;
  onChange: (q: AnyQuestion) => void;
}

export default function QuestionEditor({ question, type, graded, onChange }: QuestionEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const q = question || {};

  const patch = (partial: any) => onChange({ ...q, ...partial });

  // ---- MC choice helpers ----
  const choices: any[] = Array.isArray(q.choices) ? q.choices : [];
  const setChoices = (next: any[], correctChoiceId = q.correctChoiceId) =>
    patch({ choices: next, correctChoiceId });

  const addChoice = () => setChoices([...choices, { id: uid("choice"), text: "" }]);
  const updateChoiceText = (id: string, text: string) =>
    setChoices(choices.map((c) => (c.id === id ? { ...c, text } : c)));
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
  const addRubric = () =>
    setRubric([...rubric, { id: uid("rub"), name: "", maxPoints: 1, description: "" }]);
  const updateRubric = (id: string, partial: any) =>
    setRubric(rubric.map((r) => (r.id === id ? { ...r, ...partial } : r)));
  const deleteRubric = (id: string) => setRubric(rubric.filter((r) => r.id !== id));
  const rubricTotal = rubric.reduce((s, r) => s + (Number(r.maxPoints) || 0), 0);

  const errors = validateQuestionClient(q, type, graded);

  return (
    <div className="space-y-4 border border-slate-200 rounded-md p-4 bg-white">
      {/* Stem */}
      <div>
        <label className={labelCls}>Question Stem / Prompt</label>
        <RichContentEditor
          value={q.stem ?? ""}
          onChange={(val) => patch({ stem: val })}
          mode="compact"
          placeholder="Enter the question students will see..."
        />
      </div>

      {type === "mc" ? (
        <div className="space-y-3">
          {/* Choices + correct answer */}
          <div className="flex items-center justify-between">
            <label className={labelCls + " mb-0"}>Answer Choices (select the correct one)</label>
            <button
              type="button"
              onClick={addChoice}
              className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-100 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add Choice
            </button>
          </div>
          <div className="space-y-2">
            {choices.map((c, idx) => {
              const isCorrect = q.correctChoiceId === c.id;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
                    isCorrect ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`correct_${q.id}`}
                    checked={isCorrect}
                    onChange={() => patch({ correctChoiceId: c.id })}
                    title="Mark as correct answer"
                    className="shrink-0"
                  />
                  <span className="text-[10px] font-bold text-slate-400 w-4 text-center">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <input
                    type="text"
                    value={textOf(c.text)}
                    onChange={(e) => updateChoiceText(c.id, e.target.value)}
                    placeholder={`Choice ${String.fromCharCode(65 + idx)}`}
                    className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                  />
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
              );
            })}
          </div>

          {/* Explanation + points */}
          <div>
            <label className={secretLabelCls}><Lock className="w-3 h-3" /> Explanation / Practice Feedback (hidden from students on graded work)</label>
            <RichContentEditor
              value={q.explanation ?? ""}
              onChange={(val) => patch({ explanation: val })}
              mode="compact"
              placeholder="Why is the correct answer correct?"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Student Instructions (optional, shown to students)</label>
            <RichContentEditor
              value={q.studentInstructions ?? ""}
              onChange={(val) => patch({ studentInstructions: val })}
              mode="compact"
              placeholder="e.g. Respond in 3-5 sentences."
            />
          </div>

          <div>
            <label className={secretLabelCls}><Lock className="w-3 h-3" /> Model / Expected Answer (teacher-only)</label>
            <RichContentEditor value={q.modelAnswer ?? ""} onChange={(val) => patch({ modelAnswer: val })} mode="compact" placeholder="A strong, full-credit answer." />
          </div>

          <div>
            <label className={secretLabelCls}><Lock className="w-3 h-3" /> Answer Key / AI Scoring Guidance (teacher-only)</label>
            <RichContentEditor value={q.aiScoringGuidance ?? ""} onChange={(val) => patch({ aiScoringGuidance: val })} mode="compact" placeholder="Key points the AI grader should look for and how to weight them." />
          </div>

          {/* Rubric categories */}
          <div className="flex items-center justify-between">
            <label className={secretLabelCls + " mb-0"}><Lock className="w-3 h-3" /> Rubric Categories (teacher-only)</label>
            <button
              type="button"
              onClick={addRubric}
              className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-100 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add Category
            </button>
          </div>
          <div className="space-y-3">
            {rubric.map((r) => (
              <div key={r.id} className="border border-amber-200 rounded bg-amber-50/30 p-2.5 space-y-2">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={textOf(r.name)}
                    onChange={(e) => updateRubric(r.id, { name: e.target.value })}
                    placeholder="Category name"
                    className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500">max</span>
                    <input
                      type="number"
                      min={0}
                      value={r.maxPoints ?? 0}
                      onChange={(e) => updateRubric(r.id, { maxPoints: Number(e.target.value) })}
                      className="w-16 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                    />
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
            <p className="text-[11px] text-amber-700 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> Rubric total ({rubricTotal}) does not match the point value ({Number(q.points) || 0}).
            </p>
          )}

          <div>
            <label className={secretLabelCls}><Lock className="w-3 h-3" /> Teacher Grading Notes (teacher-only)</label>
            <RichContentEditor value={q.teacherNotes ?? ""} onChange={(val) => patch({ teacherNotes: val })} mode="compact" placeholder="Private notes for graders." />
          </div>
        </div>
      )}

      {/* Points */}
      <div className="w-40">
        <label className={labelCls}>Points {graded ? "(graded)" : "(practice)"}</label>
        <input
          type="number"
          min={0}
          value={q.points ?? 0}
          onChange={(e) => patch({ points: Number(e.target.value) })}
          className={inputCls}
        />
      </div>

      {/* Validation summary */}
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
          <CheckCircle2 className="w-3.5 h-3.5" /> Question is valid.
        </div>
      )}

      {/* Student preview */}
      <div className="border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5 hover:text-slate-900"
        >
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPreview ? "Hide" : "Show"} Student Preview
        </button>
        {showPreview && (
          <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
            <p className="text-[9px] uppercase tracking-widest font-bold text-slate-400">What the student sees (no answer keys)</p>
            <div className="text-sm text-slate-800 font-serif">
              <RichContentRenderer content={q.stem ?? ""} />
            </div>
            {type === "sa" && q.studentInstructions && (
              <div className="text-xs text-slate-600 italic font-serif">
                <RichContentRenderer content={q.studentInstructions} />
              </div>
            )}
            {type === "mc" && (
              <ul className="space-y-1">
                {choices.map((c, idx) => (
                  <li key={c.id} className="text-xs text-slate-700 flex items-start gap-2">
                    <span className="font-bold text-slate-400">{String.fromCharCode(65 + idx)}.</span>
                    <span className="flex-1"><RichContentRenderer content={c.text ?? ""} /></span>
                  </li>
                ))}
              </ul>
            )}
            {type === "sa" && (
              <div className="text-[11px] text-slate-400 border border-dashed border-slate-300 rounded p-2">Short-answer response box</div>
            )}
            <p className="text-[10px] text-slate-400">Worth {Number(q.points) || 0} pt(s) · {graded ? "Graded" : "Practice"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

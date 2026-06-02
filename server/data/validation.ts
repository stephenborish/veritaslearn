/**
 * Server-side (trusted) validation of teacher-authored question content.
 * The client validates first for UX, but the server re-validates so invalid
 * graded questions can never be persisted. Throws AppErrorException on failure.
 */
import { appError } from "./errors";

/** True if a stem/prompt/choice has real content (handles plain string or RichContent object). */
function hasContent(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") {
    // RichContent format: check plainText stripped of whitespace or html stripped of tags
    if (v.format === "veritas-rich-content") {
      const fromPlain = typeof v.plainText === "string" ? v.plainText.trim() : "";
      const fromHtml = typeof v.html === "string" ? v.html.replace(/<[^>]*>/g, "").trim() : "";
      return fromPlain.length > 0 || fromHtml.length > 0;
    }
    if (typeof v.text === "string") return v.text.trim().length > 0;
    if (Array.isArray(v.blocks)) return v.blocks.length > 0;
    return Object.keys(v).length > 0;
  }
  return false;
}

/** Validate one question definition. `graded` => enforce the strict rules. */
export function validateQuestion(q: any, graded: boolean, label: string): void {
  if (!q || typeof q !== "object") {
    throw appError("INVALID_QUESTION", `${label}: question is missing.`);
  }
  if (!hasContent(q.stem)) {
    throw appError("INVALID_QUESTION", `${label}: question stem/prompt is required.`);
  }

  const type = q.type || (Array.isArray(q.choices) && q.choices.length ? "mc" : "sa");

  if (type === "mc") {
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const nonBlank = choices.filter((c: any) => hasContent(c && typeof c === "object" ? c.text : c));
    if (nonBlank.length < 2) {
      throw appError("INVALID_QUESTION", `${label}: multiple-choice questions need at least two non-blank choices.`);
    }
    if (nonBlank.length !== choices.length) {
      throw appError("INVALID_QUESTION", `${label}: blank answer choices are not allowed.`);
    }
    if (graded) {
      const hasCorrect =
        (q.correctChoiceId && choices.some((c: any) => c && c.id === q.correctChoiceId)) ||
        (typeof q.correctAnswerIndex === "number" && choices[q.correctAnswerIndex]);
      if (!hasCorrect) {
        throw appError("INVALID_QUESTION", `${label}: exactly one correct answer must be selected.`);
      }
    }
  } else {
    // Short answer
    if (graded) {
      const rubric = Array.isArray(q.rubricCategories) ? q.rubricCategories : [];
      if (rubric.length < 1) {
        throw appError(
          "INVALID_QUESTION",
          `${label}: AI/rubric-graded short-answer questions require at least one rubric category.`
        );
      }
      for (const cat of rubric) {
        if (!(Number(cat.maxPoints) > 0)) {
          throw appError("INVALID_QUESTION", `${label}: each rubric category must have positive max points.`);
        }
      }
    }
  }

  if (graded && !(Number(q.points) > 0)) {
    throw appError("INVALID_QUESTION", `${label}: graded questions must have a positive point value.`);
  }
}

/** Validate an array of lesson blocks (single questions + checkpoint questions). */
export function validateLessonBlocks(blocks: any[]): void {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b: any, i: number) => {
    if (!b || typeof b !== "object") return;
    const blockLabel = b.title ? `Block "${b.title}"` : `Block ${i + 1}`;

    if (b.type === "question") {
      const graded = !b.isPractice;
      if (b.singleQuestion) {
        validateQuestion(b.singleQuestion, graded, blockLabel);
      } else if (b.questionPool && Array.isArray(b.questionPool.questions)) {
        b.questionPool.questions.forEach((q: any, qi: number) =>
          validateQuestion(q, graded, `${blockLabel} pool Q${qi + 1}`)
        );
      }
    }

    if (b.type === "video" && Array.isArray(b.videoCheckpoints)) {
      b.videoCheckpoints.forEach((cp: any, ci: number) => {
        const graded = !cp.isPractice;
        const cpLabel = `${blockLabel} checkpoint ${ci + 1}`;
        (Array.isArray(cp.questions) ? cp.questions : []).forEach((q: any, qi: number) =>
          validateQuestion(q, graded, `${cpLabel} Q${qi + 1}`)
        );
      });
    }
  });
}
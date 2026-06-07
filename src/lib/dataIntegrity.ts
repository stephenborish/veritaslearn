import { getPlainText } from "../components/RichContent/RichContentRenderer";

/**
 * Safely extracts human-readable text from any value, resolving RichContent object
 * wrappers or providing a friendly fallback without showing raw objects like [object Object].
 */
export function safeText(value: any, fallback: string = "—"): string {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (typeof value === "object") {
    const pt = getPlainText(value);
    if (!pt || pt === "[object Object]") {
      return fallback;
    }
    return pt;
  }
  return String(value);
}

/**
 * Formats score denominators defensively to prevent divisions by zero, NaN, or Infinity,
 * with standard clear fallback if point values are missing.
 */
export function safeScore(score: any, maxPoints: any, fallback: string = "—"): string {
  if (score === null || score === undefined || isNaN(Number(score))) {
    return fallback;
  }
  if (maxPoints === null || maxPoints === undefined || isNaN(Number(maxPoints)) || Number(maxPoints) <= 0) {
    return `${Number(score)} (Point value unavailable)`;
  }
  const s = Number(score);
  const p = Number(maxPoints);
  if (!isFinite(s) || !isFinite(p)) {
    return "Score unavailable";
  }
  return `${s}/${p}`;
}

/**
 * Format checkpoint labels defensively using mathematical validation to prevent
 * "NaN:NaN" displays for missing or skewed timestamps.
 */
export function safeCheckpointLabel(checkpoint: any): string {
  if (!checkpoint) return "Checkpoint";
  const cpTime = checkpoint.timestamp ?? checkpoint.timeSeconds;
  if (cpTime === undefined || cpTime === null || isNaN(Number(cpTime))) {
    return "Checkpoint";
  }
  const secs = Number(cpTime);
  if (secs < 0 || !isFinite(secs)) {
    return "Checkpoint";
  }
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  return `Check at ${String(mins).padStart(2, '0')}:${String(remainingSecs).padStart(2, '0')}`;
}

/**
 * Resolves multiple choice answers to their original readable option strings using 
 * the immutable question/choice identifier lookup.
 */
export function resolveChoiceText(choiceId: any, question: any): string {
  if (!choiceId) return "Selected choice unavailable";
  const searchId = String(choiceId);
  if (question && Array.isArray(question.choices)) {
    const found = question.choices.find((c: any) => String(c.id) === searchId);
    if (found) {
      return safeText(found.text, "Selected choice unavailable");
    }
  }
  return "Selected choice unavailable";
}

/**
 * Returns student step progress status dynamically by alignment check
 */
export function deriveStudentStepStatus(attempt: any, step: any, hasResponse: boolean): string {
  if (!attempt) return "not_started";
  if (hasResponse) return "submitted";
  if (attempt.status === "completed") return "missing";
  return "in_progress";
}

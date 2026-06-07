/**
 * builderWorkflow.ts — framework-free logic for the teacher lesson builder.
 *
 * This module deliberately contains NO React / DOM / lucide imports so it can be
 * unit-tested directly (see scripts/verify-builder.ts) and reused across the
 * builder UI. It encodes three things the teacher experience depends on:
 *
 *   1. The visible workflow (Setup → Content & Questions → Preview → Publish → Assign).
 *   2. The "next best action" — the single most useful thing to do right now.
 *   3. Practice vs Assessment language, kept consistent everywhere.
 *
 * Teacher-facing language rule: never surface internal field names (isPractice,
 * gradingMode, payload, etc.). Use "Practice" and "Assessment".
 */

export type ReadinessSeverity = "blocker" | "attention" | "optional";
export type ReadinessTarget = "setup" | number;

export interface ReadinessItem {
  message: string;
  target: ReadinessTarget;
  /** Defaults to "blocker" when omitted by older call sites. */
  severity?: ReadinessSeverity;
}

/** The teacher-facing label for a question's mode. Never expose `isPractice`. */
export function modeLabel(isPractice: boolean | undefined | null): "Practice" | "Assessment" {
  return isPractice ? "Practice" : "Assessment";
}

/** One-line description of what students experience for each mode. */
export function modeDescription(isPractice: boolean | undefined | null): string {
  return isPractice
    ? "Students get feedback right away. Recorded as practice — not part of the grade."
    : "Students submit for review. Scores and answers stay hidden until you release them.";
}

export type WorkflowStageKey = "setup" | "content" | "preview" | "publish" | "assign";

export interface WorkflowStage {
  key: WorkflowStageKey;
  label: string;
  /** What this stage is for, in plain language. */
  purpose: string;
}

/** The five visible stages, in order. The builder guides toward — never forces — this path. */
export const WORKFLOW_STAGES: WorkflowStage[] = [
  { key: "setup", label: "Setup", purpose: "Name the lesson and set how it’s delivered." },
  { key: "content", label: "Content & Questions", purpose: "Add videos, readings, and questions students will work through." },
  { key: "preview", label: "Preview", purpose: "See exactly what students will experience." },
  { key: "publish", label: "Publish", purpose: "Make the lesson ready to assign." },
  { key: "assign", label: "Assign", purpose: "Give a course access with open and due dates." },
];

export type NextActionTone = "build" | "ready" | "done";
export type NextActionTarget =
  | ReadinessTarget
  | "publish"
  | "assign"
  | "preview"
  | "progress";

export interface NextActionInput {
  hasTitle: boolean;
  blockCount: number;
  /** Number of must-fix issues that block publishing. */
  blockerCount: number;
  /** Where the first blocker lives, so we can jump there. */
  firstBlockerTarget?: ReadinessTarget;
  isPublished: boolean;
  isAssigned: boolean;
  /** Lesson has never been saved (id === "new"). */
  isNew: boolean;
}

export interface NextAction {
  /** A calm, imperative sentence: "Add your first content block." */
  message: string;
  /** Short button label: "Add block". */
  cta: string;
  /** Where the action takes the teacher. */
  target: NextActionTarget;
  tone: NextActionTone;
}

/**
 * The single most useful next step, given the current state of the lesson.
 * The order here IS the product opinion: get a title, get content, clear
 * blockers, preview/publish, then assign, then watch progress.
 */
export function computeNextBestAction(i: NextActionInput): NextAction {
  if (!i.hasTitle) {
    return { message: "Add a lesson title.", cta: "Add title", target: "setup", tone: "build" };
  }
  if (i.blockCount === 0) {
    return { message: "Add your first content block.", cta: "Add content", target: "setup", tone: "build" };
  }
  if (i.blockerCount > 0) {
    const n = i.blockerCount;
    return {
      message: `Finish ${n} item${n === 1 ? "" : "s"} that need${n === 1 ? "s" : ""} attention.`,
      cta: "Fix next",
      target: i.firstBlockerTarget ?? "setup",
      tone: "build",
    };
  }
  if (!i.isPublished) {
    return { message: "Preview or publish this lesson.", cta: "Publish", target: "publish", tone: "ready" };
  }
  if (!i.isAssigned) {
    return { message: "Assign this lesson to a course.", cta: "Assign", target: "assign", tone: "ready" };
  }
  return { message: "Assigned. View student progress when you’re ready.", cta: "View progress", target: "progress", tone: "done" };
}

/**
 * A short, friendly status phrase for the command header. Mirrors the
 * teacher-facing status vocabulary used throughout the builder.
 */
export type LessonStatus =
  | "Draft"
  | "Needs attention"
  | "Ready to publish"
  | "Published, not assigned"
  | "Assigned";

export interface LessonStatusInput {
  isNew: boolean;
  isPublished: boolean;
  isAssigned: boolean;
  blockerCount: number;
  hasTitle: boolean;
  blockCount: number;
}

export function lessonStatusLabel(i: LessonStatusInput): LessonStatus {
  if (i.isPublished && i.isAssigned) return "Assigned";
  if (i.isPublished && !i.isAssigned) return "Published, not assigned";
  if (i.blockerCount > 0) return "Needs attention";
  if (i.hasTitle && i.blockCount > 0 && i.blockerCount === 0) return "Ready to publish";
  return "Draft";
}

export interface EstimatedTimeResult {
  minutes: number;
  isIncomplete: boolean;
}

export function calculateEstimatedLessonMinutes(blocks: any[]): EstimatedTimeResult {
  let totalMinutes = 0;
  let isIncomplete = false;

  if (!Array.isArray(blocks)) {
    return { minutes: 0, isIncomplete: false };
  }

  for (const block of blocks) {
    if (!block) continue;

    if (block.type === "video") {
      if (block.duration && Number(block.duration) > 0) {
        totalMinutes += Number(block.duration) / 60;
      } else {
        isIncomplete = true;
      }

      if (Array.isArray(block.videoCheckpoints)) {
        for (const cp of block.videoCheckpoints) {
          if (cp) {
            let cpCount = 0;
            if (Array.isArray(cp.questions)) {
              cpCount = cp.questions.length;
            } else if (cp.question) {
              cpCount = 1;
            } else {
              cpCount = 1;
            }
            totalMinutes += cpCount * 1.5;
          }
        }
      }
    } else if (block.type === "question") {
      const qType = block.questionType || (block.singleQuestion?.type) || "mc";
      if (qType === "mc") {
        totalMinutes += 1.5;
      } else if (qType === "sa") {
        totalMinutes += 2.5;
      } else {
        totalMinutes += 1.5;
      }
    } else if (block.type === "reading") {
      totalMinutes += 1.0;
    }
  }

  return { minutes: totalMinutes, isIncomplete };
}

export function formatEstimatedTime(res: EstimatedTimeResult): string {
  const rounded = Math.ceil(res.minutes);
  if (res.isIncomplete) {
    if (rounded > 0) {
      const floorM = Math.floor(res.minutes);
      const ceilM = Math.ceil(res.minutes);
      const rangeStr = floorM === ceilM ? `${floorM}` : `${floorM}–${ceilM}`;
      return `About ${rangeStr} min (some video lengths unknown)`;
    }
    return "Incomplete (video duration unknown)";
  }
  const val = res.minutes;
  const floorM = Math.floor(val);
  const ceilM = Math.ceil(val);
  if (floorM === ceilM) {
    return `About ${floorM} min`;
  }
  return `About ${floorM}–${ceilM} min`;
}


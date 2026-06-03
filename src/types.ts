/**
 * Shared Type Definitions for VERITAS Learn
 */

import { RichContent } from "./components/RichContent/types";

export type UserRole = 'teacher' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface LessonSettings {
  restrictSeeking: boolean;
  requireFullscreen: boolean;
  allowRetakes: boolean;
  randomizeChoices: boolean;
  immediateFeedback: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  description: string | RichContent;
  courseId: string;
  estimatedMinutes: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt?: string;
  settings: LessonSettings;
  /** ID of the most recently created LessonVersion for this lesson. */
  currentPublishedVersionId?: string;
  /** Total number of published versions created for this lesson. */
  publishedVersionCount?: number;
}

export interface LessonDraftPayload {
  title: string;
  description: string | RichContent;
  estimatedMinutes: number;
  isPublished: boolean;
  settings: LessonSettings;
  blocks: LessonBlock[];
}

export interface LessonDraft {
  id: string;
  lessonId: string;
  teacherId: string;
  draftPayload: LessonDraftPayload;
  baseLessonUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "restored" | "discarded" | "published";
}

/**
 * Immutable snapshot of a lesson at publish time.
 * Once created, a LessonVersion must NOT be mutated.
 * Assignments and attempts reference a specific versionId; grading resolves
 * questions from the snapshot, not from the mutable working draft in db.blocks.
 */
export interface LessonVersion {
  id: string;
  lessonId: string;
  versionNumber: number;
  title: string;
  description: string | RichContent;
  /**
   * Deep copy of all lesson blocks at publish time.
   * Includes teacher-only data (correctChoiceId, rubricCategories, modelAnswer, etc.)
   * needed for grading. Student-facing APIs MUST sanitize before delivery.
   */
  blocksSnapshot: LessonBlock[];
  settings: LessonSettings;
  createdBy: string;
  createdAt: string;
  /** lesson.updatedAt at the time the snapshot was taken */
  sourceLessonUpdatedAt: string;
  publishNotes?: string;
  status: 'published' | 'archived';
  /** Simple hash of title+description+blocks for idempotent publish detection. */
  checksum?: string;
}

export type BlockType = 'video' | 'reading' | 'question';

/** A single multiple-choice option. Stable `id` lets grading survive choice scrambling. */
export interface ChoiceDefinition {
  id: string;
  text: string | RichContent;
}

/** A teacher-authored rubric category used for short-answer (AI/manual) grading. */
export interface RubricCategory {
  id: string;
  name: string;
  maxPoints: number;
  description: string | RichContent;
  fullCreditExample?: string | RichContent;
  partialCreditExample?: string | RichContent;
  noCreditExample?: string | RichContent;
}

export interface QuestionDefinition {
  id: string;
  type?: 'mc' | 'sa';
  stem: string | RichContent;
  studentInstructions?: string | RichContent; // visible to student
  // --- Multiple choice ---
  choices?: ChoiceDefinition[]; // stable-id options
  correctChoiceId?: string; // SECRET — never sent to students for graded work
  correctAnswerIndex?: number; // DEPRECATED legacy index; retained only for migration. SECRET.
  explanation?: string | RichContent; // SECRET for graded; practice feedback delivered via submit response
  // --- Short answer ---
  rubricCategories?: RubricCategory[]; // SECRET descriptions for graded work
  modelAnswer?: string | RichContent; // SECRET
  answerKey?: string | RichContent; // SECRET
  aiScoringGuidance?: string | RichContent; // SECRET
  teacherNotes?: string | RichContent; // SECRET (teacher-only grading notes)
  // --- Common ---
  points: number;
}

export interface VideoCheckpoint {
  id: string;
  timestamp: number; // in seconds
  title: string;
  isRequired: boolean;
  pauseVideo?: boolean; // pause the video when this checkpoint opens
  questionType: 'mc' | 'sa';
  isPractice: boolean;
  questions: QuestionDefinition[];
  numToSelect: number;
}

export interface LessonBlock {
  id: string;
  lessonId: string;
  order: number;
  type: BlockType;
  title: string;
  // Video block specific properties
  videoUrl?: string; // Standard streaming link or clean URL
  thumbnailUrl?: string; // Opt-in generated course preview thumbnail
  storagePath?: string; // Firebase Storage reference path for the video asset
  duration?: number; // Video duration in seconds
  videoCheckpoints?: VideoCheckpoint[];
  // Reading block specific properties
  content?: string | RichContent; // Plain text or Markdown content
  // Question block specific properties
  questionType?: 'mc' | 'sa';
  isPractice?: boolean;
  questionPool?: {
    id: string;
    description: string;
    questions: QuestionDefinition[];
    numToSelect: number;
  };
  singleQuestion?: QuestionDefinition;
}

export interface LessonAttempt {
  id: string;
  lessonId: string;
  /** The lesson assignment this attempt is tied to. Absent for legacy attempts created before assignment-awareness. */
  assignmentId?: string | null;
  /**
   * The LessonVersion snapshot this attempt is bound to. Grading resolves questions
   * from this version, not from the mutable working draft. Absent for legacy attempts.
   */
  lessonVersionId?: string | null;
  studentId: string;
  seed: number;
  startedAt: string;
  completedAt?: string;
  status: 'started' | 'completed';
  currentBlockIndex: number;
  furthestVideoTimestamps: { [blockId: string]: number }; // blockId -> furthest validated watch timestamp
  videoPlaybackRates?: { [blockId: string]: number }; // blockId -> current/latest video playback rate
  activeTimeSpent: number; // in seconds
  inactiveTimeSpent: number; // in seconds
  lockState?: 'locked_awaiting_teacher' | null; // teacher-approval gate state
  lockedAt?: string | null; // ISO timestamp when lock was set
  lastActiveAt?: string; // ISO timestamp of last activity
  securityReviewRequired?: boolean; // flagged for teacher review without full lockout
  securityReviewReason?: string; // human-readable reason for the review flag
  securityReviewAt?: string; // ISO timestamp when review flag was set
  /** Server-persisted SA draft responses keyed by questionId. */
  draftResponses?: { [questionId: string]: string };
  blockTimeSpent?: { [blockId: string]: number }; // blockId -> cumulative active seconds
  attemptMode?: "real" | "preview" | "test";
  isPreviewAttempt?: boolean;
  previewOwnerTeacherId?: string;
  excludeFromAnalytics?: boolean;
  /** Teacher-set override for the gradebook status of this attempt. Applied on top of the calculated status. */
  gradebookStatusOverride?: 'excused' | 'missing' | 'pending';
}

export interface QuestionAssignment {
  id: string;
  attemptId: string;
  blockId: string;
  checkpointId?: string; // undefined if single question block
  questionId: string;
  selectedQuestion: QuestionDefinition; // Sanitized copy (no answer keys for graded)
  scrambledChoices?: ChoiceDefinition[]; // delivered order (ids stable for grading)
  scrambledToOriginalIndexMap?: number[]; // DEPRECATED — id-based grading no longer needs this
}

export interface StudentResponse {
  id: string;
  attemptId: string;
  studentId: string;
  blockId: string;
  checkpointId?: string; // undefined if single question block
  questionId: string;
  type: 'mc' | 'sa';
  responseValue: string | number; // choice id for MC, text for SA
  responseText?: string; // denormalized chosen choice text (MC) for teacher review display
  isCorrect?: boolean; // MC auto-graded
  /** Final registered score for this response. `pointsEarned` mirrors this value for gradebook display. */
  score: number;
  activeTimeSpent: number; // seconds spent focusing on this question
  gradingMode?: 'practice' | 'assessment';
  feedbackVisibility?: 'immediate' | 'after_submit' | 'hidden' | 'student_visible' | 'teacher_only';
  gradebookCategory?: 'practice' | 'assessment';
  maxPoints?: number;
  /** Same value as `score`; kept as a display alias for gradebook UI components. */
  pointsEarned?: number;
  aiFeedbackReleasedAt?: string | null;
  teacherReviewedAt?: string | null;
  teacherOverrideScore?: number | null;
  teacherOverrideFeedback?: string | null;
  aiGrading?: {
    score: number;
    /** Student-facing explanation — safe to display. Never contains model answer or scoring guidance. */
    feedback?: string;
    /** Teacher-facing justification — must not be shown to students. */
    rationale: string;
    confidence: number;
    status: 'pending' | 'success' | 'failed' | 'needs_review';
    rubricBreakdown: { [category: string]: { score: number; maxScore?: number; feedback: string } };
    misconceptions?: string[];
    /** Teacher-only flag — must not be shown to students. */
    needsTeacherReview?: boolean;
    /** Teacher-only notes — must not be shown to students. */
    teacherNotes?: string;
    gradedAt: string;
  };
  teacherOverride?: {
    score: number;
    notes: string;
    gradedAt: string;
  };
  /** Set by server after AI grading; true when the response is gibberish, a keyboard-smash, etc. Teacher-only field. */
  isLowEffort?: boolean;
  /** Human-readable reason for the low-effort flag. Teacher-only. */
  lowEffortReason?: string;
}

/** Durable, structured record of an AI grading pass (stored separately from the response). */
export interface AIGradingRecord {
  id: string;
  responseId: string;
  provider: string;
  model: string;
  promptVersion: string;
  rubricSnapshot: RubricCategory[];
  guidanceSnapshot?: {
    modelAnswer?: string | RichContent;
    answerKey?: string | RichContent;
    aiScoringGuidance?: string | RichContent;
  };
  inputHash: string;
  rawOutput?: unknown;
  parsedScore: number;
  confidence: number;
  /** Teacher-facing justification. Never shown to students. */
  rationale: string;
  /** Student-facing explanation. Safe to display. */
  feedback?: string;
  rubricBreakdown: { [category: string]: { score: number; maxScore?: number; feedback: string } };
  misconceptions?: string[];
  /** True when the AI flags this for teacher review. Teacher-only. */
  needsTeacherReview?: boolean;
  /** Internal grading notes for teacher review. Never shown to students. */
  teacherNotes?: string;
  status: 'pending' | 'success' | 'failed' | 'needs_review';
  errorMessage?: string;
  gradedAt?: string;
}

export interface SecuritySignal {
  id: string;
  attemptId: string;
  studentId: string;
  timestamp: string;
  eventType:
    | 'copy_blocked'
    | 'paste_blocked'
    | 'blur_focus_lost'
    | 'visibility_hidden'
    | 'fullscreen_exited'
    | 'seek_attempt_blocked'
    | 'rapid_navigation'
    | 'context_menu_blocked'
    | 'checkpoint_triggered';
  severity: 'low' | 'medium' | 'high';
  blockId?: string;
  videoTimestamp?: number;
  metadata?: any;
}

export interface Course {
  id: string;
  /** Display name of the course, e.g. "AP Biology" */
  name: string;
  teacherId: string;
  /**
   * Optional array of additional teacher user IDs who can manage this course.
   * teacherCanManageCourse() checks both teacherId (primary) and teacherIds (additional).
   */
  teacherIds?: string[];
  /** Legacy freeform code field. New records use joinCode instead. */
  code?: string;
  /** Optional section/period label, e.g. "Period 3" */
  sectionName?: string;
  /** e.g. "2025-2026" */
  schoolYear?: string;
  status: 'active' | 'archived';
  /** Short join code students type to enroll, e.g. "APBIO-4M8X" */
  joinCode: string;
  joinCodeEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Enrollment {
  id: string;
  courseId: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  status: 'active' | 'removed';
  enrolledAt: string;
  removedAt?: string;
  removedBy?: string;
}

/** Learning Conditions policy — controls structure, monitoring, and review sensitivity for an assignment. */
export interface IntegrityPolicy {
  /** Teacher-visible preset label */
  preset: 'open' | 'guided' | 'focused' | 'verified' | 'custom';
  studentFlexibility: 'open' | 'guided' | 'structured' | 'locked_sequence';
  focusSupport: 'off' | 'quiet' | 'guided' | 'focused' | 'locked';
  responseControls: 'open' | 'recorded' | 'guarded' | 'restricted' | 'strict';
  videoControls: 'open' | 'progress_aware' | 'checkpointed' | 'restricted' | 'verified';
  reviewSensitivity: 'low' | 'balanced' | 'elevated' | 'high';
  // Compiled enforcement booleans (derived from dials above)
  allowResume: boolean;
  allowBackNavigation: boolean;
  requireFullscreen: boolean;
  restrictSeeking: boolean;
  blockPaste: boolean;
  logPaste: boolean;
  blockCopy: boolean;
  blockContextMenu: boolean;
  watermarkVideo: boolean;
  requireCheckpoints: boolean;
  // Numeric thresholds
  focusGraceSeconds: number;
  reviewThreshold: number;
  lockThreshold: number;
}

export interface Assignment {
  id: string;
  lessonId: string;
  /** ID of the LessonVersion snapshot this assignment references. Immutable after creation. */
  lessonVersionId?: string;
  courseId: string;
  /** ID of the teacher who created this assignment. */
  teacherId?: string;
  /** Deprecated freeform section label; new records should use the course's sectionName */
  section?: string;
  opensAt: string;
  dueAt: string;
  closesAt: string;
  createdAt: string;
  updatedAt?: string;
  /** Learning Conditions policy for this assignment */
  integrityPolicy?: IntegrityPolicy;
  // Dynamic joins loaded for frontend display convenience
  lessonTitle?: string;
  lessonDescription?: string | any;
  lessonEstimatedMinutes?: number;
  lessonSettings?: any;
  lessonIsPublished?: boolean;
  courseTitle?: string;
  sectionName?: string;
  // Student-facing access metadata (server-computed for student role)
  accessState?: 'upcoming' | 'open' | 'past_due' | 'closed' | 'in_progress' | 'completed' | 'needs_review' | 'locked';
  canBegin?: boolean;
  canResume?: boolean;
  canReview?: boolean;
  primaryAction?: 'begin' | 'resume' | 'review' | 'none';
  reason?: string;
  attemptId?: string;
  attemptStatus?: string;
  progress?: number;
  lastActiveAt?: string;
  completedAt?: string;
  securityReviewRequired?: boolean;
}

export interface GradebookResponseEntry {
  id: string;
  studentId: string;
  assignmentId?: string;
  courseId?: string;
  lessonId?: string;
  lessonVersionId?: string;
  attemptId?: string;
  responseId?: string;
  blockId?: string;
  checkpointId?: string;
  questionId?: string;
  category?: 'practice' | 'assessment';
  score?: number;
  maxScore?: number;
  /** AI-produced or system-computed feedback (may be teacher-facing or student-facing depending on category). */
  feedback?: string;
  /** Safe student-facing feedback — only exposed after release. */
  studentFacingFeedback?: string;
  /** Teacher-only notes — never shown to students. */
  teacherOnlyNotes?: string;
  /** Original AI score before teacher override (preserved for audit). */
  originalAiScore?: number | null;
  feedbackVisibleToStudent?: boolean;
  feedbackReleasedAt?: string | null;
  feedbackReleasedBy?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  source?: 'multiple_choice' | 'ai_short_answer' | 'teacher_override' | 'manual';
  status:
    | 'pending_ai'
    | 'auto_scored'
    | 'ai_scored'
    | 'needs_teacher_review'
    | 'teacher_reviewed'
    | 'teacher_overridden'
    | 'feedback_released'
    | 'missing'
    | 'excused'
    | 'error';
  createdAt?: string;
  updatedAt?: string;
}

export interface GradebookEntry {
  id: string;
  studentId: string;
  /** Canonical key field: one entry per student per assignment. */
  assignmentId?: string;
  courseId?: string;
  lessonId?: string;
  lessonVersionId?: string;
  attemptId?: string;

  /**
   * Assignment-centered lifecycle status.
   * Legacy values ('needs_grading', 'graded', 'submitted') are accepted for
   * backward compatibility but new writes should use the canonical list.
   */
  status:
    | 'not_started'
    | 'in_progress'
    | 'submitted'
    | 'completed'
    | 'pending_ai'
    | 'needs_teacher_review'
    | 'reviewed'
    | 'feedback_released'
    | 'missing'
    | 'excused'
    | 'late'
    | 'extended'
    | 'reopened'
    | 'error'
    // legacy statuses — keep for backward compat
    | 'needs_grading'
    | 'graded';

  // Scores — assessment only (practice is summarised in practiceSummary)
  rawScore?: number;
  finalScore?: number;
  maxPoints?: number;
  percent?: number;
  score?: number | null;
  maxScore?: number;
  assessmentScore?: number | null;
  assessmentMaxScore?: number;
  practiceScore?: number | null;
  practiceMaxScore?: number;
  practiceSummary?: Record<string, unknown>;
  assessmentSummary?: Record<string, unknown>;

  // Timestamps / attribution for the teacher-review lifecycle
  submittedAt?: string | null;
  completedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  feedbackReleasedAt?: string | null;
  feedbackReleasedBy?: string | null;

  // Per-student lifecycle overrides (set by teacher, not by attempt flow)
  extendedUntil?: string | null;
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  excusedAt?: string | null;
  excusedBy?: string | null;
  missingMarkedAt?: string | null;
  missingMarkedBy?: string | null;

  aiPendingCount?: number;
  teacherReviewRequired?: boolean;
  lastCalculatedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

export type AssignmentLifecycleStatus =
  | 'not_open'
  | 'open'
  | 'due_passed'
  | 'closed'
  | 'extended'
  | 'reopened'
  | 'unavailable';

export type CompletionMissingCode =
  | 'video_not_finished'
  | 'checkpoint_unanswered'
  | 'question_unsubmitted'
  | 'assignment_not_open'
  | 'assignment_closed'
  | 'enrollment_inactive'
  | 'invalid_attempt'
  | 'version_mismatch'
  | 'unknown';

export interface CompletionRequirementMissing {
  code: CompletionMissingCode;
  blockId?: string;
  checkpointId?: string;
  questionId?: string;
  message: string;
}

export interface CompletionValidationResult {
  canComplete: boolean;
  missing: CompletionRequirementMissing[];
  assessmentScore?: number;
  assessmentMaxScore?: number;
  practiceSummary?: Record<string, unknown>;
}

export interface DatabaseSchema {
  users: User[];
  courses: Course[];
  enrollments: Enrollment[];
  lessons: Lesson[];
  blocks: LessonBlock[];
  attempts: LessonAttempt[];
  /** Per-attempt deterministic question selections (renamed from the misleading `assignments`). */
  questionAssignments: QuestionAssignment[];
  responses: StudentResponse[];
  securitySignals: SecuritySignal[];
  aiGradingRecords: AIGradingRecord[];
  lessonAssignments: Assignment[];
  gradebookEntries?: GradebookEntry[];
  gradebookResponseEntries?: GradebookResponseEntry[];
  lessonDrafts?: LessonDraft[];
  /**
   * Immutable lesson version snapshots created at publish time.
   * Never mutated after creation. Assignments and attempts reference a versionId.
   */
  lessonVersions?: LessonVersion[];
}

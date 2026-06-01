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
  settings: LessonSettings;
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
  studentId: string;
  seed: number;
  startedAt: string;
  completedAt?: string;
  status: 'started' | 'completed';
  currentBlockIndex: number;
  furthestVideoTimestamps: { [blockId: string]: number }; // blockId -> furthest validated watch timestamp
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
  score: number; // Final registered score for this response
  activeTimeSpent: number; // seconds spent focusing on this question
  aiGrading?: {
    score: number;
    rationale: string;
    confidence: number;
    status: 'pending' | 'success' | 'failed' | 'needs_review';
    rubricBreakdown: { [category: string]: { score: number; feedback: string } };
    gradedAt: string;
  };
  teacherOverride?: {
    score: number;
    notes: string;
    gradedAt: string;
  };
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
  rationale: string;
  rubricBreakdown: { [category: string]: { score: number; feedback: string } };
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
  courseId: string;
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
}

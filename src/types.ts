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

export interface QuestionDefinition {
  id: string;
  stem: string | RichContent;
  choices?: (string | RichContent)[]; // for Multiple Choice (MC)
  correctAnswerIndex?: number; // SECRET (not sent to student on graded)
  explanation?: string | RichContent; // SECRET (not sent to student on graded)
  points: number;
  rubricCategories?: { name: string; maxPoints: number; description: string | RichContent }[]; // for Short Answer (SA)
}

export interface VideoCheckpoint {
  id: string;
  timestamp: number; // in seconds
  title: string;
  isRequired: boolean;
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
  studentId: string;
  seed: number;
  startedAt: string;
  completedAt?: string;
  status: 'started' | 'completed';
  currentBlockIndex: number;
  furthestVideoTimestamps: { [blockId: string]: number }; // blockId -> furthest validated watch timestamp
  activeTimeSpent: number; // in seconds
  inactiveTimeSpent: number; // in seconds
}

export interface QuestionAssignment {
  id: string;
  attemptId: string;
  blockId: string;
  checkpointId?: string; // undefined if single question block
  questionId: string;
  selectedQuestion: QuestionDefinition; // Sanitized copy (no answer keys for graded)
  scrambledChoices?: (string | RichContent)[];
  scrambledToOriginalIndexMap?: number[];
}

export interface StudentResponse {
  id: string;
  attemptId: string;
  studentId: string;
  blockId: string;
  checkpointId?: string; // undefined if single question block
  questionId: string;
  type: 'mc' | 'sa';
  responseValue: string | number; // choice index for MC, text for SA
  isCorrect?: boolean; // MC auto-graded
  score: number; // Final registered score for this response
  activeTimeSpent: number; // seconds spent focusing on this question
  aiGrading?: {
    score: number;
    rationale: string;
    confidence: number;
    status: 'pending' | 'success' | 'failed';
    rubricBreakdown: { [category: string]: { score: number; feedback: string } };
    gradedAt: string;
  };
  teacherOverride?: {
    score: number;
    notes: string;
    gradedAt: string;
  };
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
    | 'rapid_navigation';
  severity: 'low' | 'medium' | 'high';
  blockId?: string;
  videoTimestamp?: number;
  metadata?: any;
}

export interface Course {
  id: string;
  name: string;
  teacherId: string;
  code: string;
}

export interface RosterStudent {
  id: string;
  courseId: string;
  userId: string;
}

export interface DatabaseSchema {
  users: User[];
  courses: Course[];
  lessons: Lesson[];
  blocks: LessonBlock[];
  attempts: LessonAttempt[];
  assignments: QuestionAssignment[];
  responses: StudentResponse[];
  securitySignals: SecuritySignal[];
}

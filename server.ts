import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dns from "dns";
import { initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getStorage as getAdminStorage, getDownloadURL } from "firebase-admin/storage";
import multer from "multer";
import { appError, sendAppError, fail } from "./server/data/errors";
import {
  migrateBlock,
  migrateQuestionDefinition,
  sanitizeLessonBlocksForStudent,
  sanitizeQuestionForStudent,
  sanitizeResponseForStudent,
  sanitizeAiGradingForStudent,
  sanitizeAttemptForStudent,
  sanitizeGradebookEntryForStudent,
  gradeMc,
  choiceTextById,
  findLeakedSecretFields,
} from "./server/data/sanitize";
import { validateLessonBlocks } from "./server/data/validation";
import {
  validateAttemptCompletion,
  studentSafeMessage,
} from "./server/data/completion";

// Set default DNS resolution to ipv4 first to avoid localhost connections failing in dev
dns.setDefaultResultOrder("ipv4first");

const app = express();
const PORT = 3000;

app.use(express.json());

// Ensure uploads folder exists and serve it
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use("/uploads", express.static(UPLOADS_DIR));

// Set up Database paths
const DB_FILE = path.join(process.cwd(), "data", "db.json");
const CONFIG_FILE = path.join(process.cwd(), "firebase-applet-config.json");

let firestoreDb: any = null;
let firebaseBucket: any = null;

// Configurable domain, teacher allowlist, and external student test allowlist from environment
const ALLOWED_DOMAIN = (process.env.GOOGLE_ALLOWED_DOMAIN || "malvernprep.org").toLowerCase();
const TEACHER_EMAILS: Set<string> = new Set(
  (process.env.TEACHER_EMAILS || "stephenborish@gmail.com")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
);
const AUTHORIZED_STUDENT_EMAILS: Set<string> = new Set(
  (process.env.AUTHORIZED_STUDENT_EMAILS || "")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
);

if (!process.env.GOOGLE_ALLOWED_DOMAIN) {
  console.warn("VERITAS Learn - GOOGLE_ALLOWED_DOMAIN not set; defaulting to 'malvernprep.org'. Set this env var before deploying to production.");
}
if (!process.env.TEACHER_EMAILS) {
  console.warn("VERITAS Learn - TEACHER_EMAILS not set; using built-in default. Set this env var before deploying to production.");
}
if (AUTHORIZED_STUDENT_EMAILS.size > 0) {
  console.warn("VERITAS Learn - WARNING: External student allowlist (AUTHORIZED_STUDENT_EMAILS) is enabled. Remove AUTHORIZED_STUDENT_EMAILS when testing is complete.");
}

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const adminApp = initializeAdminApp({
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket,
    });
    firestoreDb = getAdminFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
    firebaseBucket = getAdminStorage(adminApp).bucket(firebaseConfig.storageBucket);
    console.log("VERITAS Learn - Firebase Firestore initialized with Admin SDK. DB id:", firebaseConfig.firestoreDatabaseId);
    console.log("VERITAS Learn - Firebase Storage bucket initialized:", firebaseConfig.storageBucket);
  } catch (err) {
    console.error("VERITAS Learn - Failed to initialize Admin Firebase connection:", err);
  }
}

// Security Audit Error Handlers conforming to constraints
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: "system_express_backend",
      email: null
    },
    operationType,
    path
  };
  console.error('Firestore Error Intercepted: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Eliminate undefined properties to satisfy Firestore structure limits
function sanitizeForFirestore(val: any): any {
  if (val === undefined) return null;
  if (val === null) return null;
  if (Array.isArray(val)) {
    return val.map(sanitizeForFirestore);
  }
  if (typeof val === "object") {
    const res: any = {};
    for (const key of Object.keys(val)) {
      res[key] = sanitizeForFirestore(val[key]);
    }
    return res;
  }
  return val;
}

// Durable collections owned by VERITAS Learn.
const DB_COLLECTIONS = [
  "users",
  "courses",
  "enrollments",
  "lessons",
  "blocks",
  "attempts",
  "questionAssignments",
  "responses",
  "securitySignals",
  "aiGradingRecords",
  "lessonAssignments",
  "gradebookEntries",
  "gradebookResponseEntries",
  "lessonDrafts",
  "lessonVersions",
  "approvedTeachers",
] as const;

function emptyDb(): any {
  const db: any = {};
  for (const col of DB_COLLECTIONS) db[col] = [];
  return db;
}

/**
 * Ensure a loaded db has the expected shape:
 *  - all collections exist
 *  - the legacy `assignments` collection is migrated to `questionAssignments`
 *  - every embedded question is normalized to the stable-choice-id model
 * Mutates and returns `db`.
 */
function normalizeDb(db: any): any {
  if (!db || typeof db !== "object") return emptyDb();
  for (const col of DB_COLLECTIONS) {
    if (!Array.isArray(db[col])) db[col] = [];
  }
  // Legacy rename: assignments -> questionAssignments
  if (Array.isArray(db.assignments) && db.assignments.length && db.questionAssignments.length === 0) {
    db.questionAssignments = db.assignments;
  }
  delete db.assignments;
  // Normalize embedded questions to stable choice ids / correctChoiceId.
  db.blocks = db.blocks.map((b: any) => migrateBlock(b));
  return db;
}

// Cloud Synchronized Memory Cache
let dbMemory: any = emptyDb();

let lastSyncedMemory: string = "";

function readLocalBackup() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const seeded = emptyDb();
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2), "utf8");
      return seeded;
    }
    const data = fs.readFileSync(DB_FILE, "utf8");
    return normalizeDb(JSON.parse(data));
  } catch (error) {
    console.error("Error reading local backup database file:", error);
    return emptyDb();
  }
}

function saveLocalBackup(data: any) {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Error writing database backup:", error);
  }
}

// Synced DB Reading
function readDb() {
  if (!dbMemory.aiGradingRecords) dbMemory.aiGradingRecords = [];
  if (!Array.isArray(dbMemory.questionAssignments)) {
    dbMemory.questionAssignments = Array.isArray(dbMemory.assignments) ? dbMemory.assignments : [];
  }
  if (!Array.isArray(dbMemory.enrollments)) dbMemory.enrollments = [];
  return dbMemory;
}

// ==========================================
// Join Code Generation
// ==========================================

const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1 (ambiguous)

function generateJoinCode(prefix?: string): string {
  const prefixPart = prefix 
    ? prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2)
    : "";
  const neededLength = 5 - prefixPart.length;
  const suffix = Array.from({ length: neededLength }, () =>
    JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  ).join("");
  return (prefixPart + suffix).toUpperCase();
}

// ==========================================
// Learning Conditions Policy Compiler
// ==========================================

type IntegrityPreset = 'open' | 'guided' | 'focused' | 'verified' | 'custom';

interface IntegrityPolicy {
  preset: IntegrityPreset;
  studentFlexibility: 'open' | 'guided' | 'structured' | 'locked_sequence';
  focusSupport: 'off' | 'quiet' | 'guided' | 'focused' | 'locked';
  responseControls: 'open' | 'recorded' | 'guarded' | 'restricted' | 'strict';
  videoControls: 'open' | 'progress_aware' | 'checkpointed' | 'restricted' | 'verified';
  reviewSensitivity: 'low' | 'balanced' | 'elevated' | 'high';
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
  focusGraceSeconds: number;
  reviewThreshold: number;
  lockThreshold: number;
}

const PRESET_DIALS: Record<IntegrityPreset, Partial<IntegrityPolicy>> = {
  open: {
    studentFlexibility: "open",
    focusSupport: "off",
    responseControls: "open",
    videoControls: "open",
    reviewSensitivity: "low",
  },
  guided: {
    studentFlexibility: "guided",
    focusSupport: "quiet",
    responseControls: "recorded",
    videoControls: "checkpointed",
    reviewSensitivity: "low",
  },
  focused: {
    studentFlexibility: "structured",
    focusSupport: "focused",
    responseControls: "guarded",
    videoControls: "restricted",
    reviewSensitivity: "balanced",
  },
  verified: {
    studentFlexibility: "locked_sequence",
    focusSupport: "locked",
    responseControls: "strict",
    videoControls: "verified",
    reviewSensitivity: "high",
  },
  custom: {},
};

function compileIntegrityPolicy(raw: Partial<IntegrityPolicy>): IntegrityPolicy {
  const preset: IntegrityPreset = (raw.preset as IntegrityPreset) || "open";
  const dials = preset !== "custom" ? { ...PRESET_DIALS[preset], ...raw } : { ...PRESET_DIALS.open, ...raw };

  const sf = dials.studentFlexibility || "open";
  const fs = dials.focusSupport || "off";
  const rc = dials.responseControls || "open";
  const vc = dials.videoControls || "open";
  const rs = dials.reviewSensitivity || "low";

  const reviewThresholdMap: Record<string, number> = { low: 5, balanced: 3, elevated: 2, high: 1 };
  const lockThresholdMap: Record<string, number> = { low: 999, balanced: 6, elevated: 4, high: 3 };
  const graceMap: Record<string, number> = { off: 0, quiet: 30, guided: 20, focused: 10, locked: 5 };

  return {
    preset,
    studentFlexibility: sf as any,
    focusSupport: fs as any,
    responseControls: rc as any,
    videoControls: vc as any,
    reviewSensitivity: rs as any,
    allowResume: sf !== "locked_sequence",
    allowBackNavigation: sf === "open" || sf === "guided",
    requireFullscreen: fs === "locked" || fs === "focused",
    restrictSeeking: vc === "restricted" || vc === "verified",
    blockPaste: rc === "restricted" || rc === "strict",
    logPaste: rc !== "open",
    blockCopy: rc === "strict",
    blockContextMenu: rc === "restricted" || rc === "strict",
    watermarkVideo: vc === "verified",
    requireCheckpoints: vc === "checkpointed" || vc === "restricted" || vc === "verified",
    focusGraceSeconds: graceMap[fs] ?? 30,
    reviewThreshold: reviewThresholdMap[rs] ?? 5,
    lockThreshold: lockThresholdMap[rs] ?? 999,
  };
}

function getEffectivePolicy(assignment: any): IntegrityPolicy {
  if (assignment?.integrityPolicy) {
    return compileIntegrityPolicy(assignment.integrityPolicy);
  }
  return compileIntegrityPolicy({ preset: "open" });
}

// Utility to dynamically join AI grading records onto responses for client consumption
function mergeResponsesWithAiGrading(responses: any[], db: any) {
  const gradingRecords = db.aiGradingRecords || [];
  return responses.map((r: any) => {
    const record = gradingRecords.find((g: any) => g.responseId === r.id);
    if (record) {
      return {
        ...r,
        aiGrading: {
          score: record.parsedScore,
          feedback: record.feedback,             // student-facing explanation
          rationale: record.rationale,           // teacher-facing explanation
          confidence: record.confidence,
          status: record.status,
          rubricBreakdown: record.rubricBreakdown,
          misconceptions: record.misconceptions,
          needsTeacherReview: record.needsTeacherReview,
          teacherNotes: record.teacherNotes,     // teacher-only
          gradedAt: record.gradedAt
        }
      };
    }
    return r;
  });
}

// Recalculate max points of assessment questions assigned to this attempt
function calcMaxPointsForAttempt(attempt: any, db: any): number {
  const attemptId = attempt.id;
  const qAsgs = (db.questionAssignments || []).filter((qa: any) => qa.attemptId === attemptId);
  let total = 0;
  qAsgs.forEach((qa: any) => {
    const block = (db.blocks || []).find((b: any) => b.id === qa.blockId);
    if (!block) return;
    
    let isPractice = false;
    if (qa.checkpointId && Array.isArray(block.videoCheckpoints)) {
      const cp = block.videoCheckpoints.find((c: any) => c.id === qa.checkpointId);
      isPractice = cp ? !!cp.isPractice : !!block.isPractice;
    } else {
      isPractice = !!block.isPractice;
    }
    
    if (!isPractice) {
      const points = qa.selectedQuestion?.points ?? 0;
      total += Number(points);
    }
  });

  if (total === 0) {
    const lessonBlocks = (db.blocks || []).filter((b: any) => b.lessonId === attempt.lessonId);
    total = lessonBlocks.reduce((sum: number, b: any) => {
      if (b.type !== "question" || b.isPractice) return sum;
      if (b.singleQuestion) return sum + (b.singleQuestion.points || 0);
      if (b.questionPool) {
        const perQ = b.questionPool.questions?.[0]?.points || 0;
        return sum + perQ * (b.questionPool.numToSelect || 1);
      }
      return sum;
    }, 0);
  }
  return total;
}

// Calculate and write a durable GradebookResponseEntry for a single student response
function upsertResponseGradebookEntry(
  response: any,
  attempt: any,
  status: "pending_ai" | "auto_scored" | "ai_scored" | "needs_teacher_review" | "teacher_reviewed" | "teacher_overridden" | "missing" | "excused" | "error",
  source: "multiple_choice" | "ai_short_answer" | "teacher_override" | "manual",
  feedback: string | undefined,
  db: any
): void {
  if (!db.gradebookResponseEntries) {
    db.gradebookResponseEntries = [];
  }

  const lessonId = attempt.lessonId;
  const assignmentId = attempt.assignmentId || 
    (db.lessonAssignments || []).find((la: any) => la.lessonId === lessonId)?.id || 
    `legacy_${lessonId}`;
  
  const lesson = (db.lessons || []).find((l: any) => l.id === lessonId);
  const assignment = (db.lessonAssignments || []).find((a: any) => a.id === assignmentId);
  const courseId = assignment ? assignment.courseId : (lesson ? lesson.courseId : "");

  const entryId = `ge_resp_${response.id}`;
  const entryIdx = db.gradebookResponseEntries.findIndex((e: any) => e.id === entryId);

  const isPractice = response.gradebookCategory === "practice" || response.gradingMode === "practice";

  const entryData: any = {
    id: entryId,
    studentId: response.studentId,
    courseId,
    lessonId,
    assignmentId,
    attemptId: response.attemptId,
    responseId: response.id,
    category: isPractice ? "practice" : "assessment",
    score: Number(response.score) || 0,
    maxScore: Number(response.maxPoints) || 0,
    feedback: feedback || "",
    feedbackVisibleToStudent: isPractice,
    status,
    source,
    createdAt: response.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (entryIdx !== -1) {
    entryData.createdAt = db.gradebookResponseEntries[entryIdx].createdAt || entryData.createdAt;
    db.gradebookResponseEntries[entryIdx] = entryData;
  } else {
    db.gradebookResponseEntries.push(entryData);
  }
}

/**
 * Ensure a GradebookEntry exists for a student+assignment pair.
 * Creates a minimal 'not_started' entry if none exists.
 * Preserves any existing teacher-set lifecycle fields (extended, excused, etc.).
 */
function ensureGradebookEntryForAssignment(studentId: string, assignmentId: string, db: any): any {
  if (!db.gradebookEntries) db.gradebookEntries = [];
  const existing = db.gradebookEntries.find(
    (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
  );
  if (existing) return existing;

  const assignment = (db.lessonAssignments || []).find((a: any) => a.id === assignmentId);
  const now = new Date().toISOString();
  const entry: any = {
    id: 'ge_' + Math.random().toString(36).substring(2, 9),
    studentId,
    assignmentId,
    courseId: assignment?.courseId || '',
    lessonId: assignment?.lessonId || '',
    lessonVersionId: assignment?.lessonVersionId || null,
    status: 'not_started',
    rawScore: 0,
    finalScore: 0,
    maxPoints: 0,
    percent: 0,
    aiPendingCount: 0,
    teacherReviewRequired: false,
    createdAt: now,
    updatedAt: now,
    lastCalculatedAt: now,
  };
  db.gradebookEntries.push(entry);
  return entry;
}

// Calculate and write a durable GradebookEntry for a finished/updated attempt
function upsertGradebookEntryForAttempt(attemptId: string, db: any): void {
  if (!db.gradebookEntries) {
    db.gradebookEntries = [];
  }
  const attempt = db.attempts.find((a: any) => a.id === attemptId);
  if (!attempt) return;

  const studentId = attempt.studentId;
  const assignmentId = attempt.assignmentId ||
    (db.lessonAssignments || []).find((la: any) => la.lessonId === attempt.lessonId)?.id ||
    `legacy_${attempt.lessonId}`;

  // Find all assessment responses for this attempt
  const attemptResponses = (db.responses || []).filter((r: any) => r.attemptId === attemptId);
  const assessmentResponses = attemptResponses.filter((r: any) => {
    const cat = r.gradebookCategory ?? r.gradingMode;
    // Legacy safety: responses created before gradingMode was tracked have no category.
    // Count them toward the assessment score to avoid silently dropping old data.
    // All new responses set gradebookCategory explicitly at submission time.
    if (cat === undefined) return true;
    return cat === "assessment";
  });
  const practiceResponses = attemptResponses.filter((r: any) => {
    const cat = r.gradebookCategory ?? r.gradingMode;
    return cat === "practice";
  });

  const rawScore = assessmentResponses.reduce((sum: number, r: any) => sum + (r.score || 0), 0);
  const finalScore = rawScore;
  const maxPoints = calcMaxPointsForAttempt(attempt, db);

  const practiceScore = practiceResponses.reduce((sum: number, r: any) => sum + (r.score || 0), 0);
  const practiceMaxScore = practiceResponses.reduce((sum: number, r: any) => sum + (Number(r.maxPoints) || 0), 0);

  // Preserve teacher-set lifecycle overrides from any existing entry
  const existingEntry = db.gradebookEntries.find(
    (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
  );
  // If teacher has marked excused/missing, preserve those
  const teacherOverriddenStatus: string | null =
    existingEntry?.status === 'excused' || existingEntry?.status === 'missing' ||
    existingEntry?.status === 'extended' || existingEntry?.status === 'reopened'
      ? existingEntry.status
      : null;

  type GradebookStatus =
    | "not_started" | "in_progress" | "submitted" | "completed"
    | "pending_ai" | "needs_teacher_review" | "reviewed" | "feedback_released"
    | "missing" | "excused" | "late" | "extended" | "reopened" | "error"
    | "needs_grading" | "graded";

  let status: GradebookStatus = "in_progress";
  if (attempt.status !== 'completed') {
    status = 'in_progress';
  } else {
    const qAsgs = (db.questionAssignments || []).filter((qa: any) => qa.attemptId === attemptId);
    const saAssessmentAsgs = qAsgs.filter((qa: any) => {
      const block = (db.blocks || []).find((b: any) => b.id === qa.blockId);
      if (!block) return false;
      let isPractice = false;
      if (qa.checkpointId && Array.isArray(block.videoCheckpoints)) {
        const cp = block.videoCheckpoints.find((c: any) => c.id === qa.checkpointId);
        isPractice = cp ? !!cp.isPractice : !!block.isPractice;
      } else {
        isPractice = !!block.isPractice;
      }
      if (isPractice) return false;
      const type = qa.selectedQuestion?.type || (qa.checkpointId ? block.videoCheckpoints?.find((c: any) => c.id === qa.checkpointId)?.questionType : block.questionType);
      return type === "sa";
    });

    let aiPendingCount = 0;
    let needsTeacherGrading = false;

    saAssessmentAsgs.forEach((saQa: any) => {
      const resp = assessmentResponses.find((r: any) => r.questionId === saQa.questionId);
      if (!resp) {
        needsTeacherGrading = true;
        return;
      }
      const aiRecord = (db.aiGradingRecords || []).find((g: any) => g.responseId === resp.id);
      if (!aiRecord || aiRecord.status === 'pending') {
        aiPendingCount++;
      } else if (aiRecord.status === 'needs_review' || resp.isLowEffort) {
        needsTeacherGrading = true;
      }
    });

    if (aiPendingCount > 0) {
      status = 'pending_ai';
    } else if (needsTeacherGrading) {
      status = 'needs_teacher_review';
    } else {
      status = 'reviewed';
    }
  }

  // Attempt-level legacy override (still honoured for compatibility)
  const attemptOverride = attempt.gradebookStatusOverride;
  if (attemptOverride === "excused") {
    status = "excused";
  } else if (attemptOverride === "missing") {
    status = "missing";
  }

  // Teacher-set entry-level override takes final precedence
  if (teacherOverriddenStatus) {
    status = teacherOverriddenStatus as GradebookStatus;
  }

  let aiPendingCount = 0;
  assessmentResponses.forEach((r: any) => {
    if (r.type === "sa") {
      const aiRecord = (db.aiGradingRecords || []).find((g: any) => g.responseId === r.id);
      if (!aiRecord || aiRecord.status === 'pending') {
        aiPendingCount++;
      }
    }
  });

  let teacherReviewRequired = false;
  assessmentResponses.forEach((r: any) => {
    if (r.type === "sa") {
      const aiRecord = (db.aiGradingRecords || []).find((g: any) => g.responseId === r.id);
      if (aiRecord && aiRecord.status === 'needs_review') {
        teacherReviewRequired = true;
      }
      if (r.isLowEffort) {
        teacherReviewRequired = true;
      }
    }
  });

  const entryIdx = db.gradebookEntries.findIndex(
    (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
  );

  const percent = maxPoints > 0 ? Math.round((finalScore / maxPoints) * 100) : 100;
  const now = new Date().toISOString();

  // Preserve teacher-set lifecycle fields from existing entry
  const preserved: any = entryIdx !== -1 ? {
    excusedAt: db.gradebookEntries[entryIdx].excusedAt,
    excusedBy: db.gradebookEntries[entryIdx].excusedBy,
    missingMarkedAt: db.gradebookEntries[entryIdx].missingMarkedAt,
    missingMarkedBy: db.gradebookEntries[entryIdx].missingMarkedBy,
    extendedUntil: db.gradebookEntries[entryIdx].extendedUntil,
    reopenedAt: db.gradebookEntries[entryIdx].reopenedAt,
    reopenedBy: db.gradebookEntries[entryIdx].reopenedBy,
    reviewedAt: db.gradebookEntries[entryIdx].reviewedAt,
    reviewedBy: db.gradebookEntries[entryIdx].reviewedBy,
    feedbackReleasedAt: db.gradebookEntries[entryIdx].feedbackReleasedAt,
    feedbackReleasedBy: db.gradebookEntries[entryIdx].feedbackReleasedBy,
    createdAt: db.gradebookEntries[entryIdx].createdAt,
  } : {};

  const entryData: any = {
    id: entryIdx !== -1 ? db.gradebookEntries[entryIdx].id : "ge_" + Math.random().toString(36).substring(2, 9),
    assignmentId,
    studentId,
    courseId: attempt.assignmentId
      ? (db.lessonAssignments || []).find((a: any) => a.id === attempt.assignmentId)?.courseId || ''
      : '',
    lessonId: attempt.lessonId || '',
    lessonVersionId: attempt.lessonVersionId || null,
    attemptId: attemptId,
    rawScore,
    finalScore,
    maxPoints,
    percent,
    assessmentScore: rawScore,
    assessmentMaxScore: maxPoints,
    practiceScore,
    practiceMaxScore,
    practiceSummary: {
      responseCount: practiceResponses.length,
      totalScore: practiceScore,
      maxScore: practiceMaxScore,
    },
    status,
    aiPendingCount,
    teacherReviewRequired,
    completedAt: attempt.completedAt || null,
    submittedAt: attempt.completedAt || attempt.startedAt || null,
    lastCalculatedAt: now,
    updatedAt: now,
    createdAt: preserved.createdAt || now,
    ...preserved,
  };

  if (entryIdx !== -1) {
    db.gradebookEntries[entryIdx] = entryData;
  } else {
    db.gradebookEntries.push(entryData);
  }
}

// Recalculate and persist the score of a specific attempt by summing its student responses (excluding practice)
function recalculateAttemptScore(attemptId: string, db: any): number {
  if (!db.attempts) return 0;
  const attemptIdx = db.attempts.findIndex((a: any) => a.id === attemptId);
  if (attemptIdx === -1) return 0;
  
  const attemptResponses = (db.responses || []).filter((r: any) => r.attemptId === attemptId);
  const assessmentResponses = attemptResponses.filter((r: any) => {
    const cat = r.gradebookCategory ?? r.gradingMode;
    // Legacy safety: responses without a category are counted as assessment.
    // All new responses set gradebookCategory explicitly at submission time.
    if (cat === undefined) return true;
    return cat === "assessment";
  });

  const score = assessmentResponses.reduce((sum: number, r: any) => sum + (r.score || 0), 0);
  
  db.attempts[attemptIdx].score = score;

  // Immediately compute and write/update durable GradebookEntry
  try {
    upsertGradebookEntryForAttempt(attemptId, db);
  } catch (err) {
    console.error("Failed to upsert GradebookEntry in recalculateAttemptScore:", err);
  }

  return score;
}

// Recalculates and persists scores for all attempts associated with a given assignment
function recalculateAssignmentScores(assignmentId: string, db: any): void {
  const attempts = (db.attempts || []).filter((a: any) => a.assignmentId === assignmentId);
  attempts.forEach((a: any) => {
    recalculateAttemptScore(a.id, db);
  });
}

/**
 * Persistence mode is decided once at boot.
 *  - "firestore": the configured Cloud Firestore is the durable source of truth.
 *  - "preview-memory": PREVIEW/DEMO ONLY — durable home is the local data/db.json file.
 *    Used only when no Firestore Admin credentials are reachable (e.g. this sandbox).
 */
let persistenceMode: "firestore" | "preview-memory" = "preview-memory";

// Best-effort write-through used by NON-slice routes (progress/heartbeats/signals).
// Slice routes that hold teacher-authored content or student work must use commitDb().
function writeDb(data: any) {
  dbMemory = data;
  saveLocalBackup(data);
  if (persistenceMode === "firestore") {
    syncToFirestore(data).catch((e) => console.error("VERITAS Learn - background sync failed:", e));
  }
}

/**
 * Durable, awaited commit for teacher-authored content and student work.
 * In Firestore mode this AWAITS the cloud write and throws AppError(DATABASE_WRITE_FAILED)
 * on failure — it NEVER silently falls back to memory/local file for real content.
 * In preview-memory mode the durable home is data/db.json.
 */
async function commitDb(data: any): Promise<void> {
  dbMemory = data;
  if (persistenceMode === "firestore") {
    if (!firestoreDb) {
      throw appError("DATABASE_UNAVAILABLE", "Durable database is not available. Your change was not saved.");
    }
    try {
      await syncToFirestore(data, true);
    } catch (err) {
      throw appError(
        "DATABASE_WRITE_FAILED",
        "Failed to persist to the durable database. Your change was not saved.",
        err instanceof Error ? err.message : String(err)
      );
    }
    saveLocalBackup(data); // local mirror for fast reads; Firestore remains source of truth
    return;
  }
  // Preview/demo mode — durable home is the local JSON file.
  saveLocalBackup(data);
}

// Reconciles and uploads updates to cloud Firestore collections.
// `strict` => surface write failures (used by commitDb) instead of swallowing them.
async function syncToFirestore(newState: any, strict = false) {
  if (!firestoreDb) {
    if (strict) throw appError("DATABASE_UNAVAILABLE", "Firestore is not configured.");
    return;
  }
  try {
    const collectionsList = DB_COLLECTIONS as readonly string[];

    let oldState: any = {};
    try {
      if (lastSyncedMemory) {
        oldState = JSON.parse(lastSyncedMemory);
      }
    } catch (e) {}

    for (const col of collectionsList) {
      const newItems = newState[col] || [];
      const oldItems = oldState[col] || [];
      const oldMap = new Map<string, any>(oldItems.map((item: any) => [item.id, item]));

      // Write added or updated elements
      for (const item of newItems) {
        if (!item.id) continue;
        const oldItem = oldMap.get(item.id);
        const itemStr = JSON.stringify(item);
        if (!oldItem || JSON.stringify(oldItem) !== itemStr) {
          const sanitized = sanitizeForFirestore(item);
          try {
            await firestoreDb.collection(col).doc(item.id).set(sanitized);
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `${col}/${item.id}`);
          }
        }
      }

      // Delete elements removed from list
      const newIds = new Set(newItems.map((item: any) => item.id));
      for (const oldItem of oldItems) {
        if (oldItem.id && !newIds.has(oldItem.id)) {
          try {
            await firestoreDb.collection(col).doc(oldItem.id).delete();
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `${col}/${oldItem.id}`);
          }
        }
      }
    }
    lastSyncedMemory = JSON.stringify(newState);
  } catch (syncErr) {
    if (strict) throw syncErr;
    console.error("VERITAS Learn - Cloud syncing execution failed:", syncErr);
  }
}

// Loud banner so it is unmistakable that real student work would NOT be durably
// stored in a real deployment while running in preview-memory mode.
function announcePreviewMemoryMode(reason: string) {
  persistenceMode = "preview-memory";
  console.warn("============================================================");
  console.warn("VERITAS Learn - PREVIEW/DEMO PERSISTENCE MODE");
  console.warn(`  Reason: ${reason}`);
  console.warn("  Durable home is the local file data/db.json (NOT Firestore).");
  console.warn("  Do NOT treat this as production-durable student-record storage.");
  console.warn("============================================================");
}

// Retrieves complete cloud state on boot
async function loadDatabaseFromFirestore() {
  if (!firestoreDb) {
    announcePreviewMemoryMode("No Firestore Admin credentials configured.");
    dbMemory = readLocalBackup();
    return;
  }

  // Pre-flight check, bounded by a timeout so a missing-credentials / unreachable
  // Firestore (e.g. this sandbox, or a misconfigured preview) cannot hang boot.
  try {
    const preflight = firestoreDb.collection("users").limit(1).get();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FIRESTORE_PREFLIGHT_TIMEOUT")), 6000)
    );
    await Promise.race([preflight, timeout]);
  } catch (preflightErr: any) {
    const msg = preflightErr?.message || "";
    const isPermissionError = msg.includes("PERMISSION_DENIED") || preflightErr?.code === 7;
    const isTimeout = msg.includes("FIRESTORE_PREFLIGHT_TIMEOUT");
    const isCredError = msg.includes("Could not load the default credentials") || msg.includes("credential");
    if (isPermissionError || isTimeout || isCredError) {
      firestoreDb = null;
      announcePreviewMemoryMode(
        isPermissionError
          ? "Firestore reachable but not authorized in this sandbox (7 PERMISSION_DENIED)."
          : isTimeout
          ? "Firestore did not respond within 6s (unreachable in this environment)."
          : "Firestore Admin credentials are not available."
      );
      dbMemory = readLocalBackup();
      return;
    }
    // Unknown error — fall through; the main load below will catch and fall back.
  }

  console.log("VERITAS Learn - Recovering academic data from Cloud Firestore...");
  try {
    const collectionsList = DB_COLLECTIONS as readonly string[];

    const tempMemory: any = {};
    let cloudIsEmpty = true;

    for (const col of collectionsList) {
      tempMemory[col] = [];
      try {
        const querySnapshot = await firestoreDb.collection(col).get();
        querySnapshot.forEach((docSnap: any) => {
          tempMemory[col].push(docSnap.data());
        });
        if (tempMemory[col].length > 0) {
          cloudIsEmpty = false;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, col);
      }
    }

    persistenceMode = "firestore";

    if (cloudIsEmpty) {
      console.log("VERITAS Learn - Cloud DB is empty. Propagating initial templates and seed data...");
      dbMemory = normalizeDb(readLocalBackup());
      lastSyncedMemory = JSON.stringify(dbMemory);
      await syncToFirestore(dbMemory);
      console.log("VERITAS Learn - Seeding Cloud database finished.");
    } else {
      console.log("VERITAS Learn - Successfully restored data models. Database synced with Cloud Firestore.");
      dbMemory = normalizeDb(tempMemory);
      lastSyncedMemory = JSON.stringify(dbMemory);
      saveLocalBackup(dbMemory);
    }

    // Handshake Validation
    try {
      await firestoreDb.collection("users").doc("teacher_1").get();
      console.log("VERITAS Learn - Cloud handshake verified and live.");
    } catch (e) {
      console.error("VERITAS Learn - Troubleshooting warning: Handshake verify failed.", e);
    }

  } catch (error) {
    console.error("VERITAS Learn - Failure restoring cloud states. Using survivors from local backup storage:", error);
    announcePreviewMemoryMode("Firestore restore failed; using local backup.");
    dbMemory = readLocalBackup();
  }
}


// Lazy AI SDK initialization
let aiInstance: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing on the server.");
    }
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiInstance;
}

// Deterministic randomizer (Linear Congruential Generator)
function lcg(seed: number) {
  let state = seed;
  return function () {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// Shuffles an array deterministically given a rand function
function shuffleWithSeed<T>(array: T[], randFn: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randFn() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

// Coerce a string | RichContent value into plain text for AI prompts/logging.
function asPlainText(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// Stable, dependency-free hash for AIGradingRecord.inputHash (audit/dedupe aid).
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return "h" + h.toString(16);
}

/**
 * Safely parse a JSON string returned by an AI model.
 * Strips markdown code fences (``` or ```json) if present before parsing.
 * Throws SyntaxError if the content cannot be parsed.
 */
function parseAiGradingJson(rawText: string): any {
  let text = rawText.trim();
  
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (e) {}

  // Try extracting markdown JSON fences anywhere in the string
  const innerFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (innerFenceMatch) {
    try {
      const content = innerFenceMatch[1].trim();
      const cleaned = content.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(cleaned);
    } catch (e) {}
  }

  // Fallback: extract the outermost balanced braces { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const content = text.substring(firstBrace, lastBrace + 1);
      const cleaned = content.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(cleaned);
    } catch (e) {}
  }

  // Fallback: extract the outermost balanced brackets [ ... ]
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      const content = text.substring(firstBracket, lastBracket + 1);
      const cleaned = content.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(cleaned);
    } catch (e) {}
  }

  // Final try: strip trailing commas in the raw string
  try {
    const cleaned = text.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(cleaned);
  } catch (e) {}

  return JSON.parse(rawText);
}

// Build the short-answer grading prompt from the teacher-authored rubric + guidance.
function buildShortAnswerPrompt(lesson: any, q: any, responseValue: any, maxPoints: number): string {
  const rubricLines = (q.rubricCategories || [])
    .map((c: any, i: number) => {
      const catMax = Number(c.maxPoints) || 0;
      const parts = [
        `  ${i + 1}. "${asPlainText(c.name)}" (max ${catMax} pts): ${asPlainText(c.description)}`,
      ];
      if (c.fullCreditExample) parts.push(`     Full-credit example: ${asPlainText(c.fullCreditExample)}`);
      if (c.partialCreditExample) parts.push(`     Partial-credit example: ${asPlainText(c.partialCreditExample)}`);
      if (c.noCreditExample) parts.push(`     No-credit example: ${asPlainText(c.noCreditExample)}`);
      return parts.join("\n");
    })
    .join("\n");

  const internalOnly = (label: string, val: any) =>
    val ? `\n[INTERNAL — DO NOT REPRODUCE IN student-facing feedback]\n${label}:\n${asPlainText(val)}\n` : "";

  return [
    `You are Veritas AI, an academic grading assistant for "${asPlainText(lesson.title)}" at Malvern Prep.`,
    `Grade the student's short-answer response strictly using the teacher-authored rubric and guidance below.`,
    `Your score is a suggested grade for teacher review, not a final grade.`,
    ``,
    `GRADING PRINCIPLES:`,
    `- Award credit for correct concepts expressed in different wording; do not penalize synonyms or paraphrase when the underlying knowledge is clearly demonstrated.`,
    `- Do NOT award credit for vague, unsupported, or generic statements that do not demonstrate specific understanding of the subject matter.`,
    `- Clamp the total score to exactly 0..${maxPoints}. Each rubric category score must not exceed that category's maximum.`,
    `- Set needsTeacherReview=true if: confidence < 0.75, the response shows partial understanding with significant errors, the answer is ambiguous, or the grading requires nuanced human judgment.`,
    `- The "feedback" field is student-visible. It must explain what was done well and what was missing WITHOUT revealing the model answer, answer key, or any teacher-only guidance.`,
    `- The "teacherNotes" field is teacher-only. Use it to flag grading edge cases, ambiguities, or concerns about the response.`,
    `- The "misconceptions" array should list specific, concrete misconceptions identified in the response (empty array if none).`,
    ``,
    `Question / prompt:`,
    `"${asPlainText(q.stem)}"`,
    internalOnly("Model / expected answer", q.modelAnswer),
    internalOnly("Answer key", q.answerKey),
    internalOnly("Scoring guidance", q.aiScoringGuidance),
    ``,
    `Rubric categories (total max ${maxPoints} points):`,
    rubricLines || `  (no rubric categories provided — use holistic judgment based on the question and any guidance above)`,
    ``,
    `Student's submission:`,
    `"${asPlainText(responseValue)}"`,
  ].join("\n");
}

// Deterministically detect extremely short replies or structureless patterns
function checkLowEffortRules(responseValue: any): { lowEffort: boolean; reason: string | null } {
  if (typeof responseValue !== "string") {
    return { lowEffort: true, reason: "Response must be a written text answer." };
  }
  const text = responseValue.trim();
  
  // 1. Check extremely short (< 15 characters)
  if (text.length < 15) {
    return { lowEffort: true, reason: `Response is extremely short (${text.length} chars, expected >= 15).` };
  }

  // 2. Check lack of words / structure (word count < 3)
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 3) {
    return { lowEffort: true, reason: `Response has too few words (${words.length} words, expected >= 3).` };
  }

  // 3. Repeated character gibberish check (e.g. 'aaaaaaa', '......')
  const charCounts: Record<string, number> = {};
  let nonWsLen = 0;
  for (const char of text.toLowerCase()) {
    if (/\s/.test(char)) continue;
    nonWsLen++;
    charCounts[char] = (charCounts[char] || 0) + 1;
  }
  if (nonWsLen > 0) {
    const maxFreq = Math.max(...Object.values(charCounts));
    const maxFreqChar = Object.keys(charCounts).find(k => charCounts[k] === maxFreq);
    if (nonWsLen >= 5 && maxFreq / nonWsLen > 0.5) {
      return { lowEffort: true, reason: `Lacks meaningful structure: repeated character '${maxFreqChar}'.` };
    }
  }

  // 4. Keyboard smash pattern with exceptionally low vowel count (alphabetic gibberish)
  const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length >= 8) {
    const vowels = lettersOnly.match(/[aeiouAEIOU]/g);
    const vowelRatio = vowels ? vowels.length / lettersOnly.length : 0;
    if (vowelRatio < 0.1) {
      return { lowEffort: true, reason: "Gibberish pattern (extremely low vowel counts, suspicious of keyboard smash)." };
    }
  }

  return { lowEffort: false, reason: null };
}

function isUserTeacher(email: string, db: any): boolean {
  const emailLower = email.trim().toLowerCase();
  if (emailLower === "stephenborish@gmail.com") {
    return true;
  }
  if (TEACHER_EMAILS.has(emailLower)) {
    return true;
  }
  if (db && Array.isArray(db.approvedTeachers)) {
    return db.approvedTeachers.some((t: any) => t.email.toLowerCase() === emailLower);
  }
  return false;
}

// Core authentication helper — verifies Firebase ID token only. No fallbacks.
async function getSessionUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  if (!token) return null;

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(token);
    const email = decodedToken.email?.toLowerCase();
    if (!email) return null;

    const db = readDb();

    // Domain and allowlist check (school domain, exact teachers, or allowed external student tester list) — no role based on email text patterns
    const isAuthorized = email.endsWith(`@${ALLOWED_DOMAIN}`) || 
                         TEACHER_EMAILS.has(email) || 
                         AUTHORIZED_STUDENT_EMAILS.has(email) ||
                         isUserTeacher(email, db);
    if (!isAuthorized) {
      return null;
    }

    let user = db.users.find((u: any) => u.id === decodedToken.uid || u.email.toLowerCase() === email);

    if (!user) {
      // New users default to student. Teacher role dynamically checked.
      const isTeacher = isUserTeacher(email, db);
      user = {
        id: decodedToken.uid,
        name: decodedToken.name || email.split("@")[0].replace(/[._]/g, " "),
        email,
        role: isTeacher ? "teacher" : "student",
        photoURL: decodedToken.picture || null,
        createdAt: new Date().toISOString()
      };
      if (email === "stephenborish@gmail.com") {
        user.isSuperAdmin = true;
      }
      db.users.push(user);
      writeDb(db);
    } else {
      let changed = false;
      if (user.id !== decodedToken.uid) {
        user.id = decodedToken.uid;
        changed = true;
      }
      if (decodedToken.picture && user.photoURL !== decodedToken.picture) {
        user.photoURL = decodedToken.picture;
        changed = true;
      }
      const isTeacher = isUserTeacher(email, db);
      if (isTeacher && user.role !== "teacher") {
        user.role = "teacher";
        changed = true;
      }
      if (email === "stephenborish@gmail.com" && !user.isSuperAdmin) {
        user.isSuperAdmin = true;
        changed = true;
      }
      if (changed) {
        writeDb(db);
      }
    }

    if (email === "stephenborish@gmail.com") {
      user.isSuperAdmin = true;
    }

    return user;
  } catch (error) {
    console.error("VERITAS Learn - ID Token verification failed:", error);
    return null;
  }
}

// Security Middleware
const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized access. Invalid or expired Google classroom session." });
    return;
  }
  (req as any).user = user;
  next();
};

const requireTeacher = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = await getSessionUser(req);
  if (!user || user.role !== "teacher") {
    res.status(403).json({ error: "Access denied. Teacher privileges required." });
    return;
  }
  (req as any).user = user;
  next();
};

// ==========================================
// Course Ownership & Assignment Availability Helpers
// ==========================================

/**
 * Returns true when userId may manage (read/write assignments for) a course.
 * Checks both course.teacherId (single primary owner) and course.teacherIds (optional
 * multi-teacher array), so either ownership form is honoured without breakage.
 * SuperAdmins bypass ownership checks.
 */
function teacherCanManageCourse(userId: string, course: any, isSuperAdmin = false): boolean {
  if (!course) return false;
  if (isSuperAdmin) return true;
  if (course.teacherId === userId) return true;
  if (Array.isArray(course.teacherIds) && course.teacherIds.includes(userId)) return true;
  return false;
}

/** Computed availability state for a single assignment at a given time. */
type AssignmentAvailabilityState = 'not_open' | 'open' | 'due_passed' | 'closed' | 'unavailable';

function getAssignmentAvailabilityState(asg: any, now: Date): AssignmentAvailabilityState {
  if (!asg) return 'unavailable';
  const opensAt  = asg.opensAt  ? new Date(asg.opensAt)  : null;
  const dueAt    = asg.dueAt    ? new Date(asg.dueAt)    : null;
  const closesAt = asg.closesAt ? new Date(asg.closesAt) : null;

  if (opensAt  && now < opensAt)  return 'not_open';
  if (closesAt && now > closesAt) return 'closed';
  if (dueAt    && now > dueAt)    return 'due_passed';
  return 'open';
}

/**
 * Returns true when a student is enrolled in the assignment's course AND
 * the assignment has opened (not_open → blocked).
 */
function canStudentViewAssignment(asg: any, studentId: string, db: any, now: Date): boolean {
  if (!asg) return false;
  const state = getAssignmentAvailabilityState(asg, now);
  if (state === 'not_open') return false;
  return (db.enrollments || []).some(
    (e: any) => e.courseId === asg.courseId && e.studentId === studentId && e.status === 'active'
  );
}

/**
 * Returns {ok,error} for attempt creation eligibility (open + enrolled).
 * Delegates to getAssignmentAvailabilityState for date logic.
 */
function canStudentStartAttemptWithDates(asg: any, studentId: string, db: any, now: Date): { ok: boolean; error?: string } {
  if (!asg) return { ok: false, error: 'Assignment not found.' };
  const state = getAssignmentAvailabilityState(asg, now);
  if (state === 'not_open') return { ok: false, error: 'This lesson is not open yet.' };
  if (state === 'closed')   return { ok: false, error: 'This assignment is closed. Ask your teacher for help.' };
  const enrolled = (db.enrollments || []).some(
    (e: any) => e.courseId === asg.courseId && e.studentId === studentId && e.status === 'active'
  );
  if (!enrolled) return { ok: false, error: 'You are not enrolled in the course for this assignment.' };
  return { ok: true };
}

/**
 * Returns {ok,error} for resuming an in-progress attempt.
 * Closed assignments block resumption unless there is an existing completed attempt (review).
 */
function canStudentResumeAttempt(asg: any, attempt: any, studentId: string, now: Date): { ok: boolean; error?: string } {
  if (attempt.studentId !== studentId) return { ok: false, error: 'Access denied.' };
  if (!asg) return { ok: true }; // Legacy attempt with no assignment — allow resume
  const state = getAssignmentAvailabilityState(asg, now);
  if (state === 'not_open') return { ok: false, error: 'This assignment is not open yet.' };
  if (state === 'closed')   return { ok: false, error: 'This assignment is closed. Ask your teacher for help.' };
  return { ok: true };
}

// ==========================================
// Lesson Version Snapshot Helpers
// ==========================================

/**
 * Creates an immutable LessonVersion snapshot from the current lesson metadata + blocks.
 * Returns the new version object (already pushed into db.lessonVersions).
 * MUST be called within a commitDb write cycle.
 * Idempotent by checksum: if content is identical to the latest version, returns existing.
 */
function createLessonVersionSnapshot(
  lesson: any,
  blocks: any[],
  createdBy: string,
  db: any,
  publishNotes?: string
): any {
  if (!db.lessonVersions) db.lessonVersions = [];

  const sortedBlocks = [...blocks].sort((a: any, b: any) => a.order - b.order);
  const checksum = simpleHash(JSON.stringify({
    title: lesson.title,
    description: lesson.description,
    settings: lesson.settings,
    blocks: sortedBlocks,
  }));

  // Check for an existing published version with the same checksum (idempotent re-publish)
  const existing = db.lessonVersions.find(
    (v: any) => v.lessonId === lesson.id && v.status === 'published' && v.checksum === checksum
  );
  if (existing) {
    return existing;
  }

  // Increment version number
  const existingForLesson = db.lessonVersions.filter((v: any) => v.lessonId === lesson.id);
  const maxVersion = existingForLesson.reduce((max: number, v: any) => Math.max(max, v.versionNumber || 0), 0);
  const versionNumber = maxVersion + 1;

  const newVersion: any = {
    id: 'lv_' + Math.random().toString(36).substring(2, 9),
    lessonId: lesson.id,
    versionNumber,
    title: lesson.title,
    description: lesson.description,
    blocksSnapshot: JSON.parse(JSON.stringify(sortedBlocks)), // deep copy
    settings: JSON.parse(JSON.stringify(lesson.settings)),
    createdBy,
    createdAt: new Date().toISOString(),
    sourceLessonUpdatedAt: lesson.updatedAt || new Date().toISOString(),
    publishNotes: publishNotes || undefined,
    status: 'published',
    checksum,
  };

  db.lessonVersions.push(newVersion);
  return newVersion;
}

/**
 * Find a block and question in a version's blocksSnapshot.
 * Returns { block, rawOriginal } or null if not found.
 */
function resolveQuestionFromVersion(
  version: any,
  blockId: string,
  checkpointId: string | undefined,
  questionId: string
): { block: any; rawOriginal: any } | null {
  if (!version || !Array.isArray(version.blocksSnapshot)) return null;
  const block = version.blocksSnapshot.find((b: any) => b.id === blockId);
  if (!block) return null;

  let rawOriginal: any = null;
  if (checkpointId && Array.isArray(block.videoCheckpoints)) {
    const cp = block.videoCheckpoints.find((c: any) => c.id === checkpointId);
    if (cp) rawOriginal = (cp.questions || []).find((q: any) => q.id === questionId);
  } else {
    rawOriginal =
      block.singleQuestion ||
      (block.questionPool && block.questionPool.questions.find((q: any) => q.id === questionId));
  }

  if (!rawOriginal) return null;
  return { block, rawOriginal };
}

// Multer Storage Configuration for academic video uploads using Memory Storage for Firebase Storage direct stream
const uploadStorage = multer.memoryStorage();

const uploadVideo = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 600 * 1024 * 1024, // 600 MB maximum video upload threshold
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only raw video files (MP4, WebM, etc.) are allowed."));
    }
    cb(null, true);
  }
});

// Video Upload Route for block designer integrated with Firebase Storage
app.post("/api/video/upload", requireTeacher, uploadVideo.single("video"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No video file was uploaded." });
    return;
  }
  
  try {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname);
    const base = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${base}-${uniqueSuffix}${ext}`;

    let videoUrl = "";
    let storagePath = "";
    let uploadedToCloud = false;

    if (firebaseBucket) {
      try {
        const fileRef = firebaseBucket.file(`videos/${filename}`);
        await fileRef.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
          },
          resumable: false,
        });
        videoUrl = await getDownloadURL(fileRef);
        storagePath = `videos/${filename}`;
        uploadedToCloud = true;
      } catch (gcsErr: any) {
        console.warn("Firebase Storage upload failed (permission, bucket issue, or bucket not set up), falling back to local file path. Error:", gcsErr.message || gcsErr);
      }
    } else {
      console.log("Firebase Storage is not initialized, falling back directly to local upload.");
    }

    if (!uploadedToCloud) {
      // Fallback: save to UPLOADS_DIR and return local /uploads URL
      const localPath = path.join(UPLOADS_DIR, filename);
      await fs.promises.writeFile(localPath, req.file.buffer);
      videoUrl = `/uploads/${filename}`;
      storagePath = `uploads/${filename}`;
    }

    res.json({
      success: true,
      videoUrl,
      storagePath,
      filename,
      originalName: req.file.originalname,
      size: req.file.size,
      localFallback: !uploadedToCloud
    });
  } catch (err: any) {
    console.error("Local/Firebase fallback upload error:", err);
    res.status(500).json({ error: err.message || "Failed to process the uploaded video file." });
  }
});

// ==========================================
// Authentication Endpoints
// ==========================================
app.post("/api/auth/login", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    res.status(400).json({ error: "ID Token is required." });
    return;
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    const email = decodedToken.email?.toLowerCase();
    if (!email) {
      res.status(400).json({ error: "Invalid token payload: Email missing inside authenticating token." });
      return;
    }

    const db = readDb();

    const isAuthorized = email.endsWith(`@${ALLOWED_DOMAIN}`) || 
                         TEACHER_EMAILS.has(email) || 
                         AUTHORIZED_STUDENT_EMAILS.has(email) ||
                         isUserTeacher(email, db);
    if (!isAuthorized) {
      res.status(403).json({ error: "Access restricted to authorized Malvern Prep accounts. Contact your administrator if you believe this is an error." });
      return;
    }

    let user = db.users.find((u: any) => u.id === decodedToken.uid || u.email.toLowerCase() === email);

    if (!user) {
      // New users default to student. Teacher role dynamically checked.
      const isTeacher = isUserTeacher(email, db);
      user = {
        id: decodedToken.uid,
        name: decodedToken.name || email.split("@")[0].replace(/[._]/g, " "),
        email,
        role: isTeacher ? "teacher" : "student",
        createdAt: new Date().toISOString()
      };
      if (email === "stephenborish@gmail.com") {
        user.isSuperAdmin = true;
      }
      db.users.push(user);
      writeDb(db);
    } else {
      let changed = false;
      if (user.id !== decodedToken.uid) {
        user.id = decodedToken.uid;
        changed = true;
      }
      const isTeacher = isUserTeacher(email, db);
      if (isTeacher && user.role !== "teacher") {
        user.role = "teacher";
        changed = true;
      }
      if (email === "stephenborish@gmail.com" && !user.isSuperAdmin) {
        user.isSuperAdmin = true;
        changed = true;
      }
      if (changed) {
        writeDb(db);
      }
    }

    if (email === "stephenborish@gmail.com") {
      user.isSuperAdmin = true;
    }

    res.json({ user });
  } catch (error: any) {
    console.error("VERITAS Learn - Authentication failed:", error);
    res.status(401).json({ error: "Session verification failed. Please sign in with an authorized Google account." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ loggedIn: false });
    return;
  }
  res.json({ loggedIn: true, user });
});

// ==========================================
// Super Admin Endpoints
// ==========================================
const requireSuperAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = await getSessionUser(req);
  if (!user || user.email?.toLowerCase() !== "stephenborish@gmail.com") {
    res.status(403).json({ error: "Access denied. Super Admin privileges required." });
    return;
  }
  (req as any).user = user;
  next();
};

// Get approved dynamic teacher roster
app.get("/api/admin/teachers", requireSuperAdmin, (req, res) => {
  try {
    const db = readDb();
    res.json({ approvedTeachers: db.approvedTeachers || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to retrieve approved teachers roster." });
  }
});

// Add dynamic approved teacher
app.post("/api/admin/teachers", requireSuperAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email address is required." });
      return;
    }

    const emailLower = email.trim().toLowerCase();
    if (!emailLower || !emailLower.includes("@")) {
      res.status(400).json({ error: "Invalid email address format." });
      return;
    }

    const db = readDb();
    if (!db.approvedTeachers) db.approvedTeachers = [];

    const exists = db.approvedTeachers.some((t: any) => t.email.toLowerCase() === emailLower);
    if (exists) {
      res.status(400).json({ error: "Teacher with this email is already registered." });
      return;
    }

    const newTeacher = {
      id: "teacher_" + Math.random().toString(36).substring(2, 9),
      email: emailLower,
      addedBy: "stephenborish@gmail.com",
      addedAt: new Date().toISOString()
    };

    db.approvedTeachers.push(newTeacher);

    // Promote existing user doc in users collection to teacher
    const userDoc = db.users.find((u: any) => u.email.toLowerCase() === emailLower);
    if (userDoc && userDoc.role !== "teacher") {
      userDoc.role = "teacher";
    }

    await commitDb(db);
    res.json({ success: true, teacher: newTeacher });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add approved teacher." });
  }
});

// Delete approved teacher dynamic roster
app.delete("/api/admin/teachers", requireSuperAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email address is required." });
      return;
    }

    const emailLower = email.trim().toLowerCase();
    const db = readDb();
    if (!db.approvedTeachers) db.approvedTeachers = [];

    const initialLength = db.approvedTeachers.length;
    db.approvedTeachers = db.approvedTeachers.filter((t: any) => t.email.toLowerCase() !== emailLower);

    if (db.approvedTeachers.length === initialLength) {
      res.status(404).json({ error: "Email was not found in the approved teachers list." });
      return;
    }

    // Downgrade user's role to student if they are no longer in static TEACHER_EMAILS either
    const userDoc = db.users.find((u: any) => u.email.toLowerCase() === emailLower);
    if (userDoc && !TEACHER_EMAILS.has(emailLower) && emailLower !== "stephenborish@gmail.com") {
      userDoc.role = "student";
    }

    await commitDb(db);
    res.json({ success: true, email: emailLower });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to remove approved teacher." });
  }
});

// ==========================================
// Lessons & Content APIs
// ==========================================
// Fetch list of lessons
app.get("/api/lessons", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();

  let targetLessons: any[];
  if (user.role === "student") {
    // Students only see lessons that are assigned to a course they are actively enrolled in.
    // "Published" means available for teachers to assign — it does NOT grant global student visibility.
    // Additionally, only show lessons where at least one assignment has OPENED (opensAt <= now).
    // Upcoming-only lessons are not shown (no content before open date).
    const now = new Date();
    const activeEnrollments = (db.enrollments || []).filter(
      (e: any) => e.studentId === user.id && e.status === "active"
    );
    const enrolledCourseIds = new Set(activeEnrollments.map((e: any) => e.courseId));

    // Collect lesson IDs where at least one assignment for the student has opened or is open.
    // Upcoming assignments (not_open) do not make the lesson visible.
    const openAssignedLessonIds = new Set(
      (db.lessonAssignments || [])
        .filter((asg: any) => {
          if (!enrolledCourseIds.has(asg.courseId)) return false;
          const state = getAssignmentAvailabilityState(asg, now);
          // Include open, due_passed, closed (already opened). Exclude not_open (upcoming).
          return state !== 'not_open' && state !== 'unavailable';
        })
        .map((asg: any) => asg.lessonId)
    );

    targetLessons = db.lessons.filter(
      (l: any) => l.isPublished && openAssignedLessonIds.has(l.id)
    );
  } else {
    // Teachers see all their lessons regardless of publish status.
    targetLessons = db.lessons;
  }

  // Gather blocks structure count
  const result = targetLessons.map((lesson: any) => {
    const blocks = db.blocks.filter((b: any) => b.lessonId === lesson.id);
    return {
      ...lesson,
      blocksCount: blocks.length
    };
  });

  res.json({ lessons: result });
});

// Fetch detailed single lesson (and sanitize answer keys if requested by student!)
app.get("/api/lessons/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const { id } = req.params;
  const db = readDb();

  const lesson = db.lessons.find((l: any) => l.id === id);
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found." });
    return;
  }

  if (user.role === "student") {
    // Students must have an active assignment connecting this lesson to a course they are enrolled in,
    // AND that assignment must have opened (opensAt <= now). Upcoming assignments don't grant access.
    // Return 404 regardless of the real reason to avoid leaking whether the lesson exists.
    if (!lesson.isPublished) {
      res.status(404).json({ error: "Lesson not found." });
      return;
    }

    const now = new Date();
    const activeEnrollments = (db.enrollments || []).filter(
      (e: any) => e.studentId === user.id && e.status === "active"
    );
    const enrolledCourseIds = new Set(activeEnrollments.map((e: any) => e.courseId));

    const studentAssignments = (db.lessonAssignments || []).filter(
      (asg: any) => asg.lessonId === id && enrolledCourseIds.has(asg.courseId)
    );

    if (studentAssignments.length === 0) {
      res.status(404).json({ error: "Lesson not found." });
      return;
    }

    // Check that at least one assignment has opened (not_open = upcoming → blocked)
    const hasOpenedAssignment = studentAssignments.some((asg: any) => {
      const state = getAssignmentAvailabilityState(asg, now);
      return state !== 'not_open' && state !== 'unavailable';
    });

    if (!hasOpenedAssignment) {
      // All assignments are upcoming — don't expose lesson content
      const earliestOpen = studentAssignments
        .filter((asg: any) => asg.opensAt)
        .sort((a: any, b: any) => new Date(a.opensAt).getTime() - new Date(b.opensAt).getTime())[0];
      const openDateMsg = earliestOpen
        ? ` It will be available on ${new Date(earliestOpen.opensAt).toLocaleDateString()}.`
        : '';
      res.status(403).json({ error: `This lesson is not open yet.${openDateMsg}`, code: 'NOT_OPEN' });
      return;
    }
  }

  let blocks = db.blocks
    .filter((b: any) => b.lessonId === id)
    .sort((a: any, b: any) => a.order - b.order);

  // SECURITY: students or previewing teachers receive an explicitly sanitized payload — every embedded
  // question is stripped of correct answers, rubrics, model answers, AI scoring
  // guidance, and teacher notes (graded AND practice). Feedback is delivered
  // separately via the submit response when the feedback policy allows.
  if (user.role === "student" || req.query?.preview === "true") {
    blocks = sanitizeLessonBlocksForStudent(blocks);
    const leaks = findLeakedSecretFields(blocks);
    if (leaks.length > 0) {
      console.error("VERITAS Learn - SECURITY: sanitized lesson payload still leaked fields:", leaks);
      res.status(500).json({ error: "Sanitization failed." });
      return;
    }
  }

  res.json({ lesson, blocks });
});

// Teacher: Create Lesson
app.post("/api/lessons", requireTeacher, async (req, res) => {
  try {
    const db = readDb();
    const { title, description, courseId, estimatedMinutes, settings, blocks, isPublished } = req.body;

    const willPublish = isPublished ?? false;
    // Trusted re-validation: published lessons must contain valid graded questions.
    if (willPublish) validateLessonBlocks(blocks);

    const newLesson = {
      id: "lesson_" + Math.random().toString(36).substring(2, 9),
      title: title || "Untitled Lesson",
      description: description || "",
      courseId: courseId || "course_1",
      estimatedMinutes: Number(estimatedMinutes) || 30,
      isPublished: willPublish,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        restrictSeeking: settings?.restrictSeeking ?? true,
        requireFullscreen: settings?.requireFullscreen ?? true,
        allowRetakes: settings?.allowRetakes ?? false,
        randomizeChoices: settings?.randomizeChoices ?? true,
        immediateFeedback: settings?.immediateFeedback ?? false
      }
    };

    db.lessons.push(newLesson);

    if (Array.isArray(blocks)) {
      blocks.forEach((b: any, index: number) => {
        const bType = b.type;
        const rawBlock = {
          id: b.id || "block_" + Math.random().toString(36).substring(2, 9),
          lessonId: newLesson.id,
          order: index + 1,
          type: bType,
          title: b.title || `Segment ${index + 1}`,
          videoUrl: bType === "video" ? b.videoUrl : undefined,
          thumbnailUrl: bType === "video" ? b.thumbnailUrl : undefined,
          storagePath: bType === "video" ? b.storagePath : undefined,
          duration: bType === "video" ? (b.duration !== undefined ? Number(b.duration) : undefined) : undefined,
          videoCheckpoints: bType === "video" ? b.videoCheckpoints || [] : undefined,
          content: bType === "reading" ? b.content : undefined,
          questionType: bType === "question" ? b.questionType : undefined,
          isPractice: bType === "question" ? b.isPractice : undefined,
          questionPool: bType === "question" ? b.questionPool : undefined,
          singleQuestion: bType === "question" ? b.singleQuestion : undefined
        };
        // Normalize embedded questions to the stable choice-id model before persisting.
        db.blocks.push(migrateBlock(rawBlock));
      });
    }

    // If publishing for the first time, create an immutable version snapshot.
    if (willPublish) {
      const savedBlocks = db.blocks.filter((b: any) => b.lessonId === newLesson.id);
      const user = (req as any).user;
      const version = createLessonVersionSnapshot(newLesson, savedBlocks, user.id, db);
      const lessonIdx = db.lessons.findIndex((l: any) => l.id === newLesson.id);
      if (lessonIdx !== -1) {
        db.lessons[lessonIdx].currentPublishedVersionId = version.id;
        db.lessons[lessonIdx].publishedVersionCount = (db.lessonVersions || []).filter(
          (v: any) => v.lessonId === newLesson.id && v.status === 'published'
        ).length;
      }
    }

    await commitDb(db);
    const savedBlocks = db.blocks.filter((b: any) => b.lessonId === newLesson.id);
    res.status(201).json({ success: true, lesson: newLesson, blocks: savedBlocks });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Edit Lesson Title & Settings & Blocks
app.put("/api/lessons/:id", requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const db = readDb();

    const lessonIdx = db.lessons.findIndex((l: any) => l.id === id);
    if (lessonIdx === -1) {
      fail(res, "NOT_FOUND", "Lesson not found.");
      return;
    }

    const { title, description, estimatedMinutes, isPublished, settings, blocks } = req.body;

    const currentLesson = db.lessons[lessonIdx];
    const willPublish = isPublished ?? currentLesson.isPublished;
    if (willPublish && Array.isArray(blocks)) validateLessonBlocks(blocks);

    db.lessons[lessonIdx] = {
      ...currentLesson,
      title: title ?? currentLesson.title,
      description: description ?? currentLesson.description,
      estimatedMinutes: estimatedMinutes !== undefined ? Number(estimatedMinutes) : currentLesson.estimatedMinutes,
      isPublished: willPublish,
      updatedAt: new Date().toISOString(),
      settings: {
        restrictSeeking: settings?.restrictSeeking ?? currentLesson.settings.restrictSeeking,
        requireFullscreen: settings?.requireFullscreen ?? currentLesson.settings.requireFullscreen,
        allowRetakes: settings?.allowRetakes ?? currentLesson.settings.allowRetakes,
        randomizeChoices: settings?.randomizeChoices ?? currentLesson.settings.randomizeChoices,
        immediateFeedback: settings?.immediateFeedback ?? currentLesson.settings.immediateFeedback
      }
    };

    if (Array.isArray(blocks)) {
      // Replace this lesson's blocks.
      db.blocks = db.blocks.filter((b: any) => b.lessonId !== id);

      blocks.forEach((b: any, index: number) => {
        const bType = b.type;
        const rawBlock = {
          id: b.id || "block_" + Math.random().toString(36).substring(2, 9),
          lessonId: id,
          order: index + 1,
          type: bType,
          title: b.title || "Untitled block",
          videoUrl: bType === "video" ? b.videoUrl : undefined,
          thumbnailUrl: bType === "video" ? b.thumbnailUrl : undefined,
          storagePath: bType === "video" ? b.storagePath : undefined,
          duration: bType === "video" ? (b.duration !== undefined ? Number(b.duration) : undefined) : undefined,
          videoCheckpoints: bType === "video" ? b.videoCheckpoints || [] : undefined,
          content: bType === "reading" ? b.content : undefined,
          questionType: bType === "question" ? b.questionType : undefined,
          isPractice: bType === "question" ? b.isPractice : undefined,
          questionPool: bType === "question" ? b.questionPool : undefined,
          singleQuestion: bType === "question" ? b.singleQuestion : undefined
        };
        db.blocks.push(migrateBlock(rawBlock));
      });
    }

    // When publishing (isPublished set to true), create an immutable version snapshot.
    // Idempotent: if content hasn't changed, reuses the existing version (checksum match).
    if (willPublish) {
      const user = (req as any).user;
      const updatedBlocksForVersion = db.blocks.filter((b: any) => b.lessonId === id);
      const version = createLessonVersionSnapshot(db.lessons[lessonIdx], updatedBlocksForVersion, user.id, db);
      db.lessons[lessonIdx].currentPublishedVersionId = version.id;
      db.lessons[lessonIdx].publishedVersionCount = (db.lessonVersions || []).filter(
        (v: any) => v.lessonId === id && v.status === 'published'
      ).length;
    }

    await commitDb(db);
    const updatedBlocks = db.blocks.filter((b: any) => b.lessonId === id);
    res.json({ success: true, lesson: db.lessons[lessonIdx], blocks: updatedBlocks });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Explicitly publish a lesson — always creates a new version snapshot.
// Use this when you want to force a new version even if content hasn't changed.
app.post("/api/lessons/:id/publish", requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { publishNotes } = req.body;
    const user = (req as any).user;
    const db = readDb();

    const lessonIdx = db.lessons.findIndex((l: any) => l.id === id);
    if (lessonIdx === -1) {
      fail(res, "NOT_FOUND", "Lesson not found.");
      return;
    }

    const lesson = db.lessons[lessonIdx];
    const blocks = db.blocks.filter((b: any) => b.lessonId === id);

    // Validate readiness before creating a version
    try {
      validateLessonBlocks(blocks);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Lesson has validation errors. Fix them before publishing." });
      return;
    }

    // Force a new version (bypass checksum idempotency by clearing any cached checksum match)
    if (!db.lessonVersions) db.lessonVersions = [];
    const sortedBlocks = [...blocks].sort((a: any, b: any) => a.order - b.order);

    const existingVersions = db.lessonVersions.filter((v: any) => v.lessonId === id);
    const maxVersion = existingVersions.reduce((max: number, v: any) => Math.max(max, v.versionNumber || 0), 0);
    const versionNumber = maxVersion + 1;
    const checksum = simpleHash(JSON.stringify({
      title: lesson.title, description: lesson.description, settings: lesson.settings, blocks: sortedBlocks,
    }));

    const newVersion: any = {
      id: 'lv_' + Math.random().toString(36).substring(2, 9),
      lessonId: id,
      versionNumber,
      title: lesson.title,
      description: lesson.description,
      blocksSnapshot: JSON.parse(JSON.stringify(sortedBlocks)),
      settings: JSON.parse(JSON.stringify(lesson.settings)),
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      sourceLessonUpdatedAt: lesson.updatedAt || new Date().toISOString(),
      publishNotes: publishNotes || undefined,
      status: 'published',
      checksum,
    };

    db.lessonVersions.push(newVersion);

    db.lessons[lessonIdx] = {
      ...lesson,
      isPublished: true,
      currentPublishedVersionId: newVersion.id,
      publishedVersionCount: (db.lessonVersions || []).filter(
        (v: any) => v.lessonId === id && v.status === 'published'
      ).length,
      updatedAt: new Date().toISOString(),
    };

    await commitDb(db);
    res.json({ success: true, lesson: db.lessons[lessonIdx], version: newVersion });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: List all version snapshots for a lesson
app.get("/api/lessons/:id/versions", requireTeacher, (req, res) => {
  const { id } = req.params;
  const db = readDb();

  const lesson = db.lessons.find((l: any) => l.id === id);
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found." });
    return;
  }

  const versions = (db.lessonVersions || [])
    .filter((v: any) => v.lessonId === id)
    .sort((a: any, b: any) => a.versionNumber - b.versionNumber)
    .map((v: any) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      title: v.title,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      publishNotes: v.publishNotes,
      status: v.status,
      blockCount: Array.isArray(v.blocksSnapshot) ? v.blocksSnapshot.length : 0,
    }));

  res.json({ versions });
});

// Teacher: Duplicate a lesson
app.post("/api/lessons/:id/duplicate", requireTeacher, (req, res) => {
  const { id } = req.params;
  const db = readDb();

  const lesson = db.lessons.find((l: any) => l.id === id);
  if (!lesson) {
    res.status(404).json({ error: "Lesson to duplicate not found." });
    return;
  }

  const newId = "lesson_" + Math.random().toString(36).substring(2, 9);
  const dupLesson = {
    ...lesson,
    id: newId,
    title: `${lesson.title} (Copy)`,
    createdAt: new Date().toISOString(),
    isPublished: false
  };

  db.lessons.push(dupLesson);

  const originalBlocks = db.blocks.filter((b: any) => b.lessonId === id);
  originalBlocks.forEach((b: any) => {
    db.blocks.push({
      ...b,
      id: "block_" + Math.random().toString(36).substring(2, 9),
      lessonId: newId
    });
  });

  writeDb(db);
  res.json({ success: true, duplicatedLessonId: newId });
});

// Teacher: Archive/Delete Lesson
app.delete("/api/lessons/:id", requireTeacher, (req, res) => {
  const { id } = req.params;
  const db = readDb();

  db.lessons = db.lessons.filter((l: any) => l.id !== id);
  db.blocks = db.blocks.filter((b: any) => b.lessonId !== id);
  if (db.lessonAssignments) {
    db.lessonAssignments = db.lessonAssignments.filter((asg: any) => asg.lessonId !== id);
  }
  // Discard associated drafts
  if (db.lessonDrafts) {
    const now = new Date().toISOString();
    db.lessonDrafts = db.lessonDrafts.map((d: any) =>
      d.lessonId === id && d.status === "active"
        ? { ...d, status: "discarded", updatedAt: now }
        : d
    );
  }
  // Keep attempts for record consistency unless necessary to delete
  writeDb(db);

  res.json({ success: true });
});

// ==========================================
// Lesson Draft APIs
// Teacher-only. Drafts may contain answer keys & rubric data — treat like answer keys.
// ==========================================

// GET /api/lessons/:lessonId/draft — retrieve active draft for the authenticated teacher
app.get("/api/lessons/:lessonId/draft", requireTeacher, (req, res) => {
  const { lessonId } = req.params;
  const user = (req as any).user;
  const db = readDb();

  const drafts: any[] = db.lessonDrafts || [];
  const draft = drafts.find((d: any) =>
    d.lessonId === lessonId &&
    d.teacherId === user.id &&
    d.status === "active"
  );

  res.json({ draft: draft || null });
});

// POST /api/lessons/:lessonId/draft — upsert the teacher's draft for a lesson
app.post("/api/lessons/:lessonId/draft", requireTeacher, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const user = (req as any).user;
    const { draftPayload, baseLessonUpdatedAt } = req.body;

    if (!draftPayload || typeof draftPayload !== "object") {
      res.status(400).json({ error: "draftPayload is required." });
      return;
    }

    // For existing lessons, verify the lesson exists before accepting a draft
    if (lessonId !== "new") {
      const db = readDb();
      const lesson = db.lessons.find((l: any) => l.id === lessonId);
      if (!lesson) {
        res.status(404).json({ error: "Lesson not found." });
        return;
      }
    }

    const db = readDb();
    if (!db.lessonDrafts) db.lessonDrafts = [];

    const now = new Date().toISOString();
    const existingIdx = db.lessonDrafts.findIndex((d: any) =>
      d.lessonId === lessonId &&
      d.teacherId === user.id &&
      d.status === "active"
    );

    if (existingIdx !== -1) {
      db.lessonDrafts[existingIdx] = {
        ...db.lessonDrafts[existingIdx],
        draftPayload,
        baseLessonUpdatedAt: baseLessonUpdatedAt || db.lessonDrafts[existingIdx].baseLessonUpdatedAt,
        updatedAt: now
      };
      await commitDb(db);
      res.json({ success: true, draft: db.lessonDrafts[existingIdx] });
    } else {
      const newDraft = {
        id: "draft_" + Math.random().toString(36).substring(2, 9),
        lessonId,
        teacherId: user.id,
        draftPayload,
        baseLessonUpdatedAt: baseLessonUpdatedAt || now,
        createdAt: now,
        updatedAt: now,
        status: "active"
      };
      db.lessonDrafts.push(newDraft);
      await commitDb(db);
      res.json({ success: true, draft: newDraft });
    }
  } catch (err) {
    sendAppError(res, err);
  }
});

// DELETE /api/lessons/:lessonId/draft — discard the teacher's active draft
app.delete("/api/lessons/:lessonId/draft", requireTeacher, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const user = (req as any).user;
    const db = readDb();

    if (!db.lessonDrafts) {
      res.json({ success: true });
      return;
    }

    const draftIdx = db.lessonDrafts.findIndex((d: any) =>
      d.lessonId === lessonId &&
      d.teacherId === user.id &&
      d.status === "active"
    );

    if (draftIdx === -1) {
      res.json({ success: true });
      return;
    }

    db.lessonDrafts[draftIdx] = {
      ...db.lessonDrafts[draftIdx],
      status: "discarded",
      updatedAt: new Date().toISOString()
    };

    await commitDb(db);
    res.json({ success: true });
  } catch (err) {
    sendAppError(res, err);
  }
});

// POST /api/lessons/:lessonId/draft/restore — mark draft as restored and return payload
app.post("/api/lessons/:lessonId/draft/restore", requireTeacher, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const user = (req as any).user;
    const db = readDb();

    if (!db.lessonDrafts) {
      res.status(404).json({ error: "No draft found." });
      return;
    }

    const draftIdx = db.lessonDrafts.findIndex((d: any) =>
      d.lessonId === lessonId &&
      d.teacherId === user.id &&
      d.status === "active"
    );

    if (draftIdx === -1) {
      res.status(404).json({ error: "No active draft found." });
      return;
    }

    db.lessonDrafts[draftIdx] = {
      ...db.lessonDrafts[draftIdx],
      status: "restored",
      updatedAt: new Date().toISOString()
    };

    await commitDb(db);
    res.json({ success: true, draftPayload: db.lessonDrafts[draftIdx].draftPayload });
  } catch (err) {
    sendAppError(res, err);
  }
});

// ==========================================
// Course / Section APIs
// ==========================================

// Teacher: List all courses for this teacher
app.get("/api/courses", requireTeacher, (req, res) => {
  const user = (req as any).user;
  const db = readDb();
  const courses = db.courses.filter((c: any) => c.teacherId === user.id);
  res.json({ courses });
});

// Teacher: Create a new course/section
app.post("/api/courses", requireTeacher, async (req, res) => {
  try {
    const user = (req as any).user;
    const { name, sectionName, schoolYear } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Course name is required." });
      return;
    }

    const db = readDb();

    // Generate unique join code with course abbreviation prefix
    const prefix = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "CRS";
    let joinCode = generateJoinCode(prefix);
    // Ensure uniqueness
    const existingCodes = new Set((db.courses || []).map((c: any) => c.joinCode));
    let attempts = 0;
    while (existingCodes.has(joinCode) && attempts < 10) {
      joinCode = generateJoinCode(prefix);
      attempts++;
    }

    const now = new Date().toISOString();
    const newCourse = {
      id: "course_" + Math.random().toString(36).substring(2, 9),
      teacherId: user.id,
      name: name.trim(),
      sectionName: sectionName?.trim() || "",
      schoolYear: schoolYear?.trim() || "",
      status: "active",
      joinCode,
      joinCodeEnabled: true,
      createdAt: now,
      updatedAt: now,
    };

    db.courses.push(newCourse);
    await commitDb(db);
    res.status(201).json({ success: true, course: newCourse });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Update a course
app.put("/api/courses/:id", requireTeacher, async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { name, sectionName, schoolYear, status } = req.body;
    const db = readDb();

    const idx = db.courses.findIndex((c: any) => c.id === id && c.teacherId === user.id);
    if (idx === -1) {
      res.status(404).json({ error: "Course not found." });
      return;
    }

    if (name !== undefined) db.courses[idx].name = name.trim();
    if (sectionName !== undefined) db.courses[idx].sectionName = sectionName.trim();
    if (schoolYear !== undefined) db.courses[idx].schoolYear = schoolYear.trim();
    if (status !== undefined) db.courses[idx].status = status;
    db.courses[idx].updatedAt = new Date().toISOString();

    await commitDb(db);
    res.json({ success: true, course: db.courses[idx] });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Regenerate join code
app.post("/api/courses/:id/regenerate-code", requireTeacher, async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const db = readDb();

    const idx = db.courses.findIndex((c: any) => c.id === id && c.teacherId === user.id);
    if (idx === -1) {
      res.status(404).json({ error: "Course not found." });
      return;
    }

    const prefix = db.courses[idx].name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "CRS";
    const existingCodes = new Set((db.courses || []).map((c: any, i: number) => i !== idx ? c.joinCode : null).filter(Boolean));
    let joinCode = generateJoinCode(prefix);
    let tries = 0;
    while (existingCodes.has(joinCode) && tries < 10) {
      joinCode = generateJoinCode(prefix);
      tries++;
    }

    db.courses[idx].joinCode = joinCode;
    db.courses[idx].joinCodeEnabled = true;
    db.courses[idx].updatedAt = new Date().toISOString();

    await commitDb(db);
    res.json({ success: true, joinCode });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Enable or disable join code
app.post("/api/courses/:id/toggle-join-code", requireTeacher, async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { enabled } = req.body;
    const db = readDb();

    const idx = db.courses.findIndex((c: any) => c.id === id && c.teacherId === user.id);
    if (idx === -1) {
      res.status(404).json({ error: "Course not found." });
      return;
    }

    db.courses[idx].joinCodeEnabled = !!enabled;
    db.courses[idx].updatedAt = new Date().toISOString();

    await commitDb(db);
    res.json({ success: true, joinCodeEnabled: db.courses[idx].joinCodeEnabled });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: List enrolled students for a course
app.get("/api/courses/:id/enrollments", requireTeacher, (req, res) => {
  const user = (req as any).user;
  const { id } = req.params;
  const db = readDb();

  const course = db.courses.find((c: any) => c.id === id && c.teacherId === user.id);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }

  const enrollments = (db.enrollments || []).filter(
    (e: any) => e.courseId === id && e.status === "active"
  );
  res.json({ enrollments });
});

// Teacher: Remove a student enrollment
app.delete("/api/courses/:id/enrollments/:enrollmentId", requireTeacher, async (req, res) => {
  try {
    const user = (req as any).user;
    const { id, enrollmentId } = req.params;
    const db = readDb();

    const course = db.courses.find((c: any) => c.id === id && c.teacherId === user.id);
    if (!course) {
      res.status(404).json({ error: "Course not found." });
      return;
    }

    const eIdx = db.enrollments.findIndex((e: any) => e.id === enrollmentId && e.courseId === id);
    if (eIdx === -1) {
      res.status(404).json({ error: "Enrollment not found." });
      return;
    }

    db.enrollments[eIdx].status = "removed";
    db.enrollments[eIdx].removedAt = new Date().toISOString();
    db.enrollments[eIdx].removedBy = user.id;

    await commitDb(db);
    res.json({ success: true });
  } catch (err) {
    sendAppError(res, err);
  }
});

// ==========================================
// Student Enrollment APIs
// ==========================================

// Student: Join a course by join code
app.post("/api/enrollments/join", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;

    // Students only
    if (user.role === "teacher") {
      res.status(403).json({ error: "Teachers do not enroll in courses." });
      return;
    }

    const { joinCode } = req.body;
    if (!joinCode || typeof joinCode !== "string") {
      res.status(400).json({ error: "Join code is required." });
      return;
    }

    // Domain verification: require school email, allowed external student tester email, or allowlisted teacher email
    const emailLower = user.email.toLowerCase();
    const emailDomain = emailLower.split("@")[1] || "";
    const db = readDb();
    const isAllowedToEnroll = emailDomain === ALLOWED_DOMAIN || 
                              isUserTeacher(emailLower, db) || 
                              AUTHORIZED_STUDENT_EMAILS.has(emailLower);
    if (!isAllowedToEnroll) {
      res.status(403).json({
        error: "Use your Malvern Prep Google account or an authorized student register email to join this course.",
        code: "DOMAIN_MISMATCH",
      });
      return;
    }

    const normalizedCode = joinCode.trim().toUpperCase();

    // Find the course with this join code
    const course = db.courses.find(
      (c: any) => c.joinCode?.toUpperCase() === normalizedCode && c.status === "active"
    );

    if (!course) {
      res.status(404).json({
        error: "That code was not found. Check the code and try again.",
        code: "INVALID_CODE",
      });
      return;
    }

    if (!course.joinCodeEnabled) {
      res.status(403).json({
        error: "This join code has been disabled by your teacher.",
        code: "CODE_DISABLED",
      });
      return;
    }

    // Check if already enrolled
    if (!db.enrollments) db.enrollments = [];
    const existing = db.enrollments.find(
      (e: any) => e.courseId === course.id && e.studentId === user.id && e.status === "active"
    );

    if (existing) {
      res.status(409).json({
        error: "You are already enrolled in this course.",
        code: "ALREADY_ENROLLED",
        courseId: course.id,
        courseName: course.name,
        sectionName: course.sectionName,
      });
      return;
    }

    // Re-activate a previously removed enrollment instead of creating a duplicate
    const removedEnrollment = db.enrollments.find(
      (e: any) => e.courseId === course.id && e.studentId === user.id && e.status === "removed"
    );

    if (removedEnrollment) {
      const rIdx = db.enrollments.findIndex((e: any) => e.id === removedEnrollment.id);
      db.enrollments[rIdx].status = "active";
      db.enrollments[rIdx].enrolledAt = new Date().toISOString();
      delete db.enrollments[rIdx].removedAt;
      delete db.enrollments[rIdx].removedBy;
      await commitDb(db);
      res.json({
        success: true,
        enrollment: db.enrollments[rIdx],
        courseId: course.id,
        courseName: course.name,
        sectionName: course.sectionName,
      });
      return;
    }

    const newEnrollment = {
      id: "enr_" + Math.random().toString(36).substring(2, 9),
      courseId: course.id,
      studentId: user.id,
      studentEmail: user.email,
      studentName: user.name,
      status: "active",
      enrolledAt: new Date().toISOString(),
    };

    db.enrollments.push(newEnrollment);
    await commitDb(db);

    res.status(201).json({
      success: true,
      enrollment: newEnrollment,
      courseId: course.id,
      courseName: course.name,
      sectionName: course.sectionName,
    });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Student: List my enrollments
app.get("/api/enrollments", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();

  if (user.role === "teacher") {
    // Teachers see all enrollments across their courses
    const teacherCourseIds = new Set(
      db.courses.filter((c: any) => c.teacherId === user.id).map((c: any) => c.id)
    );
    const enrollments = (db.enrollments || []).filter((e: any) => teacherCourseIds.has(e.courseId));
    res.json({ enrollments });
    return;
  }

  const enrollments = (db.enrollments || []).filter(
    (e: any) => e.studentId === user.id && e.status === "active"
  );

  // Enrich with course info
  const enriched = enrollments.map((e: any) => {
    const course = db.courses.find((c: any) => c.id === e.courseId);
    return {
      ...e,
      courseName: course?.name || "Unknown Course",
      sectionName: course?.sectionName || "",
      courseStatus: course?.status || "active",
    };
  });

  res.json({ enrollments: enriched });
});

// ==========================================
// Lesson Assignments APIs
// ==========================================

// Fetch lesson assignments (All for teachers; enrollment-filtered for students)
app.get("/api/assignments", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();
  const nowDate = new Date();

  let list = db.lessonAssignments || [];

  // For students: filter strictly to assignments in courses they are actively enrolled in.
  // There is no unknown-course fallback — assignments are only visible when the student
  // has a real active enrollment in the assignment's course.
  if (user.role === "student") {
    const activeEnrollments = (db.enrollments || []).filter(
      (e: any) => e.studentId === user.id && e.status === "active"
    );
    const enrolledCourseIds = new Set(activeEnrollments.map((e: any) => e.courseId));

    list = list.filter((asg: any) => enrolledCourseIds.has(asg.courseId));
  }

  const enrichedList = list.map((asg: any) => {
    const lesson = db.lessons.find((l: any) => l.id === asg.lessonId);
    const course = db.courses.find((c: any) => c.id === asg.courseId);

    const base = {
      ...asg,
      lessonTitle: lesson ? lesson.title : "Unknown Lesson",
      lessonDescription: lesson ? lesson.description : "",
      lessonEstimatedMinutes: lesson ? lesson.estimatedMinutes : 30,
      lessonSettings: lesson ? lesson.settings : null,
      lessonIsPublished: lesson ? lesson.isPublished : false,
      courseTitle: course ? course.name : asg.courseId || "",
      sectionName: course ? course.sectionName : (asg.section || ""),
    };

    if (user.role !== "student") return base;

    // Find student's attempt for this assignment
    const attempt = db.attempts.find((a: any) =>
      a.studentId === user.id &&
      !a.isPreviewAttempt &&
      (asg.id && a.assignmentId ? a.assignmentId === asg.id : a.lessonId === asg.lessonId)
    );

    // Compute student-facing access metadata.
    const opensAt = asg.opensAt ? new Date(asg.opensAt) : null;
    const dueAt = asg.dueAt ? new Date(asg.dueAt) : null;
    const closesAt = asg.closesAt ? new Date(asg.closesAt) : null;

    const isUpcoming = opensAt !== null && nowDate < opensAt;
    const isClosed = closesAt !== null && nowDate > closesAt;
    const isPastDue = dueAt !== null && nowDate > dueAt;
    const isCurrentlyOpen =
      (opensAt === null || nowDate >= opensAt) &&
      (closesAt === null || nowDate <= closesAt);

    const isCompleted = attempt?.status === "completed";
    const isLocked = attempt?.lockState === "locked_awaiting_teacher";
    const isInProgress = attempt && attempt.status === "started";
    const needsReview = attempt?.securityReviewRequired === true;

    let accessState: string;
    let canBegin = false;
    let canResume = false;
    let canReview = false;
    let reason: string | undefined;

    if (isCompleted) {
      accessState = "completed";
      canReview = true;
    } else if (isLocked) {
      accessState = "locked";
      reason = "Your attempt requires teacher review before you can continue.";
    } else if (isUpcoming) {
      accessState = "upcoming";
      reason = "This assignment has not opened yet.";
    } else if (isClosed && !isInProgress) {
      accessState = "closed";
      reason = "This assignment is no longer accepting submissions.";
    } else if (needsReview && isInProgress) {
      accessState = "needs_review";
    } else if (isInProgress) {
      accessState = isPastDue ? "past_due" : "in_progress";
      canResume = true;
    } else if (isCurrentlyOpen && isPastDue) {
      accessState = "past_due";
      canBegin = true;
    } else if (isCurrentlyOpen) {
      accessState = "open";
      canBegin = true;
    } else {
      accessState = "open";
      canBegin = true;
    }

    let primaryAction: string = "none";
    if (canResume) primaryAction = "resume";
    else if (canBegin) primaryAction = "begin";
    else if (canReview) primaryAction = "review";

    return {
      ...base,
      accessState,
      canBegin,
      canResume,
      canReview,
      primaryAction,
      ...(reason ? { reason } : {}),
      ...(attempt ? {
        attemptId: attempt.id,
        attemptStatus: attempt.status,
        lastActiveAt: attempt.lastActiveAt,
        completedAt: attempt.completedAt,
        progress: attempt.currentBlockIndex,
        securityReviewRequired: attempt.securityReviewRequired,
      } : {}),
    };
  });

  res.json({ assignments: enrichedList });
});

// Teacher: Create a new lesson assignment
app.post("/api/assignments", requireTeacher, async (req, res) => {
  try {
    const user = (req as any).user;
    const db = readDb();
    const { lessonId, courseId, section, opensAt, dueAt, closesAt, integrityPolicy } = req.body;

    if (!lessonId || !courseId || !opensAt || !dueAt || !closesAt) {
      res.status(400).json({ error: "Missing required assignment parameters." });
      return;
    }

    // Validate that courseId refers to a real course (no free-text or unknown course ids)
    const course = db.courses.find((c: any) => c.id === courseId);
    if (!course) {
      res.status(400).json({ error: "The selected course does not exist." });
      return;
    }

    // Validate teacher owns or has access to this course (supports single teacherId OR teacherIds array)
    if (!teacherCanManageCourse(user.id, course, !!user.isSuperAdmin)) {
      res.status(403).json({ error: "You do not have access to this course." });
      return;
    }

    // Validate course is not archived
    if (course.archivedAt) {
      res.status(400).json({ error: "Cannot assign to an archived course." });
      return;
    }

    // Validate the lesson exists and is published before assigning
    const lesson = db.lessons.find((l: any) => l.id === lessonId);
    if (!lesson) {
      res.status(404).json({ error: "Selected lesson not found." });
      return;
    }
    if (!lesson.isPublished) {
      res.status(400).json({ error: "Only published lessons can be assigned. Publish the lesson first." });
      return;
    }

    // Bind the assignment to the current published version (immutable after creation).
    // If no version exists yet (legacy lesson published before versioning), create one now.
    let lessonVersionId: string | null = lesson.currentPublishedVersionId || null;
    if (!lessonVersionId) {
      const blocks = db.blocks.filter((b: any) => b.lessonId === lessonId);
      const version = createLessonVersionSnapshot(lesson, blocks, user.id, db);
      lessonVersionId = version.id;
      const lessonIdx2 = db.lessons.findIndex((l: any) => l.id === lessonId);
      if (lessonIdx2 !== -1) {
        db.lessons[lessonIdx2].currentPublishedVersionId = lessonVersionId;
        db.lessons[lessonIdx2].publishedVersionCount = (db.lessonVersions || []).filter(
          (v: any) => v.lessonId === lessonId && v.status === 'published'
        ).length;
      }
    }

    const now = new Date().toISOString();
    const compiledPolicy = compileIntegrityPolicy(integrityPolicy || { preset: "open" });

    const newAssignment: any = {
      id: "asg_" + Math.random().toString(36).substring(2, 9),
      lessonId,
      lessonVersionId,
      teacherId: user.id,
      courseId,
      section: section || "",
      opensAt,
      dueAt,
      closesAt,
      integrityPolicy: compiledPolicy,
      createdAt: now,
      updatedAt: now,
    };

    if (!db.lessonAssignments) {
      db.lessonAssignments = [];
    }
    db.lessonAssignments.push(newAssignment);

    await commitDb(db);
    res.status(201).json({ success: true, assignment: newAssignment });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create assignment." });
  }
});

// Teacher: Delete an existing lesson assignment
app.delete("/api/assignments/:id", requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const db = readDb();

    if (!db.lessonAssignments) {
      db.lessonAssignments = [];
    }

    const exists = db.lessonAssignments.some((asg: any) => asg.id === id);
    if (!exists) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }

    db.lessonAssignments = db.lessonAssignments.filter((asg: any) => asg.id !== id);
    await commitDb(db);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to delete assignment." });
  }
});

// ==========================================
// Student Progress and Player Execution APIs
// ==========================================

/**
 * Return the canonical video duration in seconds for a block.
 * Prefers `duration` (the current field); falls back to legacy `videoDuration`
 * if present, so existing records that used the old field still enforce correctly.
 */
function getBlockDurationSeconds(block: any): number | null {
  const d = block?.duration ?? block?.videoDuration;
  return typeof d === "number" && d > 0 ? d : null;
}

/**
 * Build a single deterministic, student-safe question assignment.
 * The question is migrated (stable choice ids), choices are optionally scrambled
 * deterministically, and the delivered snapshot is sanitized (no answer keys).
 */
function buildQuestionAssignment(
  attemptId: string,
  block: any,
  checkpointId: string | undefined,
  rawQuestion: any,
  idSuffix: string,
  randomizeChoices: boolean,
  randFn: () => number
): any {
  const q = migrateQuestionDefinition(rawQuestion);
  let deliveredChoices = Array.isArray(q.choices) ? [...q.choices] : undefined;
  if (deliveredChoices && randomizeChoices) {
    deliveredChoices = shuffleWithSeed(deliveredChoices, randFn);
  }
  // Sanitize, delivering the (possibly scrambled) id-stable choice order.
  const selectedQuestion = sanitizeQuestionForStudent(q, deliveredChoices);
  return {
    id: `asgn_${attemptId}_${idSuffix}`,
    attemptId,
    blockId: block.id,
    ...(checkpointId ? { checkpointId } : {}),
    questionId: q.id,
    selectedQuestion,
    scrambledChoices: selectedQuestion.choices,
  };
}

// List all attempts for the logged-in student (or all attempts for teachers) (excludes preview attempts by default)
app.get("/api/student/performance", requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const db = readDb();

    // 1. Get all attempts for this student (excluding previews)
    const studentAttempts = (db.attempts || []).filter(
      (a: any) => a.studentId === user.id && !a.isPreviewAttempt
    );

    const completedAttempts = studentAttempts.filter((a: any) => a.status === "completed" || a.completedAt);
    const completedCount = completedAttempts.length;

    // 2. Average accuracy across all completed efforts
    let totalScore = 0;
    let totalMaxScore = 0;

    completedAttempts.forEach((attempt: any) => {
      const attemptResponses = (db.responses || []).filter((r: any) => {
        if (r.attemptId !== attempt.id) return false;
        const cat = r.gradebookCategory ?? r.gradingMode;
        if (cat === undefined) return true;
        return cat === "assessment";
      });
      const score = attemptResponses.reduce((sum: number, r: any) => sum + (r.score || 0), 0);

      // Calculate max points for this lesson
      const lessonBlocks = (db.blocks || []).filter((b: any) => b.lessonId === attempt.lessonId);
      const maxScore = lessonBlocks.reduce((sum: number, b: any) => {
        if (b.type !== "question" || b.isPractice) return sum;
        if (b.singleQuestion) return sum + (b.singleQuestion.points || 0);
        if (b.questionPool) {
          const perQ = b.questionPool.questions?.[0]?.points || 0;
          return sum + perQ * (b.questionPool.numToSelect || 1);
        }
        return sum;
      }, 0);

      totalScore += score;
      totalMaxScore += maxScore;
    });

    const averageAccuracy = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : null;

    // 3. Upcoming deadlines
    let list = db.lessonAssignments || [];
    const activeEnrollments = (db.enrollments || []).filter(
      (e: any) => e.studentId === user.id && e.status === "active"
    );
    const enrolledCourseIds = new Set(activeEnrollments.map((e: any) => e.courseId));
    const knownCourseIds = new Set((db.courses || []).map((c: any) => c.id));

    list = list.filter((asg: any) => {
      if (!knownCourseIds.has(asg.courseId)) return true;
      return enrolledCourseIds.has(asg.courseId);
    });

    const now = new Date();
    const upcomingDeadlines = list
      .filter((asg: any) => {
        if (!asg.dueAt) return false;
        const due = new Date(asg.dueAt);
        if (due < now) return false;
        
        // Filter elements already completed
        const alreadyCompleted = completedAttempts.some(
          (a: any) => asg.id && a.assignmentId ? a.assignmentId === asg.id : a.lessonId === asg.lessonId
        );
        return !alreadyCompleted;
      })
      .map((asg: any) => {
        const lesson = (db.lessons || []).find((l: any) => l.id === asg.lessonId);
        return {
          id: asg.id,
          lessonTitle: lesson ? lesson.title : "Unknown Lesson",
          dueAt: asg.dueAt
        };
      })
      .sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    res.json({
      completedCount,
      averageAccuracy,
      upcomingDeadlines
    });
  } catch (err) {
    sendAppError(res, err);
  }
});

app.get("/api/attempts", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();
  let attempts: any[];
  if (user.role === "teacher") {
    attempts = db.attempts.filter((a: any) => !a.isPreviewAttempt);
  } else {
    attempts = db.attempts
      .filter((a: any) => a.studentId === user.id && !a.isPreviewAttempt)
      .map(sanitizeAttemptForStudent);
  }
  res.json({ attempts });
});

// Teacher: Start or resume a teacher preview/test attempt
app.post("/api/teacher/lessons/:lessonId/preview-attempt", requireTeacher, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const user = (req as any).user;
    const db = readDb();

    const lesson = db.lessons.find((l: any) => l.id === lessonId);
    if (!lesson) {
      fail(res, "NOT_FOUND", "Lesson not found.");
      return;
    }

    // See if there's an existing started preview attempt for this teacher
    const existingAttempts = db.attempts.filter((a: any) => 
      a.lessonId === lessonId && 
      a.studentId === user.id && 
      a.isPreviewAttempt === true
    );
    const activeAttempt = existingAttempts.find((a: any) => a.status === "started");

    if (activeAttempt) {
      res.json({ attempt: activeAttempt });
      return;
    }

    // Create a new preview attempt with preview/test flags
    const seed = Math.floor(Math.random() * 900000) + 100000;
    const newAttempt = {
      id: "attempt_preview_" + Math.random().toString(36).substring(2, 9),
      lessonId,
      studentId: user.id,
      seed,
      startedAt: new Date().toISOString(),
      status: "started",
      currentBlockIndex: 0,
      furthestVideoTimestamps: {},
      activeTimeSpent: 0,
      inactiveTimeSpent: 0,
      attemptMode: "preview",
      isPreviewAttempt: true,
      previewOwnerTeacherId: user.id,
      excludeFromAnalytics: true
    };

    db.attempts.push(newAttempt);

    // Generate and lock deterministic, sanitized question assignments.
    const randFn = lcg(seed);
    const randomize = !!lesson.settings.randomizeChoices;
    const lessonBlocks = db.blocks.filter((b: any) => b.lessonId === lessonId);

    lessonBlocks.forEach((block: any) => {
      if (block.type === "question") {
        if (block.singleQuestion) {
          db.questionAssignments.push(
            buildQuestionAssignment(newAttempt.id, block, undefined, block.singleQuestion, block.id, randomize, randFn)
          );
        } else if (block.questionPool && Array.isArray(block.questionPool.questions)) {
          const shuffledPool = shuffleWithSeed(block.questionPool.questions, randFn);
          const count = Math.min(block.questionPool.numToSelect || 1, shuffledPool.length);
          shuffledPool.slice(0, count).forEach((q: any, qi: number) => {
            db.questionAssignments.push(
              buildQuestionAssignment(newAttempt.id, block, undefined, q, `${block.id}_p${qi}`, randomize, randFn)
            );
          });
        }
      }

      if (block.type === "video" && Array.isArray(block.videoCheckpoints)) {
        block.videoCheckpoints.forEach((cp: any) => {
          const shuffledCpQuestions = shuffleWithSeed(cp.questions || [], randFn);
          const cpCount = Math.min(cp.numToSelect || 1, shuffledCpQuestions.length);
          shuffledCpQuestions.slice(0, cpCount).forEach((q: any, qi: number) => {
            db.questionAssignments.push(
              buildQuestionAssignment(newAttempt.id, block, cp.id, q, `${block.id}_cp_${cp.id}_q${qi}`, randomize, randFn)
            );
          });
        });
      }
    });

    // Defensive check
    const myAssignments = db.questionAssignments.filter((a: any) => a.attemptId === newAttempt.id);
    const leaks = findLeakedSecretFields(myAssignments);
    if (leaks.length > 0) {
      console.error("VERITAS Learn - SECURITY: question assignment leaked fields:", leaks);
      fail(res, "VALIDATION_ERROR", "Question delivery sanitization failed.");
      return;
    }

    await commitDb(db);
    res.status(201).json({ attempt: newAttempt });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Start Lesson Attempt (deterministic seed questions generation) (excludes preview attempts)
app.post("/api/attempts", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { lessonId, assignmentId } = req.body;
    const db = readDb();
    const nowIso = new Date().toISOString();

    // --- Assignment-aware eligibility check ---
    // Students must provide an assignmentId that references an open, published assignment.
    // Enrollment is verified server-side: only enrolled students may begin.
    let resolvedLessonId: string = lessonId;
    let resolvedAssignmentId: string | null = null;

    const nowDate = new Date();

    if (user.role === "student") {
      const lessonAssignments = db.lessonAssignments || [];

      if (assignmentId) {
        const asg = lessonAssignments.find((a: any) => a.id === assignmentId);
        if (!asg) {
          fail(res, "NOT_FOUND", "Assignment not found.");
          return;
        }
        // Use centralized helper for date + enrollment check
        const eligibility = canStudentStartAttemptWithDates(asg, user.id, db, nowDate);
        if (!eligibility.ok) {
          fail(res, "FORBIDDEN", eligibility.error || "You cannot start this assignment.");
          return;
        }

        resolvedLessonId = asg.lessonId;
        resolvedAssignmentId = asg.id;
      } else {
        // Legacy path: lessonId only — find the first open assignment for this lesson.
        // Enrollment is still required — there is no unknown-course bypass.
        const openAsg = lessonAssignments.find((a: any) => {
          if (a.lessonId !== (lessonId || resolvedLessonId)) return false;
          const state = getAssignmentAvailabilityState(a, nowDate);
          return state === 'open' || state === 'due_passed';
        });
        if (!openAsg) {
          fail(res, "FORBIDDEN", "No open assignment found for this lesson. Begin from your assignment dashboard.");
          return;
        }

        const legacyEligibility = canStudentStartAttemptWithDates(openAsg, user.id, db, nowDate);
        if (!legacyEligibility.ok) {
          fail(res, "FORBIDDEN", legacyEligibility.error || "You cannot start this assignment.");
          return;
        }

        resolvedLessonId = openAsg.lessonId;
        resolvedAssignmentId = openAsg.id;
      }
    } else {
      // Teachers can create attempts by lessonId for administrative purposes.
      resolvedLessonId = lessonId;
      resolvedAssignmentId = assignmentId || null;
    }

    const lesson = db.lessons.find((l: any) => l.id === resolvedLessonId);
    if (!lesson) {
      fail(res, "NOT_FOUND", "Lesson not found.");
      return;
    }

    // Handle existing incomplete attempt or check retake policy (ignore preview attempts).
    // Match by assignmentId when available so a lesson reused across multiple assignments
    // creates distinct attempt records.
    const existingAttempts = db.attempts.filter((a: any) => {
      if (a.studentId !== user.id || a.isPreviewAttempt) return false;
      if (resolvedAssignmentId) return a.assignmentId === resolvedAssignmentId;
      return a.lessonId === resolvedLessonId;
    });
    const activeAttempt = existingAttempts.find((a: any) => a.status === "started");

    if (activeAttempt) {
      res.json({ attempt: user.role === "student" ? sanitizeAttemptForStudent(activeAttempt) : activeAttempt });
      return;
    }

    if (existingAttempts.length > 0 && !lesson.settings.allowRetakes && user.role !== "teacher") {
      fail(res, "VALIDATION_ERROR", "Retakes are disabled for this assignment.");
      return;
    }

    // Resolve the LessonVersion for this attempt.
    // Use the assignment's pinned lessonVersionId so grading is version-stable.
    let resolvedVersionId: string | null = null;
    let versionBlocks: any[] | null = null;

    if (resolvedAssignmentId) {
      const resolvedAsg = (db.lessonAssignments || []).find((a: any) => a.id === resolvedAssignmentId);
      if (resolvedAsg?.lessonVersionId) {
        const ver = (db.lessonVersions || []).find((v: any) => v.id === resolvedAsg.lessonVersionId);
        if (ver && Array.isArray(ver.blocksSnapshot)) {
          resolvedVersionId = ver.id;
          versionBlocks = ver.blocksSnapshot;
        } else {
          console.warn(`VERITAS Learn - Assignment ${resolvedAssignmentId} references version ${resolvedAsg.lessonVersionId} which was not found. Falling back to db.blocks.`);
        }
      } else if (resolvedAsg) {
        // Assignment exists but has no version — create a legacy snapshot now for forward compat
        const liveBlocks = db.blocks.filter((b: any) => b.lessonId === resolvedLessonId);
        const ver = createLessonVersionSnapshot(lesson, liveBlocks, lesson.courseId || 'system', db, 'Auto-created legacy snapshot at attempt start');
        resolvedVersionId = ver.id;
        versionBlocks = ver.blocksSnapshot;
        // Back-fill the assignment's lessonVersionId
        const asgIdx = (db.lessonAssignments || []).findIndex((a: any) => a.id === resolvedAssignmentId);
        if (asgIdx !== -1) {
          db.lessonAssignments[asgIdx].lessonVersionId = ver.id;
        }
        console.log(`VERITAS Learn - Created legacy version snapshot ${ver.id} (v${ver.versionNumber}) for assignment ${resolvedAssignmentId}.`);
      }
    }

    const seed = Math.floor(Math.random() * 900000) + 100000;
    const newAttempt: any = {
      id: "attempt_" + Math.random().toString(36).substring(2, 9),
      lessonId: resolvedLessonId,
      assignmentId: resolvedAssignmentId,
      lessonVersionId: resolvedVersionId,
      studentId: user.id,
      seed,
      startedAt: nowIso,
      status: "started",
      currentBlockIndex: 0,
      furthestVideoTimestamps: {},
      activeTimeSpent: 0,
      inactiveTimeSpent: 0
    };

    db.attempts.push(newAttempt);

    // Generate and lock deterministic, sanitized question assignments.
    // Use the version's blocksSnapshot (immutable) when available; fall back to db.blocks.
    const randFn = lcg(seed);
    const randomize = !!lesson.settings.randomizeChoices;
    const lessonBlocks = versionBlocks
      ? versionBlocks
      : db.blocks.filter((b: any) => b.lessonId === resolvedLessonId);

    lessonBlocks.forEach((block: any) => {
      if (block.type === "question") {
        if (block.singleQuestion) {
          db.questionAssignments.push(
            buildQuestionAssignment(newAttempt.id, block, undefined, block.singleQuestion, block.id, randomize, randFn)
          );
        } else if (block.questionPool && Array.isArray(block.questionPool.questions)) {
          const shuffledPool = shuffleWithSeed(block.questionPool.questions, randFn);
          const count = Math.min(block.questionPool.numToSelect || 1, shuffledPool.length);
          shuffledPool.slice(0, count).forEach((q: any, qi: number) => {
            db.questionAssignments.push(
              buildQuestionAssignment(newAttempt.id, block, undefined, q, `${block.id}_p${qi}`, randomize, randFn)
            );
          });
        }
      }

      if (block.type === "video" && Array.isArray(block.videoCheckpoints)) {
        block.videoCheckpoints.forEach((cp: any) => {
          const shuffledCpQuestions = shuffleWithSeed(cp.questions || [], randFn);
          const cpCount = Math.min(cp.numToSelect || 1, shuffledCpQuestions.length);
          shuffledCpQuestions.slice(0, cpCount).forEach((q: any, qi: number) => {
            db.questionAssignments.push(
              buildQuestionAssignment(newAttempt.id, block, cp.id, q, `${block.id}_cp_${cp.id}_q${qi}`, randomize, randFn)
            );
          });
        });
      }
    });

    // Defensive: never deliver an assignment payload that leaks secret fields.
    const myAssignments = db.questionAssignments.filter((a: any) => a.attemptId === newAttempt.id);
    const leaks = findLeakedSecretFields(myAssignments);
    if (leaks.length > 0) {
      console.error("VERITAS Learn - SECURITY: question assignment leaked fields:", leaks);
      fail(res, "VALIDATION_ERROR", "Question delivery sanitization failed.");
      return;
    }

    await commitDb(db);
    res.status(201).json({ attempt: user.role === "student" ? sanitizeAttemptForStudent(newAttempt) : newAttempt });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Fetch detailed single attempt with deterministic assigned questions and responses
app.get("/api/attempts/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const db = readDb();

  const attempt = db.attempts.find((a: any) => a.id === id);
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }

  // Students can only access their own attempts
  if (user.role === "student" && attempt.studentId !== user.id) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const lesson = db.lessons.find((l: any) => l.id === attempt.lessonId);
  let questionAssignments = db.questionAssignments.filter((asg: any) => asg.attemptId === id);
  const rawResponses = db.responses.filter((r: any) => r.attemptId === id);
  let responses = mergeResponsesWithAiGrading(rawResponses, db);
  const signals = db.securitySignals.filter((s: any) => s.attemptId === id);

  if (user.role === "student") {
    // Sanitize question assignments: strip correct answer, rubrics, model answer etc.
    questionAssignments = questionAssignments.map((qa: any) => {
      if (qa.selectedQuestion) {
        return {
          ...qa,
          selectedQuestion: sanitizeQuestionForStudent(qa.selectedQuestion)
        };
      }
      return qa;
    });

    // Sanitize responses to prevent answer key and premature feedback leaks
    responses = responses.map(sanitizeResponseForStudent);
  }

  const safeAttempt = user.role === "student" ? sanitizeAttemptForStudent(attempt) : attempt;

  res.json({
    attempt: safeAttempt,
    lesson,
    // `questionAssignments` is the canonical key; `assignments` retained as a
    // deprecated alias for backward compatibility with older clients.
    questionAssignments,
    assignments: questionAssignments,
    responses,
    // Security signals are internal; only included for teacher role.
    signals: user.role === "student" ? [] : signals
  });
});

// Watch video progress validations
app.post("/api/attempts/:id/progress", requireAuth, (req, res) => {
  const { id } = req.params;
  const { blockId, timestamp, activeTime, inactiveTime, playbackRate } = req.body;
  const db = readDb();

  const attemptIdx = db.attempts.findIndex((a: any) => a.id === id);
  if (attemptIdx === -1) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }

  const attempt = db.attempts[attemptIdx];

  // Students can only update their own attempts
  if ((req as any).user?.role === "student" && attempt.studentId !== (req as any).user?.id) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const lesson = db.lessons.find((l: any) => l.id === attempt.lessonId);
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found." });
    return;
  }

  const currentMax = attempt.furthestVideoTimestamps[blockId] || 0;
  let allowedTimestamp = timestamp;

  // VERIFY WATCHENGAGEMENT DURATION PARAMETERS (HEARTBEAT INTEGRITY SHIELD)
  const now = Date.now();
  const lastReported = attempt.lastProgressReportedAt ? new Date(attempt.lastProgressReportedAt).getTime() : new Date(attempt.startedAt).getTime();
  const realSecondsElapsed = (now - lastReported) / 1000;
  
  const reportedTimeSec = (Number(activeTime) || 0) + (Number(inactiveTime) || 0);
  const maxAllowedReported = Math.max(25, realSecondsElapsed * 1.6 + 8); // Allow for minor drift, loading lag, network overlap
  
  const user = (req as any).user || { role: "student" };

  if (user.role === "student" && reportedTimeSec > maxAllowedReported) {
    const fraudSignal = {
      id: "sig_" + Math.random().toString(36).substring(2, 9),
      attemptId: attempt.id,
      studentId: attempt.studentId,
      timestamp: new Date().toISOString(),
      eventType: "rapid_navigation",
      severity: "high",
      blockId,
      videoTimestamp: timestamp,
      metadata: {
        message: "Intercepted forged watch duration heartbeat metric on backend.",
        reportedEngagementSeconds: reportedTimeSec,
        actualElapsedSeconds: realSecondsElapsed,
        action: "Discarded forged heartbeat metrics."
      }
    };
    db.securitySignals.push(fraudSignal);
    writeDb(db);

    res.status(400).json({
      error: "Watch progress heartbeat metrics out of acceptable real-time limits.",
      allowedTimestamp: currentMax,
      furthestMaxTimestamp: currentMax
    });
    return;
  }

  attempt.lastProgressReportedAt = new Date().toISOString();

  // STRICT VIDEO LAWS ENFORCEMENT ON BACKEND
  if (lesson.settings.restrictSeeking) {
    const driftThreshold = 3; // Maximum allowed play jump without detection
    if (timestamp > currentMax + driftThreshold) {
      // FORWARD JUMP DETECTED - LOG TELEMETRY AND LIMIT THE TIMESTAMP ON SERVER
      const violationSignal = {
        id: "sig_" + Math.random().toString(36).substring(2, 9),
        attemptId: attempt.id,
        studentId: attempt.studentId,
        timestamp: new Date().toISOString(),
        eventType: "seek_attempt_blocked",
        severity: "high",
        blockId,
        videoTimestamp: timestamp,
        metadata: {
          requestedSeekPosition: timestamp,
          furthestAllowedValue: currentMax,
          message: "Attempted to skip ahead in required video. Progress restricted."
        }
      };
      db.securitySignals.push(violationSignal);
      allowedTimestamp = currentMax; // Block position lock
    } else {
      // Normal playing or rewind
      if (timestamp > currentMax) {
        attempt.furthestVideoTimestamps[blockId] = timestamp;
      }
    }
  } else {
    // Seeking allowed - just take the maximum
    if (timestamp > currentMax) {
      attempt.furthestVideoTimestamps[blockId] = timestamp;
    }
  }

  if (activeTime) attempt.activeTimeSpent += Number(activeTime);
  if (inactiveTime) attempt.inactiveTimeSpent += Number(inactiveTime);

  if (playbackRate && blockId) {
    if (!attempt.videoPlaybackRates) {
      attempt.videoPlaybackRates = {};
    }
    attempt.videoPlaybackRates[blockId] = Number(playbackRate);
  }

  // Track per-block active time for teacher dossier visibility
  if (blockId && Number(activeTime) > 0) {
    if (!attempt.blockTimeSpent) attempt.blockTimeSpent = {};
    attempt.blockTimeSpent[blockId] = (attempt.blockTimeSpent[blockId] || 0) + Number(activeTime);
  }

  // Record last active timestamp for "inactive > 24h" anomaly detection
  attempt.lastActiveAt = new Date().toISOString();

  writeDb(db);
  res.json({
    success: true,
    allowedTimestamp,
    furthestMaxTimestamp: attempt.furthestVideoTimestamps[blockId] || 0,
    lockState: attempt.lockState || null
  });
});

// Update standard currentBlockIndex
app.post("/api/attempts/:id/block", requireAuth, (req, res) => {
  const { id } = req.params;
  const { blockIndex } = req.body;
  const db = readDb();

  const attemptIdx = db.attempts.findIndex((a: any) => a.id === id);
  if (attemptIdx === -1) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }

  const user = (req as any).user || { role: "student" };
  const attempt = db.attempts[attemptIdx];
  const lesson = db.lessons.find((l: any) => l.id === attempt.lessonId);
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found." });
    return;
  }

  const lessonBlocks = db.blocks
    .filter((b: any) => b.lessonId === attempt.lessonId)
    .sort((a: any, b: any) => a.order - b.order);

  // STRICT MILESTONE VALIDATION FOR FORWARD ADVANCEMENTS
  if (user.role === "student" && blockIndex > attempt.currentBlockIndex) {
    // Audit every intermediate block being left behind
    for (let idx = attempt.currentBlockIndex; idx < blockIndex; idx++) {
      const blockToCheck = lessonBlocks[idx];
      if (!blockToCheck) continue;

      if (blockToCheck.type === "video") {
        const checkpoints = blockToCheck.videoCheckpoints || [];
        
        // 1. Check all required checkpoints inside this block
        const incompleteCheckpoint = checkpoints.find((cp: any) => {
          if (cp.isRequired) {
            const cpQuestions = cp.questions || [];
            const allAnswered = cpQuestions.every((q: any) => {
              return db.responses.some((r: any) => 
                r.attemptId === attempt.id && 
                r.blockId === blockToCheck.id && 
                r.checkpointId === cp.id && 
                r.questionId === q.id
              );
            });
            return !allAnswered;
          }
          return false;
        });

        if (incompleteCheckpoint) {
          const blockNavSignal = {
            id: "sig_" + Math.random().toString(36).substring(2, 9),
            attemptId: attempt.id,
            studentId: attempt.studentId,
            timestamp: new Date().toISOString(),
            eventType: "rapid_navigation",
            severity: "high",
            blockId: blockToCheck.id,
            metadata: {
              message: `Bypass attempted. Required block checkpoint questions not answered: ${incompleteCheckpoint.title}`,
              blockIndexAttempt: blockIndex,
              currentBlockIndex: attempt.currentBlockIndex
            }
          };
          db.securitySignals.push(blockNavSignal);
          writeDb(db);
          
          res.status(400).json({ 
            error: `Navigation blocked. You must answer the required checkpoint questions in '${blockToCheck.title}' before moving forward.` 
          });
          return;
        }

        // 2. Check video watch milestone against actual video duration if known.
        // Uses getBlockDurationSeconds() to prefer `duration` over the legacy `videoDuration` field.
        const blockDuration = getBlockDurationSeconds(blockToCheck);
        if (lesson.settings.restrictSeeking && blockDuration !== null) {
          const videoDuration = blockDuration;
          const requiredSeconds = videoDuration * 0.9;
          const furthestWatch = attempt.furthestVideoTimestamps[blockToCheck.id] || 0;

          if (furthestWatch < requiredSeconds) {
            const blockNavSignal = {
              id: "sig_" + Math.random().toString(36).substring(2, 9),
              attemptId: attempt.id,
              studentId: attempt.studentId,
              timestamp: new Date().toISOString(),
              eventType: "seek_attempt_blocked",
              severity: "medium",
              blockId: blockToCheck.id,
              metadata: {
                message: `Navigation blocked. Video played up to ${Math.floor(furthestWatch)}s but required milestone is ${requiredSeconds}s.`,
                blockIndexAttempt: blockIndex,
                currentBlockIndex: attempt.currentBlockIndex
              }
            };
            db.securitySignals.push(blockNavSignal);
            writeDb(db);

            res.status(400).json({
              error: `Navigation blocked. You must watch the required video in '${blockToCheck.title}' before advancing.`
            });
            return;
          }
        }
      }

      if (blockToCheck.type === "question") {
        const asgs = db.questionAssignments.filter((a: any) => a.attemptId === attempt.id && a.blockId === blockToCheck.id);
        const allAnswered = asgs.every((a: any) => {
          return db.responses.some((r: any) => 
            r.attemptId === attempt.id && 
            r.blockId === blockToCheck.id && 
            r.questionId === a.questionId
          );
        });

        if (!allAnswered) {
          const blockNavSignal = {
            id: "sig_" + Math.random().toString(36).substring(2, 9),
            attemptId: attempt.id,
            studentId: attempt.studentId,
            timestamp: new Date().toISOString(),
            eventType: "rapid_navigation",
            severity: "high",
            blockId: blockToCheck.id,
            metadata: {
              message: `Bypass attempted. Required question block answers not submitted: ${blockToCheck.title}`,
              blockIndexAttempt: blockIndex,
              currentBlockIndex: attempt.currentBlockIndex
            }
          };
          db.securitySignals.push(blockNavSignal);
          writeDb(db);
          
          res.status(400).json({ 
            error: `Navigation blocked. You must answer the questions in '${blockToCheck.title}' before moving forward.` 
          });
          return;
        }
      }
    }
  }

  db.attempts[attemptIdx].currentBlockIndex = blockIndex;
  writeDb(db);
  res.json({ success: true });
});

// Submit Student response (Auto-grades MC, Triggers Server AI Grading for SA)
app.post("/api/attempts/:id/submit", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { blockId, checkpointId, questionId, responseValue, activeTimeSpent } = req.body;
    const db = readDb();

    const attempt = db.attempts.find((a: any) => a.id === id);
    if (!attempt) {
      fail(res, "NOT_FOUND", "Attempt not found.");
      return;
    }

    if (attempt.status === "completed" || attempt.completedAt) {
      fail(res, "FORBIDDEN", "This attempt is already completed. No further submissions are allowed.");
      return;
    }

    // Students can only submit to their own attempts
    const submitUser = (req as any).user;
    if (submitUser?.role === "student" && attempt.studentId !== submitUser?.id) {
      fail(res, "FORBIDDEN", "You cannot submit to another student's attempt.");
      return;
    }

    const lesson = db.lessons.find((l: any) => l.id === attempt.lessonId);
    if (!lesson) {
      fail(res, "NOT_FOUND", "Associated lesson configuration missing.");
      return;
    }

    // The locked assignment proves this question was actually delivered to this attempt.
    const assignment = db.questionAssignments.find((asg: any) =>
      asg.attemptId === id &&
      asg.blockId === blockId &&
      asg.questionId === questionId &&
      (checkpointId ? asg.checkpointId === checkpointId : true)
    );

    if (!assignment) {
      fail(res, "INVALID_ATTEMPT", "This question was not assigned to your attempt.");
      return;
    }

    // Resolve the block and question from the version snapshot (immutable, grading-stable).
    // Fall back to db.blocks only for legacy attempts that predate versioning.
    let block: any = null;
    let checkpoint: any = null;
    let rawOriginal: any = null;

    if (attempt.lessonVersionId) {
      const version = (db.lessonVersions || []).find((v: any) => v.id === attempt.lessonVersionId);
      const resolved = resolveQuestionFromVersion(version, blockId, checkpointId, questionId);
      if (resolved) {
        block = resolved.block;
        rawOriginal = resolved.rawOriginal;
        // Re-derive checkpoint for isPractice / questionType fields
        if (checkpointId && Array.isArray(block.videoCheckpoints)) {
          checkpoint = block.videoCheckpoints.find((c: any) => c.id === checkpointId);
        }
      } else {
        console.warn(`VERITAS Learn - Question ${questionId} not found in version ${attempt.lessonVersionId} for attempt ${id}. Falling back to db.blocks.`);
      }
    }

    // Fallback: use db.blocks (legacy attempts or version not found)
    if (!block) {
      block = db.blocks.find((b: any) => b.id === blockId);
      if (!block) {
        fail(res, "NOT_FOUND", "Block not found.");
        return;
      }

      if (checkpointId && Array.isArray(block.videoCheckpoints)) {
        checkpoint = block.videoCheckpoints.find((c: any) => c.id === checkpointId);
        if (checkpoint) rawOriginal = (checkpoint.questions || []).find((q: any) => q.id === questionId);
      } else {
        rawOriginal =
          block.singleQuestion ||
          (block.questionPool && block.questionPool.questions.find((q: any) => q.id === questionId));
      }
    }

    if (!rawOriginal) {
      fail(res, "NOT_FOUND", "Original question definition not found.");
      return;
    }

    // Normalize to the stable choice-id model (idempotent) so grading uses correctChoiceId.
    const originalQuestion = migrateQuestionDefinition(rawOriginal);
    const declaredType = checkpoint ? checkpoint.questionType : block.questionType;
    const isMC =
      declaredType === "mc" ? true : declaredType === "sa" ? false : originalQuestion.type === "mc";
    const isPracticeQuestion = checkpoint ? !!checkpoint.isPractice : !!block.isPractice;

    if (!isPracticeQuestion) {
      const existsAlready = (db.responses || []).some(
        (r: any) =>
          r.attemptId === id &&
          r.blockId === blockId &&
          r.questionId === questionId &&
          (checkpointId ? r.checkpointId === checkpointId : !r.checkpointId)
      );
      if (existsAlready) {
        fail(res, "FORBIDDEN", "This assessment question has already been submitted.");
        return;
      }
    }

        // Idempotent: replace any prior response for this exact question (never double-count score).
    db.responses = db.responses.filter(
      (r: any) =>
        !(r.attemptId === id && r.blockId === blockId && r.questionId === questionId && (checkpointId ? r.checkpointId === checkpointId : true))
    );

    const gradingMode = isPracticeQuestion ? "practice" : "assessment";
    const feedbackVisibility = isPracticeQuestion ? "student_visible" : "teacher_only";
    const gradebookCategory = isPracticeQuestion ? "practice" : "assessment";
    const maxPointsValue = Number(originalQuestion.points) || 0;

    const newResponse: any = {
      id: "resp_" + Math.random().toString(36).substring(2, 9),
      attemptId: id,
      studentId: attempt.studentId,
      blockId,
      checkpointId,
      questionId,
      type: isMC ? "mc" : "sa",
      responseValue,
      score: 0,
      activeTimeSpent: Number(activeTimeSpent) || 0,
      gradingMode,
      gradebookCategory,
      maxPoints: maxPointsValue,
      pointsEarned: 0,
      feedbackVisibility
    };

    if (isMC) {
      // MC AUTO-GRADING by stable choice id (scramble-proof; client score is never trusted).
      const { isCorrect } = gradeMc(originalQuestion, responseValue);
      newResponse.isCorrect = isCorrect;
      const calculatedScore = isCorrect ? maxPointsValue : 0;
      newResponse.score = calculatedScore;
      newResponse.pointsEarned = calculatedScore;
      newResponse.responseText = choiceTextById(originalQuestion, responseValue);

      db.responses.push(newResponse);
      
      // Write the response-level GradebookEntry
      upsertResponseGradebookEntry(newResponse, attempt, "auto_scored", "multiple_choice", undefined, db);

      recalculateAttemptScore(id, db);
      await commitDb(db);

      res.json({
        success: true,
        gradedImmediate: true,
        isCorrect: feedbackVisibility === "student_visible" ? isCorrect : undefined,
        score: feedbackVisibility === "student_visible" ? newResponse.score : undefined,
        explanation: feedbackVisibility === "student_visible" ? originalQuestion.explanation : undefined
      });
      return;
    }

    // ---- SHORT ANSWER: AI grading using teacher-authored rubric + guidance ----
    const maxPoints = maxPointsValue;
    const guidanceSnapshot = {
      modelAnswer: originalQuestion.modelAnswer,
      answerKey: originalQuestion.answerKey,
      aiScoringGuidance: originalQuestion.aiScoringGuidance
    };
    const promptContent = buildShortAnswerPrompt(lesson, originalQuestion, responseValue, maxPoints);

    const newGradingRecord: any = {
      id: "aigr_" + Math.random().toString(36).substring(2, 9),
      responseId: newResponse.id,
      provider: "google",
      model: process.env.AI_GRADING_MODEL || "gemini-3.5-flash",
      promptVersion: "2.0",
      rubricSnapshot: originalQuestion.rubricCategories || [],
      guidanceSnapshot,
      inputHash: simpleHash(promptContent),
      parsedScore: 0,
      confidence: 0,
      rationale: "Contacting Veritas AI assessor layer...",
      rubricBreakdown: {},
      status: "pending",
      gradedAt: new Date().toISOString()
    };

    db.aiGradingRecords.push(newGradingRecord);
    db.responses.push(newResponse);

    // Initial response-level GradebookEntry for Short Answer: pending AI
    upsertResponseGradebookEntry(newResponse, attempt, "pending_ai", "ai_short_answer", undefined, db);

    recalculateAttemptScore(id, db);
    await commitDb(db);

    // Grade asynchronously so the student isn't blocked on the model round-trip.
    (async () => {
      try {
        const ai = getAI();
        const response = await ai.models.generateContent({
          model: process.env.AI_GRADING_MODEL || "gemini-3.5-flash",
          contents: promptContent,
          config: {
            systemInstruction:
              "You are Veritas AI, an academic grading assistant. Output strictly valid JSON matching the provided schema. Never include model answers, answer keys, or teacher-only scoring guidance in the student-facing feedback field.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER, description: "Total points earned, clamped to 0..maxScore." },
                maxScore: { type: Type.NUMBER, description: "Maximum possible points (equals question max points)." },
                feedback: { type: Type.STRING, description: "Student-visible explanation: what was correct, what was missing. Must NOT reproduce the model answer, answer key, or teacher-only guidance." },
                rationale: { type: Type.STRING, description: "Teacher-facing justification grounded in the rubric. May reference internal guidance." },
                rubricBreakdown: {
                  type: Type.ARRAY,
                  description: "Per-rubric-category scores and feedback.",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: { type: Type.STRING },
                      score: { type: Type.NUMBER },
                      maxScore: { type: Type.NUMBER },
                      feedback: { type: Type.STRING }
                    },
                    required: ["category", "score", "feedback"]
                  }
                },
                misconceptions: {
                  type: Type.ARRAY,
                  description: "Specific misconceptions identified in the response. Empty array if none.",
                  items: { type: Type.STRING }
                },
                confidence: { type: Type.NUMBER, description: "0.0..1.0 grading confidence." },
                needsTeacherReview: { type: Type.BOOLEAN, description: "True if confidence < 0.75, the answer is ambiguous, or human judgment is needed." },
                teacherNotes: { type: Type.STRING, description: "Internal teacher-only notes about grading edge cases or concerns." },
                lowEffort: { type: Type.BOOLEAN, description: "True if the response is gibberish, a keyboard smash, extremely short, or makes no genuine academic attempt." }
              },
              required: ["score", "maxScore", "feedback", "rubricBreakdown", "misconceptions", "confidence", "needsTeacherReview", "teacherNotes", "lowEffort"]
            }
          }
        });

        const rawJsonText = (response.text || "").trim();
        const geminiResult = parseAiGradingJson(rawJsonText);

        // Build rubric breakdown object keyed by category name
        const rubricObject: any = {};
        if (Array.isArray(geminiResult.rubricBreakdown)) {
          geminiResult.rubricBreakdown.forEach((item: any) => {
            if (item && typeof item.category === "string") {
              rubricObject[item.category] = {
                score: Number(item.score) || 0,
                maxScore: item.maxScore !== undefined ? Number(item.maxScore) : undefined,
                feedback: item.feedback || ""
              };
            }
          });
        }

        // Rules-based detection combined with AI-based detection
        const rulesCheck = checkLowEffortRules(responseValue);
        const isLowEffort = rulesCheck.lowEffort || !!geminiResult.lowEffort;
        const lowEffortReason = rulesCheck.lowEffort
          ? rulesCheck.reason
          : (geminiResult.lowEffort ? "AI assessed submission as extremely low-effort or lacking meaningful structure." : null);

        // Clamp the suggested score. Force 0 if low effort flagged.
        const clampedScore = isLowEffort ? 0 : Math.max(0, Math.min(Number(geminiResult.score) || 0, maxPoints));
        const confidence = isLowEffort ? 0 : Math.max(0, Math.min(Number(geminiResult.confidence) || 0, 1));
        const aiNeedsReview = !!geminiResult.needsTeacherReview;
        const finalStatus = isLowEffort || confidence < 0.75 || aiNeedsReview ? "needs_review" : "success";

        // Student-facing feedback must never expose internal guidance
        const studentFeedback = isLowEffort
          ? "Your response did not meet the minimum length or structure requirements for grading. Please resubmit with a complete written answer."
          : (geminiResult.feedback || "");

        // Teacher-facing rationale (may reference internal guidance)
        const teacherRationale = isLowEffort
          ? `[VERITAS INTEGRITY REVIEW — low-effort or lacking structure]: ${lowEffortReason}. ${geminiResult.rationale || ""}`
          : (geminiResult.rationale || "");

        const teacherNotes = geminiResult.teacherNotes || "";
        const misconceptions = Array.isArray(geminiResult.misconceptions) ? geminiResult.misconceptions : [];

        const freshDb = readDb();
        const freshRespIdx = freshDb.responses.findIndex((r: any) => r.id === newResponse.id);
        const freshGradIdx = freshDb.aiGradingRecords.findIndex((g: any) => g.responseId === newResponse.id);

        if (freshRespIdx !== -1) {
          freshDb.responses[freshRespIdx].score = clampedScore;
          freshDb.responses[freshRespIdx].pointsEarned = clampedScore;
          freshDb.responses[freshRespIdx].isLowEffort = isLowEffort;
          if (lowEffortReason) freshDb.responses[freshRespIdx].lowEffortReason = lowEffortReason;

          // For practice responses with a clean grade, release feedback to the student
          if (isPracticeQuestion && finalStatus === "success") {
            freshDb.responses[freshRespIdx].aiFeedbackReleasedAt = new Date().toISOString();
            // feedbackVisibility is already "student_visible" from submission; ensure it stays set
            freshDb.responses[freshRespIdx].feedbackVisibility = "student_visible";
          }

          if (freshGradIdx !== -1) {
            freshDb.aiGradingRecords[freshGradIdx] = {
              ...freshDb.aiGradingRecords[freshGradIdx],
              rawOutput: rawJsonText,
              parsedScore: clampedScore,
              feedback: studentFeedback,
              rationale: teacherRationale,
              teacherNotes,
              misconceptions,
              needsTeacherReview: isLowEffort || aiNeedsReview || confidence < 0.75,
              confidence,
              status: finalStatus,
              rubricBreakdown: rubricObject,
              gradedAt: new Date().toISOString()
            };
          }

          // For assessment responses, feedback goes to teacher only (not student-visible)
          // For practice responses, feedback is student-visible when finalStatus === "success"
          const gradebookFeedback = isPracticeQuestion ? studentFeedback : teacherRationale;

          const freshAttempt = freshDb.attempts.find((a: any) => a.id === id);
          if (freshAttempt) {
            upsertResponseGradebookEntry(
              freshDb.responses[freshRespIdx],
              freshAttempt,
              finalStatus === "needs_review" ? "needs_teacher_review" : "ai_scored",
              "ai_short_answer",
              gradebookFeedback,
              freshDb
            );
          }

          recalculateAttemptScore(id, freshDb);
          await commitDb(freshDb);
          console.log(`VERITAS Learn - AI grade stored (status=${finalStatus}, score=${clampedScore}/${maxPoints}, lowEffort=${isLowEffort}, practice=${isPracticeQuestion}).`);
        }
      } catch (error: any) {
        console.error("VERITAS Learn - AI Grading failed:", error);
        const freshDb = readDb();
        const rulesCheck = checkLowEffortRules(responseValue);
        const isLowEffort = rulesCheck.lowEffort;

        const errorRationale = isLowEffort
          ? `AI grading failed, but response was flagged as low-effort: ${rulesCheck.reason}`
          : "AI grading could not complete. Response queued for manual teacher review.";

        const freshGradIdx = freshDb.aiGradingRecords.findIndex((g: any) => g.responseId === newResponse.id);
        if (freshGradIdx !== -1) {
          freshDb.aiGradingRecords[freshGradIdx] = {
            ...freshDb.aiGradingRecords[freshGradIdx],
            parsedScore: 0,
            feedback: "",
            rationale: errorRationale,
            teacherNotes: `AI grading error: ${error instanceof Error ? error.message : String(error)}`,
            misconceptions: [],
            needsTeacherReview: true,
            confidence: 0,
            status: "needs_review",
            errorMessage: error instanceof Error ? error.message : String(error),
            rubricBreakdown: {},
            gradedAt: new Date().toISOString()
          };
          if (isLowEffort) {
            const freshRespIdx = freshDb.responses.findIndex((r: any) => r.id === newResponse.id);
            if (freshRespIdx !== -1) {
              freshDb.responses[freshRespIdx].score = 0;
              freshDb.responses[freshRespIdx].pointsEarned = 0;
              freshDb.responses[freshRespIdx].isLowEffort = true;
              freshDb.responses[freshRespIdx].lowEffortReason = rulesCheck.reason;
            }
          }

          // Write/update failed response-level GradebookEntry
          const freshRespIdx = freshDb.responses.findIndex((r: any) => r.id === newResponse.id);
          const freshAttempt = freshDb.attempts.find((a: any) => a.id === id);
          if (freshRespIdx !== -1 && freshAttempt) {
            upsertResponseGradebookEntry(
              freshDb.responses[freshRespIdx],
              freshAttempt,
              "error",
              "ai_short_answer",
              isLowEffort 
                ? `AI grading failed, but response was flagged as low-effort: ${rulesCheck.reason}`
                : "AI grading failed to complete. Sent to the review queue for manual grading.",
              freshDb
            );
          }

          recalculateAttemptScore(id, freshDb);
          await commitDb(freshDb).catch((e) => console.error("VERITAS Learn - failed to persist AI failure record:", e));
        }
      }
    })();

    res.json({ success: true, gradedImmediate: false, message: "Your response was saved and sent for grading." });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Complete Attempt
app.post("/api/attempts/:id/complete", requireAuth, async (req, res) => {
  const { id } = req.params;
  const completeUser = (req as any).user;
  const isTeacherOrAdmin = completeUser?.role === "teacher" || !!completeUser?.isSuperAdmin;
  const db = readDb();
  const now = new Date();

  // Server-certified completion validation — client cannot bypass this.
  const validation = validateAttemptCompletion(id, completeUser?.id, isTeacherOrAdmin, db, now);

  if (!validation.canComplete) {
    // Return the first missing requirement as a student-safe message.
    const first = validation.missing[0];
    const studentMsg = first ? studentSafeMessage(first.code) : "Cannot complete this attempt.";
    res.status(422).json({
      error: studentMsg,
      code: first?.code || "unknown",
      missing: isTeacherOrAdmin
        ? validation.missing  // Teachers see the full structured list
        : validation.missing.map((m) => ({ code: m.code, message: studentSafeMessage(m.code), blockId: m.blockId, checkpointId: m.checkpointId })),
    });
    return;
  }

  const attemptIdx = db.attempts.findIndex((a: any) => a.id === id);
  const completedAt = now.toISOString();
  db.attempts[attemptIdx].completedAt = completedAt;
  db.attempts[attemptIdx].status = "completed";
  recalculateAttemptScore(id, db);

  // Update GradebookEntry status to 'completed' (unless AI still pending)
  const attempt = db.attempts[attemptIdx];
  const assignmentId = attempt.assignmentId ||
    (db.lessonAssignments || []).find((la: any) => la.lessonId === attempt.lessonId)?.id;
  if (assignmentId) {
    const gbIdx = (db.gradebookEntries || []).findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === attempt.studentId
    );
    if (gbIdx !== -1) {
      const hasPendingAi = (db.gradebookEntries[gbIdx].aiPendingCount || 0) > 0;
      const needsReview = db.gradebookEntries[gbIdx].teacherReviewRequired;
      if (!hasPendingAi && !needsReview) {
        db.gradebookEntries[gbIdx].status = 'completed';
      } else if (hasPendingAi) {
        db.gradebookEntries[gbIdx].status = 'pending_ai';
      } else {
        db.gradebookEntries[gbIdx].status = 'needs_teacher_review';
      }
      db.gradebookEntries[gbIdx].completedAt = completedAt;
      db.gradebookEntries[gbIdx].updatedAt = completedAt;
    }
  }

  try {
    await commitDb(db);
  } catch (err) {
    sendAppError(res, err);
    return;
  }

  const completedAttempt = db.attempts[attemptIdx];
  const safeResult: any = {
    success: true,
    attempt: isTeacherOrAdmin ? completedAttempt : sanitizeAttemptForStudent(completedAttempt),
    assessmentScore: validation.assessmentScore,
    assessmentMaxScore: validation.assessmentMaxScore,
    practiceSummary: validation.practiceSummary,
  };

  // Students receive a student-safe completion message, not raw scores (unless released)
  if (!isTeacherOrAdmin) {
    delete safeResult.assessmentScore;
    delete safeResult.assessmentMaxScore;
  }

  res.json(safeResult);
});

// Post Integrity Signals
app.post("/api/integrity-signals", requireAuth, (req, res) => {
  const user = (req as any).user;
  const { attemptId, eventType, severity, blockId, videoTimestamp, metadata } = req.body;
  const db = readDb();

  const signal = {
    id: "sig_" + Math.random().toString(36).substring(2, 9),
    attemptId,
    studentId: user.id,
    timestamp: new Date().toISOString(),
    eventType,
    severity: severity || "medium",
    blockId,
    videoTimestamp,
    metadata: metadata || {}
  };

  db.securitySignals.push(signal);

  let lockState: string | null = null;
  let securityReviewRequired: boolean | null = null;

  if (attemptId) {
    const attemptIdx = db.attempts.findIndex((a: any) => a.id === attemptId);
    if (attemptIdx !== -1) {
      const attempt = db.attempts[attemptIdx];
      const lesson = db.lessons.find((l: any) => l.id === attempt.lessonId);

      // Resolve the Learning Conditions policy for this attempt's assignment.
      const asg = attempt.assignmentId
        ? (db.lessonAssignments || []).find((a: any) => a.id === attempt.assignmentId)
        : null;
      const policy = getEffectivePolicy(asg);

      // Thresholds driven by reviewSensitivity dial.
      const FULLSCREEN_REVIEW_THRESHOLD = policy.reviewThreshold;
      const FULLSCREEN_LOCK_THRESHOLD = policy.lockThreshold;
      const BLUR_REVIEW_THRESHOLD = policy.reviewThreshold + 1;

      // --- Fullscreen exit: tiered response (only if fullscreen is enforced by policy or lesson settings) ---
      // Accepts both canonical "fullscreen_exit" and legacy "fullscreen_exited" for backward compat.
      const fullscreenRequired = policy.requireFullscreen || lesson?.settings?.requireFullscreen;
      const isFullscreenExitEvent = eventType === "fullscreen_exit" || eventType === "fullscreen_exited";
      if (isFullscreenExitEvent && fullscreenRequired) {
        const exitCount = db.securitySignals.filter(
          (s: any) => s.attemptId === attemptId &&
            (s.eventType === "fullscreen_exit" || s.eventType === "fullscreen_exited")
        ).length;

        if (attempt.lockState !== "locked_awaiting_teacher") {
          if (exitCount >= FULLSCREEN_LOCK_THRESHOLD) {
            db.attempts[attemptIdx].lockState = "locked_awaiting_teacher";
            db.attempts[attemptIdx].lockedAt = new Date().toISOString();
            lockState = "locked_awaiting_teacher";
          } else if (exitCount >= FULLSCREEN_REVIEW_THRESHOLD && !attempt.securityReviewRequired) {
            db.attempts[attemptIdx].securityReviewRequired = true;
            db.attempts[attemptIdx].securityReviewAt = new Date().toISOString();
            db.attempts[attemptIdx].securityReviewReason = `Fullscreen exited ${exitCount} time(s)`;
            securityReviewRequired = true;
          }
        }
      }

      // --- Repeated blur events: flag for review based on focusSupport dial ---
      if (
        eventType === "blur_focus_lost" &&
        severity === "medium" &&
        policy.focusSupport !== "off" &&
        policy.focusSupport !== "quiet" &&
        !attempt.securityReviewRequired
      ) {
        const blurCount = db.securitySignals.filter(
          (s: any) => s.attemptId === attemptId && s.eventType === "blur_focus_lost"
        ).length;
        if (blurCount >= BLUR_REVIEW_THRESHOLD) {
          db.attempts[attemptIdx].securityReviewRequired = true;
          db.attempts[attemptIdx].securityReviewAt = new Date().toISOString();
          db.attempts[attemptIdx].securityReviewReason = "Repeated focus loss detected";
          securityReviewRequired = true;
        }
      }

      // --- Paste/copy events flagged when responseControls is guarded+ ---
      if (
        (eventType === "paste_blocked" || eventType === "copy_blocked") &&
        (policy.responseControls === "guarded" || policy.responseControls === "restricted" || policy.responseControls === "strict") &&
        !attempt.securityReviewRequired
      ) {
        const pasteCount = db.securitySignals.filter(
          (s: any) => s.attemptId === attemptId && (s.eventType === "paste_blocked" || s.eventType === "copy_blocked")
        ).length;
        if (pasteCount >= policy.reviewThreshold) {
          db.attempts[attemptIdx].securityReviewRequired = true;
          db.attempts[attemptIdx].securityReviewAt = new Date().toISOString();
          db.attempts[attemptIdx].securityReviewReason = "Repeated paste/copy pattern detected";
          securityReviewRequired = true;
        }
      }

      // Update last active timestamp on any integrity event.
      db.attempts[attemptIdx].lastActiveAt = new Date().toISOString();
    }
  }

  writeDb(db);
  res.json({ success: true, lockState, securityReviewRequired });
});

// Save SA draft response (server-side autosave without submitting).
// Stores draftResponses[questionId] on the attempt so the student can resume
// from any device without losing progress. localStorage is still used as a fallback.
app.post("/api/attempts/:id/draft", requireAuth, (req, res) => {
  const { id } = req.params;
  const { questionId, draftText } = req.body;

  if (!questionId || typeof draftText !== "string") {
    res.status(400).json({ error: "questionId and draftText are required." });
    return;
  }

  const db = readDb();
  const attemptIdx = db.attempts.findIndex((a: any) => a.id === id);
  if (attemptIdx === -1) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }

  const user = (req as any).user;
  if (user?.role === "student" && db.attempts[attemptIdx].studentId !== user?.id) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  // Reject late draft writes after submission or attempt completion
  if (db.attempts[attemptIdx].status === "completed" || db.attempts[attemptIdx].completedAt) {
    res.status(403).json({ error: "This attempt is already completed. Cannot save drafts." });
    return;
  }

  const alreadySubmitted = (db.responses || []).some(
    (r: any) => r.attemptId === id && r.questionId === questionId
  );
  if (alreadySubmitted) {
    res.status(403).json({ error: "This question has already been submitted. Cannot save drafts for it." });
    return;
  }

  if (!db.attempts[attemptIdx].draftResponses) {
    db.attempts[attemptIdx].draftResponses = {};
  }
  db.attempts[attemptIdx].draftResponses[questionId] = draftText;
  db.attempts[attemptIdx].lastActiveAt = new Date().toISOString();

  writeDb(db);
  res.json({ success: true });
});

// Lightweight endpoint for polling practice SA grading status.
// Returns only SA responses for the given attempt, sanitized for the requesting user.
// Students may only see their own attempt. Teachers get unsanitized data.
app.get("/api/attempts/:id/sa-feedback", requireAuth, (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  const db = readDb();

  const attempt = db.attempts.find((a: any) => a.id === id);
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }

  if (user.role === "student" && attempt.studentId !== user.id) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const rawResponses = (db.responses || []).filter((r: any) => r.attemptId === id && r.type === "sa");
  let responses = mergeResponsesWithAiGrading(rawResponses, db);

  if (user.role === "student") {
    responses = responses.map(sanitizeResponseForStudent);
  }

  res.json({ responses });
});

// Teacher: Unlock a locked student attempt
app.post("/api/attempts/:id/unlock", requireTeacher, (req, res) => {
  const { id } = req.params;
  const db = readDb();

  const attemptIdx = db.attempts.findIndex((a: any) => a.id === id);
  if (attemptIdx === -1) {
    fail(res, "NOT_FOUND", "Attempt not found.");
    return;
  }

  db.attempts[attemptIdx].lockState = null;
  db.attempts[attemptIdx].lockedAt = null;
  writeDb(db);

  res.json({ success: true, attempt: { id, lockState: null } });
});

// ==========================================
// Teacher Analytics and Gradebook APIs
// ==========================================
// Full Class Analytics overview
app.get("/api/analytics", requireTeacher, (req, res) => {
  const db = readDb();
  
  // Recalculate historical scores as a fail-safe to guarantee 100% correct/fresh data.
  (db.attempts || []).forEach((a: any) => {
    recalculateAttemptScore(a.id, db);
  });
  
  // Roster lists
  const students = db.users.filter((u: any) => u.role === "student");
  const lessons = db.lessons;
  
  // Do NOT filter out preview attempts/responses/signals at the server level.
  // Returning both normal and preview attempts with their isPreviewAttempt field
  // allows the teacher portal screens to exclude them by default but still support
  // toggling, labeling, and student dossier previews.
  const attempts = db.attempts;
  const responses = mergeResponsesWithAiGrading(db.responses, db);
  const signals = db.securitySignals;
  const gradebookEntries = db.gradebookEntries || [];
  const gradebookResponseEntries = db.gradebookResponseEntries || [];

  res.json({
    students,
    lessons,
    attempts,
    responses,
    signals,
    gradebookEntries,
    gradebookResponseEntries,
  });
});

// Teacher: Recalculate scores from student responses for a given assignment
app.post("/api/assignments/:id/recalculate", requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const db = readDb();
    
    // Find assignment to verify it exists
    const assignment = (db.lessonAssignments || []).find((asg: any) => asg.id === id);
    if (!assignment) {
      fail(res, "NOT_FOUND", "Assignment configuration not found.");
      return;
    }
    
    // Sum scores for all attempts associated with this assignment or lesson
    recalculateAssignmentScores(id, db);
    await commitDb(db);
    
    res.json({ success: true, message: `Re-calculated scores from student responses for assignment '${id}' successfully.` });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Gradebook Score Overrides (teacher override is the final authority).
// Delegates to /api/ai-review/:responseId/override for full lifecycle tracking.
app.post("/api/responses/:id/override", requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { score, notes } = req.body;
    const teacher = (req as any).user;
    const db = readDb();

    const responseIdx = db.responses.findIndex((r: any) => r.id === id);
    if (responseIdx === -1) {
      fail(res, "NOT_FOUND", "Student response record not found.");
      return;
    }

    const response = db.responses[responseIdx];
    const now = new Date().toISOString();

    // Preserve original AI score before override
    const aiRecord = (db.aiGradingRecords || []).find((g: any) => g.responseId === id);
    const originalAiScore = aiRecord?.parsedScore ?? response.score ?? null;

    response.score = Number(score);
    response.pointsEarned = Number(score);
    response.teacherReviewedAt = now;
    response.teacherReviewedBy = teacher.id;
    response.teacherOverrideScore = Number(score);
    response.teacherOverrideFeedback = notes || "Manual grade modification applied.";
    response.teacherOverride = {
      score: Number(score),
      notes: notes || "Manual grade modification applied.",
      gradedAt: now,
    };

    const attemptId = response.attemptId;
    if (attemptId) {
      const attempt = db.attempts.find((a: any) => a.id === attemptId);
      if (attempt) {
        upsertResponseGradebookEntry(
          response, attempt, "teacher_overridden", "teacher_override",
          notes || "Manual grade modification applied.", db
        );
        // Preserve originalAiScore on the GRE
        const greIdx = (db.gradebookResponseEntries || []).findIndex((e: any) => e.responseId === id);
        if (greIdx !== -1) {
          db.gradebookResponseEntries[greIdx].originalAiScore = originalAiScore;
          db.gradebookResponseEntries[greIdx].reviewedAt = now;
          db.gradebookResponseEntries[greIdx].reviewedBy = teacher.id;
        }
      }
      recalculateAttemptScore(attemptId, db);
    }

    await commitDb(db);
    const mergedResp = mergeResponsesWithAiGrading([db.responses[responseIdx]], db)[0];
    res.json({ success: true, response: mergedResp });
  } catch (err) {
    sendAppError(res, err);
  }
});

// Teacher: Gradebook Status Overrides (mark cell as 'excused' | 'missing' | null)
// NOTE: No fake attempts are created — GradebookEntry is updated directly.
app.post("/api/lessons/:lessonId/students/:studentId/gradebook-status", requireTeacher, async (req, res) => {
  try {
    const { lessonId, studentId } = req.params;
    const { statusOverride } = req.body; // 'excused' | 'missing' | null
    const teacher = (req as any).user;
    const db = readDb();

    // Find the assignment for this lesson (use first open or any assignment)
    const assignment = (db.lessonAssignments || []).find((a: any) => a.lessonId === lessonId);
    const assignmentId = assignment?.id || `legacy_${lessonId}`;

    // Verify teacher can manage the course
    if (assignment) {
      const course = (db.courses || []).find((c: any) => c.id === assignment.courseId);
      if (course && !teacherCanManageCourse(teacher.id, course, !!teacher.isSuperAdmin)) {
        fail(res, "FORBIDDEN", "You do not have access to this course.");
        return;
      }
    }

    // Ensure GradebookEntry exists
    ensureGradebookEntryForAssignment(studentId, assignmentId, db);

    const entryIdx = db.gradebookEntries.findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    const now = new Date().toISOString();

    if (statusOverride === 'excused') {
      db.gradebookEntries[entryIdx].status = 'excused';
      db.gradebookEntries[entryIdx].excusedAt = now;
      db.gradebookEntries[entryIdx].excusedBy = teacher.id;
    } else if (statusOverride === 'missing') {
      db.gradebookEntries[entryIdx].status = 'missing';
      db.gradebookEntries[entryIdx].missingMarkedAt = now;
      db.gradebookEntries[entryIdx].missingMarkedBy = teacher.id;
    } else {
      // null / default — revert to calculated status from attempt if any
      const attempt = (db.attempts || []).find(
        (a: any) => a.studentId === studentId && (a.assignmentId === assignmentId || a.lessonId === lessonId)
      );
      if (attempt) {
        recalculateAttemptScore(attempt.id, db);
      } else {
        db.gradebookEntries[entryIdx].status = 'not_started';
      }
    }
    db.gradebookEntries[entryIdx].updatedAt = now;

    await commitDb(db);
    res.json({ success: true, gradebookEntry: db.gradebookEntries[entryIdx] });
  } catch (err) {
    sendAppError(res, err);
  }
});

// ====================================================
// Assignment Lifecycle: per-student status management (teacher-only)
// ====================================================

/** Shared helper: resolve + auth-check assignment for per-student lifecycle endpoints. */
function resolveAssignmentForLifecycle(
  assignmentId: string,
  studentId: string,
  teacher: any,
  db: any
): { assignment: any; course: any; error?: string } {
  const assignment = (db.lessonAssignments || []).find((a: any) => a.id === assignmentId);
  if (!assignment) return { assignment: null, course: null, error: 'Assignment not found.' };
  const course = (db.courses || []).find((c: any) => c.id === assignment.courseId);
  if (!course) return { assignment, course: null, error: 'Course not found.' };
  if (!teacherCanManageCourse(teacher.id, course, !!teacher.isSuperAdmin)) {
    return { assignment, course, error: 'You do not have access to this course.' };
  }
  const isStudent = (db.enrollments || []).some(
    (e: any) => e.courseId === assignment.courseId && e.studentId === studentId
  );
  if (!isStudent) {
    // Allow if student has an existing gradebook entry (legacy visibility)
    const hasEntry = (db.gradebookEntries || []).some(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    if (!hasEntry) return { assignment, course, error: 'Student is not enrolled in this course.' };
  }
  return { assignment, course };
}

// POST /api/assignments/:assignmentId/students/:studentId/excuse
app.post("/api/assignments/:assignmentId/students/:studentId/excuse", requireTeacher, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const teacher = (req as any).user;
    const db = readDb();
    const { error, assignment } = resolveAssignmentForLifecycle(assignmentId, studentId, teacher, db);
    if (error) { fail(res, 'FORBIDDEN', error); return; }

    ensureGradebookEntryForAssignment(studentId, assignmentId, db);
    const idx = db.gradebookEntries.findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    const now = new Date().toISOString();
    db.gradebookEntries[idx].status = 'excused';
    db.gradebookEntries[idx].excusedAt = now;
    db.gradebookEntries[idx].excusedBy = teacher.id;
    db.gradebookEntries[idx].updatedAt = now;

    await commitDb(db);
    res.json({ success: true, gradebookEntry: db.gradebookEntries[idx] });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/assignments/:assignmentId/students/:studentId/mark-missing
app.post("/api/assignments/:assignmentId/students/:studentId/mark-missing", requireTeacher, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const teacher = (req as any).user;
    const db = readDb();
    const { error } = resolveAssignmentForLifecycle(assignmentId, studentId, teacher, db);
    if (error) { fail(res, 'FORBIDDEN', error); return; }

    ensureGradebookEntryForAssignment(studentId, assignmentId, db);
    const idx = db.gradebookEntries.findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    const now = new Date().toISOString();
    db.gradebookEntries[idx].status = 'missing';
    db.gradebookEntries[idx].missingMarkedAt = now;
    db.gradebookEntries[idx].missingMarkedBy = teacher.id;
    db.gradebookEntries[idx].updatedAt = now;

    await commitDb(db);
    res.json({ success: true, gradebookEntry: db.gradebookEntries[idx] });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/assignments/:assignmentId/students/:studentId/extend
app.post("/api/assignments/:assignmentId/students/:studentId/extend", requireTeacher, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { extendedUntil } = req.body;
    if (!extendedUntil) { fail(res, 'VALIDATION_ERROR', 'extendedUntil (ISO date string) is required.'); return; }
    const teacher = (req as any).user;
    const db = readDb();
    const { error } = resolveAssignmentForLifecycle(assignmentId, studentId, teacher, db);
    if (error) { fail(res, 'FORBIDDEN', error); return; }

    ensureGradebookEntryForAssignment(studentId, assignmentId, db);
    const idx = db.gradebookEntries.findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    const now = new Date().toISOString();
    db.gradebookEntries[idx].extendedUntil = extendedUntil;
    db.gradebookEntries[idx].updatedAt = now;
    // If student was marked missing, revert to extended/in_progress
    if (db.gradebookEntries[idx].status === 'missing' || db.gradebookEntries[idx].status === 'not_started') {
      db.gradebookEntries[idx].status = 'extended';
    }

    await commitDb(db);
    res.json({ success: true, gradebookEntry: db.gradebookEntries[idx] });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/assignments/:assignmentId/students/:studentId/reopen
app.post("/api/assignments/:assignmentId/students/:studentId/reopen", requireTeacher, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const teacher = (req as any).user;
    const db = readDb();
    const { error } = resolveAssignmentForLifecycle(assignmentId, studentId, teacher, db);
    if (error) { fail(res, 'FORBIDDEN', error); return; }

    ensureGradebookEntryForAssignment(studentId, assignmentId, db);
    const idx = db.gradebookEntries.findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    const now = new Date().toISOString();
    db.gradebookEntries[idx].status = 'reopened';
    db.gradebookEntries[idx].reopenedAt = now;
    db.gradebookEntries[idx].reopenedBy = teacher.id;
    db.gradebookEntries[idx].updatedAt = now;

    // Reopen the most recent attempt (if any) so student can resume
    const existingAttempt = (db.attempts || []).find(
      (a: any) => a.studentId === studentId &&
        (a.assignmentId === assignmentId ||
         a.lessonId === (db.lessonAssignments || []).find((la: any) => la.id === assignmentId)?.lessonId) &&
        !a.isPreviewAttempt
    );
    if (existingAttempt && existingAttempt.status === 'completed') {
      const aIdx = db.attempts.findIndex((a: any) => a.id === existingAttempt.id);
      db.attempts[aIdx].status = 'started';
      db.attempts[aIdx].completedAt = null;
    }

    await commitDb(db);
    res.json({ success: true, gradebookEntry: db.gradebookEntries[idx] });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/assignments/:assignmentId/students/:studentId/status  (generic status update)
app.post("/api/assignments/:assignmentId/students/:studentId/status", requireTeacher, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { status } = req.body;
    const allowed = ['excused', 'missing', 'extended', 'reopened', 'not_started'];
    if (!allowed.includes(status)) {
      fail(res, 'VALIDATION_ERROR', `Invalid status. Allowed: ${allowed.join(', ')}.`); return;
    }
    const teacher = (req as any).user;
    const db = readDb();
    const { error } = resolveAssignmentForLifecycle(assignmentId, studentId, teacher, db);
    if (error) { fail(res, 'FORBIDDEN', error); return; }

    ensureGradebookEntryForAssignment(studentId, assignmentId, db);
    const idx = db.gradebookEntries.findIndex(
      (e: any) => e.assignmentId === assignmentId && e.studentId === studentId
    );
    const now = new Date().toISOString();
    db.gradebookEntries[idx].status = status;
    db.gradebookEntries[idx].updatedAt = now;

    await commitDb(db);
    res.json({ success: true, gradebookEntry: db.gradebookEntries[idx] });
  } catch (err) { sendAppError(res, err); }
});

// ====================================================
// AI Review Queue (teacher-only)
// ====================================================

// GET /api/ai-review/queue — Returns prioritized review queue for SA responses
app.get("/api/ai-review/queue", requireTeacher, (req, res) => {
  try {
    const teacher = (req as any).user;
    const db = readDb();

    // Optional filters
    const { assignmentId, studentId, category, status: statusFilter } = req.query;

    // Merge all SA responses with their AI grading records
    const allResponses = mergeResponsesWithAiGrading(
      (db.responses || []).filter((r: any) => r.type === 'sa'),
      db
    );

    const queueItems = allResponses
      .filter((r: any) => {
        if (assignmentId) {
          const attempt = (db.attempts || []).find((a: any) => a.id === r.attemptId);
          if (!attempt || attempt.assignmentId !== assignmentId) return false;
        }
        if (studentId && r.studentId !== studentId) return false;
        if (category && r.gradebookCategory !== category && r.gradingMode !== category) return false;
        return true;
      })
      .map((r: any) => {
        const attempt = (db.attempts || []).find((a: any) => a.id === r.attemptId);
        const assignment = attempt?.assignmentId
          ? (db.lessonAssignments || []).find((a: any) => a.id === attempt.assignmentId)
          : null;
        const course = assignment
          ? (db.courses || []).find((c: any) => c.id === assignment.courseId)
          : null;
        const student = (db.users || []).find((u: any) => u.id === r.studentId);

        // Verify teacher has access to this course
        if (course && !teacherCanManageCourse(teacher.id, course, !!teacher.isSuperAdmin)) return null;

        // Resolve question text from immutable LessonVersion
        const version = attempt?.lessonVersionId
          ? (db.lessonVersions || []).find((v: any) => v.id === attempt.lessonVersionId)
          : null;
        let questionText: any = null;
        let rubricCategories: any[] = [];
        if (version) {
          const block = (version.blocksSnapshot || []).find((b: any) => b.id === r.blockId);
          if (block) {
            let rawQ: any = null;
            if (r.checkpointId && Array.isArray(block.videoCheckpoints)) {
              const cp = block.videoCheckpoints.find((c: any) => c.id === r.checkpointId);
              rawQ = cp ? (cp.questions || []).find((q: any) => q.id === r.questionId) : null;
            } else {
              rawQ = block.singleQuestion ||
                (block.questionPool?.questions || []).find((q: any) => q.id === r.questionId);
            }
            if (rawQ) {
              questionText = rawQ.stem;
              rubricCategories = rawQ.rubricCategories || [];
            }
          }
        }

        const grading = r.aiGrading || {};
        const isPractice = r.gradebookCategory === 'practice' || r.gradingMode === 'practice';

        // Determine review status category
        let reviewStatus: string;
        const gre = (db.gradebookResponseEntries || []).find((e: any) => e.responseId === r.id);
        if (gre?.status === 'feedback_released') {
          reviewStatus = 'feedback_released';
        } else if (gre?.status === 'teacher_reviewed' || gre?.status === 'teacher_overridden') {
          reviewStatus = 'reviewed_not_released';
        } else if (!grading.status || grading.status === 'pending') {
          reviewStatus = 'pending_ai';
        } else if (grading.status === 'failed') {
          reviewStatus = 'error';
        } else if (grading.status === 'needs_review' || r.isLowEffort) {
          reviewStatus = 'needs_teacher_review';
        } else {
          reviewStatus = 'ai_scored_awaiting_review';
        }

        if (statusFilter && reviewStatus !== statusFilter) return null;

        return {
          responseId: r.id,
          studentId: r.studentId,
          studentName: student?.name || 'Unknown Student',
          studentEmail: student?.email || '',
          courseId: course?.id || '',
          courseName: course?.name || '',
          assignmentId: assignment?.id || attempt?.assignmentId || '',
          lessonTitle: assignment
            ? ((db.lessons || []).find((l: any) => l.id === assignment.lessonId)?.title || '')
            : '',
          lessonVersionId: attempt?.lessonVersionId || null,
          questionText,
          rubricCategories,
          studentResponse: r.responseValue,
          isPractice,
          category: isPractice ? 'practice' : 'assessment',
          aiScore: grading.score,
          maxScore: r.maxPoints,
          aiFeedback: grading.feedback,
          aiRationale: grading.rationale,
          rubricBreakdown: grading.rubricBreakdown || {},
          confidence: grading.confidence,
          needsTeacherReview: grading.needsTeacherReview || r.isLowEffort || false,
          isLowEffort: r.isLowEffort || false,
          lowEffortReason: r.lowEffortReason || null,
          teacherOverride: r.teacherOverride || null,
          teacherReviewedAt: r.teacherReviewedAt || null,
          feedbackReleasedAt: gre?.feedbackReleasedAt || r.aiFeedbackReleasedAt || null,
          feedbackVisibleToStudent: !!(gre?.feedbackReleasedAt || r.aiFeedbackReleasedAt),
          gradebookStatus: gre?.status || (grading.status ? 'ai_scored' : 'pending_ai'),
          reviewStatus,
          submittedAt: r.createdAt || null,
          activeTimeSpent: r.activeTimeSpent || 0,
          attemptId: r.attemptId,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // Sort: pending_ai first, then needs_teacher_review, then ai_scored_awaiting_review, then reviewed, then released
    const order = ['pending_ai', 'error', 'needs_teacher_review', 'ai_scored_awaiting_review', 'reviewed_not_released', 'feedback_released'];
    queueItems.sort((a: any, b: any) => (order.indexOf(a.reviewStatus) - order.indexOf(b.reviewStatus)));

    // Build summary counts
    const counts: Record<string, number> = {};
    for (const item of queueItems) {
      counts[item.reviewStatus] = (counts[item.reviewStatus] || 0) + 1;
    }

    res.json({ queue: queueItems, counts, total: queueItems.length });
  } catch (err) {
    sendAppError(res, err);
  }
});

// POST /api/ai-review/:responseId/approve — Mark AI score as accepted by teacher
app.post("/api/ai-review/:responseId/approve", requireTeacher, async (req, res) => {
  try {
    const { responseId } = req.params;
    const teacher = (req as any).user;
    const db = readDb();

    const responseIdx = db.responses.findIndex((r: any) => r.id === responseId);
    if (responseIdx === -1) { fail(res, 'NOT_FOUND', 'Response not found.'); return; }

    const response = db.responses[responseIdx];
    const now = new Date().toISOString();
    response.teacherReviewedAt = now;
    response.teacherReviewedBy = teacher.id;

    // Update GradebookResponseEntry
    const greIdx = (db.gradebookResponseEntries || []).findIndex((e: any) => e.responseId === responseId);
    if (greIdx !== -1) {
      db.gradebookResponseEntries[greIdx].status = 'teacher_reviewed';
      db.gradebookResponseEntries[greIdx].reviewedAt = now;
      db.gradebookResponseEntries[greIdx].reviewedBy = teacher.id;
      db.gradebookResponseEntries[greIdx].updatedAt = now;
    }

    // Update attempt GradebookEntry
    if (response.attemptId) recalculateAttemptScore(response.attemptId, db);

    await commitDb(db);
    res.json({ success: true, response: mergeResponsesWithAiGrading([db.responses[responseIdx]], db)[0] });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/ai-review/:responseId/override — Override AI score; preserve original AI score for audit
app.post("/api/ai-review/:responseId/override", requireTeacher, async (req, res) => {
  try {
    const { responseId } = req.params;
    const { score, studentFacingFeedback, teacherOnlyNotes } = req.body;
    const teacher = (req as any).user;
    const db = readDb();

    const responseIdx = db.responses.findIndex((r: any) => r.id === responseId);
    if (responseIdx === -1) { fail(res, 'NOT_FOUND', 'Response not found.'); return; }

    const response = db.responses[responseIdx];
    const now = new Date().toISOString();
    const aiRecord = (db.aiGradingRecords || []).find((g: any) => g.responseId === responseId);

    // Preserve original AI score before override
    const originalAiScore = aiRecord?.parsedScore ?? response.score ?? null;

    response.score = Number(score);
    response.pointsEarned = Number(score);
    response.teacherReviewedAt = now;
    response.teacherReviewedBy = teacher.id;
    response.teacherOverrideScore = Number(score);
    response.teacherOverrideFeedback = teacherOnlyNotes || '';
    response.teacherOverride = { score: Number(score), notes: teacherOnlyNotes || '', gradedAt: now };
    if (studentFacingFeedback !== undefined) {
      response.studentFacingFeedback = studentFacingFeedback;
    }

    // GradebookResponseEntry
    const greIdx = (db.gradebookResponseEntries || []).findIndex((e: any) => e.responseId === responseId);
    const gre = greIdx !== -1 ? db.gradebookResponseEntries[greIdx] : null;
    if (greIdx !== -1) {
      gre.status = 'teacher_overridden';
      gre.score = Number(score);
      gre.originalAiScore = originalAiScore;
      gre.reviewedAt = now;
      gre.reviewedBy = teacher.id;
      if (studentFacingFeedback !== undefined) gre.studentFacingFeedback = studentFacingFeedback;
      if (teacherOnlyNotes) gre.teacherOnlyNotes = teacherOnlyNotes;
      gre.updatedAt = now;
    } else {
      // Create a GradebookResponseEntry if missing
      const attempt = (db.attempts || []).find((a: any) => a.id === response.attemptId);
      if (attempt) upsertResponseGradebookEntry(response, attempt, 'teacher_overridden', 'teacher_override', studentFacingFeedback || teacherOnlyNotes || '', db);
    }

    if (response.attemptId) recalculateAttemptScore(response.attemptId, db);

    await commitDb(db);
    res.json({ success: true, response: mergeResponsesWithAiGrading([db.responses[responseIdx]], db)[0] });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/ai-review/:responseId/mark-reviewed — Mark a response as reviewed without changing score
app.post("/api/ai-review/:responseId/mark-reviewed", requireTeacher, async (req, res) => {
  try {
    const { responseId } = req.params;
    const { teacherOnlyNotes } = req.body;
    const teacher = (req as any).user;
    const db = readDb();

    const responseIdx = db.responses.findIndex((r: any) => r.id === responseId);
    if (responseIdx === -1) { fail(res, 'NOT_FOUND', 'Response not found.'); return; }

    const response = db.responses[responseIdx];
    const now = new Date().toISOString();
    response.teacherReviewedAt = now;
    response.teacherReviewedBy = teacher.id;
    if (teacherOnlyNotes) response.teacherOverrideFeedback = teacherOnlyNotes;

    const greIdx = (db.gradebookResponseEntries || []).findIndex((e: any) => e.responseId === responseId);
    if (greIdx !== -1) {
      db.gradebookResponseEntries[greIdx].status = 'teacher_reviewed';
      db.gradebookResponseEntries[greIdx].reviewedAt = now;
      db.gradebookResponseEntries[greIdx].reviewedBy = teacher.id;
      if (teacherOnlyNotes) db.gradebookResponseEntries[greIdx].teacherOnlyNotes = teacherOnlyNotes;
      db.gradebookResponseEntries[greIdx].updatedAt = now;
    }

    if (response.attemptId) recalculateAttemptScore(response.attemptId, db);
    await commitDb(db);
    res.json({ success: true });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/ai-review/:responseId/release-feedback — Release student-facing feedback for one response
app.post("/api/ai-review/:responseId/release-feedback", requireTeacher, async (req, res) => {
  try {
    const { responseId } = req.params;
    const { studentFacingFeedback } = req.body;
    const teacher = (req as any).user;
    const db = readDb();

    const responseIdx = db.responses.findIndex((r: any) => r.id === responseId);
    if (responseIdx === -1) { fail(res, 'NOT_FOUND', 'Response not found.'); return; }

    const response = db.responses[responseIdx];
    const now = new Date().toISOString();

    // Set student-facing feedback and mark released
    if (studentFacingFeedback !== undefined) {
      response.studentFacingFeedback = studentFacingFeedback;
    }
    response.aiFeedbackReleasedAt = now;
    response.feedbackReleasedAt = now;
    response.feedbackVisibleToStudent = true;

    const greIdx = (db.gradebookResponseEntries || []).findIndex((e: any) => e.responseId === responseId);
    if (greIdx !== -1) {
      db.gradebookResponseEntries[greIdx].status = 'feedback_released';
      db.gradebookResponseEntries[greIdx].feedbackReleasedAt = now;
      db.gradebookResponseEntries[greIdx].feedbackReleasedBy = teacher.id;
      db.gradebookResponseEntries[greIdx].feedbackVisibleToStudent = true;
      if (studentFacingFeedback !== undefined) {
        db.gradebookResponseEntries[greIdx].studentFacingFeedback = studentFacingFeedback;
      }
      db.gradebookResponseEntries[greIdx].updatedAt = now;
    }

    // Update GradebookEntry if all responses for this attempt are released
    if (response.attemptId) {
      const attempt = (db.attempts || []).find((a: any) => a.id === response.attemptId);
      if (attempt) {
        const assignmentId = attempt.assignmentId;
        if (assignmentId) {
          const gbIdx = (db.gradebookEntries || []).findIndex(
            (e: any) => e.assignmentId === assignmentId && e.studentId === response.studentId
          );
          if (gbIdx !== -1) {
            db.gradebookEntries[gbIdx].feedbackReleasedAt = now;
            db.gradebookEntries[gbIdx].feedbackReleasedBy = teacher.id;
            db.gradebookEntries[gbIdx].status = 'feedback_released';
            db.gradebookEntries[gbIdx].updatedAt = now;
          }
        }
      }
    }

    await commitDb(db);
    res.json({ success: true });
  } catch (err) { sendAppError(res, err); }
});

// POST /api/assignments/:assignmentId/release-reviewed-feedback — Bulk release for all reviewed responses
app.post("/api/assignments/:assignmentId/release-reviewed-feedback", requireTeacher, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const teacher = (req as any).user;
    const db = readDb();

    const assignment = (db.lessonAssignments || []).find((a: any) => a.id === assignmentId);
    if (!assignment) { fail(res, 'NOT_FOUND', 'Assignment not found.'); return; }
    const course = (db.courses || []).find((c: any) => c.id === assignment.courseId);
    if (!teacherCanManageCourse(teacher.id, course, !!teacher.isSuperAdmin)) {
      fail(res, 'FORBIDDEN', 'You do not have access to this course.'); return;
    }

    const now = new Date().toISOString();
    let releasedCount = 0;

    // Release all reviewed/overridden responses for this assignment's attempts
    const assignmentAttempts = (db.attempts || []).filter((a: any) => a.assignmentId === assignmentId);
    const attemptIds = new Set(assignmentAttempts.map((a: any) => a.id));

    (db.gradebookResponseEntries || []).forEach((gre: any, i: number) => {
      if (!attemptIds.has(gre.attemptId)) return;
      if (!['teacher_reviewed', 'teacher_overridden', 'ai_scored'].includes(gre.status)) return;
      db.gradebookResponseEntries[i].status = 'feedback_released';
      db.gradebookResponseEntries[i].feedbackReleasedAt = now;
      db.gradebookResponseEntries[i].feedbackReleasedBy = teacher.id;
      db.gradebookResponseEntries[i].feedbackVisibleToStudent = true;
      db.gradebookResponseEntries[i].updatedAt = now;

      // Mirror onto the response record
      const rIdx = (db.responses || []).findIndex((r: any) => r.id === gre.responseId);
      if (rIdx !== -1) {
        db.responses[rIdx].aiFeedbackReleasedAt = now;
        db.responses[rIdx].feedbackReleasedAt = now;
        db.responses[rIdx].feedbackVisibleToStudent = true;
      }
      releasedCount++;
    });

    // Update all affected GradebookEntries
    assignmentAttempts.forEach((a: any) => {
      const gbIdx = (db.gradebookEntries || []).findIndex(
        (e: any) => e.assignmentId === assignmentId && e.studentId === a.studentId
      );
      if (gbIdx !== -1) {
        db.gradebookEntries[gbIdx].feedbackReleasedAt = now;
        db.gradebookEntries[gbIdx].feedbackReleasedBy = teacher.id;
        db.gradebookEntries[gbIdx].status = 'feedback_released';
        db.gradebookEntries[gbIdx].updatedAt = now;
      }
    });

    await commitDb(db);
    res.json({ success: true, releasedCount });
  } catch (err) { sendAppError(res, err); }
});

// ====================================================
// AI Rubric Authoring Endpoints (teacher-only)
// ====================================================

function buildRubricGenerationPrompt(input: {
  lessonTitle: string;
  lessonDescription?: string;
  blockTitle?: string;
  questionStem: string;
  studentInstructions?: string;
  courseContext?: string;
  gradeLevel?: string;
  desiredDifficulty?: string;
  points: number;
  existingTeacherNotes?: string;
}): string {
  const lines: string[] = [
    `You are an expert academic rubric designer assisting a teacher at Malvern Prep.`,
    `Generate a complete, practical short-answer rubric for classroom grading.`,
    ``,
    `CRITICAL RULES:`,
    `1. Output ONLY valid JSON. No markdown fences (no backticks). No commentary before or after the JSON.`,
    `2. rubricCategories must sum to EXACTLY ${input.points} total points. Verify the sum before outputting.`,
    `3. Each category maxPoints must be a positive integer (minimum 1).`,
    `4. modelAnswer must be scientifically accurate and represent a complete full-credit response.`,
    `5. aiScoringGuidance is teacher/AI-only — it MUST NEVER be shown to students. Include specific criteria and edge cases.`,
    `6. studentFeedbackStyle describes the tone and approach for student-facing AI feedback WITHOUT revealing the model answer.`,
    `7. Rubric descriptions must be specific. Avoid vague criteria like "demonstrates understanding" alone.`,
    `8. full/partial/noCreditExample must be realistic student-written responses (not summaries or descriptions).`,
    `9. If the question is too vague to grade reliably, note this clearly in aiScoringGuidance.`,
    `10. commonMisconceptions: list 2–5 specific, concrete errors students commonly make on this type of question.`,
    `11. Do NOT include correct answers or scoring guidance in studentFeedbackStyle.`,
    ``,
    `CONTEXT:`,
    `- Lesson: "${input.lessonTitle}"`,
  ];

  if (input.lessonDescription) lines.push(`- Lesson description: "${input.lessonDescription}"`);
  if (input.blockTitle) lines.push(`- Section/block: "${input.blockTitle}"`);
  if (input.courseContext) lines.push(`- Course context: "${input.courseContext}"`);
  if (input.gradeLevel) lines.push(`- Grade level: "${input.gradeLevel}"`);
  if (input.desiredDifficulty) lines.push(`- Desired difficulty: "${input.desiredDifficulty}"`);
  if (input.existingTeacherNotes) lines.push(`- Teacher notes: "${input.existingTeacherNotes}"`);

  lines.push(``, `QUESTION:`, `"${input.questionStem}"`);
  if (input.studentInstructions) lines.push(``, `Student instructions given: "${input.studentInstructions}"`);
  lines.push(
    ``,
    `TOTAL POINTS: ${input.points}`,
    ``,
    `Output exactly this JSON structure (all fields required):`,
    `{`,
    `  "modelAnswer": "complete full-credit response",`,
    `  "aiScoringGuidance": "specific teacher-facing scoring criteria and edge cases",`,
    `  "rubricCategories": [`,
    `    {`,
    `      "name": "category name",`,
    `      "maxPoints": 1,`,
    `      "description": "specific criteria for earning credit in this category",`,
    `      "fullCreditExample": "realistic student response that earns full credit",`,
    `      "partialCreditExample": "realistic student response that earns partial credit",`,
    `      "noCreditExample": "realistic student response that earns no credit"`,
    `    }`,
    `  ],`,
    `  "commonMisconceptions": ["specific misconception 1", "specific misconception 2"],`,
    `  "studentFeedbackStyle": "how AI feedback should be phrased for students without revealing answers"`,
    `}`
  );

  return lines.join("\n");
}

function buildRubricRevisionPrompt(input: {
  questionStem: string;
  currentModelAnswer: string;
  currentScoringGuidance: string;
  currentRubricCategories: any[];
  points: number;
  revisionInstruction: string;
  courseContext?: string;
  desiredDifficulty?: string;
}): string {
  const currentRubricJson = input.currentRubricCategories.length
    ? JSON.stringify(
        input.currentRubricCategories.map((c: any) => ({
          name: asPlainText(c.name),
          maxPoints: c.maxPoints,
          description: asPlainText(c.description),
          fullCreditExample: asPlainText(c.fullCreditExample),
          partialCreditExample: asPlainText(c.partialCreditExample),
          noCreditExample: asPlainText(c.noCreditExample),
        })),
        null,
        2
      )
    : "(none)";

  return [
    `You are an expert academic rubric designer assisting a teacher at Malvern Prep.`,
    `Revise the existing short-answer rubric according to the teacher's instruction.`,
    ``,
    `CRITICAL RULES:`,
    `1. Output ONLY valid JSON. No markdown fences. No commentary before or after the JSON.`,
    `2. rubricCategories must sum to EXACTLY ${input.points} total points. Verify the sum before outputting.`,
    `3. Each category maxPoints must be a positive integer (minimum 1).`,
    `4. Apply the revision instruction faithfully while keeping the rubric practical for classroom grading.`,
    `5. full/partial/noCreditExample must be concrete, realistic student-written responses.`,
    `6. If the question is too vague to grade reliably after revision, note this in aiScoringGuidance.`,
    `7. Do NOT include correct answers or scoring guidance in studentFeedbackStyle.`,
    ``,
    `QUESTION: "${input.questionStem}"`,
    input.courseContext ? `COURSE CONTEXT: "${input.courseContext}"` : "",
    input.desiredDifficulty ? `DESIRED DIFFICULTY: "${input.desiredDifficulty}"` : "",
    `TOTAL POINTS: ${input.points}`,
    ``,
    `CURRENT MODEL ANSWER:`,
    input.currentModelAnswer || "(not set)",
    ``,
    `CURRENT SCORING GUIDANCE:`,
    input.currentScoringGuidance || "(not set)",
    ``,
    `CURRENT RUBRIC CATEGORIES:`,
    currentRubricJson,
    ``,
    `REVISION INSTRUCTION FROM TEACHER:`,
    `"${input.revisionInstruction}"`,
    ``,
    `Output exactly this JSON structure:`,
    `{`,
    `  "modelAnswer": "...",`,
    `  "aiScoringGuidance": "...",`,
    `  "rubricCategories": [`,
    `    {`,
    `      "name": "...",`,
    `      "maxPoints": 1,`,
    `      "description": "...",`,
    `      "fullCreditExample": "...",`,
    `      "partialCreditExample": "...",`,
    `      "noCreditExample": "..."`,
    `    }`,
    `  ],`,
    `  "commonMisconceptions": ["..."],`,
    `  "studentFeedbackStyle": "..."`,
    `}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

function validateRubricFields(parsed: any): void {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI output is not a valid JSON object.");
  }
  if (typeof parsed.modelAnswer !== "string" || parsed.modelAnswer.trim().length === 0) {
    throw new Error("Missing or empty field: 'modelAnswer'");
  }
  if (typeof parsed.aiScoringGuidance !== "string" || parsed.aiScoringGuidance.trim().length === 0) {
    throw new Error("Missing or empty field: 'aiScoringGuidance'");
  }
  if (!Array.isArray(parsed.rubricCategories) || parsed.rubricCategories.length === 0) {
    throw new Error("Missing or empty array: 'rubricCategories'");
  }

  parsed.rubricCategories.forEach((cat: any, i: number) => {
    if (!cat || typeof cat !== "object") {
      throw new Error(`Rubric category at index ${i} is not a valid object.`);
    }
    if (typeof cat.name !== "string" || cat.name.trim().length === 0) {
      throw new Error(`Rubric category at index ${i} is missing 'name'`);
    }
    if (cat.maxPoints === undefined || cat.maxPoints === null) {
      throw new Error(`Rubric category '${cat.name || i}' is missing 'maxPoints'`);
    }
    const maxPts = Number(cat.maxPoints);
    if (!Number.isFinite(maxPts) || maxPts < 1) {
      throw new Error(`Rubric category '${cat.name || i}' has invalid 'maxPoints' (${cat.maxPoints})`);
    }
    if (typeof cat.description !== "string" || cat.description.trim().length === 0) {
      throw new Error(`Rubric category '${cat.name || i}' is missing 'description'`);
    }
    if (typeof cat.fullCreditExample !== "string" || cat.fullCreditExample.trim().length === 0) {
      throw new Error(`Rubric category '${cat.name || i}' is missing 'fullCreditExample'`);
    }
    if (typeof cat.partialCreditExample !== "string" || cat.partialCreditExample.trim().length === 0) {
      throw new Error(`Rubric category '${cat.name || i}' is missing 'partialCreditExample'`);
    }
    if (typeof cat.noCreditExample !== "string" || cat.noCreditExample.trim().length === 0) {
      throw new Error(`Rubric category '${cat.name || i}' is missing 'noCreditExample'`);
    }
  });
}

function getRubricResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      modelAnswer: {
        type: Type.STRING,
        description: "A complete, correct, scientific, and student-ready exemplary response that would earn 100% full credit.",
      },
      aiScoringGuidance: {
        type: Type.STRING,
        description: "Teacher and AI-facing key points, constraints, and edge cases to look for when grading.",
      },
      rubricCategories: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "The name of this metric or dimension (e.g., 'Claim', 'Evidence').",
            },
            maxPoints: {
              type: Type.INTEGER,
              description: "Positive integer representing maximum points allocated for this category.",
            },
            description: {
              type: Type.STRING,
              description: "Specific academic standard and details of how to earn these points.",
            },
            fullCreditExample: {
              type: Type.STRING,
              description: "A concrete example of a high-quality student response that gets full credit in this category.",
            },
            partialCreditExample: {
              type: Type.STRING,
              description: "A concrete example of a flawed student response that gets partial credit in this category.",
            },
            noCreditExample: {
              type: Type.STRING,
              description: "A concrete example of a poor student response that earns 0 points in this category.",
            },
          },
          required: [
            "name",
            "maxPoints",
            "description",
            "fullCreditExample",
            "partialCreditExample",
            "noCreditExample"
          ],
        },
        description: "The set of specific grading dimensions composing the rubric.",
      },
      commonMisconceptions: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING,
        },
        description: "2 to 5 specific, concrete student errors or misconceptions on this topic.",
      },
      studentFeedbackStyle: {
        type: Type.STRING,
        description: "Guidance on how feedback should be phrased for students without giving the answer away.",
      },
    },
    required: [
      "modelAnswer",
      "aiScoringGuidance",
      "rubricCategories",
      "commonMisconceptions",
      "studentFeedbackStyle"
    ],
  };
}

function buildJsonRepairPrompt(originalResponse: string, errorMsg: string): string {
  return [
    `You are a strict data-cleaning assistant.`,
    `The user attempted to parse the previous AI generation as a JSON object matching a specific rubric schema, but the parse or validation failed.`,
    ``,
    `PREVIOUS RAW AI OUTPUT:`,
    `---`,
    originalResponse,
    `---`,
    ``,
    `ERROR ENCOUNTERED during parse/validation:`,
    `"${errorMsg}"`,
    ``,
    `YOUR TASK:`,
    `Convert or repair the previous raw output into a strictly valid JSON object.`,
    `Do not add commentary, footnotes, or formatting fences other than standard JSON format.`,
    `Ensure the returned fields strictly adhere to the requested schema. Ensure point values are positive integers.`,
    `If essential fields are missing from the raw input, synthesize reasonable values that align with the context of the question.`
  ].join("\n");
}

async function generateRubricWithSchemaAndRetry(
  prompt: string,
  points: number,
  systemInstruction: string,
  isRevision: boolean = false
): Promise<{ result: any; warnings: string[] }> {
  const model = process.env.AI_GRADING_MODEL || "gemini-3.5-flash";
  const ai = getAI();
  const schema = getRubricResponseSchema();

  let lastRawText = "";
  let lastError: any = null;

  // Try 1
  try {
    const aiResponse = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    lastRawText = (aiResponse.text || "").trim();
    const parsed = parseAiGradingJson(lastRawText);
    validateRubricFields(parsed);
    return normalizeGeneratedRubric(parsed, points);
  } catch (err: any) {
    lastError = err;
    console.warn("VERITAS Learn - First rubric generation try failed. Attempting JSON repair retry...", err);
  }

  // Try 2 (JSON-repair)
  try {
    const repairPrompt = buildJsonRepairPrompt(
      lastRawText || (lastError && lastError.message) || "No previous output available.",
      lastError ? lastError.message : "Unknown verification or structure error"
    );

    const repairSystemInstruction = isRevision
      ? "You are a strict JSON data-repair assistant. Based on the teacher's revision instruction, correct and rebuild the rubric JSON to conform 100% to the requested schema."
      : "You are a strict JSON data-repair assistant. Correct and rebuild the rubric JSON to conform 100% to the requested schema.";

    const aiResponse = await ai.models.generateContent({
      model,
      contents: repairPrompt,
      config: {
        systemInstruction: repairSystemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const repairRawText = (aiResponse.text || "").trim();
    const parsed = parseAiGradingJson(repairRawText);
    validateRubricFields(parsed);
    return normalizeGeneratedRubric(parsed, points);
  } catch (repairErr: any) {
    console.error("VERITAS Learn - Rubric generation AND repair failed:", repairErr);
    throw new Error(
      `AI rubric generation failed after repair effort. Reason: ${repairErr.message || "Invalid JSON structure parsed."}`
    );
  }
}

function normalizeGeneratedRubric(
  parsed: any,
  requestedPoints: number
): { result: any; warnings: string[] } {
  const warnings: string[] = [];
  let categories: any[] = Array.isArray(parsed.rubricCategories) ? parsed.rubricCategories : [];

  // Ensure each category has a stable id and positive maxPoints
  categories = categories.map((cat: any, i: number) => ({
    id:
      cat.id && typeof cat.id === "string"
        ? cat.id
        : `rub_${Date.now().toString(36)}${i}${Math.random().toString(36).substring(2, 5)}`,
    name: typeof cat.name === "string" ? cat.name : `Category ${i + 1}`,
    maxPoints: Math.max(1, Math.round(Number(cat.maxPoints) || 1)),
    description: typeof cat.description === "string" ? cat.description : "",
    fullCreditExample: typeof cat.fullCreditExample === "string" ? cat.fullCreditExample : "",
    partialCreditExample: typeof cat.partialCreditExample === "string" ? cat.partialCreditExample : "",
    noCreditExample: typeof cat.noCreditExample === "string" ? cat.noCreditExample : "",
  }));

  if (categories.length === 0) {
    warnings.push("AI returned no rubric categories. Add categories manually.");
  } else {
    const total = categories.reduce((s: number, c: any) => s + c.maxPoints, 0);
    if (total !== requestedPoints) {
      warnings.push(
        `Rubric total (${total} pts) did not match requested points (${requestedPoints} pts). Points have been normalized proportionally.`
      );
      // Proportional normalization: preserve relative weights, fix last category remainder
      if (total > 0) {
        let remaining = requestedPoints;
        categories = categories.map((cat: any, i: number) => {
          if (i === categories.length - 1) {
            return { ...cat, maxPoints: Math.max(1, remaining) };
          }
          const share = Math.max(1, Math.round((cat.maxPoints / total) * requestedPoints));
          remaining = Math.max(categories.length - i - 1, remaining - share);
          return { ...cat, maxPoints: share };
        });
      } else {
        // All-zero edge case: distribute evenly
        const per = Math.max(1, Math.floor(requestedPoints / categories.length));
        let rem = requestedPoints;
        categories = categories.map((cat: any, i: number) => {
          if (i === categories.length - 1) return { ...cat, maxPoints: Math.max(1, rem) };
          rem -= per;
          return { ...cat, maxPoints: per };
        });
      }
    }
  }

  return {
    result: {
      modelAnswer: typeof parsed.modelAnswer === "string" ? parsed.modelAnswer : "",
      aiScoringGuidance: typeof parsed.aiScoringGuidance === "string" ? parsed.aiScoringGuidance : "",
      rubricCategories: categories,
      commonMisconceptions: Array.isArray(parsed.commonMisconceptions)
        ? parsed.commonMisconceptions.filter((m: any) => typeof m === "string")
        : [],
      studentFeedbackStyle: typeof parsed.studentFeedbackStyle === "string" ? parsed.studentFeedbackStyle : "",
    },
    warnings,
  };
}

// POST /api/ai/generate-short-answer-rubric
app.post("/api/ai/generate-short-answer-rubric", requireTeacher, async (req, res) => {
  try {
    const {
      lessonTitle,
      lessonDescription,
      blockTitle,
      questionStem,
      studentInstructions,
      courseContext,
      gradeLevel,
      desiredDifficulty,
      points,
      existingTeacherNotes,
    } = req.body;

    if (!questionStem || typeof questionStem !== "string" || questionStem.trim().length === 0) {
      res.status(400).json({ error: "questionStem is required and cannot be empty." });
      return;
    }
    if (!lessonTitle || typeof lessonTitle !== "string" || lessonTitle.trim().length === 0) {
      res.status(400).json({ error: "lessonTitle is required." });
      return;
    }
    const pointsNum = Number(points);
    if (!Number.isFinite(pointsNum) || pointsNum < 1 || pointsNum > 100) {
      res.status(400).json({ error: "points must be a positive integer between 1 and 100." });
      return;
    }
    const validDifficulties = ["introductory", "standard", "advanced", "AP-style"];
    if (desiredDifficulty && !validDifficulties.includes(desiredDifficulty)) {
      res.status(400).json({ error: `desiredDifficulty must be one of: ${validDifficulties.join(", ")}.` });
      return;
    }

    const prompt = buildRubricGenerationPrompt({
      lessonTitle: lessonTitle.trim(),
      lessonDescription: lessonDescription ? String(lessonDescription).trim() : undefined,
      blockTitle: blockTitle ? String(blockTitle).trim() : undefined,
      questionStem: questionStem.trim(),
      studentInstructions: studentInstructions ? String(studentInstructions).trim() : undefined,
      courseContext: courseContext ? String(courseContext).trim() : undefined,
      gradeLevel: gradeLevel ? String(gradeLevel).trim() : undefined,
      desiredDifficulty: desiredDifficulty || undefined,
      points: Math.round(pointsNum),
      existingTeacherNotes: existingTeacherNotes ? String(existingTeacherNotes).trim() : undefined,
    });

    const systemInstruction = 
      "You are an expert academic rubric designer. Output strictly valid JSON only conforming to the response schema. No markdown fences, no commentary. Produce rubrics that are specific, practical, and classroom-ready.";

    const { result, warnings } = await generateRubricWithSchemaAndRetry(
      prompt,
      Math.round(pointsNum),
      systemInstruction,
      false
    );

    res.json({ ...result, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (err: any) {
    console.error("VERITAS Learn - Rubric generation error:", err);
    res.status(502).json({
      error: err.message || "Rubric generation failed after repair effort."
    });
  }
});

// POST /api/ai/revise-rubric
app.post("/api/ai/revise-rubric", requireTeacher, async (req, res) => {
  try {
    const {
      questionStem,
      currentModelAnswer,
      currentScoringGuidance,
      currentRubricCategories,
      points,
      revisionInstruction,
      courseContext,
      desiredDifficulty,
    } = req.body;

    if (!questionStem || typeof questionStem !== "string" || questionStem.trim().length === 0) {
      res.status(400).json({ error: "questionStem is required and cannot be empty." });
      return;
    }
    if (
      !revisionInstruction ||
      typeof revisionInstruction !== "string" ||
      revisionInstruction.trim().length === 0
    ) {
      res.status(400).json({ error: "revisionInstruction is required." });
      return;
    }
    const pointsNum = Number(points);
    if (!Number.isFinite(pointsNum) || pointsNum < 1 || pointsNum > 100) {
      res.status(400).json({ error: "points must be a positive integer between 1 and 100." });
      return;
    }

    const prompt = buildRubricRevisionPrompt({
      questionStem: questionStem.trim(),
      currentModelAnswer: asPlainText(currentModelAnswer),
      currentScoringGuidance: asPlainText(currentScoringGuidance),
      currentRubricCategories: Array.isArray(currentRubricCategories) ? currentRubricCategories : [],
      points: Math.round(pointsNum),
      revisionInstruction: revisionInstruction.trim(),
      courseContext: courseContext ? String(courseContext).trim() : undefined,
      desiredDifficulty: desiredDifficulty ? String(desiredDifficulty).trim() : undefined,
    });

    const systemInstruction =
      "You are an expert academic rubric designer. Apply the teacher's revision instruction faithfully. Output strictly valid JSON only conforming to the response schema. No markdown fences, no commentary.";

    const { result, warnings } = await generateRubricWithSchemaAndRetry(
      prompt,
      Math.round(pointsNum),
      systemInstruction,
      true
    );

    res.json({ ...result, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (err: any) {
    console.error("VERITAS Learn - Rubric revision error:", err);
    res.status(502).json({
      error: err.message || "Rubric revision failed after repair effort."
    });
  }
});

// Unmatched API routes fallback to avoid serving SPA HTML
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.originalUrl} not found.` });
});

// ==========================================
// Vite Integration & Production Serving
// ==========================================
async function startServer() {
  // Restore all data models and sync from Cloud Firestore
  await loadDatabaseFromFirestore();

  // Migrate raw embedded aiGrading values to clean, separate collection
  const db = readDb();
  let migratedCount = 0;
  if (!db.aiGradingRecords) {
    db.aiGradingRecords = [];
  }
  db.responses.forEach((r: any) => {
    if (r.aiGrading) {
      const alreadyExists = db.aiGradingRecords.some((g: any) => g.responseId === r.id);
      if (!alreadyExists) {
        db.aiGradingRecords.push({
          id: "aigr_" + Math.random().toString(36).substring(2, 9),
          responseId: r.id,
          provider: "google",
          model: process.env.AI_GRADING_MODEL || "gemini-3.5-flash",
          promptVersion: "1.0",
          rubricSnapshot: [],
          inputHash: "",
          parsedScore: Number(r.aiGrading.score) || 0,
          confidence: Number(r.aiGrading.confidence) || 0,
          rationale: r.aiGrading.rationale || "",
          rubricBreakdown: r.aiGrading.rubricBreakdown || {},
          status: r.aiGrading.status || "success",
          gradedAt: r.aiGrading.gradedAt || new Date().toISOString()
        });
        migratedCount++;
      }
      delete r.aiGrading;
    }
  });
  if (migratedCount > 0) {
    console.log(`VERITAS Learn - Migrated ${migratedCount} embedded AI grading records to separate collection.`);
    writeDb(db);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VERITAS Learn - Live full-stack portal listening on http://localhost:${PORT}`);
  });
}

startServer();
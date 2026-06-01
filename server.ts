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
  gradeMc,
  choiceTextById,
  findLeakedSecretFields,
} from "./server/data/sanitize";
import { validateLessonBlocks } from "./server/data/validation";

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

// Configurable domain and teacher allowlist from environment
const ALLOWED_DOMAIN = (process.env.GOOGLE_ALLOWED_DOMAIN || "malvernprep.org").toLowerCase();
const TEACHER_EMAILS: Set<string> = new Set(
  (process.env.TEACHER_EMAILS || "stephenborish@gmail.com")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
);

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
  "lessons",
  "blocks",
  "attempts",
  "questionAssignments",
  "responses",
  "securitySignals",
  "aiGradingRecords",
  "lessonAssignments",
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
  return dbMemory;
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
          rationale: record.rationale,
          confidence: record.confidence,
          status: record.status,
          rubricBreakdown: record.rubricBreakdown,
          gradedAt: record.gradedAt
        }
      };
    }
    return r;
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

// Build the short-answer grading prompt from the teacher-authored rubric + guidance.
function buildShortAnswerPrompt(lesson: any, q: any, responseValue: any, maxPoints: number): string {
  const rubricLines = (q.rubricCategories || [])
    .map((c: any, i: number) => {
      const parts = [
        `  ${i + 1}. ${asPlainText(c.name)} (max ${c.maxPoints} pts): ${asPlainText(c.description)}`,
      ];
      if (c.fullCreditExample) parts.push(`     Full-credit example: ${asPlainText(c.fullCreditExample)}`);
      if (c.partialCreditExample) parts.push(`     Partial-credit example: ${asPlainText(c.partialCreditExample)}`);
      if (c.noCreditExample) parts.push(`     No-credit example: ${asPlainText(c.noCreditExample)}`);
      return parts.join("\n");
    })
    .join("\n");

  const optional = (label: string, val: any) => (val ? `\n${label}:\n${asPlainText(val)}\n` : "");

  return [
    `You are assisting a teacher in grading a written response for "${asPlainText(lesson.title)}" at Malvern Prep.`,
    `Use ONLY the teacher-authored rubric and guidance below. Your score is a suggestion for teacher review.`,
    ``,
    `Question / prompt:`,
    `"${asPlainText(q.stem)}"`,
    optional("Model / expected answer", q.modelAnswer),
    optional("Answer key", q.answerKey),
    optional("AI scoring guidance", q.aiScoringGuidance),
    `Rubric categories (total max ${maxPoints} points):`,
    rubricLines || "  (no rubric categories provided)",
    ``,
    `Student's submission:`,
    `"${asPlainText(responseValue)}"`,
    ``,
    `Grade against the rubric. Return a total score between 0 and ${maxPoints}, a confidence in [0,1],`,
    `a brief rationale, and per-category feedback. Do not exceed the maximum points.`,
  ].join("\n");
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

    // Domain and allowlist check — no role based on email text patterns
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`) && !TEACHER_EMAILS.has(email)) {
      return null;
    }

    const db = readDb();
    let user = db.users.find((u: any) => u.id === decodedToken.uid || u.email.toLowerCase() === email);

    if (!user) {
      // New users default to student. Teacher role only from TEACHER_EMAILS env or existing user document.
      const isTeacher = TEACHER_EMAILS.has(email);
      user = {
        id: decodedToken.uid,
        name: decodedToken.name || email.split("@")[0].replace(/[._]/g, " "),
        email,
        role: isTeacher ? "teacher" : "student",
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      writeDb(db);
    } else if (user.id !== decodedToken.uid) {
      user.id = decodedToken.uid;
      writeDb(db);
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
    if (!firebaseBucket) {
      res.status(500).json({ error: "Firebase Storage is not initialized." });
      return;
    }

    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname);
    const base = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${base}-${uniqueSuffix}${ext}`;
    
    const fileRef = firebaseBucket.file(`videos/${filename}`);
    
    await fileRef.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
      resumable: false,
    });
    
    const videoUrl = await getDownloadURL(fileRef);

    res.json({
      success: true,
      videoUrl,
      storagePath: `videos/${filename}`,
      filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (err: any) {
    console.error("Firebase Storage Upload Route Error:", err);
    res.status(500).json({ error: err.message || "Failed to upload file to Firebase Storage." });
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

    if (!email.endsWith(`@${ALLOWED_DOMAIN}`) && !TEACHER_EMAILS.has(email)) {
      res.status(403).json({ error: "Access restricted to authorized Malvern Prep accounts. Contact your administrator if you believe this is an error." });
      return;
    }

    const db = readDb();
    let user = db.users.find((u: any) => u.id === decodedToken.uid || u.email.toLowerCase() === email);

    if (!user) {
      // New users default to student. Teacher role only from TEACHER_EMAILS env or existing user document.
      const isTeacher = TEACHER_EMAILS.has(email);
      user = {
        id: decodedToken.uid,
        name: decodedToken.name || email.split("@")[0].replace(/[._]/g, " "),
        email,
        role: isTeacher ? "teacher" : "student",
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      writeDb(db);
    } else if (user.id !== decodedToken.uid) {
      user.id = decodedToken.uid;
      writeDb(db);
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
// Lessons & Content APIs
// ==========================================
// Fetch list of lessons
app.get("/api/lessons", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();
  
  let targetLessons = db.lessons;
  if (user.role === "student") {
    // Only published lessons for students
    targetLessons = db.lessons.filter((l: any) => l.isPublished);
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

  if (user.role === "student" && !lesson.isPublished) {
    res.status(403).json({ error: "Lesson is currently archived or secret." });
    return;
  }

  let blocks = db.blocks
    .filter((b: any) => b.lessonId === id)
    .sort((a: any, b: any) => a.order - b.order);

  // SECURITY: students receive an explicitly sanitized payload — every embedded
  // question is stripped of correct answers, rubrics, model answers, AI scoring
  // guidance, and teacher notes (graded AND practice). Feedback is delivered
  // separately via the submit response when the feedback policy allows.
  if (user.role === "student") {
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
      title: title || "New Untitled AP Lesson",
      description: description || "",
      courseId: courseId || "course_1",
      estimatedMinutes: Number(estimatedMinutes) || 30,
      isPublished: willPublish,
      createdAt: new Date().toISOString(),
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

    await commitDb(db);
    res.status(201).json({ success: true, lesson: newLesson });
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

    await commitDb(db);
    res.json({ success: true, lesson: db.lessons[lessonIdx] });
  } catch (err) {
    sendAppError(res, err);
  }
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
  // Keep attempts for record consistency unless necessary to delete
  writeDb(db);

  res.json({ success: true });
});

// ==========================================
// Lesson Assignments APIs
// ==========================================

// Fetch lesson assignments (All for teachers, only open for students)
app.get("/api/assignments", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();
  const now = new Date().toISOString();

  let list = db.lessonAssignments || [];

  if (user.role === "student") {
    // Show only open assignments (opensAt <= now <= closesAt) for students
    list = list.filter((asg: any) => {
      const opensAt = asg.opensAt || "";
      const closesAt = asg.closesAt || "";
      return opensAt <= now && now <= closesAt;
    });
  }

  // Join lesson metadata dynamically
  const enrichedList = list.map((asg: any) => {
    const lesson = db.lessons.find((l: any) => l.id === asg.lessonId);
    return {
      ...asg,
      lessonTitle: lesson ? lesson.title : "Unknown Lesson",
      lessonDescription: lesson ? lesson.description : "",
      lessonEstimatedMinutes: lesson ? lesson.estimatedMinutes : 30,
      lessonSettings: lesson ? lesson.settings : null,
      lessonIsPublished: lesson ? lesson.isPublished : false,
    };
  });

  res.json({ assignments: enrichedList });
});

// Teacher: Create a new lesson assignment
app.post("/api/assignments", requireTeacher, async (req, res) => {
  try {
    const db = readDb();
    const { lessonId, courseId, section, opensAt, dueAt, closesAt } = req.body;

    if (!lessonId || !courseId || !opensAt || !dueAt || !closesAt) {
      res.status(400).json({ error: "Missing required assignment parameters." });
      return;
    }

    const lessonExists = db.lessons.some((l: any) => l.id === lessonId);
    if (!lessonExists) {
      res.status(404).json({ error: "Selected lesson not found." });
      return;
    }

    const newAssignment = {
      id: "asg_" + Math.random().toString(36).substring(2, 9),
      lessonId,
      courseId,
      section: section || "All Sections",
      opensAt,
      dueAt,
      closesAt,
      createdAt: new Date().toISOString()
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

// List all attempts for the logged-in student (or all attempts for teachers)
app.get("/api/attempts", requireAuth, (req, res) => {
  const user = (req as any).user;
  const db = readDb();
  let attempts: any[];
  if (user.role === "teacher") {
    attempts = db.attempts;
  } else {
    attempts = db.attempts.filter((a: any) => a.studentId === user.id);
  }
  res.json({ attempts });
});

// Start Lesson Attempt (deterministic seed questions generation)
app.post("/api/attempts", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { lessonId } = req.body;
    const db = readDb();

    const lesson = db.lessons.find((l: any) => l.id === lessonId);
    if (!lesson) {
      fail(res, "NOT_FOUND", "Lesson not found.");
      return;
    }

    // Handle existing incomplete attempt or check retake policy
    const existingAttempts = db.attempts.filter((a: any) => a.lessonId === lessonId && a.studentId === user.id);
    const activeAttempt = existingAttempts.find((a: any) => a.status === "started");

    if (activeAttempt) {
      res.json({ attempt: activeAttempt });
      return;
    }

    if (existingAttempts.length > 0 && !lesson.settings.allowRetakes && user.role !== "teacher") {
      fail(res, "VALIDATION_ERROR", "Retakes are disabled for this lesson assessment.");
      return;
    }

    const seed = Math.floor(Math.random() * 900000) + 100000;
    const newAttempt = {
      id: "attempt_" + Math.random().toString(36).substring(2, 9),
      lessonId,
      studentId: user.id,
      seed,
      startedAt: new Date().toISOString(),
      status: "started",
      currentBlockIndex: 0,
      furthestVideoTimestamps: {},
      activeTimeSpent: 0,
      inactiveTimeSpent: 0
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

    // Defensive: never deliver an assignment payload that leaks secret fields.
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
  const questionAssignments = db.questionAssignments.filter((asg: any) => asg.attemptId === id);
  const rawResponses = db.responses.filter((r: any) => r.attemptId === id);
  const responses = mergeResponsesWithAiGrading(rawResponses, db);
  const signals = db.securitySignals.filter((s: any) => s.attemptId === id);

  res.json({
    attempt,
    lesson,
    // `questionAssignments` is the canonical key; `assignments` retained as a
    // deprecated alias for backward compatibility with older clients.
    questionAssignments,
    assignments: questionAssignments,
    responses,
    signals
  });
});

// Watch video progress validations
app.post("/api/attempts/:id/progress", requireAuth, (req, res) => {
  const { id } = req.params;
  const { blockId, timestamp, activeTime, inactiveTime } = req.body;
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

        // 2. Check video watch milestone against actual video duration if known
        if (lesson.settings.restrictSeeking && blockToCheck.videoDuration) {
          const videoDuration = blockToCheck.videoDuration;
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

    const block = db.blocks.find((b: any) => b.id === blockId);
    if (!block) {
      fail(res, "NOT_FOUND", "Block not found.");
      return;
    }

    let checkpoint: any = null;
    let rawOriginal: any = null;
    if (checkpointId && Array.isArray(block.videoCheckpoints)) {
      checkpoint = block.videoCheckpoints.find((c: any) => c.id === checkpointId);
      if (checkpoint) rawOriginal = (checkpoint.questions || []).find((q: any) => q.id === questionId);
    } else {
      rawOriginal =
        block.singleQuestion ||
        (block.questionPool && block.questionPool.questions.find((q: any) => q.id === questionId));
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

    // Idempotent: replace any prior response for this exact question (never double-count score).
    db.responses = db.responses.filter(
      (r: any) =>
        !(r.attemptId === id && r.blockId === blockId && r.questionId === questionId && (checkpointId ? r.checkpointId === checkpointId : true))
    );

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
      activeTimeSpent: Number(activeTimeSpent) || 0
    };

    if (isMC) {
      // MC AUTO-GRADING by stable choice id (scramble-proof; client score is never trusted).
      const { isCorrect } = gradeMc(originalQuestion, responseValue);
      newResponse.isCorrect = isCorrect;
      newResponse.score = isCorrect ? Number(originalQuestion.points) || 0 : 0;
      newResponse.responseText = choiceTextById(originalQuestion, responseValue);

      db.responses.push(newResponse);
      await commitDb(db);

      const feedbackAllowed = !!lesson.settings.immediateFeedback || isPracticeQuestion;
      res.json({
        success: true,
        gradedImmediate: true,
        isCorrect,
        score: newResponse.score,
        explanation: feedbackAllowed ? originalQuestion.explanation : undefined
      });
      return;
    }

    // ---- SHORT ANSWER: AI grading using teacher-authored rubric + guidance ----
    const maxPoints = Number(originalQuestion.points) || 0;
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
      model: process.env.AI_GRADING_MODEL || "gemini-2.0-flash",
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
    await commitDb(db);

    // Grade asynchronously so the student isn't blocked on the model round-trip.
    (async () => {
      try {
        const ai = getAI();
        const response = await ai.models.generateContent({
          model: process.env.AI_GRADING_MODEL || "gemini-2.0-flash",
          contents: promptContent,
          config: {
            systemInstruction:
              "You are Veritas AI, an assistive rubric grader. Your score is a suggestion for a teacher to review, not a final grade. Output strictly the requested JSON.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER, description: "Total points earned; must not exceed the maximum." },
                confidence: { type: Type.NUMBER, description: "0..1 confidence in this assessment." },
                rationale: { type: Type.STRING, description: "Brief justification grounded in the rubric and guidance." },
                rubricBreakdown: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: { type: Type.STRING },
                      score: { type: Type.NUMBER },
                      feedback: { type: Type.STRING }
                    },
                    required: ["category", "score", "feedback"]
                  }
                }
              },
              required: ["score", "confidence", "rationale", "rubricBreakdown"]
            }
          }
        });

        const rawJsonText = (response.text || "").trim();
        const geminiResult = JSON.parse(rawJsonText);

        const rubricObject: any = {};
        if (Array.isArray(geminiResult.rubricBreakdown)) {
          geminiResult.rubricBreakdown.forEach((item: any) => {
            rubricObject[item.category] = { score: item.score, feedback: item.feedback };
          });
        }

        // Clamp the suggested score into the valid range.
        const clampedScore = Math.max(0, Math.min(Number(geminiResult.score) || 0, maxPoints));
        const confidence = Number(geminiResult.confidence) || 0;
        const tooShort = typeof responseValue === "string" ? responseValue.trim().length <= 5 : false;
        const finalStatus = confidence < 0.75 || tooShort ? "needs_review" : "success";

        const freshDb = readDb();
        const freshRespIdx = freshDb.responses.findIndex((r: any) => r.id === newResponse.id);
        const freshGradIdx = freshDb.aiGradingRecords.findIndex((g: any) => g.responseId === newResponse.id);

        if (freshRespIdx !== -1) {
          // The AI suggested score becomes the working score, but the raw response is never overwritten.
          freshDb.responses[freshRespIdx].score = clampedScore;
          if (freshGradIdx !== -1) {
            freshDb.aiGradingRecords[freshGradIdx] = {
              ...freshDb.aiGradingRecords[freshGradIdx],
              rawOutput: rawJsonText,
              parsedScore: clampedScore,
              rationale: geminiResult.rationale,
              confidence,
              status: finalStatus,
              rubricBreakdown: rubricObject,
              gradedAt: new Date().toISOString()
            };
          }
          await commitDb(freshDb);
          console.log(`VERITAS Learn - AI grade stored (status=${finalStatus}, score=${clampedScore}/${maxPoints}).`);
        }
      } catch (error: any) {
        console.error("VERITAS Learn - AI Grading failed:", error);
        const freshDb = readDb();
        const freshGradIdx = freshDb.aiGradingRecords.findIndex((g: any) => g.responseId === newResponse.id);
        if (freshGradIdx !== -1) {
          freshDb.aiGradingRecords[freshGradIdx] = {
            ...freshDb.aiGradingRecords[freshGradIdx],
            parsedScore: 0,
            rationale: "AI grading could not complete. Sent to the review queue for manual grading.",
            confidence: 0,
            status: "needs_review",
            errorMessage: error instanceof Error ? error.message : String(error),
            rubricBreakdown: {},
            gradedAt: new Date().toISOString()
          };
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
  const db = readDb();

  const attemptIdx = db.attempts.findIndex((a: any) => a.id === id);
  if (attemptIdx === -1) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }

  const completeUser = (req as any).user;
  const completingAttempt = db.attempts[attemptIdx];
  if (completeUser?.role === "student" && completingAttempt.studentId !== completeUser?.id) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  db.attempts[attemptIdx].completedAt = new Date().toISOString();
  db.attempts[attemptIdx].status = "completed";
  try {
    await commitDb(db);
  } catch (err) {
    sendAppError(res, err);
    return;
  }

  res.json({ success: true, attempt: db.attempts[attemptIdx] });
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

  // Auto-lock attempt when student exits fullscreen on a lesson that requires it
  let lockState: string | null = null;
  if (eventType === "fullscreen_exited" && severity === "high" && attemptId) {
    const attemptIdx = db.attempts.findIndex((a: any) => a.id === attemptId);
    if (attemptIdx !== -1) {
      const attempt = db.attempts[attemptIdx];
      const lesson = db.lessons.find((l: any) => l.id === attempt.lessonId);
      if (lesson?.settings?.requireFullscreen && attempt.lockState !== "locked_awaiting_teacher") {
        db.attempts[attemptIdx].lockState = "locked_awaiting_teacher";
        db.attempts[attemptIdx].lockedAt = new Date().toISOString();
        lockState = "locked_awaiting_teacher";
      }
    }
  }

  writeDb(db);
  res.json({ success: true, lockState });
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
  
  // Roster lists
  const students = db.users.filter((u: any) => u.role === "student");
  const lessons = db.lessons;
  const attempts = db.attempts;
  const rawResponses = db.responses;
  const responses = mergeResponsesWithAiGrading(rawResponses, db);
  const signals = db.securitySignals;

  res.json({
    students,
    lessons,
    attempts,
    responses,
    signals
  });
});

// Teacher: Gradebook Score Overrides (teacher override is the final authority).
app.post("/api/responses/:id/override", requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { score, notes } = req.body;
    const db = readDb();

    const responseIdx = db.responses.findIndex((r: any) => r.id === id);
    if (responseIdx === -1) {
      fail(res, "NOT_FOUND", "Student response record not found.");
      return;
    }

    db.responses[responseIdx].score = Number(score);
    db.responses[responseIdx].teacherOverride = {
      score: Number(score),
      notes: notes || "Manual grade modification applied.",
      gradedAt: new Date().toISOString()
    };

    await commitDb(db);
    const mergedResp = mergeResponsesWithAiGrading([db.responses[responseIdx]], db)[0];
    res.json({ success: true, response: mergedResp });
  } catch (err) {
    sendAppError(res, err);
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
          model: process.env.AI_GRADING_MODEL || "gemini-2.0-flash",
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

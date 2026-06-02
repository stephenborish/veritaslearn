import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import multer from "multer";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import * as gradingUtils from "./src/lib/gradingUtils";
import { computeRiskSummary, detectClassWideAnomalies } from "./src/lib/riskScoringService";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Load Firebase config from file to ensure we use the correct bucket
let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (err) {
  console.error("[Config] Failed to load firebase-applet-config.json:", err);
}

// Initialize Firebase Admin for storage proxy
if (!admin.apps.length) {
  try {
    const configProjectId = firebaseConfig.projectId;
    const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
    
    // Use the project ID from the config file, as that's where the database and storage reside.
    // The environment project ID (where the app runs) might be different.
    const projectId = configProjectId || envProjectId;

    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId,
      storageBucket: process.env.STORAGE_BUCKET || firebaseConfig.storageBucket
    });
    
    console.log(`[Firebase Admin] Initialized.`);
    console.log(`  - Project ID: ${projectId} (Env: ${envProjectId}, Config: ${configProjectId})`);
    console.log(`  - Database ID: ${firebaseConfig.firestoreDatabaseId || "(default)"}`);
    console.log(`  - Storage Bucket: ${process.env.STORAGE_BUCKET || firebaseConfig.storageBucket}`);
  } catch (err) {
    console.error("[Firebase Admin] Failed to initialize:", err);
  }
}

// Resilient bucket selection — prefer config file, then env var, then .firebasestorage.app default.
// Using firebaseConfig.storageBucket avoids the initial wasted request to the wrong
// .appspot.com bucket that the old fallback-first logic caused.
const getBucketName = () => {
  return process.env.STORAGE_BUCKET || firebaseConfig.storageBucket || "gen-lang-client-0781925544.firebasestorage.app";
};

// Re-assignable active bucket for runtime recovery
let activeBucket: any = null;

if (admin.apps.length > 0) {
  try {
    activeBucket = admin.storage().bucket(getBucketName());
    console.log(`[Storage Proxy] Initial active bucket: ${activeBucket.name}`);
  } catch (err: any) {
    console.error("[Storage Proxy] Failed to initialize active bucket:", err.message);
  }
}

// Background probe for storage bucket configuration (non-blocking)
async function probeBucket() {
  if (admin.apps.length === 0) {
    console.warn("[Storage Proxy] Skip bucket probe: Admin SDK not initialized.");
    return;
  }

  const projectId = firebaseConfig.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || "gen-lang-client-0781925544";
  const candidates = [
    process.env.STORAGE_BUCKET,
    firebaseConfig.storageBucket,
    `${projectId}.firebasestorage.app`,
    `${projectId}.appspot.com`,
    `ais-artifacts-${projectId}`,
    `ais-artifacts-${projectId}.appspot.com`,
    `${projectId}-bucket`,
    projectId
  ].filter((v, i, a) => v && a.indexOf(v) === i) as string[];

  console.log("[Storage Proxy] Probing bucket candidates:", candidates);

  for (const name of candidates) {
    try {
      const b = admin.storage().bucket(name);
      // Check existence first. We catch errors silently here because many candidate
      // names are just guesses that will naturally fail with 403/404.
      const [exists] = await b.exists().catch(() => [false]);
      
      if (exists) {
         // Attempt a tiny "canary" write to verify permissions
         const canaryPath = `_system/canary-${Date.now()}.txt`;
         const canary = b.file(canaryPath);
         try {
           await canary.save("ok", { resumable: false });
           await canary.delete().catch(() => {}); // Best effort cleanup
           activeBucket = b;
           console.log(`[Storage Proxy] SUCCESS: Verified operational bucket with write access: ${name}`);
           return;
         } catch (writeErr: any) {
           if (writeErr.code === 403) {
             console.error(`[Storage Proxy] PERMISSION DENIED: Found bucket ${name} but service account lacks 'storage.objects.create' access.`);
           } else {
             console.warn(`[Storage Proxy] Bucket ${name} exists but write test failed: ${writeErr.message}`);
           }
         }
      } else {
        console.log(`[Storage Proxy] Candidate bucket ${name} does not exist.`);
      }
    } catch (err: any) {
      // 403 on exists() for a candidate name is expected and doesn't need a warning
      if (err.code !== 403 && err.code !== 404) {
        console.log(`[Storage Proxy] Candidate bucket ${name} probe note: ${err.message}`);
      }
    }
  }
  console.log("[Storage Proxy] Probe complete. If no SUCCESS was logged, check Firebase Console to ensure Storage is enabled and the sandbox service account has access.");
}
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only images are allowed.`));
    }
  }
});

// Warn at startup about any missing mail env vars so misconfiguration is
// visible in Cloud Run logs rather than silently falling back.
const REQUIRED_MAIL_ENV_VARS = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
  "EMAIL_FROM", "EMAIL_FROM_NAME", "PRODUCTION_URL",
];
const missingMailEnv = REQUIRED_MAIL_ENV_VARS.filter((v) => !process.env[v]);
if (missingMailEnv.length > 0) {
  console.warn(
    `[Config] Missing mail environment variables: ${missingMailEnv.join(", ")}. ` +
    "Email sending may fall back to simulation mode."
  );
}
// Deliverability note: SPF, DKIM, and DMARC are confirmed passing for veritas.courses.
// Remaining inbox-placement risk is sender reputation and recipient-domain filtering,
// neither of which is controllable in code. What code can do is ensure the authenticated
// sender identity never drifts (see EMAIL_FROM guard below) and avoid spammy patterns.

// Appended invisibly to every invitation subject to prevent Gmail from grouping
// repeated sends into the same conversation thread. The zero-width characters are
// visually empty so the displayed subject remains clean, but Gmail's threading
// heuristic sees each message as unique. This replicates the legacy Apps Script
// behaviour that was lost during the port to Cloud Run.
function generateInvisibleNonce(): string {
  const zwChars = ["​", "‌", "‍", "⁠"];
  let nonce = "";
  for (let i = 0; i < 8; i++) {
    nonce += zwChars[Math.floor(Math.random() * 4)];
  }
  return nonce;
}

// Lazy initialization of transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || "465");
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      console.warn("[Email Service] SMTP credentials not fully configured. Email sending will be simulated.");
      return null;
    }

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

// HTML entity encoder for email template interpolation
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  // Security settings (Simplified for troubleshooting)
  app.use(cors());

  // Rate limiting (Disabled in dev for easier testing)
  if (process.env.NODE_ENV === 'production') {
    const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
    const enrollLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many enrollment requests. Please wait before retrying.' } });
    const finalizeLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many finalize requests. Please wait before retrying.' } });
    app.use('/api', generalLimiter);
    app.use('/api/sessions/:id/enroll', enrollLimiter);
    app.use('/api/sessions/:id/finalize', finalizeLimiter);
  }

  app.use(express.json());

  const verifyFirebaseToken = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      (req as any).firebaseUser = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired Firebase token' });
    }
  };

  // The AI Studio / Cloud Run deployment layer injects a service-worker registration
  // that requests "_service-worker.js" relative to the current page path. Since no
  // intentional service worker exists in this app, the file is absent from the static
  // build output, so the SPA catch-all below would serve index.html (text/html) for
  // that request — causing a MIME type SecurityError in the browser.
  //
  // Fix: intercept any */_service-worker.js request and return a syntactically-valid
  // no-op JavaScript response (not HTML) so the registration either succeeds silently
  // or fails with a clear "script installed" / network error rather than a MIME error.
  app.use((req, res, next) => {
    if (req.path.endsWith("/_service-worker.js")) {
      res.type("application/javascript").send("// no-op service worker");
      return;
    }
    next();
  });

  // Request logger for debugging
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      console.log(`[API Request] ${req.method} ${req.path}`);
    }
    next();
  });

  // API Routes
  app.post("/api/sessions/:id/enroll", verifyFirebaseToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { students, teacherName, setName, code } = req.body;

      if (!students || !Array.isArray(students)) {
        return res.status(400).json({ error: 'Missing or invalid students list' });
      }

      console.log(`[Enroll] Session ID: ${id}, Students: ${students.length}`);

      // Verify the caller is the teacher of this session
      const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
      const projectId = firebaseConfig.projectId;
      const authHeader = req.headers.authorization;
      
      console.log(`[Enroll] Accessing Firestore REST. Project: ${projectId}, Database: ${dbId}`);

      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/sessions/${id}`;
      const sessRes = await fetch(firestoreUrl, {
        headers: {
          'Authorization': authHeader as string
        }
      });

      if (!sessRes.ok) {
        if (sessRes.status === 404) {
          console.warn(`[Enroll] Session ${id} not found`);
          return res.status(404).json({ error: 'Session not found' });
        }
        console.error(`[Enroll] Firestore REST error: ${sessRes.status} ${sessRes.statusText}`);
        return res.status(sessRes.status).json({ error: 'Failed to access session data.' });
      }

      const sessDoc = await sessRes.json();
      const teacherId = sessDoc.fields?.teacherId?.stringValue;

      if (teacherId !== (req as any).firebaseUser.uid) {
        console.warn(`[Enroll] Forbidden: Caller ${(req as any).firebaseUser.uid} is not teacher ${teacherId}`);
        return res.status(403).json({ error: 'Forbidden: You are not the teacher of this session' });
      }

      console.log(`[Email Service] Sending enrollment emails for session ${id} (${setName})`);

      const mailer = getTransporter();
      const fromEmail = process.env.EMAIL_FROM || "noreply@veritas.courses";
      const fromName = process.env.EMAIL_FROM_NAME || "VERITAS";

      const promises = students.map(async (student: any) => {
        try {
          let baseUrl = req.get('origin') || `https://${req.get('host')}`;
          if (process.env.NODE_ENV === 'production' && process.env.PRODUCTION_URL) {
            baseUrl = process.env.PRODUCTION_URL;
          }

          const joinUrl = `${baseUrl}/student?code=${code}`;
          const studentFirstName = escapeHtml(student.firstName || (student.name ? student.name.split(' ')[0] : "Student"));
          const safeSetName = escapeHtml(setName || 'Assessment');
          const safeCode = escapeHtml(code || '');
          const safeTeacherName = escapeHtml(teacherName || 'Your Teacher');
          const dateStr = new Date().toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });

          const subject = `Your VERITAS Assessment Link – ${dateStr}${generateInvisibleNonce()}`;
          const text = `Hi ${studentFirstName},\n\nYour assessment "${safeSetName}" is ready.\n\nJoin link: ${joinUrl}\n\nSign in with your school Google account, then enter Code: ${code}\n\nTeacher: ${safeTeacherName}\n\nBest,\nVERITAS Team`;
          
          const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"> 
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> 
    <meta http-equiv="X-UA-Compatible" content="IE=edge"> 
    <title>VERITAS Assess</title>
    <style>
        body { margin: 0; padding: 0; width: 100% !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #333333; line-height: 1.6; }
        .container { max-width: 600px; margin: 40px auto; padding: 0; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .content-padding { padding: 30px; }
        h1, p, li, span, div, a { font-size: 16px; }
        h1 { margin: 0 0 16px 0; font-weight: 700; color: #12385d; letter-spacing: -0.5px; }
        p { margin: 0 0 16px 0; }
        .btn { display: inline-block; background-color: #12385d; color: #ffffff !important; text-decoration: none; padding: 14px 35px; border-radius: 4px; font-weight: 600; margin: 10px 0; }
        .btn:hover { background-color: #0f2f4d; }
        .divider { height: 1px; background-color: #e5e7eb; margin: 20px 0; border: none; }
        .footer { font-size: 12px; color: #9ca3af; margin-top: 30px; text-align: center; }
        .instructions-list { padding-left: 18px; color: #4b5563; margin-bottom: 0; }
        .instructions-list li { margin-bottom: 8px; }
        @media screen and (max-width: 600px) {
            .container { margin: 0; border-radius: 0; }
            .content-padding { padding: 20px; }
            .btn { display: block; text-align: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div style="background-color: #12385d; padding: 20px 30px;">
            <span style="font-weight: 700; font-size: 26px; color: #ffffff;">VERITAS</span> 
            <span style="color: #c5a05a; margin: 0 8px; font-size: 26px;">|</span>
            <span style="color: #e5e7eb; font-size: 22px;">Assessment</span>
        </div>
        <div class="content-padding">
            <p>Hello <strong>${studentFirstName}</strong>,</p>
            <p>Your assessment <strong>${safeSetName}</strong> is ready. Click the button below, then sign in with your school Google account.</p>
            <div style="text-align: center;">
                <a href="${joinUrl}" class="btn">OPEN VERITAS</a>
            </div>
            <div style="background:#f8fafc;border:1px solid #d1d5db;border-radius:6px;padding:16px;text-align:center;margin:16px 0;">
                <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:.7px;text-transform:uppercase;color:#6b7280;font-weight:700;">Session Code</p>
                <p style="margin:0;font-size:30px;letter-spacing:2px;font-weight:800;color:#111827;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">${safeCode}</p>
                <p style="margin:8px 0 0 0;font-size:13px;color:#6b7280;">The code is pre-filled in the link above. Sign in with Google to continue.</p>
            </div>
            <hr class="divider">
            <div style="background-color: #ffdcdc; padding: 20px; border-radius: 6px; border: 1px solid #fed7d7;">
                <p style="font-weight: 600; margin-bottom: 12px; margin-top: 0; color: #c53030;">Important Instructions:</p>
                <ul class="instructions-list" style="margin: 0;">
                    <li>Sign in with your school Google account (the email your teacher has on file).</li>
                    <li>You must remain in fullscreen mode throughout the entire session.</li>
                    <li>Don't navigate to other tabs or applications.</li>
                    <li>Do not refresh the browser to prevent disconnection.</li>
                </ul>
            </div>
            <div class="footer">
                <p style="margin-bottom: 0;">&copy; ${new Date().getFullYear()} VERITAS</p>
            </div>
        </div>
    </div>
</body>
</html>
      `;

          const messageRefId = randomUUID();

          if (mailer) {
            await mailer.sendMail({
              from: `"${fromName}" <${fromEmail}>`,
              to: student.email,
              subject,
              text,
              html,
              headers: {
                "X-Entity-Ref-ID": messageRefId,
              },
            });
            console.log(`[Email] Sent to ${student.email} | ref=${messageRefId}`);
          } else {
            console.log(`[Simulated Email] To: ${student.email} | Subject: ${subject} | ref=${messageRefId}`);
          }
        } catch (itemErr: any) {
          console.error(`[Email] Failed to process/send to ${student.email}:`, itemErr);
          // We don't rethrow here so that other students still get their emails,
          // but we might want to know if it failed.
        }
      });

      await Promise.all(promises);
      res.json({ success: true, message: `Successfully processed ${students.length} enrollment emails.` });
    } catch (error: any) {
      console.error("[Enroll] Critical error:", error);
      let message = error.message || "Failed to process enrollment";
      if (message.includes("PERMISSION_DENIED")) {
        message = "Permission Denied: Ensure Firebase is correctly set up. Try running the 'Set Up Firebase' tool in the AI Studio side panel to link your project.";
      }
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/storage/upload", verifyFirebaseToken, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let userPath = req.body.path;
      if (typeof userPath !== 'string') {
        userPath = "images";
      }

      // Sanitize the path to prevent directory traversal
      const safePath = userPath
        .replace(/\\/g, '/') // Convert backslashes to forward slashes
        .split('/') // Split into segments
        .filter(segment => segment && segment !== '.' && segment !== '..') // Remove empty, current dir, and parent dir segments
        .join('/') || "images";

      const fileName = `${randomUUID()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const destination = `${safePath}/${fileName}`;
      
      if (!activeBucket) {
        throw new Error("Storage service not initialized (no operational bucket found)");
      }
      
      console.log(`[Storage Proxy] ACTIVE BUCKET: ${activeBucket.name}`);
      console.log(`[Storage Proxy] DESTINATION: ${destination}`);
      console.log(`[Storage Proxy] CONTENT TYPE: ${req.file.mimetype}`);
      
      let file = activeBucket.file(destination);
      
      try {
        await file.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype },
          resumable: false
        });
      } catch (saveError: any) {
        console.error(`[Storage Proxy] Primary write failed (${activeBucket.name}):`, saveError.message);
        
        // Fallback logic
        const projectId = firebaseConfig.projectId || process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0781925544";
        const fallbackNames = [
          firebaseConfig.storageBucket,
          `${projectId}.firebasestorage.app`,
          `${projectId}.appspot.com`,
          `ais-artifacts-${projectId}`,
        ].filter(n => n && n !== activeBucket.name);
           
        let success = false;
        for (const fallback of fallbackNames) {
          console.log(`[Storage Proxy] Trying fallback: ${fallback}`);
          try {
            const b = admin.storage().bucket(fallback as string);
            const f = b.file(destination);
            await f.save(req.file.buffer, {
              metadata: { contentType: req.file.mimetype },
              resumable: false
            });
            activeBucket = b;
            file = f;
            success = true;
            console.log(`[Storage Proxy] FALLBACK SUCCESS: ${fallback}`);
            break;
          } catch (e: any) {
            console.error(`[Storage Proxy] FALLBACK FAILED (${fallback}):`, e.message);
          }
        }
        if (!success) throw saveError;
      }

      // Final URL generation
      let finalUrl = "";
      try {
        const urlExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
      const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: urlExpiry });
        finalUrl = signedUrl;
      } catch (signError: any) {
        console.warn(`[Storage Proxy] Signing failed, using direct public link: ${signError.message}`);
        finalUrl = `https://firebasestorage.googleapis.com/v0/b/${activeBucket.name}/o/${encodeURIComponent(destination)}?alt=media`;
      }

      console.log(`[Storage Proxy] UPLOAD SUCCESS: ${finalUrl}`);
      res.json({ url: finalUrl });
    } catch (error: any) {
      console.error("[Storage Proxy] CRITICAL FAILURE:", error);
      res.status(error.code || 500).json({ 
        error: error.message || "Failed to upload file to storage",
        code: error.code || 500
      });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Super-admin only: promote a user to the admins collection via Admin SDK
  app.post("/api/admin/promote", verifyFirebaseToken, async (req, res) => {
    const caller = (req as any).firebaseUser;
    if (caller.email !== 'stephenborish@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Super-admin only.' });
    }
    const { uid, email, name } = req.body;
    if (!uid || typeof uid !== 'string' || uid.length > 128) {
      return res.status(400).json({ error: 'Invalid uid.' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email.' });
    }
    try {
      const firestore = getFirestore(firebaseConfig.firestoreDatabaseId);
      await firestore.collection('admins').doc(uid).set({
        email,
        name: name || '',
        promotedAt: FieldValue.serverTimestamp(),
        promotedBy: caller.uid,
      });
      await firestore.collection('action_logs').add({
        type: 'admin_promoted',
        targetUid: uid,
        targetEmail: email,
        actorUid: caller.uid,
        timestamp: FieldValue.serverTimestamp(),
      });
      console.log(`[Admin] ${caller.email} promoted ${email} (${uid}) to admin.`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[Admin Promote] Failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Super-admin only: check status of environment variables
  app.get("/api/admin/config-check", verifyFirebaseToken, async (req, res) => {
    const caller = (req as any).firebaseUser;
    if (caller.email !== 'stephenborish@gmail.com') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const checkVars = [
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 
      'EMAIL_FROM', 'EMAIL_FROM_NAME', 'SMTP_FROM_NAME', 'PRODUCTION_URL',
      'GEMINI_API_KEY', 'STORAGE_BUCKET', 'JWT_SECRET'
    ];

    const status: Record<string, any> = {};
    checkVars.forEach(v => {
      status[v] = !!process.env[v];
    });

    // Add diagnostics for super-admin
    status._diagnostics = {
      firebaseConfigProjectId: firebaseConfig.projectId,
      envProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT,
      effectiveProjectId: admin.app().options.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      nodeEnv: process.env.NODE_ENV,
      appsInitialized: admin.apps.length
    };

    res.json(status);
  });

  // Super-admin only: send a welcome email to a newly approved teacher
  app.post("/api/admin/send-welcome-email", verifyFirebaseToken, async (req, res) => {
    const caller = (req as any).firebaseUser;
    if (caller.email !== 'stephenborish@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Super-admin only.' });
    }

    const { email, name } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid or missing email.' });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid or missing name.' });
    }

    try {
      console.log(`[Admin Email] Sending welcome email to teacher: ${email} (${name})`);
      const mailer = getTransporter();
      const fromEmail = process.env.EMAIL_FROM || "noreply@veritas.courses";
      const fromName = process.env.EMAIL_FROM_NAME || "VERITAS Assess";

      let dashboardUrl = "https://veritas.courses";
      if (process.env.NODE_ENV !== 'production') {
        dashboardUrl = req.get('origin') || `https://${req.get('host')}`;
      }

      const escapedName = escapeHtml(name.trim());
      const escapedEmail = escapeHtml(email.toLowerCase().trim());

      const subject = `Welcome to VERITAS Assess – Account Approved${generateInvisibleNonce()}`;
      const text = `Dear ${name.trim()},\n\nWe are pleased to inform you that your teacher credentials on veritas.courses have been approved by the system administrator.\n\nGetting Started:\n1. Log In via Google Sign-In at ${dashboardUrl} with this email: ${email.toLowerCase().trim()}\n2. Create your Academic Courses and upload student rosters.\n3. Build assessments using rich text and MathLive formula tools.\n4. Launch Sessions & distribute individualized student link tokens.\n\nBest regards,\nThe VERITAS Team`;

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"> 
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> 
    <meta http-equiv="X-UA-Compatible" content="IE=edge"> 
    <title>Welcome to VERITAS Assess</title>
    <style>
        body { margin: 0; padding: 0; width: 100% !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #334155; line-height: 1.625; }
        .container { max-width: 600px; margin: 40px auto; padding: 0; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(18, 56, 93, 0.06); border: 1px solid #e2e8f0; }
        .header { background-color: #12385d; padding: 24px 32px; border-bottom: 2px solid #c5a05a; }
        .logo-text { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-weight: 700; font-size: 24px; color: #ffffff; letter-spacing: -0.5px; }
        .logo-pipe { color: #c5a05a; margin: 0 8px; font-size: 24px; }
        .logo-sub { color: #cbd5e1; font-size: 18px; font-weight: 400; }
        .content { padding: 36px 36px 28px 36px; }
        h1, h2, p, li, span, div, a { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        h1 { font-family: 'Outfit', -apple-system, sans-serif; font-size: 20px; font-weight: 600; color: #12385d; margin: 0 0 16px 0; letter-spacing: -0.2px; }
        p { margin: 0 0 18px 0; font-size: 15px; color: #334155; }
        .features-box { background-color: #f8fafc; border-left: 3px solid #12385d; padding: 16px 20px; margin: 20px 0; border-radius: 0 6px 6px 0; }
        .features-title { font-weight: 700; font-size: 13px; text-transform: uppercase; color: #12385d; letter-spacing: 0.8px; margin: 0 0 10px 0; }
        .feature-item { font-size: 14px; margin-bottom: 8px; color: #475569; }
        .feature-item strong { color: #1e293b; }
        .btn-wrapper { text-align: center; margin: 24px 0 28px 0; }
        .btn { display: inline-block; background-color: #12385d; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; transition: background-color 0.2s; }
        .btn:hover { background-color: #0f2f4d; }
        .getting-started { margin: 24px 0; padding: 0 0 0 18px; }
        .getting-started li { font-size: 14.5px; color: #475569; margin-bottom: 10px; }
        .getting-started li strong { color: #1e293b; }
        .divider { height: 1px; background-color: #cbd5e1; margin: 28px 0; border: none; }
        .footer { font-size: 12px; color: #94a3b8; text-align: center; padding: 0 36px 32px 36px; }
        .footer p { margin: 0; font-size: 12px; color: #94a3b8; }
        @media screen and (max-width: 600px) {
            .container { margin: 0; border-radius: 0; border: none; }
            .content { padding: 24px; }
            .btn { display: block; text-align: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="logo-text">VERITAS</span> 
            <span class="logo-pipe">|</span>
            <span class="logo-sub">Assess</span>
        </div>
        <div class="content">
            <h1>Teacher Account Approved</h1>
            <p>Dear <strong>${escapedName}</strong>,</p>
            <p>We are pleased to inform you that your teacher credentials on <strong>veritas.courses</strong> have been approved by the system administrator. You now have full access to design, deliver, and evaluate student assessments.</p>
            
            <div class="features-box">
                <div class="features-title">Core Capability Highlights</div>
                <div class="feature-item"><strong>Secure Assessment Delivery:</strong> Proctor in live lockstep or self-paced modes, with fullscreen monitoring and anomaly tracking.</div>
                <div class="feature-item"><strong>AI-Assisted Grading:</strong> Leverage Gemini 3 Flash to evaluate student text responses against deterministic rubrics in batches.</div>
                <div class="feature-item"><strong>Metacognitive Analytics:</strong> Track pupil self-assessment patterns and individual reflection inputs per question.</div>
            </div>

            <div class="btn-wrapper">
                <a href="${dashboardUrl}" class="btn">Launch Teacher Dashboard</a>
            </div>

            <p style="font-weight: 600; color: #12385d; margin-bottom: 8px;">Getting Started Steps:</p>
            <ol class="getting-started">
                <li><strong>Log In:</strong> Navigate to the dashboard using your approved school email (<code>${escapedEmail}</code>) via Google Sign-In.</li>
                <li><strong>Create Courses:</strong> Establish your academic classes and upload student block rosters.</li>
                <li><strong>Build Assessments:</strong> Input questions using powerful rich text, Tiptap blocks, or MathLive LaTeX notation.</li>
                <li><strong>Launch Sessions:</strong> Distribute individualized, secure link tokens to your class to prompt immediate execution.</li>
            </ol>

            <div class="divider"></div>

            <p style="margin-bottom: 4px; font-size: 14px;">Sincerely,</p>
            <p style="font-weight: 600; color: #12385d; font-size: 15px;">The VERITAS Team</p>
        </div>
        <div class="footer">
            <p>This is a secure transactional communication. If you did not request this authorization, please notify support@veritas.courses immediately.</p>
            <p style="margin-top: 12px;">&copy; ${new Date().getFullYear()} VERITAS Assess. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
      `;

      const messageRefId = randomUUID();

      if (mailer) {
        await mailer.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to: email,
          subject,
          text,
          html,
          headers: {
            "X-Entity-Ref-ID": messageRefId,
          },
        });
        console.log(`[Admin Email] Sent welcome email to ${email} | ref=${messageRefId}`);
      } else {
        console.log(`[Admin Email] (Simulated) To: ${email} | Subject: ${subject} | ref=${messageRefId}`);
      }

      res.json({ success: true, message: "Welcome email processed successfully." });
    } catch (e: any) {
      console.error("[Admin Email] Failed to send welcome email:", e);
      res.status(500).json({ error: `Failed to send welcome email: ${e.message}` });
    }
  });

  // AI Grading Endpoint (Live)
  app.post("/api/sessions/:id/grade", verifyFirebaseToken, async (req: any, res: any) => {
    const { id } = req.params;
    const { questionId, responseIds, questions = [], responses = [] } = req.body;

    if (!ai) return res.status(503).json({ error: "AI service unavailable" });

    try {
      if (responses.length === 0) {
        return res.json({ success: true, message: "No responses to grade", grades: [] });
      }

      let resToGrade = [...responses];
      if (responseIds && responseIds.length > 0) {
        resToGrade = resToGrade.filter(r => responseIds.includes(r.id));
      }

      if (questionId) {
        resToGrade = resToGrade.filter(r => r.questionId === questionId);
      }

      // Filter for SA or un-graded MC if needed
      const saResponses = resToGrade.filter(r => {
        const q = questions.find((q: any) => q.id === r.questionId);
        return q?.type === "sa" && !r.manuallyGraded;
      });

      if (saResponses.length === 0) {
        return res.json({ success: true, message: "No short-answer responses to grade", grades: [] });
      }

      const batchSize = 50;
      let allGrades: any[] = [];

      for (let i = 0; i < saResponses.length; i += batchSize) {
        const chunk = saResponses.slice(i, i + batchSize);
        const prompt = `Grade the following student responses based on the provided rubrics.

<questions>
${questions.map((q: any) => `<question id="${q.id}"><text>${q.text}</text><rubric>${q.rubric || 'Accuracy and clarity.'}</rubric><points>${q.points || 1}</points></question>`).join('\n')}
</questions>

<responses>
${chunk.map((r: any) => `<response id="${r.id}" qid="${r.questionId}"><answer>${String(r.answer || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</answer></response>`).join('\n')}
</responses>

Return ONLY a JSON array of objects:
[
  { "id": "response_id", "points": float, "isCorrect": boolean, "feedback": "concise feedback (no AI mentions)", "aiConcepts": ["concept1", "concept2"] }
]`;

        try {
          const result = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
              systemInstruction: "You are a professional teacher grading science assessments. Be direct, factual, and strict. Do NOT mention being an AI. Return results in the specified JSON format.",
              responseMimeType: "application/json"
            }
          });

          let cleanText = result.text || "";
          if (cleanText.startsWith("\`\`\`")) {
             cleanText = cleanText.replace(/^\`\`\`(?:json)?\n?/, "").replace(/\n?\`\`\`$/, "");
          }
          const grades = JSON.parse(cleanText);
          if (Array.isArray(grades)) {
            allGrades.push(...grades);
          }
        } catch (err) {
          console.error("[Live Grading] Batch error:", err);
        }
      }

      res.json({ success: true, grades: allGrades });
    } catch (error: any) {
      console.error("[Live Grading] Final error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Student Questions Endpoint — server-side sanitized question delivery.
  // Enforces session status gate, lockstep single-question filter, and strips answer keys.
  // Replaces the client-side dbService.studentGetQuestions() Firestore read so that
  // students never receive snapshotQuestions directly from the Firestore sessions document.
  app.post("/api/sessions/:id/student-questions", verifyFirebaseToken, async (req: any, res: any) => {
    const { id } = req.params;
    const studentUid: string = req.firebaseUser.uid;
    const { studentSessionId } = req.body;

    if (!studentSessionId || typeof studentSessionId !== 'string') {
      return res.status(400).json({ error: 'Missing studentSessionId' });
    }

    try {
      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      // Load session (admin SDK bypasses Firestore rules — this is intentional)
      const sessionSnap = await adminDb.collection("sessions").doc(id).get();
      if (!sessionSnap.exists) return res.status(404).json({ error: "Session not found" });
      const sess = sessionSnap.data() as any;

      // Enforce open/close time windows
      const nowTime = Date.now();
      if (sess.config?.openAt) {
        const openTime = new Date(sess.config.openAt).getTime();
        if (nowTime < openTime) {
          return res.json({ error: `This assessment is not open yet. It opens at ${new Date(sess.config.openAt).toLocaleString()}.` });
        }
      }
      if (sess.config?.closeAt) {
        const closeTime = new Date(sess.config.closeAt).getTime();
        if (nowTime > closeTime) {
          return res.json({ error: "This assessment has closed. You can no longer access it." });
        }
      }

      // Session status gate
      if (sess.status === 'waiting') {
        return res.json({ waitingForTeacher: true, status: 'waiting', setName: sess.setName || '' });
      }
      if (sess.status === 'ended' || sess.status === 'archived') {
        return res.json({ error: "This session has ended." });
      }

      // Load student session and verify ownership
      const stuSessSnap = await adminDb.collection("student_sessions").doc(studentSessionId).get();
      if (!stuSessSnap.exists) return res.status(404).json({ error: "Student session not found" });
      const stuSess = stuSessSnap.data() as any;

      if (stuSess.studentId !== studentUid) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      if (stuSess.lockedOut) return res.json({ lockedOut: true });

      const questionsAll: any[] = sess.snapshotQuestions || [];
      if (!questionsAll.length) return res.json({ error: "No questions in this session snapshot" });

      const mode: string = sess.config?.mode || sess.mode || 'self-paced';
      const revealedQs: string[] = sess.revealedQs || [];

      // Apply individual question order (self-paced / randomized only)
      let questions = [...questionsAll];
      if (stuSess.qOrder && stuSess.qOrder.length && mode !== 'lockstep') {
        questions = (stuSess.qOrder as number[]).map((idx: number) => questionsAll[idx]).filter(Boolean);
      }

      // Apply choice shuffling (remap correctIndices in shuffled order)
      if (stuSess.choiceOrders) {
        questions = questions.map((q: any) => {
          const order: number[] | undefined = stuSess.choiceOrders?.[q.id];
          if (order && Array.isArray(order) && Array.isArray(q.choices)) {
            const shuffledChoices = order.map((idx: number) => q.choices[idx]);
            const remappedCorrect = (q.correctIndices || [])
              .map((origIdx: number) => order.indexOf(origIdx))
              .filter((newIdx: number) => newIdx !== -1);
            return { ...q, choices: shuffledChoices, correctIndices: remappedCorrect };
          }
          return q;
        });
      }

      // Lockstep: return only the currently live question
      if (mode === 'lockstep') {
        const currentQ: number = sess.currentQ ?? -1;
        if (currentQ === -1) {
          return res.json({
            waitingForTeacher: true,
            status: 'live',
            setName: sess.setName || '',
            session: {
              mode,
              setName: sess.setName || '',
              currentQ,
              config: sess.config || {},
              revealedQs,
              lockstepQStates: sess.lockstepQStates || {},
            },
          });
        }
        // Return only the single active question
        const activeQ = questionsAll[currentQ];
        if (!activeQ) return res.json({ waitingForTeacher: true, status: 'live' });
        questions = [activeQ];
      }

      // Sanitize questions: strip answer keys, compute selectionMode
      const sanitized = questions.map((q: any) => {
        const selectionMode = (q.correctIndices?.length ?? 0) > 1 ? 'multiple' : 'single';
        const isRevealed = revealedQs.includes(q.id);
        const {
          rubric: _r, sampleAnswer: _sa, gradingCriteria: _gc,
          explanation: _ex, gradingExamples: _ge,
          correctIndices: _ci,
          ...safe
        } = q;
        const out: any = { ...safe, selectionMode };
        // Only include correctIndices if teacher has explicitly revealed this question
        if (isRevealed && Array.isArray(_ci)) out.correctIndices = _ci;
        return out;
      });

      // Load existing responses for this student
      const responsesSnap = await adminDb.collection("responses")
        .where("sessionId", "==", id)
        .where("studentId", "==", studentUid)
        .get();
      const answers: Record<string, any> = {};
      const reflections: Record<string, any> = {};
      responsesSnap.docs.forEach(d => {
        const r = d.data() as any;
        answers[r.questionId] = r.answer;
        if (r.reflection) reflections[r.questionId] = r.reflection;
      });

      return res.json({
        questions: sanitized,
        stimuli: sess.snapshotStimuli || [],
        answers,
        reflections,
        currentQIndex: stuSess.currentQIndex || 0,
        flaggedQs: stuSess.flaggedQs || [],
        flagLabels: stuSess.flagLabels || {},
        eliminatedChoices: stuSess.eliminatedChoices || {},
        status: stuSess.status,
        joinedAt: stuSess.joinedAt,
        enteredAt: stuSess.enteredAt || null,
        reentryApproved: !!stuSess.reentryApproved,
        session: {
          mode,
          setName: sess.setName || '',
          currentQ: sess.currentQ ?? -1,
          config: sess.config || {},
          revealedQs,
          lockstepQStates: sess.lockstepQStates || {},
        },
      });
    } catch (error: any) {
      console.error("[Student Questions] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Student Results Endpoint — server-side filtered payload based on resultRelease settings
  app.get("/api/sessions/:id/student-results", verifyFirebaseToken, async (req: any, res: any) => {
    const { id } = req.params;
    const studentUid: string = req.firebaseUser.uid;

    try {
      const db = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      // Fetch session
      const sessionSnap = await db.collection("sessions").doc(id).get();
      if (!sessionSnap.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionSnap.data() as any;

      // Check release status
      const resultRelease = sessionData.resultRelease;
      const legacyReleased = !!sessionData?.config?.summaryReleasedAt;

      if (!resultRelease && !legacyReleased) {
        return res.json({ released: false });
      }
      if (resultRelease?.status === 'revoked') {
        return res.json({ released: false, revoked: true });
      }
      if (resultRelease?.status !== 'released' && !legacyReleased) {
        return res.json({ released: false });
      }

      // For legacy sessions without resultRelease, use permissive defaults
      const settings = resultRelease ?? {
        showOverallScore: true,
        showQuestionScores: true,
        showStudentAnswers: true,
        showCorrectAnswers: false,
        showTeacherFeedback: true,
        showAiFeedback: true,
        showRubrics: false,
        showMetacognition: false,
      };

      // Fetch student session to verify enrollment
      const stuSessSnap = await db.collection("student_sessions")
        .where("sessionId", "==", id)
        .where("studentId", "==", studentUid)
        .limit(1)
        .get();
      if (stuSessSnap.empty) return res.status(403).json({ error: "Not enrolled in this session" });

      // Fetch this student's responses
      const responsesSnap = await db.collection("responses")
        .where("sessionId", "==", id)
        .where("studentId", "==", studentUid)
        .get();
      const rawResponses = responsesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // Filter response fields based on settings
      const filteredResponses = rawResponses.map((r: any) => {
        const out: any = {
          id: r.id,
          questionId: r.questionId,
          qIndex: r.qIndex,
          submittedAt: r.submittedAt,
        };
        if (settings.showStudentAnswers) out.answer = r.answer;
        if (settings.showQuestionScores) { out.points = r.points; out.maxPoints = r.maxPoints; out.isCorrect = r.isCorrect; }
        if (settings.showTeacherFeedback && r.feedback) out.feedback = r.feedback;
        if (settings.showAiFeedback) { if (r.aiSuggestedFeedback) out.aiSuggestedFeedback = r.aiSuggestedFeedback; if (r.aiConcepts) out.aiConcepts = r.aiConcepts; }
        if (settings.showMetacognition && r.reflection) out.reflection = r.reflection;
        return out;
      });

      // Filter snapshot questions
      const rawQuestions: any[] = sessionData.snapshotQuestions || [];
      const filteredQuestions = rawQuestions.map((q: any) => {
        const out: any = {
          id: q.id,
          type: q.type,
          text: q.text,
          points: q.points,
          stimulusId: q.stimulusId,
        };
        if (Array.isArray(q.choices)) out.choices = q.choices;
        if (settings.showCorrectAnswers) {
          if (q.correctIndices !== undefined) out.correctIndices = q.correctIndices;
          if (q.sampleAnswer) out.sampleAnswer = q.sampleAnswer;
        }
        if (settings.showRubrics) {
          if (q.rubric) out.rubric = q.rubric;
          if (q.explanation) out.explanation = q.explanation;
          if (q.gradingCriteria) out.gradingCriteria = q.gradingCriteria;
        }
        return out;
      });

      // Overall score (only when allowed)
      let overallScore: { earned: number; total: number; percent: number } | undefined;
      if (settings.showOverallScore && settings.showQuestionScores) {
        const earned = rawResponses.reduce((s: number, r: any) => s + (r.points ?? 0), 0);
        const total = rawResponses.reduce((s: number, r: any) => s + (r.maxPoints ?? 0), 0);
        overallScore = { earned, total, percent: total > 0 ? Math.round((earned / total) * 100) : 0 };
      }

      return res.json({
        released: true,
        overallScore,
        responses: filteredResponses,
        questions: filteredQuestions,
        stimuli: sessionData.snapshotStimuli || [],
        settings: {
          showOverallScore: settings.showOverallScore,
          showQuestionScores: settings.showQuestionScores,
          showStudentAnswers: settings.showStudentAnswers,
          showCorrectAnswers: settings.showCorrectAnswers,
          showTeacherFeedback: settings.showTeacherFeedback,
          showAiFeedback: settings.showAiFeedback,
          showRubrics: settings.showRubrics,
          showMetacognition: settings.showMetacognition,
        },
      });
    } catch (error: any) {
      console.error("[Student Results] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sessions/:id/finalize", verifyFirebaseToken, async (req, res) => {
    const { id } = req.params;
    console.log(`[Finalize] Auto-grading and AI analysis for session ${id}...`);
    
    try {
      const { questions = [], responses = [], violations = [] } = req.body;
      
      let gradedResponses = [...responses];
      let newlyGraded: any[] = [];

      // 1. Deterministic Auto-Grading (Deterministic keys like MC or Short Answer)
      gradedResponses = responses.map((r: any) => {
        const q = questions.find((quest: any) => quest.id === r.questionId);
        if (q && (r.isCorrect === null || r.isCorrect === undefined)) {
          try {
            const scoreRes = gradingUtils.calculateScore(q, r.answer);
            
            if (scoreRes.isCorrect !== null) {
              r.isCorrect = scoreRes.isCorrect;
              r.points = scoreRes.points;
              newlyGraded.push(r);
            }
          } catch (err) {
            console.warn(`[Finalize] Grading error for q ${r.questionId}:`, err);
          }
        }
        return r;
      });

      console.log(`[Finalize] Determined auto-grades for ${newlyGraded.length} responses.`);

      let analysis = {};

      if (ai && questions.length > 0) {
        try {
          const prompt = `Analyze the following assessment session data and return a JSON summary.

<questions>
${questions.map((q: any, i: number) => `<question index="${i + 1}" type="${q.type}"><text>${q.text}</text></question>`).join('\n')}
</questions>

<responses>
${gradedResponses.map((r: any) => `<response q="${(r.qIndex || 0) + 1}" correct="${r.isCorrect}" score="${r.points}"><answer>${String(r.answer || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</answer></response>`).join('\n')}
</responses>

<violations>
${violations.map((v: any) => `<violation type="${v.type}" />`).join('\n')}
</violations>

Return ONLY valid JSON in this exact format:
{
  "executiveSummary": "1-2 paragraph overview of class performance",
  "keyConceptsMastered": ["Concept 1", "Concept 2"],
  "commonMisconceptions": ["Misconception A", "Misconception B"],
  "atRiskStudents": ["Student name - Reason"],
  "remediationPlan": ["Step 1", "Step 2"],
  "securitySummary": "Summary of logged security violations"
}`;

          const result = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
              systemInstruction: "You are a data architect and pedagogy expert. Analyze assessment data and provide a structured JSON summary. Focus on misconceptions and student needs.",
              responseMimeType: "application/json"
            }
          });
          
          const text = result.text || "";
          
          try {
            let cleanText = text.trim();
            if (cleanText.startsWith("\`\`\`")) {
              cleanText = cleanText.replace(/^\`\`\`(?:json)?\n?/, "").replace(/\n?\`\`\`$/, "");
            }
            analysis = JSON.parse(cleanText);
            console.log(`[Finalize] Analysis complete for session ${id}`);
          } catch (pe) {
            console.error("[Finalize] AI JSON parse error", pe);
          }
        } catch (aiErr) {
          console.error("[Finalize] AI Analysis failed:", aiErr);
        }
      }

      res.json({ success: true, analysis, gradedResponses: newlyGraded });
    } catch (error: any) {
      console.error(`[Finalize] Failed for session ${id}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gemini/suggest-questions", verifyFirebaseToken, async (req, res) => {
    const { topic, count, gradeLevel = "High School (9-12)", counts } = req.body;
    if (!topic || typeof topic !== "string") {
      return res.status(400).json({ error: "Topic is required and must be a string." });
    }

    if (!ai) {
      return res.status(503).json({ error: "AI service is currently unavailable. Please verify GEMINI_API_KEY is configured." });
    }

    // Default counts if none provided
    const countsByType = counts || {
      mc: count || 5
    };

    const totalCount = Object.values(countsByType).reduce((sum: number, val: any) => sum + (Number(val) || 0), 0);
    if (totalCount === 0) {
      return res.status(400).json({ error: "Please specify a quantity greater than zero for at least one item type." });
    }

    try {
      const requirements = Object.entries(countsByType)
        .filter(([_, qty]) => (Number(qty) || 0) > 0)
        .map(([type, qty]) => `- Question Type: "${type}" | Quantity: ${qty} item(s)`)
        .join("\n");

      const prompt = `You are a world-class educational science content designer and assessment specialist.
      Generate a JSON array of exactly ${totalCount} highly engaging, scientifically rigorous assessment questions tailored precisely for **${gradeLevel}** students on the topic: "${topic}".
      
      CRITICAL QUANTITY AND TYPE INSTRUCTIONS:
      You MUST generate exactly the quantities of each item type specified below. Do not generate more, fewer, or any other unsought types. This is a strict constraint.
      ${requirements}

      FORMULA FORMATTING DIRECTIVE:
      Whenever any mathematical equation, expression, chemical compound, chemical reaction, variable symbol, fraction, subscript/superscript, isotope (e.g., C-14 as {}^{14}C), units (e.g., m/s^2), or any scientific formula is generated anywhere in the question 'text', 'choices', 'rubric', 'sampleAnswer', or 'gradingCriteria' descriptions, you MUST wrap it inside a \`<span data-type="math" data-latex="LaTeX_code_here"></span>\` element.
      Do NOT use raw inline LaTeX delimiters like '$...$' or '$$...$$'.
      - Example of mathematical equation: "...where the equation is <span data-type="math" data-latex="N(t) = N_0 \\left(\\frac{1}{2}\\right)^{\\frac{t}{T_{1/2}}}"></span>"
      - Example of chemical formula: "...reacting carbon dioxide <span data-type="math" data-latex="\\text{CO}_2"></span> with water"
      - Example of chemical reaction: "...the balanced formula is <span data-type="math" data-latex="6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\rightarrow \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2"></span>"
      - Example of exponents: "...at a rate of <span data-type="math" data-latex="9.8 \\text{ m/s}^2"></span>"
      CRITICAL: Write standard LaTeX formulas using single backslashes (e.g. \\text{H}_2\\text{O} and \\frac{a}{b}). Let standard JSON string escaping represent them. Do NOT double-escape them into \\\\text or strip backslashes entirely.

      SPECIFIC FORMAT FOR EACH QUESTION TYPE:

      1. Multiple Choice ("mc") questions:
         - "type": "mc"
         - "text": string (the question stem)
         - "choices": array of exactly 4 strings
         - "correctIndices": array containing exactly one integer (the 0-based index of the correct alternative, e.g. [0] or [2])

      2. Short Answer ("sa") questions:
         - "type": "sa"
         - "text": string (conceptual question)
         - "rubric": string in HTML format explaining exactly what a correct answer must address, including definitions, equations, or scientific concepts
         - "sampleAnswer": string showing a model high-performing student response
         - "gradingCriteria": array of objects representing specific, multi-point conceptual scoring rules. Under no circumstances leave this empty or lazy. Example:
           "gradingCriteria": [
             { "text": "Conceptual Identification", "points": 1, "description": "Student correctly identifies chemical structure or active principles." },
             { "text": "Kinetic Explanation", "points": 1, "description": "Student explains changes in rate with respect to temperature." }
           ]

      3. Numeric / Calculation ("numeric") questions:
         - "type": "numeric"
         - "text": string (requires a numerical calculation or value)
         - "answerSpec": object containing:
           - "correctExpression": string representation of the expression or absolute answer (e.g. "9.8" or "1/3" or "3 * 10^5")
           - "correctValue": number (the decimal value after calculation, e.g. 9.8 or 0.333333 or 300000)
           - "toleranceType": "percent" | "absolute"
           - "toleranceValue": number (e.g., 5 for percent or 0.1 for absolute)
           - "tolerance": number (the calculated margin, e.g., if toleranceType is percent it should specify parsed correctValue * toleranceValue/100, if absolute it's toleranceValue)
           - "unit": string (optional units, e.g. "m/s" or "g")

      4. Essay / Rich Text ("essay") questions:
         - "type": "essay"
         - "text": string (open-ended extensive writing or analysis prompt)
         - "answerSpec": object containing:
           - "minWords": number (usually 50 or 100)
         - "rubric": string in HTML format (grading rules for argument structure and evidence)
         - "sampleAnswer": string (model multi-paragraph essay answer)
         - "gradingCriteria": array of objects dividing points (usually total of 5 points) among structural, argumentative, and factual components. Example:
           "gradingCriteria": [
             { "text": "Scientific Argumentation", "points": 2, "description": "Integrates empirical evidence and supports the hypothesis logically." },
             { "text": "Concept Integration", "points": 2, "description": "Properly connects thermodynamics and reaction kinematics." },
             { "text": "Word Count & Structure", "points": 1, "description": "Is coherent and meets the minimum length requirement." }
           ]

      5. Fill-in-the-Blank ("fitb") questions:
         - "type": "fitb"
         - "text": string (containing a prose passage with a blank or explicit cue for the blank)
         - "answerSpec": object containing:
           - "accepted": array of strings representing acceptable variations of the correct response (e.g. ["Mitochondria", "mitochondrion"])
           - "caseSensitive": boolean (usually false)

      PROVIDE ONLY A VALID JSON ARRAY with no additional markdown boxes, comments, or explanations outside the JSON array. Match this schema perfectly. Always use rigorous, high-quality academic language suitable for science courses.

      Each question MUST follow the schema representing its chosen type.`;

      const result = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: "You are an expert science tutor and professional content designer. You generate rigorous, deeply educational assessment items. Double-check all LaTeX formatting. Ensure you write standard single-escaped LaTeX inside JSON strings (e.g., use \\text{} and \\frac{} within the JSON text, not double-escaped or missing backslashes).",
          responseMimeType: "application/json"
        }
      });

      let cleanText = result.text || "";
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const questions = JSON.parse(cleanText.trim());
      const mappedQuestions = questions.map((q: any) => {
        const questionId = Math.random().toString(36).substring(2, 10);
        let updatedCriteria = undefined;
        
        // Map criteria for sa and essay
        if ((q.type === 'sa' || q.type === 'essay') && Array.isArray(q.gradingCriteria)) {
          updatedCriteria = q.gradingCriteria.map((c: any) => ({
            id: Math.random().toString(36).substring(2, 9),
            text: c.text || "Scientific Accuracy",
            points: typeof c.points === 'number' ? c.points : 1,
            description: c.description || ""
          }));
        }
        
        // Sum points based on gradingCriteria if it's sa or essay
        const totalPoints = (q.type === 'sa' || q.type === 'essay') && updatedCriteria
          ? updatedCriteria.reduce((sum: number, c: any) => sum + (c.points || 0), 0)
          : (typeof q.points === 'number' ? q.points : 1);

        return {
          ...q,
          id: questionId,
          points: totalPoints || 1,
          gradingCriteria: updatedCriteria,
          status: "draft"
        };
      });

      res.json({ success: true, questions: mappedQuestions });
    } catch (err: any) {
      console.error("[Suggest Questions] Failed:", err);
      res.status(500).json({ error: `AI generation failed: ${err.message}` });
    }
  });

  app.post("/api/gemini/suggest-rubric", verifyFirebaseToken, async (req, res) => {
    const { questionText, stimulusContent } = req.body;
    if (!questionText || typeof questionText !== "string") {
      return res.status(400).json({ error: "Question text is required and must be a string." });
    }

    if (!ai) {
      return res.status(503).json({ error: "AI service is currently unavailable. Please verify GEMINI_API_KEY is configured." });
    }

    try {
      let prompt = `You are an expert science teacher and curriculum designer. Please generate a comprehensive grading rubric and a sample ideal answer for the following short answer science question.

QUESTION TEXT:
${questionText}
`;
      if (stimulusContent) {
        prompt += `
SOURCE MATERIAL OR CONTEXT:
${stimulusContent}
`;
      }
      
      prompt += `
FORMULA FORMATTING DIRECTIVE:
Whenever any mathematical equation, expression, chemical compound, chemical reaction, variable symbol, fraction, subscript/superscript, isotope (e.g., C-14 as {}^{14}C), units (e.g., m/s^2), or any scientific formula is generated anywhere in the 'rubric', 'sampleAnswer', or 'gradingCriteria' descriptions, you MUST wrap it inside a \`<span data-type="math" data-latex="LaTeX_code_here"></span>\` element.
Do NOT use raw inline LaTeX delimiters like '$...$' or '$$...$$'.
- Example of mathematical equation: "...where the equation is <span data-type="math" data-latex="N(t) = N_0 \\left(\\frac{1}{2}\\right)^{\\frac{t}{T_{1/2}}}"></span>"
CRITICAL: Write standard LaTeX formulas using single backslashes (e.g. \\text{H}_2\\text{O} and \\frac{a}{b}). Let standard JSON string escaping represent them. Do NOT double-escape them into \\\\text or strip backslashes entirely.

You MUST:
1. Provide a detailed, pedagogical 'rubric' (string in HTML format containing paragraphs or lists) explaining exactly what a correct answer must address, including definitions, equations, or scientific concepts.
2. Provide a 'sampleAnswer' (string in HTML format) that shows a model, high-performing student response.
3. Supply a robust array of 'gradingCriteria' (array of objects) dividing the question's total points to score various cognitive parts of the response. Let's make the total points around 3 to 5 depending on the complexity of the question.

PROVIDE A JSON OBJECT matching exactly this schema:
{
  "rubric": "string (HTML format)",
  "sampleAnswer": "string (HTML format)",
  "gradingCriteria": [
    {
      "text": "Criteria name (e.g. Core Concept Identification)",
      "points": number (e.g. 1),
      "description": "Explanation of what to look for."
    }
  ],
  "points": number (Sum of points from gradingCriteria)
}
`;

      const result = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: "You are a professional science teacher and content curriculum designer. Always generate rigorous and highly engaging assessment rubrics. Be mathematically and scientifically precise. Return ONLY the JSON object. Write standard single-escaped LaTeX inside JSON strings (e.g., use \\text{} and \\frac{} within the JSON text, not double-escaped or missing backslashes).",
          responseMimeType: "application/json"
        }
      });

      let cleanText = result.text || "";
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const generatedData = JSON.parse(cleanText.trim());
      
      // Assign unique ids to criteria
      if (Array.isArray(generatedData.gradingCriteria)) {
        generatedData.gradingCriteria = generatedData.gradingCriteria.map((c: any) => ({
          id: Math.random().toString(36).substring(2, 9),
          text: c.text,
          points: c.points,
          description: c.description
        }));
      }

      res.json({ success: true, data: generatedData });
    } catch (err: any) {
      console.error("[Suggest Rubric] Failed:", err);
      res.status(500).json({ error: `AI generation failed: ${err.message}` });
    }
  });

  app.post("/api/gemini/analyze-timeline", verifyFirebaseToken, async (req, res) => {
    const { studentName, logs } = req.body;
    if (!studentName || typeof studentName !== "string") {
      return res.status(400).json({ error: "Student name is required and must be a string." });
    }
    if (!Array.isArray(logs)) {
      return res.status(400).json({ error: "Logs are required and must be an array." });
    }

    if (!ai) {
      return res.status(503).json({ error: "AI service is currently unavailable. Please verify GEMINI_API_KEY is configured." });
    }

    try {
      // Clean and narrow down the logs to minimize tokens while supplying high-context signals
      const simplifiedLogs = logs.map((log: any, index: number) => ({
        step: index + 1,
        type: log.type,
        time: log.timestamp?.toMillis 
          ? new Date(log.timestamp.toMillis).toLocaleTimeString() 
          : (log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "unknown"),
        questionId: log.questionId,
        value: typeof log.value === "string" ? log.value.slice(0, 300) : log.value
      }));

      const prompt = `You are an expert proctor and educational data analyst.
Analyze the following chronological interaction telemetry logs of student "${studentName}" to automatically flag any suspicious behavior indicative of academic dishonesty (e.g., rapid copy-paste right after blur/focus switch, unauthorized browser tab switches, prompt injections/exploits) or significant cognitive struggle (e.g., heavy backtracking, large time gaps, excessive uncertainty/confidence drops on specific questions).

CHRONOLOGICAL EVENT LOGS (Step 1 to ${simplifiedLogs.length}):
${JSON.stringify(simplifiedLogs, null, 2)}

Identify specific pattern-based anomalies and struggle insights. Be constructive, precise, and objective. 

YOU MUST RESPOND ONLY with a JSON object containing:
{
  "summary": "1-2 sentence objective summary of the student's behavior and engagement pattern.",
  "riskScore": number (0 to 100 representing academic dishonesty risk),
  "struggleScore": number (0 to 100 representing cognitive struggle level),
  "anomalies": [
    {
      "title": "Short title describing the anomaly",
      "severity": "high" | "medium" | "low",
      "description": "Evidence-backed description of what occurred, mentioning step numbers or timestamps.",
      "timestamp": "Timestamp or step number"
    }
  ],
  "struggleInsights": [
    {
      "questionId": "ID or Q-number e.g. Q1",
      "description": "Detailed explanation of what specific cognitive block occurred on this question.",
      "remediation": "Clear, actionable suggestions on how the teacher can tutor the student on this topic."
    }
  ]
}`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: "You are an AI assistant designed to perform rigorous and constructive analysis on student focus and academic telemetry logs for teachers. Return ONLY a valid JSON object matching the requested schema.",
          responseMimeType: "application/json"
        }
      });

      let cleanText = result.text || "";
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const analysis = JSON.parse(cleanText.trim());
      res.json({ success: true, analysis });
    } catch (err: any) {
      console.error("[Analyze Timeline] Failed:", err);
      res.status(500).json({ error: `AI analysis failed: ${err.message}` });
    }
  });

  // ---- SHARED RESULTS API ----

  /**
   * Teacher generates a secure share token for one student's released results.
   * The token maps to (sessionId, studentId) and allows public access to released
   * results without requiring the student to be logged in.
   */
  app.post("/api/sessions/:sessionId/students/:studentId/share-token", verifyFirebaseToken, async (req: any, res: any) => {
    const { sessionId, studentId } = req.params;
    const callerUid: string = req.firebaseUser.uid;

    try {
      const db = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      const sessionSnap = await db.collection("sessions").doc(sessionId).get();
      if (!sessionSnap.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionSnap.data() as any;

      const isAdmin = req.firebaseUser?.admin === true;
      if (sessionData?.teacherId !== callerUid && !isAdmin) {
        return res.status(403).json({ error: "Forbidden: not session owner" });
      }

      const ssSnap = await db.collection("student_sessions")
        .where("sessionId", "==", sessionId)
        .where("studentId", "==", studentId)
        .limit(1)
        .get();
      if (ssSnap.empty) return res.status(404).json({ error: "Student not found in session" });

      // Check if an active token already exists for this student+session
      const existing = await db.collection("shareTokens")
        .where("sessionId", "==", sessionId)
        .where("studentId", "==", studentId)
        .limit(1)
        .get();

      if (!existing.empty) {
        const existingToken = existing.docs[0].id;
        return res.json({ token: existingToken });
      }

      const token = randomUUID();
      await db.collection("shareTokens").doc(token).set({
        sessionId,
        studentId,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });

      res.json({ token });
    } catch (err: any) {
      console.error("[ShareToken] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Public endpoint — no auth required. Validates the share token and returns the
   * released results applying the same server-side release settings as the
   * authenticated student-results endpoint.
   */
  app.get("/api/shared-results/:token", async (req: any, res: any) => {
    const { token } = req.params;
    if (!token || token.length < 10) {
      return res.status(400).json({ error: "Invalid token" });
    }

    try {
      const db = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      const tokenSnap = await db.collection("shareTokens").doc(token).get();
      if (!tokenSnap.exists) {
        return res.status(404).json({ state: "invalid" });
      }
      const tokenData = tokenSnap.data() as any;
      const { sessionId, studentId } = tokenData;

      const sessionSnap = await db.collection("sessions").doc(sessionId).get();
      if (!sessionSnap.exists) return res.status(404).json({ state: "invalid" });
      const sessionData = sessionSnap.data() as any;

      const resultRelease = sessionData.resultRelease;
      const legacyReleased = !!sessionData?.config?.summaryReleasedAt;

      if (!resultRelease && !legacyReleased) {
        return res.json({ state: "not_released" });
      }
      if (resultRelease?.status === "revoked") {
        return res.json({ state: "not_released" });
      }
      if (resultRelease?.status !== "released" && !legacyReleased) {
        return res.json({ state: "not_released" });
      }

      const settings = resultRelease ?? {
        showOverallScore: true,
        showQuestionScores: true,
        showStudentAnswers: true,
        showCorrectAnswers: false,
        showTeacherFeedback: true,
        showAiFeedback: true,
        showRubrics: false,
        showMetacognition: false,
      };

      const responsesSnap = await db.collection("responses")
        .where("sessionId", "==", sessionId)
        .where("studentId", "==", studentId)
        .get();
      const rawResponses = responsesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

      const filteredResponses = rawResponses.map((r: any) => {
        const out: any = {
          id: r.id,
          questionId: r.questionId,
          qIndex: r.qIndex,
          submittedAt: r.submittedAt,
        };
        if (settings.showStudentAnswers) out.answer = r.answer;
        if (settings.showQuestionScores) { out.points = r.points; out.maxPoints = r.maxPoints; out.isCorrect = r.isCorrect; }
        if (settings.showTeacherFeedback && r.feedback) out.feedback = r.feedback;
        if (settings.showAiFeedback) { if (r.aiSuggestedFeedback) out.aiSuggestedFeedback = r.aiSuggestedFeedback; if (r.aiConcepts) out.aiConcepts = r.aiConcepts; }
        if (settings.showMetacognition && r.reflection) out.reflection = r.reflection;
        return out;
      });

      const rawQuestions: any[] = sessionData.snapshotQuestions || [];
      const filteredQuestions = rawQuestions.map((q: any) => {
        const out: any = {
          id: q.id,
          type: q.type,
          text: q.text,
          points: q.points,
          stimulusId: q.stimulusId,
        };
        if (Array.isArray(q.choices)) out.choices = q.choices;
        if (settings.showCorrectAnswers) {
          if (q.correctIndices !== undefined) out.correctIndices = q.correctIndices;
          if (q.sampleAnswer) out.sampleAnswer = q.sampleAnswer;
        }
        if (settings.showRubrics) {
          if (q.rubric) out.rubric = q.rubric;
          if (q.explanation) out.explanation = q.explanation;
          if (q.gradingCriteria) out.gradingCriteria = q.gradingCriteria;
        }
        return out;
      });

      let overallScore: { earned: number; total: number; percent: number } | undefined;
      if (settings.showOverallScore && settings.showQuestionScores) {
        const earned = rawResponses.reduce((s: number, r: any) => s + (r.points ?? 0), 0);
        const total = rawResponses.reduce((s: number, r: any) => s + (r.maxPoints ?? 0), 0);
        overallScore = { earned, total, percent: total > 0 ? Math.round((earned / total) * 100) : 0 };
      }

      const ssSnapForName = await db.collection("student_sessions")
        .where("sessionId", "==", sessionId)
        .where("studentId", "==", studentId)
        .limit(1)
        .get();
      const studentName = ssSnapForName.docs[0]?.data?.()?.studentName ?? "";

      return res.json({
        state: "released",
        assessmentTitle: sessionData.setName || "Assessment",
        studentName,
        completedAt: rawResponses[0]?.submittedAt ?? null,
        overallScore,
        responses: filteredResponses,
        questions: filteredQuestions,
        stimuli: sessionData.snapshotStimuli || [],
        settings: {
          showOverallScore: settings.showOverallScore,
          showQuestionScores: settings.showQuestionScores,
          showStudentAnswers: settings.showStudentAnswers,
          showCorrectAnswers: settings.showCorrectAnswers,
          showTeacherFeedback: settings.showTeacherFeedback,
          showAiFeedback: settings.showAiFeedback,
          showRubrics: settings.showRubrics,
          showMetacognition: settings.showMetacognition,
        },
      });
    } catch (err: any) {
      console.error("[SharedResults] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ---- SECURITY RISK OBSERVABILITY API ----

  // Canonical allowed event types — client cannot invent new types
  const ALLOWED_SECURITY_EVENT_TYPES = new Set([
    // Enforcement (high-value)
    "fullscreen_exited", "visibility_hidden", "window_blur", "assessment_left", "assessment_returned",
    "reentry_requested",
    // Answer behavior (medium-value)
    "answer_changed_after_return", "fast_submit_after_return", "paste_detected", "paste_like_burst",
    "response_discontinuity",
    // Risk / behavioral (medium-value)
    "long_inactivity_window", "long_inactivity", "shortcut_attempt", "context_menu_attempt",
    // Environmental (weak/noisy)
    "viewport_changed", "edge_seeking_detected",
    // System
    "browser_capability_snapshot", "wake_lock_granted", "wake_lock_failed",
  ]);

  // Server-normalized severity — client severity is ignored and replaced with this
  const CANONICAL_EVENT_SEVERITY: Record<string, 1 | 2 | 3 | 4 | 5> = {
    fullscreen_exited: 4,
    visibility_hidden: 4,
    window_blur: 3,
    assessment_left: 4,
    assessment_returned: 2,
    reentry_requested: 3,
    answer_changed_after_return: 4,
    fast_submit_after_return: 4,
    paste_detected: 3,
    paste_like_burst: 4,
    response_discontinuity: 3,
    long_inactivity_window: 2,
    long_inactivity: 2,
    shortcut_attempt: 2,
    context_menu_attempt: 2,
    viewport_changed: 2,
    edge_seeking_detected: 1,
    browser_capability_snapshot: 1,
    wake_lock_granted: 1,
    wake_lock_failed: 1,
  };

  // Server-assigned signal class
  const CANONICAL_SIGNAL_CLASS: Record<string, string> = {
    fullscreen_exited: "enforcement",
    visibility_hidden: "enforcement",
    window_blur: "enforcement",
    assessment_left: "enforcement",
    assessment_returned: "enforcement",
    reentry_requested: "enforcement",
    answer_changed_after_return: "behavioral",
    fast_submit_after_return: "behavioral",
    paste_detected: "behavioral",
    paste_like_burst: "behavioral",
    response_discontinuity: "behavioral",
    long_inactivity_window: "behavioral",
    long_inactivity: "behavioral",
    shortcut_attempt: "behavioral",
    context_menu_attempt: "behavioral",
    viewport_changed: "environmental",
    edge_seeking_detected: "environmental",
    browser_capability_snapshot: "system",
    wake_lock_granted: "system",
    wake_lock_failed: "system",
  };

  // Maximum metadata size to prevent large-payload abuse
  const MAX_METADATA_KEYS = 20;
  const MAX_METADATA_VALUE_LEN = 512;

  function sanitizeMetadata(meta: unknown): Record<string, unknown> | undefined {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (count >= MAX_METADATA_KEYS) break;
      const strV = String(v);
      out[k] = strV.length > MAX_METADATA_VALUE_LEN ? strV.slice(0, MAX_METADATA_VALUE_LEN) : v;
      count++;
    }
    return out;
  }

  app.post("/api/security-risk/events", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { sessionId, studentId, events } = req.body;
      if (!sessionId || !studentId || !Array.isArray(events)) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      // Caller must be the student whose events are being submitted
      const callerUid: string = req.firebaseUser?.uid;
      if (callerUid !== studentId) {
        return res.status(403).json({ error: "Forbidden: student ID mismatch" });
      }

      if (events.length > 500) {
        return res.status(400).json({ error: "Too many events in single batch" });
      }

      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      // Validate session exists and student is enrolled
      const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
      if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });

      const ssSnap = await adminDb
        .collection("student_sessions")
        .where("sessionId", "==", sessionId)
        .where("studentId", "==", studentId)
        .limit(1)
        .get();
      if (ssSnap.empty) return res.status(403).json({ error: "Student not enrolled in session" });

      const serverReceivedAt = new Date().toISOString();
      const batch = adminDb.batch();
      let accepted = 0;

      for (const ev of events) {
        const eventType: string = typeof ev.eventType === "string" ? ev.eventType : "";

        // Reject unknown event types — only canonical types are stored
        if (!ALLOWED_SECURITY_EVENT_TYPES.has(eventType)) continue;

        // Validate clientTimestamp is a reasonable number (not in the future by more than 30s)
        const clientTs = typeof ev.clientTimestamp === "number" ? ev.clientTimestamp : null;
        const serverMs = Date.now();
        if (clientTs !== null && (clientTs > serverMs + 30000 || clientTs < serverMs - 24 * 3600 * 1000)) {
          // Suspicious timestamp — store but flag
        }

        const sanitized: Record<string, unknown> = {
          // Fields written by server — override any client-supplied values
          sessionId,
          studentId,
          serverReceivedAt,
          serverTimestamp: serverReceivedAt, // keep for backward compat
          trustLevel: "client-reported",
          signalClass: CANONICAL_SIGNAL_CLASS[eventType] ?? "environmental",
          severity: CANONICAL_EVENT_SEVERITY[eventType] ?? 2,

          // Client-supplied fields we do accept (validated)
          eventType,
          category: typeof ev.category === "string" ? ev.category : "risk",
          itemId: typeof ev.itemId === "string" ? ev.itemId : (ev.itemId ?? null),
          durationMs: typeof ev.durationMs === "number" ? ev.durationMs : undefined,
          clientTimestamp: clientTs,
          metadata: sanitizeMetadata(ev.metadata),

          // Client reports hardActionTriggered for context but server does not trust it for decisions
          hardActionTriggered: ev.hardActionTriggered === true,
        };

        // Remove undefined keys to keep Firestore documents clean
        for (const key of Object.keys(sanitized)) {
          if (sanitized[key] === undefined) delete sanitized[key];
        }

        const ref = adminDb.collection("security_risk_events").doc();
        batch.set(ref, sanitized);
        accepted++;
      }

      if (accepted > 0) await batch.commit();

      // Recompute risk summary asynchronously (do not await — respond fast)
      recomputeRiskSummary(sessionId, studentId, firebaseConfig.firestoreDatabaseId || "(default)").catch((err: any) =>
        console.error("[SecurityRisk] recomputeRiskSummary failed:", err)
      );

      res.json({ ok: true, accepted });
    } catch (err) {
      console.error("[SecurityRisk] events error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Teacher review endpoint — allows updating only the teacherReview subfield on a security event
  app.patch("/api/security-risk/events/:eventId/review", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { eventId } = req.params;
      const { status, note } = req.body;
      const callerUid: string = req.firebaseUser?.uid;
      const isAdmin = req.firebaseUser?.admin === true;

      const VALID_STATUSES = new Set(["unreviewed", "acknowledged", "resolved", "false_positive", "escalated"]);
      if (!status || !VALID_STATUSES.has(status)) {
        return res.status(400).json({ error: "Invalid review status" });
      }

      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");
      const eventRef = adminDb.collection("security_risk_events").doc(eventId);
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) return res.status(404).json({ error: "Event not found" });

      const eventData = eventSnap.data() as any;

      // Verify caller is teacher of this session or admin
      const sessionId: string = eventData?.sessionId;
      if (!isAdmin) {
        const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
        if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });
        const sessionData = sessionDoc.data() as any;
        if (sessionData?.teacherId !== callerUid) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const teacherReview: Record<string, unknown> = {
        status,
        reviewedBy: callerUid,
        reviewedAt: new Date().toISOString(),
      };
      if (typeof note === "string" && note.length > 0) {
        teacherReview.note = note.slice(0, 1000);
      }

      await eventRef.update({ teacherReview });
      res.json({ ok: true });
    } catch (err) {
      console.error("[SecurityRisk] review error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  async function recomputeRiskSummary(sessionId: string, studentId: string, dbId: string) {
    const adminDb = getFirestore(dbId);

    // Fetch all events for this student in this session
    const eventsSnap = await adminDb
      .collection("security_risk_events")
      .where("sessionId", "==", sessionId)
      .where("studentId", "==", studentId)
      .get();
    const events = eventsSnap.docs.map((d: any) => d.data());

    // Get student name
    const ssSnap = await adminDb
      .collection("student_sessions")
      .where("sessionId", "==", sessionId)
      .where("studentId", "==", studentId)
      .limit(1)
      .get();
    const studentName = ssSnap.docs[0]?.data()?.studentName ?? studentId;

    // Get session duration and question display numbers
    const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
    const session = sessionDoc.data() as any;
    const assessmentDurationMs = session?.config?.timer?.seconds
      ? session.config.timer.seconds * 1000
      : undefined;

    // Build question display number map from session questions array
    const questionDisplayNumbers: Record<string, number> = {};
    const questions: any[] = session?.questions ?? [];
    questions.forEach((q: any, idx: number) => {
      if (q?.id) questionDisplayNumbers[q.id] = idx + 1;
    });

    // Get teacher-approved reentries
    const allSsSnap = await adminDb
      .collection("student_sessions")
      .where("sessionId", "==", sessionId)
      .get();
    const teacherApprovedReentries = allSsSnap.docs
      .filter((d: any) => d.data().reentryApproved)
      .map((d: any) => d.data().studentId as string);

    // Detect class-wide anomalies
    const allEventsSnap = await adminDb
      .collection("security_risk_events")
      .where("sessionId", "==", sessionId)
      .get();
    const allEvents = allEventsSnap.docs.map((d: any) => d.data());
    const allStudentIds = [...new Set(allEvents.map((e: any) => e.studentId as string))];
    const totalStudents = allStudentIds.length;
    const eventsByStudent = new Map<string, any[]>();
    for (const ev of allEvents) {
      if (!eventsByStudent.has(ev.studentId)) eventsByStudent.set(ev.studentId, []);
      eventsByStudent.get(ev.studentId)!.push(ev);
    }
    const classWideAnomalyEventTypes = detectClassWideAnomalies(eventsByStudent, totalStudents);

    // Fetch metacognition data for confidence correlation
    const metacognitionsSnap = await adminDb
      .collection("metacognition")
      .where("sessionId", "==", sessionId)
      .where("studentId", "==", studentId)
      .get();
    const metacognitions = metacognitionsSnap.docs.map((d: any) => {
      const data = d.data();
      return {
        questionId: data.questionId as string,
        confidence: data.confidence as number,
        submittedAt: data.submittedAt as string,
      };
    });

    const summary = computeRiskSummary(sessionId, studentId, studentName, events as any, {
      assessmentDurationMs,
      teacherApprovedReentries,
      classWideAnomalyEventTypes,
      metacognitions,
      questionDisplayNumbers,
    });

    // Write summary to Firestore
    const summaryRef = adminDb.collection("security_risk_summaries").doc(`${sessionId}_${studentId}`);
    await summaryRef.set({ ...summary });
  }

  // GET /api/security-risk/:sessionId/overview — session-level overview for teachers
  app.get("/api/security-risk/:sessionId/overview", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { sessionId } = req.params;
      const callerUid: string = req.firebaseUser?.uid;
      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
      if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionDoc.data() as any;
      const isAdmin = req.firebaseUser?.admin === true;
      if (sessionData?.teacherId !== callerUid && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const snap = await adminDb
        .collection("security_risk_summaries")
        .where("sessionId", "==", sessionId)
        .get();
      const summaries = snap.docs.map((d: any) => d.data());

      // Build overview
      const levelCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let totalExits = 0;
      let reentryRequests = 0;
      const highRiskStudents: { studentId: string; studentName: string; level: number; symbol: string; label: string }[] = [];
      let classWideAnomalyCount = 0;

      for (const s of summaries) {
        levelCounts[s.level] = (levelCounts[s.level] ?? 0) + 1;
        totalExits += s.metrics?.timesLeftAssessment ?? 0;
        reentryRequests += s.metrics?.reentryRequests ?? 0;
        if (s.level >= 4) {
          highRiskStudents.push({
            studentId: s.studentId,
            studentName: s.studentName ?? s.studentId,
            level: s.level,
            symbol: s.symbol,
            label: s.label,
          });
        }
        if (s.classWideAnomalyEvents?.length > 0) classWideAnomalyCount++;
      }

      res.json({
        sessionId,
        totalStudents: summaries.length,
        levelCounts,
        totalExits,
        reentryRequests,
        highRiskStudents: highRiskStudents.sort((a, b) => b.level - a.level),
        classWideAnomalyCount,
      });
    } catch (err) {
      console.error("[SecurityRisk] overview error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/security-risk/:sessionId/student/:studentId — student details for teachers
  app.get("/api/security-risk/:sessionId/student/:studentId", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { sessionId, studentId } = req.params;
      const callerUid: string = req.firebaseUser?.uid;
      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
      if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionDoc.data() as any;
      const isAdmin = req.firebaseUser?.admin === true;
      if (sessionData?.teacherId !== callerUid && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const summaryDoc = await adminDb
        .collection("security_risk_summaries")
        .doc(`${sessionId}_${studentId}`)
        .get();
      if (!summaryDoc.exists) return res.status(404).json({ error: "No risk summary for this student" });

      res.json({ summary: summaryDoc.data() });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/security-risk/:sessionId/anomalies — class-wide anomalies for teachers
  app.get("/api/security-risk/:sessionId/anomalies", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { sessionId } = req.params;
      const callerUid: string = req.firebaseUser?.uid;
      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
      if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionDoc.data() as any;
      const isAdmin = req.firebaseUser?.admin === true;
      if (sessionData?.teacherId !== callerUid && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const allEventsSnap = await adminDb
        .collection("security_risk_events")
        .where("sessionId", "==", sessionId)
        .get();
      const allEvents = allEventsSnap.docs.map((d: any) => d.data());
      const allStudentIds = [...new Set(allEvents.map((e: any) => e.studentId as string))];
      const eventsByStudent = new Map<string, any[]>();
      for (const ev of allEvents) {
        if (!eventsByStudent.has(ev.studentId)) eventsByStudent.set(ev.studentId, []);
        eventsByStudent.get(ev.studentId)!.push(ev);
      }
      const anomalousEventTypes = detectClassWideAnomalies(eventsByStudent, allStudentIds.length);

      res.json({
        sessionId,
        anomalousEventTypes,
        affectedStudentCount: allStudentIds.length,
        message:
          anomalousEventTypes.length > 0
            ? "These events occurred for multiple students at nearly the same time and may reflect a system or network issue."
            : "No class-wide anomalies detected.",
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/security-risk/:sessionId/recalculate — recompute all summaries for a session
  app.post("/api/security-risk/:sessionId/recalculate", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { sessionId } = req.params;
      const callerUid: string = req.firebaseUser?.uid;
      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
      if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionDoc.data() as any;
      const isAdmin = req.firebaseUser?.admin === true;
      if (sessionData?.teacherId !== callerUid && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Get all distinct student IDs for this session from both events and enrolled student sessions
      const eventsSnap = await adminDb
        .collection("security_risk_events")
        .where("sessionId", "==", sessionId)
        .get();
      const eventStudentIds = eventsSnap.docs.map((d: any) => d.data().studentId as string);

      const ssSnap = await adminDb
        .collection("student_sessions")
        .where("sessionId", "==", sessionId)
        .get();
      const ssStudentIds = ssSnap.docs.map((d: any) => d.data().studentId as string);

      const studentIds = [...new Set([...eventStudentIds, ...ssStudentIds])];
      const dbId = firebaseConfig.firestoreDatabaseId || "(default)";

      // Recompute for each student (fire and forget — respond immediately)
      for (const studentId of studentIds) {
        recomputeRiskSummary(sessionId, studentId, dbId).catch((err: any) =>
          console.error(`[SecurityRisk] recalculate failed for ${studentId}:`, err)
        );
      }

      res.json({ ok: true, studentsQueued: studentIds.length });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/security-risk/:sessionId/summaries", verifyFirebaseToken, async (req: any, res: any) => {
    try {
      const { sessionId } = req.params;
      const callerUid: string = req.firebaseUser?.uid;

      const adminDb = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

      // Verify caller owns the session or is an admin
      const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
      if (!sessionDoc.exists) return res.status(404).json({ error: "Session not found" });
      const sessionData = sessionDoc.data() as any;
      const isAdmin = req.firebaseUser?.admin === true;
      if (sessionData?.teacherId !== callerUid && !isAdmin) {
        return res.status(403).json({ error: "Forbidden: not session owner" });
      }

      const snap = await adminDb
        .collection("security_risk_summaries")
        .where("sessionId", "==", sessionId)
        .get();
      const summaries = snap.docs.map((d: any) => d.data());
      res.json({ summaries });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Helper to ensure JSON responses on errors for API routes
  app.use("/api", (err: any, req: any, res: any, _next: any) => {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    const status = err.status || err.statusCode || (typeof err.code === 'number' ? err.code : 500);
    const isClientError = status >= 400 && status < 500;
    res.status(status).json({
      error: isClientError ? (err.message || "Bad Request") : "Internal Server Error",
    });
  });

  // API 404 handler - ensure any missing /api routes return JSON, not HTML
  app.use("/api/*", (req, res) => {
    if (!res.headersSent) {
      res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          // Keep normal caching for hashed assets (JS/CSS)
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));

    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
    
    // Trigger background initialization after listening
    probeBucket().catch(err => console.error("Initial probe error:", err));
  });
}

startServer();
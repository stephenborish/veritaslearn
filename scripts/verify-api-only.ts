/**
 * verify-api-only.ts
 *
 * Static analysis: confirms that no frontend (src/) file performs direct Firestore
 * write operations. All sensitive data operations must go through the Express API,
 * not via the Firestore client SDK from the browser.
 *
 * Forbidden patterns in src/:
 *   - setDoc(...)
 *   - addDoc(...)
 *   - updateDoc(...)
 *   - deleteDoc(...)
 *   - writeBatch(...)
 *   - runTransaction(...)
 *   - import { ..., setDoc, ... } from "firebase/firestore"
 *   - import { db } from ".../lib/firebase" (or any path to firebase.ts that exports db)
 *
 * Allowed in src/:
 *   - import { Timestamp } from "firebase/firestore" (type-only import)
 *   - import { auth, storage, googleProvider, signInWithPopup, signOut, onAuthStateChanged }
 *     from ".../lib/firebase" (auth/storage are safe)
 *   - import { ref, getDownloadURL, uploadBytesResumable } from "firebase/storage"
 *   - All reads/writes to Firestore must be done server-side via /api/ routes
 *
 * Allowed in server.ts and server/:
 *   - Everything — the server uses the Admin SDK or REST API appropriately
 */

import fs from "fs";
import path from "path";

// ─── Configuration ──────────────────────────────────────────────────────────

const SRC_DIR = path.join(process.cwd(), "src");

/** Firestore write function names that must never appear in frontend code. */
const FORBIDDEN_WRITE_FNS = [
  "setDoc",
  "addDoc",
  "updateDoc",
  "deleteDoc",
  "writeBatch",
  "runTransaction",
];

/** Firestore SDK modules from which write functions might be imported. */
const FIRESTORE_SDK_MODULE = "firebase/firestore";

/** The db export from firebase.ts — must not be imported in any frontend file. */
const DB_IMPORT_PATTERN = /import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["'][^"']*(?:firebase|lib\/firebase)[^"']*["']/;

// ─── File Collection ─────────────────────────────────────────────────────────

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Checking Helpers ────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function checkFile(filePath: string): Finding[] {
  const findings: Finding[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const relPath = path.relative(process.cwd(), filePath);

  lines.forEach((line: string, idx: number) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Skip comment-only lines
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }

    // Rule 1: Detect import of write functions from firebase/firestore
    if (line.includes(FIRESTORE_SDK_MODULE)) {
      for (const fn of FORBIDDEN_WRITE_FNS) {
        // Match as import specifier (preceded by { , or whitespace)
        const importPattern = new RegExp(`[{,\\s]${fn}[,}\\s]`);
        if (importPattern.test(line)) {
          findings.push({
            file: relPath,
            line: lineNum,
            text: trimmed,
            rule: `FORBIDDEN_IMPORT: '${fn}' imported from '${FIRESTORE_SDK_MODULE}'`,
          });
        }
      }
    }

    // Rule 2: Detect call of write functions (e.g., await setDoc(...), setDoc(db, ...))
    for (const fn of FORBIDDEN_WRITE_FNS) {
      // Match function call form: setDoc( or setDoc (
      const callPattern = new RegExp(`\\b${fn}\\s*\\(`);
      if (callPattern.test(line)) {
        findings.push({
          file: relPath,
          line: lineNum,
          text: trimmed,
          rule: `FORBIDDEN_CALL: '${fn}(...)' called in frontend code`,
        });
      }
    }

    // Rule 3: Detect import of `db` from firebase (any path containing 'firebase' or 'lib/firebase')
    if (DB_IMPORT_PATTERN.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        text: trimmed,
        rule: `FORBIDDEN_DB_IMPORT: 'db' (Firestore client) imported in frontend — use /api routes instead`,
      });
    }
  });

  return findings;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string) {
  console.error(`  ✗ ${msg}`);
}

function run() {
  let allPassed = true;
  const allFindings: Finding[] = [];

  // Collect all .ts and .tsx files under src/
  const files = collectFiles(SRC_DIR, [".ts", ".tsx"]);
  console.log(`\nverify-api-only: scanning ${files.length} frontend source files in src/\n`);

  for (const file of files) {
    const findings = checkFile(file);
    allFindings.push(...findings);
  }

  // ── Section 1: No direct Firestore write function calls ──
  console.log("Section 1: No direct Firestore write function calls in frontend");
  const writeFnFindings = allFindings.filter((f) =>
    f.rule.startsWith("FORBIDDEN_CALL") || f.rule.startsWith("FORBIDDEN_IMPORT")
  );
  if (writeFnFindings.length === 0) {
    pass(`No setDoc/addDoc/updateDoc/deleteDoc/writeBatch/runTransaction calls found in src/`);
  } else {
    allPassed = false;
    fail(`Found ${writeFnFindings.length} forbidden Firestore write operation(s):`);
    writeFnFindings.forEach((f) => {
      console.error(`    ${f.file}:${f.line}: ${f.rule}`);
      console.error(`      → ${f.text}`);
    });
  }

  // ── Section 2: db (Firestore client) not imported in frontend ──
  console.log("\nSection 2: Firestore client 'db' not imported in any frontend file");
  const dbImportFindings = allFindings.filter((f) => f.rule.startsWith("FORBIDDEN_DB_IMPORT"));
  if (dbImportFindings.length === 0) {
    pass(`'db' is not imported by any src/ file — all Firestore access goes through the API server`);
  } else {
    allPassed = false;
    fail(`Found ${dbImportFindings.length} forbidden 'db' import(s):`);
    dbImportFindings.forEach((f) => {
      console.error(`    ${f.file}:${f.line}: ${f.rule}`);
      console.error(`      → ${f.text}`);
    });
  }

  // ── Section 3: firebase/firestore imports are type-only or safe ──
  console.log("\nSection 3: firebase/firestore imports are type-only (Timestamp, FieldValue, etc.)");
  const firestoreImportFiles = files.filter((f) => {
    const content = fs.readFileSync(f, "utf-8");
    return content.includes(FIRESTORE_SDK_MODULE);
  });

  if (firestoreImportFiles.length === 0) {
    pass(`No src/ file imports from '${FIRESTORE_SDK_MODULE}'`);
  } else {
    // Check each import to confirm it's type-only (no write functions)
    let anyBad = false;
    firestoreImportFiles.forEach((f) => {
      const content = fs.readFileSync(f, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line: string, idx: number) => {
        if (!line.includes(FIRESTORE_SDK_MODULE)) return;
        const hasForbidden = FORBIDDEN_WRITE_FNS.some((fn: string) => {
          const pat = new RegExp(`[{,\\s]${fn}[,}\\s]`);
          return pat.test(line);
        });
        if (!hasForbidden) {
          const rel = path.relative(process.cwd(), f);
          pass(`${rel}:${idx + 1} — type-only or read-only import: ${line.trim()}`);
        } else {
          anyBad = true;
        }
      });
    });
    if (!anyBad && writeFnFindings.length === 0) {
      pass(`All firebase/firestore imports in src/ are type-only or read-only`);
    }
  }

  // ── Section 4: firebase.ts exports db but no component imports it ──
  console.log("\nSection 4: firebase.ts exports 'db' but no component imports it");
  const firebaseTsPath = path.join(SRC_DIR, "lib", "firebase.ts");
  if (fs.existsSync(firebaseTsPath)) {
    const firebaseTsContent = fs.readFileSync(firebaseTsPath, "utf-8");
    if (firebaseTsContent.includes("export const db")) {
      pass(`firebase.ts correctly exports 'db' (needed for Admin SDK path compatibility)`);
    }
    // Check no component (non-firebase.ts) imports db
    const componentFiles = files.filter((f) => f !== firebaseTsPath);
    const dbImporters = componentFiles.filter((f) => {
      const content = fs.readFileSync(f, "utf-8");
      return DB_IMPORT_PATTERN.test(content);
    });
    if (dbImporters.length === 0) {
      pass(`No component imports 'db' from firebase.ts — API-only principle holds`);
    } else {
      allPassed = false;
      fail(`${dbImporters.length} file(s) import 'db' from firebase.ts:`);
      dbImporters.forEach((f) => {
        fail(`  ${path.relative(process.cwd(), f)}`);
      });
    }
  } else {
    fail(`firebase.ts not found at expected path: ${firebaseTsPath}`);
    allPassed = false;
  }

  // ── Section 5: Sensitive API routes used for writes ──
  console.log("\nSection 5: Frontend uses /api routes for sensitive write operations");
  // Check that fetch('/api/attempts', ...) or fetch('/api/responses', ...) patterns exist
  // (this is a presence check — if these patterns appear, it confirms the app uses the API)
  const sensitiveApiPatterns = [
    { pattern: /fetch\(.*\/api\/attempts/, label: "/api/attempts" },
    { pattern: /fetch\(.*\/api\/lessons/, label: "/api/lessons" },
    { pattern: /fetch\(.*\/api\/assignments/, label: "/api/assignments" },
  ];

  let anyApiFound = false;
  for (const { pattern, label } of sensitiveApiPatterns) {
    const found = files.some((f) => {
      const content = fs.readFileSync(f, "utf-8");
      return pattern.test(content);
    });
    if (found) {
      pass(`Frontend uses ${label} API route`);
      anyApiFound = true;
    }
  }
  if (!anyApiFound) {
    // Not a hard failure — the app may use a different fetch abstraction
    console.log(`  ℹ No direct /api fetch calls found — may use abstraction layer (not a failure)`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  if (allPassed) {
    console.log("✓ verify-api-only: ALL CHECKS PASSED");
    console.log("  Frontend makes NO direct Firestore writes. API-only principle verified.");
  } else {
    console.error("✗ verify-api-only: SOME CHECKS FAILED");
    console.error(`  ${allFindings.length} finding(s) require attention.`);
    process.exit(1);
  }
}

run();

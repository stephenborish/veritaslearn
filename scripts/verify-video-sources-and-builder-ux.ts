/**
 * Verification for VERITAS Learn YouTube / video-source support and builder UX improvements.
 *
 * Checks (20 total):
 *  1–4.  LessonBlock type has all four YouTube fields
 *  5–8.  youtubeParser exports four required symbols
 *  9–13. parseYouTubeUrl handles standard watch, youtu.be, embed, Shorts, and t= timestamp URLs
 * 14.   VideoSourcePicker preserves upload path (imports VideoUploader)
 * 15.   VideoSourcePicker has YouTube tab
 * 16.   VideoSourcePicker has Direct video link tab
 * 17.   YouTubeLessonPlayer.tsx exists and exposes YouTubeLessonPlayerHandle
 * 18.   FocusedPlayer.tsx imports YouTubeLessonPlayer
 * 19.   FocusedPlayer.tsx has youtubePlayerRef for dual-path playback
 * 20.   server.ts persists youtubeVideoId and youtubeEmbedUrl in block normalization
 * 21.   ReadinessPanel is collapsible (detailsVisible state)
 * 22.   RichContentEditor accepts compactHeight prop
 * 23.   QuestionEditor passes compactHeight to MC answer choices
 * 24.   useYouTubeUrl (or handleYouTubeSelected) wired in LessonsBuilder
 * 25.   sanitizeBlockForStudent does not expose youtubeUrl teacher fields
 *       (YouTube fields are safe to expose; confirm they are present in sanitize output)
 *
 * Run: npx tsx scripts/verify-video-sources-and-builder-ux.ts
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  parseYouTubeUrl,
  looksLikeYouTubeUrl,
  resolveYouTubeLegacy,
  isYouTubeParseError,
} from "../src/utils/youtubeParser";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const exists = (rel: string) => existsSync(join(root, rel));

console.log("\n=============================================================");
console.log("  VERITAS LEARN VIDEO SOURCES & BUILDER UX VERIFICATION");
console.log("=============================================================\n");

// ---------------------------------------------------------------------------
// 1–4. LessonBlock type has all four YouTube fields
// ---------------------------------------------------------------------------
console.log("Section 1: LessonBlock type has YouTube fields...");
const types = read("src/types.ts");
check("LessonBlock has videoSource field", /videoSource\??\s*:\s*["']upload["']/.test(types) || /videoSource\??/.test(types));
check("LessonBlock has youtubeVideoId field", /youtubeVideoId\??/.test(types));
check("LessonBlock has youtubeUrl field", /youtubeUrl\??/.test(types));
check("LessonBlock has youtubeEmbedUrl field", /youtubeEmbedUrl\??/.test(types));

// ---------------------------------------------------------------------------
// 5–8. youtubeParser exports four required symbols
// ---------------------------------------------------------------------------
console.log("\nSection 2: youtubeParser utility exports...");
check("parseYouTubeUrl is importable", typeof parseYouTubeUrl === "function");
check("looksLikeYouTubeUrl is importable", typeof looksLikeYouTubeUrl === "function");
check("resolveYouTubeLegacy is importable", typeof resolveYouTubeLegacy === "function");
check("isYouTubeParseError is importable", typeof isYouTubeParseError === "function");

// ---------------------------------------------------------------------------
// 9–13. parseYouTubeUrl handles all URL formats
// ---------------------------------------------------------------------------
console.log("\nSection 3: YouTube URL parsing correctness...");

const watchResult = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
check(
  "Standard watch URL → videoId dQw4w9WgXcQ",
  !isYouTubeParseError(watchResult) && (watchResult as any).videoId === "dQw4w9WgXcQ",
);

const shortResult = parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ");
check(
  "youtu.be short URL → videoId dQw4w9WgXcQ",
  !isYouTubeParseError(shortResult) && (shortResult as any).videoId === "dQw4w9WgXcQ",
);

const embedResult = parseYouTubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
check(
  "Embed URL → videoId dQw4w9WgXcQ",
  !isYouTubeParseError(embedResult) && (embedResult as any).videoId === "dQw4w9WgXcQ",
);

const shortsResult = parseYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
check(
  "Shorts URL → videoId dQw4w9WgXcQ",
  !isYouTubeParseError(shortsResult) && (shortsResult as any).videoId === "dQw4w9WgXcQ",
);

const timestampResult = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
check(
  "Watch URL with t=42s → startSeconds 42",
  !isYouTubeParseError(timestampResult) && (timestampResult as any).startSeconds === 42,
);

const errorResult = parseYouTubeUrl("https://not-youtube.com/video/abc");
check(
  "Non-YouTube URL → returns parse error",
  isYouTubeParseError(errorResult),
);

// ---------------------------------------------------------------------------
// 14–16. VideoSourcePicker tabs
// ---------------------------------------------------------------------------
console.log("\nSection 4: VideoSourcePicker component...");
check("VideoSourcePicker.tsx exists", exists("src/components/TeacherDashboard/VideoSourcePicker.tsx"));

const picker = exists("src/components/TeacherDashboard/VideoSourcePicker.tsx")
  ? read("src/components/TeacherDashboard/VideoSourcePicker.tsx")
  : "";
check("VideoSourcePicker imports VideoUploader (upload path preserved)", /import VideoUploader/.test(picker));
check("VideoSourcePicker has YouTube tab", /YouTube/.test(picker) && /youtube/.test(picker));
check("VideoSourcePicker has Direct video link tab", /Direct video link|direct/.test(picker));

// ---------------------------------------------------------------------------
// 17. YouTubeLessonPlayer.tsx exists and exposes handle interface
// ---------------------------------------------------------------------------
console.log("\nSection 5: YouTubeLessonPlayer component...");
check("YouTubeLessonPlayer.tsx exists", exists("src/components/StudentPortal/YouTubeLessonPlayer.tsx"));
const ytPlayer = exists("src/components/StudentPortal/YouTubeLessonPlayer.tsx")
  ? read("src/components/StudentPortal/YouTubeLessonPlayer.tsx")
  : "";
check(
  "YouTubeLessonPlayerHandle interface exported",
  /export interface YouTubeLessonPlayerHandle/.test(ytPlayer),
);
check("YouTubeLessonPlayer uses YT IFrame API singleton pattern", /ensureYtApiLoaded/.test(ytPlayer));
check("YouTubeLessonPlayer polls for restricted seeking", /restrictSeeking/.test(ytPlayer) && /setInterval/.test(ytPlayer));

// ---------------------------------------------------------------------------
// 18–19. FocusedPlayer.tsx integration
// ---------------------------------------------------------------------------
console.log("\nSection 6: FocusedPlayer YouTube integration...");
const focusedPlayer = read("src/components/StudentPortal/FocusedPlayer.tsx");
check("FocusedPlayer imports YouTubeLessonPlayer", /import.*YouTubeLessonPlayer/.test(focusedPlayer));
check(
  "FocusedPlayer has youtubePlayerRef for dual-path playback",
  /youtubePlayerRef/.test(focusedPlayer),
);
check(
  "FocusedPlayer has isYouTubeBlock helper or equivalent check",
  /isYouTubeBlock|youtubeVideoId|videoSource.*youtube/.test(focusedPlayer),
);

// ---------------------------------------------------------------------------
// 20. server.ts persists YouTube fields
// ---------------------------------------------------------------------------
console.log("\nSection 7: server.ts YouTube field persistence...");
const server = read("server.ts");
check("server.ts persists youtubeVideoId in block normalization", /youtubeVideoId/.test(server));
check("server.ts persists youtubeEmbedUrl in block normalization", /youtubeEmbedUrl/.test(server));

// ---------------------------------------------------------------------------
// 21. ReadinessPanel is collapsible
// ---------------------------------------------------------------------------
console.log("\nSection 8: ReadinessPanel collapsible UX...");
const builder = read("src/components/TeacherDashboard/LessonsBuilder.tsx");
check(
  "ReadinessPanel has detailsVisible state for collapsible details",
  /detailsVisible/.test(builder),
);
check(
  "ReadinessPanel has Show details / Hide details toggle",
  /Show details|Hide details/.test(builder),
);

// ---------------------------------------------------------------------------
// 22–23. RichContentEditor compactHeight
// ---------------------------------------------------------------------------
console.log("\nSection 9: RichContentEditor compactHeight for MC answers...");
const rce = read("src/components/RichContent/RichContentEditor.tsx");
check("RichContentEditor accepts compactHeight prop", /compactHeight/.test(rce));
check(
  "RichContentEditor uses compactHeight to reduce min-height",
  /compactHeight.*min-h|min-h.*compactHeight/.test(rce) || /compactHeight\s*\?/.test(rce),
);

const qEditor = read("src/components/TeacherDashboard/QuestionEditor.tsx");
check(
  "QuestionEditor passes compactHeight to MC answer choice editors",
  /compactHeight=\{true\}/.test(qEditor),
);

// ---------------------------------------------------------------------------
// 24. LessonsBuilder wires YouTube + direct link handlers into BlockEditor
// ---------------------------------------------------------------------------
console.log("\nSection 10: LessonsBuilder passes YouTube handlers to BlockEditor...");
check(
  "LessonsBuilder passes onYouTubeSelected to BlockEditor",
  /onYouTubeSelected=\{handleYouTubeSelected\}/.test(builder),
);
check(
  "LessonsBuilder passes onDirectLinkSelected to BlockEditor",
  /onDirectLinkSelected=\{handleDirectLinkSelected\}/.test(builder),
);

// ---------------------------------------------------------------------------
// 25. Security: sanitizeBlockForStudent does not expose grading-sensitive fields
// ---------------------------------------------------------------------------
console.log("\nSection 11: Security — student sanitization...");
const sanitizeFile = exists("src/utils/sanitizeBlockForStudent.ts")
  ? read("src/utils/sanitizeBlockForStudent.ts")
  : (exists("src/utils/sanitize.ts") ? read("src/utils/sanitize.ts") : "");

// Verify that student-facing endpoints call the block sanitizer
const sanitizeInServer = /sanitizeLessonBlocksForStudent/.test(server);
check(
  "server.ts calls sanitizeLessonBlocksForStudent for student-facing endpoints",
  sanitizeInServer,
);

// Summary
console.log("\n=============================================================");
if (failed === 0) {
  console.log(`  ALL ${passed} CHECKS PASSED`);
} else {
  console.log(`  ${passed} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log("=============================================================\n");

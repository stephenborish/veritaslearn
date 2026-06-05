import { readFileSync } from "fs";
import { join } from "path";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

console.log("\n=== STUDENT READING LAYOUT & WORKSPACE VERIFICATION ===");

// 1. Check FocusedPlayer contains variant="student-reading" and max-w-[920px]
const focusedPlayer = read("src/components/StudentPortal/FocusedPlayer.tsx");
check(
  "FocusedPlayer uses variant=\"student-reading\" for reading blocks",
  focusedPlayer.includes("variant=\"student-reading\"")
);
check(
  "FocusedPlayer expands max-width to [920px] for wider content column",
  focusedPlayer.includes("max-w-[920px]")
);
check(
  "FocusedPlayer maintains responsive padding p-6 md:p-12",
  focusedPlayer.includes("p-6 md:p-12")
);

// 2. Check index.css has .student-reading-content styles
const indexCss = read("src/index.css");
check(
  "index.css defines .student-reading-content wrapper rules",
  indexCss.includes(".student-reading-content")
);
check(
  "index.css defines font-size 19px for .student-reading-content p",
  indexCss.includes(".student-reading-content p") && indexCss.includes("font-size: 19px !important;")
);
check(
  "index.css defines responsive image rules with max-width: 100%",
  indexCss.includes(".student-reading-content img") && indexCss.includes("max-width: 100% !important;")
);
check(
  "index.css keeps math/chemistry formulas readable inside .student-reading-content",
  indexCss.includes(".student-reading-content [data-lexical-formula]")
);
check(
  "index.css defines scrollable table layout rules",
  indexCss.includes(".student-reading-content table") && indexCss.includes("overflow-x: auto")
);

// 3. RichContentRenderer supports variant prop
const renderer = read("src/components/RichContent/RichContentRenderer.tsx");
check(
  "RichContentRenderer supports variant property",
  renderer.includes("variant?: \"default\" | \"student-reading\"")
);
check(
  "RichContentRenderer keeps default style distinct from student-reading variant",
  renderer.includes("prose prose-sm max-w-none")
);

// 4. Student UI sanitization is intact
const sanitize = read("server/data/sanitize.ts");
check(
  "Student sanitization file and correctness guards remain untouched",
  sanitize.includes("sanitizeQuestionForStudent") && sanitize.includes("SECRET_QUESTION_FIELDS")
);

// 5. Verification for scroll progress bar feature
check(
  "FocusedPlayer contains readingScrollPercent state for scrolling tracking",
  focusedPlayer.includes("readingScrollPercent") && focusedPlayer.includes("setReadingScrollPercent")
);
check(
  "FocusedPlayer implements handleReadingScroll list handler",
  focusedPlayer.includes("handleReadingScroll") && focusedPlayer.includes("onScroll={handleReadingScroll}")
);
check(
  "FocusedPlayer renders animated motion progress indicator using readingScrollPercent",
  focusedPlayer.includes("animate={{ width:") && focusedPlayer.includes("readingScrollPercent")
);
check(
  "FocusedPlayer includes student-reading-scroll-container class for scrolling",
  focusedPlayer.includes("student-reading-scroll-container")
);

// 6. Verification for smooth scroll and scroll-margin-top
check(
  "index.css defines student-reading-scroll-container with smooth scrolling behavior",
  indexCss.includes(".student-reading-scroll-container") && indexCss.includes("scroll-behavior: smooth !important;")
);
check(
  "index.css defines scroll-margin-top: 2rem !important; for inner layout elements",
  indexCss.includes("scroll-margin-top: 2rem !important;")
);

console.log("\n========================================================");
console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed.`);
console.log("========================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

# VERITAS Assess — Design System

> A teacher-centered classroom assessment platform. This design system contains the visual foundations, voice, and reusable UI components needed to design new screens, marketing, and prototypes that look and feel like a real VERITAS surface.

---

## 1. Product Context

**VERITAS Assess** ([veritas.courses](https://veritas.courses)) is a desktop-first web application that combines live questioning, metacognitive reflection, AI-supported feedback, student dossiers, and assessment analytics. It is built for the working teacher managing a real classroom — not for IT buyers, not for students at home, not for ed-tech demos.

The product has **two primary surfaces:**

| Surface | Audience | Tone |
|---|---|---|
| **Teacher app** (`/teacher/*`) | Approved teachers, signed in via Google | Calm academic workspace — dense, dark text on cool light surfaces, clear hierarchy, fast scanning |
| **Student delivery** (`/student/*`) | Students joining a live session via assessment code | Quiet test-mode focus — Noto Serif questions, large answer letters, minimal chrome |
| **Marketing / landing** (`/`) | Visitors choosing to teach or join | Warm parchment "paper" feel with a video background and a single primary action |

The teacher app contains: dashboard, courses & rosters, question-set editor, launch flow, live monitor, analytics, risk report, student dossier, admin panel.

Single source of design truth in the codebase is `src/index.css` plus the per-component `className`s. The Tailwind 4 `@theme` block at the top of that file is the canonical palette.

---

## 2. Source Materials

These are the inputs this design system was built from. If you have access, read them directly — they are richer than any summary.

- **Production app:** [https://veritas.courses](https://veritas.courses)
- **Main codebase (React + TS + Vite + Tailwind 4):** [github.com/stephenborish/veritas2.0](https://github.com/stephenborish/veritas2.0)
  - `src/index.css` — single source of truth for color / type / radius / shadow tokens
  - `AGENTS.md` — engineering rules, intentional patterns, security model
  - `src/components/teacher/*` — teacher surfaces (Dashboard, LiveMonitor, AnalyticsOverview, StudentDossier, QSetEditor)
  - `src/components/student/*` — assessment delivery, MC choices, reflection, summary
  - `src/components/LandingPage.tsx` — public marketing page with parchment + video bg
- **Brand asset repo:** [github.com/stephenborish/veritasassets](https://github.com/stephenborish/veritasassets) — currently school-specific (Malvern); not pulled in
- **Related repos worth browsing:** `stephenborish/atlas` (question bank tooling), `stephenborish/veritas` (legacy v1), `stephenborish/Quiz`

If you are reading this as a Claude Code skill (`/skills/veritas-design`), start with `colors_and_type.css`, then this README, then `ui_kit/index.html` for a working pattern reference.

---

## 3. Index

| Path | What it is |
|---|---|
| `colors_and_type.css` | Every color, font, radius, shadow token. **Import this first** from any artifact. |
| `fonts/ArialBlack.ttf` | Bundled Arial Black for answer-choice bubbles (Noto Serif / Outfit / Inter / Google Sans Code load from Google Fonts CDN). |
| `assets/veritas-logo.png` `-512.png` | Primary logo: navy rounded square, white V, gold dot. |
| `assets/apple-touch-icon.png`, `favicon-16.png` | Favicons. |
| `preview/*.html` | 25 small specimen cards driving the Design System tab. `_base.css` is shared. |
| `ui_kit/teacher/index.html` | Click-through prototype that wires together the four primary surfaces. **Open this to see the kit live.** |
| `ui_kit/teacher/*.jsx` | Modular React (Babel-standalone, no build step) recreations: `Sidebar`, `Dashboard`, `LiveMonitor`, `StudentAssessment`, `Landing`, plus `shared.jsx` for the `<Icon>` helper and mock data. |
| `ui_kit/teacher/styles.css` | Layout / hero / table / MC tile styles for the kit, all on top of `colors_and_type.css`. |
| `ui_kit/teacher/README.md` | Kit-level notes. |
| `SKILL.md` | Agent SKill front-matter so this folder can be loaded into Claude Code as a skill. |

---

## 4. Content Fundamentals — Voice & Copy

VERITAS sounds like an experienced teacher who runs assessments every week — direct, plainspoken, not marketing-y, not ed-tech-y, not AI-y.

### Voice principles

- **Direct and instructional.** Use teacher language: "What students understood," "Where students struggled," "Questions to review," "Confident wrong answers," "Student follow-up," "What to do next."
- **Plainspoken, not inflated.** Avoid: *pedagogical intelligence, mastery convergence, conceptual frictions, prescriptive plan, AI-powered insights, intelligent grading*. The product description never says "AI" to the teacher unless it's literally the AI-assisted grading workflow.
- **Honest about AI.** AI feedback is *factual and direct*. The codebase's prompt rules explicitly strip "Great job", "Good effort", and any "As an AI..." preamble. The system never compliments — it labels.
- **Pronouns.** Address the teacher as **you**. Refer to students in the third person (*"Where students struggled"* not *"Where you struggled"*). The student-facing test view uses **you** sparingly — only on actions ("Submit", "Continue").

### Casing & rhythm

- **Page titles / hero:** Title Case, sentence-case OK when it reads more naturally ("Welcome back, Sarah", "Today in VERITAS").
- **Section labels / eyebrows:** ALL CAPS, heavy letter-spacing (`0.18em`–`0.2em`), 9–11 px, weight 700–900. This is a VERITAS signature — used everywhere ("QUICK ACTION", "ACTIVE SESSION", "EXECUTIVE SUMMARY", "REAL-TIME SUMMARY").
- **Status pills:** ALL CAPS bold, semantic color ("LIVE", "ARCHIVED", "NEEDS GRADING", "ACCESSIBLE TO STUDENTS").
- **Buttons:** Sentence case for primary actions ("Launch session", "Open set", "Analyze"). Don't shout — the eyebrow above the button already shouts.
- **Body copy:** Sentence case, no Oxford comma drama either way.
- **Brand wordmark:** **VERITAS** (uppercase) followed by **Assess** (title case) as a sub-mark. Sometimes set as `VERITAS` 700 + `ASSESS` 10px 0.2em tracking on a line below.

### Emoji

- **Almost never.** The student reflection screen uses five emoji faces (😟 😐 😊 😎 🤩) for "Overall Experience" — that is the only sanctioned emoji surface. Do not add emoji to teacher UI, marketing, or assessment content.

### Vibe & sample copy

| Context | Example |
|---|---|
| Marketing hero | "Assessment that uncovers *the learning* behind every answer." (Outfit + Noto Serif italic copper) |
| Sub-hero | "VERITAS helps teachers run meaningful assessments, capture student confidence, surface misconceptions, and transform classroom responses into clear next steps for learning." |
| Dashboard greeting | "Welcome back, Sarah" / "Manage your sessions, review student analytics, and prepare high-trust assessments." |
| Stat eyebrow | "ACTIVE SESSION" |
| Stat value | "Assessment Live" / "System Idle" |
| Section subtitle | "Real-time summary" |
| Empty state | "No question sets created yet." / "Generate a weekly summary to get performance strategy insights." |
| AI digest section | "Executive Summary", "Common Errors", "At-Risk Interventions", "Strategy Recommendations" |
| Calibration buckets | "Sure & Right", "Sure & Wrong", "Unsure & Right", "Unsure & Wrong" |
| Reflection scale | "How confident are you in your answers?" / Uncertain → Certain |
| Auth gate | "Account Pending Approval — Your account has been successfully created, but you must be manually approved by an administrator before accessing the VERITAS ASSESS platform." |
| Student footer | "Your activity is recorded for your teacher." / "Use your school Google account to sign in." |

---

## 5. Visual Foundations

### Brand DNA

A **deep navy `#0C2340`** primary, a **gold `#FFD502`** dot, and a **Noto Serif** italic in **copper `#BE531C`** for the most romantic line of any page. That is the brand. Everything else supports.

The product feels like a leather-bound gradebook on a slate-blue desk: serious, considered, restrained, never childish.

### Color

The full palette is in `colors_and_type.css`. Three tiers:

1. **Brand palette** — Navy, Green, Gold, Plum, Lavender, Copper, Orange, Red, Coral, Gray. These name themselves and should never be renamed in code.
2. **Semantic** — `ok` (#15803d), `warn` (#c2410c), `bad` (#b91c1c), `info` (#1d4ed8). Status chips, dots, and table cells always use these — never raw palette colors.
3. **Surfaces** — cool slate (`#eef2fa` / `#f0f4f8` / `#e2e8f0`) for the app; **warm parchment (`#F5F1E8` / `#FAF8F3`)** for the public landing page only. Don't mix paradigms inside one screen.

Repeated color meanings across the app:

| Color | Meaning |
|---|---|
| Navy | Selected, active, primary action, MC question type |
| Plum | Short-answer (SA) question type |
| Green | Live / Accessible / Correct / OK |
| Gold | Accent only — logo dot, brand highlight, never a button |
| Amber 500 | Challenge level, partial credit, "unsure & right" |
| Red | Incorrect, lockout, destructive |
| Coral | Soft red — gentle warnings, badges |
| Purple-100 / 700 | AI-generated content (weekly digest, AI grading) |

### Typography

| Token | Family | Where |
|---|---|---|
| `--font-display` | **Outfit** 400/500/600/700 | Page titles, hero, section headers, button text |
| `--font-sans` | **Inter** 400/500/600/700 | UI body, labels, table cells, metadata |
| `--font-serif` | **Noto Serif** 400/500/700 + italic | Every piece of assessment content. Non-negotiable. |
| `--font-bubble` | **Arial Black** (bundled in `fonts/`) | Answer-choice letters A/B/C/D only |
| `--font-code` | **Google Sans Code** | Session codes (ABC123), monospace IDs |

Strict rules:

- Question text, stimulus text, passages, answer-choice text, short-answer prompts, and **the teacher's view of student-typed responses** all use Noto Serif. This is enforced in `src/index.css` with `!important`.
- Answer-choice letters use Arial Black 900. No exceptions. They sit in a 36×36 px rounded square with a 2px border.
- Heavy uppercase tracking (`0.18em`–`0.2em`, weight 800–900, 9–11 px) is the VERITAS eyebrow. Use it for labels, status badges, table headers, and "QUICK ACTION" callouts. Used everywhere — almost the whole app has an eyebrow.

### Spacing

A 4 px base. Common steps: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64. The teacher app is **dense but breathable** — cards padded 24 px (`p-6`) or 32 px (`p-8`), sections gapped 16 / 24 px, grids gapped 12 / 16 px. Never leave huge empty space "for breathing room."

Content frame: `max-width: 1440px`, horizontal pad 40 px, top 32 px, bottom 56 px.

### Backgrounds

- **App pages:** flat `#eef2fa` (cool light slate). No textures, no gradients on the page background.
- **Hero panels (in-app):** solid `#0C2340` navy, with a 1 px gradient stripe across the bottom (`palette-green` → `palette-gold`) and a giant `VA` watermark at `rgba(255,255,255,0.03)` in the bottom-right. This is the signature hero.
- **Landing page:** full-bleed muted video (`/landing.mp4` in production — substitute a still photo if no video), layered with a left-to-right **parchment gradient** (`rgba(245,241,232,0.98)` → `0.08`) and a slow diagonal sheen that sweeps once every 12 seconds.
- **Hand-drawn illustrations:** none. **Repeating patterns / textures:** none. **Gradients:** only the navy → blue brand hero (`linear-gradient(135deg, #0C2340 0%, #1e3a8a 100%)`) and the very subtle green→gold accent stripe. No bluish-purple gradients anywhere.

### Animation

Subtle and functional. The only motion library used is Motion (Framer). Patterns:

- **Page entry:** `fade-in` + `slide-in-from-bottom-6` over 500–1000 ms, easing `[0.22, 1, 0.36, 1]`.
- **Hover lift:** `translate-y -1` to `-4px` + shadow upgrade, 200 ms `ease`.
- **Active press:** `scale-[0.98]` or `scale-[0.95]` — never bigger.
- **Live indicators:** `animate-pulse` (2 s, opacity 1 → 0.5) on green dots for "Live session" / "Accessible to Students".
- **Skeletons:** `animate-pulse` on `bg-navy/[0.02]` rounded-2xl placeholders.
- **Landing sheen:** one diagonal white gradient sweep every ~12 s.
- **Background parallax (landing only):** mouse-tracked spring (`stiffness: 55, damping: 22`), max ±12 px translate.

No bounces, no spring overshoot, no confetti, no toasts that fly across the screen.

### Interactive states

- **Hover (cards):** lift `-translate-y-1` + shadow goes from `0 10px 24px rgba(15,23,42,0.08)` to `0 14px 32px rgba(12,35,64,0.14)`.
- **Hover (buttons):** `brightness-110` on filled buttons; `bg-navy/5` ghost layer on outline buttons.
- **Press:** `scale-[0.95]` to `scale-[0.98]`.
- **Focus:** `ring-[3px] ring-focus/20` + `border-focus` (focus = `#1d4ed8`). All inputs.
- **Disabled:** `opacity-50 cursor-not-allowed`.
- **Selected (MC choice):** navy fill, white text, white-translucent letter bubble, 4 px teal stripe on the right edge.
- **Eliminated (MC choice):** strikethrough text, opacity 40, navy/5 background, "Cross Out" toggle eye-off button.

### Borders, radii, shadows

| Token | Value | Where |
|---|---|---|
| `--radius-md` | 8 px | Inputs, small buttons |
| `--radius-lg` | 12 px | Default cards, inputs, tabs |
| `--radius-xl` | 16 px | Cards, panels, hero |
| `--radius-2xl` | 20 px | MC choice tiles, large modals |
| `--radius-pill` | 999 px | Status chips, pills |

- Card border: `1px solid #cbd5e1` (slate-300).
- Panel border: `1px solid #bfccde`.
- **Card shadow:** `0 10px 24px rgba(15, 23, 42, 0.08)` — the default everywhere.
- **Panel shadow:** `0 14px 30px rgba(15, 23, 42, 0.10)` — for hero / modal.
- **Sidebar shadow:** `4px 0 24px rgba(12,35,64,0.05)` — used on the collapsible sidebar.
- **Inset highlight on buttons:** `inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 2px rgba(15,23,42,0.08)` — gives buttons a faint top-light.

No "protection gradients" or "capsule" backdrops. Text on hero is plain white on solid navy.

### Layout rules

- **Sidebar (teacher app):** 256 px expanded, 80 px collapsed, sticky top-0, white, hairline border. Auto-collapses on Question Sets / Launch / Live / Analytics / Risk / Simulate to give those views the full width. This is intentional — do not change it.
- **Content frame** (everywhere else): `max-w-[1440px]` + `px-10 pt-8 pb-14`.
- **Live monitor:** full-bleed, no content frame. Tables go to the edges.
- **Modal:** centered, 460 px wide for forms, up to 720 px for content.

### Transparency, blur, color of imagery

- **Glass / blur:** `backdrop-filter: blur(10px)` on the landing "Teacher Login" pill and the student "join" card. Nowhere else.
- **Imagery:** the landing video is muted, warm-tinted by the parchment overlay; otherwise the app has no photography. If you add photos, choose warm desaturated palettes — never cool / saturated / "AI-rendered futuristic".
- **Translucent text:** `text-navy/40`, `text-navy/60` are used heavily for tier-2/3 ink — but the codebase overrides these to be darker (`#3F4F5F`, `#1A2E40`) for WCAG reasons. Honor that — never let "muted" mean "unreadable."

---

## 6. Iconography

VERITAS uses **[Lucide React](https://lucide.dev)** exclusively. Stroke style, 1.5 px stroke (Lucide default), `currentColor`. Loaded via `lucide-react` in the codebase; for prototypes, load Lucide via CDN: `https://unpkg.com/lucide@latest`.

### Patterns

- **Sizing:** small `w-3.5 h-3.5` (14 px) inside chips; default `w-4 h-4` (16 px) inline; `w-5 h-5` (20 px) in sidebar nav and primary buttons; `w-6 h-6` to `w-8 h-8` in heroes.
- **Color:** always inherits text color (`currentColor`). Status icons take semantic color (`text-ok`, `text-bad`).
- **Background:** icons sit on a 32×32 px rounded square (`p-1.5 bg-navy/5 rounded-lg`) when they label a section header.
- **Active-session timer icon** uses `animate-pulse` to communicate "live".

### Common Lucide icons used by VERITAS

| Surface | Icons |
|---|---|
| Sidebar nav | `LayoutDashboard`, `Library`, `PlusCircle`, `Rocket`, `BarChart3`, `ShieldAlert`, `FlaskConical`, `Settings`, `LogOut`, `ChevronLeft/Right` |
| Dashboard | `Timer`, `Sparkles` (AI digest), `GraduationCap`, `History`, `Loader2`, `AlertCircle`, `Users` |
| Live monitor | `Eye`, `EyeOff`, `Pause`, `Play`, `Lock`, `Unlock`, `MessageSquare`, `RefreshCw` |
| Status / grading | `CheckCircle2` (correct), `XCircle` (incorrect), `HelpCircle` (needs grading), `Minus` (no response), `BrainCircuit` (reflection) |
| Student / auth | `ShieldCheck`, `Lock`, `Hash`, `ArrowRight`, `Star` |

### What is NOT used

- **No emoji** except the 5 reflection faces (😟 😐 😊 😎 🤩).
- **No icon fonts** (Material, Font Awesome). Lucide only.
- **No PNG icons.** All icons are SVG via lucide-react.
- **No hand-drawn or illustrated icons.** No mascot.
- **No unicode symbols** standing in for icons — except `~` for "partial credit" in the answer grid status cells.

### Logos / favicons

`assets/veritas-logo.png` is the primary logo (also used in the sidebar). `assets/apple-touch-icon.png` and `assets/favicon-16.png` are the favicons. `assets/veritas-logo-512.png` is the OG / PWA icon (deep navy field, white V, gold dot). There is no horizontal wordmark in the codebase — the wordmark is built from text (Outfit 700 "VERITAS" + 0.2em tracking sub-label "ASSESS"). assets/veritas-logo-512.png is the OG / PWA icon (deep navy field, white V, gold dot). There is no horizontal wordmark in the codebase — the wordmark is built from text (Outfit 700 "VERITAS" + 0.2em tracking sub-label "ASSESS").

---

## 7. Caveats & known substitutions

- **Noto Serif zip was not present** in uploads, so Noto Serif is loaded from Google Fonts at runtime. If you need it bundled, drop a `.ttf` / `.woff2` into `fonts/` and add a matching `@font-face`.
- **Outfit, Inter, Google Sans Code** are also loaded from Google Fonts CDN — same as the production app.
- **Arial Black** is bundled locally as `fonts/ArialBlack.ttf` (uploaded by the user as `ariblk.ttf`).
- **No production photography or marketing video** is included. The landing-page mock falls back to a still parchment background; in production this slot holds `/landing.mp4`.
- **The `veritasassets` repo** contains Malvern-school-specific logos; not relevant to the brand system, not imported.

- Analytics surfaces include deterministic grading-state status cards (Ungraded, AI Suggested, Teacher Confirmed, Manually Adjusted, Partial-Credit Finalized, Failed/Pending) with drill-down filtering in detailed session review.
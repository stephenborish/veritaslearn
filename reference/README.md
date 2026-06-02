<div align="center">
  <img width="1200" height="475" alt="VERITAS banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>
# VERITAS Assess
**VERITAS** is an assessment platform designed for serious classroom use: secure delivery, metacognitive reflection, live monitoring, analytics, short-answer grading, and student-level performance review in one integrated system. VERITAS is built to help teachers see how students are thinking, where confidence and correctness diverge, and which responses need instructional follow-up.
---
## Project Philosophy
VERITAS is built around a simple instructional belief:

A useful assessment platform should show not only what students got right or wrong, but what their answers reveal about understanding, confidence, misconception, and readiness for the next lesson.

The platform is intended to help teachers make better instructional decisions with less friction.
---
## Core Purpose
VERITAS Assess supports classroom assessments that are:
- **Secure enough for real testing**
- **Flexible enough for daily classroom use**
- **Insightful enough to inform teaching**
- **Readable and polished enough for students and teachers**
- **Designed around student thinking, not just scores**
The platform combines traditional assessment delivery with metacognitive data, live teacher oversight, expandable analytics, and review workflows for grading and re-scoring student work.
---
## Key Features
### Teacher Assessment Workflow
Teachers can create, manage, launch, monitor, and review assessments through a dedicated teacher interface.
Supported assessment tools include:
- Question set creation and organization
- Multiple-choice and short-answer questions
- Standard short-answer and AI-assisted grading workflows
- Randomized and lockstep delivery modes
- Category-based question selection
- Assessment launch controls
- Session monitoring
- Student response review
- Manual score adjustment and re-scoring
- Post-assessment analytics
---
### Student Assessment Experience
Students receive an individualized assessment experience with support for:
- Secure session joining
- Teacher-issued session codes or individualized links
- Clean question presentation
- Multiple-choice and short-answer response entry
- Optional metacognitive reflection after each question
- One-way navigation when enabled
- Lockstep teacher-paced delivery when enabled
- Final submission and post-assessment review when allowed
Assessment question text, stimuli, and answer content are intended to render in a readable academic style, with careful attention to typography and spacing.
---
### Metacognition
A major design goal of VERITAS is to capture not only whether a student was correct, but how confident the student was while answering.
This allows teachers to distinguish between:
- Correct and confident understanding
- Correct but uncertain guessing
- Incorrect but confident misconceptions
- Incorrect and uncertain knowledge gaps
That distinction is central to the instructional value of the platform.
---
### Analytics and Student Dossiers
VERITAS is designed to give teachers actionable, student-level data after and during assessment sessions.
Analytics areas include:
- Assessment-level performance
- Item-level performance
- Student-level summaries
- Confidence versus correctness patterns
- Risk and security signals
- Short-answer grading status
- Expandable student response reports
- Manual grading and score correction workflows
The student dossier is intended to function as the central place for reviewing a student’s complete assessment record, including answers, scores, confidence data, teacher overrides, and grading decisions.
---
### Security and Live Monitoring
VERITAS includes classroom-oriented monitoring and proctoring features such as:
- Live session status
- Student progress tracking
- Fullscreen and tab-switch event detection
- Re-entry control workflows
- Teacher visibility into suspicious activity
- Risk reporting for post-assessment review
These features are designed to support teacher awareness, not to replace professional judgment.
---
## Design Principles
VERITAS follows a restrained academic design language:
- Clear hierarchy
- High contrast
- Dense but readable layouts
- Professional teacher-facing screens
- Polished student-facing assessment views
- Minimal visual clutter
- Strong typography rules for assessment content
- Responsive desktop-first layout
Important visual expectations:
- Assessment questions, stimuli, and answer text should use **Noto Serif**
- Answer choice letters should use **Arial Black**
- Teacher interface text should prioritize readability and scannability
- The app is designed primarily for desktop and classroom devices, not mobile-first use
---
## Technology Stack
This version of VERITAS is built as a modern TypeScript web application.
Typical stack components include:
- React
- TypeScript
- Vite
- Firebase / Firestore
- Firebase Authentication
- Cloud-based deployment
- Gemini API integration for AI-assisted workflows
Exact implementation details may vary as the application evolves.
---
## Local Development
### Prerequisites
Make sure you have the following installed:
- Node.js
- npm
You will also need any required environment variables for authentication, database access, and AI-assisted features.
---
### Install Dependencies
```bash
npm install

⸻

Configure Environment Variables

Create or update a local environment file:

.env.local

At minimum, the AI-assisted features require a Gemini API key:

GEMINI_API_KEY=your_gemini_api_key_here

Depending on the current implementation, additional Firebase or deployment-related variables may also be required.

⸻

Run the Development Server

npm run dev

The local development server will usually provide a localhost URL in the terminal.

⸻

Available Scripts

Common scripts may include:

npm run dev

Start the local development server.

npm run build

Create a production build.

npm run preview

Preview the production build locally.

npm test

Run the test suite, if configured.

⸻

Deployment

VERITAS may be deployed through a cloud hosting workflow such as Firebase Hosting, Google Cloud Run, or another production hosting environment.

Production deployments should ensure that:

* Authentication is correctly configured
* Database rules are secure
* Environment variables are present
* Student links resolve to the production domain
* Email workflows use the correct production sender identity
* AI grading endpoints are protected
* Assessment sessions cannot expose unauthorized student data

⸻

Production Identity

Current production-facing identity values should be kept consistent across the app and any deployment configuration:

Domain: veritas.courses
Production URL: https://veritas.courses
Visible From Address: VERITAS Assess <noreply@veritas.courses>
SMTP/Auth Mailbox: email@veritas.courses

Student-facing assessment links should always resolve to the production URL when sent from production workflows.

⸻

Development Priorities

Current development priorities include:

* Reliable response saving
* Consistent randomized assessment behavior
* Correct metacognition handling
* Stable lockstep mode
* Durable short-answer grading workflows
* Accurate score recalculation after teacher edits
* Fully integrated analytics and student dossiers
* Clear teacher navigation
* Professional visual polish
* Robust post-assessment share results

Reliability takes priority over new feature expansion.

⸻

Engineering Rules

Several parts of VERITAS are assessment-critical. Changes should preserve data integrity and avoid shortcuts that could lose student work.

Important rules:

* Do not bypass the submission queue for student answers.
* Flush the latest local answer state before navigation, lockout, timer expiry, session end, or final submission.
* Do not gate answer flushing on stale submitted-answer state.
* Keep canonical question IDs separate from displayed question numbers.
* Handle randomized and non-randomized sessions consistently.
* Keep score calculations synchronized after manual edits, AI grading, or re-grading.
* Make teacher-facing grading changes update student scores, class averages, item analysis, and share results consistently.
* Avoid adding new features during reliability stabilization unless directly required to fix a core workflow.

⸻

AI-Assisted Grading

VERITAS may support AI-assisted short-answer grading. This should be treated as a teacher-support workflow, not a replacement for teacher review.

Expected behavior:

* AI grading should be transparent to the teacher.
* Teachers should be able to override AI-generated scores.
* Manual overrides should persist.
* Identical accepted short-answer responses may be reused for consistent grading when appropriate.
* Score recalculations should remain consistent after AI grading, manual grading, and re-grading.

⸻

AI Studio

This project originated from an AI Studio app scaffold.

View the app in AI Studio:

https://ai.studio/apps/19aa80fa-e2ec-4d01-981d-d77697aa83f4

The default scaffold has been replaced with a production-oriented assessment platform structure.

⸻

Repository Status

This project is under active development. Some features may still be in stabilization, migration, or redesign.

Before making major changes, inspect the current codebase, verify the active branch and remote, and confirm that the implementation matches the latest production architecture.

⸻

License

Private / internal project unless otherwise specified.
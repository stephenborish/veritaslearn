# VERITAS Learn

Assessment that uncovers the learning behind every answer. A full-stack learning management system for designing lessons, guiding practice, scoring short-answer responses with AI, and reviewing student thinking.

---

## Local Development

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your values:
   ```
   cp .env.example .env.local
   ```
   At minimum, set `GEMINI_API_KEY` for AI grading to work.

3. Run the development server:
   ```
   npm run dev
   ```

   The app runs on [http://localhost:3000](http://localhost:3000).

---

## Build & Production

```
npm run build     # Builds frontend (Vite) + bundles backend (esbuild)
npm start         # Runs the production bundle
```

The production bundle is `dist/server.cjs`. The frontend SPA is served as static files from `dist/`.

---

## Environment Variables

See `.env.example` for all supported variables. Key ones:

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | AI grading (required) | — |
| `APP_URL` | App base URL for OAuth + links | `https://learn.veritas.courses` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | same as APP_URL |
| `GOOGLE_ALLOWED_DOMAIN` | School domain for sign-in restriction | `malvernprep.org` |
| `TEACHER_EMAILS` | Comma-separated teacher email list | `stephenborish@gmail.com` |
| `AI_GRADING_MODEL` | Gemini model for AI grading | `gemini-2.0-flash` |

---

## Deploying to `https://learn.veritas.courses`

The steps below require actions **outside** this repository — in Firebase Console, your DNS provider, and your hosting platform. Code changes alone cannot complete these steps.

### 1. Firebase Console — Add Authorized Domain

> **Required before Google Sign-In will work at the custom domain.**

1. Go to [Firebase Console](https://console.firebase.google.com/) → your project.
2. Navigate to **Authentication** → **Settings** → **Authorized domains**.
3. Add `learn.veritas.courses`.
4. Save.

Without this step, the Google OAuth popup will show an `auth/unauthorized-domain` error.

### 2. Firebase Console — OAuth Redirect URIs

1. In Firebase Console, go to **Authentication** → **Sign-in method** → **Google**.
2. Verify the redirect URI list includes `https://learn.veritas.courses/__/auth/handler`.
   This is usually auto-handled by Firebase Hosting but should be confirmed.

### 3. DNS Configuration

Point `learn.veritas.courses` to your hosting provider:

- For **Google Cloud Run**: Add a CNAME or A record per [Cloud Run custom domain docs](https://cloud.google.com/run/docs/mapping-custom-domains).
- For **Firebase Hosting**: Add a CNAME or A record per [Firebase Hosting custom domain docs](https://firebase.google.com/docs/hosting/custom-domain).
- Wait for DNS propagation (minutes to hours).

### 4. Hosting Provider — Custom Domain Setup

Configure the custom domain in your hosting dashboard (Cloud Run, Firebase Hosting, etc.) and obtain a TLS certificate. Most providers handle TLS automatically via Let's Encrypt.

### 5. Set Production Environment Variables

In your hosting platform's environment configuration (Cloud Run secrets, Firebase Hosting env, etc.):

```
APP_URL=https://learn.veritas.courses
PUBLIC_APP_URL=https://learn.veritas.courses
ALLOWED_ORIGINS=https://learn.veritas.courses
GOOGLE_ALLOWED_DOMAIN=malvernprep.org
TEACHER_EMAILS=stephenborish@gmail.com
GEMINI_API_KEY=<your-gemini-key>
```

### 6. Redeploy

After setting env vars:
```
npm run build
# deploy dist/ to your platform
```

### 7. Verification Checklist

- [ ] `https://learn.veritas.courses` loads the landing page (not a certificate error)
- [ ] Teacher sign-in with Google completes without `auth/unauthorized-domain`
- [ ] After teacher sign-in, teacher dashboard loads
- [ ] Student can enter a course code, sign in with Google, and lands on student dashboard
- [ ] Student course code creates an enrollment (check Firestore `enrollments` collection)
- [ ] CORS: API calls from the browser don't show blocked-origin errors in the console
- [ ] AI grading works for short-answer submissions (check `GEMINI_API_KEY`)

---

## Architecture

- **Frontend**: React 19 + TypeScript + Vite SPA
- **Backend**: Express (Node.js) serving the same origin as the frontend
- **Database**: Firestore (primary) + local JSON fallback (`/data/db.json`)
- **Auth**: Firebase Google Auth (client) + Firebase Admin SDK JWT verification (server)
- **AI Grading**: Google Gemini API (`gemini-2.0-flash` by default)
- **Student Enrollment**: `POST /api/enrollments/join` with a course join code

Student data sanitization is enforced server-side in `server/data/sanitize.ts`. Answer keys, rubrics, model answers, and AI scoring guidance are never sent to student clients.

---

## Student Course-Code Join Flow

1. Student visits the landing page.
2. Student enters a course code in the Students section.
3. App stores the code in `sessionStorage` (key: `veritas_pending_course_code`).
4. Student signs in with Google.
5. After successful auth, App checks `sessionStorage` for the pending code.
6. If found, App calls `POST /api/enrollments/join` with the code.
7. On success: enrollment is created, student dashboard shows the course.
8. Code is cleared from `sessionStorage` regardless of outcome.

The pending code cannot bypass authentication. It is only used after the student has successfully authenticated. A student cannot gain teacher privileges through this flow.

---

## Grading Model

### Practice vs Assessment

Every question block and video checkpoint is authored as either **Practice** or **Graded** (Assessment). This is set by `LessonBlock.isPractice` or `VideoCheckpoint.isPractice` in the lesson definition.

| | Practice | Graded (Assessment) |
|---|---|---|
| Feedback shown to student | Yes — immediately after AI grades | No — teacher-only |
| MC correctness shown | Yes | No |
| Score shown to student | Yes (after AI grades) | No |
| Counts toward lesson score | No | Yes |
| Teacher can see score | Yes | Yes |

### AI Grading Lifecycle (Short Answer)

1. Student submits SA response → `AIGradingRecord` created with `status: "pending"`.
2. Gemini grades asynchronously (student is not blocked).
3. On success: score and `feedback` (student-safe) are stored. For practice responses, feedback is released to the student immediately. For assessment responses, feedback is stored but hidden from the student.
4. When `confidence < 0.75`, `needsTeacherReview: true`, or the response is flagged as low-effort: status becomes `"needs_review"` and the teacher must grade manually.
5. On error: status → `"needs_review"`, teacher grades via the AI Review queue.

### AI Rubric Generation

Teachers can generate a rubric for a short-answer question via the Question Editor. The AI suggests rubric categories, point values, and a model answer. Teachers review and edit before saving. Iterative revision is supported.

### Gradebook Entries

Two types of `GradebookEntry` records are created per submission:
- **Response-level**: one per submitted response (tracks per-question scoring status).
- **Attempt-level summary**: one per attempt/assignment (tracks overall score, percent, and rollup status).

The `Gradebook.tsx` view reads the attempt-level summary entry.

---

## Security: Student-Visible vs Teacher-Only Data

Server-side sanitizers in `server/data/sanitize.ts` enforce this boundary:

**Never sent to students:**
- MC correct answer (`correctChoiceId`, `correctAnswerIndex`)
- MC explanation (except for practice after correct submission)
- SA rubric categories, model answer, answer key, AI scoring guidance
- AI grading rationale and teacher notes
- Assessment response scores and feedback
- Internal integrity review flags on attempts

**Sanitizers used at every student-facing API endpoint:**
- `sanitizeQuestionForStudent` — strips answer keys from questions
- `sanitizeResponseForStudent` — hides assessment scores; shows practice feedback only when released
- `sanitizeAiGradingForStudent` — exposes student-safe AI feedback only
- `sanitizeAttemptForStudent` — strips security review flags
- `sanitizeGradebookEntryForStudent` — hides scores unless explicitly released

---

## AI Studio

This app was originally created in Google AI Studio:
https://ai.studio/apps/15bbc4b2-c4f5-427c-aaa8-2be2d7b992f6

AI Studio automatically injects `GEMINI_API_KEY` at runtime from user secrets.
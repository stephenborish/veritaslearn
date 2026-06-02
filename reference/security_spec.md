# Veritas 2.0 Security Specification

## 1. Data Invariants
- **Course Ownership**: A `Course` must be created by a verified teacher. Only that teacher can modify or delete it.
- **Session Integrity**: A `Session` belongs to a teacher. Students can only access active sessions.
- **Student Privacy**: Students can only read/write their own `StudentSession`, `Response`, `Metacognition`, and `Violation` records. Teachers can read all records for sessions they own.
- **Audit Immutable**: `ActionLog` and `TimerEvent` entries are immutable once created.
- **Grading Lockdown**: Only teachers can update `points`, `isCorrect`, and `feedback` in `Response` documents. Students can only update the `answer` if the session is `active`.

## 2. The "Dirty Dozen" Payloads (Red Team Test Cases)

1. **Identity Spoofing (StudentSession)**: Student A tries to create a `StudentSession` with `studentId` of Student B.
2. **State Shortcutting (Session)**: Student tries to update a `Session` status to `active`.
3. **Privilege Escalation (Course)**: Student B tries to update Student A's `Course` name.
4. **Grading Injection**: Student tries to set `points: 100` on their own `Response`.
5. **Session Scavenging**: User tries to list all `sessions` without a specific code or teacher UID.
6. **Immutable Tampering**: User tries to update `createdAt` on any document.
7. **Orphaned Writes**: Student tries to submit a `Response` for a session that doesn't exist or is `ended`.
8. **Ghost Field Injection**: User tries to add `isVerified: true` to a profile or session document.
9. **PII Leakage**: Student A tries to `get` the email of Student B from `StudentSession`.
10. **ID Poisoning**: User tries to create a document with a 2MB string as its ID.
11. **Metacognitive Spam**: Student tries to submit a `Metacognition` rating of `10` (valid range 1-4).
12. **Teacher Whitelist bypass**: Non-approved teacher tries to create a `Course`.

## 3. Test Runner (Conceptual)
The `firestore.rules.test.ts` will verify these cases using the Firebase Security Rules emulator. Every test should return `PERMISSION_DENIED` for these payloads.

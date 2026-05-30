# VERITAS Learn — Firestore Security Rule Specification & Hardened Invariants

This document outlines structural rules, academic integrity assertions, and security test gates protecting Malvern Prep learning materials from unauthorized student lookup and bypass.

---

## 1. Data Invariants & Relational Sync Rules

1. **Lesson Integrity**: Lessons and sequential teaching blocks can only be written, structured, published, or deleted by verified Faculty members. Students have strict read-only access to published lessons.
2. **Key Exclusions (No Leakage)**: Answer keys and explanations for **Graded Checkpoints and Quizzes** must remain on-server. They are sanitized before students read lessons, and their correct answers are locked inside firestore write validations.
3. **Progress Locking (No Forward Video Skipping)**: Student attempts track `furthestVideoTimestamps`. Any forward jump exceeding 2 seconds relative to previously verified times is blocked and recorded in `securitySignals`.
4. **Isolated Submissions**: A student can only submit responses for questions *assigned to their unique anonymous attempt seed*, preventing answer theft. No student can edit other students' dossiers.

---

## 2. The "Dirty Dozen" Adversarial Payloads

Below are twelve high-risk payloads designed to test rules against Identity, Integrity, and State bypasses:

1. **Payload 1: Unauthenticated Lesson Hijacking**
   * Attempt: Write directly to `/lessons/lesson_1` as a visitor with no token.
   * Expectation: `PERMISSION_DENIED`.
2. **Payload 2: Student Overriding Admin Settings**
   * Attempt: Update `/lessons/lesson_1/settings/restrictSeeking` to `false` with a student account.
   * Expectation: `PERMISSION_DENIED`.
3. **Payload 3: Score Spoofing Intervention**
   * Attempt: Submit `/responses/resp_test` setting `score: 100`, skipping AI evaluation.
   * Expectation: `PERMISSION_DENIED`.
4. **Payload 4: Adversarial Dossier Read**
   * Attempt: Non-owner student reads another student's `/attempts/attempt_2`.
   * Expectation: `PERMISSION_DENIED`.
5. **Payload 5: Security Signal Sabotage**
   * Attempt: Delete a high-priority security telemetry log from `/securitySignals/sig_2`.
   * Expectation: `PERMISSION_DENIED`.
6. **Payload 6: Domain Impersonation Registration**
   * Attempt: Create a `/users/user_fake` profile with an unauthorized domain name like `@gmail.com` trying to grant teacher role.
   * Expectation: `PERMISSION_DENIED`.
7. **Payload 7: Video Skip Spoofing Write**
   * Attempt: Update attempt video timestamps 300 seconds forward directly.
   * Expectation: `PERMISSION_DENIED`.
8. **Payload 8: Self-Grader Privilege Escalation**
   * Attempt: Set a teacher override on a personal short-answer response.
   * Expectation: `PERMISSION_DENIED`.
9. **Payload 9: Ghost Field Poisoning**
   * Attempt: Inject `isTeacher: true` into student configuration metadata.
   * Expectation: `PERMISSION_DENIED`.
10. **Payload 10: Assignment Leakage Harvesting**
    * Attempt: Retrieve other classrooms' randomized exam layouts.
    * Expectation: `PERMISSION_DENIED`.
11. **Payload 11: Course Code Forgery**
    * Attempt: Modify active APUSH code parameters.
    * Expectation: `PERMISSION_DENIED`.
12. **Payload 12: Absolute Lockout Attack**
    * Attempt: Modify the admin registry to lock teachers out.
    * Expectation: `PERMISSION_DENIED`.

---

## 3. Fortress Rule Blueprint (DRAFT_firestore.rules)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Default Catch-All Deny Net
    match /{document=**} {
      allow read, write: if false;
    }
    
    // Core custom functions
    function isSignedIn() {
      return request.auth != null;
    }
    
    function emailVerified() {
      return request.auth.token.email_verified == true;
    }

    function isTeacher() {
      return isSignedIn() && (
        request.auth.token.email == "stephenborish@gmail.com" || 
        request.auth.token.email.matches(".*\\+teacher@malvernprep\\.org$")
      );
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    // Rules matching each collection mapping
    match /users/{userId} {
      allow read: if isSignedIn();
      allow create, update: if isTeacher() || isOwner(userId);
    }

    match /courses/{courseId} {
      allow read: if isSignedIn();
      allow write: if isTeacher();
    }

    match /lessons/{lessonId} {
      allow read: if isSignedIn();
      allow write: if isTeacher();
    }

    match /blocks/{blockId} {
      allow read: if isSignedIn();
      allow write: if isTeacher();
    }

    match /attempts/{attemptId} {
      allow read: if isTeacher() || (isSignedIn() && resource.data.studentId == request.auth.uid);
      allow create: if isSignedIn();
      allow update: if isTeacher() || (isSignedIn() && resource.data.studentId == request.auth.uid);
    }

    match /assignments/{assignmentId} {
      allow read: if isTeacher() || (isSignedIn() && resource.data.studentId == request.auth.uid);
      allow write: if isTeacher() || (isSignedIn() && request.resource.data.studentId == request.auth.uid);
    }

    match /responses/{responseId} {
      allow read: if isTeacher() || (isSignedIn() && resource.data.studentId == request.auth.uid);
      allow write: if isTeacher() || (isSignedIn() && request.resource.data.studentId == request.auth.uid);
    }

    match /securitySignals/{signalId} {
      allow read: if isTeacher();
      allow create: if isSignedIn();
      allow update, delete: if isTeacher();
    }
  }
}
```

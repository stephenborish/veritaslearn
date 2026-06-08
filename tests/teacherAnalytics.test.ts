import { describe, it, expect } from "vitest";
import {
  deriveIntegritySignalSummary,
  buildIntegrityMarkers,
  signalEventLabel,
} from "../src/lib/integritySignals";
import {
  getLessonMaxPoints,
  getAttemptEarnedPoints,
  pickAttempt,
  deriveStudentAssignmentSummary,
  deriveReviewPriority,
} from "../src/lib/teacherAnalytics";
import {
  deriveCourseProgressSummary,
  deriveReviewQueueItems,
} from "../src/lib/courseProgress";

function sig(eventType: string, extra: any = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    attemptId: "att1",
    studentId: "stu1",
    timestamp: new Date().toISOString(),
    eventType,
    severity: "low",
    ...extra,
  };
}

describe("integrity signal engine", () => {
  it("returns a calm summary when there are no signals (scenario 13)", () => {
    const s = deriveIntegritySignalSummary([]);
    expect(s.attentionLevel).toBe("none");
    expect(s.responseReliability).toBe("high");
    expect(s.reviewRecommended).toBe(false);
    expect(s.clusters).toHaveLength(0);
  });

  it("treats one fullscreen exit as low attention (scenario 14)", () => {
    const s = deriveIntegritySignalSummary([sig("fullscreen_exit", { blockId: "b1" })]);
    expect(s.attentionLevel).toBe("low");
    expect(s.responseReliability).toBe("high");
    expect(s.fullscreenSignalCount).toBe(1);
  });

  it("escalates repeated fullscreen exits to moderate (scenario 15)", () => {
    const s = deriveIntegritySignalSummary([
      sig("fullscreen_exit", { blockId: "b1" }),
      sig("fullscreen_exit", { blockId: "b1" }),
      sig("fullscreen_exit", { blockId: "b1" }),
      sig("fullscreen_exit", { blockId: "b1" }),
    ]);
    expect(s.attentionLevel).toBe("moderate");
    expect(s.responseReliability).toBe("moderate");
    expect(s.repeatedEventCount).toBeGreaterThanOrEqual(4);
  });

  it("treats one tab change as low (scenario 16)", () => {
    const s = deriveIntegritySignalSummary([sig("visibilitychange", { blockId: "b1" })]);
    expect(s.attentionLevel).toBe("low");
  });

  it("flags AI Guard marker in response as high / needs_review / AI agent (scenarios 18-20)", () => {
    for (const evt of [
      "ai_guard_marker_in_answer",
      "hidden_assessment_text_in_answer",
      "ai_guard_refusal_phrase_in_answer",
    ]) {
      const s = deriveIntegritySignalSummary([sig(evt, { blockId: "b1", severity: "high" })]);
      expect(s.attentionLevel).toBe("high");
      expect(s.responseReliability).toBe("needs_review");
      expect(s.aiAgentSignalCount).toBe(1);
      expect(s.evidenceStrength).toBe("strong");
      const markers = buildIntegrityMarkers(s, { studentId: "stu1" });
      expect(markers.some((m) => m.type === "ai_agent" && m.level === "high")).toBe(true);
    }
  });

  it("clusters signals across multiple steps (scenario 21)", () => {
    const s = deriveIntegritySignalSummary([
      sig("fullscreen_exit", { blockId: "b1" }),
      sig("blur_focus_lost", { blockId: "b2" }),
      sig("visibilitychange", { blockId: "b3" }),
    ]);
    expect(s.affectedStepIds.length).toBeGreaterThanOrEqual(3);
    expect(s.clusters.length).toBeGreaterThanOrEqual(3);
  });

  it("escalates focus changes clustered near a submission (scenario 17)", () => {
    const now = Date.now();
    const submittedAt = new Date(now).toISOString();
    const s = deriveIntegritySignalSummary(
      [
        sig("blur_focus_lost", { blockId: "b1", timestamp: new Date(now - 5000).toISOString() }),
        sig("blur_focus_lost", { blockId: "b1", timestamp: new Date(now - 3000).toISOString() }),
      ],
      { responsesByStep: { b1: { responseId: "r1", submittedAt } } }
    );
    expect(["moderate", "high"]).toContain(s.attentionLevel);
  });

  it("ignores pure status events like checkpoint_triggered", () => {
    const s = deriveIntegritySignalSummary([sig("checkpoint_triggered", { blockId: "b1" })]);
    expect(s.attentionLevel).toBe("none");
    expect(s.clusters).toHaveLength(0);
  });

  it("has friendly labels and never raw underscores for known events", () => {
    expect(signalEventLabel("fullscreen_exit")).toBe("Fullscreen exited");
    expect(signalEventLabel("possible_ai_agent_use")).toBe("Possible AI agent use");
    expect(signalEventLabel("weird_unknown")).toBe("weird unknown");
  });
});

describe("score + attempt helpers", () => {
  const blocks = [
    { id: "b1", lessonId: "L1", order: 0, type: "question", questionType: "mc", singleQuestion: { id: "q1", points: 2 } },
    { id: "b2", lessonId: "L1", order: 1, type: "question", questionType: "sa", isPractice: true, singleQuestion: { id: "q2", points: 5 } },
    { id: "b3", lessonId: "L1", order: 2, type: "question", questionType: "sa", singleQuestion: { id: "q3", points: 3 } },
  ];

  it("sums assessment points and excludes practice (scenario 32 defensive)", () => {
    expect(getLessonMaxPoints(blocks)).toBe(5);
    expect(getLessonMaxPoints([])).toBe(0);
  });

  it("sums earned points excluding practice responses", () => {
    const responses = [
      { attemptId: "a1", score: 2, gradingMode: "assessment" },
      { attemptId: "a1", score: 5, gradingMode: "practice" },
      { attemptId: "a1", teacherOverrideScore: 3, score: 1, gradingMode: "assessment" },
    ];
    expect(getAttemptEarnedPoints("a1", responses)).toBe(5);
  });

  it("excludes preview attempts by default (scenario 39)", () => {
    const attempts = [
      { id: "preview", studentId: "s1", lessonId: "L1", isPreviewAttempt: true, status: "completed" },
      { id: "real", studentId: "s1", lessonId: "L1", status: "in_progress", lastActiveAt: new Date().toISOString() },
    ];
    expect(pickAttempt(attempts, "s1", "L1")?.id).toBe("real");
    expect(pickAttempt(attempts, "s1", "L1", { includePreview: true })).not.toBeNull();
  });
});

describe("student assignment summary + review queue", () => {
  const lesson = { id: "L1", title: "Photosynthesis", courseId: "C1" };
  const assignment = { id: "AS1", lessonId: "L1", courseId: "C1", dueAt: new Date().toISOString() };
  const blocks = [
    { id: "b1", lessonId: "L1", order: 0, type: "question", questionType: "sa", singleQuestion: { id: "q1", points: 4 } },
  ];

  it("marks not started when there is no attempt (scenario 25/26)", () => {
    const summary = deriveStudentAssignmentSummary({
      student: { id: "s1", name: "Ada", email: "ada@x.edu" },
      lesson,
      assignment,
      blocks,
      attempts: [],
      responses: [],
      signals: [],
    });
    expect(summary.status).toBe("not_started");
    expect(summary.progressPct).toBe(0);
    expect(deriveReviewPriority(summary)).toBe("low");
  });

  it("surfaces needs_grading for a completed SA with no AI grade (scenario 36)", () => {
    const attempts = [
      { id: "a1", studentId: "s1", lessonId: "L1", assignmentId: "AS1", status: "completed", completedAt: new Date().toISOString(), currentBlockIndex: 1 },
    ];
    const responses = [
      { id: "r1", attemptId: "a1", studentId: "s1", blockId: "b1", questionId: "q1", type: "sa", gradingMode: "assessment", score: 0 },
    ];
    const summary = deriveStudentAssignmentSummary({ student: { id: "s1", name: "Ada" }, lesson, assignment, blocks, attempts, responses, signals: [] });
    expect(summary.needsGrading).toBe(true);
    expect(summary.status).toBe("needs_grading");
    expect(deriveReviewPriority(summary)).toBe("medium");
  });

  it("builds a prioritised review queue with AI agent items first", () => {
    const attempts = [
      { id: "a1", studentId: "s1", lessonId: "L1", assignmentId: "AS1", status: "completed", completedAt: new Date().toISOString(), currentBlockIndex: 1 },
    ];
    const responses = [
      { id: "r1", attemptId: "a1", studentId: "s1", blockId: "b1", questionId: "q1", type: "sa", gradingMode: "assessment", score: 0 },
    ];
    const signals = [sig("ai_guard_marker_in_answer", { attemptId: "a1", blockId: "b1", severity: "high" })];
    const summary = deriveStudentAssignmentSummary({ student: { id: "s1", name: "Ada" }, lesson, assignment, blocks, attempts, responses, signals });
    const queue = deriveReviewQueueItems([summary]);
    expect(queue[0].type).toBe("ai_agent");
    expect(queue[0].priority).toBe("high");
    expect(queue.some((i) => i.type === "needs_grading")).toBe(true);
  });
});

describe("course progress aggregation", () => {
  it("aggregates across multiple assignments and produces headlines (scenarios 24/28/29)", () => {
    const lessons = [
      { id: "L1", title: "Cells", courseId: "C1" },
      { id: "L2", title: "Genetics", courseId: "C1" },
    ];
    const assignments = [
      { id: "AS1", lessonId: "L1", courseId: "C1", dueAt: "2026-01-01" },
      { id: "AS2", lessonId: "L2", courseId: "C1", dueAt: "2026-02-01" },
    ];
    const blocks = [
      { id: "b1", lessonId: "L1", order: 0, type: "question", questionType: "sa", singleQuestion: { id: "q1", points: 4 } },
      { id: "b2", lessonId: "L2", order: 0, type: "question", questionType: "sa", singleQuestion: { id: "q2", points: 4 } },
    ];
    const enrollments = [
      { id: "e1", courseId: "C1", studentId: "s1", studentName: "Ada", studentEmail: "ada@x.edu", status: "active" },
      { id: "e2", courseId: "C1", studentId: "s2", studentName: "Bo", studentEmail: "bo@x.edu", status: "active" },
    ];
    const attempts = [
      { id: "a1", studentId: "s1", lessonId: "L1", assignmentId: "AS1", status: "completed", completedAt: new Date().toISOString(), currentBlockIndex: 1 },
      { id: "a2", studentId: "s1", lessonId: "L2", assignmentId: "AS2", status: "completed", completedAt: new Date().toISOString(), currentBlockIndex: 1 },
    ];
    const responses = [
      { id: "r1", attemptId: "a1", studentId: "s1", blockId: "b1", questionId: "q1", type: "sa", gradingMode: "assessment", score: 4, teacherReviewedAt: new Date().toISOString() },
      { id: "r2", attemptId: "a2", studentId: "s1", blockId: "b2", questionId: "q2", type: "sa", gradingMode: "assessment", score: 4, teacherReviewedAt: new Date().toISOString() },
    ];
    // s1 has AI agent signals on both assignments -> repeated signals.
    const signals = [
      { id: "g1", attemptId: "a1", studentId: "s1", timestamp: new Date().toISOString(), eventType: "ai_guard_marker_in_answer", severity: "high", blockId: "b1" },
      { id: "g2", attemptId: "a2", studentId: "s1", timestamp: new Date().toISOString(), eventType: "ai_guard_marker_in_answer", severity: "high", blockId: "b2" },
    ];
    const cp = deriveCourseProgressSummary({
      courseId: "C1",
      enrollments,
      students: [
        { id: "s1", name: "Ada", email: "ada@x.edu" },
        { id: "s2", name: "Bo", email: "bo@x.edu" },
      ],
      assignments,
      lessons,
      blocks,
      attempts,
      responses,
      signals,
    });
    expect(cp.columns).toHaveLength(2);
    expect(cp.rows).toHaveLength(2);
    expect(cp.cards.studentsEnrolled).toBe(2);
    expect(cp.integrity.studentsWithAiAgentSignals).toBe(1);
    expect(cp.integrity.studentsWithRepeatedSignals).toBe(1);
    expect(cp.integrity.headlines.length).toBeGreaterThan(0);
    const ada = cp.rows.find((r) => r.studentId === "s1")!;
    expect(ada.reliability).toBe("needs_review");
    expect(ada.aiAgentSignalCount).toBe(2);
  });
});

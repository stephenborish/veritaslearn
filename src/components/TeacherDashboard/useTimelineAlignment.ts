import { useMemo } from 'react';
import { safeCheckpointLabel } from '../../lib/dataIntegrity';

interface TimelineStep {
  id: string;
  blockId: string;
  checkpointId?: string;
  type: string;
  title: string;
  index: number;
  isPractice: boolean;
  points: number;
  block: any;
  checkpoint?: any;
}

interface StepStatus {
  status: string;
  color: string;
  label: string;
  score: number | null;
  maxScore: number | null;
  signalSeverity: string;
  signals: any[];
  response?: any;
  entry?: any;
  attempt?: any;
  draftText?: string;
}

interface TimelineRow {
  student: any;
  steps: StepStatus[];
  overallSeverity: string;
  overallSignals: any[];
  needsReviewCount: number;
  completedSteps: number;
  overallEntry?: any;
  historicalTrend: number[];
}

interface UseTimelineAlignmentProps {
  selectedLessonId: string | undefined;
  selectedAssignmentId: string | null;
  displayStudents: any[];
  blocks: any[];
  filteredAttempts: any[];
  filteredResponses: any[];
  signals: any[];
  gradebookEntries: any[];
  gradebookResponseEntries: any[];
  assignments?: any[];
}

export function useTimelineAlignment({
  selectedLessonId,
  selectedAssignmentId,
  displayStudents,
  blocks,
  filteredAttempts,
  filteredResponses,
  signals,
  gradebookEntries,
  gradebookResponseEntries,
  assignments = [],
}: UseTimelineAlignmentProps) {
  // 1. Build Timeline Steps (Columns)
  const timelineSteps = useMemo(() => {
    if (!selectedLessonId) return [];

    const lessonBlocks = blocks
      .filter((b) => b.lessonId === selectedLessonId)
      .sort((a, b) => (a.order ?? a.orderIndex ?? 0) - (b.order ?? b.orderIndex ?? 0));

    const steps: TimelineStep[] = [];
    let stepIndex = 1;

    lessonBlocks.forEach((b) => {
      steps.push({
        id: b.id,
        blockId: b.id,
        type: b.type,
        title:
          b.title ||
          (b.type === 'video'
            ? 'Video'
            : b.type === 'reading'
            ? 'Reading'
            : 'Question'),
        index: stepIndex++,
        isPractice: !!b.isPractice,
        points: b.isPractice
          ? 0
          : b.singleQuestion
          ? (b.singleQuestion.points || 0)
          : b.questionPool
          ? (b.questionPool.questions?.[0]?.points || 0) * (b.questionPool.numToSelect || 1)
          : 0,
        block: b,
      });

      if (
        b.type === 'video' &&
        b.videoCheckpoints &&
        b.videoCheckpoints.length > 0
      ) {
        // Sort checkpoints by time
        const sortedCPs = [...b.videoCheckpoints].sort(
          (c1: any, c2: any) => (c1.timestamp ?? c1.timeSeconds ?? 0) - (c2.timestamp ?? c2.timeSeconds ?? 0)
        );
        sortedCPs.forEach((cp: any) => {
          steps.push({
            id: cp.id,
            blockId: b.id,
            checkpointId: cp.id,
            type: 'checkpoint',
            title: safeCheckpointLabel(cp),
            index: stepIndex++,
            isPractice: !!cp.isPractice,
            points: cp.question?.points || 0,
            block: b,
            checkpoint: cp,
          });
        });
      }
    });

    return steps;
  }, [selectedLessonId, blocks]);

  // 2. Evaluate Cell Statuses
  const evaluateStepStatus = (
    studentId: string,
    step: TimelineStep
  ): StepStatus => {
    const attempt = filteredAttempts.find(
      (a) => a.studentId === studentId && a.lessonId === selectedLessonId
    );

    const stepSignals = (signals || []).filter(
      (s) =>
        s.studentId === studentId &&
        s.lessonId === selectedLessonId &&
        s.blockId === step.blockId &&
        (!step.checkpointId || s.checkpointId === step.checkpointId)
    );

    let highestSeverity = 'none';
    if (stepSignals.length > 0) {
      if (stepSignals.some((s) => s.severity === 'high'))
        highestSeverity = 'high';
      else if (stepSignals.some((s) => s.severity === 'medium'))
        highestSeverity = 'medium';
      else highestSeverity = 'low';
    }

    if (!attempt) {
      return {
        status: 'not_started',
        color: 'gray',
        label: 'Not Started',
        score: null,
        maxScore: step.points,
        signalSeverity: highestSeverity,
        signals: stepSignals,
      };
    }

    if (step.type === 'video') {
      const furthest = attempt.furthestVideoTimestamps?.[step.blockId] || 0;
      const dur = step.block?.duration || 0;
      let status = 'in_progress';
      let label = 'In Progress';
      let color = 'blue';
      if (furthest > 0 && dur > 0 && furthest >= dur * 0.9) {
        status = 'viewed';
        label = 'Viewed';
        color = 'green';
      } else if (furthest === 0) {
        status = 'not_started';
        label = 'Not Started';
        color = 'gray';
      } else {
        label = `${Math.round(furthest)}s / ${dur}s`;
      }
      return {
        status,
        color,
        label,
        score: null,
        maxScore: null,
        signalSeverity: highestSeverity,
        signals: stepSignals,
        attempt,
      };
    }

    if (step.type === 'reading') {
      const itemIndex = step.block?.order ?? step.block?.orderIndex ?? 0;
      const isCompleted = attempt.status === 'completed' || attempt.currentBlockIndex > itemIndex;
      const isCurrent = attempt.currentBlockIndex === itemIndex && attempt.status !== 'completed';
      
      if (isCompleted) {
        return {
          status: 'viewed',
          color: 'green',
          label: 'Viewed',
          score: null,
          maxScore: null,
          signalSeverity: highestSeverity,
          signals: stepSignals,
          attempt,
        };
      } else if (isCurrent) {
        return {
          status: 'in_progress',
          color: 'blue',
          label: 'Viewing',
          score: null,
          maxScore: null,
          signalSeverity: highestSeverity,
          signals: stepSignals,
          attempt,
        };
      } else {
        return {
          status: 'not_started',
          color: 'gray',
          label: 'Not Started',
          score: null,
          maxScore: null,
          signalSeverity: highestSeverity,
          signals: stepSignals,
          attempt,
        };
      }
    }

    // Question or Checkpoint
    const response = filteredResponses.find(
      (r) =>
        r.attemptId === attempt.id &&
        r.blockId === step.blockId &&
        (step.checkpointId ? r.checkpointId === step.checkpointId : true)
    );

    if (!response) {
      // Look for a saved draft
      const possibleQuestionIds: string[] = [];
      if (step.checkpoint) {
        if (step.checkpoint.question?.id) possibleQuestionIds.push(step.checkpoint.question.id);
        if (Array.isArray(step.checkpoint.questions)) {
          step.checkpoint.questions.forEach((q: any) => {
            if (q?.id) possibleQuestionIds.push(q.id);
          });
        }
      } else if (step.block) {
        if (step.block.singleQuestion?.id) possibleQuestionIds.push(step.block.singleQuestion.id);
        if (step.block.questionPool?.questions) {
          step.block.questionPool.questions.forEach((q: any) => {
            if (q?.id) possibleQuestionIds.push(q.id);
          });
        }
      }

      const hasDraft = possibleQuestionIds.some(
        (qId) => attempt.draftResponses?.[qId] && attempt.draftResponses[qId].trim() !== ""
      );

      // Find the specific draft text for this step
      let draftText = "";
      possibleQuestionIds.forEach((qId) => {
        if (attempt.draftResponses?.[qId]) {
          draftText = attempt.draftResponses[qId];
        }
      });

      if (hasDraft) {
        return {
          status: 'draft',
          color: 'blue',
          label: 'Draft Saved',
          score: null,
          maxScore: step.points,
          signalSeverity: highestSeverity,
          signals: stepSignals,
          attempt,
          draftText,
        };
      }

      const isPastBlock = attempt.status === 'completed' || attempt.currentBlockIndex > (step.block?.order ?? step.block?.orderIndex ?? 0);
      if (isPastBlock) {
        return {
          status: 'missing',
          color: 'red',
          label: 'Missing',
          score: 0,
          maxScore: step.points,
          signalSeverity: highestSeverity,
          signals: stepSignals,
          attempt,
        };
      }
      return {
        status: 'not_started',
        color: 'gray',
        label: 'Not Started',
        score: null,
        maxScore: step.points,
        signalSeverity: highestSeverity,
        signals: stepSignals,
        attempt,
      };
    }

    const grEntry = (gradebookResponseEntries || []).find(
      (gre) =>
        gre.responseId === response.id ||
        (gre.studentId === studentId &&
          gre.blockId === step.blockId &&
          (step.checkpointId ? gre.checkpointId === step.checkpointId : true))
    );

    let rStatus = grEntry?.status;
    let rScore = grEntry?.score ?? response.score;

    if (!rStatus) {
      if (
        response.teacherReviewedAt ||
        response.teacherOverrideScore !== undefined
      ) {
        rStatus = 'reviewed';
      } else if (response.aiGrading) {
        rStatus =
          response.aiGrading.status === 'success'
            ? 'ai_scored'
            : 'needs_teacher_review';
      } else if (response.type === 'mc') {
        rStatus = 'reviewed'; // auto scored
      } else {
        rStatus = 'needs_teacher_review';
      }
    }

    let label = 'Submitted';
    let color = 'blue';

    if (rStatus === 'needs_teacher_review' || rStatus === 'pending_ai') {
      label = rStatus === 'pending_ai' ? 'AI Pending' : 'Needs Grading';
      color = 'amber';
    } else if (rStatus === 'ai_scored') {
      label = 'AI Graded';
      color = 'purple';
    } else if (
      rStatus === 'reviewed' ||
      rStatus === 'teacher_reviewed' ||
      rStatus === 'feedback_released'
    ) {
      if (rScore === step.points && step.points > 0) {
        label = 'Full Credit';
        color = 'green';
      } else if (rScore > 0) {
        label = 'Partial';
        color = 'amber';
      } else {
        label = 'Incorrect';
        color = 'slate';
      }
    }

    return {
      status: rStatus,
      color,
      label,
      score: rScore,
      maxScore: step.points,
      signalSeverity: highestSeverity,
      signals: stepSignals,
      response,
      entry: grEntry,
      attempt,
    };
  };

  // 3. Resolve Roster Matrix
  const timelineData = useMemo(() => {
    // Determine the past 5 assignments (including the current one)
    const sortedAssignments = [...(assignments || [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const pastAssignments = sortedAssignments.slice(0, 5).reverse();

    return displayStudents.map((student): TimelineRow => {
      const steps = timelineSteps.map((step) =>
        evaluateStepStatus(student.id, step)
      );

      const overallSignals = (signals || []).filter(
        (s) => s.studentId === student.id && s.lessonId === selectedLessonId
      );
      const overallSeverity = overallSignals.some((s) => s.severity === 'high')
        ? 'high'
        : overallSignals.some((s) => s.severity === 'medium')
        ? 'medium'
        : overallSignals.length > 0
        ? 'low'
        : 'none';

      const needsReviewCount = steps.filter(
        (s) => s.status === 'needs_teacher_review' || s.status === 'pending_ai'
      ).length;
      const completedSteps = steps.filter(
        (s) =>
          s.status === 'viewed' ||
          s.status === 'reviewed' ||
          s.status === 'teacher_reviewed' ||
          s.status === 'ai_scored' ||
          s.status === 'feedback_released' ||
          (s.score !== null && s.score > 0)
      ).length;

      const overallEntry = (gradebookEntries || []).find(
        (ge) =>
          (ge.assignmentId &&
            ge.assignmentId === selectedAssignmentId &&
            ge.studentId === student.id) ||
          (!ge.assignmentId &&
            ge.assignmentId === `legacy_${selectedLessonId}` &&
            ge.studentId === student.id)
      );

      const historicalTrend = pastAssignments.map((a) => {
        const entry = (gradebookEntries || []).find(
          (ge) => ge.assignmentId === a.id && ge.studentId === student.id
        );
        if (entry && entry.maxScore > 0) {
          return entry.score / entry.maxScore;
        }
        return -1; // -1 represents no submission/missing
      }).filter(v => v >= 0);

      return {
        student,
        steps,
        overallSeverity,
        overallSignals,
        needsReviewCount,
        completedSteps,
        overallEntry,
        historicalTrend,
      };
    });
  }, [
    displayStudents,
    timelineSteps,
    selectedAssignmentId,
    selectedLessonId,
    filteredAttempts,
    filteredResponses,
    signals,
    gradebookEntries,
    gradebookResponseEntries,
    assignments,
  ]);

  // 4. Class Averages
  const classComparison = useMemo(() => {
    const statsByStep: Record<string, any> = {};
    timelineSteps.forEach((step, idx) => {
      let totalScore = 0;
      let countScore = 0;
      let submitted = 0;
      let needsGrading = 0;
      let signalsCount = 0;

      timelineData.forEach((row) => {
        if (row.student.isPreview) return;
        const cell = row.steps[idx];
        if (
          cell.score !== null &&
          cell.status !== 'not_started' &&
          cell.status !== 'missing'
        ) {
          totalScore += cell.score;
          countScore++;
        }
        if (cell.status !== 'not_started' && cell.status !== 'missing')
          submitted++;
        if (
          cell.status === 'needs_teacher_review' ||
          cell.status === 'pending_ai'
        )
          needsGrading++;
        if (cell.signalSeverity !== 'none') signalsCount++;
      });

      statsByStep[step.id] = {
        avgScore: countScore > 0 ? totalScore / countScore : null,
        submitted,
        needsGrading,
        signalsCount,
        countScore,
      };
    });
    return statsByStep;
  }, [timelineData, timelineSteps]);

  return { timelineSteps, timelineData, classComparison };
}

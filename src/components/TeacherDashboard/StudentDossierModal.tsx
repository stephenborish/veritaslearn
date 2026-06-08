import { useState, useEffect, useRef } from "react";
import { RichContentRenderer, getPlainText } from "../RichContent/RichContentRenderer";
import {
  AlertTriangle,
  ShieldCheck,
  X,
  Clock,
  Video,
  BookOpen,
  AlertCircle,
  HelpCircle,
  Lock,
  Check,
  Calendar,
  Unlock,
  ShieldAlert,
  MessageSquare,
  Bot,
  Info,
  Activity,
} from "lucide-react";

interface StudentDossierModalProps {
  studentId: string;
  lessonId: string;
  initialSection?: string;
  students: any[];
  attempts: any[];
  responses: any[];
  signals: any[];
  lessons: any[];
  blocks: any[];
  assignments?: any[];
  studentActivities?: any[];
  lessonVersions?: any[];
  onClose: () => void;
  onOverrideSave: (responseId: string, score: number, notes: string) => Promise<void>;
  onReviewAction?: (action: 'approve' | 'mark-reviewed' | 'release-feedback' | 'grade', responseId: string, payload?: any) => Promise<void>;
  onUnlockStudent?: (attemptId: string) => void;
}

function formatVideoTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resolveMultipleChoiceText(block: any, responseValue: any): string | null {
  if (!responseValue) return null;
  const valStr = String(responseValue);

  if (block?.singleQuestion?.choices) {
    const found = block.singleQuestion.choices.find((c: any) => c.id === valStr);
    if (found) return getPlainText(found.text);
  }

  if (block?.questionPool?.questions) {
    for (const q of block.questionPool.questions) {
      if (q.choices) {
        const found = q.choices.find((c: any) => c.id === valStr);
        if (found) return getPlainText(found.text);
      }
    }
  }

  if (block?.videoCheckpoints) {
    for (const cp of block.videoCheckpoints) {
      if (cp.questions) {
        for (const q of cp.questions) {
          if (q.choices) {
            const found = q.choices.find((c: any) => c.id === valStr);
            if (found) return getPlainText(found.text);
          }
        }
      }
    }
  }

  return null;
}

function signalEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    blur_focus_lost: "Visibility hidden",
    visibilitychange: "Tab or window changed",
    fullscreen_exit: "Fullscreen exited",
    fullscreen_exited: "Fullscreen exited",
    seek_attempt_blocked: "Video seek attempt blocked",
    copy_blocked: "Copy attempt blocked",
    paste_blocked: "Paste attempt blocked",
    context_menu_blocked: "Right-click blocked",
    rapid_navigation: "Fast navigation detected",
    checkpoint_triggered: "Checkpoint reached",
    possible_ai_agent_use: "Possible AI agent use",
    hidden_assessment_text_in_answer: "Assessment content detected in answer",
    ai_guard_marker_in_answer: "Browser AI Guard marker in answer",
    ai_guard_refusal_phrase_in_answer: "AI refusal phrase in answer",
  };
  return labels[eventType] || eventType.replace(/_/g, " ");
}

export function get7DayActivityHeatmap(studentId: string, studentActivities: any[]) {
  const result = [];
  const now = new Date();
  
  // Last 7 days, ending with today as index 6
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dayStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Day label: Mon, Tue, etc.
    const daysName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayLabel = daysName[d.getDay()];
    
    // Filter activities for this student on this day
    const dayActivities = studentActivities.filter((act: any) => {
      if (act.studentId !== studentId) return false;
      const actDate = act.timestamp.split('T')[0];
      return actDate === dayStr;
    });

    // Segment into morning (4 AM - 12 PM), afternoon (12 PM - 6 PM), and evening (6 PM - 4 AM)
    let morningCount = 0;
    let afternoonCount = 0;
    let eveningCount = 0;

    dayActivities.forEach((act: any) => {
      const actDateObj = new Date(act.timestamp);
      const hrs = actDateObj.getHours();
      if (hrs >= 4 && hrs < 12) {
        morningCount++;
      } else if (hrs >= 12 && hrs < 18) {
        afternoonCount++;
      } else {
        eveningCount++;
      }
    });

    const total = dayActivities.length;
    let intensity: 'none' | 'low' | 'medium' | 'high' = 'none';
    if (total > 0 && total <= 2) {
      intensity = 'low';
    } else if (total > 2 && total <= 5) {
      intensity = 'medium';
    } else if (total > 5) {
      intensity = 'high';
    }

    result.push({
      dateStr: dayStr,
      dayLabel,
      formattedDate: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' }),
      total,
      intensity,
      periods: {
        morning: morningCount,
        afternoon: afternoonCount,
        evening: eveningCount
      },
      list: dayActivities
    });
  }

  return result;
}

function TooltipWrapper({ children, day }: { children: React.ReactNode, day: any }) {
  const [show, setShow] = useState(false);

  const formatActivitySummary = () => {
    if (day.total === 0) return "No activity recorded";
    const parts = [];
    if (day.periods.morning > 0) parts.push(`Morning: ${day.periods.morning} action(s)`);
    if (day.periods.afternoon > 0) parts.push(`Afternoon: ${day.periods.afternoon} action(s)`);
    if (day.periods.evening > 0) parts.push(`Evening: ${day.periods.evening} action(s)`);
    return parts.join(", ");
  };

  return (
    <div 
      className="relative cursor-pointer" 
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-900 border border-slate-800 text-[10px] text-white p-2.5 rounded shadow-lg z-50 pointer-events-none font-sans">
          <p className="font-bold border-b border-slate-800 pb-1 mb-1">
            {day.formattedDate}
          </p>
          <p className="text-slate-300 mb-1">
            <strong>{day.total} activities</strong>: {formatActivitySummary()}
          </p>
          {day.total > 0 && (
            <div className="text-[9px] text-slate-400 space-y-0.5 border-t border-slate-800/80 pt-1 mt-1 max-h-24 overflow-y-auto font-mono">
              {day.list.slice(0, 3).map((act: any) => (
                <div key={act.id} className="truncate select-none">
                  - {act.description}
                </div>
              ))}
              {day.total > 3 && (
                <div className="text-[8px] text-slate-500 italic">
                  + {day.total - 3} more activities
                </div>
              )}
            </div>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45" />
        </div>
      )}
    </div>
  );
}

function getGradingStateLabel(response: any, draftText: string | null): string {
  if (!response) {
    if (draftText && draftText.trim() !== "") {
      return "Draft saved";
    }
    return "Not submitted";
  }

  const aiGradStatus = response.aiGrading?.status;
  const isReleased = !!(response.feedbackReleasedAt || response.aiFeedbackReleasedAt || response.feedbackVisibleToStudent);
  const isReviewed = !!(response.teacherReviewedAt || response.teacherOverrideScore !== null && response.teacherOverrideScore !== undefined || response.teacherOverride?.score !== undefined);

  if (isReleased) {
    return "Feedback released";
  }
  if (isReviewed) {
    return "Reviewed, not released";
  }
  if (aiGradStatus === "needs_review" || aiGradStatus === "failed") {
    return "Needs teacher review";
  }
  if (aiGradStatus === "success") {
    return "AI scored, awaiting teacher review";
  }
  if (aiGradStatus === "pending") {
    return "Submitted, awaiting AI grading";
  }
  
  return "Submitted, awaiting AI grading"; // Default fallback
}

function renderChoicesWithGrades(question: any, studentValue: any) {
  if (!question || !Array.isArray(question.choices) || question.choices.length === 0) {
    return null;
  }

  const selectedChoiceId = selectedMultipleChoiceToLetterOrId(question, studentValue);
  const correctChoiceId = String(question.correctChoiceId || "");

  // Check if selected choice exists in the options
  const hasSelectedValue = studentValue !== undefined && studentValue !== null && String(studentValue).trim() !== "";
  const isSelectedChoiceResolved = hasSelectedValue && question.choices.some((c: any) => String(c.id) === selectedChoiceId);

  return (
    <div className="mt-3.5 space-y-2 max-w-xl">
      <span className="text-[9px] font-bold font-mono uppercase text-slate-400 block tracking-wider mb-2">
        Choices & Selected Answer
      </span>
      {hasSelectedValue && !isSelectedChoiceResolved && (
        <div className="p-2.5 bg-rose-50 border border-rose-150 text-rose-900 rounded-md text-[11px] font-medium mb-3.5 leading-relaxed">
          <strong>Selected choice unavailable</strong>
          <span className="text-[10px] text-rose-700 font-mono block mt-0.5">
            Submitted Value / ID: {String(studentValue)}
          </span>
        </div>
      )}
      {question.choices.map((choice: any, index: number) => {
        const choiceId = String(choice.id);
        const isSelected = hasSelectedValue && choiceId === selectedChoiceId;
        const isCorrect = choiceId === correctChoiceId;

        // Choice labels A, B, C, D...
        const choiceLetter = String.fromCharCode(65 + index); // A, B, C, D etc.

        let borderClass = "border-slate-200 bg-white hover:border-slate-300";
        let badge = null;

        if (isSelected && isCorrect) {
          borderClass = "border-emerald-500 bg-emerald-50/40 shadow-xs";
          badge = (
            <span className="text-[9px] uppercase font-bold tracking-wider font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded flex items-center gap-1 shrink-0 self-start sm:self-center">
              <Check className="w-3 h-3 text-emerald-600 shrink-0" /> Student selected · Correct
            </span>
          );
        } else if (isSelected) {
          borderClass = "border-rose-300 bg-rose-50/20";
          badge = (
            <span className="text-[9px] uppercase font-bold tracking-wider font-mono bg-rose-100 text-rose-800 px-2 py-0.5 rounded flex items-center gap-1 shrink-0 self-start sm:self-center">
              <X className="w-3 h-3 text-rose-600 shrink-0" /> Student selected
            </span>
          );
        } else if (isCorrect) {
          borderClass = "border-emerald-305 bg-emerald-50/10";
          badge = (
            <span className="text-[9px] uppercase font-bold tracking-wider font-mono bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded flex items-center gap-1 shrink-0 self-start sm:self-center">
              <Check className="w-3 h-3 text-emerald-600 shrink-0" /> Correct answer
            </span>
          );
        }

        return (
          <div
            key={choice.id}
            className={`border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs leading-relaxed transition ${borderClass}`}
          >
            <div className="flex items-start gap-2.5 text-slate-800 font-medium min-w-0 flex-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] font-bold shrink-0 mt-0.5 ${isSelected ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}>
                {choiceLetter}
              </span>
              <div className="font-sans flex-1 min-w-0 break-words pr-2">
                <RichContentRenderer content={choice.text} />
                <span className="text-[8px] text-slate-400 font-mono block mt-1">ID: {choice.id}</span>
              </div>
            </div>
            {badge}
          </div>
        );
      })}
    </div>
  );
}

function selectedMultipleChoiceToLetterOrId(question: any, value: any): string {
  if (value === undefined || value === null) return "";
  const v = String(value);
  if (question.choices && question.choices.some((c: any) => String(c.id) === v)) {
    return v;
  }
  // If student subbed index, match back to index-based id fallback
  const idx = Number(value);
  if (!isNaN(idx) && question.choices && question.choices[idx]) {
    return String(question.choices[idx].id);
  }
  return v;
}

function renderRubricDetails(question: any) {
  if (!question || question.type === "mc") {
    return null;
  }

  const hasRubric = Array.isArray(question.rubricCategories) && question.rubricCategories.length > 0;
  const hasModel = !!(question.modelAnswer || question.answerKey);
  const hasGuidance = !!question.aiScoringGuidance;

  if (!hasRubric && !hasModel && !hasGuidance) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3.5 max-w-xl bg-slate-50 border border-slate-200 p-4 rounded-lg">
      <div className="flex items-center gap-1.5 border-b border-slate-200 pb-1.5 mb-2.5">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block shrink-0" />
        <span className="text-[10px] font-bold font-mono uppercase text-slate-500 tracking-wider">
          Scoring & Rubric Configuration (Teacher Only)
        </span>
      </div>

      {hasRubric && (
        <div className="space-y-3">
          <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">Rubric Categories</span>
          <div className="grid grid-cols-1 gap-2.5">
            {question.rubricCategories.map((rubric: any) => (
              <div key={rubric.id} className="text-xs space-y-1 bg-white p-2.5 border border-slate-150 rounded-md shadow-xs">
                <div className="flex justify-between items-center bg-slate-50 px-2 py-1 rounded">
                  <span className="font-bold text-slate-700">{getPlainText(rubric.name)}</span>
                  <span className="font-mono text-[10px] text-slate-500 font-semibold">{rubric.maxPoints} pts max</span>
                </div>
                <div className="text-[11px] text-slate-600 pl-1 leading-relaxed font-sans">
                  <RichContentRenderer content={rubric.description} />
                </div>
                {rubric.fullCreditExample && (
                  <div className="pl-1 text-[10.5px] text-emerald-800 leading-normal font-sans pt-1 border-t border-slate-100 mt-1">
                    <strong>Full Credit Example:</strong> <span className="text-slate-650"><RichContentRenderer content={rubric.fullCreditExample} /></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasModel && (
        <div className="border-t border-slate-205 pt-3.5 space-y-1">
          <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">Model Answer / Ideal Response</span>
          <div className="text-[11px] text-slate-700 leading-relaxed italic bg-white p-2.5 border border-slate-150 rounded-md">
            <RichContentRenderer content={question.modelAnswer || question.answerKey} />
          </div>
        </div>
      )}

      {hasGuidance && (
        <div className="border-t border-slate-205 pt-3.5 space-y-1">
          <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">AI Scoring Guidance</span>
          <div className="text-[11px] text-indigo-900 leading-relaxed bg-indigo-50/40 p-2.5 border border-indigo-150 rounded-md">
            <RichContentRenderer content={question.aiScoringGuidance} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudentDossierModal({
  studentId,
  lessonId,
  initialSection,
  students,
  attempts,
  responses,
  signals,
  lessons,
  blocks,
  assignments = [],
  studentActivities = [],
  lessonVersions = [],
  onClose,
  onOverrideSave,
  onReviewAction,
  onUnlockStudent,
}: StudentDossierModalProps) {
  const [overrideScores, setOverrideScores] = useState<{ [id: string]: number }>({});
  const [overrideNotes, setOverrideNotes] = useState<{ [id: string]: string }>({});
  const [savingState, setSavingState] = useState<{ [id: string]: boolean }>({});
  const [saveSuccess, setSaveSuccess] = useState<{ [id: string]: boolean }>({});
  const [reviewedSignals, setReviewedSignals] = useState<Set<string>>(new Set());
  const [unlocking, setUnlocking] = useState<boolean>(false);

  // AI-Review-integrated states in dossier side panel
  const [editedFeedbacks, setEditedFeedbacks] = useState<{ [id: string]: string }>({});
  const [actionStates, setActionStates] = useState<{ [id: string]: { loading: boolean; success: boolean; error: string | null } }>({});

  const attempt = attempts.find((a) => a.studentId === studentId && a.lessonId === lessonId);

  const executeReviewAction = async (action: 'approve' | 'mark-reviewed' | 'release-feedback' | 'grade', responseId: string) => {
    if (!onReviewAction) return;
    setActionStates((prev) => ({
      ...prev,
      [responseId]: { loading: true, success: false, error: null }
    }));
    try {
      let payload = {};
      if (action === 'release-feedback') {
        payload = {
          studentFacingFeedback: editedFeedbacks[responseId] !== undefined
            ? editedFeedbacks[responseId]
            : (responses.find((r) => r.id === responseId)?.studentFacingFeedback || "")
        };
      } else if (action === 'mark-reviewed') {
        payload = {
          teacherOnlyNotes: overrideNotes[responseId] || ""
        };
      }
      await onReviewAction(action, responseId, payload);
      setActionStates((prev) => ({
        ...prev,
        [responseId]: { loading: false, success: true, error: null }
      }));
      setTimeout(() => {
        setActionStates((prev) => ({
          ...prev,
          [responseId]: { loading: false, success: false, error: null }
        }));
      }, 2000);
    } catch (err: any) {
      setActionStates((prev) => ({
        ...prev,
        [responseId]: { loading: false, success: false, error: err?.message || "Failed execution" }
      }));
    }
  };

  const assignment = attempt?.assignmentId
    ? (assignments || []).find((a: any) => a.id === attempt.assignmentId)
    : null;
  const versionId = attempt?.lessonVersionId || assignment?.lessonVersionId;
  const versionSnapshot = versionId
    ? (lessonVersions || []).find((v: any) => v.id === versionId)
    : null;
  
  const getSnapshotBlock = (bId: string) => {
    if (!versionSnapshot?.blocksSnapshot) return null;
    return versionSnapshot.blocksSnapshot.find((b: any) => b.id === bId);
  };

  function findQuestionDef(block: any, response: any): any {
    if (!block) return null;
    if (!response) return block.singleQuestion || block.questionPool?.questions?.[0];
    const qId = response.questionId;
    if (block.singleQuestion && block.singleQuestion.id === qId) return block.singleQuestion;
    if (block.questionPool?.questions) {
      const found = block.questionPool.questions.find((q: any) => q.id === qId);
      if (found) return found;
    }
    return block.singleQuestion || block.questionPool?.questions?.[0];
  }

  function findCheckpointQuestionDef(checkpoint: any, response: any): any {
    if (!checkpoint) return null;
    if (!response) return checkpoint.question || checkpoint.questions?.[0];
    const qId = response.questionId;
    if (checkpoint.question && checkpoint.question.id === qId) return checkpoint.question;
    if (checkpoint.questions) {
      const found = checkpoint.questions.find((q: any) => q.id === qId);
      if (found) return found;
    }
    return checkpoint.question || checkpoint.questions?.[0];
  }

  function formatActiveDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return "Not recorded";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const remainingSecs = Math.round(seconds % 60);
    if (mins < 60) {
      return `${mins}m ${remainingSecs}s`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  let student = students.find((s) => s.id === studentId);
  if (!student && attempt?.isPreviewAttempt) {
    student = {
      id: studentId,
      name: "Teacher Preview",
      email: "",
      role: "student",
    };
  }
  const lesson = lessons.find((l) => l.id === lessonId);

  if (!student || !lesson || !attempt) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white border border-slate-200 text-slate-800 rounded-xl p-6 max-w-sm text-center shadow-lg font-sans">
          <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No active attempt found for this student.</p>
          <button
            onClick={onClose}
            className="mt-4 bg-[#0A192F] hover:bg-[#15294b] text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const sSignals = signals.filter((s) => s.attemptId === attempt.id);
  const sResponses = responses.filter((r) => r.attemptId === attempt.id);
  const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const summaryRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const responsesRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const signalsRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus preservation on mount-unmount
  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    return () => {
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === "function") {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  // Lock raw webpage scrolling
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const hasUnsavedChanges = () => {
    for (const [resId, val] of Object.entries(overrideScores)) {
      if (val === undefined) continue;
      const resp = sResponses.find((r) => r.id === resId);
      if (!resp) continue;
      const currentVal = resp.teacherOverride?.score ?? resp.score ?? 0;
      if (Number(val) !== Number(currentVal)) {
        return true;
      }
    }

    for (const [resId, val] of Object.entries(overrideNotes)) {
      if (val === undefined) continue;
      const resp = sResponses.find((r) => r.id === resId);
      if (!resp) continue;
      const currentVal = resp.teacherOverride?.notes ?? resp.notes ?? "";
      if (val !== currentVal) {
        return true;
      }
    }

    for (const [resId, val] of Object.entries(editedFeedbacks)) {
      if (val === undefined) continue;
      const resp = sResponses.find((r) => r.id === resId);
      if (!resp) continue;
      const currentVal = resp.studentFacingFeedback || resp.aiFeedback || resp.aiGrading?.rationale || "";
      if (val !== currentVal) {
        return true;
      }
    }

    return false;
  };

  const handleTryClose = () => {
    if (hasUnsavedChanges()) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleTryClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [overrideScores, overrideNotes, editedFeedbacks, sResponses]);

  const scrollToSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = ref.current;
      // offsetTop represents the top of the element relative to its offsetParent
      let currentElement: HTMLElement | null = element;
      let calculatedOffsetTop = 0;
      while (currentElement && currentElement !== container) {
        calculatedOffsetTop += currentElement.offsetTop;
        currentElement = currentElement.offsetParent as HTMLElement | null;
      }
      container.scrollTo({
        top: calculatedOffsetTop - 12,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (initialSection) {
      let targetRef = null;
      if (initialSection === "timeline") targetRef = timelineRef;
      else if (initialSection === "responses") targetRef = responsesRef;
      else if (initialSection === "review") targetRef = reviewRef;
      else if (initialSection === "signals" || initialSection === "integrity") targetRef = signalsRef;
      else if (initialSection === "activity") targetRef = activityRef;
      else if (initialSection === "summary") targetRef = summaryRef;

      const timer = setTimeout(() => {
        if (targetRef) {
          scrollToSection(targetRef);
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [initialSection]);

  // All recorded student activities for this student and this attempt
  const sActivities = studentActivities
    .filter((act: any) => act.studentId === studentId && act.attemptId === attempt.id)
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const findLatestActivityTime = (type: string) => {
    const list = sActivities.filter((a: any) => a.activityType === type);
    if (list.length === 0) return null;
    return list[0].timestamp;
  };

  const lastSignedInTime = student.lastSignedInAt || null;
  const lastLessonActivityTime = attempt.lastActiveAt || student.lastActiveAt || null;
  const lastResponseTime = findLatestActivityTime("answer_submit");
  const lastDraftSaveTime = findLatestActivityTime("draft_save");
  const lastCheckpointTime = sActivities.find((a: any) => a.description.toLowerCase().includes("checkpoint"))?.timestamp || null;
  const lastCompletionTime = attempt.completedAt || null;

  const calcMaxPoints = (): number => {
    return lessonBlocks.reduce((sum: number, b: any) => {
      if (b.type !== "question" || b.isPractice) return sum;
      if (b.singleQuestion) return sum + (b.singleQuestion.points || 0);
      if (b.questionPool) {
        const perQ = b.questionPool.questions?.[0]?.points || 0;
        return sum + perQ * (b.questionPool.numToSelect || 1);
      }
      return sum;
    }, 0);
  };

  const maxLessonPoints = calcMaxPoints();
  const earnedPoints = attempt ? (attempt.score || 0) : 0;
  const scorePercentage = maxLessonPoints > 0 ? Math.round((earnedPoints / maxLessonPoints) * 100) : 0;

  const asg = (assignments || []).find((a: any) => a.lessonId === lesson.id);
  const isPastDue = asg?.dueAt && new Date(asg.dueAt) < new Date();

  const lessonQuestionBlocks = blocks.filter(
    (b) => b.lessonId === lesson.id && b.type === "question" && !b.isPractice
  );
  const hasPendingResponses = lessonQuestionBlocks.some((b) => {
    const isSA =
      b.questionType === "sa" ||
      b.singleQuestion?.type === "sa" ||
      b.questionPool?.questions?.some((q: any) => q.type === "sa");
    if (!isSA) return false;
    const resp = sResponses.find((r) => r.blockId === b.id);
    if (!resp) return false;
    const isGraded =
      resp.teacherOverride ||
      (resp.aiGrading &&
        (resp.aiGrading.status === "success" || resp.aiGrading.status === "failed"));
    return !isGraded;
  });

  const overrideStatus = attempt?.gradebookStatusOverride || null;

  let finalStatus: "not_started" | "in_progress" | "completed" | "pending" | "missing" | "excused" =
    "not_started";
  if (overrideStatus && overrideStatus !== "default") {
    finalStatus = overrideStatus as any;
  } else {
    if (!attempt) {
      finalStatus = isPastDue ? "missing" : "not_started";
    } else {
      if (attempt.status === "completed") {
        finalStatus = hasPendingResponses ? "pending" : "completed";
      } else {
        finalStatus = isPastDue ? "missing" : hasPendingResponses ? "pending" : "in_progress";
      }
    }
  }

  const handleSaveOverrideAndNotes = async (responseId: string, maxPoints: number) => {
    const rawScore = overrideScores[responseId];
    const existingResponse = sResponses.find((r) => r.id === responseId);
    const resolvedScore =
      rawScore !== undefined
        ? rawScore
        : existingResponse?.teacherOverride?.score ?? existingResponse?.score ?? 0;
    const clampedScore = Math.max(0, Math.min(maxPoints, resolvedScore));
    const rawNotes = overrideNotes[responseId];
    const resolvedNotes =
      rawNotes !== undefined
        ? rawNotes
        : existingResponse?.teacherOverride?.notes ?? existingResponse?.notes ?? "";

    setSavingState((prev) => ({ ...prev, [responseId]: true }));
    try {
      await onOverrideSave(responseId, clampedScore, resolvedNotes);
      setSaveSuccess((prev) => ({ ...prev, [responseId]: true }));
      setTimeout(() => setSaveSuccess((prev) => ({ ...prev, [responseId]: false })), 4000);
    } catch (err) {
      console.error("Score override failed:", err);
    } finally {
      setSavingState((prev) => ({ ...prev, [responseId]: false }));
    }
  };

  const handleToggleSignal = (sigId: string) => {
    const updated = new Set(reviewedSignals);
    if (updated.has(sigId)) updated.delete(sigId);
    else updated.add(sigId);
    setReviewedSignals(updated);
  };

  const renderFormattedDate = (rawStr: string | null | undefined) => {
    if (!rawStr) return "—";
    const d = new Date(rawStr);
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const blurs = sSignals.filter(
    (s) => s.eventType === "blur_focus_lost" || s.eventType === "visibilitychange"
  ).length;
  const screens = sSignals.filter(
    (s) => s.eventType === "fullscreen_exit" || s.eventType === "fullscreen_exited"
  ).length;
  const copyPastes = sSignals.filter(
    (s) => s.eventType === "copy_blocked" || s.eventType === "paste_blocked"
  ).length;
  const seekVio = sSignals.filter((s) => s.eventType === "seek_attempt_blocked").length;
  const aiGuardSignals = sSignals.filter((s) =>
    [
      "possible_ai_agent_use",
      "hidden_assessment_text_in_answer",
      "ai_guard_marker_in_answer",
      "ai_guard_refusal_phrase_in_answer",
    ].includes(s.eventType)
  ).length;
  const totalSignals = blurs + screens + copyPastes + seekVio;

  const isCompleted = attempt.status === "completed";

  const statusBadge = {
    excused: "bg-purple-100 text-purple-800 border-purple-300",
    missing: "bg-rose-100 text-rose-800 border-rose-300",
    pending: "bg-amber-100 text-amber-800 border-amber-300",
    completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
    in_progress: "bg-blue-100 text-blue-800 border-blue-300",
    not_started: "bg-slate-100 text-slate-700 border-slate-300",
  }[finalStatus];

  const statusLabel = {
    excused: "Excused",
    missing: "Missing",
    pending: "Needs review",
    completed: "Submitted",
    in_progress: "In progress",
    not_started: "Not started",
  }[finalStatus];

  const initials = student.name ? student.name.substring(0, 2).toUpperCase() : "ST";

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleTryClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 font-sans"
    >
      <div className="bg-white border border-slate-200 text-slate-800 shadow-2xl rounded-xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm lg:text-base font-bold text-slate-900 tracking-tight">
                {student.name}
              </h3>
              <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${statusBadge}`}>
                {statusLabel}
              </span>
              {attempt.isPreviewAttempt && (
                <span className="bg-amber-100 text-amber-800 text-[9px] font-mono font-bold border border-amber-200 px-1.5 py-0.5 rounded tracking-wide uppercase">
                  Teacher Preview
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              {lesson.title}
              {student.email ? ` — ${student.email}` : ""}
            </p>
          </div>
          <button
            onClick={handleTryClose}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sticky Mini Navigation */}
        <div className="bg-slate-50 border-b border-slate-200 py-3 px-6 flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => scrollToSection(summaryRef)}
            className="text-xs font-semibold text-slate-600 hover:text-indigo-650 px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs transition cursor-pointer"
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => scrollToSection(timelineRef)}
            className="text-xs font-semibold text-slate-600 hover:text-indigo-650 px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs transition cursor-pointer"
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => scrollToSection(responsesRef)}
            className="text-xs font-semibold text-slate-600 hover:text-indigo-650 px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs transition cursor-pointer"
          >
            Responses
          </button>
          <button
            type="button"
            onClick={() => scrollToSection(reviewRef)}
            className="text-xs font-semibold text-slate-600 hover:text-indigo-650 px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs transition cursor-pointer"
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => scrollToSection(signalsRef)}
            className="text-xs font-semibold text-slate-600 hover:text-indigo-650 px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs transition cursor-pointer"
          >
            Integrity Signals
          </button>
          <button
            type="button"
            onClick={() => scrollToSection(activityRef)}
            className="text-xs font-semibold text-slate-600 hover:text-indigo-650 px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs transition cursor-pointer"
          >
            Activity Records
          </button>
        </div>

        {/* Scrollable body */}
        <div ref={scrollContainerRef} className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50/40">

          {/* Summary Section */}
          <div ref={summaryRef} id="section-summary" className="space-y-6 scroll-mt-6">

          {/* Locked attempt banner */}
          {attempt.lockState === "locked_awaiting_teacher" && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
              <div className="flex items-start gap-2.5">
                <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-sm font-bold text-amber-900">Attempt paused</h5>
                  <p className="text-xs text-amber-800 font-medium mt-0.5 leading-relaxed">
                    This attempt was paused by the integrity monitor. Review the activity signals below, then unlock to allow the student to continue.
                  </p>
                </div>
              </div>
              {onUnlockStudent && (
                <button
                  type="button"
                  onClick={async () => {
                    setUnlocking(true);
                    try {
                      await onUnlockStudent(attempt.id);
                    } catch (e) {
                      console.error(e);
                    } finally {
                      setUnlocking(false);
                    }
                  }}
                  disabled={unlocking}
                  className="bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 text-white font-bold text-xs uppercase tracking-wide px-4 py-2 rounded-lg transition shadow-sm cursor-pointer flex items-center gap-1.5 shrink-0 border border-amber-500"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  {unlocking ? "Unlocking…" : "Allow student to resume"}
                </button>
              )}
            </div>
          )}

          {/* Student profile + lesson */}
          <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm flex flex-col md:flex-row gap-5 items-start justify-between">
            <div className="flex gap-4 items-start flex-1 min-w-0">
              <div className="w-12 h-12 bg-[#0A192F] text-white font-bold rounded-full flex items-center justify-center border-2 border-slate-200 shrink-0 select-none text-base">
                {initials}
              </div>
              <div className="space-y-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-800 leading-tight">{student.name}</h4>
                {student.email && (
                  <p className="text-xs text-slate-500 font-mono truncate">{student.email}</p>
                )}
                {student.approvedOutsideDomain && (
                  <span className="inline-block bg-teal-50 border border-teal-200 text-teal-800 font-bold text-[9px] px-1.5 py-0.5 rounded font-mono tracking-wider uppercase">
                    External account
                  </span>
                )}
              </div>
            </div>

            <div className="md:border-l md:border-slate-200 md:pl-5 flex-1 w-full space-y-1.5">
              <span className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-wider block">Lesson</span>
              <h5 className="text-xs font-bold text-slate-800 leading-snug">{lesson.title}</h5>
              {lesson.description && (
                <p className="text-[11px] text-slate-500 font-medium italic line-clamp-2 leading-relaxed">
                  {typeof lesson.description === "string"
                    ? lesson.description
                    : lesson.description?.plainText || ""}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2.5 text-[9px] text-slate-400 font-mono font-bold pt-1 uppercase">
                {lesson.estimatedMinutes > 0 && <span>~{lesson.estimatedMinutes} min</span>}
                <span className={lesson.isPublished ? "text-emerald-600" : "text-amber-600"}>
                  {lesson.isPublished ? "Published" : "Draft"}
                </span>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Active time</span>
              <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5 font-mono">
                <Clock className="w-4 h-4 text-[#0A192F]" />
                {Math.floor(attempt.activeTimeSpent / 60)}m {attempt.activeTimeSpent % 60}s
              </span>
              <span className="text-[9px] text-slate-400 block">Time actively working</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Time away</span>
              <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5 font-mono">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                {Math.floor((attempt.inactiveTimeSpent || 0) / 60)}m {(attempt.inactiveTimeSpent || 0) % 60}s
              </span>
              <span className="text-[9px] text-slate-500 block">Tab switch or window change</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Progress</span>
              <span className="text-sm font-bold text-[#0A192F] font-mono">
                {attempt.currentBlockIndex + 1} / {lessonBlocks.length} steps
              </span>
              <span className="text-[9px] text-slate-400 block">Lesson steps completed</span>
            </div>

            <div className={`border p-4 rounded-lg shadow-sm space-y-1 ${
              finalStatus === "excused" ? "bg-purple-50 border-purple-200" :
              finalStatus === "missing" ? "bg-rose-50 border-rose-200" :
              finalStatus === "pending" ? "bg-amber-50 border-amber-200" :
              "bg-white border-slate-200"
            }`}>
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Score</span>
              <span className={`text-sm font-bold font-mono flex items-center gap-1.5 ${
                finalStatus === "excused" ? "text-purple-700" :
                finalStatus === "missing" ? "text-rose-700" :
                finalStatus === "pending" ? "text-amber-700" :
                "text-indigo-700"
              }`}>
                {finalStatus === "excused" ? "Excused" :
                 finalStatus === "missing" ? "Missing" :
                 `${earnedPoints} / ${maxLessonPoints} pts`}
              </span>
              <span className="text-[9px] text-slate-400 block">
                {finalStatus === "excused" ? "Excluded from grade records" :
                 finalStatus === "missing" ? "No submission" :
                 finalStatus === "pending" ? `${scorePercentage}% — pending review` :
                 `${scorePercentage}%`}
              </span>
            </div>
          </div>

          </div>

          {/* Activity records Section */}
          <div ref={activityRef} id="section-activity" className="space-y-6 scroll-mt-6">

            {/* Academic Engagement & Pacing Hub */}
            <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-5">
            <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-2 uppercase tracking-wide flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              Academic Engagement & Pacing Hub
            </h4>

            {/* 7-day compact activity heatmap */}
            <div className="space-y-1.5 bg-slate-50 border border-slate-100 p-4 rounded-lg">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Activity over the last week</span>
              <div className="flex flex-wrap items-center gap-2">
                {get7DayActivityHeatmap(student.id, studentActivities).map((day) => (
                  <TooltipWrapper key={day.dateStr} day={day}>
                    <div className="flex flex-col items-center">
                      <span className="text-[8px] text-slate-400 font-bold mb-1">{day.dayLabel}</span>
                      <div className={`w-10 h-10 rounded-md border flex flex-col items-center justify-center transition ${
                        day.intensity === 'high'
                          ? 'bg-indigo-600 text-white border-indigo-700'
                          : day.intensity === 'medium'
                          ? 'bg-indigo-300 text-indigo-900 border-indigo-400 font-semibold'
                          : day.intensity === 'low'
                          ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                          : 'bg-white text-slate-300 border-slate-200'
                      }`}>
                        <span className="text-[11px] font-bold">{day.total}</span>
                        <span className="text-[7px] text-slate-400 uppercase tracking-tight font-sans">
                          {day.total === 1 ? 'act' : 'acts'}
                        </span>
                      </div>
                    </div>
                  </TooltipWrapper>
                ))}
              </div>
              <p className="text-[10px] text-slate-400">Hover or tap on any day to witness the hours and action details.</p>
            </div>

            {/* Specific Activity Timestamps Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-medium text-slate-600">
              <div className="space-y-1 p-2 bg-slate-50/50 rounded-lg border border-slate-100">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Started Lesson</span>
                <p className="text-slate-800 font-semibold">{renderFormattedDate(attempt.startedAt)}</p>
              </div>
              <div className="space-y-1 p-2 bg-slate-50/50 rounded-lg border border-slate-100">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Last Signed In</span>
                <p className="text-slate-800 font-semibold">{renderFormattedDate(lastSignedInTime)}</p>
              </div>
              <div className="space-y-1 p-2 bg-slate-50/50 rounded-lg border border-slate-100">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Last Lesson Activity</span>
                <p className="text-slate-800 font-semibold">{renderFormattedDate(lastLessonActivityTime)}</p>
              </div>
              <div className="space-y-1 p-2 bg-slate-50/50 rounded-lg border border-slate-100">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Last Response Submit</span>
                <p className="text-slate-800 font-semibold">{renderFormattedDate(lastResponseTime) || "No response submitted"}</p>
              </div>
              <div className="space-y-1 p-2 bg-slate-50/50 rounded-lg border border-slate-100">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Last Draft Autosave</span>
                <p className="text-slate-800 font-semibold">{renderFormattedDate(lastDraftSaveTime) || "No drafts autosaved"}</p>
              </div>
              <div className="space-y-1 p-2 bg-slate-50/50 rounded-lg border border-slate-100">
                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase block tracking-wider">Completed Lesson</span>
                <p className={`font-semibold ${isCompleted ? "text-emerald-700" : "text-slate-500 italic font-normal"}`}>
                  {isCompleted ? renderFormattedDate(lastCompletionTime) : "In progress"}
                </p>
              </div>
            </div>

            {/* Recent Academic Pacing & Engagement Log List */}
            <div className="space-y-2">
              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 font-bold block">Engagement History Logs</span>
              {sActivities.length === 0 ? (
                <div className="text-xs text-slate-400 italic py-2 border border-dashed border-slate-200 rounded-lg text-center bg-slate-50/30">
                  No active pacing logs recorded.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto bg-slate-50/20">
                  {sActivities.slice(0, 10).map((act) => (
                    <div key={act.id} className="p-2.5 text-xs flex justify-between items-start gap-4 hover:bg-slate-50 transition bg-white">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block shrink-0" />
                          <p className="text-slate-700 font-medium truncate">{act.description}</p>
                        </div>
                        <p className="text-[9px] text-slate-400 pl-3.5 font-mono">
                          {act.activityType.toUpperCase().replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span className="text-[9px] text-slate-400 font-mono shrink-0">
                        {renderFormattedDate(act.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          </div>

          {/* Timeline Section */}
          <div ref={timelineRef} id="section-timeline" className="space-y-6 scroll-mt-6">

            {/* Lesson progress timeline */}
            <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-2 uppercase tracking-wide flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              Lesson Steps
              <span className="text-slate-400 text-[10px] font-normal tracking-tight lowercase">({lessonBlocks.length} total)</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lessonBlocks
                .slice()
                .sort((a: any, b: any) => a.order - b.order)
                .map((block: any, idx: number) => {
                  const isReached = idx <= attempt.currentBlockIndex;
                  const blockCompleted = idx < attempt.currentBlockIndex || attempt.status === "completed";
                  const blockTimeSeconds = attempt.blockTimeSpent?.[block.id] || 0;
                  const furthestSeconds = attempt.furthestVideoTimestamps?.[block.id];

                  return (
                    <div
                      key={block.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-xs transition ${
                        blockCompleted
                          ? "bg-slate-50 border-slate-200"
                          : isReached
                          ? "bg-indigo-50/20 border-indigo-200/60"
                          : "opacity-40 bg-slate-50 border-transparent"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          blockCompleted
                            ? "bg-emerald-100 text-emerald-700"
                            : isReached
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {blockCompleted ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-slate-700 font-bold truncate">
                          {block.type === "video" ? (
                            <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : block.type === "question" ? (
                            <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <BookOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="truncate">{block.title}</span>
                        </div>
                        <div className="flex gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                          {blockTimeSeconds > 0 && (
                            <span>{Math.floor(blockTimeSeconds / 60)}m {blockTimeSeconds % 60}s</span>
                          )}
                          {block.type === "video" && furthestSeconds !== undefined && (
                            <span className="text-slate-500 font-semibold">{formatVideoTime(furthestSeconds)} watched</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          </div>

          {/* Integrity signals Section */}
          <div ref={signalsRef} id="section-signals" className="space-y-6 scroll-mt-6">

            {/* Integrity signals */}
            <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-3">
              <div className="flex flex-wrap justify-between items-center border-b border-slate-100 pb-2 gap-2">
                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2 uppercase tracking-wide">
                  <ShieldAlert className="w-4 h-4 text-amber-500" /> Integrity Signals
                </h4>
              <div className="flex flex-wrap gap-2">
                {totalSignals > 0 && (
                  <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    {totalSignals} {totalSignals === 1 ? "signal" : "signals"}
                  </span>
                )}
                {aiGuardSignals > 0 && (
                  <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                    {aiGuardSignals} signals of AI agent use
                  </span>
                )}
              </div>
            </div>

            {aiGuardSignals > 0 && (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1">
                <p className="font-semibold text-amber-900">Signals of AI agent use</p>
                <p className="text-amber-800 leading-relaxed">
                  This answer included content that may indicate a browser AI tool assisted with the response.
                </p>
                <p className="text-amber-700 leading-relaxed">
                  This is not automatic proof of a violation. Review the answer, timing, and other signals before making a decision. Grades are never changed automatically.
                </p>
              </div>
            )}

            {sSignals.length === 0 ? (
              <div className="py-4 text-xs font-bold text-emerald-800 bg-emerald-50 rounded-lg px-4 flex items-center gap-2 border border-emerald-200">
                <ShieldCheck className="w-4 h-4" />
                No activity signals recorded.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {sSignals.map((signal) => {
                  const isReviewed = reviewedSignals.has(signal.id);
                  return (
                    <div
                      key={signal.id}
                      className={`p-3 text-xs flex justify-between items-center gap-4 transition-all duration-200 ${
                        isReviewed
                          ? "bg-emerald-50/30 opacity-60 text-slate-400 border-l-4 border-emerald-400"
                          : "hover:bg-slate-50 bg-white"
                      }`}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded border tracking-wider ${
                              isReviewed
                                ? "bg-slate-100 text-slate-400 border-slate-200"
                                : signal.severity === "high"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-amber-50 text-amber-800 border-amber-200"
                            }`}
                          >
                            {signalEventLabel(signal.eventType)}
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono">
                            {renderFormattedDate(signal.timestamp)}
                          </span>
                        </div>
                        <p className={`font-sans ${isReviewed ? "text-slate-400" : "text-slate-600 font-medium"}`}>
                          {signal.metadata?.message || "Recorded during lesson"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {signal.videoTimestamp != null && (
                          <span className="text-[9px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                            {formatVideoTime(signal.videoTimestamp)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleSignal(signal.id)}
                          className={`text-[9px] font-mono font-bold px-2 py-1 rounded transition border cursor-pointer select-none ${
                            isReviewed
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {isReviewed ? "Checked" : "Mark checked"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </div>

          {/* Responses & Review Section */}
          <div ref={responsesRef} id="section-responses" className="space-y-6 scroll-mt-6">
            <div ref={reviewRef} id="section-review" className="space-y-6 scroll-mt-0">

              {/* Responses */}
              <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2 uppercase tracking-wide border-b border-slate-100 pb-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" /> Responses
            </h4>

            <div className="space-y-5">
              {lessonBlocks.map((block) => {
                const bResponse = sResponses.find((r) => r.blockId === block.id && !r.checkpointId);
                const isQuestionBlock = block.type === "question";
                const checkResponses = sResponses.filter((r) => r.blockId === block.id && r.checkpointId);

                const qBlock = getSnapshotBlock(block.id) || block;
                const questionDef = findQuestionDef(qBlock, bResponse);
                
                const maxPoints = qBlock.isPractice
                  ? 0
                  : questionDef?.points !== undefined
                  ? questionDef.points
                  : (qBlock.points || qBlock.singleQuestion?.points || 0);

                const activeSeconds = attempt.blockTimeSpent?.[block.id] || 0;

                return (
                  <div key={block.id} className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-4">
                    {/* Block header */}
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5 flex-wrap">
                        {block.type === "video" ? (
                          <Video className="w-3.5 h-3.5 text-slate-400" />
                        ) : block.type === "question" ? (
                          <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>{block.title}</span>
                        {activeSeconds > 0 && (
                          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1 ml-1 bg-slate-100 px-1.5 py-0.5 rounded">
                            <Clock className="w-3.5 h-3.5 text-slate-400" /> {formatActiveDuration(activeSeconds)} active
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-widest">
                        Step {(block.order ?? 0) + 1}
                      </span>
                    </div>

                    {/* Question block */}
                    {isQuestionBlock && (
                      <div className="text-xs space-y-3 pt-1">
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                          <span className="text-[9px] font-bold font-mono uppercase text-slate-400 block mb-1 tracking-wider">Question</span>
                          <div className="font-serif leading-relaxed text-slate-700 text-xs">
                            <RichContentRenderer
                              content={
                                questionDef?.stem ||
                                questionDef?.description ||
                                block.singleQuestion?.stem ||
                                block.questionPool?.description ||
                                "No question text."
                              }
                            />
                          </div>
                        </div>

                        {/* MCQ choices with grades in side panel */}
                        {questionDef?.type === "mc" && (
                          <div className="p-1">
                            {renderChoicesWithGrades(questionDef, bResponse?.responseValue)}
                          </div>
                        )}

                        {/* Short answer / rubric Categories in side panel */}
                        {qBlock.type === "question" && questionDef?.type !== "mc" && (
                          <div className="p-1">
                            {renderRubricDetails(questionDef)}
                          </div>
                        )}

                        {(() => {
                          const possibleQuestionIds: string[] = [];
                          if (questionDef?.id) possibleQuestionIds.push(questionDef.id);
                          if (block.singleQuestion?.id) possibleQuestionIds.push(block.singleQuestion.id);
                          if (block.questionPool?.questions) {
                            block.questionPool.questions.forEach((q: any) => {
                              if (q.id) possibleQuestionIds.push(q.id);
                            });
                          }

                          let draftText = "";
                          for (const id of possibleQuestionIds) {
                            if (attempt?.draftResponses?.[id]) {
                              draftText = attempt.draftResponses[id];
                              break;
                            }
                          }

                          const gradingStateLabel = getGradingStateLabel(bResponse, draftText);

                          if (bResponse) {
                            return (
                              <div className="space-y-3">
                                <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                                  <div className="flex justify-between items-center mb-2.5 pb-2 border-b border-slate-100 flex-wrap gap-2 text-xs">
                                    <span className="text-[9px] font-bold font-mono uppercase text-slate-400 tracking-wider">Response</span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {bResponse.type === "mc" ? (
                                        <span
                                          className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border ${
                                            bResponse.isCorrect
                                              ? "bg-emerald-50 text-emerald-800 border-emerald-250"
                                              : "bg-rose-50 text-rose-800 border-rose-250"
                                          }`}
                                        >
                                          {bResponse.isCorrect ? "Correct" : "Incorrect"}
                                        </span>
                                      ) : (
                                        <span
                                          className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border ${
                                            gradingStateLabel === "Feedback released"
                                              ? "bg-emerald-600 text-white border-transparent"
                                              : gradingStateLabel === "Reviewed, not released"
                                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                              : gradingStateLabel === "Needs teacher review"
                                              ? "bg-amber-50 text-amber-800 border-amber-250"
                                              : gradingStateLabel === "AI scored, awaiting teacher review"
                                              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                              : gradingStateLabel === "Submitted, awaiting AI grading"
                                              ? "bg-blue-50 text-blue-700 border-blue-200"
                                              : "bg-slate-100 text-slate-500 border-slate-200"
                                          }`}
                                        >
                                          {gradingStateLabel}
                                        </span>
                                      )}

                                      {bResponse.isLowEffort && (
                                        <span className="bg-rose-50 border border-rose-200 text-rose-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded">
                                          Short response flagged
                                        </span>
                                      )}

                                      {bResponse.teacherOverride && (
                                        <span className="bg-indigo-50 border border-indigo-205 text-indigo-850 text-[9px] font-mono font-bold px-2 py-0.5 rounded">
                                          Override applied
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="font-medium text-slate-805 text-[12px] bg-slate-50 border border-slate-150 p-2.5 rounded">
                                    {bResponse.type === "mc" ? (
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-slate-500 font-medium font-sans">Selected Choice:</span>
                                          <span className="text-slate-900 font-bold bg-white border border-slate-200 px-2 py-0.5 rounded font-mono">
                                            {resolveMultipleChoiceText(qBlock, bResponse.responseValue) ||
                                              selectedMultipleChoiceToLetterOrId(questionDef, bResponse.responseValue) ||
                                              bResponse.responseText ||
                                              "Selected choice unavailable"}
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="font-sans leading-relaxed text-slate-800 whitespace-pre-wrap">
                                        {bResponse.responseValue || (
                                          <span className="text-slate-400 italic">No response submitted</span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Score row */}
                                  <div className="mt-3 flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100">
                                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500">
                                      {bResponse.type === "mc" ? "Auto-graded Score" : "Current Score"}
                                    </span>
                                    <div className="text-[11px] font-mono font-bold text-slate-705">
                                      {bResponse.score} / {maxPoints} pts
                                    </div>
                                  </div>

                                  {/* Low effort detail */}
                                  {bResponse.isLowEffort && (
                                    <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-900 flex items-start gap-2">
                                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                      <div>
                                        <strong className="block text-rose-900 font-bold">Short response flagged</strong>
                                        <p className="text-xs text-rose-800 leading-relaxed mt-0.5">
                                          {bResponse.lowEffortReason || "Response was extremely short or lacked meaningful content."}
                                        </p>
                                      </div>
                                    </div>
                                  )}

                                  {/* AI grading detail */}
                                  {bResponse.type === "sa" && (
                                    (() => {
                                      const isPending = actionStates[bResponse.id]?.loading || bResponse.aiGrading?.status === "pending";
                                      const isFailed = bResponse.aiGrading?.status === "failed";
                                      
                                      if (isPending) {
                                        return (
                                          <div className="mt-3.5 bg-indigo-50/45 border border-indigo-155 rounded-lg p-5 space-y-3 text-xs text-indigo-950 flex flex-col items-center justify-center min-h-[120px]">
                                            <div className="w-5 h-5 border-2 border-indigo-600 border-t-indigo-200 rounded-full animate-spin"></div>
                                            <span className="text-[10px] font-mono font-bold tracking-wider text-indigo-650 uppercase">Running AI grading...</span>
                                          </div>
                                        );
                                      }

                                      if (isFailed) {
                                        return (
                                          <div className="mt-3.5 bg-rose-50 border border-rose-201 rounded-lg p-3.5 space-y-2 text-xs text-rose-955">
                                            <div className="flex items-start gap-2">
                                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                              <div>
                                                <strong className="block text-rose-900 font-bold">AI Grading Failed</strong>
                                                <p className="text-[11px] leading-relaxed text-rose-800 mt-1 whitespace-pre-wrap">
                                                  {bResponse.aiGrading?.errorMessage || "An unexpected error occurred during automated AI review. You can manually grade the response or retry using the button below."}
                                                </p>
                                              </div>
                                            </div>
                                            <div className="pt-2 flex justify-end">
                                              <button
                                                type="button"
                                                onClick={() => executeReviewAction('grade', bResponse.id)}
                                                disabled={actionStates[bResponse.id]?.loading}
                                                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10.5px] font-bold py-1.5 px-3 rounded flex items-center gap-1 transition cursor-pointer"
                                              >
                                                Run AI grading
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      }

                                      if (bResponse.aiGrading && bResponse.aiGrading.status !== "pending") {
                                        return (
                                          <div className="mt-3.5 bg-indigo-50/40 border border-indigo-155 rounded-lg p-3.5 space-y-2 text-xs text-indigo-950">
                                            <div className="flex justify-between items-center text-[10px] uppercase font-mono font-bold text-indigo-650 tracking-wider border-b border-indigo-100/60 pb-1.5">
                                              <span className="flex items-center gap-1.5 font-bold">
                                                <Bot className="w-3.5 h-3.5 text-indigo-505" />
                                                AI Assessment
                                              </span>
                                              {bResponse.aiGrading.confidence !== undefined && (
                                                <span>Confidence: {Math.round((bResponse.aiGrading.confidence || 0) * 100)}%</span>
                                              )}
                                            </div>
                                            {bResponse.aiGrading.feedback && (
                                              <div className="mb-2 bg-white/60 p-2.5 border border-indigo-100 rounded text-slate-755">
                                                <strong className="block text-[9.5px] uppercase font-mono text-indigo-550 mb-0.5">Student-facing Explanation:</strong>
                                                <p className="font-sans leading-relaxed text-indigo-950 font-medium">{bResponse.aiGrading.feedback}</p>
                                              </div>
                                            )}
                                            <div>
                                              <strong className="block text-[9.5px] uppercase font-mono text-indigo-550 mb-0.5">Teacher-only Justification / Rationale:</strong>
                                              <p className="font-sans leading-relaxed text-indigo-950 font-medium whitespace-pre-wrap leading-relaxed text-[11.5px]">
                                                {bResponse.aiGrading.rationale || "No rationale available."}
                                              </p>
                                            </div>
                                            {bResponse.aiGrading.rubricBreakdown && (
                                              <div className="text-[10px] pt-1.5 text-indigo-850 space-y-1">
                                                <span className="block text-[9px] text-indigo-600 tracking-wide uppercase font-bold mb-1.5 border-t border-indigo-100/30 pt-1.5">Rubric breakdown</span>
                                                {Object.entries(bResponse.aiGrading.rubricBreakdown).map(
                                                  ([criterion, item]: any) => (
                                                    <div
                                                      key={criterion}
                                                      className="bg-white/50 p-2 border border-indigo-100/20 rounded text-slate-700"
                                                    >
                                                      <div className="flex justify-between font-bold text-indigo-950 text-[10.5px]">
                                                        <span>{criterion}:</span>
                                                        <span>{item.score} pts</span>
                                                      </div>
                                                      {item.feedback && <p className="text-[10px] text-slate-605 leading-relaxed mt-0.5">{item.feedback}</p>}
                                                    </div>
                                                  )
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      }

                                      // No AI grading has been run yet
                                      return (
                                        <div className="mt-3.5 bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                                          <div className="space-y-0.5">
                                            <strong className="font-semibold text-slate-800 block text-[11.5px]">AI Grading Available</strong>
                                            <p className="text-slate-500 text-[10.5px] leading-normal">
                                              Automate scoring and generate rich student-facing commentary using the rubric for this question.
                                            </p>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => executeReviewAction('grade', bResponse.id)}
                                            disabled={actionStates[bResponse.id]?.loading}
                                            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10.5px] font-semibold py-1.5 px-3 rounded shrink-0 transition cursor-pointer"
                                          >
                                            Run AI grading
                                          </button>
                                        </div>
                                      );
                                    })()
                                  )}
                                </div>

                                {/* Teacher review panel with direct execution actions */}
                                <div className="p-4 bg-slate-50 border border-slate-205 rounded-lg space-y-3.5 text-xs">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                                    <span className="font-bold text-slate-705 text-[11px] uppercase tracking-wide">Teacher Review Tooling</span>
                                    {bResponse.type === "sa" && (
                                      (() => {
                                        const isReleased = !!(bResponse.feedbackReleasedAt || bResponse.aiFeedbackReleasedAt || bResponse.feedbackVisibleToStudent);
                                        return (
                                          <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border ${
                                            isReleased
                                              ? "bg-emerald-50 text-emerald-800 border-emerald-250"
                                              : "bg-slate-100 text-slate-600 border-slate-200"
                                          }`}>
                                            {isReleased ? (
                                              <span>
                                                Feedback released
                                                {bResponse.feedbackReleasedAt && (
                                                  <> on {new Date(bResponse.feedbackReleasedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                                                )}
                                              </span>
                                            ) : (
                                              "Draft Feedback"
                                            )}
                                          </span>
                                        );
                                      })()
                                    )}
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                    <div className="sm:col-span-1 space-y-1">
                                      <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Score</label>
                                      <input
                                        type="number"
                                        min="0"
                                        max={maxPoints}
                                        value={
                                          overrideScores[bResponse.id] !== undefined
                                            ? overrideScores[bResponse.id]
                                            : bResponse.teacherOverride?.score ?? bResponse.score ?? 0
                                        }
                                        onChange={(e) =>
                                          setOverrideScores({
                                            ...overrideScores,
                                            [bResponse.id]: Number(e.target.value),
                                          })
                                        }
                                        className="w-full text-xs font-mono font-bold text-center bg-white border border-slate-200 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400"
                                      />
                                    </div>
                                    <div className="sm:col-span-3 space-y-1">
                                      <label className="text-[9px] font-mono font-bold uppercase text-slate-505 block">Teacher notes (private)</label>
                                      <textarea
                                        value={
                                          overrideNotes[bResponse.id] !== undefined
                                            ? overrideNotes[bResponse.id]
                                            : bResponse.teacherOverride?.notes ?? bResponse.notes ?? ""
                                        }
                                        onChange={(e) =>
                                          setOverrideNotes({
                                            ...overrideNotes,
                                            [bResponse.id]: e.target.value,
                                          })
                                        }
                                        placeholder="Add notes or feedback…"
                                        rows={2}
                                        className="w-full text-xs bg-white border border-slate-250 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400 leading-normal"
                                      />
                                    </div>
                                  </div>

                                  {/* Student-facing feedback field (for Short Answer) */}
                                  {bResponse.type === "sa" && (
                                    <div className="space-y-1.5 pt-1">
                                      <label className="text-[9px] font-mono font-bold uppercase text-slate-505 block">
                                        Student-facing commentary (sent on release)
                                      </label>
                                      <textarea
                                        value={
                                          editedFeedbacks[bResponse.id] !== undefined
                                            ? editedFeedbacks[bResponse.id]
                                            : bResponse.studentFacingFeedback || bResponse.aiFeedback || bResponse.aiGrading?.rationale || ""
                                        }
                                        onChange={(e) =>
                                          setEditedFeedbacks({
                                            ...editedFeedbacks,
                                            [bResponse.id]: e.target.value,
                                          })
                                        }
                                        placeholder="Provide encouraging notes, commentary, or grading feedback description for the student..."
                                        rows={3}
                                        className="w-full text-xs bg-white border border-slate-200 rounded-md p-2 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400 leading-normal"
                                      />
                                    </div>
                                  )}

                                  <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-100 gap-2">
                                    <div className="flex gap-2 flex-wrap text-xs">
                                      {bResponse.type === "sa" && onReviewAction && (
                                        (() => {
                                          const isReleased = !!(bResponse.feedbackReleasedAt || bResponse.aiFeedbackReleasedAt || bResponse.feedbackVisibleToStudent);
                                          const isReviewed = !!(bResponse.teacherReviewedAt || (bResponse.teacherOverride?.score !== null && bResponse.teacherOverride?.score !== undefined));
                                          return (
                                            <>
                                              {/* Run AI grading button */}
                                              {!isReleased && (
                                                <button
                                                  type="button"
                                                  onClick={() => executeReviewAction('grade', bResponse.id)}
                                                  disabled={actionStates[bResponse.id]?.loading}
                                                  className="bg-slate-101 hover:bg-slate-200 text-slate-800 disabled:opacity-50 text-[10px] font-semibold py-1.5 px-3 rounded flex items-center gap-1 transition cursor-pointer"
                                                >
                                                  Run AI grading
                                                </button>
                                              )}

                                              {/* Approve AI score button */}
                                              {bResponse.aiGrading?.status === "success" && !isReviewed && !isReleased && (
                                                <button
                                                  type="button"
                                                  onClick={() => executeReviewAction('approve', bResponse.id)}
                                                  disabled={actionStates[bResponse.id]?.loading}
                                                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-semibold py-1.5 px-3 rounded flex items-center gap-1 transition cursor-pointer"
                                                >
                                                  Approve AI score
                                                </button>
                                              )}

                                              {/* Release feedback button */}
                                              {isReviewed && !isReleased && (
                                                <button
                                                  type="button"
                                                  onClick={() => executeReviewAction('release-feedback', bResponse.id)}
                                                  disabled={actionStates[bResponse.id]?.loading}
                                                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10px] font-semibold py-1.5 px-3 rounded flex items-center gap-1 transition pointer-events-auto cursor-pointer"
                                                >
                                                  Release feedback
                                                </button>
                                              )}
                                            </>
                                          );
                                        })()
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {(saveSuccess[bResponse.id] || actionStates[bResponse.id]?.success) && (
                                        <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 border border-emerald-250 px-3 py-1 rounded">
                                          <Check className="w-3 h-3" /> Saved
                                        </span>
                                      )}
                                      {actionStates[bResponse.id]?.error && (
                                        <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-205 px-2.5 py-1 rounded">
                                          {actionStates[bResponse.id]?.error}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleSaveOverrideAndNotes(
                                            bResponse.id,
                                            maxPoints
                                          )
                                        }
                                        disabled={savingState[bResponse.id] || actionStates[bResponse.id]?.loading}
                                        className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-300 text-white text-[10px] font-bold uppercase py-2 px-4 rounded transition flex items-center gap-1.5 cursor-pointer shadow-sm tracking-wider"
                                      >
                                        {savingState[bResponse.id] ? "Saving…" : "Save teacher review"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          if (draftText && draftText.trim() !== "") {
                            return (
                              <div className="p-3.5 bg-white border border-dashed border-amber-300 rounded-lg shadow-2xs">
                                <div className="flex justify-between items-center mb-2.5 pb-2 border-b border-slate-100 flex-wrap gap-2">
                                  <span className="text-[9px] font-bold font-mono uppercase text-amber-600 tracking-wider">Draft Response (Autosaved)</span>
                                  <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-mono">
                                    {gradingStateLabel}
                                  </span>
                                </div>
                                <div className="font-sans leading-relaxed text-slate-800 text-xs whitespace-pre-wrap bg-slate-50 border border-slate-150 p-2.5 rounded leading-relaxed">
                                  {draftText}
                                </div>
                                <div className="mt-2.5 text-[10.5px] text-slate-400 font-medium">
                                  The student has not submitted this answer for grading yet.
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="text-slate-400 text-xs italic bg-slate-50 p-3.5 rounded-lg border border-dashed border-slate-205 flex items-center gap-1.5 font-medium">
                              No response submitted or drafted yet.
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Video checkpoints */}
                    {block.type === "video" && block.videoCheckpoints && block.videoCheckpoints.length > 0 && (
                      <div className="space-y-4 pt-1">
                        <div className="bg-slate-50 p-2.5 rounded border border-slate-200 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-[10px] font-mono uppercase text-slate-500 font-bold tracking-wider">Video checkpoints</span>
                        </div>
                        {block.videoCheckpoints.map((cp: any) => {
                          const cpResp = sResponses.filter(
                            (r) => r.blockId === block.id && r.checkpointId === cp.id
                          );
                          const cpTimeSafe =
                            cp.timestamp !== undefined &&
                            cp.timestamp !== null &&
                            !isNaN(Number(cp.timestamp)) &&
                            Number(cp.timestamp) >= 0
                              ? formatVideoTime(Number(cp.timestamp))
                              : null;

                          const qBlock = getSnapshotBlock(block.id) || block;
                          const qCp = qBlock?.videoCheckpoints?.find((c: any) => c.id === cp.id) || cp;

                          return (
                            <div
                              key={cp.id}
                              className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 text-xs space-y-3"
                            >
                              <div className="flex justify-between items-center text-[10px] bg-white p-2 border border-slate-200 rounded font-semibold text-slate-700">
                                <span className="font-bold">{cp.title || "Checkpoint"}</span>
                                <span className="text-slate-500 font-mono text-[9px]">
                                  {cpTimeSafe ? `At ${cpTimeSafe}` : "Checkpoint"}
                                  {cp.isRequired ? " · Required" : " · Optional"}
                                </span>
                              </div>

                              {cpResp.length === 0 ? (
                                <span className="text-slate-400 italic block font-medium text-[11px] px-2">
                                  Not yet reached.
                                </span>
                              ) : (
                                cpResp.map((cr) => {
                                  const questionDef = findCheckpointQuestionDef(qCp, cr);
                                  const cpPoints = qCp.isPractice
                                    ? 0
                                    : questionDef?.points !== undefined
                                    ? questionDef.points
                                    : (qCp.points || questionDef?.points || 0);

                                  return (
                                    <div
                                      key={cr.id}
                                      className="p-3 bg-white border border-slate-200 rounded-lg mt-2 space-y-3"
                                    >
                                      {questionDef && (
                                        <div className="p-3 bg-indigo-50/10 border border-indigo-100 rounded-lg">
                                          <span className="text-[9px] font-bold font-mono uppercase text-indigo-500 block mb-1 tracking-wider">Checkpoint Question</span>
                                          <div className="font-serif leading-relaxed text-slate-700 text-xs">
                                            <RichContentRenderer content={questionDef.stem || questionDef.description || "No question text."} />
                                          </div>
                                        </div>
                                      )}

                                      {/* MCQ Choices representation */}
                                      {questionDef && questionDef.type === "mc" && (
                                        <div className="p-1">
                                          {renderChoicesWithGrades(questionDef, cr.responseValue)}
                                        </div>
                                      )}

                                      <div className="p-2.5 bg-slate-50 border border-slate-105 rounded">
                                        <span className="text-[9px] font-bold text-slate-400 tracking-wider font-mono uppercase block mb-1 pointer-events-none select-none">Response</span>
                                        <div className="font-bold text-slate-800 text-[11px]">
                                          {cr.type === "mc" ? (
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="text-slate-500 font-medium">Selected:</span>
                                              <span className="text-slate-900 font-bold bg-white px-2 py-0.5 border border-slate-200 rounded font-mono">
                                                {resolveMultipleChoiceText(qBlock, cr.responseValue) ||
                                                  selectedMultipleChoiceToLetterOrId(questionDef, cr.responseValue) ||
                                                  cr.responseText ||
                                                  "Selected choice unavailable"}
                                              </span>
                                            </div>
                                          ) : (
                                            cr.responseValue || (
                                              <span className="text-slate-400 italic">No response</span>
                                            )
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex items-center justify-between border-t border-slate-100 pt-2 flex-wrap gap-2">
                                        <div className="flex items-center gap-2 flex-wrap text-[9px] font-bold font-mono">
                                          {cr.type === "mc" ? (
                                            <span
                                              className={`px-2 py-0.5 rounded border ${
                                                cr.isCorrect
                                                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                                  : "bg-red-50 text-red-800 border-red-200"
                                              }`}
                                            >
                                              {cr.isCorrect ? "Correct" : "Incorrect"}
                                            </span>
                                          ) : (
                                            <span className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-2 py-0.5 rounded">
                                              AI scored
                                            </span>
                                          )}
                                          {cr.teacherOverride && (
                                            <span className="bg-indigo-50 border border-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                                              Override applied
                                            </span>
                                          )}
                                        </div>
                                        <span className="font-bold font-mono text-slate-600">
                                          {cr.score} / {cpPoints} pts
                                        </span>
                                      </div>

                                      {/* Checkpoint override */}
                                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5 text-[11px]">
                                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                                          <div className="sm:col-span-1 space-y-1">
                                            <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Score</label>
                                            <input
                                              type="number"
                                              min="0"
                                              max={cpPoints || 10}
                                              value={
                                                overrideScores[cr.id] !== undefined
                                                  ? overrideScores[cr.id]
                                                  : cr.teacherOverride?.score ?? cr.score ?? 0
                                              }
                                              onChange={(e) =>
                                                setOverrideScores({
                                                  ...overrideScores,
                                                  [cr.id]: Number(e.target.value),
                                                })
                                              }
                                              className="w-full text-xs font-mono font-bold text-center bg-white border border-slate-200 rounded p-1.5 focus:ring-0 focus:outline-none focus:border-slate-400"
                                            />
                                          </div>
                                          <div className="sm:col-span-3 space-y-1">
                                            <label className="text-[9px] font-mono font-bold uppercase text-slate-500 block">Notes</label>
                                            <input
                                              type="text"
                                              value={
                                                overrideNotes[cr.id] !== undefined
                                                  ? overrideNotes[cr.id]
                                                  : cr.teacherOverride?.notes ?? cr.notes ?? ""
                                              }
                                              onChange={(e) =>
                                                setOverrideNotes({
                                                  ...overrideNotes,
                                                  [cr.id]: e.target.value,
                                                })
                                              }
                                              placeholder="Teacher notes…"
                                              className="w-full text-xs bg-white border border-slate-200 rounded-md p-1.5 focus:ring-0 focus:outline-none focus:border-slate-400 font-medium placeholder:text-slate-400"
                                            />
                                          </div>
                                        </div>

                                        <div className="flex justify-between items-center">
                                          <div>
                                            {saveSuccess[cr.id] && (
                                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                                                <Check className="w-3 h-3" /> Saved
                                              </span>
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleSaveOverrideAndNotes(cr.id, cpPoints || 10)}
                                            disabled={savingState[cr.id]}
                                            className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-200 text-white text-[9px] font-bold uppercase py-1.5 px-3 rounded transition cursor-pointer shadow-sm"
                                          >
                                            {savingState[cr.id] ? "Saving…" : "Save Checkpoint Grade"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          </div>
          </div>

        </div>

        {/* Unsaved Changes Discard Confirmation Dialog */}
        {showDiscardConfirm && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-60 animate-fade-in">
            <div className="bg-white border border-slate-200 text-slate-800 shadow-2xl rounded-xl p-6 w-full max-w-md space-y-4">
              <h4 className="text-base font-bold text-slate-900">Discard unsaved changes?</h4>
              <p className="text-sm text-slate-600 leading-relaxed font-semibold">
                You have unsaved changes to student scores, notes, or feedback. Moving away will discard these changes.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    onClose();
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
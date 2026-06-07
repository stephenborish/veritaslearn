import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Plus, Trash, Settings, Save, AlertCircle, FileText, Video, Clock,
  ArrowUp, ArrowDown, BookOpen, Calendar, Eye, Play, CheckCircle,
  ChevronRight, ChevronLeft, HelpCircle, Info, Send, GraduationCap,
  BarChart2, Layers, Sparkles, ArrowRight, BookMarked, Lock, AlertTriangle
} from "lucide-react";
import { Lesson, LessonBlock } from "../../types";
import VideoUploader from "./VideoUploader";
import VideoSourcePicker from "./VideoSourcePicker";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import QuestionEditor, { validateQuestionClient } from "./QuestionEditor";
import LearningConditionsEditor, { buildDefaultPolicy, type IntegrityPolicy } from "./LearningConditionsEditor";
import {
  computeNextBestAction,
  lessonStatusLabel,
  modeLabel,
  type NextActionTarget,
  type ReadinessSeverity,
  calculateEstimatedLessonMinutes,
  formatEstimatedTime,
} from "./builderWorkflow";

function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

/**
 * Live state hook — the unified latest-authoring-state contract for top-level
 * lesson fields (description, title, settings, …) that mirrors the existing
 * `setCurrentBlocksLive` / `currentBlocksRef` protection used for blocks.
 *
 * Why this exists: RichContentEditor (Lexical) emits its onChange synchronously
 * on every keystroke, but the resulting `setState` is async. Any code that runs
 * before React re-renders — a navigation handler that unmounts the editor, an
 * autosave timer that already captured the old closure value, a Save/Publish
 * click, a local-recovery or dirty snapshot — would otherwise read a STALE value
 * and silently drop the teacher's most recent keystrokes.
 *
 * `setLive` updates the ref SYNCHRONOUSLY (before the React re-render) and then
 * schedules the normal state update. Snapshots/saves/autosaves read `ref.current`
 * (always the latest), while rendering still uses `state`. The returned setter
 * keeps the same call signature as a `useState` setter (value or updater) so
 * existing call sites need no changes.
 */
function useLiveState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => T, React.MutableRefObject<T>] {
  const [state, setState] = useState<T>(initial);
  const ref = useRef<T>(initial);
  const setLive = useCallback((next: T | ((prev: T) => T)): T => {
    const value = typeof next === "function" ? (next as (prev: T) => T)(ref.current) : next;
    ref.current = value;
    setState(value);
    return value;
  }, []);
  return [state, setLive, ref];
}

function newQuestionTemplate(type: "mc" | "sa"): any {
  const base = { id: uid("q"), type, stem: "", points: type === "mc" ? 1 : 3 };
  if (type === "mc") {
    const choices = [
      { id: uid("choice"), text: "" },
      { id: uid("choice"), text: "" },
      { id: uid("choice"), text: "" },
      { id: uid("choice"), text: "" },
    ];
    return { ...base, choices, correctChoiceId: choices[0].id, explanation: "" };
  }
  return { ...base, modelAnswer: "", answerKey: "", aiScoringGuidance: "", teacherNotes: "", rubricCategories: [] };
}

interface LessonsBuilderProps {
  lessons: Lesson[];
  blocks: LessonBlock[];
  attempts?: any[];
  onSaveLesson: (lessonData: any) => Promise<any>;
  onArchived: (id: string) => Promise<void>;
  assignments?: any[];
  onSaveAssignment?: (payload: any) => Promise<void>;
  onDeleteAssignment?: (id: string) => Promise<void>;
  onLaunchPreviewAttempt?: (lessonId: string) => Promise<void>;
  courses?: any[];
  onEditingDirtyChange?: (isDirty: boolean) => void;
  idToken?: string | null;
  onCollapseSidebar?: (collapsed: boolean) => void;
}

export default function LessonsBuilder({
  lessons,
  blocks,
  attempts = [],
  onSaveLesson,
  onArchived,
  assignments = [],
  onSaveAssignment,
  onDeleteAssignment,
  onLaunchPreviewAttempt,
  courses = [],
  onEditingDirtyChange,
  idToken,
  onCollapseSidebar,
}: LessonsBuilderProps) {
  const [selectedLesson, setSelectedLesson] = useState<any>(null);
  // Top-level lesson fields use the live-state contract (see useLiveState above) so
  // that snapshots, autosave, local recovery, and Save/Publish always read the
  // teacher's latest keystrokes — never a stale React closure. `description` is the
  // critical rich-text field; the others are included for a uniform contract.
  const [title, setTitle, titleRef] = useLiveState<string>("");
  const [description, setDescription, descriptionRef] = useLiveState<any>("");
  const [courseId, setCourseId, courseIdRef] = useLiveState<string>("");
  const [estimatedMinutes, setEstimatedMinutes, estimatedMinutesRef] = useLiveState<number>(30);
  const [isPublished, setIsPublished, isPublishedRef] = useLiveState<boolean>(false);
  const [restrictSeeking, setRestrictSeeking, restrictSeekingRef] = useLiveState<boolean>(true);
  const [requireFullscreen, setRequireFullscreen, requireFullscreenRef] = useLiveState<boolean>(true);
  const [allowRetakes, setAllowRetakes, allowRetakesRef] = useLiveState<boolean>(false);
  const [randomizeChoices, setRandomizeChoices, randomizeChoicesRef] = useLiveState<boolean>(true);
  const [immediateFeedback, setImmediateFeedback, immediateFeedbackRef] = useLiveState<boolean>(false);

  const [builderSubTab, setBuilderSubTab] = useState<"library" | "assignments">("library");

  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [asgLessonId, setAsgLessonId] = useState("");
  const [asgCourseId, setAsgCourseId] = useState("");
  const [asgSection, setAsgSection] = useState("");
  const [asgIntegrityPolicy, setAsgIntegrityPolicy] = useState<IntegrityPolicy>(buildDefaultPolicy("open"));
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

  const getDefaultOpenDate = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const getDefaultDueDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const getDefaultCloseDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  // activeWorkspace: "setup" | "publish" | "assign" | "preview" | number (block index)
  const [activeWorkspace, setActiveWorkspace] = useState<"setup" | "publish" | "assign" | "preview" | number>("setup");

  // Recovery draft loaded from localStorage when opening an editor
  const [recoveryDraft, setRecoveryDraft] = useState<any>(null);
  // The localStorage key for the current editing session's draft
  const activeDraftKeyRef = useRef<string>("");

  // Server-backed draft state
  const [serverDraft, setServerDraft] = useState<any>(null);
  const [serverDraftConflict, setServerDraftConflict] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  // Track whether server data was updated while we're actively editing
  const [serverDataUpdated, setServerDataUpdated] = useState(false);
  const editingStartedAtRef = useRef<string>("");
  const latestDraftClientUpdatedAtRef = useRef<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<"clean" | "saving" | "saved" | "error">("clean");
  const [isDirty, setIsDirty] = useState(false);
  const [initialSnapshotStr, setInitialSnapshotStr] = useState("");
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [postPublishLessonId, setPostPublishLessonId] = useState<string | null>(null);

  const [currentBlocks, setCurrentBlocks] = useState<any[]>([]);
  // Live ref — always holds the latest currentBlocks without stale-closure risk.
  // Updated synchronously by setCurrentBlocksLive before React renders the new state,
  // so any handler that runs immediately after a Lexical onChange will see the latest blocks.
  const currentBlocksRef = useRef<any[]>([]);

  // Reads from ref, computes next, writes ref synchronously, then schedules setState.
  // Returns the computed next value so callers can use it immediately (e.g. setActiveWorkspace).
  const setCurrentBlocksLive = (nextOrUpdater: any[] | ((prev: any[]) => any[])): any[] => {
    const prev = currentBlocksRef.current;
    const next = typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater;
    currentBlocksRef.current = next;
    setCurrentBlocks(next);
    return next;
  };

  // Synchronize and calculate estimatedMinutes live based on currentBlocks changes immediately
  useEffect(() => {
    if (!selectedLesson) return;
    const calc = calculateEstimatedLessonMinutes(currentBlocks);
    const roundedMinutes = calc.isIncomplete
      ? Math.max(1, Math.ceil(calc.minutes || 25))
      : Math.max(1, Math.ceil(calc.minutes));
    setEstimatedMinutes(roundedMinutes);
  }, [currentBlocks, selectedLesson, setEstimatedMinutes]);

  // Briefly highlights a freshly added block so the add feels satisfying.
  const [justAddedBlockId, setJustAddedBlockId] = useState<string | null>(null);

  const [asgOpensAt, setAsgOpensAt] = useState(getDefaultOpenDate());
  const [asgDueAt, setAsgDueAt] = useState(getDefaultDueDate());
  const [asgClosesAt, setAsgClosesAt] = useState(getDefaultCloseDate());
  const [asgError, setAsgError] = useState("");
  const [savedAssignmentConfirm, setSavedAssignmentConfirm] = useState<any>(null);

  // ---- Normalize helpers ----

  const ensureQuestionForBlock = (block: any): any => {
    if (block.type !== "question") return block;
    if (block.singleQuestion) {
      const q = block.singleQuestion;
      const normalizedQ = {
        ...q,
        id: q.id || uid("q"),
        choices: Array.isArray(q.choices)
          ? q.choices.map((c: any) => ({ ...c, id: c.id || uid("choice"), text: c.text ?? "" }))
          : [],
        rubricCategories: Array.isArray(q.rubricCategories)
          ? q.rubricCategories.map((r: any) => ({ ...r, id: r.id || uid("rub") }))
          : []
      };
      return {
        ...block,
        questionType: block.questionType || normalizedQ.type || "mc",
        singleQuestion: normalizedQ
      };
    }
    return {
      ...block,
      questionType: block.questionType || "mc",
      singleQuestion: newQuestionTemplate(block.questionType || "mc")
    };
  };

  const ensureQuestionForCheckpoint = (cp: any): any => {
    const questions = cp.questions || [];
    if (questions[0]) {
      const q = questions[0];
      const normalizedQ = {
        ...q,
        id: q.id || uid("q"),
        choices: Array.isArray(q.choices)
          ? q.choices.map((c: any) => ({ ...c, id: c.id || uid("choice"), text: c.text ?? "" }))
          : [],
        rubricCategories: Array.isArray(q.rubricCategories)
          ? q.rubricCategories.map((r: any) => ({ ...r, id: r.id || uid("rub") }))
          : []
      };
      return {
        ...cp,
        questionType: cp.questionType || normalizedQ.type || "mc",
        questions: [normalizedQ, ...questions.slice(1)]
      };
    }
    return {
      ...cp,
      questionType: cp.questionType || "mc",
      questions: [newQuestionTemplate(cp.questionType || "mc")]
    };
  };

  const normalizeBlocksForEditor = (raw: any[]): any[] =>
    raw.map((b) => {
      let out = ensureQuestionForBlock({ ...b });
      if (out.type === "video" && Array.isArray(out.videoCheckpoints)) {
        out = { ...out, videoCheckpoints: out.videoCheckpoints.map(ensureQuestionForCheckpoint) };
      }
      return out;
    });

  // Type-safe question type converter — preserves id, stem, points and nested data
  const convertQuestionType = (existing: any, nextType: "mc" | "sa"): any => {
    const q = existing || {};
    const finalPoints = nextType === "mc" ? 1 : 3;
    const base = {
      id: q.id || uid("q"),
      type: nextType,
      stem: q.stem ?? "",
      points: finalPoints,
    };

    if (nextType === "mc") {
      let choices = q.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        choices = [
          { id: uid("choice"), text: "" },
          { id: uid("choice"), text: "" },
          { id: uid("choice"), text: "" },
          { id: uid("choice"), text: "" },
        ];
      } else {
        choices = choices.map((c: any) => ({
          ...c,
          id: c.id || uid("choice"),
          text: c.text ?? ""
        }));
      }
      const correctChoiceId = q.correctChoiceId || (choices[0] && choices[0].id) || "";
      return { ...base, choices, correctChoiceId, explanation: q.explanation ?? "" };
    } else {
      return {
        ...base,
        modelAnswer: q.modelAnswer ?? "",
        aiScoringGuidance: q.aiScoringGuidance ?? "",
        teacherNotes: q.teacherNotes ?? "",
        rubricCategories: Array.isArray(q.rubricCategories)
          ? q.rubricCategories.map((r: any) => ({ ...r, id: r.id || uid("rub") }))
          : [],
        studentInstructions: q.studentInstructions ?? ""
      };
    }
  };

  // ---- Snapshot for dirty detection ----
  // Reads every field from its live ref (not React closure state) so the dirty
  // snapshot reflects the teacher's most recent keystrokes even mid-render.
  const getSnapshot = () => JSON.stringify({
    title: titleRef.current,
    description: descriptionRef.current,
    estimatedMinutes: estimatedMinutesRef.current,
    isPublished: isPublishedRef.current,
    restrictSeeking: restrictSeekingRef.current,
    requireFullscreen: requireFullscreenRef.current,
    allowRetakes: allowRetakesRef.current,
    randomizeChoices: randomizeChoicesRef.current,
    immediateFeedback: immediateFeedbackRef.current,
    currentBlocks: currentBlocksRef.current
  });

  // ---- Open editor for existing lesson ----
  const startEditing = (lesson: any) => {
    setSelectedLesson(lesson);
    setTitle(lesson.title);
    setDescription(lesson.description);
    setCourseId(lesson.courseId || "");
    setEstimatedMinutes(lesson.estimatedMinutes);
    setIsPublished(lesson.isPublished);
    setRestrictSeeking(lesson.settings.restrictSeeking);
    setRequireFullscreen(lesson.settings.requireFullscreen);
    setAllowRetakes(lesson.settings.allowRetakes);
    setRandomizeChoices(lesson.settings.randomizeChoices);
    setImmediateFeedback(lesson.settings.immediateFeedback);

    const lessonBlocks = blocks
      .filter((b) => b.lessonId === lesson.id)
      .sort((a, b) => a.order - b.order);

    const normalized = normalizeBlocksForEditor(lessonBlocks.map((b) => ({ ...b })));
    setCurrentBlocksLive(normalized);
    setActiveWorkspace("setup");
    setSaveStatus("clean");
    setSaveError(null);
    setServerDraft(null);
    setServerDraftConflict(false);
    setAutosaveStatus("idle");
    setServerDataUpdated(false);
    editingStartedAtRef.current = new Date().toISOString();

    const snap = JSON.stringify({
      title: lesson.title,
      description: lesson.description,
      courseId: lesson.courseId || "",
      estimatedMinutes: lesson.estimatedMinutes,
      isPublished: lesson.isPublished,
      restrictSeeking: lesson.settings.restrictSeeking,
      requireFullscreen: lesson.settings.requireFullscreen,
      allowRetakes: lesson.settings.allowRetakes,
      randomizeChoices: lesson.settings.randomizeChoices,
      immediateFeedback: lesson.settings.immediateFeedback,
      currentBlocks: normalized
    });
    setInitialSnapshotStr(snap);

    // Check for a local recovery draft (kept as fallback)
    const storageKey = `veritas_recovery_draft_${lesson.id}`;
    activeDraftKeyRef.current = storageKey;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && typeof draft.timestamp === "number") {
          setRecoveryDraft(draft);
        }
      } else {
        setRecoveryDraft(null);
      }
    } catch {
      setRecoveryDraft(null);
    }
    // Server draft is fetched asynchronously via useEffect watching selectedLesson.id
  };

  const startNewLesson = () => {
    setSelectedLesson({ id: "new" });
    setTitle("");
    setDescription("");
    setCourseId("");
    setEstimatedMinutes(25);
    setIsPublished(false);
    setRestrictSeeking(true);
    setRequireFullscreen(true);
    setAllowRetakes(false);
    setRandomizeChoices(true);
    setImmediateFeedback(false);
    setCurrentBlocksLive([]);
    setActiveWorkspace("setup");
    setSaveStatus("clean");
    setSaveError(null);
    setServerDraft(null);
    setServerDraftConflict(false);
    setAutosaveStatus("idle");
    setServerDataUpdated(false);
    editingStartedAtRef.current = new Date().toISOString();

    const snap = JSON.stringify({
      title: "", description: "", courseId: "", estimatedMinutes: 25, isPublished: false,
      restrictSeeking: true, requireFullscreen: true, allowRetakes: false,
      randomizeChoices: true, immediateFeedback: false, currentBlocks: []
    });
    setInitialSnapshotStr(snap);

    const storageKey = "veritas_recovery_draft_new";
    activeDraftKeyRef.current = storageKey;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && typeof draft.timestamp === "number") {
          setRecoveryDraft(draft);
        } else {
          setRecoveryDraft(null);
        }
      } else {
        setRecoveryDraft(null);
      }
    } catch {
      setRecoveryDraft(null);
    }
  };

  // ---- Block operations ----
  const handleAddBlock = (type: "video" | "reading" | "question") => {
    const freshId = "b_" + Math.random().toString(36).substring(2, 9);
    const newBlock: any = {
      id: freshId,
      type,
      title: type === "video" ? "Untitled Video" : type === "reading" ? "Untitled Reading" : "Untitled Question",
      videoCheckpoints: type === "video" ? [] : undefined,
      videoUrl: type === "video" ? "" : undefined,
      content: type === "reading" ? "" : undefined,
      questionType: type === "question" ? "mc" : undefined,
      isPractice: type === "question" ? false : undefined,
      singleQuestion: type === "question" ? newQuestionTemplate("mc") : undefined,
    };
    // Use functional updater so the new block is appended to the latest state even if a
    // Lexical onChange queued an update that React has not yet flushed.
    const nextBlocks = setCurrentBlocksLive((prev) => [...prev, newBlock]);
    setActiveWorkspace(nextBlocks.length - 1);
    setJustAddedBlockId(freshId);
    setTimeout(() => setJustAddedBlockId((id) => (id === freshId ? null : id)), 1400);
  };

  const handleDeleteBlock = (index: number) => {
    const nextBlocks = setCurrentBlocksLive((prev) => prev.filter((_: any, idx: number) => idx !== index));
    if (activeWorkspace === index) {
      setActiveWorkspace(nextBlocks.length > 0 ? Math.min(index, nextBlocks.length - 1) : "setup");
    } else if (typeof activeWorkspace === "number" && activeWorkspace > index) {
      setActiveWorkspace(activeWorkspace - 1);
    }
  };

  const moveBlock = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === currentBlocksRef.current.length - 1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    setCurrentBlocksLive((prev) => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = updated[targetIndex];
      updated[targetIndex] = temp;
      return updated;
    });
    if (activeWorkspace === index) setActiveWorkspace(targetIndex);
    else if (activeWorkspace === targetIndex) setActiveWorkspace(index);
  };

  const handleBlockChange = (index: number, key: string, val: any) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => (idx === index ? { ...block, [key]: val } : block))
    );
  };

  const handleBlockMultipleChanges = (index: number, changes: Record<string, any>) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => (idx === index ? { ...block, ...changes } : block))
    );
  };

  const handleBlockQuestionChange = (index: number, nextQuestionOrUpdater: any) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== index) return block;
        const currentQuestion = block.singleQuestion || newQuestionTemplate(block.questionType || "mc");
        const nextQuestion = typeof nextQuestionOrUpdater === "function"
          ? nextQuestionOrUpdater(currentQuestion)
          : nextQuestionOrUpdater;
        return { ...block, singleQuestion: { ...currentQuestion, ...nextQuestion } };
      })
    );
  };

  const handleBlockQuestionTypeChange = (index: number, nextType: "mc" | "sa") => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== index) return block;
        const converted = convertQuestionType(block.singleQuestion, nextType);
        return { ...block, questionType: nextType, singleQuestion: converted };
      })
    );
  };

  const handleVideoUploaded = (index: number, url: string, thumbnail?: string, duration?: number, storagePath?: string) => {
    setCurrentBlocksLive((prev: any[]) => {
      if (!prev[index]) return prev;
      const updated = [...prev];
      const latestBlock = updated[index];
      updated[index] = {
        ...latestBlock,
        videoSource: "upload" as const,
        videoUrl: url,
        youtubeVideoId: undefined,
        youtubeUrl: undefined,
        youtubeEmbedUrl: undefined,
        thumbnailUrl: thumbnail ?? latestBlock.thumbnailUrl ?? "",
        duration: duration ?? latestBlock.duration ?? 0,
        storagePath: storagePath ?? latestBlock.storagePath ?? "",
        videoCheckpoints: Array.isArray(latestBlock.videoCheckpoints) ? latestBlock.videoCheckpoints : [],
      };
      return updated;
    });
  };

  const handleVideoThumbnailSelected = (index: number, thumbnailUrl: string) => {
    setCurrentBlocksLive((prev: any[]) => {
      if (!prev[index]) return prev;
      const updated = [...prev];
      const latestBlock = updated[index];
      updated[index] = {
        ...latestBlock,
        videoUrl: latestBlock.videoUrl ?? "",
        thumbnailUrl,
        duration: latestBlock.duration ?? 0,
        storagePath: latestBlock.storagePath ?? "",
        videoCheckpoints: Array.isArray(latestBlock.videoCheckpoints) ? latestBlock.videoCheckpoints : [],
      };
      return updated;
    });
  };

  const handleYouTubeSelected = (
    index: number,
    videoId: string,
    youtubeUrl: string,
    embedUrl: string,
    thumbnailUrl: string,
    duration?: number,
  ) => {
    setCurrentBlocksLive((prev: any[]) => {
      if (!prev[index]) return prev;
      const updated = [...prev];
      const latestBlock = updated[index];
      updated[index] = {
        ...latestBlock,
        videoSource: "youtube" as const,
        videoUrl: youtubeUrl,
        youtubeVideoId: videoId,
        youtubeUrl,
        youtubeEmbedUrl: embedUrl,
        thumbnailUrl: thumbnailUrl || latestBlock.thumbnailUrl || "",
        duration: duration ?? latestBlock.duration,
        storagePath: "",
        videoCheckpoints: Array.isArray(latestBlock.videoCheckpoints) ? latestBlock.videoCheckpoints : [],
      };
      return updated;
    });
  };

  const handleDirectLinkSelected = (index: number, url: string) => {
    setCurrentBlocksLive((prev: any[]) => {
      if (!prev[index]) return prev;
      const updated = [...prev];
      const latestBlock = updated[index];
      updated[index] = {
        ...latestBlock,
        videoSource: "direct" as const,
        videoUrl: url,
        youtubeVideoId: undefined,
        youtubeUrl: undefined,
        youtubeEmbedUrl: undefined,
        storagePath: "",
        videoCheckpoints: Array.isArray(latestBlock.videoCheckpoints) ? latestBlock.videoCheckpoints : [],
      };
      return updated;
    });
  };

  // ---- Video checkpoint authoring ----
  const addCheckpoint = (blockIndex: number) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== blockIndex) return block;
        const cps = Array.isArray(block.videoCheckpoints) ? block.videoCheckpoints : [];
        const cp = {
          id: uid("cp"),
          timestamp: 30,
          title: `Checkpoint ${cps.length + 1}`,
          isRequired: true,
          pauseVideo: true,
          isPractice: false,
          questionType: "mc",
          numToSelect: 1,
          questions: [newQuestionTemplate("mc")]
        };
        return { ...block, videoCheckpoints: [...cps, cp] };
      })
    );
  };

  const updateCheckpoint = (blockIndex: number, cpId: string, partial: any) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== blockIndex) return block;
        const cps = (block.videoCheckpoints || []).map((cp: any) =>
          cp.id === cpId ? { ...cp, ...partial } : cp
        );
        return { ...block, videoCheckpoints: cps };
      })
    );
  };

  const updateCheckpointQuestion = (blockIndex: number, cpId: string, nextQuestionOrUpdater: any) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== blockIndex) return block;
        const cps = (block.videoCheckpoints || []).map((cp: any) => {
          if (cp.id !== cpId) return cp;
          const questions = Array.isArray(cp.questions) ? cp.questions : [];
          const currentQuestion = questions[0] || newQuestionTemplate(cp.questionType || "mc");
          const nextQuestion = typeof nextQuestionOrUpdater === "function"
            ? nextQuestionOrUpdater(currentQuestion)
            : nextQuestionOrUpdater;
          return { ...cp, questions: [{ ...currentQuestion, ...nextQuestion }, ...questions.slice(1)] };
        });
        return { ...block, videoCheckpoints: cps };
      })
    );
  };

  const updateCheckpointQuestionType = (blockIndex: number, cpId: string, nextType: "mc" | "sa") => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== blockIndex) return block;
        const cps = (block.videoCheckpoints || []).map((cp: any) => {
          if (cp.id !== cpId) return cp;
          const questions = Array.isArray(cp.questions) ? cp.questions : [];
          const converted = convertQuestionType(questions[0], nextType);
          return { ...cp, questionType: nextType, questions: [converted, ...questions.slice(1)] };
        });
        return { ...block, videoCheckpoints: cps };
      })
    );
  };

  const deleteCheckpoint = (blockIndex: number, cpId: string) => {
    setCurrentBlocksLive((prev: any[]) =>
      prev.map((block, idx) => {
        if (idx !== blockIndex) return block;
        return { ...block, videoCheckpoints: (block.videoCheckpoints || []).filter((cp: any) => cp.id !== cpId) };
      })
    );
  };

  // Automatically collapse sidebar when editor is opened
  useEffect(() => {
    if (selectedLesson && onCollapseSidebar) {
      onCollapseSidebar(true);
    }
  }, [selectedLesson, onCollapseSidebar]);

  // ---- Dirty state + auto-save draft ----
  useEffect(() => {
    if (!selectedLesson) {
      if (onEditingDirtyChange) onEditingDirtyChange(false);
      setIsDirty(false);
      return;
    }
    const currentStr = getSnapshot();
    const clean = !initialSnapshotStr || currentStr === initialSnapshotStr;
    setIsDirty(!clean);
    if (onEditingDirtyChange) onEditingDirtyChange(!clean);

    if (!clean && activeDraftKeyRef.current) {
      const timer = setTimeout(() => {
        // Read from live refs at fire time so a keystroke landing during the 1s
        // debounce is included in the recovery draft.
        localStorage.setItem(activeDraftKeyRef.current, JSON.stringify({
          timestamp: Date.now(),
          title: titleRef.current,
          description: descriptionRef.current,
          estimatedMinutes: estimatedMinutesRef.current,
          isPublished: isPublishedRef.current,
          restrictSeeking: restrictSeekingRef.current,
          requireFullscreen: requireFullscreenRef.current,
          allowRetakes: allowRetakesRef.current,
          randomizeChoices: randomizeChoicesRef.current,
          immediateFeedback: immediateFeedbackRef.current,
          currentBlocks: currentBlocksRef.current
        }));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [
    selectedLesson, title, description, estimatedMinutes, isPublished,
    restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback,
    currentBlocks, initialSnapshotStr
  ]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "You have unsaved changes on the Lesson Design Canvas.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // ---- Server draft: fetch when a lesson is opened ----
  useEffect(() => {
    if (!selectedLesson || selectedLesson.id === "new" || !idToken) return;
    const lessonId = selectedLesson.id;
    let cancelled = false;

    const fetchDraft = async () => {
      try {
        const res = await fetch(`/api/lessons/${lessonId}/draft`, {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.draft && data.draft.status === "active") {
          const lessonUpdatedAt = selectedLesson?.updatedAt || selectedLesson?.createdAt;
          const draftBaseAt = data.draft.baseLessonUpdatedAt;
          const hasConflict = !!(lessonUpdatedAt && draftBaseAt &&
            new Date(lessonUpdatedAt) > new Date(draftBaseAt));
          setServerDraft(data.draft);
          setServerDraftConflict(hasConflict);
          // Server draft supersedes localStorage draft
          setRecoveryDraft(null);
        }
      } catch {
        // Silently fail; localStorage recovery remains as fallback
      }
    };

    fetchDraft();
    return () => { cancelled = true; };
  }, [selectedLesson?.id, idToken]);

  // ---- Server draft: autosave on meaningful changes ----
  useEffect(() => {
    if (!selectedLesson || selectedLesson.id === "new" || !idToken) return;

    const currentStr = getSnapshot();
    if (!initialSnapshotStr || currentStr === initialSnapshotStr) return;

    const lessonId = selectedLesson.id;
    const baseLessonUpdatedAt = selectedLesson?.updatedAt || selectedLesson?.createdAt || new Date().toISOString();
    const capturedToken = idToken;
    const clientUpdatedAt = new Date().toISOString();
    latestDraftClientUpdatedAtRef.current = clientUpdatedAt;

    const timer = setTimeout(async () => {
      // Read every field from its live ref at execution time so any Lexical
      // onChange that landed after this effect ran but before the timer fired
      // (including rich-text fields like description) is captured.
      const capturedTitle = titleRef.current;
      const capturedDescription = descriptionRef.current;
      const capturedEstimatedMinutes = estimatedMinutesRef.current;
      const capturedIsPublished = isPublishedRef.current;
      const capturedSettings = {
        restrictSeeking: restrictSeekingRef.current,
        requireFullscreen: requireFullscreenRef.current,
        allowRetakes: allowRetakesRef.current,
        randomizeChoices: randomizeChoicesRef.current,
        immediateFeedback: immediateFeedbackRef.current,
      };
      const capturedBlocks = currentBlocksRef.current;
      setAutosaveStatus("saving");
      try {
        const res = await fetch(`/api/lessons/${lessonId}/draft`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${capturedToken}`
          },
          body: JSON.stringify({
            draftPayload: {
              title: capturedTitle,
              description: capturedDescription,
              estimatedMinutes: capturedEstimatedMinutes,
              isPublished: capturedIsPublished,
              settings: capturedSettings,
              blocks: capturedBlocks
            },
            baseLessonUpdatedAt,
            clientUpdatedAt
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.staleIgnored || latestDraftClientUpdatedAtRef.current !== clientUpdatedAt) return;
          setAutosaveStatus("saved");
          setTimeout(() => setAutosaveStatus((s: "idle" | "saving" | "saved" | "failed") => s === "saved" ? "idle" : s), 3000);
        } else {
          if (latestDraftClientUpdatedAtRef.current !== clientUpdatedAt) return;
          setAutosaveStatus("failed");
        }
      } catch {
        if (latestDraftClientUpdatedAtRef.current !== clientUpdatedAt) return;
        setAutosaveStatus("failed");
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [
    title, description, estimatedMinutes, isPublished,
    restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback,
    currentBlocks, selectedLesson?.id, idToken, initialSnapshotStr
  ]);

  // ---- Background refetch detection ----
  // If the parent re-fetches lessons while we're actively editing, note it but don't overwrite.
  useEffect(() => {
    if (!selectedLesson || selectedLesson.id === "new" || !isDirty) return;
    const serverLesson = lessons.find((l: any) => l.id === selectedLesson.id);
    if (!serverLesson?.updatedAt || !editingStartedAtRef.current) return;
    if (new Date(serverLesson.updatedAt) > new Date(editingStartedAtRef.current)) {
      setServerDataUpdated(true);
    }
  }, [lessons, selectedLesson?.id, isDirty]);

  // ---- Draft recovery handlers ----
  const handleRestoreDraft = () => {
    if (!recoveryDraft) return;
    setTitle(recoveryDraft.title ?? "");
    setDescription(recoveryDraft.description ?? "");
    setEstimatedMinutes(recoveryDraft.estimatedMinutes ?? 25);
    setIsPublished(recoveryDraft.isPublished ?? false);
    setRestrictSeeking(recoveryDraft.restrictSeeking ?? true);
    setRequireFullscreen(recoveryDraft.requireFullscreen ?? true);
    setAllowRetakes(recoveryDraft.allowRetakes ?? false);
    setRandomizeChoices(recoveryDraft.randomizeChoices ?? true);
    setImmediateFeedback(recoveryDraft.immediateFeedback ?? false);
    const restoredBlocks = normalizeBlocksForEditor(recoveryDraft.currentBlocks || []);
    setCurrentBlocksLive(restoredBlocks);
    if (typeof recoveryDraft.activeWorkspace !== "undefined") {
      setActiveWorkspace(recoveryDraft.activeWorkspace);
    }
    setRecoveryDraft(null);
    setSaveStatus("clean");
  };

  const handleDiscardDraft = () => {
    if (activeDraftKeyRef.current) {
      localStorage.removeItem(activeDraftKeyRef.current);
    }
    setRecoveryDraft(null);
  };

  // ---- Server draft handlers ----
  const handleRestoreServerDraft = () => {
    if (!serverDraft?.draftPayload) return;
    const p = serverDraft.draftPayload;
    setTitle(p.title ?? "");
    setDescription(p.description ?? "");
    setEstimatedMinutes(p.estimatedMinutes ?? 25);
    setIsPublished(p.isPublished ?? false);
    setRestrictSeeking(p.settings?.restrictSeeking ?? true);
    setRequireFullscreen(p.settings?.requireFullscreen ?? true);
    setAllowRetakes(p.settings?.allowRetakes ?? false);
    setRandomizeChoices(p.settings?.randomizeChoices ?? true);
    setImmediateFeedback(p.settings?.immediateFeedback ?? false);
    const restoredBlocks = normalizeBlocksForEditor(p.blocks || []);
    setCurrentBlocksLive(restoredBlocks);
    setServerDraft(null);
    setServerDraftConflict(false);
    setSaveStatus("clean");
  };

  const handleDiscardServerDraft = async () => {
    const lessonId = selectedLesson?.id;
    setServerDraft(null);
    setServerDraftConflict(false);
    if (idToken && lessonId && lessonId !== "new") {
      try {
        await fetch(`/api/lessons/${lessonId}/draft`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` }
        });
      } catch {
        // Best-effort; ignore failures
      }
    }
  };

  // ---- Save logic ----
  // Returns the canonical saved lesson (with .id and .blocks) or null on failure
  const saveWithPublishedStatus = async (publishedStatus: boolean): Promise<any | null> => {
    setSaveError(null);

    if (publishedStatus) {
      const problems: string[] = [];
      currentBlocksRef.current.forEach((b: any, i: number) => {
        if (b.type === "question" && b.singleQuestion) {
          validateQuestionClient(b.singleQuestion, b.questionType || "mc", !b.isPractice).forEach((e) =>
            problems.push(`Block ${i + 1}: ${e}`)
          );
        }
        if (b.type === "video" && Array.isArray(b.videoCheckpoints)) {
          b.videoCheckpoints.forEach((cp: any, ci: number) => {
            const q = (cp.questions || [])[0];
            if (q)
              validateQuestionClient(q, cp.questionType || "mc", !cp.isPractice).forEach((e) =>
                problems.push(`Block ${i + 1} checkpoint ${ci + 1}: ${e}`)
              );
          });
        }
      });
      if (problems.length > 0) {
        setSaveError(problems);
        setSaveStatus("error");
        return null;
      }
    }

    // Read from live refs so a Save/Publish click immediately after the last
    // keystroke persists the latest authoritative state (not a stale closure).
    const payload = {
      id: selectedLesson?.id === "new" ? undefined : selectedLesson?.id,
      title: titleRef.current,
      description: descriptionRef.current,
      courseId: courseIdRef.current,
      estimatedMinutes: estimatedMinutesRef.current,
      isPublished: publishedStatus,
      settings: {
        restrictSeeking: restrictSeekingRef.current,
        requireFullscreen: requireFullscreenRef.current,
        allowRetakes: allowRetakesRef.current,
        randomizeChoices: randomizeChoicesRef.current,
        immediateFeedback: immediateFeedbackRef.current,
      },
      blocks: currentBlocksRef.current
    };

    setSaveStatus("saving");
    try {
      const savedResult = await onSaveLesson(payload);
      setSaveStatus("saved");
      setLastSavedAt(new Date());
      setTimeout(() => setSaveStatus("clean"), 3000);

      // Clear the localStorage draft
      if (activeDraftKeyRef.current) {
        localStorage.removeItem(activeDraftKeyRef.current);
      }

      // Discard server draft (best-effort, non-blocking)
      const savedLessonId = savedResult?.id || (selectedLesson?.id !== "new" ? selectedLesson?.id : null);
      if (idToken && savedLessonId) {
        fetch(`/api/lessons/${savedLessonId}/draft`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` }
        }).catch(() => {});
      }
      setServerDraft(null);
      setServerDraftConflict(false);
      setAutosaveStatus("idle");
      setServerDataUpdated(false);

      if (savedResult && savedResult.id) {
        // Update state with canonical saved data
        setSelectedLesson(savedResult);
        editingStartedAtRef.current = savedResult.updatedAt || new Date().toISOString();
        // Switch draft key to the real lesson ID
        const newKey = `veritas_recovery_draft_${savedResult.id}`;
        activeDraftKeyRef.current = newKey;

        const resolvedBlocks = normalizeBlocksForEditor(savedResult.blocks || []);
        setCurrentBlocksLive(resolvedBlocks);

        // Sync BOTH React state and the live refs to the canonical saved values so
        // the editor (and every subsequent snapshot/autosave/recovery read) stays
        // consistent with what the server persisted. setLive setters update refs
        // synchronously, so the snapshot below reads the canonical values.
        setTitle(savedResult.title ?? titleRef.current);
        setDescription(savedResult.description ?? descriptionRef.current);
        setEstimatedMinutes(savedResult.estimatedMinutes ?? estimatedMinutesRef.current);
        setIsPublished(savedResult.isPublished);
        setRestrictSeeking(savedResult.settings?.restrictSeeking ?? restrictSeekingRef.current);
        setRequireFullscreen(savedResult.settings?.requireFullscreen ?? requireFullscreenRef.current);
        setAllowRetakes(savedResult.settings?.allowRetakes ?? allowRetakesRef.current);
        setRandomizeChoices(savedResult.settings?.randomizeChoices ?? randomizeChoicesRef.current);
        setImmediateFeedback(savedResult.settings?.immediateFeedback ?? immediateFeedbackRef.current);

        const newSnap = JSON.stringify({
          title: titleRef.current,
          description: descriptionRef.current,
          estimatedMinutes: estimatedMinutesRef.current,
          isPublished: isPublishedRef.current,
          restrictSeeking: restrictSeekingRef.current,
          requireFullscreen: requireFullscreenRef.current,
          allowRetakes: allowRetakesRef.current,
          randomizeChoices: randomizeChoicesRef.current,
          immediateFeedback: immediateFeedbackRef.current,
          currentBlocks: resolvedBlocks
        });
        setInitialSnapshotStr(newSnap);
      } else {
        setInitialSnapshotStr(JSON.stringify({
          title: titleRef.current,
          description: descriptionRef.current,
          estimatedMinutes: estimatedMinutesRef.current,
          isPublished: publishedStatus,
          restrictSeeking: restrictSeekingRef.current,
          requireFullscreen: requireFullscreenRef.current,
          allowRetakes: allowRetakesRef.current,
          randomizeChoices: randomizeChoicesRef.current,
          immediateFeedback: immediateFeedbackRef.current,
          currentBlocks: currentBlocksRef.current
        }));
      }
      return savedResult || null;
    } catch (e: any) {
      console.error("Failed to save lesson", e);
      setSaveStatus("error");
      setSaveError([e.message || "Failed to save lesson. Please verify connectivity."]);
      return null;
    }
  };

  const handleReturnToLibrary = () => {
    if (isDirty) {
      const hasDraft = !!(serverDraft || activeDraftKeyRef.current);
      const draftNote = hasDraft
        ? "Your draft has been saved and can be recovered when you return."
        : "Unsaved changes will be lost.";
      if (window.confirm(`You have unsaved changes. Return to library? ${draftNote}`)) {
        setSelectedLesson(null);
        setServerDraft(null);
        setServerDraftConflict(false);
        setAutosaveStatus("idle");
        setServerDataUpdated(false);
      }
    } else {
      setSelectedLesson(null);
      setServerDraft(null);
      setServerDraftConflict(false);
      setAutosaveStatus("idle");
      setServerDataUpdated(false);
    }
  };

  const handleSaveAsDraft = async () => {
    await saveWithPublishedStatus(false);
  };

  const handlePublishLive = () => {
    setSaveError(null);
    const { issues } = computeReadiness();
    if (issues.length > 0) {
      setSaveError(issues.map((i) => i.message));
      setSaveStatus("error");
      return;
    }
    setShowPublishConfirm(true);
  };

  const handleConfirmPublish = async () => {
    setShowPublishConfirm(false);
    const saved = await saveWithPublishedStatus(true);
    if (saved && saved.id) {
      setPostPublishLessonId(saved.id);
    }
  };

  const handleAssignAndLaunch = async () => {
    const savedLesson = await saveWithPublishedStatus(isPublished);
    if (savedLesson && savedLesson.id) {
      setAsgLessonId(savedLesson.id);
      if (savedLesson.courseId) {
        setAsgCourseId(savedLesson.courseId);
        const selectedC = courses.find((c: any) => c.id === savedLesson.courseId);
        setAsgSection(selectedC?.sectionName || "");
      } else if (courseId) {
        setAsgCourseId(courseId);
        const selectedC = courses.find((c: any) => c.id === courseId);
        setAsgSection(selectedC?.sectionName || "");
      }
      setEditingAssignmentId(null);
      setActiveWorkspace("assign");
    }
  };

  const handlePreviewAsStudent = async () => {
    if (!onLaunchPreviewAttempt) return;
    if (selectedLesson?.id === "new" || isDirty) {
      // Save first so preview reflects current state
      const savedLesson = await saveWithPublishedStatus(isPublished);
      if (!savedLesson || !savedLesson.id) return; // save failed
      await onLaunchPreviewAttempt(savedLesson.id);
    } else {
      await onLaunchPreviewAttempt(selectedLesson.id);
    }
  };

  // ---- Next best action navigation ----
  // Sends the teacher to the single most useful next step. Pure routing only.
  const goToAction = (target: NextActionTarget) => {
    if (target === "publish") { setEditingAssignmentId(null); setActiveWorkspace("publish"); return; }
    if (target === "assign") { handleAssignAndLaunch(); return; }
    if (target === "preview") { setEditingAssignmentId(null); setActiveWorkspace("preview"); return; }
    if (target === "progress") {
      setSelectedLesson(null);
      setBuilderSubTab("assignments");
      return;
    }
    setEditingAssignmentId(null);
    setActiveWorkspace(target as "setup" | number);
  };

  // ---- Assignment form ----
  const handleCreateAssignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAsgError("");
    if (!asgLessonId) { setAsgError("Please select a lesson plan to assign."); return; }
    if (!asgCourseId.trim()) { setAsgError("Please select a course."); return; }
    if (new Date(asgOpensAt) >= new Date(asgDueAt)) { setAsgError("Opening date must be before due date."); return; }
    if (new Date(asgDueAt) > new Date(asgClosesAt)) { setAsgError("Due date must be on or before closing date."); return; }
    if (onSaveAssignment) {
      const selectedCourse = courses.find((c: any) => c.id === asgCourseId.trim());
      const selectedLessonObj = lessons.find((l: any) => l.id === asgLessonId);
      
      const payload = {
        lessonId: asgLessonId,
        courseId: asgCourseId.trim(),
        section: asgSection.trim(),
        opensAt: new Date(asgOpensAt).toISOString(),
        dueAt: new Date(asgDueAt).toISOString(),
        closesAt: new Date(asgClosesAt).toISOString(),
        integrityPolicy: asgIntegrityPolicy,
      };

      await onSaveAssignment(payload);

      setSavedAssignmentConfirm({
        lessonTitle: selectedLessonObj?.title || selectedLesson?.title || "Lesson",
        courseName: selectedCourse?.name || asgCourseId.trim(),
        section: asgSection.trim() || "All Sections",
        opensAt: asgOpensAt,
        dueAt: asgDueAt,
        closesAt: asgClosesAt,
        integrityPolicy: asgIntegrityPolicy,
      });

      setShowAssignmentForm(false);
      setAsgLessonId("");
      setAsgCourseId("");
      setAsgSection("");
      setAsgIntegrityPolicy(buildDefaultPolicy("open"));
    }
  };

  // ---- Readiness computation ----
  type ReadinessIssue = { message: string; target: "setup" | number; severity?: ReadinessSeverity };
  const computeReadiness = (): {
    issues: ReadinessIssue[];
    warnings: ReadinessIssue[];
    attention: ReadinessIssue[];
    optional: ReadinessIssue[];
    gradedQCount: number;
    practiceQCount: number;
    videoCount: number;
    readingCount: number;
    aiGradedCount: number;
    checkpointCount: number;
  } => {
    const issues: ReadinessIssue[] = [];
    const warnings: ReadinessIssue[] = [];
    let gradedQCount = 0, practiceQCount = 0, videoCount = 0, readingCount = 0, aiGradedCount = 0, checkpointCount = 0;

    if (!title || !title.trim()) {
      issues.push({ message: "Add a lesson title in Setup.", target: "setup" });
    }
    if (currentBlocksRef.current.length === 0) {
      issues.push({ message: "Add at least one video, reading, or question.", target: "setup" });
    }

    // Advanced question inspector
    const checkQuestion = (q: any, blockIdx: number, contextLabel: string, isPractice: boolean) => {
      if (!q) {
        issues.push({ message: `${contextLabel} needs a question.`, target: blockIdx });
        return;
      }

      const isMc = q.type === "mc";
      const isSa = q.type === "sa";

      // Stem/Prompt empty check
      const stemText = q.stem ? (typeof q.stem === "string" ? q.stem : (q.stem.plainText || "")) : "";
      if (!stemText.trim()) {
        issues.push({ message: `${contextLabel} needs a question prompt.`, target: blockIdx });
      }

      if (isMc) {
        const nonBlank = (q.choices || []).filter((c: any) => isChoiceNonBlank(c));
        const blank = (q.choices || []).filter((c: any) => !isChoiceNonBlank(c));

        if (!q.choices || q.choices.length === 0 || nonBlank.length === 0) {
          issues.push({ message: `${contextLabel} needs answer choices.`, target: blockIdx });
        } else if (nonBlank.length < 2) {
          issues.push({ message: `${contextLabel} needs at least two answer choices.`, target: blockIdx });
        }

        if (blank.length > 0) {
          issues.push({ message: `${contextLabel} has a blank answer choice.`, target: blockIdx });
        }

        if (!q.correctChoiceId) {
          issues.push({ message: `${contextLabel} needs a correct answer.`, target: blockIdx });
        }
      } else if (isSa) {
        // SA Prompt vs rubric vs model answers
        const modelAnsText = q.modelAnswer ? (typeof q.modelAnswer === "string" ? q.modelAnswer : (q.modelAnswer.plainText || "")) : "";
        const isModelAnsMissing = !modelAnsText.trim();

        const guidanceText = q.aiScoringGuidance ? (typeof q.aiScoringGuidance === "string" ? q.aiScoringGuidance : (q.aiScoringGuidance.plainText || "")) : "";
        const isGuidanceMissing = !guidanceText.trim();

        if (!isPractice) {
          // Assessment short-answers — these rely on a rubric for AI scoring.
          if (isModelAnsMissing) {
            warnings.push({ message: `${contextLabel}: add a model answer so AI scoring has a reference.`, target: blockIdx, severity: "attention" });
          }
          if (isGuidanceMissing) {
            warnings.push({ message: `${contextLabel}: add scoring guidance so AI knows what to look for.`, target: blockIdx, severity: "attention" });
          }

          if (!q.rubricCategories || q.rubricCategories.length === 0) {
            issues.push({ message: `${contextLabel}: short answer needs a rubric for scoring.`, target: blockIdx });
          } else {
            const rubricTotal = (q.rubricCategories as any[]).reduce((s: number, r: any) => s + (Number(r.maxPoints) || 0), 0);
            if (q.points > 0 && rubricTotal !== q.points) {
              issues.push({ message: `${contextLabel}: rubric totals ${rubricTotal} pts, but the question is worth ${q.points}.`, target: blockIdx });
            }
          }
        } else {
          // Practice short answers — feedback quality only, never blocking.
          if (isModelAnsMissing) {
            warnings.push({ message: `${contextLabel}: add a model answer to improve practice feedback.`, target: blockIdx, severity: "optional" });
          }
        }
      }
    };

    currentBlocksRef.current.forEach((b: any, i: number) => {
      const blockLabel = b.title?.trim() ? `”${b.title.trim()}”` : `Block ${i + 1}`;
      if (!b.title?.trim()) {
        issues.push({ message: `Block ${i + 1} needs a title.`, target: i });
      }

      if (b.type === "video") {
        videoCount++;
        if (!b.videoUrl && !b.storagePath) {
          issues.push({ message: `${blockLabel} needs a video.`, target: i });
        }
        const cps: any[] = b.videoCheckpoints || [];
        cps.forEach((cp: any, ci: number) => {
          checkpointCount++;
          const tsLabel = formatTimestamp(cp.timestamp);
          const checkpointLabel = `${blockLabel} checkpoint at ${tsLabel}`;
          const q = cp.questions?.[0];

          if (cp.timestamp === undefined || cp.timestamp < 0) {
            issues.push({ message: `${blockLabel}: a checkpoint needs a valid time.`, target: i });
          }

          if (cp.isPractice) {
            practiceQCount++;
            if (q) {
              checkQuestion(q, i, checkpointLabel, true);
            }
          } else {
            gradedQCount++;
            if (!q) {
              issues.push({ message: `${checkpointLabel} needs a question.`, target: i });
            } else {
              if (q.type === "sa") aiGradedCount++;
              checkQuestion(q, i, checkpointLabel, false);
            }
          }
        });
      } else if (b.type === "reading") {
        readingCount++;
        const hasContent = typeof b.content === "string"
          ? b.content.trim().length > 0
          : !!(b.content?.plainText?.trim() || b.content?.html?.replace(/<[^>]*>/g, "").trim());
        if (!hasContent) {
          issues.push({ message: `${blockLabel} needs reading content.`, target: i });
        }
      } else if (b.type === "question" && b.singleQuestion) {
        const isPractice = !!b.isPractice;
        if (isPractice) {
          practiceQCount++;
          checkQuestion(b.singleQuestion, i, blockLabel, true);
        } else {
          gradedQCount++;
          if (b.singleQuestion.type === "sa") aiGradedCount++;
          checkQuestion(b.singleQuestion, i, blockLabel, false);
        }
      }
    });

    // Publishing-state notes — never blockers, just gentle guidance toward the next step.
    if (selectedLesson && selectedLesson.id && selectedLesson.id !== "new") {
      if (!isPublished) {
        warnings.push({ message: "Not published yet — publish so this lesson can be assigned.", target: "setup", severity: "optional" });
      } else {
        const lessonAssignments = (assignments || []).filter((a: any) => a.lessonId === selectedLesson.id);
        if (lessonAssignments.length === 0) {
          warnings.push({ message: "Published, not assigned — assign it to a course so students can start.", target: "setup", severity: "optional" });
        } else {
          const activeCourseIds = new Set((courses || []).map((c: any) => c.id));
          const hasUnassignedActiveCourse = lessonAssignments.some((a: any) => !activeCourseIds.has(a.courseId));
          if (hasUnassignedActiveCourse) {
            warnings.push({ message: "Assigned to a course that is archived or missing — re-assign to an active course.", target: "setup", severity: "attention" });
          }
        }
      }
    }

    const attention = warnings.filter((w) => w.severity === "attention");
    const optional = warnings.filter((w) => w.severity !== "attention");
    return { issues, warnings, attention, optional, gradedQCount, practiceQCount, videoCount, readingCount, aiGradedCount, checkpointCount };
  };

  function isChoiceNonBlank(c: any): boolean {
    if (!c) return false;
    const t = c.text;
    if (!t) return false;
    if (typeof t === "string") return t.trim().length > 0;
    if (typeof t === "object") {
      const plain = (t.plainText || "").trim();
      const html = (t.html || "").replace(/<[^>]*>/g, "").trim();
      return plain.length > 0 || html.length > 0;
    }
    return false;
  }

  // ---- Canvas rendering helpers ----

  const blockTypeConfig = (type: string) => {
    if (type === "video") return { icon: Video, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", accent: "border-l-blue-500", label: "Video" };
    if (type === "reading") return { icon: FileText, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200", accent: "border-l-purple-500", label: "Reading" };
    return { icon: HelpCircle, color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", accent: "border-l-emerald-500", label: "Question" };
  };

  // =================== RENDER ===================
  return (
    <div className="space-y-0 font-sans">
      {!selectedLesson ? (
        // ---- Library / Assignments list view ----
        <div className="space-y-6">
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setBuilderSubTab("library")}
              className={`pb-3 px-4 font-sans text-xs font-bold uppercase tracking-wider border-b-2 transition ${builderSubTab === "library" ? "border-[#0A192F] text-[#0A192F]" : "border-transparent text-slate-400 hover:text-slate-600"}`}
            >
              Lessons
            </button>
            <button
              onClick={() => setBuilderSubTab("assignments")}
              className={`pb-3 px-4 font-sans text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-1.5 ${builderSubTab === "assignments" ? "border-[#0A192F] text-[#0A192F]" : "border-transparent text-slate-400 hover:text-slate-600"}`}
            >
              <Calendar className="w-4 h-4" /> Assignments
            </button>
          </div>

          {builderSubTab === "library" ? (
            <div className="space-y-6">
              <div className="flex justify-end mb-4">
                <button
                  onClick={startNewLesson}
                  className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm tracking-wider uppercase"
                >
                  <Plus className="w-4 h-4" /> New lesson
                </button>
              </div>
              {lessons.length === 0 && (
                <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <BookMarked className="w-9 h-9 mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold text-slate-600">No lessons yet</p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">Create your first lesson — add a video, reading, or question, then publish and assign it.</p>
                  <button onClick={startNewLesson} className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded inline-flex items-center gap-1.5 cursor-pointer">
                    <Plus className="w-4 h-4" /> New lesson
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {lessons.map((lesson) => {
                  const now = new Date().toISOString();
                  const lessonAsgs = assignments.filter((asg) => asg.lessonId === lesson.id);
                  const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id);
                  const videoCount = lessonBlocks.filter((b) => b.type === "video").length;
                  const readingCount = lessonBlocks.filter((b) => b.type === "reading").length;
                  const practiceCount = lessonBlocks.filter((b) => b.type === "question" && b.isPractice).length;
                  const gradedCount = lessonBlocks.filter((b) => b.type === "question" && !b.isPractice).length;

                  return (
                    <div key={lesson.id} className="bg-white border text-slate-800 border-slate-250 p-6 rounded shadow-sm hover:border-slate-300 hover:shadow-md transition flex flex-col justify-between min-h-[300px] font-sans">
                      <div className="space-y-4">
                        <div className="flex justify-between items-start gap-4">
                          <h3 className="text-base font-bold text-slate-900 tracking-tight text-left">{lesson.title || "Untitled lesson"}</h3>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${lesson.isPublished ? (lessonAsgs.length > 0 ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-emerald-50 text-emerald-700 border-emerald-200") : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                              {lesson.isPublished ? (lessonAsgs.length > 0 ? "Assigned" : "Published") : "Draft"}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                          {(() => {
                            const desc = lesson.description;
                            if (!desc) return "No description yet.";
                            if (typeof desc === "object") return (desc as any).plainText || ((desc as any).html ? (desc as any).html.replace(/<[^>]*>/g, "") : "") || "No description yet.";
                            return String(desc).replace(/<[^>]*>/g, "").trim() || "No description yet.";
                          })()}
                        </p>

                        <div className="bg-slate-50/50 border border-slate-200/60 rounded-md p-3.5 space-y-2">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Contents</div>
                          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[11px] text-slate-600 font-medium">
                            <span>Videos: <strong>{videoCount}</strong></span>
                            <span>Readings: <strong>{readingCount}</strong></span>
                            <span>Practice: <strong className="text-teal-700">{practiceCount}</strong></span>
                            <span>Assessment: <strong className="text-emerald-700">{gradedCount}</strong></span>
                          </div>
                        </div>

                        <div className="border-t border-slate-100 pt-3.5 space-y-2 text-left">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Students</span>
                          {!lesson.isPublished ? (
                            <div className="bg-slate-50 border border-slate-200 p-2.5 rounded text-slate-600 text-[11px]">
                              Draft — only you can see this. Publish to assign it.
                            </div>
                          ) : lessonAsgs.length === 0 ? (
                            <div className="bg-sky-50 border border-sky-200 p-2.5 rounded text-sky-800 text-[11px] font-semibold">
                              Published, not assigned — assign it to a course.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {lessonAsgs.map((asg) => {
                                const opens = asg.opensAt || "";
                                const closes = asg.closesAt || "";
                                const courseName = (courses.find((c: any) => c.id === asg.courseId)?.name) || asg.courseId;
                                let badge = null;
                                if (now < opens) badge = <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Scheduled</span>;
                                else if (now <= closes) badge = <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase animate-pulse">● Open</span>;
                                else badge = <span className="bg-slate-100 text-slate-500 border border-slate-200 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Closed</span>;
                                return (
                                  <div key={asg.id} className="bg-slate-50 border border-slate-200 p-2 rounded flex justify-between items-center gap-2 text-[11px]">
                                    <span className="font-semibold text-slate-700">{courseName}{asg.section ? ` · ${asg.section}` : ""}</span>
                                    {badge}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-6 border-t border-slate-100 pt-4 flex flex-wrap justify-between items-center gap-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onLaunchPreviewAttempt && onLaunchPreviewAttempt(lesson.id)}
                            className="bg-white hover:bg-slate-50 text-slate-700 font-bold uppercase text-[9px] tracking-widest border border-slate-200 px-3 py-1.5 rounded transition cursor-pointer flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" /> Preview
                          </button>
                          <button
                            onClick={() => { setBuilderSubTab("assignments"); setAsgLessonId(lesson.id); setShowAssignmentForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                            disabled={!lesson.isPublished}
                            className={`text-[9px] tracking-widest font-bold uppercase px-3 py-1.5 rounded transition border flex items-center gap-1 ${lesson.isPublished ? "bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white" : "bg-slate-100 text-slate-350 border-slate-200 cursor-not-allowed"}`}
                            title={lesson.isPublished ? "Assign to a course" : "Publish first, then assign"}
                          >
                            <Calendar className="w-3 h-3" /> Assign
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => startEditing(lesson)} className="text-slate-700 hover:bg-slate-50 font-bold uppercase text-[9px] tracking-widest border border-slate-200 px-2.5 py-1.5 rounded transition cursor-pointer">
                            Edit
                          </button>
                          <button onClick={() => onArchived(lesson.id)} className="text-red-700 hover:bg-red-50/50 font-bold uppercase text-[9px] tracking-widest border border-transparent px-2.5 py-1.5 rounded transition cursor-pointer">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // ---- Assignments tab ----
            <AssignmentsTab
              lessons={lessons}
              courses={courses}
              assignments={assignments}
              showAssignmentForm={showAssignmentForm}
              setShowAssignmentForm={setShowAssignmentForm}
              asgLessonId={asgLessonId}
              setAsgLessonId={setAsgLessonId}
              asgCourseId={asgCourseId}
              setAsgCourseId={setAsgCourseId}
              asgSection={asgSection}
              setAsgSection={setAsgSection}
              asgOpensAt={asgOpensAt}
              setAsgOpensAt={setAsgOpensAt}
              asgDueAt={asgDueAt}
              setAsgDueAt={setAsgDueAt}
              asgClosesAt={asgClosesAt}
              setAsgClosesAt={setAsgClosesAt}
              asgIntegrityPolicy={asgIntegrityPolicy}
              setAsgIntegrityPolicy={setAsgIntegrityPolicy}
              asgError={asgError}
              onSubmit={handleCreateAssignmentSubmit}
              onDeleteAssignment={onDeleteAssignment}
              getDefaultOpenDate={getDefaultOpenDate}
              getDefaultDueDate={getDefaultDueDate}
              getDefaultCloseDate={getDefaultCloseDate}
            />
          )}
        </div>
      ) : (
        // ======================== CANVAS VIEW ========================
        <div className="flex flex-col" style={{ minHeight: "calc(100vh - 120px)" }}>

          {/* Server draft recovery banner — conflict */}
          {serverDraft && serverDraftConflict && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-900 flex items-center justify-between mb-3 shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-orange-500 shrink-0" />
                <div>
                  <span className="font-bold">Draft conflict — lesson was updated after this draft was saved</span>
                  <span className="text-orange-700 ml-1">
                    Draft from {new Date(serverDraft.updatedAt).toLocaleString()}. The published lesson changed since then — restoring may overwrite newer content.
                  </span>
                </div>
              </div>
              <div className="flex gap-2 ml-4 shrink-0">
                <button onClick={handleRestoreServerDraft} className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-3 py-1 rounded text-[11px] cursor-pointer">
                  Restore Draft Anyway
                </button>
                <button onClick={handleDiscardServerDraft} className="bg-white hover:bg-slate-100 border border-orange-300 text-orange-800 font-bold px-3 py-1 rounded text-[11px] cursor-pointer">
                  Discard Draft
                </button>
              </div>
            </div>
          )}

          {/* Server draft recovery banner — no conflict */}
          {serverDraft && !serverDraftConflict && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-center justify-between mb-3 shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold">Recovered draft available</span>
                  <span className="text-amber-700 ml-1">from {new Date(serverDraft.updatedAt).toLocaleString()} — restore to continue where you left off.</span>
                </div>
              </div>
              <div className="flex gap-2 ml-4 shrink-0">
                <button onClick={handleRestoreServerDraft} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded text-[11px] cursor-pointer">
                  Restore Draft
                </button>
                <button onClick={handleDiscardServerDraft} className="bg-white hover:bg-slate-100 border border-amber-300 text-amber-800 font-bold px-3 py-1 rounded text-[11px] cursor-pointer">
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* localStorage fallback recovery banner (shown only when no server draft) */}
          {recoveryDraft && !serverDraft && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-center justify-between mb-3 shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold">Unsaved local draft found</span>
                  <span className="text-amber-700 ml-1">from {new Date(recoveryDraft.timestamp).toLocaleString()} — restore to continue where you left off.</span>
                </div>
              </div>
              <div className="flex gap-2 ml-4 shrink-0">
                <button onClick={handleRestoreDraft} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded text-[11px] cursor-pointer">
                  Restore Draft
                </button>
                <button onClick={handleDiscardDraft} className="bg-white hover:bg-slate-100 border border-amber-300 text-amber-800 font-bold px-3 py-1 rounded text-[11px] cursor-pointer">
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Background server data update warning */}
          {serverDataUpdated && isDirty && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 flex items-center justify-between mb-3 shadow-xs">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-500 shrink-0" />
                <span>The lesson on the server was updated while you were editing. Your current edits are preserved — save to overwrite or reload to get the latest version.</span>
              </div>
              <button onClick={() => setServerDataUpdated(false)} className="ml-4 text-blue-600 hover:text-blue-800 font-bold text-[11px] shrink-0 cursor-pointer">Dismiss</button>
            </div>
          )}

          {/* Command header — calm mission control */}
          {(() => {
            const r = computeReadiness();
            const lessonAsgs = assignments.filter((a: any) => a.lessonId === selectedLesson?.id && selectedLesson?.id !== "new");
            const isNew = selectedLesson?.id === "new";
            const isAssigned = lessonAsgs.length > 0;
            const status = lessonStatusLabel({
              isNew, isPublished, isAssigned,
              blockerCount: r.issues.length,
              hasTitle: !!title.trim(),
              blockCount: currentBlocks.length,
            });
            const firstBlocker = r.issues[0]?.target;
            const nextAction = computeNextBestAction({
              hasTitle: !!title.trim(),
              blockCount: currentBlocks.length,
              blockerCount: r.issues.length,
              firstBlockerTarget: firstBlocker,
              isPublished, isAssigned, isNew,
            });
            const statusStyle: Record<string, string> = {
              "Draft": "bg-slate-100 text-slate-600 border-slate-200",
              "Needs attention": "bg-amber-50 text-amber-700 border-amber-200",
              "Ready to publish": "bg-emerald-50 text-emerald-700 border-emerald-200",
              "Published, not assigned": "bg-sky-50 text-sky-700 border-sky-200",
              "Assigned": "bg-indigo-50 text-indigo-700 border-indigo-200",
            };
            const toneStyle: Record<string, string> = {
              build: "bg-amber-500 hover:bg-amber-600",
              ready: "bg-emerald-600 hover:bg-emerald-700",
              done: "bg-indigo-600 hover:bg-indigo-700",
            };
            const estTimeResult = calculateEstimatedLessonMinutes(currentBlocks);
            const estTimeStr = formatEstimatedTime(estTimeResult);
            return (
              <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-sm mb-0 overflow-hidden">
                <div className="px-4 py-3 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <BookOpen className="w-5 h-5 text-[#0A192F] shrink-0" />
                    <span className="font-bold text-slate-900 text-base truncate max-w-[16rem]">{title || "Untitled lesson"}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusStyle[status]}`}>{status}</span>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full shrink-0">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{estTimeStr}</span>
                    </div>
                    {/* Save state — animated */}
                    <SaveStateChip saveStatus={saveStatus} autosaveStatus={autosaveStatus} isDirty={isDirty} lastSavedAt={lastSavedAt} />
                  </div>

                  <div className="flex flex-wrap gap-1.5 items-center shrink-0">
                    <button onClick={handleReturnToLibrary} className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold px-2.5 py-1.5 rounded transition cursor-pointer flex items-center gap-1">
                      <ChevronLeft className="w-3.5 h-3.5" /> Lessons
                    </button>
                    <button onClick={handleSaveAsDraft} disabled={saveStatus === "saving"} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded flex items-center gap-1 transition cursor-pointer disabled:opacity-60">
                      <Save className="w-3.5 h-3.5" /> Save draft
                    </button>
                    <button
                      onClick={handlePreviewAsStudent}
                      disabled={saveStatus === "saving"}
                      className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded flex items-center gap-1 transition cursor-pointer disabled:opacity-60"
                      title={isDirty ? "Saves your draft, then opens the student view" : "See the student view"}
                    >
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                    <button
                      onClick={handlePublishLive}
                      disabled={saveStatus === "saving"}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm disabled:opacity-60"
                    >
                      <Send className="w-3.5 h-3.5" /> {isPublished ? "Republish" : "Publish"}
                    </button>
                    <button onClick={handleAssignAndLaunch} disabled={saveStatus === "saving" || !isPublished} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" title={isPublished ? "Assign to a course" : "Publish first, then assign"}>
                      <Calendar className="w-3.5 h-3.5" /> Assign
                    </button>
                  </div>
                </div>

                {/* Next best action ribbon */}
                <button
                  type="button"
                  onClick={() => goToAction(nextAction.target)}
                  className="w-full text-left flex items-center justify-between gap-3 px-4 py-2 border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white hover:from-slate-100 transition group cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Next</span>
                    <span className="text-xs font-semibold text-slate-700 truncate">{nextAction.message}</span>
                  </span>
                  <span className={`text-[11px] font-bold text-white px-2.5 py-1 rounded shrink-0 flex items-center gap-1 transition ${toneStyle[nextAction.tone]}`}>
                    {nextAction.cta} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </button>
              </div>
            );
          })()}

          {/* Save errors */}
          {saveError && saveError.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 space-y-1 mx-0 mt-2">
              <div className="font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> Cannot publish — fix these issues:
              </div>
              {saveError.map((e: string, i: number) => (
                <div key={i} className="pl-4">• {e}</div>
              ))}
            </div>
          )}

          {/* Publish confirmation modal */}
          {showPublishConfirm && (() => {
            const r = computeReadiness();
            const reduce = false;
            const summaryRows: Array<[string, number, string?]> = [
              ["Videos", r.videoCount],
              ["Readings", r.readingCount],
              ["Checkpoints", r.checkpointCount],
              ["Practice questions", r.practiceQCount, "text-teal-700"],
              ["Assessment questions", r.gradedQCount, "text-emerald-700"],
            ];
            if (r.aiGradedCount > 0) summaryRows.push(["AI-scored short answers", r.aiGradedCount, "text-indigo-700"]);
            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <motion.div
                  initial={reduce ? false : { opacity: 0, scale: 0.97, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4"
                >
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                    <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                      <Send className="w-4 h-4 text-emerald-700" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Publish this lesson?</h3>
                      <p className="text-xs text-slate-500 truncate max-w-[18rem]">“{title || "Untitled lesson"}”</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">In this lesson</div>
                    <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-slate-600">
                      <span>Total blocks</span><span className="font-bold text-slate-800">{currentBlocks.length}</span>
                      {summaryRows.filter(([, n]) => n > 0).map(([label, n, accent]) => (
                        <React.Fragment key={label}>
                          <span>{label}</span><span className={`font-bold ${accent || "text-slate-800"}`}>{n}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-3 text-[11px] text-sky-900 leading-relaxed">
                    Students will see practice feedback right away. Assessment scores and answers stay hidden until you release them.
                  </div>

                  {r.attention.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                        <Info className="w-3 h-3" /> Worth a look first
                      </div>
                      {r.attention.map((w, i) => (
                        <div key={i} className="text-xs text-amber-700 pl-3">• {w.message}</div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-slate-500 leading-relaxed">
                    After publishing, assign this lesson to a course. Students can’t access it until it’s assigned and the open date arrives.
                  </p>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowPublishConfirm(false)}
                      className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm py-2.5 rounded-lg font-semibold transition cursor-pointer"
                    >
                      Not yet
                    </button>
                    <button
                      onClick={handleConfirmPublish}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm py-2.5 rounded-lg font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Send className="w-4 h-4" /> Publish
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()}

          {/* Post-publish prompt modal */}
          {postPublishLessonId && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 360, damping: 18, delay: 0.05 }}
                    className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0"
                  >
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  </motion.div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Published 🎉</h3>
                    <p className="text-xs text-slate-500 truncate max-w-[18rem]">“{title || "Untitled lesson"}” is ready to assign</p>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  One more step: assign this lesson to a course so students can start. You can set open and due dates when you assign it.
                </p>

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    onClick={() => {
                      setAsgLessonId(postPublishLessonId);
                      setShowAssignmentForm(true);
                      setBuilderSubTab("assignments");
                      setPostPublishLessonId(null);
                    }}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-2.5 rounded-lg font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                  >
                    <Calendar className="w-4 h-4" />
                    Assign to a course
                  </button>
                  <button
                    onClick={() => setPostPublishLessonId(null)}
                    className="w-full border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm py-2 rounded-lg font-semibold transition cursor-pointer"
                  >
                    I’ll assign it later
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {/* Assignment confirmation modal */}
          {savedAssignmentConfirm && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                className="bg-white rounded-xl border border-slate-100 shadow-2xl max-w-lg w-full p-6 space-y-4"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 360, damping: 18, delay: 0.05 }}
                    className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0"
                  >
                    <CheckCircle className="w-5 h-5 text-indigo-700" />
                  </motion.div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Assigned to {savedAssignmentConfirm.courseName}</h3>
                    <p className="text-xs text-slate-500 truncate max-w-[20rem]">“{savedAssignmentConfirm.lessonTitle}” is scheduled for students</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2.5 bg-slate-50 border border-slate-200 p-4 rounded-lg text-xs leading-normal">
                    <span className="font-bold text-slate-500">Lesson</span>
                    <span className="font-semibold text-slate-900 col-span-2">{savedAssignmentConfirm.lessonTitle}</span>

                    <span className="font-bold text-slate-500">Course</span>
                    <span className="font-semibold text-slate-900 col-span-2">{savedAssignmentConfirm.courseName}{savedAssignmentConfirm.section ? ` · ${savedAssignmentConfirm.section}` : ""}</span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg space-y-2 text-xs leading-normal text-slate-700">
                    <div className="font-bold text-slate-500 flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                      <Clock className="w-3.5 h-3.5 text-slate-400" /> Availability
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Opens</span>
                        <span className="font-semibold text-slate-800">{new Date(savedAssignmentConfirm.opensAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Due</span>
                        <span className="font-semibold text-slate-900">{new Date(savedAssignmentConfirm.dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Closes</span>
                        <span className="font-semibold text-slate-800">{new Date(savedAssignmentConfirm.closesAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-sky-50/70 border border-sky-200 p-4 rounded-lg text-xs leading-normal text-sky-900">
                    <div className="font-bold uppercase tracking-wide text-[10px] mb-1.5 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5" /> What students will see
                    </div>
                    <ul className="space-y-1 list-disc list-inside text-[11px]">
                      <li><strong>Practice:</strong> feedback and explanations appear right away.</li>
                      <li><strong>Assessment:</strong> answers and scores stay hidden until you release them.</li>
                    </ul>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    onClick={() => { setSavedAssignmentConfirm(null); setSelectedLesson(null); }}
                    className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-lg transition cursor-pointer"
                  >
                    Back to lessons
                  </button>
                  <button
                    onClick={() => setSavedAssignmentConfirm(null)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition shrink-0 cursor-pointer shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {/* Three-column canvas */}
          <div className="flex flex-1 gap-0 mt-3 min-h-0">

            {/* LEFT RAIL */}
            <aside className="w-64 shrink-0 border border-slate-200 rounded-l-lg bg-white flex flex-col overflow-y-auto mr-3">
              {/* Workflow stages */}
              {(() => {
                const r = computeReadiness();
                const setupDone = !!title.trim();
                const contentDone = currentBlocks.length > 0;
                const questionsDone = contentDone && r.issues.length === 0;
                const lessonAsgs = assignments.filter((a: any) => a.lessonId === selectedLesson?.id && selectedLesson?.id !== "new");

                const onContent = typeof activeWorkspace === "number";
                const stages = [
                  {
                    key: "setup", label: "Setup", icon: Settings,
                    done: setupDone, action: () => {
                      setEditingAssignmentId(null);
                      setActiveWorkspace("setup");
                    },
                    active: activeWorkspace === "setup",
                    note: setupDone ? undefined : "Start here",
                  },
                  {
                    key: "content", label: "Content & Questions", icon: Layers,
                    done: questionsDone, action: () => {
                      setEditingAssignmentId(null);
                      setActiveWorkspace(currentBlocks.length > 0 ? (typeof activeWorkspace === "number" ? activeWorkspace : 0) : "setup");
                    },
                    active: onContent,
                    note: r.issues.length > 0 ? `${r.issues.length} to fix` : !contentDone ? "Add content" : undefined,
                    warn: r.issues.length > 0,
                  },
                  {
                    key: "preview", label: "Preview", icon: Eye,
                    done: false, action: () => {
                      setEditingAssignmentId(null);
                      setActiveWorkspace("preview");
                    },
                    active: activeWorkspace === "preview",
                    note: isDirty ? "Saves first" : undefined,
                  },
                  {
                    key: "publish", label: "Publish", icon: Send,
                    done: !!isPublished, action: () => {
                      setEditingAssignmentId(null);
                      setActiveWorkspace("publish");
                    },
                    active: activeWorkspace === "publish",
                    note: isPublished ? "Done" : questionsDone ? "Ready" : "Fix first",
                    warn: !isPublished && !questionsDone,
                  },
                  {
                    key: "assign", label: "Assign", icon: Calendar,
                    done: lessonAsgs.length > 0, action: () => {
                      setAsgLessonId(selectedLesson?.id || "");
                      if (selectedLesson?.courseId) {
                        setAsgCourseId(selectedLesson.courseId);
                        const selectedC = courses.find((c: any) => c.id === selectedLesson.courseId);
                        setAsgSection(selectedC?.sectionName || "");
                      } else if (courseId) {
                        setAsgCourseId(courseId);
                        const selectedC = courses.find((c: any) => c.id === courseId);
                        setAsgSection(selectedC?.sectionName || "");
                      }
                      setEditingAssignmentId(null);
                      setActiveWorkspace("assign");
                    },
                    active: activeWorkspace === "assign",
                    note: !isPublished ? "Publish first" : lessonAsgs.length > 0 ? "Done" : "Ready",
                  },
                ];

                return (
                  <div className="border-b border-slate-100 p-3 space-y-0.5">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Workflow</div>
                    {stages.map((stage) => {
                      const Icon = stage.icon;
                      return (
                        <button
                          key={stage.key}
                          onClick={stage.action}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-semibold transition text-left ${stage.active ? "bg-[#0A192F] text-white" : "text-slate-600 hover:bg-slate-50"}`}
                        >
                          <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${stage.done ? "bg-emerald-500" : stage.active ? "bg-white/20" : "bg-slate-100"}`}>
                            {stage.done
                              ? <CheckCircle className="w-3 h-3 text-white" />
                              : <Icon className={`w-2.5 h-2.5 ${stage.active ? "text-white" : "text-slate-400"}`} />
                            }
                          </span>
                          <span className="flex-1 truncate">{stage.label}</span>
                          {stage.note && !stage.active && (
                            <span className={`text-[9px] font-bold uppercase shrink-0 ${(stage as any).warn ? "text-amber-500" : "text-slate-400"}`}>
                              {stage.note}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Add block buttons */}
              <div className="border-b border-slate-100 p-3 space-y-1.5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Add to lesson</div>
                <div className="grid grid-cols-1 gap-1.5">
                  <button onClick={() => handleAddBlock("video")} className="w-full text-left flex items-start gap-2 text-blue-700 bg-blue-50/75 hover:bg-blue-100 border border-blue-200 px-2.5 py-1.5 rounded-lg transition group cursor-pointer">
                    <Video className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="text-[11px] font-bold block">Add video</span>
                      <span className="text-[9px] text-blue-500/90 block leading-tight">Play a clip and add checkpoints</span>
                    </span>
                  </button>
                  <button onClick={() => handleAddBlock("reading")} className="w-full text-left flex items-start gap-2 text-purple-700 bg-purple-50/75 hover:bg-purple-100 border border-purple-200 px-2.5 py-1.5 rounded-lg transition group cursor-pointer">
                    <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="text-[11px] font-bold block">Add reading</span>
                      <span className="text-[9px] text-purple-500/90 block leading-tight">A passage for students to read</span>
                    </span>
                  </button>
                  <button onClick={() => handleAddBlock("question")} className="w-full text-left flex items-start gap-2 text-emerald-700 bg-emerald-50/75 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg transition group cursor-pointer">
                    <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="text-[11px] font-bold block">Add question</span>
                      <span className="text-[9px] text-emerald-600/90 block leading-tight">Practice or assessment check</span>
                    </span>
                  </button>
                </div>
              </div>

              {/* Block sequence */}
              <div className="flex-1 p-3 space-y-1 overflow-y-auto">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Lesson outline</div>
                {currentBlocks.length === 0 ? (
                  <div className="text-center py-6 px-2 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                    <Layers className="w-6 h-6 mx-auto mb-1.5 text-slate-300" />
                    <p className="text-[11px] font-semibold text-slate-500">Nothing here yet</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Start with a video, reading, or question below.</p>
                  </div>
                ) : (
                  currentBlocks.map((b: any, idx: number) => {
                    const cfg = blockTypeConfig(b.type);
                    const IconComp = cfg.icon;
                    const isActive = activeWorkspace === idx;
                    const { issues } = computeReadiness();
                    const blockIssues = issues.filter((iss) => iss.target === idx);
                    const hasIssues = blockIssues.length > 0;
                    const cpCount = b.type === "video" ? (b.videoCheckpoints?.length || 0) : 0;
                    const sub = b.type === "question"
                      ? `${cfg.label} · ${modeLabel(b.isPractice)}`
                      : b.type === "video"
                      ? `${cfg.label}${cpCount > 0 ? ` · ${cpCount} check${cpCount === 1 ? "" : "s"}` : ""}`
                      : cfg.label;

                    return (
                      <motion.div
                        key={b.id}
                        layout
                        initial={justAddedBlockId === b.id ? { opacity: 0, y: -4 } : false}
                        animate={justAddedBlockId === b.id ? { opacity: 1, y: 0 } : {}}
                        transition={{ duration: 0.25 }}
                        className={`group relative rounded border transition cursor-pointer ${isActive ? "bg-[#0A192F] border-[#0A192F] text-white" : justAddedBlockId === b.id ? "bg-emerald-50 border-emerald-300 text-slate-700" : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700"}`}
                      >
                        <button
                          onClick={() => setActiveWorkspace(idx)}
                          className="w-full text-left flex items-start gap-2 px-2 py-2"
                        >
                          <span className={`font-mono text-[9px] shrink-0 mt-0.5 ${isActive ? "text-white/60" : "text-slate-400"}`}>{idx + 1}</span>
                          <IconComp className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? "text-white/80" : cfg.color}`} />
                          <div className="min-w-0 flex-1">
                            <span className="text-[11px] font-semibold block truncate">{b.title || `Untitled ${cfg.label.toLowerCase()}`}</span>
                            <span className={`text-[9px] font-bold uppercase ${isActive ? "text-white/60" : b.type === "question" ? (b.isPractice ? "text-teal-500" : "text-emerald-600") : "text-slate-400"}`}>{sub}</span>
                          </div>
                          {hasIssues && !isActive && (
                            <AlertCircle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                          )}
                        </button>

                        {/* Inline controls on hover */}
                        <div className={`absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5 ${isActive ? "flex" : ""}`}>
                          <button type="button" title="Move up" disabled={idx === 0} onClick={(e) => { e.stopPropagation(); moveBlock(idx, "up"); }} className={`p-0.5 rounded disabled:opacity-30 ${isActive ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-700"}`}>
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button type="button" title="Move down" disabled={idx === currentBlocks.length - 1} onClick={(e) => { e.stopPropagation(); moveBlock(idx, "down"); }} className={`p-0.5 rounded disabled:opacity-30 ${isActive ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-700"}`}>
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button type="button" title="Delete block" onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this block?")) handleDeleteBlock(idx); }} className="p-0.5 rounded text-red-400 hover:text-red-600">
                            <Trash className="w-3 h-3" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>

            </aside>

            {/* CENTER WORKSPACE */}
            <main className="flex-1 min-w-0 overflow-y-auto">
              {activeWorkspace === "setup" ? (
                // ---- Setup panel ----
                <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
                  <div className="border-b border-slate-100 pb-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-[#0A192F] flex items-center gap-1.5">
                      <Settings className="w-4 h-4" /> Setup
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">Name the lesson and choose how it’s delivered. Only the title is required.</p>
                  </div>

                  <div className="space-y-4 text-xs max-w-2xl">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Lesson title <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. The Constitutional Convention"
                        className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-[#0A192F] text-slate-800 font-medium"
                      />
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Target Course <span className="font-normal text-slate-400">(optional during design)</span></label>
                      <select
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 pr-8 focus:outline-none focus:border-[#0A192F] text-slate-800"
                      >
                        <option value="">-- No course selected --</option>
                        {courses.filter((c: any) => c.status !== "archived").map((c: any) => (
                          <option key={c.id} value={c.id}>{c.name}{c.sectionName ? ` — ${c.sectionName}` : ""}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1">Selecting a course here pre-fills the assignment settings automatically.</p>
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Description <span className="font-normal text-slate-400">(optional)</span></label>
                      <RichContentEditor
                        value={description}
                        onChange={(val: any) => setDescription(val)}
                        mode="compact"
                        placeholder="Briefly describe what students will learn..."
                        documentKey={`lesson-desc-${selectedLesson?.id || "new"}`}
                      />
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Estimated time</label>
                      <div className="flex items-center gap-2">
                        <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-800 flex items-center gap-2 font-semibold text-xs">
                          <Clock className="w-4 h-4 text-slate-400" />
                          {formatEstimatedTime(calculateEstimatedLessonMinutes(currentBlocks))}
                        </div>
                        <span className="text-[11px] text-slate-400 font-medium">Calculated automatically from lesson content</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4 space-y-3">
                      <span className="font-bold text-slate-700 block">How students experience it</span>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={restrictSeeking} onChange={(e) => setRestrictSeeking(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Keep videos in order — students watch before skipping ahead
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={requireFullscreen} onChange={(e) => setRequireFullscreen(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Encourage focus with a fullscreen view
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={allowRetakes} onChange={(e) => setAllowRetakes(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Allow another attempt after finishing
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={randomizeChoices} onChange={(e) => setRandomizeChoices(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Shuffle answer choices for each student
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={immediateFeedback} onChange={(e) => setImmediateFeedback(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Show feedback right away on practice questions
                      </label>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                      <div className="bg-slate-50 border border-slate-200 rounded p-3">
                        <label className="flex items-start gap-2 font-semibold text-slate-800 cursor-pointer text-[12px] hover:text-slate-900 transition">
                          <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="focus:ring-0 rounded-sm mt-0.5" />
                          <div>
                            <span>Published — ready to assign</span>
                            <p className="text-[10px] font-normal text-slate-500 mt-0.5 leading-relaxed">
                              Published lessons can be assigned to a course. Drafts stay private to you until you publish.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : activeWorkspace === "preview" ? (
                // ---- PREVIEW WORKSPACE ----
                <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-[#0A192F] flex items-center gap-1.5">
                      <Eye className="w-4 h-4" /> Student Experience Preview
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">See exactly what your students will experience during the lesson.</p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3 text-xs leading-normal">
                    <p className="text-slate-700">
                      You are about to launch an interactive preview of <strong>“{title || "Untitled Lesson"}”</strong>.
                    </p>
                    <ul className="text-slate-500 space-y-1 list-disc list-inside">
                      <li>Practice questions will show correctness and teacher explanations immediately on submission.</li>
                      <li>Assessment questions and video checkpoints will record progress and keep grades/feedback hidden.</li>
                      <li>Any changes you made will be autosaved first so your preview contains your latest blocks.</li>
                    </ul>
                  </div>

                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={handlePreviewAsStudent}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2.5 rounded-lg transition cursor-pointer shadow-sm flex items-center gap-1.5"
                    >
                      <Eye className="w-4 h-4" /> Launch Student Preview
                    </button>
                    <button
                      onClick={() => setActiveWorkspace(currentBlocks.length > 0 ? 0 : "setup")}
                      className="border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold px-4 py-2.5 rounded-lg transition"
                    >
                      Back to Editor
                    </button>
                  </div>
                </div>

              ) : activeWorkspace === "publish" ? (
                // ---- PUBLISH WORKSPACE ----
                <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-[#0A192F] flex items-center gap-1.5">
                      <Send className="w-4 h-4" /> Publish Lesson Version
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">Publishing makes the current version of the lesson available for assignment.</p>
                  </div>

                  {(() => {
                    const r = computeReadiness();
                    const isPublishable = r.issues.length === 0;

                    return (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Status</span>
                            <span className={`text-xs font-bold ${isPublished ? "text-emerald-600" : "text-amber-500"}`}>
                              {isPublished ? "Published" : "Draft (Unpublished)"}
                            </span>
                          </div>
                          <div className="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Content Blocks</span>
                            <span className="text-xs font-bold text-slate-800">{currentBlocks.length} blocks</span>
                          </div>
                          <div className="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Practice Checks</span>
                            <span className="text-xs font-bold text-slate-800">{r.practiceQCount} questions</span>
                          </div>
                          <div className="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Graded Checks</span>
                            <span className="text-xs font-bold text-[#0A192F]">{r.gradedQCount} questions</span>
                          </div>
                        </div>

                        {/* Blockers alert */}
                        {!isPublishable ? (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3 text-xs leading-normal">
                            <div className="flex items-center gap-2 text-red-800 font-bold uppercase tracking-wide">
                              <AlertCircle className="w-4 h-4" /> Cannot Publish — Blockers Found
                            </div>
                            <ul className="space-y-1 list-disc list-inside text-red-700">
                              {r.issues.map((iss, i) => (
                                <li key={i} className="cursor-pointer hover:underline" onClick={() => setActiveWorkspace(iss.target)}>
                                  {iss.message}
                                </li>
                              ))}
                            </ul>
                            <p className="text-[10px] text-red-500 leading-relaxed pt-1 border-t border-red-100">
                              Please resolve all blockers listed above. Clicking an item will navigate directly to that block.
                            </p>
                          </div>
                        ) : (
                          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 space-y-2 text-xs">
                            <div className="flex items-center gap-1.5 text-emerald-800 font-bold uppercase tracking-wide">
                              <CheckCircle className="w-4 h-4" /> All Clear for Publishing
                            </div>
                            <p className="text-emerald-750 leading-relaxed">
                              This lesson plan meets all instructional readiness criteria. You can safely publish it now.
                            </p>
                          </div>
                        )}

                        <div className="flex gap-3 text-xs">
                          <button
                            onClick={handlePublishLive}
                            disabled={!isPublishable || saveStatus === "saving"}
                            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold px-5 py-2.5 rounded-lg transition cursor-pointer shadow-sm flex items-center gap-1.5"
                          >
                            <Send className="w-4 h-4" /> {isPublished ? "Republish Lesson" : "Publish Version"}
                          </button>
                          {isPublished && (
                            <button
                              onClick={() => {
                                setAsgLessonId(selectedLesson?.id || "");
                                if (selectedLesson?.courseId) {
                                  setAsgCourseId(selectedLesson.courseId);
                                  const selectedC = courses.find((c: any) => c.id === selectedLesson.courseId);
                                  setAsgSection(selectedC?.sectionName || "");
                                } else if (courseId) {
                                  setAsgCourseId(courseId);
                                  const selectedC = courses.find((c: any) => c.id === courseId);
                                  setAsgSection(selectedC?.sectionName || "");
                                }
                                setActiveWorkspace("assign");
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2.5 rounded-lg transition cursor-pointer shadow-sm flex items-center gap-1.5"
                            >
                              Continue to Assign step <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

              ) : activeWorkspace === "assign" ? (
                // ---- ASSIGN DIRECTLY IN WIZARD WORKSPACE ----
                <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-6">
                  {/* Outer flex container */}
                  <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-widest text-[#0A192F] flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" /> Assign Lesson
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-1">Configure section dates, learning conditions, and assign to courses directly.</p>
                    </div>

                    {/* Status badge */}
                    {(() => {
                      const isAsgDirty = editingAssignmentId
                        ? (() => {
                            const asg = assignments.find((a) => a.id === editingAssignmentId);
                            if (!asg) return false;
                            return (
                              asg.courseId !== asgCourseId ||
                              asg.section !== asgSection ||
                              new Date(asg.opensAt).getTime() !== new Date(asgOpensAt).getTime() ||
                              new Date(asg.dueAt).getTime() !== new Date(asgDueAt).getTime() ||
                              new Date(asg.closesAt).getTime() !== new Date(asgClosesAt).getTime() ||
                              JSON.stringify(asg.integrityPolicy) !== JSON.stringify(asgIntegrityPolicy)
                            );
                          })()
                        : (asgCourseId !== "" || asgSection !== "" || asgOpensAt !== getDefaultOpenDate());

                      let asgStatusText = "Ready to assign";
                      let asgStatusColor = "bg-emerald-50 text-emerald-700 border-emerald-200";

                      if (editingAssignmentId) {
                        const asgAttempts = (attempts || []).filter((a: any) => a.assignmentId === editingAssignmentId && !a.isPreviewAttempt);
                        const hasAttempts = asgAttempts.length > 0;
                        if (hasAttempts) {
                          asgStatusText = "Assigned, students started · Locked for integrity";
                          asgStatusColor = "bg-[#0A192F] text-white border-none";
                        } else {
                          asgStatusText = "Assigned, no students started";
                          asgStatusColor = "bg-indigo-50 text-indigo-700 border-indigo-200";
                        }
                      } else {
                        if (isAsgDirty) {
                          asgStatusText = "Draft (Unsaved)";
                          asgStatusColor = "bg-amber-50 text-amber-700 border-amber-100 animate-pulse";
                        }
                      }

                      return (
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border ${asgStatusColor}`}>
                          {asgStatusText}
                        </span>
                      );
                    })()}
                  </div>

                  {/* If lesson plan is unpublished, show alert */}
                  {!isPublished && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl space-y-1.5 text-xs text-amber-800">
                      <div className="font-bold flex items-center gap-1.5 uppercase">
                        <AlertTriangle className="w-4 h-4 text-amber-600" /> Publish Required First
                      </div>
                      <p className="leading-relaxed">
                        To activate student assignment creation, you must publish the lesson first. You can still pre-fill settings below.
                      </p>
                      <button
                        onClick={() => setActiveWorkspace("publish")}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] uppercase tracking-wider px-3 py-1 rounded transition mt-1"
                      >
                        Go to Publish stage
                      </button>
                    </div>
                  )}

                  {asgError && (
                    <div className="bg-red-50 text-red-700 text-xs p-3 rounded flex items-center gap-2 border border-red-100">
                      <AlertCircle className="w-4 h-4 shrink-0" /><span>{asgError}</span>
                    </div>
                  )}

                  {/* ACTIVE ASSIGNMENTS LIST FOR THIS LESSON */}
                  {(() => {
                    const lessonAsgs = assignments.filter((a: any) => a.lessonId === selectedLesson?.id && selectedLesson?.id !== "new");
                    if (lessonAsgs.length === 0) return null;
                    return (
                      <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                        <div className="px-4 py-2.5 bg-slate-100/80 border-b border-indigo-50/60 flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Active Course Assignments ({lessonAsgs.length})</span>
                        </div>
                        <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                          {lessonAsgs.map((asg: any) => {
                            const now = new Date().toISOString();
                            const opens = asg.opensAt || "";
                            const closes = asg.closesAt || "";
                            const courseName = (courses.find((c: any) => c.id === asg.courseId)?.name) || asg.courseId;
                            const asgAttempts = (attempts || []).filter((a: any) => a.assignmentId === asg.id && !a.isPreviewAttempt);
                            const hasStarted = asgAttempts.length > 0;

                            let sBadge = null;
                            if (now < opens) sBadge = <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Scheduled</span>;
                            else if (now <= closes) sBadge = <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Open</span>;
                            else sBadge = <span className="bg-slate-100 text-slate-500 border border-slate-200 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Closed</span>;

                            return (
                              <div key={asg.id} className="p-3 flex justify-between items-center gap-4 text-xs">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800 text-[13px]">{courseName}</span>
                                    {asg.section && <span className="text-slate-400">· Section {asg.section}</span>}
                                    {sBadge}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    Due: {new Date(asg.dueAt).toLocaleString()} · Condition: <span className="capitalize font-semibold text-slate-600">{asg.integrityPolicy?.preset || "Open"}</span>
                                  </div>
                                  {hasStarted && (
                                    <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1 py-0.5 rounded block w-max">
                                      {asgAttempts.length} student{asgAttempts.length === 1 ? "" : "s"} started
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingAssignmentId(asg.id);
                                      setAsgCourseId(asg.courseId);
                                      setAsgSection(asg.section || "");
                                      setAsgOpensAt(asg.opensAt.slice(0, 16));
                                      setAsgDueAt(asg.dueAt.slice(0, 16));
                                      setAsgClosesAt(asg.closesAt.slice(0, 16));
                                      setAsgIntegrityPolicy(asg.integrityPolicy || buildDefaultPolicy("open"));
                                    }}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold hover:bg-indigo-50 px-2 py-1 rounded cursor-pointer"
                                  >
                                    Edit Settings
                                  </button>
                                  <button
                                    onClick={() => {
                                      const confirmText = hasStarted
                                        ? "WARNING: Students have already started attempts for this assignment! Deleting it will permanently delete access and reports. Are you absolutely certain you want to proceed?"
                                        : "Remove this assignment? Students will lose access.";
                                      if (window.confirm(confirmText)) {
                                        onDeleteAssignment && onDeleteAssignment(asg.id);
                                        if (editingAssignmentId === asg.id) {
                                          setEditingAssignmentId(null);
                                          setAsgCourseId("");
                                          setAsgSection("");
                                        }
                                      }
                                    }}
                                    className="text-xs text-red-600 hover:text-red-800 font-bold hover:bg-red-50 px-2 py-1 rounded cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* FORM TO CREATE OR EDIT AN ASSIGNMENT */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setAsgError("");
                      if (!asgLessonId) { setAsgError("Invalid lesson ID."); return; }
                      if (!asgCourseId) { setAsgError("Please select a course."); return; }
                      if (new Date(asgOpensAt) >= new Date(asgDueAt)) { setAsgError("Open date must occur before the due date."); return; }
                      if (new Date(asgDueAt) > new Date(asgClosesAt)) { setAsgError("Due date must be on or before close date."); return; }

                      try {
                        const selectedC = courses.find((c: any) => c.id === asgCourseId);
                        const selectedLessonObj = lessons.find((l: any) => l.id === asgLessonId);

                        const payload: any = {
                          lessonId: asgLessonId,
                          courseId: asgCourseId,
                          section: asgSection.trim(),
                          opensAt: new Date(asgOpensAt).toISOString(),
                          dueAt: new Date(asgDueAt).toISOString(),
                          closesAt: new Date(asgClosesAt).toISOString(),
                          integrityPolicy: asgIntegrityPolicy,
                        };

                        if (editingAssignmentId) {
                          payload.id = editingAssignmentId;
                        }

                        if (onSaveAssignment) {
                          await onSaveAssignment(payload);

                          setSavedAssignmentConfirm({
                            lessonTitle: selectedLessonObj?.title || title || "Lesson",
                            courseName: selectedC?.name || asgCourseId,
                            section: asgSection.trim() || "All Sections",
                            opensAt: asgOpensAt,
                            dueAt: asgDueAt,
                            closesAt: asgClosesAt,
                            integrityPolicy: asgIntegrityPolicy,
                          });

                          setEditingAssignmentId(null);
                          setAsgCourseId("");
                          setAsgSection("");
                          setAsgIntegrityPolicy(buildDefaultPolicy("open"));
                        }
                      } catch (err: any) {
                        setAsgError(err.message || "Failed to save assignment.");
                      }
                    }}
                    className="bg-[#0A192F]/5 border border-slate-200 rounded-xl p-6 space-y-4 text-xs"
                  >
                    <div className="border-b border-slate-105 pb-2">
                      <h5 className="font-bold text-slate-800 text-[13px] flex items-center gap-1">
                        {editingAssignmentId ? "Modify Course Assignment" : "Setup New Assignment for this Lesson"}
                      </h5>
                    </div>

                    {/* Check started student attempts count */}
                    {(() => {
                      if (!editingAssignmentId) return null;
                      const asgAttempts = (attempts || []).filter((a: any) => a.assignmentId === editingAssignmentId && !a.isPreviewAttempt);
                      if (asgAttempts.length === 0) return null;
                      return (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg leading-relaxed text-[11px] font-medium flex items-start gap-2">
                          <Lock className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                          <div>
                            <strong>Student progress is underway:</strong> {asgAttempts.length} student{asgAttempts.length === 1 ? "" : "s"} started attempts. Only due and close dates can be modified to preserve attempt integrity and version consistency.
                          </div>
                        </div>
                      );
                    })()}

                    {(() => {
                      const lockAll = editingAssignmentId
                        ? (attempts || []).filter((a: any) => a.assignmentId === editingAssignmentId && !a.isPreviewAttempt).length > 0
                        : false;

                      return (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Course Select */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Target Course *</label>
                              <select
                                value={asgCourseId}
                                disabled={lockAll}
                                onChange={(e) => {
                                  setAsgCourseId(e.target.value);
                                  const selected = courses.find((c: any) => c.id === e.target.value);
                                  setAsgSection(selected?.sectionName || "");
                                }}
                                className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                                required
                              >
                                <option value="">-- Choose a course --</option>
                                {courses.filter((c: any) => c.status !== "archived").map((c: any) => (
                                  <option key={c.id} value={c.id}>{c.name}{c.sectionName ? ` — ${c.sectionName}` : ""}</option>
                                ))}
                              </select>
                            </div>

                            {/* Section Input */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Section/Period</label>
                              <input
                                type="text"
                                value={asgSection}
                                disabled={lockAll}
                                onChange={(e) => setAsgSection(e.target.value)}
                                placeholder="e.g. Period 2 or All Sections"
                                className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Opens At */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Opens At *</label>
                              <input
                                type="datetime-local"
                                value={asgOpensAt}
                                disabled={lockAll}
                                onChange={(e) => setAsgOpensAt(e.target.value)}
                                className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                                required
                              />
                            </div>

                            {/* Due At */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Due At *</label>
                              <input
                                type="datetime-local"
                                value={asgDueAt}
                                onChange={(e) => setAsgDueAt(e.target.value)}
                                className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                                required
                              />
                            </div>

                            {/* Closes At */}
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Closes At *</label>
                              <input
                                type="datetime-local"
                                value={asgClosesAt}
                                onChange={(e) => setAsgClosesAt(e.target.value)}
                                className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                                required
                              />
                            </div>
                          </div>

                          {/* Learning Conditions Editor block */}
                          <div className="border-t border-slate-100 pt-4">
                            {lockAll ? (
                              <div className="space-y-2">
                                <span className="text-xs font-bold text-slate-700 block">Learning Conditions</span>
                                <div className="bg-slate-100 border border-slate-200 rounded-lg p-3 text-slate-600 leading-relaxed text-[11px]">
                                  Preset: <strong className="capitalize text-slate-800">{asgIntegrityPolicy?.preset || "Open"}</strong>
                                  <p className="mt-1">
                                    Learning conditions like seeking restrictions, fullscreen focus checks, and choice shuffling cannot be adjusted once attempts are in progress.
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <LearningConditionsEditor value={asgIntegrityPolicy} onChange={setAsgIntegrityPolicy} />
                            )}
                          </div>
                        </>
                      );
                    })()}

                    {/* Submit actions block */}
                    <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                      {editingAssignmentId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAssignmentId(null);
                            setAsgCourseId("");
                            setAsgSection("");
                            setAsgIntegrityPolicy(buildDefaultPolicy("open"));
                          }}
                          className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold px-4 py-2 rounded shadow-sm cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={!isPublished}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold px-5 py-2 rounded shadow-sm tracking-wide uppercase transition cursor-pointer"
                      >
                        {editingAssignmentId ? "Save Assignment Changes" : "Assign to Course"}
                      </button>
                    </div>
                  </form>
                </div>

              ) : typeof activeWorkspace === "number" && currentBlocks[activeWorkspace] ? (
                // ---- Block editor ----
                <BlockEditor
                  block={currentBlocks[activeWorkspace]}
                  index={activeWorkspace}
                  totalBlocks={currentBlocks.length}
                  restrictSeeking={restrictSeeking}
                  onBlockChange={handleBlockChange}
                  onBlockMultipleChanges={handleBlockMultipleChanges}
                  onVideoUploaded={handleVideoUploaded}
                  onVideoThumbnailSelected={handleVideoThumbnailSelected}
                  addCheckpoint={addCheckpoint}
                  updateCheckpoint={updateCheckpoint}
                  updateCheckpointQuestion={updateCheckpointQuestion}
                  updateCheckpointQuestionType={updateCheckpointQuestionType}
                  deleteCheckpoint={deleteCheckpoint}
                  onBlockQuestionChange={handleBlockQuestionChange}
                  onBlockQuestionTypeChange={handleBlockQuestionTypeChange}
                  selectedLessonId={selectedLesson?.id}
                  lessonTitle={title}
                  onYouTubeSelected={handleYouTubeSelected}
                  onDirectLinkSelected={handleDirectLinkSelected}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg p-16 text-center text-slate-400 text-sm">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold text-slate-600">Pick a block from the outline to edit it</p>
                  <p className="text-xs mt-1">or open <strong>Setup</strong> to edit the lesson details</p>
                </div>
              )}
            </main>

            {/* RIGHT READINESS PANEL */}
            {(() => {
              const r = computeReadiness();
              const estTimeResult = calculateEstimatedLessonMinutes(currentBlocks);
              const estTimeStr = formatEstimatedTime(estTimeResult);
              return (
                <ReadinessPanel
                  blockers={r.issues}
                  attention={r.attention}
                  optional={r.optional}
                  gradedQCount={r.gradedQCount}
                  practiceQCount={r.practiceQCount}
                  videoCount={r.videoCount}
                  readingCount={r.readingCount}
                  aiGradedCount={r.aiGradedCount}
                  checkpointCount={r.checkpointCount}
                  totalBlocks={currentBlocks.length}
                  isPublished={isPublished}
                  onNavigate={setActiveWorkspace}
                  estTimeStr={estTimeStr}
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// Helpers
// =====================================================

/** Seconds → "m:ss" for friendly checkpoint labels (e.g. 135 → "2:15"). */
function formatTimestamp(seconds: number | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  return date.toLocaleTimeString();
}

// =====================================================
// Sub-components
// =====================================================

/** Animated save-state chip for the command header. Status is never color-only. */
function SaveStateChip({
  saveStatus, autosaveStatus, isDirty, lastSavedAt,
}: {
  saveStatus: string;
  autosaveStatus: string;
  isDirty: boolean;
  lastSavedAt: Date | null;
}) {
  const reduce = useReducedMotion();
  let icon: React.ReactNode = null;
  let text = "";
  let cls = "text-slate-400";

  if (saveStatus === "saving") { icon = <Clock className="w-3.5 h-3.5 animate-spin" />; text = "Saving…"; cls = "text-blue-600"; }
  else if (saveStatus === "saved") { icon = <CheckCircle className="w-3.5 h-3.5" />; text = "Saved"; cls = "text-emerald-600"; }
  else if (saveStatus === "error") { icon = <AlertCircle className="w-3.5 h-3.5" />; text = "Save failed"; cls = "text-rose-600"; }
  else if (isDirty && autosaveStatus === "saving") { icon = <Clock className="w-3 h-3 animate-spin" />; text = "Saving draft…"; cls = "text-slate-500"; }
  else if (isDirty && autosaveStatus === "saved") { icon = <CheckCircle className="w-3 h-3" />; text = "Draft saved"; cls = "text-slate-400"; }
  else if (isDirty && autosaveStatus === "failed") { icon = <AlertCircle className="w-3 h-3" />; text = "Draft save failed"; cls = "text-rose-500"; }
  else if (isDirty) { icon = <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />; text = "Unsaved changes"; cls = "text-amber-600"; }
  else if (lastSavedAt) { icon = <CheckCircle className="w-3.5 h-3.5" />; text = `Saved ${formatRelativeTime(lastSavedAt)}`; cls = "text-slate-400"; }
  else { icon = <CheckCircle className="w-3.5 h-3.5" />; text = "All changes saved"; cls = "text-slate-400"; }

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={text}
        initial={reduce ? false : { opacity: 0, y: -2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: 2 }}
        transition={{ duration: 0.18 }}
        className={`text-[11px] font-medium flex items-center gap-1 shrink-0 ${cls}`}
      >
        {icon} {text}
      </motion.span>
    </AnimatePresence>
  );
}

interface ReadinessPanelProps {
  blockers: Array<{ message: string; target: "setup" | number }>;
  attention: Array<{ message: string; target: "setup" | number }>;
  optional: Array<{ message: string; target: "setup" | number }>;
  gradedQCount: number;
  practiceQCount: number;
  videoCount: number;
  readingCount: number;
  aiGradedCount: number;
  checkpointCount: number;
  totalBlocks: number;
  isPublished: boolean;
  onNavigate: (target: "setup" | number) => void;
  estTimeStr: string;
}

/**
 * Renders a tier of readiness rows. Returns motion.li elements directly so the
 * React `key` lands on the motion element (which accepts it) rather than a custom
 * component. Each row jumps to where the item can be fixed.
 */
type ReadinessTone = "blocker" | "attention" | "optional";
function renderReadinessRows(
  items: Array<{ message: string; target: "setup" | number }>,
  tone: ReadinessTone,
  cta: string,
  onNavigate: (t: "setup" | number) => void,
) {
  const styles = {
    blocker: { text: "text-rose-700", icon: "text-rose-500", hover: "hover:bg-rose-50/60 hover:border-rose-200", Icon: AlertCircle },
    attention: { text: "text-amber-700", icon: "text-amber-500", hover: "hover:bg-amber-50/60 hover:border-amber-200", Icon: AlertCircle },
    optional: { text: "text-slate-600", icon: "text-slate-400", hover: "hover:bg-slate-50 hover:border-slate-200", Icon: Info },
  }[tone];
  const Icon = styles.Icon;
  return items.map((item, i) => (
    <motion.li
      key={item.message + i}
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        onClick={() => onNavigate(item.target)}
        className={`w-full text-left text-[11px] flex flex-col rounded p-1.5 border border-transparent transition ${styles.text} ${styles.hover}`}
      >
        <span className="flex items-start gap-1.5 font-semibold">
          <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${styles.icon}`} />
          <span>{item.message}</span>
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider mt-1 ml-5 opacity-70">{cta} →</span>
      </button>
    </motion.li>
  ));
}

function ReadinessPanel({
  blockers, attention, optional, gradedQCount, practiceQCount, videoCount, readingCount, aiGradedCount,
  checkpointCount, totalBlocks, isPublished, onNavigate, estTimeStr
}: ReadinessPanelProps) {
  const canPublish = blockers.length === 0;
  const hasIssues = blockers.length > 0 || attention.length > 0;
  const [detailsVisible, setDetailsVisible] = useState(false);

  const stats: Array<{ value: number; label: string; accent?: string }> = [
    { value: totalBlocks, label: "Blocks" },
    { value: gradedQCount, label: "Assessment", accent: "text-emerald-700" },
  ];
  if (practiceQCount > 0) stats.push({ value: practiceQCount, label: "Practice", accent: "text-teal-700" });
  if (videoCount > 0) stats.push({ value: videoCount, label: "Videos" });
  if (readingCount > 0) stats.push({ value: readingCount, label: "Readings" });
  if (checkpointCount > 0) stats.push({ value: checkpointCount, label: "Checkpoints" });
  if (aiGradedCount > 0) stats.push({ value: aiGradedCount, label: "AI-scored", accent: "text-indigo-700" });

  return (
    <aside className="w-64 shrink-0 border border-slate-200 rounded-r-lg bg-white flex flex-col overflow-y-auto ml-3">
      {/* Readiness headline */}
      <div className="p-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-bold text-[11px] uppercase tracking-wider text-slate-800">Readiness</span>
          </div>
          <button
            type="button"
            onClick={() => setDetailsVisible((v) => !v)}
            className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold transition"
          >
            {detailsVisible ? "Hide details" : "Show details"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px] mb-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-slate-50 border border-slate-200 rounded p-1.5 text-center">
              <div className={`font-bold text-sm ${s.accent || "text-slate-800"}`}>{s.value}</div>
              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Estimated lesson duration banner */}
        <div className="bg-slate-50 border border-slate-200 rounded p-2 text-center mb-2">
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Estimated Time</span>
          </div>
          <div className="font-bold text-xs text-slate-800">{estTimeStr}</div>
        </div>

        {/* Publish readiness banner — animated on resolution */}
        <motion.div
          layout
          className={`rounded p-2 flex items-center gap-2 ${canPublish && isPublished ? "bg-emerald-100/60 text-emerald-800" : canPublish ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}
        >
          {canPublish && isPublished ? (
            <><CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" /><span className="text-[11px] font-bold">Published</span></>
          ) : canPublish ? (
            <><CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" /><span className="text-[11px] font-bold">Ready to publish</span></>
          ) : (
            <><AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" /><span className="text-[11px] font-bold">Fix {blockers.length} blocker{blockers.length !== 1 ? "s" : ""} before publishing</span></>
          )}
        </motion.div>

        {!detailsVisible && hasIssues && (
          <button
            type="button"
            onClick={() => setDetailsVisible(true)}
            className="mt-2 w-full text-[10px] text-amber-700 hover:text-amber-900 font-semibold text-left"
          >
            {blockers.length > 0 ? `${blockers.length} blocker${blockers.length !== 1 ? "s" : ""} need attention →` : `${attention.length} item${attention.length !== 1 ? "s" : ""} to review →`}
          </button>
        )}
      </div>

      {/* Collapsible details section */}
      {detailsVisible && (
        <>
          {/* Blockers */}
          {blockers.length > 0 && (
            <div className="p-3 border-b border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-widest text-rose-600 mb-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Blockers
              </div>
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {renderReadinessRows(blockers, "blocker", "Fix this", onNavigate)}
                </AnimatePresence>
              </ul>
            </div>
          )}

          {/* Needs attention */}
          {attention.length > 0 && (
            <div className="p-3 border-b border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Needs attention
              </div>
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {renderReadinessRows(attention, "attention", "Review", onNavigate)}
                </AnimatePresence>
              </ul>
            </div>
          )}

          {/* Optional improvements */}
          {optional.length > 0 && (
            <div className="p-3 border-b border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Optional
              </div>
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {renderReadinessRows(optional, "optional", "Open", onNavigate)}
                </AnimatePresence>
              </ul>
            </div>
          )}

          {blockers.length === 0 && attention.length === 0 && optional.length === 0 && (
            <div className="p-3 border-b border-slate-100 text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-1.5 text-emerald-400" />
              <p className="text-[11px] font-semibold text-slate-600">Everything looks good.</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Preview, then publish when you’re ready.</p>
            </div>
          )}

          {/* What students will see */}
          <div className="p-3 bg-slate-50/80 mt-auto space-y-2 text-[11px] text-slate-500 leading-normal border-t border-slate-200">
            <div className="text-[9px] font-bold uppercase tracking-widest text-[#0A192F] flex items-center gap-1">
              <Eye className="w-3.5 h-3.5 text-[#0A192F]" /> What students will see
            </div>
            <div className="space-y-1.5 text-[10px] text-left">
              <div className="flex items-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0 mt-1"></span>
                <span><strong>Practice:</strong> students see whether they were right, plus your explanation, right away.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0 mt-1"></span>
                <span><strong>Assessment:</strong> answers and scores stay hidden until you release them.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0 mt-1"></span>
                <span>Students never see model answers, rubrics, or scoring guidance.</span>
              </div>
            </div>
            {aiGradedCount > 0 && (
              <div className="text-indigo-600 flex items-start gap-1 leading-relaxed text-left border-t border-slate-200 pt-2">
                <GraduationCap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Review AI-scored short answers before releasing scores.</span>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

// ---- Block Editor ----
interface BlockEditorProps {
  block: any;
  index: number;
  totalBlocks: number;
  restrictSeeking: boolean;
  onBlockChange: (index: number, key: string, val: any) => void;
  onBlockMultipleChanges: (index: number, changes: Record<string, any>) => void;
  onVideoUploaded: (index: number, url: string, thumbnail?: string, duration?: number, storagePath?: string) => void;
  onVideoThumbnailSelected: (index: number, thumbnailUrl: string) => void;
  addCheckpoint: (blockIndex: number) => void;
  updateCheckpoint: (blockIndex: number, cpId: string, partial: any) => void;
  updateCheckpointQuestion: (blockIndex: number, cpId: string, uq: any) => void;
  updateCheckpointQuestionType: (blockIndex: number, cpId: string, nextType: "mc" | "sa") => void;
  deleteCheckpoint: (blockIndex: number, cpId: string) => void;
  onBlockQuestionChange: (index: number, uq: any) => void;
  onBlockQuestionTypeChange: (index: number, nextType: "mc" | "sa") => void;
  selectedLessonId: string | undefined;
  lessonTitle?: string;
  onYouTubeSelected: (index: number, videoId: string, youtubeUrl: string, embedUrl: string, thumbnailUrl: string, duration?: number) => void;
  onDirectLinkSelected: (index: number, url: string) => void;
}

/**
 * Practice vs Assessment chooser. The same calm two-card control is used for
 * question blocks and video checkpoints so the choice always reads the same way.
 * Never surfaces the internal `isPractice` field name to teachers.
 */
function ModeSelector({
  isPractice, onChange, name,
}: {
  isPractice: boolean;
  onChange: (practice: boolean) => void;
  name: string;
}) {
  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-2">
      <span className="font-semibold text-slate-700 text-xs block">How students experience this</span>
      <div className="grid grid-cols-2 gap-3">
        <label className={`border rounded-lg p-2.5 flex flex-col gap-1 cursor-pointer transition ${!isPractice ? "bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200" : "bg-white border-slate-200 hover:border-slate-300"}`}>
          <div className="flex items-center gap-1.5 font-bold text-emerald-800 text-[11px]">
            <input type="radio" name={name} checked={!isPractice} onChange={() => onChange(false)} />
            <GraduationCap className="w-3 h-3" /> <span>Assessment</span>
          </div>
          <ul className="text-[10px] text-slate-500 space-y-0.5 list-disc pl-3">
            <li>Students submit for review</li>
            <li>Scores and answers stay hidden until you release them</li>
            <li>Counts toward the grade</li>
          </ul>
        </label>
        <label className={`border rounded-lg p-2.5 flex flex-col gap-1 cursor-pointer transition ${isPractice ? "bg-teal-50/70 border-teal-300 ring-1 ring-teal-200" : "bg-white border-slate-200 hover:border-slate-300"}`}>
          <div className="flex items-center gap-1.5 font-bold text-teal-800 text-[11px]">
            <input type="radio" name={name} checked={isPractice} onChange={() => onChange(true)} />
            <Eye className="w-3 h-3" /> <span>Practice</span>
          </div>
          <ul className="text-[10px] text-slate-500 space-y-0.5 list-disc pl-3">
            <li>Students get feedback right away</li>
            <li>Recorded as practice</li>
            <li>Doesn’t count toward the grade</li>
          </ul>
        </label>
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  index,
  restrictSeeking,
  onBlockChange,
  onBlockMultipleChanges,
  onVideoUploaded,
  onVideoThumbnailSelected,
  addCheckpoint,
  updateCheckpoint,
  updateCheckpointQuestion,
  updateCheckpointQuestionType,
  deleteCheckpoint,
  onBlockQuestionChange,
  onBlockQuestionTypeChange,
  selectedLessonId,
  lessonTitle,
  onYouTubeSelected,
  onDirectLinkSelected,
}: BlockEditorProps) {
  const typeLabel = block.type === "video" ? "Video" : block.type === "reading" ? "Reading" : "Question";

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      {/* Block header */}
      <div className={`px-5 py-3 border-b border-slate-200 flex items-center justify-between ${block.type === "video" ? "bg-blue-50" : block.type === "reading" ? "bg-purple-50" : block.isPractice ? "bg-teal-50" : "bg-emerald-50"}`}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-400">#{index + 1}</span>
          <span className={`text-xs font-bold uppercase tracking-wider ${block.type === "video" ? "text-blue-700" : block.type === "reading" ? "text-purple-700" : block.isPractice ? "text-teal-700" : "text-emerald-700"}`}>{typeLabel}</span>
        </div>
        {block.type === "question" && (
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${block.isPractice ? "bg-teal-100 text-teal-800 border border-teal-200" : "bg-emerald-100 text-emerald-800 border border-emerald-200"}`}>
            {block.isPractice ? (
              <><Eye className="w-3 h-3" /> Practice · students see feedback</>
            ) : (
              <><GraduationCap className="w-3 h-3" /> Assessment · answers stay hidden</>
            )}
          </div>
        )}
        {block.type === "video" && (
          <div className="text-[10px] text-slate-500">{restrictSeeking ? "Plays in order" : "Free seeking"}</div>
        )}
      </div>

      <div className="p-5 space-y-5 text-xs">
        {/* Block title */}
        <div>
          <label className="font-bold text-slate-700 block mb-1">Title</label>
          <input
            type="text"
            value={block.title}
            onChange={(e) => onBlockChange(index, "title", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-[#0A192F] text-slate-800 font-medium"
          />
        </div>

        {/* Video block */}
        {block.type === "video" && (
          <div className="space-y-4">
            <VideoSourcePicker
              videoUrl={block.videoUrl}
              thumbnailUrl={block.thumbnailUrl}
              storagePath={block.storagePath}
              duration={block.duration}
              videoSource={block.videoSource}
              youtubeVideoId={block.youtubeVideoId}
              youtubeEmbedUrl={block.youtubeEmbedUrl}
              onVideoUploaded={(url, thumbnail, duration, storagePath) => {
                onVideoUploaded(index, url, thumbnail, duration, storagePath);
              }}
              onThumbnailSelected={(thumbnail) => {
                onVideoThumbnailSelected(index, thumbnail);
              }}
              onYouTubeSelected={(videoId, youtubeUrl, embedUrl, thumbnailUrl, duration) => {
                onYouTubeSelected(index, videoId, youtubeUrl, embedUrl, thumbnailUrl, duration);
              }}
              onDirectLinkSelected={(url) => {
                onDirectLinkSelected(index, url);
              }}
            />

            {/* Video checkpoints */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-600" /> Checkpoints
                  </label>
                  <button type="button" onClick={() => addCheckpoint(index)} className="text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add checkpoint
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Pause the video at a moment and ask a quick question.</p>
              </div>

              {(block.videoCheckpoints || []).length === 0 && (
                <div className="text-center py-5 px-3 border border-dashed border-slate-200 rounded-lg bg-slate-50/40">
                  <Clock className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                  <p className="text-[11px] text-slate-500">No checkpoints yet — add one to check understanding mid-video.</p>
                </div>
              )}

              {(block.videoCheckpoints || []).map((cp: any) => (
                <div key={cp.id} className="border border-slate-200 rounded bg-slate-50/60 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={cp.title || ""}
                      onChange={(e) => updateCheckpoint(index, cp.id, { title: e.target.value })}
                      placeholder="Checkpoint title"
                      className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                    />
                    <button type="button" onClick={() => deleteCheckpoint(index, cp.id)} className="p-1 text-red-500 hover:text-red-700">
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div>
                      <label className="font-semibold text-slate-600 block mb-1">Pause at <span className="font-normal text-slate-400">({formatTimestamp(cp.timestamp)})</span></label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={cp.timestamp ?? 0}
                          onChange={(e) => updateCheckpoint(index, cp.id, { timestamp: Number(e.target.value) })}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400"
                        />
                        <span className="text-[10px] text-slate-400 shrink-0">sec</span>
                      </div>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-600 block mb-1">Question type</label>
                      <select
                        value={cp.questionType || "mc"}
                        onChange={(e) => {
                          const t = e.target.value as "mc" | "sa";
                          updateCheckpointQuestionType(index, cp.id, t);
                        }}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400"
                      >
                        <option value="mc">Multiple Choice</option>
                        <option value="sa">Short Answer</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 text-[11px] items-center">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!cp.isRequired} onChange={(e) => updateCheckpoint(index, cp.id, { isRequired: e.target.checked })} />
                      Required before continuing
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!cp.pauseVideo} onChange={(e) => updateCheckpoint(index, cp.id, { pauseVideo: e.target.checked })} />
                      Pause video here
                    </label>
                  </div>

                  <ModeSelector
                    isPractice={!!cp.isPractice}
                    name={`cp-mode-${cp.id}`}
                    onChange={(practice) => updateCheckpoint(index, cp.id, { isPractice: practice })}
                  />

                  {cp.questions?.[0] ? (
                    <QuestionEditor
                      key={cp.questions[0].id || cp.id}
                      question={cp.questions[0]}
                      type={(cp.questionType || "mc") as "mc" | "sa"}
                      graded={!cp.isPractice}
                      onChange={(uq) => updateCheckpointQuestion(index, cp.id, uq)}
                      lessonContext={{ lessonTitle, blockTitle: block.title }}
                      lessonId={selectedLessonId}
                      blockId={block.id}
                      checkpointId={cp.id}
                    />
                  ) : (
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      Question data missing — save and reopen to repair.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reading block */}
        {block.type === "reading" && (
          <div>
            <label className="font-bold text-slate-700 block mb-1">Reading content</label>
            <RichContentEditor
              value={block.content || ""}
              onChange={(val: any) => onBlockChange(index, "content", val)}
              mode="full"
              documentKey={`${selectedLessonId || "new"}_${block.id}_reading_content`}
            />
          </div>
        )}

        {/* Question block */}
        {block.type === "question" && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="max-w-xs">
                <label className="font-semibold text-slate-600 block mb-1">Question type</label>
                <select
                  value={block.questionType || "mc"}
                  onChange={(e) => {
                    const t = e.target.value as "mc" | "sa";
                    onBlockQuestionTypeChange(index, t);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-800 focus:outline-none"
                >
                  <option value="mc">Multiple choice</option>
                  <option value="sa">Short answer</option>
                </select>
              </div>

              <ModeSelector
                isPractice={!!block.isPractice}
                name={`block-mode-${index}`}
                onChange={(practice) => onBlockChange(index, "isPractice", practice)}
              />
            </div>

            {block.singleQuestion ? (
              <QuestionEditor
                key={block.singleQuestion.id || block.id}
                question={block.singleQuestion}
                type={(block.questionType || "mc") as "mc" | "sa"}
                graded={!block.isPractice}
                onChange={(uq) => onBlockQuestionChange(index, uq)}
                lessonContext={{ lessonTitle, blockTitle: block.title }}
                lessonId={selectedLessonId}
                blockId={block.id}
              />
            ) : (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                Question data missing — save and reopen to repair.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Assignments Tab (extracted to reduce canvas complexity) ----
function AssignmentsTab({
  lessons, courses, assignments, showAssignmentForm, setShowAssignmentForm,
  asgLessonId, setAsgLessonId, asgCourseId, setAsgCourseId,
  asgSection, setAsgSection, asgOpensAt, setAsgOpensAt,
  asgDueAt, setAsgDueAt, asgClosesAt, setAsgClosesAt,
  asgIntegrityPolicy, setAsgIntegrityPolicy, asgError, onSubmit,
  onDeleteAssignment, getDefaultOpenDate, getDefaultDueDate, getDefaultCloseDate
}: any) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-slate-200 rounded p-5 shadow-sm gap-4">
        <div>
          <h3 className="font-bold text-slate-800 text-[18px]">Assignments</h3>
          <p className="text-xs text-slate-500 mt-1">Give a course access to a published lesson, with open and due dates.</p>
        </div>
        {!showAssignmentForm && (
          <button
            onClick={() => {
              const published = lessons.filter((l: any) => l.isPublished);
              if (published.length === 0) { /* asgError handled by parent */ }
              setAsgLessonId(published[0]?.id || "");
              setShowAssignmentForm(true);
            }}
            className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm tracking-wider uppercase shrink-0"
          >
            <Plus className="w-4 h-4" /> Assign a lesson
          </button>
        )}
      </div>

      {showAssignmentForm && (
        <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded p-6 shadow-sm space-y-4 max-w-2xl">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Assign a lesson</h4>
            <button type="button" onClick={() => setShowAssignmentForm(false)} className="text-xs text-slate-400 hover:text-slate-600 font-bold uppercase">Cancel</button>
          </div>

          {asgError && (
            <div className="bg-red-50 text-red-700 text-xs p-3 rounded flex items-center gap-2 border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0" /><span>{asgError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Select Lesson *</label>
              <select value={asgLessonId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAsgLessonId(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400">
                <option value="">-- Choose Published Lesson --</option>
                {lessons.filter((l: any) => l.isPublished).map((l: any) => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </select>
              {lessons.filter((l: any) => l.isPublished).length === 0 && (
                <p className="text-[10px] text-red-500 mt-1">No published lessons. Publish a lesson first.</p>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Course / Section *</label>
              {courses.filter((c: any) => c.status !== "archived").length > 0 ? (
                <select
                  value={asgCourseId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setAsgCourseId(e.target.value);
                    const selected = courses.find((c: any) => c.id === e.target.value);
                    setAsgSection(selected?.sectionName || "");
                  }}
                  className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                  required
                >
                  <option value="">-- Select a course --</option>
                  {courses.filter((c: any) => c.status !== "archived").map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}{c.sectionName ? ` — ${c.sectionName}` : ""}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={asgCourseId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgCourseId(e.target.value)} placeholder="e.g. AP Biology" className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Opens *</label>
              <input type="datetime-local" value={asgOpensAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgOpensAt(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Due *</label>
              <input type="datetime-local" value={asgDueAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgDueAt(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Closes *</label>
              <input type="datetime-local" value={asgClosesAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgClosesAt(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <LearningConditionsEditor value={asgIntegrityPolicy} onChange={setAsgIntegrityPolicy} />
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button type="submit" disabled={lessons.filter((l: any) => l.isPublished).length === 0} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold px-5 py-2.5 rounded shadow-sm tracking-wide uppercase transition cursor-pointer">
              Assign to course
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <h4 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Active assignments ({assignments.length})</h4>
        </div>
        {assignments.length === 0 ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 text-slate-300 mb-2" />
            <p className="text-xs font-bold text-slate-600">No assignments yet</p>
            <p className="text-[11px] text-slate-400 mt-1">Publish a lesson, then assign it to a course.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="p-3">Course</th>
                  <th className="p-3">Lesson</th>
                  <th className="p-3">Opens</th>
                  <th className="p-3">Due</th>
                  <th className="p-3">Closes</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {assignments.map((asg: any) => {
                  const now = new Date().toISOString();
                  const opens = asg.opensAt || "";
                  const closes = asg.closesAt || "";
                  const courseName = (courses.find((c: any) => c.id === asg.courseId)?.name) || asg.courseId;
                  let statusNode = null;
                  if (now < opens) statusNode = <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Scheduled</span>;
                  else if (now <= closes) statusNode = <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Open</span>;
                  else statusNode = <span className="bg-slate-100 text-slate-500 border border-slate-200 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Closed</span>;
                  return (
                    <tr key={asg.id} className="hover:bg-slate-50/50">
                      <td className="p-3"><span className="font-bold text-slate-800">{courseName}</span>{asg.section && <span className="text-slate-400 ml-1.5">· {asg.section}</span>}</td>
                      <td className="p-3 font-semibold text-slate-800">{asg.lessonTitle || "Untitled lesson"}</td>
                      <td className="p-3 text-[11px] text-slate-500">{new Date(opens).toLocaleString()}</td>
                      <td className="p-3 text-[11px] text-slate-500 font-semibold">{new Date(asg.dueAt).toLocaleString()}</td>
                      <td className="p-3 text-[11px] text-slate-500">{new Date(closes).toLocaleString()}</td>
                      <td className="p-3 text-center">{statusNode}</td>
                      <td className="p-3 text-right">
                        <button type="button" onClick={() => { if (window.confirm("Remove this assignment? Students will lose access.")) onDeleteAssignment && onDeleteAssignment(asg.id); }} className="text-red-600 hover:text-red-800 font-bold uppercase text-[9px] tracking-widest px-2.5 py-1 rounded hover:bg-red-50 transition cursor-pointer">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
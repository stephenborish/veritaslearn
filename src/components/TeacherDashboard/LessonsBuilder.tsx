import React, { useState, useEffect, useRef } from "react";
import {
  Plus, Trash, Settings, Save, AlertCircle, FileText, Video, Clock,
  ArrowUp, ArrowDown, BookOpen, Calendar, Eye, Play, CheckCircle,
  ChevronRight, ChevronLeft, HelpCircle, Info, Send, GraduationCap,
  BarChart2, Layers
} from "lucide-react";
import { Lesson, LessonBlock } from "../../types";
import VideoUploader from "./VideoUploader";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import QuestionEditor, { validateQuestionClient } from "./QuestionEditor";
import LearningConditionsEditor, { buildDefaultPolicy, type IntegrityPolicy } from "./LearningConditionsEditor";

function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

function newQuestionTemplate(type: "mc" | "sa"): any {
  const base = { id: uid("q"), type, stem: "", points: 5 };
  if (type === "mc") {
    const choices = [
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
  onSaveLesson: (lessonData: any) => Promise<any>;
  onArchived: (id: string) => Promise<void>;
  assignments?: any[];
  onSaveAssignment?: (payload: any) => Promise<void>;
  onDeleteAssignment?: (id: string) => Promise<void>;
  onLaunchPreviewAttempt?: (lessonId: string) => Promise<void>;
  courses?: any[];
  onEditingDirtyChange?: (isDirty: boolean) => void;
  idToken?: string | null;
}

export default function LessonsBuilder({
  lessons,
  blocks,
  onSaveLesson,
  onArchived,
  assignments = [],
  onSaveAssignment,
  onDeleteAssignment,
  onLaunchPreviewAttempt,
  courses = [],
  onEditingDirtyChange,
  idToken,
}: LessonsBuilderProps) {
  const [selectedLesson, setSelectedLesson] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<any>("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [isPublished, setIsPublished] = useState(false);
  const [restrictSeeking, setRestrictSeeking] = useState(true);
  const [requireFullscreen, setRequireFullscreen] = useState(true);
  const [allowRetakes, setAllowRetakes] = useState(false);
  const [randomizeChoices, setRandomizeChoices] = useState(true);
  const [immediateFeedback, setImmediateFeedback] = useState(false);

  const [builderSubTab, setBuilderSubTab] = useState<"library" | "assignments">("library");

  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [asgLessonId, setAsgLessonId] = useState("");
  const [asgCourseId, setAsgCourseId] = useState("");
  const [asgSection, setAsgSection] = useState("");
  const [asgIntegrityPolicy, setAsgIntegrityPolicy] = useState<IntegrityPolicy>(buildDefaultPolicy("open"));

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

  // activeWorkspace: "setup" | number (block index)
  const [activeWorkspace, setActiveWorkspace] = useState<"setup" | number>("setup");

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

  const [saveStatus, setSaveStatus] = useState<"clean" | "saving" | "saved" | "error">("clean");
  const [isDirty, setIsDirty] = useState(false);
  const [initialSnapshotStr, setInitialSnapshotStr] = useState("");
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const [currentBlocks, setCurrentBlocks] = useState<any[]>([]);

  const [asgOpensAt, setAsgOpensAt] = useState(getDefaultOpenDate());
  const [asgDueAt, setAsgDueAt] = useState(getDefaultDueDate());
  const [asgClosesAt, setAsgClosesAt] = useState(getDefaultCloseDate());
  const [asgError, setAsgError] = useState("");

  // ---- Normalize helpers ----

  const ensureQuestionForBlock = (block: any): any => {
    if (block.type !== "question") return block;
    if (block.singleQuestion && block.singleQuestion.id) return block;
    return {
      ...block,
      questionType: block.questionType || "mc",
      singleQuestion: newQuestionTemplate(block.questionType || "mc")
    };
  };

  const ensureQuestionForCheckpoint = (cp: any): any => {
    const questions = cp.questions || [];
    if (questions[0] && questions[0].id) return cp;
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

  // Type-safe question type converter — preserves id, stem, points
  const convertQuestionType = (existing: any, nextType: "mc" | "sa"): any => {
    const q = existing || {};
    const base = {
      id: q.id || uid("q"),
      type: nextType,
      stem: q.stem ?? "",
      points: q.points ?? 5,
    };

    if (nextType === "mc") {
      let choices = q.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        choices = [
          { id: uid("choice"), text: "" },
          { id: uid("choice"), text: "" },
        ];
      }
      const correctChoiceId = q.correctChoiceId || (choices[0] && choices[0].id) || "";
      return { ...base, choices, correctChoiceId, explanation: q.explanation ?? "" };
    } else {
      return {
        ...base,
        modelAnswer: q.modelAnswer ?? "",
        aiScoringGuidance: q.aiScoringGuidance ?? "",
        teacherNotes: q.teacherNotes ?? "",
        rubricCategories: q.rubricCategories ?? [],
        studentInstructions: q.studentInstructions ?? ""
      };
    }
  };

  // ---- Snapshot for dirty detection ----
  const getSnapshot = () => JSON.stringify({
    title, description, estimatedMinutes, isPublished,
    restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback,
    currentBlocks
  });

  // ---- Open editor for existing lesson ----
  const startEditing = (lesson: any) => {
    setSelectedLesson(lesson);
    setTitle(lesson.title);
    setDescription(lesson.description);
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
    setCurrentBlocks(normalized);
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
    setEstimatedMinutes(25);
    setIsPublished(false);
    setRestrictSeeking(true);
    setRequireFullscreen(true);
    setAllowRetakes(false);
    setRandomizeChoices(true);
    setImmediateFeedback(false);
    setCurrentBlocks([]);
    setActiveWorkspace("setup");
    setSaveStatus("clean");
    setSaveError(null);
    setServerDraft(null);
    setServerDraftConflict(false);
    setAutosaveStatus("idle");
    setServerDataUpdated(false);
    editingStartedAtRef.current = new Date().toISOString();

    const snap = JSON.stringify({
      title: "", description: "", estimatedMinutes: 25, isPublished: false,
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
    const nextBlocks = [...currentBlocks, newBlock];
    setCurrentBlocks(nextBlocks);
    setActiveWorkspace(nextBlocks.length - 1);
  };

  const handleDeleteBlock = (index: number) => {
    const nextBlocks = currentBlocks.filter((_: any, idx: number) => idx !== index);
    setCurrentBlocks(nextBlocks);
    if (activeWorkspace === index) {
      setActiveWorkspace(nextBlocks.length > 0 ? Math.min(index, nextBlocks.length - 1) : "setup");
    } else if (typeof activeWorkspace === "number" && activeWorkspace > index) {
      setActiveWorkspace(activeWorkspace - 1);
    }
  };

  const moveBlock = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === currentBlocks.length - 1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const updated = [...currentBlocks];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setCurrentBlocks(updated);
    if (activeWorkspace === index) setActiveWorkspace(targetIndex);
    else if (activeWorkspace === targetIndex) setActiveWorkspace(index);
  };

  const handleBlockChange = (index: number, key: string, val: any) => {
    setCurrentBlocks((prev: any[]) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [key]: val };
      return updated;
    });
  };

  const handleBlockMultipleChanges = (index: number, changes: Record<string, any>) => {
    setCurrentBlocks((prev: any[]) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...changes };
      return updated;
    });
  };

  // ---- Video checkpoint authoring ----
  const addCheckpoint = (blockIndex: number) => {
    const block = currentBlocks[blockIndex];
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
    handleBlockChange(blockIndex, "videoCheckpoints", [...cps, cp]);
  };

  const updateCheckpoint = (blockIndex: number, cpId: string, partial: any) => {
    const block = currentBlocks[blockIndex];
    const cps = (block.videoCheckpoints || []).map((cp: any) => (cp.id === cpId ? { ...cp, ...partial } : cp));
    handleBlockChange(blockIndex, "videoCheckpoints", cps);
  };

  const updateCheckpointQuestion = (blockIndex: number, cpId: string, uq: any) => {
    const block = currentBlocks[blockIndex];
    const cps = (block.videoCheckpoints || []).map((cp: any) => (cp.id === cpId ? { ...cp, questions: [uq] } : cp));
    handleBlockChange(blockIndex, "videoCheckpoints", cps);
  };

  const deleteCheckpoint = (blockIndex: number, cpId: string) => {
    const block = currentBlocks[blockIndex];
    handleBlockChange(blockIndex, "videoCheckpoints", (block.videoCheckpoints || []).filter((cp: any) => cp.id !== cpId));
  };

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
        localStorage.setItem(activeDraftKeyRef.current, JSON.stringify({
          timestamp: Date.now(),
          title, description, estimatedMinutes, isPublished,
          restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback,
          currentBlocks
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
    const capturedTitle = title;
    const capturedDescription = description;
    const capturedEstimatedMinutes = estimatedMinutes;
    const capturedIsPublished = isPublished;
    const capturedSettings = { restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback };
    const capturedBlocks = currentBlocks;
    const capturedToken = idToken;

    const timer = setTimeout(async () => {
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
            baseLessonUpdatedAt
          })
        });
        if (res.ok) {
          setAutosaveStatus("saved");
          setTimeout(() => setAutosaveStatus((s: "idle" | "saving" | "saved" | "failed") => s === "saved" ? "idle" : s), 3000);
        } else {
          setAutosaveStatus("failed");
        }
      } catch {
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
    setCurrentBlocks(restoredBlocks);
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
    setCurrentBlocks(restoredBlocks);
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
      currentBlocks.forEach((b: any, i: number) => {
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

    const payload = {
      id: selectedLesson?.id === "new" ? undefined : selectedLesson?.id,
      title,
      description,
      estimatedMinutes,
      isPublished: publishedStatus,
      settings: { restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback },
      blocks: currentBlocks
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
        setCurrentBlocks(resolvedBlocks);
        setIsPublished(savedResult.isPublished);

        const newSnap = JSON.stringify({
          title: savedResult.title || title,
          description: savedResult.description ?? description,
          estimatedMinutes: savedResult.estimatedMinutes ?? estimatedMinutes,
          isPublished: savedResult.isPublished,
          restrictSeeking: savedResult.settings?.restrictSeeking ?? restrictSeeking,
          requireFullscreen: savedResult.settings?.requireFullscreen ?? requireFullscreen,
          allowRetakes: savedResult.settings?.allowRetakes ?? allowRetakes,
          randomizeChoices: savedResult.settings?.randomizeChoices ?? randomizeChoices,
          immediateFeedback: savedResult.settings?.immediateFeedback ?? immediateFeedback,
          currentBlocks: resolvedBlocks
        });
        setInitialSnapshotStr(newSnap);
      } else {
        setInitialSnapshotStr(JSON.stringify({
          title, description, estimatedMinutes, isPublished: publishedStatus,
          restrictSeeking, requireFullscreen, allowRetakes, randomizeChoices, immediateFeedback,
          currentBlocks
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
    await saveWithPublishedStatus(true);
  };

  const handleAssignAndLaunch = async () => {
    const savedLesson = await saveWithPublishedStatus(isPublished);
    if (savedLesson && savedLesson.id) {
      setAsgLessonId(savedLesson.id);
      setShowAssignmentForm(true);
      setBuilderSubTab("assignments");
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

  // ---- Assignment form ----
  const handleCreateAssignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAsgError("");
    if (!asgLessonId) { setAsgError("Please select a lesson plan to assign."); return; }
    if (!asgCourseId.trim()) { setAsgError("Please select a course."); return; }
    if (new Date(asgOpensAt) >= new Date(asgDueAt)) { setAsgError("Opening date must be before due date."); return; }
    if (new Date(asgDueAt) > new Date(asgClosesAt)) { setAsgError("Due date must be on or before closing date."); return; }
    if (onSaveAssignment) {
      await onSaveAssignment({
        lessonId: asgLessonId,
        courseId: asgCourseId.trim(),
        section: asgSection.trim(),
        opensAt: new Date(asgOpensAt).toISOString(),
        dueAt: new Date(asgDueAt).toISOString(),
        closesAt: new Date(asgClosesAt).toISOString(),
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
  type ReadinessIssue = { message: string; target: "setup" | number };

  const computeReadiness = (): {
    issues: ReadinessIssue[];
    warnings: ReadinessIssue[];
    gradedQCount: number;
    practiceQCount: number;
    videoCount: number;
    readingCount: number;
    aiGradedCount: number;
  } => {
    const issues: ReadinessIssue[] = [];
    const warnings: ReadinessIssue[] = [];
    let gradedQCount = 0, practiceQCount = 0, videoCount = 0, readingCount = 0, aiGradedCount = 0;

    if (!title.trim()) issues.push({ message: "Lesson title is required.", target: "setup" });
    if (currentBlocks.length === 0) issues.push({ message: "Add at least one block.", target: "setup" });

    currentBlocks.forEach((b: any, i: number) => {
      if (!b.title?.trim()) issues.push({ message: `Block ${i + 1}: title is missing.`, target: i });
      if (b.type === "video") {
        videoCount++;
        if (!b.videoUrl && !b.storagePath) issues.push({ message: `Block ${i + 1}: no video source.`, target: i });
        const cps: any[] = b.videoCheckpoints || [];
        cps.forEach((cp: any, ci: number) => {
          const q = cp.questions?.[0];
          if (!cp.isPractice) {
            gradedQCount++;
            if (q?.type === "mc") {
              if (!q.correctChoiceId) issues.push({ message: `Block ${i + 1} checkpoint ${ci + 1}: no correct answer.`, target: i });
              const nonBlank = (q.choices || []).filter((c: any) => isChoiceNonBlank(c));
              if (nonBlank.length < 2) issues.push({ message: `Block ${i + 1} checkpoint ${ci + 1}: need ≥2 choices.`, target: i });
            }
            if (!q) issues.push({ message: `Block ${i + 1} checkpoint ${ci + 1}: missing question.`, target: i });
            if (cp.timestamp < 0) issues.push({ message: `Block ${i + 1} checkpoint ${ci + 1}: invalid timestamp.`, target: i });
            if (q?.type === "sa") {
              aiGradedCount++;
              if (!(q.rubricCategories?.length >= 1)) {
                issues.push({ message: `Block ${i + 1} checkpoint ${ci + 1}: add a rubric category for AI grading.`, target: i });
              } else {
                const rubricTotal = (q.rubricCategories as any[]).reduce((s: number, c: any) => s + (Number(c.maxPoints) || 0), 0);
                if (q.points > 0 && rubricTotal !== q.points) {
                  issues.push({ message: `Block ${i + 1} checkpoint ${ci + 1}: rubric total (${rubricTotal} pts) ≠ question points (${q.points} pts).`, target: i });
                }
              }
            }
          } else {
            practiceQCount++;
          }
        });
      } else if (b.type === "reading") {
        readingCount++;
        const hasContent = typeof b.content === "string"
          ? b.content.trim().length > 0
          : !!(b.content?.plainText?.trim() || b.content?.html?.replace(/<[^>]*>/g, "").trim());
        if (!hasContent) issues.push({ message: `Block ${i + 1}: reading content is empty.`, target: i });
      } else if (b.type === "question" && b.singleQuestion) {
        if (!b.isPractice) {
          gradedQCount++;
          const q = b.singleQuestion;
          const stemOk = typeof q.stem === "string" ? q.stem.trim().length > 0 : !!(q.stem?.plainText?.trim() || q.stem?.html?.replace(/<[^>]*>/g, "").trim());
          if (!stemOk) issues.push({ message: `Block ${i + 1}: question stem is required.`, target: i });
          if (q.type === "mc") {
            if (!q.correctChoiceId) issues.push({ message: `Block ${i + 1}: no correct answer selected.`, target: i });
            const nonBlank = (q.choices || []).filter((c: any) => isChoiceNonBlank(c));
            if (nonBlank.length < 2) issues.push({ message: `Block ${i + 1}: need ≥2 answer choices.`, target: i });
            const blank = (q.choices || []).filter((c: any) => !isChoiceNonBlank(c));
            if (blank.length > 0) issues.push({ message: `Block ${i + 1}: blank choices not allowed.`, target: i });
          } else if (q.type === "sa") {
            aiGradedCount++;
            if (!(q.rubricCategories?.length >= 1)) {
              issues.push({ message: `Block ${i + 1}: add a rubric category for AI grading.`, target: i });
            } else {
              const rubricTotal = (q.rubricCategories as any[]).reduce((s: number, c: any) => s + (Number(c.maxPoints) || 0), 0);
              if (q.points > 0 && rubricTotal !== q.points) {
                issues.push({ message: `Block ${i + 1}: rubric total (${rubricTotal} pts) ≠ question points (${q.points} pts). Adjust categories or points.`, target: i });
              }
            }
            const hasModelAnswer = q.modelAnswer && (
              typeof q.modelAnswer === "string" ? q.modelAnswer.trim().length > 0 : !!(q.modelAnswer as any).plainText?.trim()
            );
            if (!hasModelAnswer) {
              warnings.push({ message: `Block ${i + 1}: no model answer — AI grading quality may be lower.`, target: i });
            }
          }
        } else {
          practiceQCount++;
        }
      }
    });

    return { issues, warnings, gradedQCount, practiceQCount, videoCount, readingCount, aiGradedCount };
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
              Lessons Library
            </button>
            <button
              onClick={() => setBuilderSubTab("assignments")}
              className={`pb-3 px-4 font-sans text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-1.5 ${builderSubTab === "assignments" ? "border-[#0A192F] text-[#0A192F]" : "border-transparent text-slate-400 hover:text-slate-600"}`}
            >
              <Calendar className="w-4 h-4" /> Assignments Manager
            </button>
          </div>

          {builderSubTab === "library" ? (
            <div className="space-y-6">
              <div className="flex justify-end mb-4">
                <button
                  onClick={startNewLesson}
                  className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm tracking-wider uppercase"
                >
                  <Plus className="w-4 h-4" /> Create Lesson Plan
                </button>
              </div>

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
                          <div className="space-y-1">
                            <h3 className="text-base font-bold text-slate-900 tracking-tight text-left">{lesson.title}</h3>
                            <span className="text-[10px] font-mono font-bold text-slate-400 block tracking-tight">ID: {lesson.id.toUpperCase()}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-[9px] font-bold font-mono uppercase tracking-widest px-2 py-0.5 rounded-sm border ${lesson.isPublished ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-100 text-slate-550 border-slate-200"}`}>
                              {lesson.isPublished ? "Published" : "Draft State"}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                          {(() => {
                            const desc = lesson.description;
                            if (!desc) return "Complete this lesson segment.";
                            if (typeof desc === "object") return (desc as any).plainText || ((desc as any).html ? (desc as any).html.replace(/<[^>]*>/g, "") : "");
                            return String(desc).replace(/<[^>]*>/g, "").trim() || "Complete this lesson segment.";
                          })()}
                        </p>

                        <div className="bg-slate-50/50 border border-slate-200/60 rounded-md p-3.5 space-y-2">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Lesson Structure</div>
                          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[11px] text-slate-600 font-medium">
                            <span>Videos: <strong>{videoCount}</strong></span>
                            <span>Passages: <strong>{readingCount}</strong></span>
                            <span>Practice Qs: <strong>{practiceCount}</strong></span>
                            <span>Graded Qs: <strong className="text-[#0a192f]">{gradedCount}</strong></span>
                          </div>
                        </div>

                        <div className="border-t border-slate-100 pt-3.5 space-y-2 text-left">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Student Access</span>
                          {!lesson.isPublished ? (
                            <div className="bg-amber-50 border border-amber-200/70 p-2.5 rounded text-slate-700">
                              <div className="flex items-center gap-1.5 text-amber-800 font-bold uppercase tracking-wider text-[10px]">
                                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                                <span>Unpublished Draft — Students Blocked</span>
                              </div>
                            </div>
                          ) : lessonAsgs.length === 0 ? (
                            <div className="bg-slate-100/80 border border-slate-200 p-2.5 rounded text-slate-600">
                              <div className="font-bold text-slate-700 text-[10px] uppercase tracking-wider">Published · Not Yet Assigned</div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {lessonAsgs.map((asg) => {
                                const opens = asg.opensAt || "";
                                const closes = asg.closesAt || "";
                                let badge = null;
                                if (now < opens) badge = <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Scheduled</span>;
                                else if (now <= closes) badge = <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase animate-pulse">● Active</span>;
                                else badge = <span className="bg-red-50 text-red-600 border border-red-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase">Closed</span>;
                                return (
                                  <div key={asg.id} className="bg-slate-50 border border-slate-200 p-2 rounded flex justify-between items-center gap-2 text-[11px]">
                                    <span className="font-semibold text-slate-700">{asg.courseId}{asg.section ? ` · ${asg.section}` : ""}</span>
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
                            className="bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold uppercase text-[9px] tracking-widest border border-amber-200 px-3 py-1.5 rounded transition cursor-pointer"
                          >
                            Preview Student
                          </button>
                          <button
                            onClick={() => { setBuilderSubTab("assignments"); setAsgLessonId(lesson.id); setShowAssignmentForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                            disabled={!lesson.isPublished}
                            className={`text-[9px] tracking-widest font-bold uppercase px-3 py-1.5 rounded transition border ${lesson.isPublished ? "bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white" : "bg-slate-100 text-slate-350 border-slate-200 cursor-not-allowed"}`}
                          >
                            Assign / Launch
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

          {/* Sticky command bar */}
          <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <BookOpen className="w-4 h-4 text-[#0A192F] shrink-0" />
              <span className="font-bold text-slate-800 text-sm truncate max-w-xs">{title || "Untitled Lesson"}</span>
              {/* Derived status badge */}
              {(() => {
                const lessonAsgs = assignments.filter((a: any) => a.lessonId === selectedLesson?.id && selectedLesson?.id !== "new");
                const now = new Date().toISOString();
                if (!isPublished) {
                  return (
                    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-600 border border-slate-200">
                      {isDirty ? "Unsaved changes" : "Draft"}
                    </span>
                  );
                }
                if (lessonAsgs.length === 0) {
                  return <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-200">Published · Not assigned</span>;
                }
                const active = lessonAsgs.some((a: any) => now >= a.opensAt && now <= (a.closesAt || a.dueAt));
                if (active) return <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0 bg-green-100 text-green-800 border border-green-200 animate-pulse">● Active</span>;
                const upcoming = lessonAsgs.some((a: any) => now < a.opensAt);
                if (upcoming) return <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0 bg-blue-50 text-blue-700 border border-blue-200">Assigned</span>;
                return <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-500 border border-slate-200">Closed</span>;
              })()}
              {/* Save state indicator */}
              <span className="text-[11px] font-medium flex items-center gap-1 shrink-0">
                {saveStatus === "saving" && <span className="text-blue-600 flex items-center gap-1"><Clock className="w-3.5 h-3.5 animate-spin" /> Saving…</span>}
                {saveStatus === "saved" && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Saved</span>}
                {saveStatus === "error" && <span className="text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Save failed</span>}
                {saveStatus === "clean" && isDirty && autosaveStatus === "saving" && <span className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3 animate-spin" /> Autosaving…</span>}
                {saveStatus === "clean" && isDirty && autosaveStatus === "saved" && <span className="text-slate-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Draft saved</span>}
                {saveStatus === "clean" && isDirty && autosaveStatus === "failed" && <span className="text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Draft save failed</span>}
                {saveStatus === "clean" && isDirty && (autosaveStatus === "idle") && <span className="text-amber-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 animate-pulse" /> Unsaved changes</span>}
                {saveStatus === "clean" && !isDirty && lastSavedAt && (
                  <span className="text-slate-400 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Saved {formatRelativeTime(lastSavedAt)}
                  </span>
                )}
                {saveStatus === "clean" && !isDirty && !lastSavedAt && (
                  <span className="text-slate-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> No changes</span>
                )}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 items-center shrink-0">
              <button onClick={handleReturnToLibrary} className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold px-2.5 py-1.5 rounded transition cursor-pointer">
                ← Library
              </button>
              <button onClick={handleSaveAsDraft} disabled={saveStatus === "saving"} className="bg-slate-600 hover:bg-slate-700 text-white text-xs font-bold px-2.5 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm">
                <Save className="w-3.5 h-3.5" /> Save Draft
              </button>
              <button
                onClick={handlePublishLive}
                disabled={saveStatus === "saving"}
                className={`text-white text-xs font-bold px-2.5 py-1.5 rounded transition cursor-pointer shadow-sm ${isPublished ? "bg-emerald-500 hover:bg-emerald-600" : "bg-emerald-600 hover:bg-emerald-700"}`}
              >
                {isPublished ? "Re-Publish" : "Publish Lesson"}
              </button>
              <button onClick={handleAssignAndLaunch} disabled={saveStatus === "saving"} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-2.5 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm">
                <Calendar className="w-3.5 h-3.5" /> Assign
              </button>
              <button
                onClick={handlePreviewAsStudent}
                disabled={saveStatus === "saving"}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-2.5 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm"
                title={isDirty ? "Saves draft then launches preview" : "Preview the student experience"}
              >
                <Eye className="w-3.5 h-3.5" />
                {isDirty ? "Save & Preview" : "Preview"}
              </button>
            </div>
          </div>

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
            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                    <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                      <Send className="w-4 h-4 text-emerald-700" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">Publish this lesson?</h3>
                      <p className="text-xs text-slate-500">"{title || "Untitled Lesson"}"</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">What students will see</div>
                    <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-slate-600">
                      <span>Content blocks</span><span className="font-bold text-slate-800">{r.gradedQCount + r.practiceQCount > 0 ? currentBlocks.length : currentBlocks.length}</span>
                      <span>Practice questions</span><span className="font-bold text-slate-800">{r.practiceQCount}</span>
                      <span>Assessment questions</span><span className="font-bold text-slate-800">{r.gradedQCount}</span>
                      {r.aiGradedCount > 0 && <><span>AI-graded (SA)</span><span className="font-bold text-indigo-700">{r.aiGradedCount}</span></>}
                    </div>
                  </div>

                  {r.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                        <Info className="w-3 h-3" /> Suggestions
                      </div>
                      {r.warnings.map((w, i) => (
                        <div key={i} className="text-xs text-amber-700 pl-3">• {w.message}</div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-slate-500 leading-relaxed">
                    After publishing, this lesson can be assigned to a course. Students cannot access it until it's assigned and the availability window opens.
                  </p>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowPublishConfirm(false)}
                      className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm py-2.5 rounded font-semibold transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmPublish}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm py-2.5 rounded font-bold transition cursor-pointer"
                    >
                      Publish Lesson
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

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

                const stages = [
                  {
                    key: "setup", label: "Lesson Setup", icon: Settings,
                    done: setupDone, action: () => setActiveWorkspace("setup"),
                    active: activeWorkspace === "setup"
                  },
                  {
                    key: "content", label: "Build Content", icon: Layers,
                    done: contentDone, action: () => setActiveWorkspace(currentBlocks.length > 0 ? 0 : "setup"),
                    active: typeof activeWorkspace === "number" && currentBlocks[activeWorkspace]?.type !== "question",
                    note: "Add blocks below"
                  },
                  {
                    key: "questions", label: "Questions & Rubrics", icon: HelpCircle,
                    done: questionsDone, action: () => {
                      const qi = currentBlocks.findIndex((b: any) => b.type === "question");
                      if (qi >= 0) setActiveWorkspace(qi);
                    },
                    active: typeof activeWorkspace === "number" && currentBlocks[activeWorkspace]?.type === "question",
                    note: r.issues.length > 0 ? `${r.issues.length} issue${r.issues.length !== 1 ? "s" : ""}` : undefined
                  },
                  {
                    key: "preview", label: "Preview as Student", icon: Eye,
                    done: false, action: handlePreviewAsStudent, active: false,
                    note: isDirty ? "Saves first" : undefined
                  },
                  {
                    key: "publish", label: "Publish", icon: Send,
                    done: isPublished, action: handlePublishLive, active: false,
                    note: isPublished ? "Published" : questionsDone ? "Ready" : "Fix issues first"
                  },
                  {
                    key: "assign", label: "Assign to Course", icon: Calendar,
                    done: lessonAsgs.length > 0, action: handleAssignAndLaunch, active: false,
                    note: !isPublished ? "Publish first" : lessonAsgs.length > 0 ? `${lessonAsgs.length} active` : undefined
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
                            <span className={`text-[9px] font-bold uppercase shrink-0 ${stage.note.includes("issue") || stage.note === "Fix issues first" || stage.note === "Publish first" ? "text-amber-500" : "text-slate-400"}`}>
                              {stage.note}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Block sequence */}
              <div className="flex-1 p-3 space-y-1 overflow-y-auto">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Student Sequence</div>
                {currentBlocks.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic text-center py-4">No blocks yet.<br/>Add one below.</p>
                ) : (
                  currentBlocks.map((b: any, idx: number) => {
                    const cfg = blockTypeConfig(b.type);
                    const IconComp = cfg.icon;
                    const isActive = activeWorkspace === idx;
                    const { issues } = computeReadiness();
                    const blockIssues = issues.filter((iss) => iss.target === idx);
                    const hasIssues = blockIssues.length > 0;

                    return (
                      <div key={b.id} className={`group relative rounded border transition cursor-pointer ${isActive ? "bg-[#0A192F] border-[#0A192F] text-white" : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700"}`}>
                        <button
                          onClick={() => setActiveWorkspace(idx)}
                          className="w-full text-left flex items-start gap-2 px-2 py-2"
                        >
                          <span className={`font-mono text-[9px] shrink-0 mt-0.5 ${isActive ? "text-white/60" : "text-slate-400"}`}>#{idx + 1}</span>
                          <IconComp className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? "text-white/80" : cfg.color}`} />
                          <div className="min-w-0 flex-1">
                            <span className="text-[11px] font-semibold block truncate">{b.title || `Untitled ${b.type}`}</span>
                            <span className={`text-[9px] font-bold uppercase ${isActive ? "text-white/60" : "text-slate-400"}`}>{cfg.label}{b.type === "question" ? (b.isPractice ? " · Practice" : " · Graded") : ""}</span>
                          </div>
                          {hasIssues && !isActive && (
                            <AlertCircle className="w-3 h-3 text-rose-500 shrink-0 mt-0.5" />
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
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add block buttons */}
              <div className="border-t border-slate-100 p-3 space-y-1">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Add Block</div>
                <button onClick={() => handleAddBlock("video")} className="w-full text-left flex items-center gap-2 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1.5 rounded transition">
                  <Video className="w-3.5 h-3.5 shrink-0" /> + Video
                </button>
                <button onClick={() => handleAddBlock("reading")} className="w-full text-left flex items-center gap-2 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1.5 rounded transition">
                  <FileText className="w-3.5 h-3.5 shrink-0" /> + Reading
                </button>
                <button onClick={() => handleAddBlock("question")} className="w-full text-left flex items-center gap-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded transition">
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" /> + Question
                </button>
              </div>
            </aside>

            {/* CENTER WORKSPACE */}
            <main className="flex-1 min-w-0 overflow-y-auto">
              {activeWorkspace === "setup" ? (
                // ---- Setup panel ----
                <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#0A192F] flex items-center gap-1.5 border-b border-slate-100 pb-3">
                    <Settings className="w-4 h-4" /> Lesson Setup
                  </h4>

                  <div className="space-y-4 text-xs max-w-2xl">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Lesson Title <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Enter a clear, descriptive title"
                        className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-[#0A192F] text-slate-800 font-medium"
                      />
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Lesson Overview / Description</label>
                      <RichContentEditor
                        value={description}
                        onChange={(val: any) => setDescription(val)}
                        mode="compact"
                        placeholder="Briefly describe what students will learn..."
                        documentKey={`lesson-desc-${selectedLesson?.id || "new"}`}
                      />
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Estimated Completion Time</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={estimatedMinutes}
                          onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                          className="w-24 bg-slate-50 border border-slate-200 rounded px-3 py-2 focus:outline-none focus:border-[#0A192F] text-slate-800"
                        />
                        <span className="text-slate-500">minutes</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4 space-y-3">
                      <span className="font-bold text-slate-700 block">Delivery Rules</span>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={restrictSeeking} onChange={(e) => setRestrictSeeking(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Restrict video seeking — students cannot skip ahead
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={requireFullscreen} onChange={(e) => setRequireFullscreen(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Require fullscreen focus — log focus monitoring events
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={allowRetakes} onChange={(e) => setAllowRetakes(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Allow retakes after completion
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={randomizeChoices} onChange={(e) => setRandomizeChoices(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Randomize answer choices per student
                      </label>
                      <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                        <input type="checkbox" checked={immediateFeedback} onChange={(e) => setImmediateFeedback(e.target.checked)} className="focus:ring-0 rounded-sm" />
                        Show immediate feedback after practice questions
                      </label>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                      <div className="bg-slate-50 border border-slate-200 rounded p-3">
                        <label className="flex items-start gap-2 font-semibold text-slate-800 cursor-pointer text-[12px] hover:text-slate-900 transition">
                          <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="focus:ring-0 rounded-sm mt-0.5" />
                          <div>
                            <span>Published — make assignable to students</span>
                            <p className="text-[10px] font-normal text-slate-500 mt-0.5 leading-relaxed">
                              Once published, this lesson can be assigned and accessed by students. Unpublished drafts are hidden from all student portals.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
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
                  addCheckpoint={addCheckpoint}
                  updateCheckpoint={updateCheckpoint}
                  updateCheckpointQuestion={updateCheckpointQuestion}
                  deleteCheckpoint={deleteCheckpoint}
                  convertQuestionType={convertQuestionType}
                  newQuestionTemplate={newQuestionTemplate}
                  selectedLessonId={selectedLesson?.id}
                  lessonTitle={title}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg p-16 text-center text-slate-400 text-sm">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold text-slate-600">Select a block from the sequence rail</p>
                  <p className="text-xs mt-1">or click <strong>Lesson Setup</strong> to edit lesson metadata</p>
                </div>
              )}
            </main>

            {/* RIGHT READINESS PANEL */}
            {(() => {
              const r = computeReadiness();
              return (
                <ReadinessPanel
                  issues={r.issues}
                  warnings={r.warnings}
                  gradedQCount={r.gradedQCount}
                  practiceQCount={r.practiceQCount}
                  videoCount={r.videoCount}
                  readingCount={r.readingCount}
                  aiGradedCount={r.aiGradedCount}
                  totalBlocks={currentBlocks.length}
                  saveStatus={saveStatus}
                  isDirty={isDirty}
                  lastSavedAt={lastSavedAt}
                  selectedLessonId={selectedLesson?.id}
                  isPublished={isPublished}
                  onNavigate={setActiveWorkspace}
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

interface ReadinessPanelProps {
  issues: Array<{ message: string; target: "setup" | number }>;
  warnings: Array<{ message: string; target: "setup" | number }>;
  gradedQCount: number;
  practiceQCount: number;
  videoCount: number;
  readingCount: number;
  aiGradedCount: number;
  totalBlocks: number;
  saveStatus: string;
  isDirty: boolean;
  lastSavedAt: Date | null;
  selectedLessonId: string | undefined;
  isPublished: boolean;
  onNavigate: (target: "setup" | number) => void;
}

function ReadinessPanel({
  issues, warnings, gradedQCount, practiceQCount, videoCount, readingCount, aiGradedCount,
  totalBlocks, saveStatus, isDirty, lastSavedAt, selectedLessonId, isPublished, onNavigate
}: ReadinessPanelProps) {
  const canPublish = issues.length === 0;
  return (
    <aside className="w-72 shrink-0 border border-slate-200 rounded-r-lg bg-white flex flex-col overflow-y-auto ml-3">
      {/* Summary stats */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="w-4 h-4 text-slate-500" />
          <span className="font-bold text-xs uppercase tracking-wider text-slate-800">Lesson Summary</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-center">
            <div className="font-bold text-slate-800 text-base">{totalBlocks}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Blocks</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-center">
            <div className="font-bold text-slate-800 text-base">{gradedQCount}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Assessment Qs</div>
          </div>
          {practiceQCount > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded p-2 text-center">
              <div className="font-bold text-slate-800 text-base">{practiceQCount}</div>
              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Practice Qs</div>
            </div>
          )}
          {aiGradedCount > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded p-2 text-center">
              <div className="font-bold text-indigo-700 text-base">{aiGradedCount}</div>
              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">AI-Graded SA</div>
            </div>
          )}
          {videoCount > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded p-2 text-center">
              <div className="font-bold text-slate-800 text-base">{videoCount}</div>
              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Videos</div>
            </div>
          )}
        </div>

        {/* Publish readiness badge */}
        <div className={`rounded p-2 flex items-center gap-2 ${canPublish && isPublished ? "bg-emerald-100/60 text-emerald-800" : canPublish ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
          {canPublish && isPublished ? (
            <><CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" /><span className="text-[11px] font-bold">Published</span></>
          ) : canPublish ? (
            <><CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" /><span className="text-[11px] font-bold">Ready to publish</span></>
          ) : (
            <><AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" /><span className="text-[11px] font-bold">{issues.length} issue{issues.length !== 1 ? "s" : ""} to fix before publishing</span></>
          )}
        </div>
      </div>

      {/* Critical issues */}
      {issues.length > 0 && (
        <div className="p-4 border-b border-slate-100">
          <div className="text-[9px] font-bold uppercase tracking-widest text-rose-500 mb-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Must fix (blocks publish)
          </div>
          <ul className="space-y-1">
            {issues.map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onNavigate(issue.target)}
                  className="w-full text-left text-[11px] text-rose-700 flex items-start gap-1.5 hover:text-rose-900 hover:bg-rose-50 rounded p-1 transition"
                >
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Non-critical warnings */}
      {warnings.length > 0 && (
        <div className="p-4 border-b border-slate-100">
          <div className="text-[9px] font-bold uppercase tracking-widest text-amber-500 mb-2 flex items-center gap-1">
            <Info className="w-3 h-3" /> Suggestions (won't block publish)
          </div>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onNavigate(w.target)}
                  className="w-full text-left text-[11px] text-amber-700 flex items-start gap-1.5 hover:text-amber-900 hover:bg-amber-50 rounded p-1 transition"
                >
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{w.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Save status + notes */}
      <div className="p-4 text-[11px] text-slate-500 space-y-2">
        <div className="font-bold text-slate-600 text-xs">Save Status</div>
        {saveStatus === "saved" && <div className="text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Saved successfully</div>}
        {saveStatus === "saving" && <div className="text-blue-600 flex items-center gap-1"><Clock className="w-3.5 h-3.5 animate-spin" /> Saving…</div>}
        {saveStatus === "error" && <div className="text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Save failed — check connectivity</div>}
        {saveStatus === "clean" && isDirty && <div className="text-amber-600">Unsaved changes</div>}
        {saveStatus === "clean" && !isDirty && lastSavedAt && <div className="text-slate-400">Last saved: {lastSavedAt.toLocaleTimeString()}</div>}
        {selectedLessonId && selectedLessonId !== "new" && (
          <div className="text-[10px] font-mono text-slate-400 truncate">ID: {selectedLessonId}</div>
        )}
        <div className="border-t border-slate-100 pt-2 space-y-1">
          <div className="text-slate-500 leading-relaxed">
            <strong className="text-slate-600">Student Preview</strong> hides all teacher-only fields — answer keys, rubrics, AI guidance, and model answers.
          </div>
          {aiGradedCount > 0 && (
            <div className="text-indigo-600 flex items-start gap-1 leading-relaxed">
              <GraduationCap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Teacher review recommended for AI-graded short answers before releasing scores to students.</span>
            </div>
          )}
        </div>
      </div>
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
  addCheckpoint: (blockIndex: number) => void;
  updateCheckpoint: (blockIndex: number, cpId: string, partial: any) => void;
  updateCheckpointQuestion: (blockIndex: number, cpId: string, uq: any) => void;
  deleteCheckpoint: (blockIndex: number, cpId: string) => void;
  convertQuestionType: (existing: any, nextType: "mc" | "sa") => any;
  newQuestionTemplate: (type: "mc" | "sa") => any;
  selectedLessonId: string | undefined;
  lessonTitle?: string;
}

function BlockEditor({ block, index, restrictSeeking, onBlockChange, onBlockMultipleChanges, addCheckpoint, updateCheckpoint, updateCheckpointQuestion, deleteCheckpoint, convertQuestionType, newQuestionTemplate, lessonTitle }: BlockEditorProps) {
  const typeLabel = block.type === "video" ? "Video" : block.type === "reading" ? "Reading Passage" : "Question";

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
              <>
                <Eye className="w-3 h-3" />
                Practice — feedback visible to student
              </>
            ) : (
              <>
                <GraduationCap className="w-3 h-3" />
                Assessment — answer key hidden from student
              </>
            )}
          </div>
        )}
        {block.type !== "question" && (
          <div className="text-[10px] text-slate-500">
            {block.type === "video" && (restrictSeeking ? "Seeking Restricted" : "Open Seeking")}
            {block.type === "reading" && "Acknowledgement Required"}
          </div>
        )}
      </div>

      <div className="p-5 space-y-5 text-xs">
        {/* Block title */}
        <div>
          <label className="font-bold text-slate-700 block mb-1">Block Title</label>
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
            <VideoUploader
              videoUrl={block.videoUrl}
              thumbnailUrl={block.thumbnailUrl}
              storagePath={block.storagePath}
              duration={block.duration}
              onVideoUploaded={(url, thumbnail, duration, storagePath) => {
                onBlockMultipleChanges(index, { videoUrl: url, thumbnailUrl: thumbnail || "", duration: duration || 0, storagePath: storagePath || "" });
              }}
            />

            <div className="pt-2 border-t border-slate-100">
              <label className="font-semibold text-slate-600 block mb-1">Direct Video URL (Backup/Manual Override)</label>
              <input
                type="text"
                value={block.videoUrl || ""}
                onChange={(e) => onBlockChange(index, "videoUrl", e.target.value)}
                placeholder="https://example.com/video.mp4"
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 font-mono text-[11px] focus:outline-none focus:border-slate-400"
              />
            </div>

            {/* Video checkpoints */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-600" /> Video Checkpoints
                </label>
                <button type="button" onClick={() => addCheckpoint(index)} className="text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Checkpoint
                </button>
              </div>

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
                      <label className="font-semibold text-slate-600 block mb-1">Timestamp (seconds)</label>
                      <input
                        type="number"
                        min={0}
                        value={cp.timestamp ?? 0}
                        onChange={(e) => updateCheckpoint(index, cp.id, { timestamp: Number(e.target.value) })}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-600 block mb-1">Question Type</label>
                      <select
                        value={cp.questionType || "mc"}
                        onChange={(e) => {
                          const t = e.target.value as "mc" | "sa";
                          const existing = cp.questions?.[0] || null;
                          const converted = convertQuestionType(existing, t);
                          updateCheckpoint(index, cp.id, { questionType: t, questions: [converted] });
                        }}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400"
                      >
                        <option value="mc">Multiple Choice</option>
                        <option value="sa">Short Answer</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!cp.isRequired} onChange={(e) => updateCheckpoint(index, cp.id, { isRequired: e.target.checked })} />
                      Required (blocks progress)
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!!cp.pauseVideo} onChange={(e) => updateCheckpoint(index, cp.id, { pauseVideo: e.target.checked })} />
                      Pause video
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer" title="Practice: feedback visible to student. Assessment: answer hidden, score recorded for teacher.">
                      <input type="checkbox" checked={!!cp.isPractice} onChange={(e) => updateCheckpoint(index, cp.id, { isPractice: e.target.checked })} />
                      {cp.isPractice ? "Practice — feedback shown to student" : "Assessment — answer hidden from student"}
                    </label>
                  </div>

                  {cp.questions?.[0] ? (
                    <QuestionEditor
                      question={cp.questions[0]}
                      type={(cp.questionType || "mc") as "mc" | "sa"}
                      graded={!cp.isPractice}
                      onChange={(uq) => updateCheckpointQuestion(index, cp.id, uq)}
                      lessonContext={{ lessonTitle, blockTitle: block.title }}
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
            <label className="font-bold text-slate-700 block mb-1">Reading Passage Content</label>
            <RichContentEditor
              value={block.content || ""}
              onChange={(val: any) => onBlockChange(index, "content", val)}
              mode="full"
            />
          </div>
        )}

        {/* Question block */}
        {block.type === "question" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-600 block mb-1">Question Type</label>
                <select
                  value={block.questionType || "mc"}
                  onChange={(e) => {
                    const t = e.target.value as "mc" | "sa";
                    const converted = convertQuestionType(block.singleQuestion, t);
                    onBlockChange(index, "questionType", t);
                    onBlockChange(index, "singleQuestion", converted);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-800 focus:outline-none"
                >
                  <option value="mc">Multiple Choice (Auto-Graded)</option>
                  <option value="sa">Short Answer (Rubric / AI Graded)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-600 block mb-1">Mode</label>
                <select
                  value={block.isPractice ? "true" : "false"}
                  onChange={(e) => onBlockChange(index, "isPractice", e.target.value === "true")}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-800 focus:outline-none"
                >
                  <option value="false">Assessment — answer key hidden, score recorded for review</option>
                  <option value="true">Practice — feedback shown to student immediately</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  {block.isPractice
                    ? "Students see whether they're correct. Feedback and score are visible. Use for learning checks."
                    : "Answer keys and explanations are hidden. Score is recorded for teacher review. Use for formal assessment."}
                </p>
              </div>
            </div>

            {block.singleQuestion ? (
              <QuestionEditor
                question={block.singleQuestion}
                type={(block.questionType || "mc") as "mc" | "sa"}
                graded={!block.isPractice}
                onChange={(uq) => onBlockChange(index, "singleQuestion", uq)}
                lessonContext={{ lessonTitle, blockTitle: block.title }}
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
          <h3 className="font-bold text-slate-800 text-[18px]">Course Deliveries & Scheduling</h3>
          <p className="text-xs text-slate-500 mt-1">Deploy lesson versions to courses. Configure availability dates to automatically enforce open/due boundaries.</p>
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
            <Plus className="w-4 h-4" /> Assign Lesson
          </button>
        )}
      </div>

      {showAssignmentForm && (
        <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded p-6 shadow-sm space-y-4 max-w-2xl">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">New Lesson Assignment Setup</h4>
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
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Opens At *</label>
              <input type="datetime-local" value={asgOpensAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgOpensAt(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Due At *</label>
              <input type="datetime-local" value={asgDueAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgDueAt(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Closes At *</label>
              <input type="datetime-local" value={asgClosesAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgClosesAt(e.target.value)} className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400" required />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <LearningConditionsEditor value={asgIntegrityPolicy} onChange={setAsgIntegrityPolicy} />
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button type="submit" disabled={lessons.filter((l: any) => l.isPublished).length === 0} className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold px-5 py-2.5 rounded shadow-sm tracking-wide uppercase transition cursor-pointer">
              Publish Assignment
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <h4 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Assignments ({assignments.length})</h4>
        </div>
        {assignments.length === 0 ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 text-slate-300 mb-2" />
            <p className="text-xs font-bold text-slate-600">No active assignments configured.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="p-3">Course / Section</th>
                  <th className="p-3">Lesson Plan</th>
                  <th className="p-3">Opens At</th>
                  <th className="p-3">Due At</th>
                  <th className="p-3">Closes At</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {assignments.map((asg: any) => {
                  const now = new Date().toISOString();
                  const opens = asg.opensAt || "";
                  const closes = asg.closesAt || "";
                  let statusNode = null;
                  if (now < opens) statusNode = <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Scheduled</span>;
                  else if (now <= closes) statusNode = <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Open & Active</span>;
                  else statusNode = <span className="bg-red-50 text-red-700 border border-red-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Closed</span>;
                  return (
                    <tr key={asg.id} className="hover:bg-slate-50/50">
                      <td className="p-3"><span className="font-bold text-slate-800">{asg.courseId}</span>{asg.section && <span className="text-slate-400 ml-1.5">• {asg.section}</span>}</td>
                      <td className="p-3 font-semibold text-slate-800">{asg.lessonTitle || "Untitled Lesson"}</td>
                      <td className="p-3 text-[11px] text-slate-500">{new Date(opens).toLocaleString()}</td>
                      <td className="p-3 text-[11px] text-slate-500 font-semibold">{new Date(asg.dueAt).toLocaleString()}</td>
                      <td className="p-3 text-[11px] text-slate-500">{new Date(closes).toLocaleString()}</td>
                      <td className="p-3 text-center">{statusNode}</td>
                      <td className="p-3 text-right">
                        <button type="button" onClick={() => onDeleteAssignment && onDeleteAssignment(asg.id)} className="text-red-600 hover:text-red-800 font-bold uppercase text-[9px] tracking-widest px-2.5 py-1 rounded hover:bg-red-50 transition cursor-pointer">
                          Recall
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
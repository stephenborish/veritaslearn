import { useState, useEffect, useRef, useCallback } from "react";
import {
  ShieldAlert, Play, Check, X, Expand, RefreshCw, AlertCircle, ArrowLeft,
  ChevronRight, ChevronLeft, Lock, Info, AlertTriangle, BookOpen, Video, FileQuestion, Flag,
  Menu, List
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, storage } from "../../lib/firebase";
import firebaseConfig from "../../../firebase-applet-config.json";
import { ref, getDownloadURL } from "firebase/storage";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

interface FocusedPlayerProps {
  attemptId: string;
  user: any;
  onExit: () => void;
}

type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ViolationLevel = "none" | "low" | "medium";
type SaGradingState = "unsent" | "submitting" | "submitted" | "pending_ai" | "feedback_ready" | "grading_failed";

interface SaFeedbackData {
  score?: number;
  maxPoints?: number;
  feedback?: string;
  rubricBreakdown?: { [category: string]: { score: number; maxScore?: number; feedback: string } };
  misconceptions?: string[];
}

// Banner shown for non-lockout violations
interface ViolationBanner {
  show: boolean;
  level: ViolationLevel;
  message: string;
}

export default function FocusedPlayer({ attemptId, user, onExit }: FocusedPlayerProps) {
  const [attemptData, setAttemptData] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [responses, setResponses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  // Focus / integrity
  const [isFullscreenLocked, setIsFullscreenLocked] = useState(false);
  const [lockMessage, setLockMessage] = useState("");
  const [activeTab, setActiveTab] = useState(true);
  const [isTeacherLocked, setIsTeacherLocked] = useState(false);
  const isTeacherLockedRef = useRef(false);

  // Tiered violation tracking
  const blurCountRef = useRef(0);
  const [violationBanner, setViolationBanner] = useState<ViolationBanner>({ show: false, level: "none", message: "" });

  // Scoring / submission
  const [selectedMC, setSelectedMC] = useState<{ [qId: string]: string }>({});
  const [saText, setSaText] = useState<{ [qId: string]: string }>({});
  const [submittedLocal, setSubmittedLocal] = useState<{ [qId: string]: boolean }>({});
  const [savingResponse, setSavingResponse] = useState<{ [qId: string]: boolean }>({});
  const [feedbackState, setFeedbackState] = useState<{ [qId: string]: { correct: boolean; desc?: string } }>({});

  // SA autosave state per question
  const [saAutosave, setSaAutosave] = useState<{ [qId: string]: AutosaveState }>({});
  // SA grading lifecycle state per question
  const [saGradingState, setSaGradingState] = useState<{ [qId: string]: SaGradingState }>({});
  // SA AI feedback data per question (practice only, after grading completes)
  const [saFeedback, setSaFeedback] = useState<{ [qId: string]: SaFeedbackData }>({});
  const draftSaveTimers = useRef<{ [qId: string]: ReturnType<typeof setTimeout> }>({});

  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string>("");

  // Time tracking
  const activeTimeRef = useRef(0);
  const inactiveTimeRef = useRef(0);

  // Video
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wasPlayingRef = useRef(false);
  const [furthestMaxTimestamp, setFurthestMaxTimestamp] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState<number>(1);
  const [activeCheckpoint, setActiveCheckpoint] = useState<any>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  const getAuthHeader = async (): Promise<Record<string, string>> => {
    if (!auth.currentUser) return {};
    try {
      const token = await auth.currentUser.getIdToken();
      return { "Authorization": `Bearer ${token}` };
    } catch {
      return {};
    }
  };

  const fetchData = async () => {
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch(`/api/attempts/${attemptId}`, { headers: authHeader });
      const data = await response.json();

      setAttemptData(data.attempt);
      setAssignments(data.questionAssignments || data.assignments || []);
      setResponses(data.responses);

      const lResponse = await fetch(
        `/api/lessons/${data.attempt.lessonId}${data.attempt.isPreviewAttempt ? "?preview=true" : ""}`,
        { headers: authHeader }
      );
      const lData = await lResponse.json();
      setBlocks(lData.blocks);
      setCurrentBlockIndex(data.attempt.currentBlockIndex || 0);

      // Restore existing submissions
      const localSub: any = {};
      const localFeed: any = {};
      const localSaGrading: { [qId: string]: SaGradingState } = {};
      const localSaFeedback: { [qId: string]: SaFeedbackData } = {};

      data.responses.forEach((r: any) => {
        localSub[r.questionId] = true;
        if (r.type === "mc") {
          setSelectedMC((prev: any) => ({ ...prev, [r.questionId]: r.responseValue }));
          localFeed[r.questionId] = { correct: r.isCorrect };
        } else {
          setSaText((prev: any) => ({ ...prev, [r.questionId]: r.responseValue }));

          const gradingMode = r.gradingMode || r.gradebookCategory || "assessment";
          const isPractice = gradingMode === "practice";

          if (!isPractice) {
            localSaGrading[r.questionId] = "submitted";
          } else {
            const aiStatus = r.aiGrading?.status;
            if (aiStatus === "success" && r.feedbackVisibility === "student_visible") {
              localSaGrading[r.questionId] = "feedback_ready";
              localSaFeedback[r.questionId] = {
                score: r.score,
                maxPoints: r.maxPoints,
                feedback: r.aiGrading?.feedback,
                rubricBreakdown: r.aiGrading?.rubricBreakdown,
                misconceptions: r.aiGrading?.misconceptions,
              };
            } else if (aiStatus === "needs_review" || aiStatus === "failed") {
              localSaGrading[r.questionId] = "grading_failed";
            } else {
              // pending or no aiGrading yet
              localSaGrading[r.questionId] = "pending_ai";
            }
          }
        }
      });
      setSubmittedLocal(localSub);
      setFeedbackState(localFeed);
      setSaGradingState(localSaGrading);
      setSaFeedback(localSaFeedback);

      // Restore SA drafts — prefer server-persisted drafts (cross-device), fall back to localStorage.
      const serverDrafts: Record<string, string> = data.attempt.draftResponses || {};
      const allAssignments = data.questionAssignments || data.assignments || [];
      allAssignments.forEach((asg: any) => {
        const q = asg.selectedQuestion;
        if (q?.type === "sa" && !localSub[q.id]) {
          const serverDraft = serverDrafts[q.id];
          const localDraft = (() => {
            try { return localStorage.getItem(`veritas_draft_${data.attempt.id}_${q.id}`); } catch { return null; }
          })();
          const draft = serverDraft || localDraft;
          if (draft) {
            setSaText((prev: any) => ({ ...prev, [q.id]: draft }));
            setSaAutosave((prev: any) => ({ ...prev, [q.id]: "saved" }));
          }
        }
      });

      if (data.attempt.lockState === "locked_awaiting_teacher") {
        setIsTeacherLocked(true);
        isTeacherLockedRef.current = true;
      }

      const savedFurthest = data.attempt.furthestVideoTimestamps;
      if (savedFurthest && Object.keys(savedFurthest).length > 0) {
        const blockId = lData.blocks[data.attempt.currentBlockIndex]?.id;
        if (blockId && savedFurthest[blockId]) {
          setFurthestMaxTimestamp(savedFurthest[blockId]);
        }
      }

      setLoading(false);
    } catch (error) {
      console.error("Error loading attempt:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [attemptId]);

  const requestFullscreen = () => {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    }
    setIsFullscreenLocked(false);
  };

  // Log integrity signal — returns server response
  const logIntegritySignal = async (
    eventType: string,
    severity: string,
    metadata: any = {}
  ): Promise<{ lockState?: string | null } | null> => {
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) return null;
      const res = await fetch("/api/integrity-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          attemptId,
          eventType,
          severity,
          blockId: blocks[currentBlockIndex]?.id,
          videoTimestamp: videoRef.current ? Math.floor(videoRef.current.currentTime) : undefined,
          metadata: { message: metadata.detail || "Focus event recorded.", ...metadata }
        })
      });
      return res.ok ? res.json() : null;
    } catch {
      return null;
    }
  };

  const flushVideoProgress = async (customTimestamp?: number) => {
    const video = videoRef.current;
    const block = blocks[currentBlockIndex];
    if (!block || block.type !== "video") return;

    const duration = block.duration ?? block.videoDuration ?? 0;
    let timestampToSend = video ? Math.floor(video.currentTime) : 0;
    
    if (customTimestamp !== undefined) {
      timestampToSend = customTimestamp;
    } else if (video) {
      if ((video.ended || video.currentTime >= duration - 1) && duration > 0) {
        timestampToSend = Math.floor(duration);
      }
    }

    try {
      const authHeader = await getAuthHeader();
      const resp = await fetch(`/api/attempts/${attemptId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          blockId: block.id,
          timestamp: timestampToSend,
          activeTime: activeTimeRef.current,
          inactiveTime: inactiveTimeRef.current,
          playbackRate: currentSpeed,
        }),
      });
      
      const data = await resp.json();
      activeTimeRef.current = 0;
      inactiveTimeRef.current = 0;

      if (data.success && data.furthestMaxTimestamp !== undefined) {
        setFurthestMaxTimestamp(data.furthestMaxTimestamp);
        setAttemptData((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            furthestVideoTimestamps: {
              ...(prev.furthestVideoTimestamps || {}),
              [block.id]: data.furthestMaxTimestamp
            }
          };
        });
      }

      if (data.lockState === null && isTeacherLockedRef.current) {
        setIsTeacherLocked(false);
        isTeacherLockedRef.current = false;
        const requireFullscreenOpt = attemptData?.lesson?.settings?.requireFullscreen ?? true;
        if (requireFullscreenOpt) requestFullscreen();
      } else if (data.lockState === "locked_awaiting_teacher" && !isTeacherLockedRef.current) {
        setIsTeacherLocked(true);
        isTeacherLockedRef.current = true;
      }
    } catch (e) {
      console.error("Failed to flush video progress:", e);
    }
  };

  const handleVideoEnded = async () => {
    const block = blocks[currentBlockIndex];
    if (!block || block.type !== "video") return;
    const duration = block.duration ?? block.videoDuration ?? 0;
    if (duration > 0) {
      setFurthestMaxTimestamp(duration);
      setAttemptData((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          furthestVideoTimestamps: {
            ...(prev.furthestVideoTimestamps || {}),
            [block.id]: duration
          }
        };
      });
      await flushVideoProgress(Math.floor(duration));
    }
  };

  // Integrity event listeners
  useEffect(() => {
    if (loading || !attemptData) return;

    const requireFullscreenOpt = attemptData.lesson?.settings?.requireFullscreen ?? true;

    const attemptResumePlayback = () => {
      const video = videoRef.current;
      if (!video) return;

      const isFull = !!document.fullscreenElement;
      const isTabActive = document.hasFocus() && !document.hidden;
      const isCompliant = (!requireFullscreenOpt || isFull) && isTabActive && !isFullscreenLocked;

      if (isCompliant && wasPlayingRef.current) {
        video.play().catch((err) => {
          console.warn("Playback autoplay blocked or failed to resume:", err);
        });
        wasPlayingRef.current = false;
      }
    };

    const handleFullscreenChange = async () => {
      const isFull = !!document.fullscreenElement;
      if (!isFull) {
        if (videoRef.current) {
          if (!videoRef.current.paused) {
            wasPlayingRef.current = true;
          } else {
            wasPlayingRef.current = false;
          }
          videoRef.current.pause();
        }
      }
      if (!isFull && requireFullscreenOpt) {
        const result = await logIntegritySignal("fullscreen_exited", "high", { detail: "User exited fullscreen." });
        if (result?.lockState === "locked_awaiting_teacher") {
          setIsTeacherLocked(true);
          isTeacherLockedRef.current = true;
          setIsFullscreenLocked(false);
        } else {
          setIsFullscreenLocked(true);
          setLockMessage("This assignment requires fullscreen. Re-enter fullscreen to continue.");
        }
      } else {
        attemptResumePlayback();
      }
    };

    const handleWindowBlur = () => {
      setActiveTab(false);
      if (videoRef.current) {
        if (!videoRef.current.paused) {
          wasPlayingRef.current = true;
        } else {
          wasPlayingRef.current = false;
        }
        videoRef.current.pause();
      }
      blurCountRef.current += 1;
      const count = blurCountRef.current;

      // Log the event as before
      logIntegritySignal("blur_focus_lost", count >= 4 ? "medium" : "low", {
        detail: "Window lost focus.",
        blurCount: count,
      });

      // Show tiered non-panicking banner
      if (count >= 4) {
        setViolationBanner({
          show: true,
          level: "medium",
          message: "You have left the assignment window multiple times. This attempt has been noted for review. You may continue.",
        });
      } else {
        setViolationBanner({
          show: true,
          level: "low",
          message: "Return to the assignment window. Focus monitoring is active.",
        });
      }
    };

    const handleWindowFocus = () => {
      setActiveTab(true);
      // Dismiss low-level banner when focus returns
      setViolationBanner((prev: ViolationBanner) =>
        prev.level === "low" ? { ...prev, show: false } : prev
      );
      attemptResumePlayback();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (videoRef.current) {
          if (!videoRef.current.paused) {
            wasPlayingRef.current = true;
          } else {
            wasPlayingRef.current = false;
          }
          videoRef.current.pause();
        }
        logIntegritySignal("visibility_hidden", "high", { detail: "Tab hidden / switched." });
        setViolationBanner({
          show: true,
          level: "low",
          message: "Return to the assignment window. Focus monitoring is active.",
        });
      } else {
        attemptResumePlayback();
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      logIntegritySignal("copy_blocked", "high", { detail: "Copy attempt blocked." });
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      logIntegritySignal("paste_blocked", "high", { detail: "Paste attempt blocked." });
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      logIntegritySignal("context_menu_blocked", "medium", { detail: "Right-click blocked." });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        logIntegritySignal("copy_blocked", "high", { detail: "Copy shortcut blocked." });
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    if (requireFullscreenOpt && !document.fullscreenElement) {
      setIsFullscreenLocked(true);
      setLockMessage("This assignment requires fullscreen focus mode. Enter fullscreen to begin.");
    } else {
      attemptResumePlayback();
    }

    const tickInterval = setInterval(() => {
      if (document.hasFocus() && !isFullscreenLocked && !document.hidden && activeTab) {
        activeTimeRef.current += 1;
      } else {
        inactiveTimeRef.current += 1;
      }
    }, 1000);

    const syncInterval = setInterval(() => {
      flushVideoProgress();
    }, 10000);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      clearInterval(tickInterval);
      clearInterval(syncInterval);
    };
  }, [loading, attemptData, currentBlockIndex, isFullscreenLocked, activeTab]);

  const handleVideoPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    const requireFullscreenOpt = attemptData?.lesson?.settings?.requireFullscreen ?? true;
    const isFull = !!document.fullscreenElement;
    const isTabActive = document.hasFocus() && !document.hidden && activeTab;

    if ((requireFullscreenOpt && !isFull) || !isTabActive) {
      video.pause();
    }
  };

  const handleVideoTimeUpdate = async () => {
    const video = videoRef.current;
    if (!video) return;
    const block = blocks[currentBlockIndex];
    const restrictSeeking = attemptData?.lesson?.settings?.restrictSeeking ?? true;
    const currentTime = video.currentTime;
    const duration = block.duration ?? block.videoDuration ?? 0;

    // Check near-ended tolerance
    if (duration > 0 && currentTime >= duration - 1) {
      if (furthestMaxTimestamp < duration) {
        setFurthestMaxTimestamp(duration);
        setAttemptData((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            furthestVideoTimestamps: {
              ...(prev.furthestVideoTimestamps || {}),
              [block.id]: duration
            }
          };
        });
      }
    }

    if (restrictSeeking) {
      const allowedGap = 3;
      if (currentTime > furthestMaxTimestamp + allowedGap) {
        video.currentTime = furthestMaxTimestamp;
        logIntegritySignal("seek_attempt_blocked", "high", {
          detail: "Attempted to skip forward in restricted video.",
          requestedSeekPosition: Math.floor(currentTime),
          furthestAllowedValue: furthestMaxTimestamp,
        });
        return;
      } else if (currentTime > furthestMaxTimestamp) {
        setFurthestMaxTimestamp(currentTime);
        setAttemptData((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            furthestVideoTimestamps: {
              ...(prev.furthestVideoTimestamps || {}),
              [block.id]: currentTime
            }
          };
        });
      }
    } else {
      if (currentTime > furthestMaxTimestamp) {
        setFurthestMaxTimestamp(currentTime);
        setAttemptData((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            furthestVideoTimestamps: {
              ...(prev.furthestVideoTimestamps || {}),
              [block.id]: currentTime
            }
          };
        });
      }
    }

    if (block.videoCheckpoints && block.videoCheckpoints.length > 0) {
      const checkpoint = block.videoCheckpoints.find((cp: any) => {
        const hasSubmittedAll = cp.questions.every((q: any) => submittedLocal[q.id]);
        return !hasSubmittedAll && Math.floor(currentTime) >= cp.timestamp;
      });
      if (checkpoint && !activeCheckpoint) {
        video.pause();
        setActiveCheckpoint(checkpoint);
        logIntegritySignal("checkpoint_triggered", "medium", {
          detail: `Checkpoint triggered: ${checkpoint.title}`,
          checkpointId: checkpoint.id,
        });
      }
    }
  };

  const handleBlockNavigation = async (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= blocks.length) return;
    setNavigationError(null);
    setIsNavigating(true);

    try {
      const authHeader = await getAuthHeader();
      const resp = await fetch(`/api/attempts/${attemptId}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ blockIndex: nextIdx }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        setNavigationError(
          data.error || "Complete required questions or watch enough of the video before continuing."
        );
        return;
      }
      const targetBlock = blocks[nextIdx];
      const savedFurthest = attemptData?.furthestVideoTimestamps?.[targetBlock?.id] || 0;
      setCurrentBlockIndex(nextIdx);
      setActiveCheckpoint(null);
      setFurthestMaxTimestamp(savedFurthest);
      setViolationBanner((prev: ViolationBanner) => ({ ...prev, show: false }));
    } catch {
      setNavigationError("Unable to navigate. Please check your connection and try again.");
    } finally {
      setIsNavigating(false);
    }
  };

  // Dedicated helper to persist draft to backend
  const persistDraftResponse = useCallback(async (questionId: string, value: string) => {
    if (submittedLocal[questionId]) {
      if (draftSaveTimers.current[questionId]) {
        clearTimeout(draftSaveTimers.current[questionId]);
        delete draftSaveTimers.current[questionId];
      }
      setSaAutosave((prev: any) => ({ ...prev, [questionId]: "idle" }));
      return;
    }

    setSaAutosave((prev: any) => ({ ...prev, [questionId]: "saving" }));
    try {
      localStorage.setItem(`veritas_draft_${attemptId}_${questionId}`, value);
    } catch { /* ignore */ }

    try {
      const authHeader = await getAuthHeader();
      if (authHeader.Authorization) {
        await fetch(`/api/attempts/${attemptId}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ questionId, draftText: value }),
        });
      }
      setSaAutosave((prev: any) => ({ ...prev, [questionId]: "saved" }));
    } catch {
      setSaAutosave((prev: any) => ({ ...prev, [questionId]: "error" }));
    }
  }, [attemptId, submittedLocal]);

  // Keep references updated for the interval
  const saTextRef = useRef(saText);
  const saAutosaveRef = useRef(saAutosave);
  const saGradingStateRef = useRef(saGradingState);
  const persistDraftResponseRef = useRef(persistDraftResponse);

  useEffect(() => {
    saTextRef.current = saText;
  }, [saText]);

  useEffect(() => {
    saAutosaveRef.current = saAutosave;
  }, [saAutosave]);

  useEffect(() => {
    saGradingStateRef.current = saGradingState;
  }, [saGradingState]);

  useEffect(() => {
    persistDraftResponseRef.current = persistDraftResponse;
  }, [persistDraftResponse]);

  // Poll for practice SA AI grading results every 8 seconds.
  // Stops automatically when no "pending_ai" questions remain. Cleans up on unmount.
  useEffect(() => {
    if (loading || !attemptId) return;

    let errorCount = 0;

    const poll = async () => {
      const states = saGradingStateRef.current;
      const pendingIds = Object.entries(states)
        .filter(([, s]) => s === "pending_ai")
        .map(([qId]) => qId);

      if (pendingIds.length === 0) return;

      try {
        const authHeader = await getAuthHeader();
        const res = await fetch(`/api/attempts/${attemptId}/sa-feedback`, { headers: authHeader });
        if (!res.ok) throw new Error("sa-feedback poll failed");
        const data = await res.json();
        errorCount = 0;

        (data.responses || []).forEach((r: any) => {
          if (!pendingIds.includes(r.questionId)) return;
          const aiStatus = r.aiGrading?.status;
          if (aiStatus === "success") {
            setSaGradingState((prev: any) => ({ ...prev, [r.questionId]: "feedback_ready" }));
            setSaFeedback((prev: any) => ({
              ...prev,
              [r.questionId]: {
                score: r.score,
                maxPoints: r.maxPoints,
                feedback: r.aiGrading?.feedback,
                rubricBreakdown: r.aiGrading?.rubricBreakdown,
                misconceptions: r.aiGrading?.misconceptions,
              },
            }));
          } else if (aiStatus === "needs_review" || aiStatus === "failed") {
            setSaGradingState((prev: any) => ({ ...prev, [r.questionId]: "grading_failed" }));
          }
          // "pending" — keep polling on next tick
        });
      } catch {
        errorCount++;
        // After 5 consecutive errors, stop polling silently to avoid hammering a down server
        if (errorCount >= 5) {
          Object.keys(saGradingStateRef.current).forEach((qId) => {
            if (saGradingStateRef.current[qId] === "pending_ai") {
              setSaGradingState((prev: any) => ({ ...prev, [qId]: "grading_failed" }));
            }
          });
        }
      }
    };

    const pollInterval = setInterval(poll, 8000);
    return () => clearInterval(pollInterval);
  }, [loading, attemptId]);

  // Dedicated 15 seconds autosave interval for short-answer responses
  useEffect(() => {
    if (loading || !attemptId) return;

    const saInterval = setInterval(() => {
      const textMap = saTextRef.current;
      const autosaveMap = saAutosaveRef.current;

      Object.keys(textMap).forEach((qId) => {
        const state = autosaveMap[qId];
        if (state === "dirty" || state === "error") {
          const value = textMap[qId];
          persistDraftResponseRef.current(qId, value);
        }
      });
    }, 15000);

    return () => {
      clearInterval(saInterval);
    };
  }, [loading, attemptId]);

  // SA draft autosave — debounced 800ms, persisted to server + localStorage fallback
  const handleSaChange = (questionId: string, value: string) => {
    if (submittedLocal[questionId]) {
      if (draftSaveTimers.current[questionId]) {
        clearTimeout(draftSaveTimers.current[questionId]);
        delete draftSaveTimers.current[questionId];
      }
      return;
    }

    setSaText((prev: any) => ({ ...prev, [questionId]: value }));
    setSaAutosave((prev: any) => ({ ...prev, [questionId]: "dirty" }));

    if (draftSaveTimers.current[questionId]) {
      clearTimeout(draftSaveTimers.current[questionId]);
    }
    draftSaveTimers.current[questionId] = setTimeout(async () => {
      await persistDraftResponse(questionId, value);
    }, 800);
  };

  const handleSubmitResponse = async (blockId: string, questionId: string, responseVal: string, cpId?: string) => {
    if (!responseVal || responseVal.trim() === "") return;

    setSavingResponse((prev: any) => ({ ...prev, [questionId]: true }));
    try {
      const authHeader = await getAuthHeader();
      const respObj = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          blockId,
          checkpointId: cpId,
          questionId,
          responseValue: responseVal,
          activeTimeSpent: activeTimeRef.current,
        }),
      });
      const data = await respObj.json();

      setSubmittedLocal((prev: any) => ({ ...prev, [questionId]: true }));
      setSaAutosave((prev: any) => ({ ...prev, [questionId]: "idle" }));

      localStorage.removeItem(`veritas_draft_${attemptId}_${questionId}`);
      if (draftSaveTimers.current[questionId]) {
        clearTimeout(draftSaveTimers.current[questionId]);
        delete draftSaveTimers.current[questionId];
      }

      if (data.gradedImmediate) {
        setFeedbackState((prev: any) => ({
          ...prev,
          [questionId]: { correct: data.isCorrect, desc: data.explanation },
        }));
      } else {
        // SA response: determine practice vs assessment from the block to set initial grading state
        const block = blocks.find((b: any) => b.id === blockId);
        let isPracticeBlock = block?.isPractice ?? false;
        if (cpId && Array.isArray(block?.videoCheckpoints)) {
          const cp = block.videoCheckpoints.find((c: any) => c.id === cpId);
          if (cp) isPracticeBlock = cp.isPractice ?? isPracticeBlock;
        }
        setSaGradingState((prev: any) => ({
          ...prev,
          [questionId]: isPracticeBlock ? "pending_ai" : "submitted",
        }));
      }
    } catch {
      // Keep the draft in place on error
    } finally {
      setSavingResponse((prev: any) => ({ ...prev, [questionId]: false }));
    }
  };

  const handleCompleteLessonAttempt = async () => {
    try {
      const authHeader = await getAuthHeader();
      await fetch(`/api/attempts/${attemptId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
      });
      onExit();
    } catch {
      // Keep player open if complete fails
    }
  };

  // Resolve video URL from storage path or direct URL
  useEffect(() => {
    const activeBlock = blocks[currentBlockIndex];
    if (activeBlock && activeBlock.type === "video") {
      if (activeBlock.storagePath && !activeBlock.storagePath.startsWith("uploads/")) {
        const fileRef = ref(storage, activeBlock.storagePath);
        getDownloadURL(fileRef)
          .then(setResolvedVideoUrl)
          .catch(() => {
            setResolvedVideoUrl(
              activeBlock.videoUrl ||
                `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(activeBlock.storagePath)}?alt=media`
            );
          });
      } else if (activeBlock.videoUrl) {
        setResolvedVideoUrl(activeBlock.videoUrl);
      } else if (activeBlock.storagePath && activeBlock.storagePath.startsWith("uploads/")) {
        setResolvedVideoUrl(`/${activeBlock.storagePath}`);
      } else {
        setResolvedVideoUrl("");
      }
    } else {
      setResolvedVideoUrl("");
    }
  }, [blocks, currentBlockIndex]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans">
        <RefreshCw className="w-7 h-7 animate-spin text-[#0A192F] mb-3" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">Loading assignment…</span>
      </div>
    );
  }

  const activeBlock = blocks[currentBlockIndex];
  const totalBlocks = blocks.length;
  const progressPercent = totalBlocks > 0 ? Math.round(((currentBlockIndex) / totalBlocks) * 100) : 0;
  const assignedSet = assignments.filter((asg: any) => asg.blockId === activeBlock?.id);
  const isLastBlock = currentBlockIndex === totalBlocks - 1;

  // Determine next-button disabled reason
  const getNextBlockedReason = (): string | null => {
    if (!activeBlock) return null;
    if (activeBlock.type === "question") {
      const blockAssignments = assignments.filter((a: any) => a.blockId === activeBlock.id);
      const anyUnsubmitted = blockAssignments.some((a: any) => !submittedLocal[a.questionId]);
      if (anyUnsubmitted) return "Submit your response to continue.";
    }
    if (activeBlock.type === "video") {
      if (activeBlock.videoCheckpoints && activeBlock.videoCheckpoints.length > 0) {
        const anyCpIncomplete = activeBlock.videoCheckpoints.some((cp: any) => {
          if (cp.isRequired) {
            const allAnswered = cp.questions?.every((q: any) => submittedLocal[q.id]);
            return !allAnswered;
          }
          return false;
        });
        if (anyCpIncomplete) {
          return "Answer all checkpoint questions to continue.";
        }
      }

      const restrictSeeking = attemptData?.lesson?.settings?.restrictSeeking ?? true;
      const duration = activeBlock.duration ?? activeBlock.videoDuration;
      if (restrictSeeking && duration) {
        const requiredSeconds = duration * 0.9;
        const isEndedLocally = videoRef.current && (videoRef.current.ended || videoRef.current.currentTime >= duration - 1);
        if (furthestMaxTimestamp < requiredSeconds && !isEndedLocally) {
          return "Finish the video to continue.";
        }
      }
    }
    if (activeCheckpoint) {
      const allAnswered = activeCheckpoint.questions.every((q: any) => submittedLocal[q.id]);
      if (!allAnswered) return "Answer all checkpoint questions to continue.";
    }
    return null;
  };

  const getBlockStatus = (block: any, idx: number) => {
    if (!block) return "locked";

    // Determine if this block is complete
    let isThisBlockComplete = true;
    if (block.type === "question") {
      const blockAssignments = assignments.filter((a: any) => a.blockId === block.id);
      const anyUnsubmitted = blockAssignments.some((a: any) => !submittedLocal[a.questionId]);
      if (anyUnsubmitted) {
        isThisBlockComplete = false;
      }
    } else if (block.type === "video") {
      const checkpoints = block.videoCheckpoints || [];
      const cpIncomplete = checkpoints.some((cp: any) => {
        if (cp.isRequired) {
          const allAnswered = cp.questions?.every((q: any) => submittedLocal[q.id]);
          return !allAnswered;
        }
        return false;
      });
      if (cpIncomplete) {
        isThisBlockComplete = false;
      }

      const restrictSeeking = attemptData?.lesson?.settings?.restrictSeeking ?? true;
      const duration = block.duration ?? block.videoDuration;
      if (restrictSeeking && duration) {
        const requiredSeconds = duration * 0.9;
        const isEndedLocally = idx === currentBlockIndex && videoRef.current && (videoRef.current.ended || videoRef.current.currentTime >= duration - 1);
        const furthestWatch = (attemptData?.furthestVideoTimestamps?.[block.id]) || (idx === currentBlockIndex ? furthestMaxTimestamp : 0);
        if (furthestWatch < requiredSeconds && !isEndedLocally) {
          isThisBlockComplete = false;
        }
      }
    }

    // A block is "unlocked" and clickable if:
    // 1. It is the current block index
    // 2. Or it is a previous block (idx < currentBlockIndex)
    // 3. Or all preceding blocks from 0 up to idx-1 are fully complete!
    let allPrecedingComplete = true;
    for (let i = 0; i < idx; i++) {
      const precBlock = blocks[i];
      let precComplete = true;
      if (precBlock.type === "question") {
        const blockAsgs = assignments.filter((a: any) => a.blockId === precBlock.id);
        if (blockAsgs.some((a: any) => !submittedLocal[a.questionId])) {
          precComplete = false;
        }
      } else if (precBlock.type === "video") {
        const checkpoints = precBlock.videoCheckpoints || [];
        const cpIncomplete = checkpoints.some((cp: any) => {
          if (cp.isRequired) {
            const allAnswered = cp.questions?.every((q: any) => submittedLocal[q.id]);
            return !allAnswered;
          }
          return false;
        });
        if (cpIncomplete) {
          precComplete = false;
        }
        const restrictSeeking = attemptData?.lesson?.settings?.restrictSeeking ?? true;
        const duration = precBlock.duration ?? precBlock.videoDuration;
        if (restrictSeeking && duration) {
          const requiredSeconds = duration * 0.9;
          const isEndedLocally = i === currentBlockIndex && videoRef.current && (videoRef.current.ended || videoRef.current.currentTime >= duration - 1);
          const furthestWatch = (attemptData?.furthestVideoTimestamps?.[precBlock.id]) || (i === currentBlockIndex ? furthestMaxTimestamp : 0);
          if (furthestWatch < requiredSeconds && !isEndedLocally) {
            precComplete = false;
          }
        }
      }
      if (!precComplete) {
        allPrecedingComplete = false;
        break;
      }
    }

    if (idx === currentBlockIndex) {
      return isThisBlockComplete ? "current_complete" : "current_incomplete";
    }

    if (idx < currentBlockIndex) {
      return "completed";
    }

    if (allPrecedingComplete) {
      return "unlocked";
    }

    return "locked";
  };

  const nextBlockedReason = getNextBlockedReason();

  // Block type badge
  const BlockTypeBadge = ({ block }: { block: any }) => {
    if (!block) return null;
    const configs: Record<string, { label: string; cls: string; Icon: any }> = {
      video: { label: "Video", cls: "bg-blue-50 text-blue-700 border border-blue-200", Icon: Video },
      reading: { label: "Reading", cls: "bg-purple-50 text-purple-700 border border-purple-200", Icon: BookOpen },
      question: { label: block.isPractice ? "Practice check" : "Graded question", cls: block.isPractice ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200", Icon: FileQuestion },
    };
    const config = configs[block.type];
    if (!config) return null;
    const { label, cls, Icon } = config;
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-0.5 ${cls}`}>
        <Icon className="w-3 h-3" />
        {label}
      </span>
    );
  };

  // SA grading status display for submitted short-answer questions
  const SaFeedbackDisplay = ({
    state,
    feedback,
    maxPoints,
    isPractice,
  }: {
    state: SaGradingState;
    feedback?: SaFeedbackData;
    maxPoints: number;
    isPractice: boolean;
  }) => {
    if (!isPractice) {
      return (
        <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Response submitted</span>
          <span className="text-xs text-slate-400 font-normal ml-1">— pending teacher review</span>
        </div>
      );
    }

    if (state === "pending_ai" || state === "submitted") {
      return (
        <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
          <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
          <span>AI feedback pending…</span>
        </div>
      );
    }

    if (state === "grading_failed") {
      return (
        <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <span>Response submitted</span>
          <span className="text-xs text-slate-400 font-normal ml-1">— pending teacher review</span>
        </div>
      );
    }

    if (state === "feedback_ready" && feedback) {
      const score = feedback.score;
      const scoreDisplay = score !== undefined ? `${score} / ${maxPoints} pts` : null;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
            <Check className="w-4 h-4" />
            <span>Feedback ready</span>
            {scoreDisplay && (
              <span className="ml-2 text-xs bg-emerald-100 text-emerald-800 rounded-full px-2.5 py-0.5 font-bold">
                {scoreDisplay}
              </span>
            )}
          </div>
          {feedback.feedback && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 space-y-1">
              <p className="font-semibold text-xs uppercase tracking-wide text-blue-600 mb-1.5">AI Feedback</p>
              <p className="leading-relaxed">{feedback.feedback}</p>
            </div>
          )}
          {feedback.rubricBreakdown && Object.keys(feedback.rubricBreakdown).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rubric breakdown</p>
              {Object.entries(feedback.rubricBreakdown).map(([cat, data]) => (
                <div key={cat} className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded p-2 border border-slate-100">
                  <span className="font-semibold shrink-0">{cat}:</span>
                  <span className="text-slate-500">{data.score}{data.maxScore !== undefined ? `/${data.maxScore}` : ""} pts — {data.feedback}</span>
                </div>
              ))}
            </div>
          )}
          {feedback.misconceptions && feedback.misconceptions.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-semibold mb-1">Areas to review:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {feedback.misconceptions.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    // Default: unsent or unknown state
    return (
      <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
        <Check className="w-4 h-4" />
        Response submitted
      </div>
    );
  };

  // SA autosave indicator
  const AutosaveIndicator = ({ state }: { state: AutosaveState }) => {
    if (state === "idle") return null;
    const configs: Record<string, { text: string; cls: string; icon?: string }> = {
      dirty: { text: "Saving draft…", cls: "text-slate-400 animate-pulse", icon: "save" },
      saving: { text: "Saving draft…", cls: "text-blue-500 animate-pulse", icon: "save" },
      saved: { text: "Draft autosaved to server", cls: "text-emerald-600 font-semibold", icon: "check" },
      error: { text: "Unable to save draft — check connection", cls: "text-rose-600 font-semibold", icon: "alert" },
    };
    const c = configs[state];
    if (!c) return null;
    return (
      <span className={`text-[10.5px] inline-flex items-center gap-1 font-sans ${c.cls}`}>
        {c.icon === "save" && <RefreshCw className="w-3 h-3 animate-spin text-slate-400 shrink-0" />}
        {c.icon === "check" && <Check className="w-3 h-3 text-emerald-600 shrink-0" />}
        {c.icon === "alert" && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 animate-bounce" />}
        <span>{c.text}</span>
      </span>
    );
  };

  return (
    <div
      className={`h-screen max-h-screen overflow-hidden bg-slate-100 text-slate-800 font-sans flex flex-col relative ${
        attemptData?.isPreviewAttempt ? "pt-10" : ""
      }`}
    >
      {/* Preview banner */}
      {attemptData?.isPreviewAttempt && (
        <div className="fixed top-0 inset-x-0 bg-amber-500 text-slate-950 px-4 py-2 text-center text-xs font-bold shadow-md z-[60] flex items-center justify-center gap-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Student Preview — teacher-only fields are hidden. Test data is excluded from analytics.</span>
          <button
            onClick={onExit}
            className="ml-4 bg-slate-950 text-white rounded px-3 py-0.5 text-[10px] uppercase font-mono hover:bg-slate-800 transition cursor-pointer"
          >
            Exit Preview
          </button>
        </div>
      )}

      {/* Teacher-approval lock overlay */}
      <AnimatePresence>
        {isTeacherLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0A192F] text-white z-50 flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="w-16 h-16 rounded-full border-2 border-[#E5B53B]/30 flex items-center justify-center mb-6">
              <Lock className="w-7 h-7 text-[#E5B53B]" />
            </div>
            <h2 className="text-xl font-bold">Your session is paused.</h2>
            <p className="text-sm text-slate-300 max-w-sm mt-3 leading-relaxed">
              Your teacher has been notified. Your progress is saved. Raise your hand or contact your teacher to continue.
            </p>
            <p className="text-[10px] text-slate-500 mt-6 font-mono uppercase tracking-widest">
              This event has been recorded.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen enforcement overlay — student can self-dismiss */}
      <AnimatePresence>
        {isFullscreenLocked && !isTeacherLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0A192F]/95 text-white z-50 flex flex-col items-center justify-center p-8 text-center"
          >
            <ShieldAlert className="w-14 h-14 text-[#E5B53B] mb-5" />
            <h2 className="text-xl font-bold">Focus mode required</h2>
            <p className="text-sm text-slate-300 max-w-sm mt-3 leading-relaxed">
              {lockMessage}
            </p>
            <p className="text-[10px] text-slate-500 mt-2 mb-6">This event has been recorded.</p>
            <button
              onClick={requestFullscreen}
              className="bg-[#E5B53B] hover:bg-amber-500 text-[#0A192F] font-bold text-sm px-6 py-3 rounded flex items-center gap-2 transition cursor-pointer"
            >
              <Expand className="w-4 h-4" /> Re-enter fullscreen
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Violation banner — non-panicking, dismissible */}
      <AnimatePresence>
        {violationBanner.show && !isFullscreenLocked && !isTeacherLocked && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`fixed top-0 inset-x-0 z-40 px-4 py-2.5 flex items-center justify-between gap-4 text-sm font-medium shadow-md ${
              violationBanner.level === "medium"
                ? "bg-amber-50 border-b border-amber-200 text-amber-900"
                : "bg-slate-800 text-white"
            }`}
          >
            <div className="flex items-center gap-2">
              {violationBanner.level === "medium" ? (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              ) : (
                <Info className="w-4 h-4 shrink-0 text-white/70" />
              )}
              <span className="text-sm">{violationBanner.message}</span>
            </div>
            <button
              onClick={() => setViolationBanner((prev: ViolationBanner) => ({ ...prev, show: false }))}
              className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top shell — progress and context */}
      <header className={`bg-white border-b border-slate-200 shadow-sm shrink-0 z-30 ${violationBanner.show && !isFullscreenLocked && !isTeacherLocked ? "mt-10" : ""}`}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onExit}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
              title="Save progress and exit"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden b-sm:inline">Save and exit</span>
            </button>
            <span className="w-px h-4 bg-slate-200 hidden md:inline ml-1" />
            <button
              onClick={() => setIsTimelineOpen(!isTimelineOpen)}
              className="md:hidden flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
              title="Toggle Timeline"
            >
              <List className="w-4 h-4" />
              <span>Timeline</span>
            </button>
          </div>

          <div className="flex-1 min-w-0 text-center">
            <h1 className="text-sm font-bold text-slate-800 truncate">{attemptData?.lesson?.title || "Assignment"}</h1>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Segment {currentBlockIndex + 1} of {totalBlocks}
              {activeBlock?.title ? ` — ${activeBlock.title}` : ""}
            </p>
          </div>

          <div className="text-[10px] font-mono text-slate-400 shrink-0">
            {progressPercent}% done
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-slate-100">
          <motion.div
            className="h-1 bg-[#0A192F]"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(2, progressPercent)}%` }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </div>
      </header>

      {/* Horizontal split for Timeline Sidebar and Main Workspace */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden w-full relative">
        {/* Mobile Backdrop */}
        {isTimelineOpen && (
          <div
            onClick={() => setIsTimelineOpen(false)}
            className="fixed inset-0 bg-slate-900/40 z-40 md:hidden"
          />
        )}

        {/* Timeline Sidebar */}
        <aside
          className={`${
            isTimelineOpen ? "flex fixed inset-y-0 left-0 z-50 pt-10" : "hidden"
          } md:flex md:static w-72 border-r border-slate-200 bg-white flex-col h-full shrink-0 min-h-0 overflow-hidden transition-all duration-300`}
        >
          <div className="p-4 border-b border-slate-100 shrink-0 flex items-center justify-between bg-slate-50">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <List className="w-3.5 h-3.5" />
              <span>Lesson Timeline</span>
            </h3>
            <button
              onClick={() => setIsTimelineOpen(false)}
              className="md:hidden text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {blocks.map((b: any, idx: number) => {
              const status = getBlockStatus(b, idx);
              const isActive = idx === currentBlockIndex;
              const isLocked = status === "locked";
              const isCompleted = status === "completed" || status === "current_complete";

              // Get config for icon
              const displayConfigs: Record<string, { Icon: any; colorClass: string }> = {
                video: { Icon: Video, colorClass: "text-blue-500" },
                reading: { Icon: BookOpen, colorClass: "text-purple-500" },
                question: { Icon: FileQuestion, colorClass: b.isPractice ? "text-amber-500" : "text-emerald-500" },
              };
              const blockConfig = displayConfigs[b.type] || { Icon: Info, colorClass: "text-slate-500" };
              const Icon = blockConfig.Icon;

              return (
                <button
                  key={b.id}
                  disabled={isLocked}
                  onClick={() => {
                    handleBlockNavigation(idx);
                    setIsTimelineOpen(false);
                  }}
                  className={`w-full text-left p-2 rounded-lg border transition flex items-start gap-2.5 relative ${
                    isActive
                      ? "border-[#0A192F] bg-slate-50 text-slate-900 ring-1 ring-[#0A192F]/20 font-medium"
                      : isLocked
                      ? "border-slate-100 opacity-60 text-slate-400 cursor-not-allowed bg-slate-50/50"
                      : "border-slate-100 hover:bg-slate-50 text-slate-600 cursor-pointer"
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isCompleted ? (
                      <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    ) : isLocked ? (
                      <div className="w-4 h-4 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                        <Lock className="w-2.5 h-2.5" />
                      </div>
                    ) : isActive ? (
                      <div className="w-4 h-4 rounded-full border border-[#0A192F] bg-white flex items-center justify-center">
                        <div className="w-1 h-1 rounded-full bg-[#0A192F]" />
                      </div>
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300 bg-white flex items-center justify-center">
                        <div className="w-1 h-1 rounded-full bg-slate-300" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <Icon className={`w-3 h-3 shrink-0 ${blockConfig.colorClass}`} />
                      <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                        Step {idx + 1}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 truncate leading-snug ${isActive ? "font-bold" : ""}`}>
                      {b.title || "Untitled Block"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Workspace content */}
        <main className={`flex-1 min-h-0 flex flex-col ${activeBlock?.type === "video" ? "w-full" : "max-w-5xl mx-auto w-full px-4 md:px-6 py-4"}`}>

        {activeBlock && (
          <div className={`bg-white overflow-hidden flex-1 flex flex-col ${activeBlock.type === "video" ? "" : "border border-slate-200 rounded-lg shadow-sm"}`}>

            {/* Block header */}
            <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <BlockTypeBadge block={activeBlock} />
                <h2 className="text-sm font-bold text-slate-700 truncate">{activeBlock.title}</h2>
              </div>
              {activeBlock.type === "video" && attemptData?.lesson?.settings?.restrictSeeking && (
                <span className="text-[10px] text-slate-400 shrink-0">Seeking restricted</span>
              )}
            </div>

            {/* READING BLOCK */}
            {activeBlock.type === "reading" && (
              <div className="p-8 md:p-10 max-w-3xl mx-auto w-full space-y-5 overflow-y-auto flex-1 select-text">
                {activeBlock.content ? (
                  <div className="text-slate-800 font-serif text-base leading-relaxed space-y-4">
                    <RichContentRenderer content={activeBlock.content} />
                  </div>
                ) : (
                  <p className="italic text-slate-400 text-sm">No reading content available.</p>
                )}
              </div>
            )}

            {/* VIDEO BLOCK — full-width, video-first layout */}
            {activeBlock.type === "video" && (
              <div className="flex-1 flex flex-col relative bg-black" style={{ minHeight: 0 }}>
                {/* Note: browser controls do not prevent media extraction; this is casual deterrence only. */}
                <video
                  ref={videoRef}
                  src={resolvedVideoUrl || undefined}
                  controls
                  controlsList="nodownload noremoteplayback"
                  disablePictureInPicture
                  playsInline
                  preload="metadata"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  onPlay={handleVideoPlay}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onEnded={handleVideoEnded}
                  onRateChange={() => {
                    if (videoRef.current) {
                      setCurrentSpeed(videoRef.current.playbackRate);
                    }
                  }}
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      videoRef.current.playbackRate = currentSpeed;
                    }
                  }}
                  className="w-full object-contain bg-black"
                  style={{ flex: 1, minHeight: 0, maxHeight: "calc(100vh - 160px)" }}
                />

                {/* Custom Playback Speed Controller Bar */}
                <div className="bg-[#0b1526] border-t border-slate-800/80 px-6 py-2.5 flex items-center justify-between gap-4 font-sans select-none shrink-0 text-white z-10 w-full">
                  <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
                    <span className="text-slate-400">Video Speed:</span>
                    <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300 font-bold">{currentSpeed}x</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 1.25, 1.5].map((speed) => {
                      const isActive = currentSpeed === speed;
                      return (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => {
                            if (videoRef.current) {
                              videoRef.current.playbackRate = speed;
                              setCurrentSpeed(speed);
                            }
                          }}
                          className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            isActive
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/50"
                          }`}
                        >
                          {speed}x
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Checkpoint overlay */}
                <AnimatePresence>
                  {activeCheckpoint && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-[#0A192F]/96 flex flex-col justify-center p-8 text-white z-40 overflow-y-auto"
                    >
                      <div className="max-w-lg mx-auto w-full space-y-5">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-[#E5B53B] font-mono text-xs uppercase tracking-widest font-bold">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Checkpoint — answer to continue</span>
                            <span className="opacity-60">({activeCheckpoint.timestamp}s)</span>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-extrabold shadow-xs ${activeCheckpoint.isPractice ? "bg-teal-500/20 text-teal-300 border border-teal-500/30" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"}`}>
                              {activeCheckpoint.isPractice ? "Practice Checkpoint · Answers & Explanations Shown" : "Graded Checkpoint · Handed In to Portfolio"}
                            </span>
                          </div>
                        </div>
                        <h3 className="text-base font-bold leading-snug">{activeCheckpoint.title}</h3>
                        <p className="text-xs text-slate-400">
                          {activeCheckpoint.isPractice 
                            ? "Complete these questions to check your current understanding. Correct answers and explanations will clear immediately upon submission."
                            : "Complete these questions for formal course evaluation. Your response is recorded securely, and feedback is hidden until released by your teacher."
                          }
                        </p>

                        <div className="space-y-5">
                          {activeCheckpoint.questions.map((q: any) => {
                            const isSubmitted = submittedLocal[q.id];
                            const feedback = feedbackState[q.id];
                            const isCpPractice = !!activeCheckpoint.isPractice;
                            const cpSaState = saGradingState[q.id] ?? (isSubmitted ? (isCpPractice ? "pending_ai" : "submitted") : "unsent");
                            const cpSaFeedback = saFeedback[q.id];

                            return (
                              <div key={q.id} className="space-y-3">
                                <div className="text-sm text-slate-100 leading-relaxed font-serif">
                                  <RichContentRenderer content={q.stem} />
                                </div>

                                {q.choices ? (
                                  <div className="space-y-2">
                                    {q.choices.map((choice: any, cIdx: number) => {
                                      const letter = String.fromCharCode(65 + cIdx);
                                      const isSel = selectedMC[q.id] === choice.id;
                                      return (
                                        <button
                                          key={choice.id}
                                          disabled={isSubmitted}
                                          onClick={() => !isSubmitted && setSelectedMC({ ...selectedMC, [q.id]: choice.id })}
                                          className={`w-full text-left text-sm p-3 rounded border transition flex items-start gap-3 ${
                                            isSubmitted
                                              ? isSel
                                                ? "border-[#E5B53B] bg-[#E5B53B]/10 text-white cursor-default"
                                                : "border-slate-700 bg-transparent text-slate-400 cursor-default"
                                              : isSel
                                              ? "border-[#E5B53B] bg-[#E5B53B]/10 text-white cursor-pointer"
                                              : "border-slate-700 bg-slate-900/50 hover:bg-slate-800 text-slate-200 cursor-pointer"
                                          }`}
                                        >
                                          <span className="font-bold text-xs shrink-0 w-5 mt-0.5">{letter}.</span>
                                          <RichContentRenderer content={choice.text} className="flex-1" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {isSubmitted ? (
                                      <div className="w-full text-sm text-slate-200 bg-slate-900/60 p-3 rounded font-serif leading-relaxed border border-slate-800 prose max-w-none">
                                        <RichContentRenderer content={saText[q.id] || ""} />
                                      </div>
                                    ) : (
                                      <textarea
                                        disabled={false}
                                        className="w-full text-sm text-slate-800 bg-white p-3 rounded focus:outline-none font-serif leading-relaxed resize-none"
                                        rows={3}
                                        value={saText[q.id] || ""}
                                        onChange={(e: any) => handleSaChange(q.id, e.target.value)}
                                        placeholder="Write your response here…"
                                      />
                                    )}
                                    {!isSubmitted && (
                                      <AutosaveIndicator state={saAutosave[q.id] || "idle"} />
                                    )}
                                  </div>
                                )}

                                {!isSubmitted ? (
                                  <button
                                    onClick={() =>
                                      handleSubmitResponse(
                                        activeBlock.id,
                                        q.id,
                                        q.choices ? selectedMC[q.id] : saText[q.id],
                                        activeCheckpoint.id
                                      )
                                    }
                                    disabled={q.choices ? !selectedMC[q.id] : !(saText[q.id]?.trim())}
                                    className="bg-[#E5B53B] hover:bg-amber-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-[#0A192F] font-bold text-xs px-5 py-2 rounded cursor-pointer transition-colors"
                                  >
                                    Submit answer
                                  </button>
                                ) : q.choices ? (
                                  <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-bold">
                                    <Check className="w-3.5 h-3.5" /> Answered
                                  </div>
                                ) : (
                                  <div className="text-xs">
                                    <SaFeedbackDisplay
                                      state={cpSaState}
                                      feedback={cpSaFeedback}
                                      maxPoints={q.points || 0}
                                      isPractice={isCpPractice}
                                    />
                                  </div>
                                )}

                                {feedback && isCpPractice && q.choices && (
                                  <div
                                    className={`p-3 rounded text-xs space-y-1.5 ${
                                      feedback.correct
                                        ? "bg-emerald-900/40 text-emerald-300 border border-emerald-800"
                                        : "bg-red-900/40 text-red-300 border border-red-800"
                                    }`}
                                  >
                                    <strong className="block">{feedback.correct ? "Correct." : "Incorrect."}</strong>
                                    {feedback.desc && (
                                      <div className="opacity-90 italic">
                                        <RichContentRenderer content={feedback.desc} />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {activeCheckpoint.questions.every((q: any) => submittedLocal[q.id]) && (
                          <button
                            onClick={() => {
                              setActiveCheckpoint(null);
                              videoRef.current?.play().catch(() => {});
                            }}
                            className="w-full mt-2 bg-white hover:bg-slate-100 text-[#0A192F] font-bold text-sm py-2.5 rounded cursor-pointer transition"
                          >
                            Resume video
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* QUESTION BLOCK */}
            {activeBlock.type === "question" && (
              <div className="p-6 md:p-10 max-w-2xl mx-auto w-full space-y-6 overflow-y-auto flex-1">
                {assignedSet.length === 0 && (
                  <p className="text-sm text-slate-400 italic">No questions assigned to this block.</p>
                )}

                {assignedSet.map((asg: any) => {
                  const q = asg.selectedQuestion;
                  const isSubmitted = submittedLocal[q.id];
                  const feedback = feedbackState[q.id];
                  const isSaving = savingResponse[q.id];
                  const choicesMaybe = asg.scrambledChoices || q.choices;
                  const isPracticeBlock = !!activeBlock.isPractice;
                  const saState = saGradingState[q.id] ?? (isSubmitted ? (isPracticeBlock ? "pending_ai" : "submitted") : "unsent");
                  const saFeedbackData = saFeedback[q.id];

                  return (
                    <div key={asg.id} className="space-y-4 bg-white border border-slate-100 rounded-xl p-5 md:p-6 shadow-xs">
                      {/* Mode Badge Indicator */}
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className={`px-2.5 py-1 rounded text-[10px] font-sans uppercase tracking-wider font-extrabold shadow-2xs border ${
                          isPracticeBlock 
                            ? "bg-teal-50 text-teal-800 border-teal-200" 
                            : "bg-emerald-50 text-emerald-800 border-emerald-200"
                        }`}>
                          {isPracticeBlock ? "Practice Check · Immediate Corrective Feedback" : "Graded Assessment · Locked & Saved to Portfolio"}
                        </span>
                        {isSubmitted && (
                          <span className="text-[10px] text-slate-400 font-medium">
                            {isPracticeBlock ? "Response evaluated" : "Response logged to portfolio"}
                          </span>
                        )}
                      </div>

                      {/* Question stem */}
                      <div className="font-serif text-[16px] font-semibold text-slate-900 leading-relaxed pt-2 border-t border-slate-50">
                        <RichContentRenderer content={q.stem} />
                      </div>

                      {q.studentInstructions && (
                        <p className="text-sm text-slate-500 italic">
                          <RichContentRenderer content={q.studentInstructions} />
                        </p>
                      )}

                      {/* MC choices */}
                      {choicesMaybe ? (
                        <div className="space-y-2.5">
                          {choicesMaybe.map((choice: any, cIdx: number) => {
                            const choiceLetter = String.fromCharCode(65 + cIdx);
                            const isSel = selectedMC[q.id] === choice.id;
                            return (
                              <button
                                key={choice.id}
                                disabled={isSubmitted}
                                onClick={() => !isSubmitted && setSelectedMC({ ...selectedMC, [q.id]: choice.id })}
                                className={`w-full text-left text-sm p-3.5 rounded-lg border transition flex items-start gap-3 ${
                                  isSubmitted
                                    ? isSel
                                      ? "border-[#0A192F] bg-[#0A192F]/5 text-[#0A192F] cursor-default font-semibold"
                                      : "border-slate-200 text-slate-400 cursor-default bg-white"
                                    : isSel
                                    ? "border-[#0A192F] bg-[#0A192F]/5 text-[#0A192F] cursor-pointer font-semibold"
                                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white text-slate-700 cursor-pointer"
                                }`}
                              >
                                <span
                                  className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border mt-0.5 ${
                                    isSel
                                      ? "bg-[#0A192F] text-white border-[#0A192F]"
                                      : "border-slate-300 text-slate-500"
                                  }`}
                                >
                                  {choiceLetter}
                                </span>
                                <RichContentRenderer content={choice.text} className="flex-1 leading-relaxed" />
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        // SA textarea
                        <div className="space-y-2">
                          {isSubmitted ? (
                            <div className="w-full text-sm text-slate-800 border border-slate-200 bg-slate-50 rounded-lg p-4 leading-relaxed font-serif prose max-w-none">
                              <RichContentRenderer content={saText[q.id] || ""} />
                            </div>
                          ) : (
                            <textarea
                              disabled={false}
                              value={saText[q.id] || ""}
                              onChange={(e: any) => handleSaChange(q.id, e.target.value)}
                              rows={6}
                              placeholder="Write your response here. Your draft is saved automatically."
                              className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg p-4 leading-relaxed focus:outline-none focus:border-slate-400 transition font-serif resize-none bg-white hover:border-slate-300"
                            />
                          )}
                          {!isSubmitted && (
                            <div className="flex justify-between items-center">
                              <AutosaveIndicator state={saAutosave[q.id] || "idle"} />
                              <span className="text-[10px] text-slate-400">
                                {(saText[q.id] || "").length} characters
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Submit button */}
                      {!isSubmitted ? (
                        <button
                          onClick={() =>
                            handleSubmitResponse(
                              activeBlock.id,
                              q.id,
                              choicesMaybe ? selectedMC[q.id] : saText[q.id]
                            )
                          }
                          disabled={
                            isSaving ||
                            (choicesMaybe ? !selectedMC[q.id] : !(saText[q.id]?.trim()))
                          }
                          className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-sm px-6 py-2.5 rounded-lg transition cursor-pointer flex items-center gap-2"
                        >
                          {isSaving ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Submitting…
                            </>
                          ) : (
                            "Submit response"
                          )}
                        </button>
                      ) : choicesMaybe ? (
                        <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                          <Check className="w-4 h-4" />
                          Response submitted
                        </div>
                      ) : (
                        <SaFeedbackDisplay
                          state={saState}
                          feedback={saFeedbackData}
                          maxPoints={q.points || 0}
                          isPractice={isPracticeBlock}
                        />
                      )}

                      {/* MC practice feedback (immediate correct/incorrect) */}
                      {feedback && isPracticeBlock && choicesMaybe && (
                        <div
                          className={`p-4 rounded-lg text-sm space-y-1.5 border ${
                            feedback.correct
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-red-50 text-red-800 border-red-200"
                          }`}
                        >
                          <strong className="font-bold">
                            {feedback.correct ? "Correct." : "Incorrect."}
                          </strong>
                          {feedback.desc && (
                            <div className="text-sm opacity-80 italic">
                              <RichContentRenderer content={feedback.desc} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Navigation footer */}
            <div className={`bg-slate-50 border-t border-slate-200 shrink-0 ${activeBlock.type === "video" ? "px-6 py-3" : "px-6 py-4"}`}>
              {navigationError && (
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-amber-800">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{navigationError}</span>
                  </div>
                  <button
                    onClick={() => setNavigationError(null)}
                    className="text-amber-600 hover:text-amber-800 cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center gap-4">
                <button
                  disabled={currentBlockIndex === 0}
                  onClick={() => handleBlockNavigation(currentBlockIndex - 1)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 px-4 py-2 rounded-lg bg-white hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>

                <div className="flex flex-col items-end gap-1">
                  {nextBlockedReason && (
                    <p className="text-[11px] text-amber-600 text-right max-w-[200px] font-medium">{nextBlockedReason}</p>
                  )}

                  {!isLastBlock ? (
                    <button
                      onClick={async () => {
                        const reasonBefore = getNextBlockedReason();
                        if (reasonBefore) {
                          setNavigationError(reasonBefore);
                          return;
                        }
                        if (activeBlock?.type === "video") {
                          setNavigationError("Saving your video progress. Try again in a moment.");
                          await flushVideoProgress();
                          setNavigationError(null);
                        }
                        const reasonAfter = getNextBlockedReason();
                        if (reasonAfter) {
                          setNavigationError(reasonAfter);
                          return;
                        }
                        await handleBlockNavigation(currentBlockIndex + 1);
                      }}
                      disabled={isNavigating}
                      className="flex items-center gap-1.5 text-sm font-bold text-white bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition cursor-pointer"
                    >
                      {isNavigating ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading…
                        </>
                      ) : (
                        <>
                          Next <ChevronRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        const reasonBefore = getNextBlockedReason();
                        if (reasonBefore) {
                          setNavigationError(reasonBefore);
                          return;
                        }
                        if (activeBlock?.type === "video") {
                          setNavigationError("Saving your video progress. Try again in a moment.");
                          await flushVideoProgress();
                          setNavigationError(null);
                        }
                        const reasonAfter = getNextBlockedReason();
                        if (reasonAfter) {
                          setNavigationError(reasonAfter);
                          return;
                        }
                        handleCompleteLessonAttempt();
                      }}
                      disabled={isNavigating}
                      className="flex items-center gap-2 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed px-6 py-2 rounded-lg transition cursor-pointer"
                    >
                      <Flag className="w-4 h-4" /> Submit assignment
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  </div>
  );
}

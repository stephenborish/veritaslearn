import { useState, useEffect, useRef } from "react";
import {
  ShieldAlert, Play, Check, X, Expand, RefreshCw, AlertCircle, ArrowLeft,
  ChevronRight, ChevronLeft, Lock, Info, AlertTriangle, BookOpen, Video, FileQuestion, Flag
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, storage } from "../../lib/firebase";
import { ref, getDownloadURL } from "firebase/storage";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

interface FocusedPlayerProps {
  attemptId: string;
  user: any;
  onExit: () => void;
}

type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ViolationLevel = "none" | "low" | "medium";

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
  const draftSaveTimers = useRef<{ [qId: string]: ReturnType<typeof setTimeout> }>({});

  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string>("");

  // Time tracking
  const activeTimeRef = useRef(0);
  const inactiveTimeRef = useRef(0);

  // Video
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [furthestMaxTimestamp, setFurthestMaxTimestamp] = useState(0);
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
      data.responses.forEach((r: any) => {
        localSub[r.questionId] = true;
        if (r.type === "mc") {
          setSelectedMC((prev: any) => ({ ...prev, [r.questionId]: r.responseValue }));
          localFeed[r.questionId] = { correct: r.isCorrect };
        } else {
          setSaText((prev: any) => ({ ...prev, [r.questionId]: r.responseValue }));
        }
      });
      setSubmittedLocal(localSub);
      setFeedbackState(localFeed);

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

  // Integrity event listeners
  useEffect(() => {
    if (loading || !attemptData) return;

    const requireFullscreenOpt = attemptData.lesson?.settings?.requireFullscreen ?? true;

    const handleFullscreenChange = async () => {
      const isFull = !!document.fullscreenElement;
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
      }
    };

    const handleWindowBlur = () => {
      setActiveTab(false);
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
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logIntegritySignal("visibility_hidden", "high", { detail: "Tab hidden / switched." });
        setViolationBanner({
          show: true,
          level: "low",
          message: "Return to the assignment window. Focus monitoring is active.",
        });
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
    }

    const tickInterval = setInterval(() => {
      if (document.hasFocus() && !isFullscreenLocked && !document.hidden && activeTab) {
        activeTimeRef.current += 1;
      } else {
        inactiveTimeRef.current += 1;
      }
    }, 1000);

    const syncInterval = setInterval(() => {
      getAuthHeader().then((authHeader) => {
        fetch(`/api/attempts/${attemptId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            blockId: blocks[currentBlockIndex]?.id,
            timestamp: videoRef.current ? Math.floor(videoRef.current.currentTime) : 0,
            activeTime: activeTimeRef.current,
            inactiveTime: inactiveTimeRef.current,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            activeTimeRef.current = 0;
            inactiveTimeRef.current = 0;
            if (data.lockState === null && isTeacherLockedRef.current) {
              setIsTeacherLocked(false);
              isTeacherLockedRef.current = false;
              if (requireFullscreenOpt) requestFullscreen();
            } else if (data.lockState === "locked_awaiting_teacher" && !isTeacherLockedRef.current) {
              setIsTeacherLocked(true);
              isTeacherLockedRef.current = true;
            }
          })
          .catch(() => {});
      });
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

  const handleVideoTimeUpdate = async () => {
    const video = videoRef.current;
    if (!video) return;
    const block = blocks[currentBlockIndex];
    const restrictSeeking = attemptData?.lesson?.settings?.restrictSeeking ?? true;
    const currentTime = video.currentTime;

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
      }
    } else {
      if (currentTime > furthestMaxTimestamp) {
        setFurthestMaxTimestamp(currentTime);
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
      setCurrentBlockIndex(nextIdx);
      setActiveCheckpoint(null);
      setFurthestMaxTimestamp(0);
      setViolationBanner((prev: ViolationBanner) => ({ ...prev, show: false }));
    } catch {
      setNavigationError("Unable to navigate. Please check your connection and try again.");
    } finally {
      setIsNavigating(false);
    }
  };

  // SA draft autosave — debounced 800ms, persisted to server + localStorage fallback
  const handleSaChange = (questionId: string, value: string) => {
    setSaText((prev: any) => ({ ...prev, [questionId]: value }));
    setSaAutosave((prev: any) => ({ ...prev, [questionId]: "dirty" }));

    if (draftSaveTimers.current[questionId]) {
      clearTimeout(draftSaveTimers.current[questionId]);
    }
    draftSaveTimers.current[questionId] = setTimeout(async () => {
      setSaAutosave((prev: any) => ({ ...prev, [questionId]: "saving" }));
      // Always write to localStorage as an immediate offline backup.
      try { localStorage.setItem(`veritas_draft_${attemptId}_${questionId}`, value); } catch { /* ignore */ }
      // Persist to server so drafts survive device changes.
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
      if (activeBlock.storagePath) {
        const fileRef = ref(storage, activeBlock.storagePath);
        getDownloadURL(fileRef)
          .then(setResolvedVideoUrl)
          .catch(() => {
            setResolvedVideoUrl(
              activeBlock.videoUrl ||
                `https://firebasestorage.googleapis.com/v1/b/gen-lang-client-0781925544.firebasestorage.app/o/${encodeURIComponent(activeBlock.storagePath)}?alt=media`
            );
          });
      } else if (activeBlock.videoUrl) {
        setResolvedVideoUrl(activeBlock.videoUrl);
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
    if (activeCheckpoint) {
      const allAnswered = activeCheckpoint.questions.every((q: any) => submittedLocal[q.id]);
      if (!allAnswered) return "Answer all checkpoint questions to continue.";
    }
    return null;
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

  // SA autosave indicator
  const AutosaveIndicator = ({ state }: { state: AutosaveState }) => {
    if (state === "idle") return null;
    const configs: Record<string, { text: string; cls: string }> = {
      dirty: { text: "Saving draft…", cls: "text-slate-400" },
      saving: { text: "Saving draft…", cls: "text-slate-400" },
      saved: { text: "Draft saved", cls: "text-emerald-600" },
      error: { text: "Unable to save draft", cls: "text-rose-600" },
    };
    const c = configs[state];
    if (!c) return null;
    return (
      <span className={`text-[10px] font-medium font-mono ${c.cls}`}>{c.text}</span>
    );
  };

  return (
    <div
      className={`min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col relative ${
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
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
            title="Save progress and exit"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Save and exit</span>
          </button>

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
          <div
            className="h-1 bg-[#0A192F] transition-all duration-500"
            style={{ width: `${Math.max(2, progressPercent)}%` }}
          />
        </div>
      </header>

      {/* Block content area — full-width for video blocks, contained for reading/question */}
      <div className={`flex-1 flex flex-col ${activeBlock?.type === "video" ? "w-full" : "max-w-5xl mx-auto w-full px-4 md:px-6 py-6 space-y-4"}`}>

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
                  controlsList="nodownload noremoteplayback noplaybackrate"
                  disablePictureInPicture
                  playsInline
                  preload="metadata"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  onTimeUpdate={handleVideoTimeUpdate}
                  className="w-full object-contain bg-black"
                  style={{ flex: 1, minHeight: 0, maxHeight: "calc(100vh - 160px)" }}
                />

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
                        <div className="flex items-center gap-2 text-[#E5B53B] font-mono text-xs uppercase tracking-widest font-bold">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Checkpoint — answer to continue</span>
                          <span className="opacity-60">({activeCheckpoint.timestamp}s)</span>
                        </div>
                        <h3 className="text-base font-bold leading-snug">{activeCheckpoint.title}</h3>
                        <p className="text-xs text-slate-400">Complete these questions to resume the video.</p>

                        <div className="space-y-5">
                          {activeCheckpoint.questions.map((q: any) => {
                            const isSubmitted = submittedLocal[q.id];
                            const feedback = feedbackState[q.id];

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
                                    <textarea
                                      disabled={isSubmitted}
                                      className="w-full text-sm text-slate-800 bg-white p-3 rounded focus:outline-none font-serif leading-relaxed resize-none"
                                      rows={3}
                                      value={saText[q.id] || ""}
                                      onChange={(e: any) => handleSaChange(q.id, e.target.value)}
                                      placeholder="Write your response here…"
                                    />
                                    <AutosaveIndicator state={saAutosave[q.id] || "idle"} />
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
                                ) : (
                                  <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-bold">
                                    <Check className="w-3.5 h-3.5" /> Answered
                                  </div>
                                )}

                                {feedback && (
                                  <div
                                    className={`p-3 rounded text-xs ${
                                      feedback.correct
                                        ? "bg-emerald-900/40 text-emerald-300 border border-emerald-800"
                                        : "bg-red-900/40 text-red-300 border border-red-800"
                                    }`}
                                  >
                                    <strong>{feedback.correct ? "Correct." : "Incorrect."}</strong>
                                    {feedback.desc && <span className="ml-1 italic opacity-80">{feedback.desc}</span>}
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

                  return (
                    <div key={asg.id} className="space-y-4">
                      {/* Question stem */}
                      <div className="font-serif text-[16px] font-semibold text-slate-900 leading-relaxed">
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
                          <textarea
                            disabled={isSubmitted}
                            value={saText[q.id] || ""}
                            onChange={(e: any) => handleSaChange(q.id, e.target.value)}
                            rows={6}
                            placeholder="Write your response here. Your draft is saved automatically."
                            className={`w-full text-sm text-slate-800 border rounded-lg p-4 leading-relaxed focus:outline-none focus:border-slate-400 transition font-serif resize-none ${
                              isSubmitted ? "bg-slate-50 border-slate-200 text-slate-500 cursor-default" : "bg-white border-slate-200 hover:border-slate-300"
                            }`}
                          />
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
                      ) : (
                        <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                          <Check className="w-4 h-4" />
                          Response submitted
                          {!choicesMaybe && (
                            <span className="text-xs text-slate-400 font-normal ml-1">— your teacher will review it</span>
                          )}
                        </div>
                      )}

                      {/* Practice feedback */}
                      {feedback && (
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
                            <p className="text-sm opacity-80 italic">{feedback.desc}</p>
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
                    <p className="text-[11px] text-slate-500 text-right max-w-[200px]">{nextBlockedReason}</p>
                  )}

                  {!isLastBlock ? (
                    <button
                      onClick={() => handleBlockNavigation(currentBlockIndex + 1)}
                      disabled={isNavigating || !!nextBlockedReason}
                      title={nextBlockedReason || undefined}
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
                      onClick={handleCompleteLessonAttempt}
                      disabled={!!nextBlockedReason}
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
      </div>
    </div>
  );
}

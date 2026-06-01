import { useState, useEffect, useRef } from "react";
import { ShieldAlert, Play, EyeOff, Check, X, Expand, RefreshCw, AlertCircle, ArrowLeft, ChevronRight, Lock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, storage } from "../../lib/firebase";
import { ref, getDownloadURL } from "firebase/storage";
import { RichContentRenderer } from "../RichContent/RichContentRenderer";

interface FocusedPlayerProps {
  attemptId: string;
  user: any;
  onExit: () => void;
}

export default function FocusedPlayer({ attemptId, user, onExit }: FocusedPlayerProps) {
  // State management
  const [attemptData, setAttemptData] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [responses, setResponses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Focus and Screen Integrity states
  const [isLocked, setIsLocked] = useState(false);
  const [lockMessage, setLockMessage] = useState("");
  const [activeTab, setActiveTab] = useState(true);
  // Teacher-approval lock state (distinct from self-service fullscreen re-entry)
  const [isTeacherLocked, setIsTeacherLocked] = useState(false);
  const isTeacherLockedRef = useRef(false); // ref for closure access in intervals

  // Scoring / Submission states
  const [selectedMC, setSelectedMC] = useState<{ [qId: string]: string }>({});
  const [saText, setSaText] = useState<{ [qId: string]: string }>({});
  const [submittedLocal, setSubmittedLocal] = useState<{ [qId: string]: boolean }>({});
  const [savingResponse, setSavingResponse] = useState<{ [qId: string]: boolean }>({});
  const [feedbackState, setFeedbackState] = useState<{ [qId: string]: { correct: boolean; desc?: string } }>({});

  // SA draft autosave
  const draftSaveTimers = useRef<{ [qId: string]: ReturnType<typeof setTimeout> }>({});
  const [draftSavedIndicator, setDraftSavedIndicator] = useState<{ [qId: string]: boolean }>({});
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string>("");

  // Active time-spent counters
  const activeTimeRef = useRef(0);
  const inactiveTimeRef = useRef(0);
  
  // Video ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [furthestMaxTimestamp, setFurthestMaxTimestamp] = useState(0);
  const [activeCheckpoint, setActiveCheckpoint] = useState<any>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  // Helper to retrieve current active authentication headers
  const getAuthHeader = async (): Promise<Record<string, string>> => {
    if (!auth.currentUser) {
      return {};
    }
    try {
      const token = await auth.currentUser.getIdToken();
      return { "Authorization": `Bearer ${token}` };
    } catch (err) {
      console.error("FocusedPlayer - failed to retrieve ID token:", err);
      return {};
    }
  };

  // Fetch full structured data on mount
  const fetchData = async () => {
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch(`/api/attempts/${attemptId}`, {
        headers: authHeader
      });
      const data = await response.json();
      
      setAttemptData(data.attempt);
      setAssignments(data.questionAssignments || data.assignments || []);
      setResponses(data.responses);

      // Fetch accompanying lesson blocks
      const lResponse = await fetch(`/api/lessons/${data.attempt.lessonId}`, {
        headers: authHeader
      });
      const lData = await lResponse.json();
      setBlocks(lData.blocks);
      setCurrentBlockIndex(data.attempt.currentBlockIndex || 0);

      // Extract existing submissions to preserve state on reload
      const localSub: any = {};
      const localFeed: any = {};
      data.responses.forEach((r: any) => {
        localSub[r.questionId] = true;
        if (r.type === "mc") {
          setSelectedMC((prev) => ({ ...prev, [r.questionId]: r.responseValue }));
          localFeed[r.questionId] = { correct: r.isCorrect };
        } else {
          setSaText((prev) => ({ ...prev, [r.questionId]: r.responseValue }));
        }
      });
      setSubmittedLocal(localSub);
      setFeedbackState(localFeed);

      // Restore SA drafts from localStorage for unsubmitted questions
      const allAssignments = data.questionAssignments || data.assignments || [];
      allAssignments.forEach((asg: any) => {
        const q = asg.selectedQuestion;
        if (q?.type === "sa" && !localSub[q.id]) {
          const draftKey = `veritas_draft_${data.attempt.id}_${q.id}`;
          const saved = localStorage.getItem(draftKey);
          if (saved) {
            setSaText((prev) => ({ ...prev, [q.id]: saved }));
          }
        }
      });

      // Check teacher lock state on resume
      if (data.attempt.lockState === "locked_awaiting_teacher") {
        setIsTeacherLocked(true);
        isTeacherLockedRef.current = true;
      }

      // If video progress records are found, seek to saved limits
      const savedFurthest = data.attempt.furthestVideoTimestamps;
      if (savedFurthest && Object.keys(savedFurthest).length > 0) {
        const blockId = lData.blocks[data.attempt.currentBlockIndex]?.id;
        if (blockId && savedFurthest[blockId]) {
          setFurthestMaxTimestamp(savedFurthest[blockId]);
        }
      }

      setLoading(false);
    } catch (error) {
      console.error("Error loading attempt portal:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [attemptId]);

  // Request secure fullscreen on click
  const requestFullscreen = () => {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    }
    setIsLocked(false);
  };

  // Integrity listeners: Handles blurs, exits, copy / paste interceptions
  useEffect(() => {
    if (loading || !attemptData) return;

    const lesson = attemptData.lesson || {};
    const requireFullscreenOpt = attemptData.lesson?.settings?.requireFullscreen ?? true;

    // Fullscreen lock check — may escalate to teacher-approval lock
    const handleFullscreenChange = async () => {
      const isFull = !!document.fullscreenElement;
      if (!isFull && requireFullscreenOpt) {
        const result = await logIntegritySignal("fullscreen_exited", "high", { detail: "User exited fullscreen mode." });
        if (result?.lockState === "locked_awaiting_teacher") {
          // Escalated: teacher must approve re-entry
          setIsTeacherLocked(true);
          isTeacherLockedRef.current = true;
          setIsLocked(false);
        } else {
          // Standard fullscreen enforcement — student can self-dismiss
          setIsLocked(true);
          setLockMessage("VERITAS requires fullscreen focus. Please re-enter fullscreen to continue.");
        }
      }
    };

    // Tab blurs check
    const handleWindowBlur = () => {
      setActiveTab(false);
      logIntegritySignal("blur_focus_lost", "medium", { detail: "Window lost focus / Tab changed." });
    };

    const handleWindowFocus = () => {
      setActiveTab(true);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logIntegritySignal("visibility_hidden", "high", { detail: "Document hidden, tab switched." });
      }
    };

    // Clipboard copies blocks
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      logIntegritySignal("copy_blocked", "high", { detail: "Attempted word selection copy shorthand." });
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      logIntegritySignal("paste_blocked", "high", { detail: "Attempted paste action." });
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      logIntegritySignal("context_menu_blocked", "medium", { detail: "Attempted right click context inspection." });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Catch copy keyboard shortcuts: Cmd+C (Meta+C) or Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        logIntegritySignal("copy_blocked", "high", { detail: "Captured copy shortcut Ctrl+C / Cmd+C" });
      }
    };

    // Attach custom event guards
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    // Initial fullscreen prompt if required
    if (requireFullscreenOpt && !document.fullscreenElement) {
      setIsLocked(true);
      setLockMessage("This lesson requires fullscreen focus mode. Please enter fullscreen to continue.");
    }

    // Every second engagement profile sync
    const interval = setInterval(() => {
      if (document.hasFocus() && !isLocked && !document.hidden && activeTab) {
        activeTimeRef.current += 1;
      } else {
        inactiveTimeRef.current += 1;
      }
    }, 1000);

    // Synchronize time spent to backend every 10 seconds; also polls lock state
    const syncTimeSpent = setInterval(() => {
      getAuthHeader().then((authHeader) => {
        fetch(`/api/attempts/${attemptId}/progress`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader
          },
          body: JSON.stringify({
            blockId: blocks[currentBlockIndex]?.id,
            timestamp: videoRef.current ? Math.floor(videoRef.current.currentTime) : 0,
            activeTime: activeTimeRef.current,
            inactiveTime: inactiveTimeRef.current
          })
        }).then((res) => res.json()).then((data) => {
          activeTimeRef.current = 0;
          inactiveTimeRef.current = 0;
          // Detect teacher unlock — if lockState cleared and we were locked, resume
          if (data.lockState === null && isTeacherLockedRef.current) {
            setIsTeacherLocked(false);
            isTeacherLockedRef.current = false;
            if (requireFullscreenOpt) requestFullscreen();
          } else if (data.lockState === "locked_awaiting_teacher" && !isTeacherLockedRef.current) {
            setIsTeacherLocked(true);
            isTeacherLockedRef.current = true;
          }
        }).catch(() => {});
      }).catch(() => {});
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
      clearInterval(interval);
      clearInterval(syncTimeSpent);
    };
  }, [loading, attemptData, currentBlockIndex]);

  // Log activity and integrity signal to API; returns parsed response
  const logIntegritySignal = async (eventType: string, severity: string, metadata: any = {}): Promise<{ lockState?: string | null } | null> => {
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) return null;
      const res = await fetch("/api/integrity-signals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        },
        body: JSON.stringify({
          attemptId,
          eventType,
          severity,
          blockId: blocks[currentBlockIndex]?.id,
          videoTimestamp: videoRef.current ? Math.floor(videoRef.current.currentTime) : undefined,
          metadata: {
            message: metadata.detail || "Focus event recorded.",
            ...metadata
          }
        })
      });
      return res.ok ? res.json() : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  // Video skip verification checks
  const handleVideoTimeUpdate = async () => {
    const video = videoRef.current;
    if (!video) return;

    const block = blocks[currentBlockIndex];
    const restrictSeeking = attemptData?.lesson?.settings?.restrictSeeking ?? true;
    const currentTime = video.currentTime;

    // A: Skip check enforcement
    if (restrictSeeking) {
      const allowedGap = 3; // allowed gap
      if (currentTime > furthestMaxTimestamp + allowedGap) {
        // Violations! Skip back!
        video.currentTime = furthestMaxTimestamp;
        logIntegritySignal("seek_attempt_blocked", "high", {
          detail: "Attempted bypass skipping forward in required video instruction.",
          requestedSeekPosition: Math.floor(currentTime),
          furthestAllowedValue: furthestMaxTimestamp
        });
        return;
      } else {
        if (currentTime > furthestMaxTimestamp) {
          setFurthestMaxTimestamp(currentTime);
        }
      }
    } else {
      if (currentTime > furthestMaxTimestamp) {
        setFurthestMaxTimestamp(currentTime);
      }
    }

    // B: Pause video at checkpoint triggers if relevant!
    if (block.videoCheckpoints && block.videoCheckpoints.length > 0) {
      const checkpoint = block.videoCheckpoints.find((cp: any) => {
        const hasSubmittedAll = cp.questions.every((q: any) => submittedLocal[q.id]);
        return !hasSubmittedAll && Math.floor(currentTime) >= cp.timestamp;
      });

      if (checkpoint && !activeCheckpoint) {
        video.pause();
        setActiveCheckpoint(checkpoint);
        logIntegritySignal("checkpoint_triggered", "medium", {
          detail: `Entering required timestamp question checkpoint: ${checkpoint.title}`,
          checkpointId: checkpoint.id
        });
      }
    }
  };

  // Block change synchronization
  const handleBlockNavigation = async (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= blocks.length) return;
    setNavigationError(null);

    try {
      const authHeader = await getAuthHeader();
      const resp = await fetch(`/api/attempts/${attemptId}/block`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        },
        body: JSON.stringify({ blockIndex: nextIdx })
      });
      if (!resp.ok) {
        const data = await resp.json();
        setNavigationError(data.error || "Navigation blocked. Required segments must be completed before advancing.");
        return;
      }
      setCurrentBlockIndex(nextIdx);
      setActiveCheckpoint(null);
      setFurthestMaxTimestamp(0);
    } catch (e) {
      console.error(e);
      setNavigationError("Network synchronization failed. Please retry.");
    }
  };

  // SA draft autosave handler — debounced 800ms save to localStorage
  const handleSaChange = (questionId: string, value: string) => {
    setSaText((prev) => ({ ...prev, [questionId]: value }));
    if (draftSaveTimers.current[questionId]) {
      clearTimeout(draftSaveTimers.current[questionId]);
    }
    draftSaveTimers.current[questionId] = setTimeout(() => {
      localStorage.setItem(`veritas_draft_${attemptId}_${questionId}`, value);
      setDraftSavedIndicator((prev) => ({ ...prev, [questionId]: true }));
      setTimeout(() => setDraftSavedIndicator((prev) => ({ ...prev, [questionId]: false })), 2500);
    }, 800);
  };

  // Student answer submission
  const handleSubmitResponse = async (blockId: string, questionId: string, responseVal: string, cpId?: string) => {
    if (!responseVal) return;

    setSavingResponse((prev) => ({ ...prev, [questionId]: true }));
    try {
      const authHeader = await getAuthHeader();
      const respObj = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        },
        body: JSON.stringify({
          blockId,
          checkpointId: cpId,
          questionId,
          responseValue: responseVal,
          activeTimeSpent: activeTimeRef.current
        })
      });
      const data = await respObj.json();

      setSubmittedLocal((prev) => ({ ...prev, [questionId]: true }));

      // Clear SA draft from localStorage on successful submission
      localStorage.removeItem(`veritas_draft_${attemptId}_${questionId}`);
      if (draftSaveTimers.current[questionId]) {
        clearTimeout(draftSaveTimers.current[questionId]);
        delete draftSaveTimers.current[questionId];
      }

      // Handle practice immediate feedback if returned
      if (data.gradedImmediate) {
        setFeedbackState((prev) => ({
          ...prev,
          [questionId]: { correct: data.isCorrect, desc: data.explanation }
        }));
      }

    } catch (e) {
      console.error(e);
    } finally {
      setSavingResponse((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  // Complete attempt
  const handleCompleteLessonAttempt = async () => {
    try {
      const authHeader = await getAuthHeader();
      await fetch(`/api/attempts/${attemptId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        }
      });
      onExit();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col items-center justify-center font-sans">
        <RefreshCw className="w-8 h-8 animate-spin text-[#0A192F] mb-3" />
        <span className="text-[10px] font-mono font-bold tracking-widest text-slate-400 uppercase">Verifying Academic Handshake...</span>
      </div>
    );
  }

  const activeBlock = blocks[currentBlockIndex];
  const assignedSet = assignments.filter((asg) => asg.blockId === activeBlock?.id);

  // Dynamic resolution of video URL if storagePath exists
  useEffect(() => {
    if (activeBlock && activeBlock.type === "video") {
      if (activeBlock.storagePath) {
        const fileRef = ref(storage, activeBlock.storagePath);
        getDownloadURL(fileRef)
          .then((url) => {
            setResolvedVideoUrl(url);
          })
          .catch((err) => {
            console.warn("Student player: getDownloadURL failed, using videoUrl or guest link:", err);
            setResolvedVideoUrl(activeBlock.videoUrl || `https://firebasestorage.googleapis.com/v1/b/gen-lang-client-0781925544.firebasestorage.app/o/${encodeURIComponent(activeBlock.storagePath)}?alt=media`);
          });
      } else if (activeBlock.videoUrl) {
        setResolvedVideoUrl(activeBlock.videoUrl);
      } else {
        setResolvedVideoUrl("");
      }
    } else {
      setResolvedVideoUrl("");
    }
  }, [activeBlock]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col md:flex-row relative overflow-hidden">
      
      {/* Teacher-approval lock overlay — student cannot self-dismiss */}
      <AnimatePresence>
        {isTeacherLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0A192F] text-white z-50 flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="w-16 h-16 rounded-full border-2 border-[#E5B53B]/30 flex items-center justify-center mb-6">
              <Lock className="w-7 h-7 text-[#E5B53B]" />
            </div>
            <h2 className="text-xl font-bold tracking-wide">Your session is paused.</h2>
            <p className="text-sm text-slate-300 max-w-sm mt-4 leading-relaxed font-sans">
              Your teacher has been notified. Please wait — your progress is saved.
            </p>
            <p className="text-[10px] text-slate-500 mt-8 font-mono uppercase tracking-widest">
              Raise your hand or contact your teacher to continue.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Standard fullscreen enforcement overlay — student can self-dismiss */}
      <AnimatePresence>
        {isLocked && !isTeacherLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0A192F]/95 text-white z-50 flex flex-col items-center justify-center p-6 text-center"
          >
            <ShieldAlert className="w-16 h-16 text-[#E5B53B] mb-4 animate-pulse" />
            <h2 className="text-xl font-bold tracking-wider uppercase">Focus Mode Interrupted</h2>

            <p className="text-xs text-slate-300 max-w-sm my-4 leading-relaxed font-sans">
              {lockMessage || "This lesson requires fullscreen focus mode. Please re-enter fullscreen to continue."}
            </p>

            <button
              onClick={requestFullscreen}
              className="bg-[#E5B53B] hover:bg-amber-600 text-[#0A192F] font-extrabold text-xs uppercase px-6 py-3 rounded flex items-center gap-2 transition cursor-pointer tracking-wider"
            >
              <Expand className="w-4 h-4" /> RE-ENTER FOCUS FULLSCREEN
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Focus view block */}
      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full p-6 space-y-6">
        
        {/* Navigation / Header toolbar without distraction */}
        <div className="flex justify-between items-center border-b border-slate-200 pb-4">
          <button 
            onClick={onExit}
            className="text-[10px] font-bold text-slate-500 hover:text-red-700 flex items-center gap-1 cursor-pointer font-mono tracking-wider uppercase transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> EXIT FOCUS STAGE
          </button>
          
          <div className="text-center">
            <h1 className="text-sm font-bold text-slate-800 uppercase tracking-tight">{attemptData?.lesson?.title}</h1>
            <p className="text-[9px] uppercase font-mono tracking-widest text-[#E5B53B] mt-0.5">STUDENT WORKSPACE • MALVERN PREP</p>
          </div>

          <div className="text-[10px] font-bold font-mono text-slate-400 uppercase tracking-wider">
            SEGMENT {currentBlockIndex + 1} / {blocks.length}
          </div>
        </div>

        {/* Dynamic block content stages */}
        {activeBlock && (
          <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm flex-1 flex flex-col min-h-[450px]">
            
            {/* STAGE A: READING VIEWPORT */}
            {activeBlock.type === "reading" && (
              <div className="p-8 md:p-10 max-w-3xl mx-auto space-y-5 overflow-y-auto flex-1 select-text">
                <h2 className="text-2xl font-bold font-serif text-[#0A192F] tracking-tight leading-snug">{activeBlock.title}</h2>
                <div className="border-t border-slate-100 pt-4 text-slate-800 font-serif text-base leading-relaxed space-y-4">
                  {/* Simplistic reading paragraphs */}
                  {activeBlock.content ? (
                    <RichContentRenderer content={activeBlock.content} />
                  ) : (
                    <p className="italic text-slate-400">Document under review.</p>
                  )}
                </div>
              </div>
            )}

            {/* STAGE B: HTML5 VIDEO CONTAINER */}
            {activeBlock.type === "video" && (
              <div className="flex-1 flex flex-col relative bg-black">
                <video
                  ref={videoRef}
                  src={resolvedVideoUrl}
                  controls
                  controlsList="nodownload noremoteplayback"
                  onTimeUpdate={handleVideoTimeUpdate}
                  className="w-full flex-1 max-h-[500px]"
                />
                
                {/* Active question checkpoint overlay */}
                <AnimatePresence>
                  {activeCheckpoint && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-[#0A192F]/95 flex flex-col justify-center p-8 text-white z-40 overflow-y-auto"
                    >
                      <div className="max-w-md mx-auto space-y-4">
                        <div className="flex items-center gap-1.5 text-xs text-[#E5B53B] font-mono uppercase tracking-widest font-bold">
                          <Lock className="w-3.5 h-3.5" /> Checkpoint Stop-Trigger ({activeCheckpoint.timestamp}s)
                        </div>
                        <h3 className="text-base font-bold leading-snug tracking-tight">{activeCheckpoint.title}</h3>

                        <div className="space-y-3 pt-2">
                          {activeCheckpoint.questions.map((q: any) => {
                            const isSubmitted = submittedLocal[q.id];
                            const feedback = feedbackState[q.id];

                            return (
                              <div key={q.id} className="space-y-2">
                                <div className="text-sm text-slate-200 leading-relaxed font-serif italic">
                                  <RichContentRenderer content={q.stem} />
                                </div>
                                
                                {q.choices ? (
                                  <div className="grid grid-cols-1 gap-2">
                                    {q.choices.map((choice: any, cIdx: number) => {
                                      const letter = String.fromCharCode(65 + cIdx);
                                      const isSel = selectedMC[q.id] === choice.id;

                                      return (
                                        <button
                                          key={choice.id}
                                          disabled={isSubmitted}
                                          onClick={() => setSelectedMC({ ...selectedMC, [q.id]: choice.id })}
                                          className={`w-full text-left text-xs p-2.5 rounded transition border text-slate-200 flex items-start gap-1.5 cursor-pointer ${
                                            isSel ? "border-[#E5B53B] bg-[#E5B53B]/10 text-white font-semibold" : "border-slate-800 bg-slate-900/60 hover:bg-slate-800"
                                          }`}
                                        >
                                          <span className="font-sans font-black pr-1">{letter}.</span>
                                          <RichContentRenderer content={choice.text} className="inline-block" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <textarea
                                      className="w-full text-sm text-slate-800 bg-white p-3 rounded focus:outline-none focus:bg-slate-50 transition-colors font-serif leading-relaxed"
                                      rows={3}
                                      value={saText[q.id] || ""}
                                      onChange={(e) => handleSaChange(q.id, e.target.value)}
                                      placeholder="Write your brief response here..."
                                    />
                                    {draftSavedIndicator[q.id] && (
                                      <span className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">Draft saved</span>
                                    )}
                                  </div>
                                )}

                                {!isSubmitted && (
                                  <button
                                    onClick={() => handleSubmitResponse(activeBlock.id, q.id, q.choices ? selectedMC[q.id] : saText[q.id], activeCheckpoint.id)}
                                    className="bg-[#E5B53B] hover:bg-amber-600 text-[#0A192F] font-bold uppercase text-[9px] tracking-widest px-4 py-2 rounded cursor-pointer transition-colors shadow-sm"
                                  >
                                    Submit Checkpoint Answer
                                  </button>
                                )}

                                {isSubmitted && (
                                  <div className="text-[10px] flex items-center gap-1 text-green-400 font-bold uppercase font-mono tracking-wider">
                                    <Check className="w-3.5 h-3.5" /> Progress Lock Released
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
                            className="w-full mt-4 bg-white hover:bg-slate-100 text-[#0A192F] font-bold uppercase text-[10px] py-2 rounded cursor-pointer tracking-widest transition-colors shadow-sm"
                          >
                            Resume Instruction Lecture &rarr;
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* STAGE C: STANDALONE QUESTIONS SHEET */}
            {activeBlock.type === "question" && (
              <div className="p-6 md:p-10 max-w-2xl mx-auto space-y-5 overflow-y-auto flex-1 w-full">
                <h2 className="text-xs font-bold border-b border-slate-100 pb-2 text-slate-400 font-mono tracking-widest uppercase">
                  {activeBlock.title}
                </h2>

                {assignedSet.map((asg) => {
                  const q = asg.selectedQuestion;
                  const isSubmitted = submittedLocal[q.id];
                  const feedback = feedbackState[q.id];

                  return (
                    <div key={asg.id} className="space-y-4">
                      <div className="font-serif text-[15px] font-semibold text-slate-900 leading-relaxed"><RichContentRenderer content={q.stem} /></div>

                      {q.choices ? (
                        <div className="grid grid-cols-1 gap-2.5">
                          {q.choices.map((choice: any, cIdx: number) => {
                            const choiceLetter = String.fromCharCode(65 + cIdx);
                            const isSel = selectedMC[q.id] === choice.id;

                            return (
                              <button
                                key={choice.id}
                                disabled={isSubmitted}
                                onClick={() => setSelectedMC({ ...selectedMC, [q.id]: choice.id })}
                                className={`w-full text-left text-xs p-3.5 rounded border transition-all flex items-start gap-2.5 cursor-pointer ${
                                  isSel ? "border-[#0A192F] bg-[#0A192F]/5 font-bold text-[#0A192F]" : "border-slate-200 hover:bg-slate-50 bg-white text-slate-700"
                                }`}
                              >
                                <span className="font-sans font-black pr-1">{choiceLetter}.</span>
                                <RichContentRenderer content={choice.text} className="inline-block" />
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <textarea
                            disabled={isSubmitted}
                            value={saText[q.id] || ""}
                            onChange={(e) => handleSaChange(q.id, e.target.value)}
                            rows={5}
                            placeholder="Compose your academic rationale here. Copying, pasting, and navigation out of focused screen is logged."
                            className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded p-4 leading-relaxed focus:bg-white focus:outline-none focus:border-slate-400 transition-colors font-serif"
                          />
                          {!isSubmitted && draftSavedIndicator[q.id] && (
                            <span className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">Draft saved</span>
                          )}
                        </div>
                      )}

                      {!isSubmitted && (
                        <button
                          onClick={() => handleSubmitResponse(activeBlock.id, q.id, q.choices ? selectedMC[q.id] : saText[q.id])}
                          className="bg-[#0A192F] hover:bg-[#15294b] text-white font-bold uppercase text-[10px] tracking-wider px-5 py-2 rounded transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          Submit Response
                        </button>
                      )}

                      {/* Display Practice mode instant evaluations if relevant! */}
                      {feedback && (
                        <div className={`p-4 rounded text-xs space-y-1 ${
                          feedback.correct ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
                        }`}>
                          <strong className="uppercase font-mono block text-[9px] tracking-widest">Instant Evaluator Response</strong>
                          <p className="font-semibold">{feedback.correct ? "Correct Choice! Excellent synthesis of historical references." : "Incorrect selection. Review instruction timestamps carefully."}</p>
                          {feedback.desc && <p className="italic mt-1 text-slate-600">"{feedback.desc}"</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Block footer controls */}
            {navigationError && (
              <div className="bg-red-50 border-t border-b border-red-200 px-6 py-2.5 text-red-800 flex items-center justify-between gap-2 shadow-inner">
                <div className="flex items-center gap-1.5 font-medium text-xs">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <span>{navigationError}</span>
                </div>
                <button 
                  onClick={() => setNavigationError(null)}
                  className="text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer uppercase tracking-wider"
                >
                  Dismiss
                </button>
              </div>
            )}
            <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 shrink-0 flex justify-between items-center text-xs">
              <button
                disabled={currentBlockIndex === 0}
                onClick={() => handleBlockNavigation(currentBlockIndex - 1)}
                className="font-bold text-slate-600 hover:text-slate-800 border border-slate-200 px-3.5 py-1.5 rounded bg-white hover:bg-slate-50 transition disabled:opacity-40 select-none cursor-pointer text-[10px] tracking-wide"
              >
                &larr; PREVIOUS SEGMENT
              </button>

              {currentBlockIndex < blocks.length - 1 ? (
                <button
                  onClick={() => handleBlockNavigation(currentBlockIndex + 1)}
                  className="font-bold text-white bg-[#0A192F] hover:bg-[#15294b] px-4 py-1.5 rounded flex items-center gap-1 transition select-none cursor-pointer text-[10px] tracking-wider shadow-sm"
                >
                  NEXT SEGMENT <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleCompleteLessonAttempt}
                  className="font-bold text-white bg-green-700 hover:bg-green-800 px-5 py-2 rounded transition tracking-wider uppercase flex items-center gap-1.5 cursor-pointer shadow-sm text-[10px]"
                >
                  <Check className="w-4 h-4" /> COMPLETE LESSON
                </button>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

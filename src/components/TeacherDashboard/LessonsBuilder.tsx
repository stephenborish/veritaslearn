import React, { useState } from "react";
import { Plus, Trash, Settings, Save, AlertCircle, FileText, Video, Clock, ChevronUp, ChevronDown, ArrowUp, ArrowDown, BookOpen, Calendar, ShieldAlert, Eye, Play, CheckCircle } from "lucide-react";
import { Lesson, LessonBlock } from "../../types";
import VideoUploader from "./VideoUploader";
import { RichContentEditor } from "../RichContent/RichContentEditor";
import QuestionEditor, { validateQuestionClient } from "./QuestionEditor";

function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

// Fresh question definition in the stable choice-id model.
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
  onSaveLesson: (lessonData: any) => Promise<void>;
  onArchived: (id: string) => Promise<void>;
  assignments?: any[];
  onSaveAssignment?: (payload: any) => Promise<void>;
  onDeleteAssignment?: (id: string) => Promise<void>;
  onLaunchPreviewAttempt?: (lessonId: string) => Promise<void>;
}

export default function LessonsBuilder({ 
  lessons, 
  blocks, 
  onSaveLesson, 
  onArchived,
  assignments = [],
  onSaveAssignment,
  onDeleteAssignment,
  onLaunchPreviewAttempt
}: LessonsBuilderProps) {
  const [selectedLesson, setSelectedLesson] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [isPublished, setIsPublished] = useState(false);
  const [restrictSeeking, setRestrictSeeking] = useState(true);
  const [requireFullscreen, setRequireFullscreen] = useState(true);
  const [allowRetakes, setAllowRetakes] = useState(false);
  const [randomizeChoices, setRandomizeChoices] = useState(true);
  const [immediateFeedback, setImmediateFeedback] = useState(false);

  // Sub-tabs for library vs assignments
  const [builderSubTab, setBuilderSubTab] = useState<"library" | "assignments">("library");

  // Assignment Creator Form state
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [asgLessonId, setAsgLessonId] = useState("");
  const [asgCourseId, setAsgCourseId] = useState("VERITAS 101");
  const [asgSection, setAsgSection] = useState("Section A");

  // Time generators for date inputs
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

  const [asgOpensAt, setAsgOpensAt] = useState(getDefaultOpenDate());
  const [asgDueAt, setAsgDueAt] = useState(getDefaultDueDate());
  const [asgClosesAt, setAsgClosesAt] = useState(getDefaultCloseDate());
  const [asgError, setAsgError] = useState("");

  const handleCreateAssignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAsgError("");

    if (!asgLessonId) {
      setAsgError("Please select a lesson plan to assign.");
      return;
    }
    if (!asgCourseId.trim()) {
      setAsgError("Please enter a course code / title.");
      return;
    }
    if (new Date(asgOpensAt) >= new Date(asgDueAt)) {
      setAsgError("Opening date must be before due date.");
      return;
    }
    if (new Date(asgDueAt) > new Date(asgClosesAt)) {
      setAsgError("Due date must be on or before closing date.");
      return;
    }

    if (onSaveAssignment) {
      const payload = {
        lessonId: asgLessonId,
        courseId: asgCourseId.trim(),
        section: asgSection.trim(),
        opensAt: new Date(asgOpensAt).toISOString(),
        dueAt: new Date(asgDueAt).toISOString(),
        closesAt: new Date(asgClosesAt).toISOString()
      };
      await onSaveAssignment(payload);
      setShowAssignmentForm(false);
      // Reset form options
      setAsgLessonId("");
    }
  };

  // Active designer blocks
  const [currentBlocks, setCurrentBlocks] = useState<any[]>([]);

  // Expanded block IDs tracking
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});

  const toggleBlockExpanded = (blockId: string) => {
    setExpandedBlocks((prev: Record<string, boolean>) => ({
      ...prev,
      [blockId]: !prev[blockId]
    }));
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
  };

  // Open editor of specific lesson
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

    const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id).sort((a, b) => a.order - b.order);
    setCurrentBlocks(lessonBlocks.map((b) => ({ ...b })));

    // Collapse other blocks, expand the first one for neat visual organization
    const initialExpanded: Record<string, boolean> = {};
    lessonBlocks.forEach((b, i) => {
      initialExpanded[b.id] = i === 0;
    });
    setExpandedBlocks(initialExpanded);
  };

  const startNewLesson = () => {
    setSelectedLesson({ id: "new" });
    setTitle("New Lesson");
    setDescription("");
    setEstimatedMinutes(25);
    setIsPublished(false);
    setRestrictSeeking(true);
    setRequireFullscreen(true);
    setAllowRetakes(false);
    setRandomizeChoices(true);
    setImmediateFeedback(false);
    setCurrentBlocks([
      {
        id: "b_new_1",
        type: "video",
        title: "Video Instruction",
        videoUrl: "",
        videoCheckpoints: []
      }
    ]);
    setExpandedBlocks({ "b_new_1": true });
  };

  const handleAddBlock = (type: "video" | "reading" | "question") => {
    const freshId = "b_" + Math.random().toString(36).substring(2, 9);
    const newBlock = {
      id: freshId,
      type,
      title: type === "video" ? "New Video Segment" : type === "reading" ? "Primary Source Reading" : "Multiple Choice Quiz",
      videoUrl: type === "video" ? "" : undefined,
      content: type === "reading" ? "### Lesson Passage\nEnter reading content here." : undefined,
      questionType: type === "question" ? "mc" : undefined,
      isPractice: type === "question" ? false : undefined,
      singleQuestion: type === "question" ? newQuestionTemplate("mc") : undefined
    };
    setCurrentBlocks([...currentBlocks, newBlock]);
    // Collapse others and expand this new one
    setExpandedBlocks({ [freshId]: true });
  };

  const handleDeleteBlock = (index: number) => {
    setCurrentBlocks(currentBlocks.filter((_: any, idx: number) => idx !== index));
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

  const [saveError, setSaveError] = useState<string[] | null>(null);

  const saveWithPublishedStatus = async (publishedStatus: boolean) => {
    setSaveError(null);

    // Published lessons must contain valid graded questions (client gate; server re-validates).
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
        return false;
      }
    }

    const payload = {
      id: selectedLesson.id === "new" ? undefined : selectedLesson.id,
      title,
      description,
      estimatedMinutes,
      isPublished: publishedStatus,
      settings: {
        restrictSeeking,
        requireFullscreen,
        allowRetakes,
        randomizeChoices,
        immediateFeedback
      },
      blocks: currentBlocks
    };

    await onSaveLesson(payload);
    setSelectedLesson(null);
    return true;
  };

  const handleSave = async () => {
    await saveWithPublishedStatus(isPublished);
  };

  const handleSaveAsDraft = async () => {
    await saveWithPublishedStatus(false);
  };

  const handlePublishLive = async () => {
    const success = await saveWithPublishedStatus(true);
    if (!success) {
      // If validation error occurred, keep editor open so they can resolve errors listed in saveError
      setIsPublished(true);
    }
  };

  const handleAssignAndLaunch = async () => {
    // Determine status to save, then route student assignments form context
    const success = await saveWithPublishedStatus(isPublished);
    if (success) {
      if (selectedLesson.id !== "new") {
        setAsgLessonId(selectedLesson.id);
        setShowAssignmentForm(true);
        setBuilderSubTab("assignments");
      } else {
        // Fallback for new lesson - direct user to form
        setAsgLessonId("");
        setShowAssignmentForm(true);
        setBuilderSubTab("assignments");
      }
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {!selectedLesson ? (
        // Standard listings with tabbed architecture
        <div className="space-y-6">
          {/* Sub-tab selection */}
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setBuilderSubTab("library")}
              className={`pb-3 px-4 font-sans text-xs font-bold uppercase tracking-wider border-b-2 transition ${
                builderSubTab === "library"
                  ? "border-[#0A192F] text-[#0A192F]"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              Lessons Library
            </button>
            <button
              onClick={() => setBuilderSubTab("assignments")}
              className={`pb-3 px-4 font-sans text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-1.5 ${
                builderSubTab === "assignments"
                  ? "border-[#0A192F] text-[#0A192F]"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
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
                  
                  // Filter deliveries assigned to this lesson
                  const lessonAsgs = assignments.filter((asg) => asg.lessonId === lesson.id);
                  
                  // Count structural segments
                  const lessonBlocks = blocks.filter((b) => b.lessonId === lesson.id);
                  const videoCount = lessonBlocks.filter((b) => b.type === "video").length;
                  const readingCount = lessonBlocks.filter((b) => b.type === "reading").length;
                  const practiceCount = lessonBlocks.filter((b) => b.type === "question" && b.isPractice).length;
                  const gradedCount = lessonBlocks.filter((b) => b.type === "question" && !b.isPractice).length;

                  return (
                    <div 
                      key={lesson.id}
                      className="bg-white border text-slate-800 border-slate-250 p-6 rounded shadow-sm hover:border-slate-300 hover:shadow-md transition flex flex-col justify-between min-h-[300px] font-sans"
                    >
                      <div className="space-y-4">
                        {/* Header: Title and Publication Status */}
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1">
                            <h3 className="text-base font-bold text-slate-900 tracking-tight text-left">{lesson.title}</h3>
                            <span className="text-[10px] font-mono font-bold text-slate-400 block tracking-tight">ID: {lesson.id.toUpperCase()}</span>
                          </div>
                          
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-[9px] font-bold font-mono uppercase tracking-widest px-2 py-0.5 rounded-sm border ${
                              lesson.isPublished
                                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                : "bg-slate-100 text-slate-550 border-slate-200"
                            }`}>
                              {lesson.isPublished ? "Published" : "Draft State"}
                            </span>
                          </div>
                        </div>

                        {/* Description */}
                        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                          {(() => {
                            const desc = lesson.description;
                            if (!desc) return "Complete this lesson segment.";
                            if (typeof desc === "object") {
                                return desc.plainText || (desc.html ? desc.html.replace(/<[^>]*>/g, "") : "");
                            }
                            const stripped = String(desc).replace(/<[^>]*>/g, "").trim();
                            return stripped || "Complete this lesson segment.";
                          })()}
                        </p>

                        {/* Block Summary Statistics */}
                        <div className="bg-slate-50/50 border border-slate-200/60 rounded-md p-3.5 space-y-2">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Lesson Structure</div>
                          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[11px] text-slate-600 font-medium">
                            <div className="flex items-center gap-1.5">
                              <span>Videos: <strong>{videoCount}</strong> watch block(s)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span>Passages: <strong>{readingCount}</strong> read-block(s)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span>Practice Qs: <strong>{practiceCount}</strong> (unscored)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span>Graded Qs: <strong className="text-[#0a192f]">{gradedCount} checkpoint(s)</strong></span>
                            </div>
                          </div>
                        </div>

                        {/* Delivery Settings Summary */}
                        <div className="border-t border-slate-100 pt-3.5 space-y-2">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Delivery Settings</div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-sm border ${
                              lesson.settings?.restrictSeeking
                                ? "bg-red-50 text-red-700 border-red-100"
                                : "bg-slate-50 text-slate-500 border-slate-100"
                            }`}>
                              {lesson.settings?.restrictSeeking ? "Seeking restricted" : "Open seeking"}
                            </span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-sm border ${
                              lesson.settings?.requireFullscreen
                                ? "bg-amber-50 text-amber-700 border-amber-100"
                                : "bg-slate-50 text-slate-500 border-slate-100"
                            }`}>
                              {lesson.settings?.requireFullscreen ? "Focus monitoring" : "No focus monitoring"}
                            </span>
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-sm bg-slate-100 text-slate-600 border border-slate-200">
                              {lesson.estimatedMinutes || 30} mins
                            </span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-sm border ${
                              lesson.settings?.allowRetakes 
                                ? "bg-blue-50 text-blue-700 border-blue-100" 
                                : "bg-slate-50 text-slate-500 border-slate-100"
                            }`}>
                              {lesson.settings?.allowRetakes ? "Retakes Enabled" : "Single Attempt"}
                            </span>
                          </div>
                        </div>

                        {/* Student Delivery Status */}
                        <div className="border-t border-slate-100 pt-3.5 space-y-2 text-left">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Student Access &amp; Launch Status</span>
                          
                          {!lesson.isPublished ? (
                            <div className="bg-amber-50 border border-amber-200/70 p-2.5 rounded text-slate-700 space-y-0.5">
                              <div className="flex items-center gap-1.5 text-amber-800 font-bold uppercase tracking-wider text-[10px]">
                                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                                <span>Unpublished Draft</span>
                              </div>
                              <p className="text-[11px] text-slate-600">
                                Outstanding draft. Student access is blocked in this state. <strong>Publish Lesson</strong> in the designer to unlock launch and assignment scheduling.
                              </p>
                            </div>
                          ) : lessonAsgs.length === 0 ? (
                            <div className="bg-slate-100/80 border border-slate-200 p-2.5 rounded text-slate-600">
                              <div className="font-bold text-slate-700 text-[10px] uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                                <span>Published Lesson &bull; Not Assigned</span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-1">
                                Lesson is ready but not assigned. Click <strong>Assign Lesson</strong> to schedule student access.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {lessonAsgs.map((asg) => {
                                const opens = asg.opensAt || "";
                                const closes = asg.closesAt || "";
                                let statusBadge = null;
                                let statusDesc = "";
                                
                                if (now < opens) {
                                  statusBadge = (
                                    <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">
                                      Scheduled
                                    </span>
                                  );
                                  statusDesc = `Releases on ${new Date(opens).toLocaleDateString()}`;
                                } else if (now >= opens && now <= closes) {
                                  statusBadge = (
                                    <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider animate-pulse">
                                      ● Available to Students
                                    </span>
                                  );
                                  statusDesc = `Active now (Due ${new Date(asg.dueAt).toLocaleDateString()})`;
                                } else {
                                  statusBadge = (
                                    <span className="bg-red-50 text-red-600 border border-red-100 font-bold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">
                                      Closed
                                    </span>
                                  );
                                  statusDesc = "Access window expired";
                                }

                                return (
                                  <div key={asg.id} className="bg-slate-50 border border-slate-200 p-2 rounded flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                                    <div className="text-[11px]">
                                      <div className="font-semibold text-slate-800">
                                        Course: <span className="font-bold">{asg.courseId}</span>
                                        {asg.section && <span className="text-slate-400 font-normal"> / Section {asg.section}</span>}
                                      </div>
                                      <div className="text-[10px] text-slate-400 mt-0.5">
                                        <span>DUE: {new Date(asg.dueAt).toLocaleString()}</span>
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-end shrink-0 text-right">
                                      {statusBadge}
                                      <span className="text-[9px] text-slate-400 font-bold mt-0.5">{statusDesc}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Control Panel Footer */}
                      <div className="mt-6 border-t border-slate-100 pt-4 flex flex-wrap justify-between items-center gap-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onLaunchPreviewAttempt && onLaunchPreviewAttempt(lesson.id)}
                            className="bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold uppercase text-[9px] tracking-widest border border-amber-200 px-3 py-1.5 rounded transition cursor-pointer shadow-xs"
                            title="Sandbox test sandbox mode inside focus player"
                          >
                            Preview Student
                          </button>
                          
                          <button
                            onClick={() => {
                              setBuilderSubTab("assignments");
                              setAsgLessonId(lesson.id);
                              setShowAssignmentForm(true);
                              // Scroll into view
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            disabled={!lesson.isPublished}
                            className={`text-[9px] tracking-widest font-bold uppercase px-3 py-1.5 rounded transition shadow-xs border ${
                              lesson.isPublished
                                ? "bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white"
                                : "bg-slate-100 text-slate-350 border-slate-200 cursor-not-allowed"
                            }`}
                            title={lesson.isPublished ? "Assign and Release this version to rosters" : "Must publish lesson first"}
                          >
                            Assign / Launch
                          </button>
                        </div>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEditing(lesson)}
                            className="text-slate-700 hover:bg-slate-50 font-bold uppercase text-[9px] tracking-widest border border-slate-200 px-2.5 py-1.5 rounded transition cursor-pointer shadow-xs"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onArchived(lesson.id)}
                            className="text-red-700 hover:bg-red-50/50 font-bold uppercase text-[9px] tracking-widest border border-transparent px-2.5 py-1.5 rounded transition cursor-pointer"
                          >
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
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-slate-200 rounded p-5 shadow-sm gap-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-[18px]">Course Deliveries & Releasing</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Deploy lesson versions to courses or section rosters. Configure custom availability dates to automatically enforce open/due boundaries.
                  </p>
                </div>
                {!showAssignmentForm && (
                  <button
                    onClick={() => {
                      const published = lessons.filter(l => l.isPublished);
                      if (published.length === 0) {
                        setAsgError("You need to publish at least one lesson before creating an assignment delivery.");
                      } else {
                        setAsgError("");
                        setAsgLessonId(published[0].id);
                      }
                      setShowAssignmentForm(true);
                    }}
                    className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm tracking-wider uppercase shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Assign Lesson
                  </button>
                )}
              </div>

              {showAssignmentForm && (
                <form onSubmit={handleCreateAssignmentSubmit} className="bg-white border border-slate-200 rounded p-6 shadow-sm space-y-4 max-w-2xl">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">New Lesson Assignment Setup</h4>
                    <button
                      type="button"
                      onClick={() => setShowAssignmentForm(false)}
                      className="text-xs text-slate-400 hover:text-slate-600 font-bold uppercase"
                    >
                      Cancel
                    </button>
                  </div>

                  {asgError && (
                    <div className="bg-red-50 text-red-700 text-xs p-3 rounded flex items-center gap-2 border border-red-100">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                      <span>{asgError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Select Lesson *</label>
                      <select
                        value={asgLessonId}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAsgLessonId(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                      >
                        <option value="">-- Choose Published Lesson --</option>
                        {lessons.filter(l => l.isPublished).map(l => (
                          <option key={l.id} value={l.id}>{l.title}</option>
                        ))}
                      </select>
                      {lessons.filter(l => l.isPublished).length === 0 && (
                        <p className="text-[10px] text-red-500 mt-1">No published lessons found. Please publish a lesson plan first.</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Course ID / Code *</label>
                      <input
                        type="text"
                        value={asgCourseId}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgCourseId(e.target.value)}
                        placeholder="e.g. VERITAS 101"
                        className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Roster Section</label>
                      <input
                        type="text"
                        value={asgSection}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgSection(e.target.value)}
                        placeholder="e.g. Section A"
                        className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Opens At *</label>
                      <input
                        type="datetime-local"
                        value={asgOpensAt}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgOpensAt(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Due At *</label>
                      <input
                        type="datetime-local"
                        value={asgDueAt}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgDueAt(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Closes At *</label>
                      <input
                        type="datetime-local"
                        value={asgClosesAt}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsgClosesAt(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-slate-400"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-slate-100">
                    <button
                      type="submit"
                      disabled={lessons.filter(l => l.isPublished).length === 0}
                      className="bg-[#0A192F] hover:bg-[#15294b] disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold px-5 py-2.5 rounded shadow-sm tracking-wide uppercase transition cursor-pointer"
                    >
                      Publish Assignment
                    </button>
                  </div>
                </form>
              )}

              {/* Assignments list table */}
              <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200">
                  <h4 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Assignments ({assignments.length})</h4>
                </div>

                {assignments.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
                    <Calendar className="w-10 h-10 text-slate-300 mb-2" />
                    <p className="text-xs font-bold text-slate-600">No active assignments configured.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Click "Assign Lesson" to release a lesson plan version to a student course section.</p>
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
                        {assignments.map((asg) => {
                          const now = new Date().toISOString();
                          const opens = asg.opensAt || "";
                          const closes = asg.closesAt || "";
                          let statusNode = null;

                          if (now < opens) {
                            statusNode = (
                              <span className="bg-blue-50 text-blue-700 border border-blue-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase tracking-wide">
                                Scheduled
                              </span>
                            );
                          } else if (now >= opens && now <= closes) {
                            statusNode = (
                              <span className="bg-green-50 text-green-700 border border-green-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase tracking-wide">
                                Open & Active
                              </span>
                            );
                          } else {
                            statusNode = (
                              <span className="bg-red-50 text-red-700 border border-red-100 font-bold px-2 py-0.5 rounded text-[9px] uppercase tracking-wide">
                                Closed
                              </span>
                            );
                          }

                          return (
                            <tr key={asg.id} className="hover:bg-slate-50/50">
                              <td className="p-3">
                                <span className="font-bold text-slate-800">{asg.courseId}</span>
                                {asg.section && <span className="text-slate-400 ml-1.5">• {asg.section}</span>}
                              </td>
                              <td className="p-3 font-semibold text-slate-800">{asg.lessonTitle || "Untitled Lesson"}</td>
                              <td className="p-3 text-[11px] text-slate-500">{new Date(opens).toLocaleString()}</td>
                              <td className="p-3 text-[11px] text-slate-500 font-semibold">{new Date(asg.dueAt).toLocaleString()}</td>
                              <td className="p-3 text-[11px] text-slate-500">{new Date(closes).toLocaleString()}</td>
                              <td className="p-3 text-center">{statusNode}</td>
                              <td className="p-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => onDeleteAssignment && onDeleteAssignment(asg.id)}
                                  className="text-red-600 hover:text-red-800 font-bold uppercase text-[9px] tracking-widest px-2.5 py-1 rounded hover:bg-red-50 transition cursor-pointer"
                                >
                                  Recall Delivery
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
          )}
        </div>
      ) : (
        // Designer workspace
        <div className="space-y-6">
          {/* Sticky Header Controls for quick curriculum management */}
          <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-md border-b border-slate-200 pb-4 mb-4 pt-2 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-800 tracking-tight flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#0A192F]" /> Lesson Design Canvas
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Combine core blocks and publish assessments for student access.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 self-stretch sm:self-auto items-center">
              {/* Reset/Back button */}
              <button
                onClick={() => setSelectedLesson(null)}
                className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold px-2.5 py-2 rounded transition cursor-pointer shadow-sm"
              >
                ← Library
              </button>

              {/* Save Draft button */}
              <button
                onClick={handleSaveAsDraft}
                className="bg-slate-600 hover:bg-slate-700 text-white text-xs font-bold px-2.5 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                title="Saves this lesson draft"
              >
                <Save className="w-3.5 h-3.5" /> Save Draft
              </button>

              {/* Publish Live button */}
              <button
                onClick={handlePublishLive}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                title="Validates, publishes to students, and saves progress"
              >
                Publish Live
              </button>

              {/* Assign & Launch block */}
              <button
                onClick={handleAssignAndLaunch}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-2.5 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                title="Saves lesson progress and opens assignment setup form"
              >
                <Calendar className="w-3.5 h-3.5" /> Assign & Launch
              </button>

              {/* Preview as Student */}
              {selectedLesson.id !== "new" ? (
                <button
                  type="button"
                  onClick={() => onLaunchPreviewAttempt && onLaunchPreviewAttempt(selectedLesson.id)}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-2.5 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                  title="Preview the student experience — teacher-only fields are hidden"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview as Student
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="bg-slate-100 text-slate-400 border border-slate-200 text-xs font-bold px-2.5 py-2 rounded flex items-center gap-1.5 cursor-not-allowed"
                  title="Save the lesson first to enable student preview"
                >
                  Preview (save first)
                </button>
              )}
            </div>
          </div>

          {saveError && saveError.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> Cannot publish — fix these questions:
              </div>
              {saveError.map((e: string, i: number) => (
                <div key={i} className="pl-5">• {e}</div>
              ))}
              <div className="pl-5 text-[11px] text-red-500">Tip: uncheck "Mark Published" to save as a draft.</div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Hand: Sticky configurations panel */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4 lg:sticky lg:top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#0A192F] font-mono mb-2 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Settings className="w-4 h-4 text-[#0A192F]" /> Metadata & Configurations
              </h4>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Lesson Title</label>
                  <input 
                    type="text" 
                    value={title}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-800 font-medium"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Lesson Overview</label>
                  <RichContentEditor
                    value={description}
                    onChange={(val: any) => setDescription(val.html)}
                    mode="compact"
                    placeholder="Enter lesson description..."
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Estimated Minutes Profile</label>
                  <input 
                    type="number" 
                    value={estimatedMinutes}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEstimatedMinutes(Number(e.target.value))}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-800"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-2.5">
                  <span className="font-bold text-slate-700 block mb-1">Delivery Rules</span>

                  <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                    <input type="checkbox" checked={restrictSeeking} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRestrictSeeking(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Restrict video seeking — students cannot skip ahead
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                    <input type="checkbox" checked={requireFullscreen} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRequireFullscreen(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Require fullscreen focus — log and enforce focus monitoring
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                    <input type="checkbox" checked={allowRetakes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllowRetakes(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Allow retakes after completion
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer text-[11px] hover:text-slate-900 transition">
                    <input type="checkbox" checked={randomizeChoices} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRandomizeChoices(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Randomize answer choices per student
                  </label>

                  <div className="bg-slate-50 border border-slate-205 rounded p-3 mt-1.5 space-y-1.5">
                    <label className="flex items-start gap-2 font-semibold text-slate-800 cursor-pointer text-[12px] hover:text-slate-900 transition">
                      <input type="checkbox" checked={isPublished} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsPublished(e.target.checked)} className="focus:ring-0 rounded-sm mt-0.5" />
                      <div>
                        <span>Published — make assignable</span>
                        <p className="text-[10px] font-normal text-slate-500 mt-0.5 leading-relaxed">
                          Once published, this lesson can be assigned to students. Drafts are hidden from all student portals.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Publish Readiness Panel */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-800 font-sans">Publish Readiness</span>
                  </div>

                  {(() => {
                    // Compute readiness checks
                    const issues: string[] = [];
                    let gradedQCount = 0;
                    let practiceQCount = 0;
                    let videoCount = 0;
                    let readingCount = 0;

                    if (!title.trim()) issues.push("Lesson title is required.");
                    if (currentBlocks.length === 0) issues.push("Add at least one block.");

                    currentBlocks.forEach((b: any, i: number) => {
                      if (!b.title?.trim()) issues.push(`Block ${i + 1}: title is missing.`);
                      if (b.type === "video") {
                        videoCount++;
                        if (!b.videoUrl && !b.storagePath) issues.push(`Block ${i + 1}: no video source.`);
                        const cps: any[] = b.videoCheckpoints || [];
                        cps.forEach((cp: any, ci: number) => {
                          const q = cp.questions?.[0];
                          if (!cp.isPractice) {
                            gradedQCount++;
                            if (q?.type === "mc") {
                              if (!q.correctChoiceId) issues.push(`Block ${i + 1} checkpoint ${ci + 1}: no correct answer selected.`);
                              const nonBlank = (q.choices || []).filter((c: any) => c.text?.toString().trim());
                              if (nonBlank.length < 2) issues.push(`Block ${i + 1} checkpoint ${ci + 1}: need at least 2 choices.`);
                            }
                          } else {
                            practiceQCount++;
                          }
                        });
                      } else if (b.type === "reading") {
                        readingCount++;
                        const hasContent = typeof b.content === "string"
                          ? b.content.trim().length > 0
                          : !!(b.content?.plainText || b.content?.html);
                        if (!hasContent) issues.push(`Block ${i + 1}: reading content is empty.`);
                      } else if (b.type === "question" && b.singleQuestion) {
                        if (!b.isPractice) {
                          gradedQCount++;
                          const q = b.singleQuestion;
                          if (q.type === "mc") {
                            if (!q.correctChoiceId) issues.push(`Block ${i + 1}: no correct answer selected.`);
                            const nonBlank = (q.choices || []).filter((c: any) => c.text?.toString().trim());
                            if (nonBlank.length < 2) issues.push(`Block ${i + 1}: need at least 2 answer choices.`);
                          } else if (q.type === "sa") {
                            if (!(q.rubricCategories?.length >= 1)) issues.push(`Block ${i + 1}: add a rubric category for grading.`);
                          }
                        } else {
                          practiceQCount++;
                        }
                      }
                    });

                    const canPublish = issues.length === 0;

                    return (
                      <div className={`rounded-lg border p-3 text-[11px] space-y-3 ${canPublish ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
                        {/* Summary counts */}
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="bg-white border border-slate-200 rounded p-2 text-center">
                            <div className="font-bold text-slate-800 text-base">{currentBlocks.length}</div>
                            <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Total blocks</div>
                          </div>
                          <div className="bg-white border border-slate-200 rounded p-2 text-center">
                            <div className="font-bold text-slate-800 text-base">{gradedQCount}</div>
                            <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Graded questions</div>
                          </div>
                          {practiceQCount > 0 && (
                            <div className="bg-white border border-slate-200 rounded p-2 text-center">
                              <div className="font-bold text-slate-800 text-base">{practiceQCount}</div>
                              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Practice checks</div>
                            </div>
                          )}
                          {videoCount > 0 && (
                            <div className="bg-white border border-slate-200 rounded p-2 text-center">
                              <div className="font-bold text-slate-800 text-base">{videoCount}</div>
                              <div className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">Video blocks</div>
                            </div>
                          )}
                        </div>

                        {/* Publish status */}
                        <div className={`rounded p-2 flex items-center gap-2 ${canPublish ? "bg-emerald-100/60 text-emerald-800" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                          {canPublish ? (
                            <>
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="text-[11px] font-bold">Ready to publish</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              <span className="text-[11px] font-bold">{issues.length} issue{issues.length !== 1 ? "s" : ""} to fix</span>
                            </>
                          )}
                        </div>

                        {/* Issues list */}
                        {issues.length > 0 && (
                          <ul className="space-y-1">
                            {issues.map((issue, i) => (
                              <li key={i} className="text-[10px] text-rose-700 flex items-start gap-1.5">
                                <span className="shrink-0 mt-0.5">•</span>
                                <span>{issue}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Student preview note */}
                        <div className="border-t border-slate-200 pt-2 text-[10px] text-slate-500">
                          <strong className="text-slate-600">Student Preview</strong> hides all teacher-only fields (answer keys, rubrics, AI guidance). Use it to confirm the student experience before assigning.
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Student sequence map */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-600 block">Student Sequence</span>
                  {currentBlocks.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">No blocks yet.</p>
                  ) : (
                    <div className="space-y-1 border-l-2 border-slate-200 pl-3">
                      {currentBlocks.map((b: any, idx: number) => {
                        let typeLabel = "";
                        let labelCls = "text-slate-500";
                        if (b.type === "video") { typeLabel = "Video"; labelCls = "text-blue-600"; }
                        else if (b.type === "reading") { typeLabel = "Reading"; labelCls = "text-purple-600"; }
                        else if (b.type === "question") {
                          typeLabel = b.isPractice ? "Practice check" : "Graded question";
                          labelCls = b.isPractice ? "text-amber-600" : "text-emerald-700";
                        }
                        return (
                          <div
                            key={b.id}
                            onClick={() => setExpandedBlocks((prev: Record<string, boolean>) => ({ ...prev, [b.id]: true }))}
                            className="flex items-start gap-1.5 cursor-pointer hover:bg-slate-50 rounded p-0.5 transition"
                          >
                            <span className="font-mono text-[9px] text-slate-400 shrink-0 mt-0.5">#{idx + 1}</span>
                            <div className="min-w-0">
                              <span className="text-[11px] font-semibold text-slate-700 block truncate">{b.title || `Untitled ${b.type}`}</span>
                              <span className={`text-[9px] font-bold uppercase tracking-wide ${labelCls}`}>{typeLabel}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Hand: Interactive blocks composer */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center bg-white border border-slate-200 p-4 rounded-lg shadow-sm">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Assigned Lesson Blocks sequence</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Click a segment's header to expand or collapse details.</p>
                </div>
                <div className="flex gap-1.5 text-[9px] font-bold">
                  <button onClick={() => handleAddBlock("video")} className="text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded hover:bg-blue-100 transition cursor-pointer uppercase font-mono tracking-wider shadow-sm">+ Video</button>
                  <button onClick={() => handleAddBlock("reading")} className="text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded hover:bg-purple-100 transition cursor-pointer uppercase font-mono tracking-wider shadow-sm">+ Passage</button>
                  <button onClick={() => handleAddBlock("question")} className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded hover:bg-emerald-100 transition cursor-pointer uppercase font-mono tracking-wider shadow-sm">+ Assess</button>
                </div>
              </div>

              {currentBlocks.length === 0 ? (
                <div className="text-center py-16 bg-white border border-slate-200 rounded-lg text-slate-400 text-xs">
                  Create sequential structures using block selectors above.
                </div>
              ) : (
                <div className="space-y-4">
                  {currentBlocks.map((block: any, index: number) => {
                    const isExpanded = expandedBlocks[block.id] !== false;
                    const numCps = Array.isArray(block.videoCheckpoints) ? block.videoCheckpoints.length : 0;
                    
                    // Build status metadata indicator
                    let statusLabel = "";
                    let statusColor = "";
                    let IconComp = FileText;
                    let iconColor = "text-purple-600";
                    let accentBorder = "border-l-4 border-l-purple-500";
                    
                    if (block.type === "video") {
                      IconComp = Video;
                      iconColor = "text-blue-600";
                      accentBorder = "border-l-4 border-l-blue-500";
                      if (block.videoUrl || block.storagePath) {
                        statusLabel = `${numCps} Checkpoint${numCps !== 1 ? "s" : ""}`;
                        statusColor = "bg-blue-50 text-blue-700 border-blue-100";
                      } else {
                        statusLabel = "Needs Video Upload";
                        statusColor = "bg-amber-50 text-amber-700 border-amber-100 font-bold";
                      }
                    } else if (block.type === "reading") {
                      IconComp = FileText;
                      iconColor = "text-purple-600";
                      accentBorder = "border-l-4 border-l-purple-500";
                      const hasContent = typeof block.content === "string" 
                        ? block.content.trim().length > 0 
                        : (block.content && (block.content.plainText || block.content.html || "").trim().length > 0);
                      if (hasContent) {
                        statusLabel = "Reading Active";
                        statusColor = "bg-purple-50 text-purple-700 border-purple-100";
                      } else {
                        statusLabel = "Empty Passage";
                        statusColor = "bg-amber-50 text-amber-700 border-amber-100 font-bold";
                      }
                    } else if (block.type === "question") {
                      IconComp = FileText;
                      iconColor = "text-emerald-700";
                      accentBorder = "border-l-4 border-l-emerald-500";
                      statusLabel = `${block.isPractice ? "Practice" : "Graded"} • ${block.singleQuestion?.points || 5} Points`;
                      statusColor = block.isPractice ? "bg-cyan-50 text-cyan-700 border-cyan-100" : "bg-emerald-50 text-emerald-700 border-emerald-100";
                    }

                    return (
                      <div 
                        key={block.id} 
                        className={`bg-white border text-slate-800 border-slate-200 rounded-lg overflow-hidden shadow-sm transition-all duration-200 ${accentBorder} ${!isExpanded ? "hover:shadow-md" : ""}`}
                      >
                        {/* block header with expansion trigger and sorting controls */}
                        <div className="bg-slate-50/80 hover:bg-slate-50 border-b border-slate-200 px-4 sm:px-5 py-3 flex justify-between items-center text-xs select-none">
                          
                          {/* Left clickable element structure */}
                          <div 
                            onClick={() => toggleBlockExpanded(block.id)}
                            className="flex items-center gap-2 sm:gap-3 font-semibold text-slate-700 cursor-pointer flex-1 py-1"
                          >
                            <span className="text-slate-400 font-mono text-[10px]">#{index + 1}</span>
                            <IconComp className={`w-4 h-4 ${iconColor} shrink-0`} />
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                              <span className="font-bold text-slate-800 text-xs sm:text-sm">{block.title || `Untitled ${block.type}`}</span>
                              <span className="text-[9px] uppercase font-bold text-slate-400 font-mono hidden sm:inline">• {block.type}</span>
                            </div>
                            {statusLabel && (
                              <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded-full border ${statusColor} ml-2 hidden sm:inline-block`}>
                                {statusLabel}
                              </span>
                            )}
                          </div>

                          {/* Right: Actions (Move up/down, Collapse arrow, Permanent Delete) */}
                          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => moveBlock(index, "up")}
                              title="Move segment up"
                              className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-200/60 disabled:opacity-30 transition cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === currentBlocks.length - 1}
                              onClick={() => moveBlock(index, "down")}
                              title="Move segment down"
                              className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-200/60 disabled:opacity-30 transition cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>

                            <div className="w-px h-4 bg-slate-200 mx-1"></div>

                            <button
                              type="button"
                              onClick={() => toggleBlockExpanded(block.id)}
                              title={isExpanded ? "Collapse block info" : "Expand block info"}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-200/60 transition cursor-pointer"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            <button 
                              type="button"
                              onClick={() => handleDeleteBlock(index)}
                              title="Permanent Delete Block"
                              className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded transition cursor-pointer ml-1"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Student Experience Info Box - always visible for immediate structural insight */}
                        <div className="bg-slate-50/40 px-4 sm:px-5 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
                          <div className="flex items-center gap-1.5 min-w-[200px]">
                            <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider shrink-0">Student Action:</span>
                            <span className="font-medium text-slate-700 text-[10.5px]">
                              {block.type === "video" && "Watch video content with checkpoints."}
                              {block.type === "reading" && "Read and acknowledge the passage below."}
                              {block.type === "question" && `Submit ${block.isPractice ? "Practice" : "Graded"} answer (${block.singleQuestion?.points || 5} pts).`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider shrink-0">Rule / Gate:</span>
                            <span className="bg-white px-2 py-0.5 rounded border border-slate-200/85 text-slate-700 font-bold font-mono text-[9px]">
                              {block.type === "video" && (restrictSeeking ? "Seeking Blocked" : "Open Seeking")}
                              {block.type === "reading" && "Acknowledgement Required"}
                              {block.type === "question" && (block.isPractice ? "Immediate Feedback" : "Sanitized / Hidden Keys")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 font-medium">
                              Live Preview Support
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleBlockExpanded(block.id)}
                              className="text-[10px] text-blue-700 font-bold uppercase tracking-wide hover:underline cursor-pointer"
                            >
                              {isExpanded ? "Close Config" : "Edit Config"}
                            </button>
                          </div>
                        </div>

                        {/* Collapsible details viewport */}
                        {isExpanded && (
                          <div className="p-4 sm:p-5 space-y-4 text-xs">
                            <div>
                              <label className="font-bold text-slate-700 block mb-1">Block Title Label</label>
                              <input 
                                type="text" 
                                value={block.title}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleBlockChange(index, "title", e.target.value)}
                                className="w-full bg-slate-50/50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-800 font-medium"
                              />
                            </div>

                            {block.type === "video" && (
                              <div className="space-y-3">
                                <label className="font-bold text-slate-700 block mb-1">Video Lesson Material</label>
                                
                                {/* Drag & Drop with manual selection Click uploader built on top of secure backend uploads directory */}
                                <VideoUploader 
                                  videoUrl={block.videoUrl}
                                  thumbnailUrl={block.thumbnailUrl}
                                  storagePath={block.storagePath}
                                  duration={block.duration}
                                  onVideoUploaded={(url, thumbnail, duration, storagePath) => {
                                    handleBlockMultipleChanges(index, {
                                      videoUrl: url,
                                      thumbnailUrl: thumbnail || "",
                                      duration: duration || 0,
                                      storagePath: storagePath || ""
                                    });
                                  }}
                                />

                                {!block.videoUrl && (
                                  <>
                                    {block.storagePath && (
                                      <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex items-center justify-between text-xs font-mono">
                                        <span className="text-slate-500 font-bold">Firebase Storage Reference:</span>
                                        <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{block.storagePath}</span>
                                      </div>
                                    )}

                                    <div className="pt-2 border-t border-slate-100">
                                      <label className="font-semibold text-slate-600 block mb-1">Direct Video URL Link (Backup/Manual Override)</label>
                                      <input 
                                        type="text" 
                                        value={block.videoUrl || ""}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleBlockChange(index, "videoUrl", e.target.value)}
                                        placeholder="https://example.com/video.mp4"
                                        className="w-full bg-slate-50/50 border border-slate-200 rounded px-3 py-1.5 font-mono text-[11px] focus:outline-none focus:border-slate-400"
                                      />
                                      <p className="text-[10px] text-slate-400 mt-1">
                                        The upload area above stores files securely on Google Cloud infrastructure. You can also paste existing web-hosted MP4 links.
                                      </p>
                                    </div>
                                  </>
                                )}

                                {/* Video checkpoint authoring */}
                                <div className="pt-3 border-t border-slate-100 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <label className="font-bold text-slate-700 flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5 text-blue-600" /> Video Checkpoints
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => addCheckpoint(index)}
                                      className="text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100 flex items-center gap-1"
                                    >
                                      <Plus className="w-3 h-3" /> Add Checkpoint
                                    </button>
                                  </div>

                                  {(block.videoCheckpoints || []).map((cp: any) => (
                                    <div key={cp.id} className="border border-slate-200 rounded bg-slate-50/60 p-3 space-y-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <input
                                          type="text"
                                          value={cp.title || ""}
                                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCheckpoint(index, cp.id, { title: e.target.value })}
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
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCheckpoint(index, cp.id, { timestamp: Number(e.target.value) })}
                                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-slate-400"
                                          />
                                        </div>
                                        <div>
                                          <label className="font-semibold text-slate-600 block mb-1">Question Type</label>
                                          <select
                                            value={cp.questionType || "mc"}
                                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                              const t = e.target.value as "mc" | "sa";
                                              const existing = (cp.questions && cp.questions[0]) || newQuestionTemplate(t);
                                              const q = { ...existing, type: t };
                                              if (t === "mc" && !Array.isArray(q.choices)) {
                                                const fresh = newQuestionTemplate("mc");
                                                q.choices = fresh.choices;
                                                q.correctChoiceId = fresh.correctChoiceId;
                                              }
                                              if (t === "sa" && !Array.isArray(q.rubricCategories)) q.rubricCategories = [];
                                              updateCheckpoint(index, cp.id, { questionType: t, questions: [q] });
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
                                          <input type="checkbox" checked={!!cp.isRequired} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCheckpoint(index, cp.id, { isRequired: e.target.checked })} />
                                          Required (blocks progress)
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                          <input type="checkbox" checked={!!cp.pauseVideo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCheckpoint(index, cp.id, { pauseVideo: e.target.checked })} />
                                          Pause video
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                          <input type="checkbox" checked={!!cp.isPractice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCheckpoint(index, cp.id, { isPractice: e.target.checked })} />
                                          Practice (reveals feedback)
                                        </label>
                                      </div>

                                      <QuestionEditor
                                        question={(cp.questions && cp.questions[0]) || newQuestionTemplate(cp.questionType || "mc")}
                                        type={(cp.questionType || "mc") as "mc" | "sa"}
                                        graded={!cp.isPractice}
                                        onChange={(uq) => updateCheckpointQuestion(index, cp.id, uq)}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {block.type === "reading" && (
                              <div>
                                <label className="font-bold text-slate-700 block mb-1">Instructional Reading Passage Content</label>
                                <RichContentEditor
                                  value={block.content || ""}
                                  onChange={(val: any) => handleBlockChange(index, "content", val)}
                                  mode="full"
                                />
                              </div>
                            )}

                            {block.type === "question" && (
                              <div className="space-y-3">
                                <span className="font-bold text-slate-700 block uppercase tracking-wide text-[10px] border-b border-slate-100 pb-1">Assessment Settings</span>

                                <div className="grid grid-cols-2 gap-3 font-medium">
                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-1">Question Type</label>
                                    <select
                                      value={block.questionType || "mc"}
                                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                        const t = e.target.value as "mc" | "sa";
                                        handleBlockChange(index, "questionType", t);
                                        const existing = block.singleQuestion || newQuestionTemplate(t);
                                        const sq = { ...existing, type: t };
                                        if (t === "mc" && !Array.isArray(sq.choices)) {
                                          const fresh = newQuestionTemplate("mc");
                                          sq.choices = fresh.choices;
                                          sq.correctChoiceId = fresh.correctChoiceId;
                                        }
                                        if (t === "sa" && !Array.isArray(sq.rubricCategories)) {
                                          sq.rubricCategories = [];
                                        }
                                        handleBlockChange(index, "singleQuestion", sq);
                                      }}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 focus:outline-none"
                                    >
                                      <option value="mc">Multiple Choice (Auto-Graded)</option>
                                      <option value="sa">Short Answer (Rubric / AI Graded)</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-1">Practice Mode vs Graded</label>
                                    <select
                                      value={block.isPractice ? "true" : "false"}
                                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleBlockChange(index, "isPractice", e.target.value === "true")}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 focus:outline-none"
                                    >
                                      <option value="false">Graded Assessment (Keeps answers secret)</option>
                                      <option value="true">Practice Review (Reveals feedback instantly)</option>
                                    </select>
                                  </div>
                                </div>

                                <QuestionEditor
                                  question={block.singleQuestion || newQuestionTemplate(block.questionType || "mc")}
                                  type={(block.questionType || "mc") as "mc" | "sa"}
                                  graded={!block.isPractice}
                                  onChange={(uq) => handleBlockChange(index, "singleQuestion", uq)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

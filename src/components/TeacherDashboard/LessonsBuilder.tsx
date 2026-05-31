import { useState } from "react";
import { Plus, Trash, Settings, Save, AlertCircle, FileText, Video, Clock } from "lucide-react";
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
}

export default function LessonsBuilder({ lessons, blocks, onSaveLesson, onArchived }: LessonsBuilderProps) {
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

  // Active designer blocks
  const [currentBlocks, setCurrentBlocks] = useState<any[]>([]);

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
  };

  const startNewLesson = () => {
    setSelectedLesson({ id: "new" });
    setTitle("New APUSH Assessment Lesson");
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
        title: "Lecture Video",
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        videoCheckpoints: []
      }
    ]);
  };

  const handleAddBlock = (type: "video" | "reading" | "question") => {
    const newBlock = {
      id: "b_" + Math.random().toString(36).substring(2, 9),
      type,
      title: type === "video" ? "New Lecture Video" : type === "reading" ? "Documentary Source Reading" : "Multiple Choice Assessment",
      videoUrl: type === "video" ? "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" : undefined,
      content: type === "reading" ? "### Historical Context\nEnter passage context here." : undefined,
      questionType: type === "question" ? "mc" : undefined,
      isPractice: type === "question" ? false : undefined,
      singleQuestion: type === "question" ? newQuestionTemplate("mc") : undefined
    };
    setCurrentBlocks([...currentBlocks, newBlock]);
  };

  const handleDeleteBlock = (index: number) => {
    setCurrentBlocks(currentBlocks.filter((_, idx) => idx !== index));
  };

  const handleBlockChange = (index: number, key: string, val: any) => {
    const updated = [...currentBlocks];
    updated[index] = { ...updated[index], [key]: val };
    setCurrentBlocks(updated);
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

  const handleSave = async () => {
    setSaveError(null);

    // Published lessons must contain valid graded questions (client gate; server re-validates).
    if (isPublished) {
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
        return;
      }
    }

    const payload = {
      id: selectedLesson.id === "new" ? undefined : selectedLesson.id,
      title,
      description,
      estimatedMinutes,
      isPublished,
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
  };

  return (
    <div className="space-y-6 font-sans">
      {!selectedLesson ? (
        // Standard listings
        <div className="space-y-6">
          <div className="flex justify-end mb-4">
            <button
              onClick={startNewLesson}
              className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded flex items-center gap-1.5 transition cursor-pointer shadow-sm tracking-wider uppercase"
            >
              <Plus className="w-4 h-4" /> Create Lesson Plan
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lessons.map((lesson) => (
              <div 
                key={lesson.id}
                className="bg-white border text-slate-850 border-slate-200 p-5 rounded shadow-sm hover:border-slate-300 transition flex flex-col justify-between min-h-[160px]"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="text-sm font-bold text-slate-850 tracking-tight">{lesson.title}</h3>
                    <span className={`text-[8px] font-bold font-mono uppercase tracking-widest px-2 py-0.5 rounded-sm border ${
                      lesson.isPublished ? "bg-green-50 text-green-700 border-green-100":"bg-slate-100 text-slate-500 border-slate-200"
                    }`}>
                      {lesson.isPublished ? "Published":"Draft"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                    {typeof lesson.description === "object"
                      ? (lesson.description.plainText || (lesson.description.html ? lesson.description.html.replace(/<[^>]*>/g, "") : ""))
                      : (lesson.description || "No description provided.")}
                  </p>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4 flex justify-between items-center text-[10px] text-slate-400 font-semibold">
                  <div className="flex gap-3 uppercase tracking-wide">
                    <span className="font-mono text-slate-500 text-[9px]">MIN: {lesson.estimatedMinutes}m</span>
                    <span>•</span>
                    <span className="text-slate-500 text-[9px]">RESTRICT SEEK: {lesson.settings.restrictSeeking ? "YES":"NO"}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditing(lesson)}
                      className="text-slate-700 hover:text-[#0A192F] font-bold uppercase text-[9px] tracking-widest border border-slate-200 px-2.5 py-1 rounded hover:bg-slate-50 transition cursor-pointer shadow-sm"
                    >
                      Configure / Design
                    </button>
                    <button
                      onClick={() => onArchived(lesson.id)}
                      className="text-red-700 hover:text-red-800 font-bold uppercase text-[9px] tracking-widest border border-transparent px-2.5 py-1 rounded hover:bg-red-50 transition cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // Designer workspace
        <div className="space-y-6">
          <div className="border-b border-slate-200 pb-4 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-slate-800 tracking-tight">Lesson Design Canvas</h3>
              <p className="text-xs text-slate-500 mt-0.5">Stitch together core blocks and publish assessments for student access.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedLesson(null)}
                className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold px-4 py-2 rounded transition cursor-pointer"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                className="bg-[#0A192F] hover:bg-[#15294b] text-white text-xs font-bold px-4 py-2 rounded flex items-center gap-2 transition cursor-pointer shadow-sm"
              >
                <Save className="w-4 h-4" /> Save Curriculum
              </button>
            </div>
          </div>

          {saveError && saveError.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> Cannot publish — fix these questions:
              </div>
              {saveError.map((e, i) => (
                <div key={i} className="pl-5">• {e}</div>
              ))}
              <div className="pl-5 text-[11px] text-red-500">Tip: uncheck "Mark Published" to save as a draft.</div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Hand: Config settings panel */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded p-5 shadow-sm space-y-4">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Settings className="w-4 h-4 text-slate-400" /> Lesson Metadata Configurations
              </h4>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-slate-550 text-slate-700 block mb-1">Assessment Sheet Title</label>
                  <input 
                    type="text" 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-850"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Educational Narrative description</label>
                  <RichContentEditor
                    value={description}
                    onChange={(val) => setDescription(val.html)}
                    mode="compact"
                    placeholder="Enter lesson description..."
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Estimated minutes work profile</label>
                  <input 
                    type="number" 
                    value={estimatedMinutes} 
                    onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 focus:outline-none focus:border-slate-400 text-slate-850"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <span className="font-bold text-slate-700 block mb-1">Platform Rules Controls</span>
                  
                  <label className="flex items-center gap-2 font-medium text-slate-650 cursor-pointer text-[11px]">
                    <input type="checkbox" checked={restrictSeeking} onChange={(e) => setRestrictSeeking(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Disable Forward Skip (Anti-Seeking Mode)
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-650 cursor-pointer text-[11px]">
                    <input type="checkbox" checked={requireFullscreen} onChange={(e) => setRequireFullscreen(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Enforce Focus Player & Tab blurs
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-650 cursor-pointer text-[11px]">
                    <input type="checkbox" checked={allowRetakes} onChange={(e) => setAllowRetakes(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Allow Assessment Retakes
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-650 cursor-pointer text-[11px]">
                    <input type="checkbox" checked={randomizeChoices} onChange={(e) => setRandomizeChoices(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Scramble Multiple-Choice Options
                  </label>

                  <label className="flex items-center gap-2 font-medium text-slate-650 cursor-pointer text-[11px]">
                    <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="focus:ring-0 rounded-sm" />
                    Mark Published & Live to AP Student roster
                  </label>
                </div>
              </div>
            </div>

            {/* Right Hand: Interactive blocks composer */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center bg-white border border-slate-200 p-3 rounded shadow-sm">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Assigned Lesson Blocks sequence</h4>
                <div className="flex gap-2 text-[9px] font-bold">
                  <button onClick={() => handleAddBlock("video")} className="text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded hover:bg-blue-100 transition cursor-pointer uppercase font-mono tracking-wider">+ Video</button>
                  <button onClick={() => handleAddBlock("reading")} className="text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded hover:bg-purple-100 transition cursor-pointer uppercase font-mono tracking-wider">+ Passage</button>
                  <button onClick={() => handleAddBlock("question")} className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded hover:bg-emerald-100 transition cursor-pointer uppercase font-mono tracking-wider">+ Assess</button>
                </div>
              </div>

              {currentBlocks.length === 0 ? (
                <div className="text-center py-12 bg-white border border-slate-200 rounded text-slate-400 text-xs">
                  Create sequential structures using block selectors above.
                </div>
              ) : (
                <div className="space-y-4">
                  {currentBlocks.map((block, index) => (
                    <div 
                      key={block.id} 
                      className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm"
                    >
                      {/* block header */}
                      <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex justify-between items-center text-xs">
                        <div className="flex items-center gap-2 font-bold text-slate-700">
                          {block.type === "video" ? <Video className="w-4 h-4 text-blue-600 shrink-0" /> : <FileText className="w-4 h-4 text-purple-600 shrink-0" />}
                          Segment #{index + 1}: {block.type.toUpperCase()}
                        </div>
                        <button 
                          onClick={() => handleDeleteBlock(index)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition cursor-pointer"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* block content fields */}
                      <div className="p-4 space-y-3 text-xs">
                        <div>
                          <label className="font-bold text-slate-700 block mb-1">Block Title Label</label>
                          <input 
                            type="text" 
                            value={block.title} 
                            onChange={(e) => handleBlockChange(index, "title", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1 focus:outline-none focus:border-slate-400"
                          />
                        </div>

                        {block.type === "video" && (
                          <div className="space-y-3">
                            <label className="font-bold text-slate-700 block mb-1">Lecture Video Material (Upload or URL)</label>
                            
                            {/* Drag & Drop with manual selection Click uploader built on top of secure backend uploads directory */}
                            <VideoUploader 
                              videoUrl={block.videoUrl}
                              thumbnailUrl={block.thumbnailUrl}
                              onVideoUploaded={(url, thumbnail) => {
                                handleBlockChange(index, "videoUrl", url);
                                if (thumbnail !== undefined) {
                                  handleBlockChange(index, "thumbnailUrl", thumbnail);
                                }
                              }}
                            />

                            <div className="pt-2 border-t border-slate-100">
                              <label className="font-semibold text-slate-600 block mb-1">Direct Video URL Link (Backup/Manual Override)</label>
                              <input 
                                type="text" 
                                value={block.videoUrl || ""} 
                                onChange={(e) => handleBlockChange(index, "videoUrl", e.target.value)}
                                placeholder="https://example.com/lecture.mp4"
                                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1 font-mono text-[11px] focus:outline-none focus:border-slate-400"
                              />
                              <p className="text-[10px] text-slate-400 mt-1">
                                The upload area above stores files securely on Google Cloud infrastructure. You can also paste existing web-hosted MP4 links.
                              </p>
                            </div>

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
                                      onChange={(e) => updateCheckpoint(index, cp.id, { title: e.target.value })}
                                      placeholder="Checkpoint title"
                                      className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-slate-400"
                                    />
                                    <button type="button" onClick={() => deleteCheckpoint(index, cp.id)} className="p-1 text-red-400 hover:text-red-600">
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
                                      <input type="checkbox" checked={!!cp.isRequired} onChange={(e) => updateCheckpoint(index, cp.id, { isRequired: e.target.checked })} />
                                      Required (blocks progress)
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                      <input type="checkbox" checked={!!cp.pauseVideo} onChange={(e) => updateCheckpoint(index, cp.id, { pauseVideo: e.target.checked })} />
                                      Pause video
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                      <input type="checkbox" checked={!!cp.isPractice} onChange={(e) => updateCheckpoint(index, cp.id, { isPractice: e.target.checked })} />
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
                              onChange={(val) => handleBlockChange(index, "content", val)}
                              mode="full"
                            />
                          </div>
                        )}

                        {block.type === "question" && (
                          <div className="space-y-3">
                            <span className="font-bold text-slate-700 block uppercase tracking-wide text-[10px] border-b border-slate-100 pb-1">Assessment Settings</span>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="font-semibold text-slate-600 block mb-1">Question Type</label>
                                <select
                                  value={block.questionType || "mc"}
                                  onChange={(e) => {
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
                                  onChange={(e) => handleBlockChange(index, "isPractice", e.target.value === "true")}
                                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 focus:outline-none"
                                >
                                  <option value="false">Graded Assessment (Keeps answers fully secret)</option>
                                  <option value="true">Practice Review (Reveals explanation instantly)</option>
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
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

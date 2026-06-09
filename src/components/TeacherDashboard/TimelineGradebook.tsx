import { useState, useMemo, useRef, useEffect } from "react";
import { RichContentRenderer, getPlainText } from "../RichContent/RichContentRenderer";
import { safeScore, safeText } from "../../lib/dataIntegrity";
import {
  CheckSquare, HelpCircle, Minus, AlertCircle, Search, X, Eye, 
  Clock, RotateCcw, ThumbsUp, Video, FileText, LayoutList, 
  ShieldAlert, Activity, Filter, ChevronRight, MessageSquare,
  Bot, AlertTriangle, PlayCircle, LogOut, Maximize, MousePointerClick, Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTimelineAlignment } from "./useTimelineAlignment";

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

function getHighestCellMarker(markers: any[]) {
  if (!markers || markers.length === 0) return null;
  // AI agent use is the absolute highest priority cell marker
  const aiMarker = markers.find((m: any) => m.type === "ai_agent");
  if (aiMarker) return aiMarker;
  const highMarker = markers.find((m: any) => m.level === "high");
  if (highMarker) return highMarker;
  const modMarker = markers.find((m: any) => m.level === "moderate");
  if (modMarker) return modMarker;
  const lowMarker = markers.find((m: any) => m.level === "low" || m.level === "info");
  if (lowMarker) return lowMarker;
  return markers[0];
}

interface GradebookProps {
  students: any[];
  lessons: any[];
  attempts: any[];
  responses: any[];
  blocks?: any[];
  assignments?: any[];
  gradebookEntries?: any[];
  gradebookResponseEntries?: any[];
  signals?: any[];
  idToken?: string | null;
  onRefresh?: () => void;
  lessonVersions?: any[];
  initialAssignmentId?: string | null;
  onSelectedAssignmentChange?: (assignmentId: string | null) => void;
}

export default function TimelineGradebook({
  students,
  lessons,
  attempts,
  responses,
  blocks = [],
  assignments = [],
  gradebookEntries = [],
  gradebookResponseEntries = [],
  signals = [],
  idToken = null,
  onRefresh,
  lessonVersions = [],
  initialAssignmentId = null,
  onSelectedAssignmentChange
}: GradebookProps) {
  const [showPreviewAttempts, setShowPreviewAttempts] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // Assignment selection
  const assignmentOptions = useMemo(() => {
    return assignments.map(a => {
      const lesson = lessons.find(l => l.id === a.lessonId);
      return { ...a, lessonTitle: lesson?.title || "Unknown Lesson" };
    }).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [assignments, lessons]);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(() => {
    if (initialAssignmentId && assignmentOptions.some(a => a.id === initialAssignmentId)) {
      return initialAssignmentId;
    }
    return assignmentOptions.length > 0 ? assignmentOptions[0].id : null;
  });

  useEffect(() => {
    if (initialAssignmentId && assignmentOptions.some(a => a.id === initialAssignmentId)) {
      setSelectedAssignmentId(initialAssignmentId);
    }
  }, [initialAssignmentId, assignmentOptions]);

  const selectedAssignment = assignmentOptions.find(a => a.id === selectedAssignmentId);
  const selectedLessonId = selectedAssignment?.lessonId;

  const [selectedCell, setSelectedCell] = useState<{ studentId: string; stepId: string } | null>(null);

  // Mock student for preview
  let displayStudents = [...students];
  const hasPreviewAttempt = attempts.some((a) => a.isPreviewAttempt);
  if (showPreviewAttempts && hasPreviewAttempt) {
    const previewStudentIds = Array.from(new Set(attempts.filter((a) => a.isPreviewAttempt).map((a) => a.studentId)));
    previewStudentIds.forEach((pId) => {
      if (!displayStudents.some((s) => s.id === pId)) {
        displayStudents.push({
          id: pId,
          name: "Teacher Preview Student",
          email: "teacher-preview@veritas.placeholder",
          role: "student",
          isPreview: true
        });
      }
    });
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    displayStudents = displayStudents.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q)
    );
  }

  const filteredAttempts = showPreviewAttempts ? attempts : attempts.filter((a) => !a.isPreviewAttempt);
  const filteredResponses = showPreviewAttempts ? responses : responses.filter((r) => {
    const att = attempts.find((a) => a.id === r.attemptId);
    return att ? !att.isPreviewAttempt : true;
  });


  const { timelineSteps, timelineData, classComparison } = useTimelineAlignment({
    selectedLessonId,
    selectedAssignmentId,
    displayStudents,
    blocks,
    filteredAttempts,
    filteredResponses,
    signals,
    gradebookEntries,
    gradebookResponseEntries,
    assignments,
    lessonVersions,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: timelineData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64, // approximate row height px
    overscan: 5,
  });

  // Styling Helpers
  const getColorClasses = (color: string) => {
    switch (color) {
      case 'green': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'blue': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'amber': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'red': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'purple': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'slate': return 'bg-slate-100 text-slate-600 border-slate-300';
      case 'gray': return 'bg-slate-50 text-slate-400 border-slate-200 border-dashed';
      default: return 'bg-slate-50 text-slate-500 border-slate-200';
    }
  };

  const getStepIcon = (type: string) => {
    switch (type) {
      case 'video': return <Video className="w-3.5 h-3.5" />;
      case 'reading': return <FileText className="w-3.5 h-3.5" />;
      case 'checkpoint': return <HelpCircle className="w-3.5 h-3.5" />;
      default: return <MessageSquare className="w-3.5 h-3.5" />;
    }
  };

  const getSignalIcon = (severity: string) => {
    if (severity === 'high') return <AlertTriangle className="w-4 h-4 text-rose-500" />;
    if (severity === 'medium') return <ShieldAlert className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-blue-500" />;
  };

  const getSignalLabel = (type: string) => {
    if (type.includes('guard_marker') || type.includes('refusal_phrase') || type.includes('hidden_assessment')) return "AI Guard marker appeared in response";
    if (type.includes('fullscreen_exit')) return "Exited fullscreen";
    if (type.includes('visibility_hidden') || type.includes('blur') || type.includes('visibilitychange') || type.includes('tab_change') || type.includes('focus_lost')) return "Switched tabs";
    if (type.includes('video_seek')) return "Video seek attempt blocked";
    if (type.includes('copy')) return "Copied assessment text";
    if (type.includes('paste')) return "Pasted text";
    if (type.includes('multiple_monitors')) return "Multiple monitors detected";
    return "Activity recorded";
  };

  const renderConciseSummary = (row: any) => {
    if (!row.summary?.integrity) return null;
    const parts = [];
    if (row.summary.integrity.fullscreenSignalCount > 0) parts.push(`Fullscreen exits: ${row.summary.integrity.fullscreenSignalCount}`);
    if (row.summary.integrity.focusSignalCount > 0) parts.push(`Tab switches: ${row.summary.integrity.focusSignalCount}`);
    const pasteCount = row.overallSignals?.filter((s: any) => s.eventType?.includes('paste')).length || 0;
    if (pasteCount > 0) parts.push(`Paste attempts: ${pasteCount}`);
    const copyCount = row.overallSignals?.filter((s: any) => s.eventType?.includes('copy')).length || 0;
    if (copyCount > 0) parts.push(`Copy attempts: ${copyCount}`);
    if (row.summary.integrity.aiAgentSignalCount > 0) parts.push(`AI markers: ${row.summary.integrity.aiAgentSignalCount}`);
    const multiMonitor = row.overallSignals?.some((s: any) => s.eventType === 'multiple_monitors');
    if (multiMonitor) parts.push(`Multiple monitors detected`);

    if (parts.length === 0) return null;
    return <div className="text-[10px] text-slate-500 mt-1.5">{parts.join(', ')}</div>;
  };

  // Render Drawer
  const activeDrawerRow = selectedCell ? timelineData.find(r => r.student.id === selectedCell.studentId) : null;
  const activeDrawerStepIdx = selectedCell ? timelineSteps.findIndex(s => s.id === selectedCell.stepId) : -1;
  const activeDrawerStepData = activeDrawerRow && activeDrawerStepIdx >= 0 ? activeDrawerRow.steps[activeDrawerStepIdx] : null;
  const activeDrawerStepDef = activeDrawerStepIdx >= 0 ? timelineSteps[activeDrawerStepIdx] : null;
  const activeClassStats = activeDrawerStepDef ? classComparison[activeDrawerStepDef.id] : null;

  return (
    <div className="space-y-4">
      {/* Gradebook Controls */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 bg-white border border-slate-200 rounded p-4 shadow-sm font-sans relative overflow-hidden">
        {/* Subtle decorative background */}
        <div className="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-slate-50 to-transparent pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 flex-1 z-10">
          <div className="relative">
            <select 
              className="appearance-none pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm"
              value={selectedAssignmentId || ""}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedAssignmentId(val);
                onSelectedAssignmentChange?.(val);
              }}
            >
              {assignmentOptions.length === 0 && <option value="">No Assignments found</option>}
              {assignmentOptions.map(a => (
                <option key={a.id} value={a.id}>
                  {a.lessonTitle} {a.sectionName ? `(${a.sectionName})` : ''}
                </option>
              ))}
            </select>
            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none rotate-90" />
          </div>

          <div className="hidden sm:block w-px h-6 bg-slate-200" />

          <div className="relative w-full sm:max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </span>
            <input
              type="text"
              placeholder="Search student name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-inner font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 z-10">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPreviewAttempts}
              onChange={(e) => setShowPreviewAttempts(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4 border-slate-300"
            />
            <span>Include preview students</span>
          </label>
        </div>
      </div>

      {/* Gradebook Timeline Matrix */}
      {!selectedAssignmentId ? (
        <div className="bg-white border border-slate-200 rounded p-12 text-center shadow-sm">
          <LayoutList className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700">No Assignment Selected</h3>
          <p className="text-slate-500 max-w-sm mx-auto mt-2 text-sm">Select an assignment from the dropdown above to view student progress timelines.</p>
        </div>
      ) : timelineSteps.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded p-12 text-center shadow-sm">
          <Activity className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700">No Content in Lesson</h3>
          <p className="text-slate-500 max-w-sm mx-auto mt-2 text-sm">This lesson has no videos, readings, or questions. Empty timeline.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm flex flex-col">
          <div ref={parentRef} className="overflow-auto w-full custom-scrollbar max-h-[70vh]">
            <table className="w-full text-left text-sm border-collapse min-w-max">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="sticky left-0 bg-slate-50 z-20 py-3 px-4 min-w-[240px] max-w-[280px] shadow-[2px_0_5px_rgba(0,0,0,0.02)] border-r border-slate-200">
                    <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Student Roster</div>
                  </th>
                  <th className="py-3 px-4 min-w-[120px] max-w-[140px] bg-slate-50 border-r border-slate-200">
                    <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Trend (Last 5)</div>
                  </th>
                  {timelineSteps.map((step) => (
                    <th key={step.id} className="py-3 px-4 min-w-[140px] max-w-[180px] border-r border-slate-100 font-sans group">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="p-1.5 rounded-md bg-slate-100 text-slate-500">
                          {getStepIcon(step.type)}
                        </div>
                        <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Step {step.index}</div>
                        {step.isPractice && <span className="ml-auto text-[8px] uppercase tracking-widest font-bold bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200">Practice</span>}
                      </div>
                      <div className="text-xs font-semibold text-slate-700 truncate" title={step.title}>{step.title}</div>
                      {step.points > 0 && (
                        <div className="text-[10px] text-slate-400 font-mono mt-1">{step.points} {step.points === 1 ? 'pt' : 'pts'} max</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[#1A1A1A] bg-white">
                {timelineData.length === 0 ? (
                  <tr>
                     <td colSpan={timelineSteps.length + 2} className="py-8 text-center text-slate-400 font-sans italic text-xs">
                        No students found for this assignment.
                     </td>
                  </tr>
                ) : (
                  <>
                    {rowVirtualizer.getVirtualItems().length > 0 && (
                      <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                        <td colSpan={timelineSteps.length + 2} className="p-0 border-none" />
                      </tr>
                    )}
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const row = timelineData[virtualRow.index];
                      return (
                        <tr key={row.student.id} className="group hover:bg-indigo-50/20 transition-colors duration-150">
                          <td className="sticky left-0 bg-white group-hover:bg-indigo-50/80 z-10 py-3 px-4 border-r border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                            <div className="flex justify-between items-start gap-2">
                               <div>
                                  <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                                    {row.student.name}
                                    {row.student.isPreview && (
                                      <span className="bg-slate-100 text-slate-500 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider uppercase">
                                        Preview
                                      </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5 mb-2">{row.completedSteps} of {timelineSteps.length} steps completed</div>
                              
                              <div className="flex flex-wrap gap-1.5">
                                {row.needsReviewCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shadow-sm border border-amber-200">
                                    <HelpCircle className="w-3 h-3" /> {row.needsReviewCount} Review
                                  </span>
                                )}
                                {row.overallSeverity !== 'none' && (
                                  <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm border ${
                                     row.summary?.integrity?.aiAgentSignalCount > 0
                                       ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                                       : row.overallSeverity === 'high'
                                       ? 'bg-rose-50 text-rose-700 border-rose-200'
                                       : row.overallSeverity === 'moderate'
                                       ? 'bg-amber-50 text-amber-700 border-amber-200'
                                       : 'bg-slate-50 text-slate-600 border-slate-200'
                                  }`}
                                  title={row.summary?.integrity?.topReasons?.join(', ')}
                                  >
                                    {row.summary?.integrity?.aiAgentSignalCount > 0 ? (
                                      <>
                                        <Bot className="w-3 h-3 shrink-0" /> AI detected
                                      </>
                                    ) : row.overallSeverity === 'high' ? (
                                      <>
                                        <AlertTriangle className="w-3 h-3 shrink-0" /> Action needed
                                      </>
                                    ) : row.overallSeverity === 'moderate' ? (
                                      <>
                                        <AlertCircle className="w-3 h-3 shrink-0" /> Repeated
                                      </>
                                    ) : (
                                      <>
                                        <ShieldAlert className="w-3 h-3 shrink-0" /> Recorded
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                              {renderConciseSummary(row)}
                           </div>
                           
                           {/* Small circular completion indicator */}
                           <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
                              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                <path className="text-slate-100" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                {row.completedSteps > 0 && (
                                   <path className="text-emerald-500" strokeDasharray={`${(row.completedSteps / timelineSteps.length) * 100}, 100`} strokeWidth="3" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                )}
                              </svg>
                              <span className="absolute text-[8px] font-bold font-mono text-slate-600">
                                {Math.round((row.completedSteps / timelineSteps.length) * 100)}%
                              </span>
                           </div>
                        </div>
                      </td>
                      
                      {/* Trend Column */}
                      <td className="py-2 px-3 border-r border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-center group/trend relative h-8 w-full cursor-help">
                          {row.historicalTrend && row.historicalTrend.length > 0 ? (
                            <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${row.historicalTrend.length * 20} 20`} preserveAspectRatio="none">
                               {row.historicalTrend.map((val: number, i: number) => {
                                 const x = i * 20 + 2;
                                 const y = 20 - (val * 16) - 2; 
                                 if (i === 0) return null;
                                 const prevX = (i - 1) * 20 + 2;
                                 const prevY = 20 - (row.historicalTrend[i - 1] * 16) - 2;
                                 return <line key={`line-${i}`} x1={prevX} y1={prevY} x2={x} y2={y} stroke="#818cf8" strokeWidth="1.5" />;
                               })}
                               {row.historicalTrend.map((val: number, i: number) => {
                                 const x = i * 20 + 2;
                                 const y = 20 - (val * 16) - 2; 
                                 return <circle key={`c-${i}`} cx={x} cy={y} r="2.5" className={val > 0.8 ? "fill-emerald-400" : val > 0.5 ? "fill-amber-400" : "fill-rose-400"} />;
                               })}
                            </svg>
                          ) : (
                            <span className="text-[10px] text-slate-300 italic">No data</span>
                          )}
                          <div className="absolute opacity-0 group-hover/trend:opacity-100 transition-opacity z-50 pointer-events-none bg-slate-800 text-white text-[10px] rounded px-2 py-1 -top-8 whitespace-nowrap left-1/2 -translate-x-1/2">
                             Overall score trend
                          </div>
                        </div>
                      </td>

                      {row.steps.map((cell, idx) => {
                        const highestCellMarker = cell.markers && cell.markers.length > 0 ? getHighestCellMarker(cell.markers) : null;
                        const cellTitle = highestCellMarker ? `${highestCellMarker.label}: ${highestCellMarker.reason}` : undefined;
                        return (
                          <td 
                             key={idx} 
                             className="py-2 px-3 border-r border-slate-100 cursor-pointer hover:bg-slate-100/50 transition relative group/cell"
                             onClick={() => setSelectedCell({ studentId: row.student.id, stepId: timelineSteps[idx].id })}
                             title={cellTitle}
                          >
                             <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-1">
                                   <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shadow-sm select-none ${getColorClasses(cell.color)}`}>
                                      {cell.label}
                                   </span>
                                   {highestCellMarker && (
                                      highestCellMarker.type === "ai_agent" ? (
                                         <Bot className="w-3.5 h-3.5 shrink-0 text-red-500 animate-pulse" />
                                      ) : highestCellMarker.level === "high" ? (
                                         <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                                      ) : highestCellMarker.level === "moderate" ? (
                                         <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                                      ) : (
                                         <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                      )
                                   )}
                                </div>
                                
                                <div className="flex items-center justify-between min-h-[16px]">
                                  {cell.score !== null ? (
                                     <span className="text-[11px] text-slate-600 font-mono font-bold bg-slate-50 px-1 rounded select-none">
                                       {safeScore(cell.score, cell.maxScore)}
                                     </span>
                                  ) : (
                                     <span className="text-[10px] text-slate-300 font-mono select-none">—</span>
                                  )}
                                  
                                  {cell.status === 'needs_teacher_review' && (
                                     <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  )}
                                </div>
                             </div>
                             
                             {/* Tooltip hint on hover */}
                             <div className="absolute inset-0 ring-2 ring-indigo-500 ring-inset opacity-0 group-hover/cell:opacity-100 pointer-events-none rounded transition-opacity" />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: `${rowVirtualizer.getTotalSize() - rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1].end}px` }}>
                    <td colSpan={timelineSteps.length + 2} className="p-0 border-none" />
                  </tr>
                )}
              </>
            )}
          </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Drawer Modal */}
      <AnimatePresence>
        {selectedCell && activeDrawerRow && activeDrawerStepData && activeDrawerStepDef && (
          <div className="fixed inset-0 z-50 flex justify-end">
             <motion.div 
               initial={{ opacity: 0}} 
               animate={{opacity: 1}} 
               exit={{opacity: 0}} 
               className="absolute inset-0 bg-slate-900/10 backdrop-blur-sm cursor-pointer" 
               onClick={() => setSelectedCell(null)} 
             />
             <motion.div 
               initial={{ x: '100%', opacity: 0 }} 
               animate={{ x: 0, opacity: 1 }} 
               exit={{ x: '100%', opacity: 0}} 
               transition={{ type: 'spring', damping: 25, stiffness: 200 }} 
               className="relative w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 z-10"
             >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                   <div>
                     <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">
                        Timeline Step {activeDrawerStepDef.index}
                     </div>
                     <h3 className="text-lg font-bold text-slate-800">{activeDrawerRow.student.name}</h3>
                     <div className="text-xs text-slate-500 mt-1 truncate max-w-md">{selectedAssignment?.lessonTitle} • {activeDrawerStepDef.title}</div>
                   </div>
                   <button 
                     onClick={() => setSelectedCell(null)}
                     className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                   >
                     <X className="w-5 h-5 text-slate-500" />
                   </button>
                </div>
                
                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30 custom-scrollbar pb-24">
                   
                   {/* Overview Card */}
                   <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                         <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Status</span>
                         <span className={`text-xs font-bold px-2 py-1 rounded border ${getColorClasses(activeDrawerStepData.color)}`}>{activeDrawerStepData.label}</span>
                      </div>
                      
                      {activeDrawerStepData.score !== null && (
                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                           <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Score</span>
                           <span className="text-lg font-mono font-bold text-slate-800">{safeScore(activeDrawerStepData.score, activeDrawerStepData.maxScore)}</span>
                        </div>
                      )}
                      
                      {activeClassStats && activeClassStats.avgScore !== null && (
                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                           <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Class Avg</span>
                           <span className="text-lg font-mono font-bold text-slate-600">{safeScore(Math.round(activeClassStats.avgScore * 10)/10, activeDrawerStepData.maxScore)}</span>
                        </div>
                      )}
                      
                      {activeDrawerStepData.attempt?.lastActiveAt && (
                         <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
                           <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Activity</span>
                           <span className="text-xs font-medium text-slate-700 flex items-center gap-1"><Clock className="w-3 h-3 text-slate-400" /> Recorded</span>
                        </div>
                      )}
                   </div>
                   {(activeDrawerStepData.response || activeDrawerStepData.draftText) && (
                     <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex items-center gap-2">
                           <FileText className="w-4 h-4 text-slate-500" />
                           <h4 className="text-sm font-bold text-slate-700">
                             {activeDrawerStepData.response ? "Student response" : "Student Draft (Unsubmitted)"}
                           </h4>
                           {!activeDrawerStepData.response && (
                             <span className="ml-auto text-[10px] bg-amber-50 text-amber-700 border border-amber-200 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                               Draft
                             </span>
                           )}
                        </div>
                        <div className="p-4">
                           {activeDrawerStepDef.block?.singleQuestion?.stem || activeDrawerStepDef.checkpoint?.question?.stem ? (
                             <div className="prose prose-sm prose-slate max-w-none text-slate-600 mb-4 bg-slate-50 p-3 rounded-md border border-slate-100">
                                <strong>Prompt:</strong> <div className="inline-block align-top ml-1"><RichContentRenderer content={activeDrawerStepDef.block?.singleQuestion?.stem || activeDrawerStepDef.checkpoint?.question?.stem} /></div>
                             </div>
                           ) : null}
                           
                           <div className="text-slate-800 font-medium whitespace-pre-wrap">
                              {activeDrawerStepData.response ? (
                                activeDrawerStepData.response.type === "mc" ? (
                                   <div className="flex flex-col gap-1">
                                     <div className="flex items-center gap-1.5 flex-wrap">
                                       <span className="text-[#64748B] font-medium text-xs">Selected Answer:</span>
                                       <span className="text-slate-900 font-extrabold text-xs">
                                         {resolveMultipleChoiceText(activeDrawerStepDef.block, activeDrawerStepData.response.responseValue) || activeDrawerStepData.response.responseText || "Selected choice unavailable"}
                                       </span>
                                     </div>
                                     <span className="text-[10px] font-mono text-slate-400 font-semibold leading-none mt-1">
                                       Choice ID: {activeDrawerStepData.response.responseValue}
                                     </span>
                                   </div>
                                ) : (
                                   <div className="font-sans leading-relaxed text-slate-800 text-sm">
                                     {activeDrawerStepData.response.responseValue || <span className="text-slate-400 italic font-mono">(Empty response provided)</span>}
                                   </div>
                                )
                              ) : (
                                <div className="font-sans leading-relaxed text-slate-800 text-sm">
                                  {activeDrawerStepData.draftText || <span className="text-slate-400 italic font-mono">(Empty draft response)</span>}
                                </div>
                              )}
                           </div>
                        </div>
                     </div>
                   )}

                   {/* Video Progress Section */}
                   {activeDrawerStepDef.type === 'video' && activeDrawerStepData.attempt && (
                     <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex items-center gap-2">
                           <PlayCircle className="w-4 h-4 text-slate-500" />
                           <h4 className="text-sm font-bold text-slate-700">Video Activity</h4>
                        </div>
                        <div className="p-4 flex items-center gap-4">
                           <div className="flex-1">
                             <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1.5">
                               <span>Watched Progress</span>
                               <span>{Math.round(activeDrawerStepData.attempt.furthestVideoTimestamps?.[activeDrawerStepDef.blockId] || 0)}s / {activeDrawerStepDef.block?.duration || 0}s</span>
                             </div>
                             <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden w-full">
                               <div 
                                  className="h-full bg-emerald-400 rounded-full" 
                                  style={{ width: `${Math.min(100, ((activeDrawerStepData.attempt.furthestVideoTimestamps?.[activeDrawerStepDef.blockId] || 0) / (activeDrawerStepDef.block?.duration || 1)) * 100)}%` }}
                               />
                             </div>
                           </div>
                        </div>
                     </div>
                   )}

                   {/* Feedback & Review Section */}
                   {activeDrawerStepData.response?.aiGrading && (
                     <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-purple-50 border-b border-purple-100 px-4 py-3 flex items-center gap-2">
                           <Bot className="w-4 h-4 text-purple-600" />
                           <h4 className="text-sm font-bold text-purple-900">AI Review Context</h4>
                           <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-purple-600 bg-purple-100 px-2 py-0.5 rounded">Teacher Only</span>
                        </div>
                        <div className="p-4 space-y-3">
                           <div className="text-sm text-slate-700">
                             <strong>AI Score Proposal: </strong> 
                             <span className="font-mono">{activeDrawerStepData.response.aiGrading.score}/{activeDrawerStepData.maxScore}</span>
                           </div>
                           <div className="text-sm text-slate-600 bg-purple-50/50 p-3 rounded-md border border-purple-100 italic">
                             {activeDrawerStepData.response.aiGrading.feedback || "No explanation provided."}
                           </div>
                           {activeDrawerStepData.response.aiGrading.status === 'success' && activeDrawerStepData.status === 'needs_teacher_review' && (
                              <button className="text-xs font-bold bg-white border border-slate-200 shadow-sm text-slate-600 hover:text-indigo-600 hover:border-indigo-200 px-3 py-1.5 rounded transition w-full">
                                Approve AI Classification
                              </button>
                           )}
                        </div>
                     </div>
                   )}

                   {/* Integrity Attention Markers & Signal Clusters */}
                   {activeDrawerStepData.markers && activeDrawerStepData.markers.length > 0 && (
                     <div className="space-y-4">
                       {activeDrawerStepData.markers.map((marker: any, mIdx: number) => {
                         const colorMap = {
                           high: { text: "text-red-900 bg-red-50 border-red-200 shadow-red-100", headerBg: "bg-red-100/50 border-red-200" },
                           moderate: { text: "text-amber-900 bg-amber-50 border-amber-200 shadow-amber-100", headerBg: "bg-amber-100/50 border-amber-200" },
                           low: { text: "text-slate-800 bg-slate-50 border-slate-200 shadow-slate-100", headerBg: "bg-slate-200/50 border-slate-200" },
                           info: { text: "text-slate-800 bg-slate-50 border-slate-200 shadow-slate-100", headerBg: "bg-slate-200/50 border-slate-200" },
                           none: { text: "text-slate-800 bg-slate-50 border-slate-200 shadow-slate-100", headerBg: "bg-slate-200/50 border-slate-200" }
                         };
                         const currentStyles = colorMap[marker.level as keyof typeof colorMap] || colorMap.low;
                         const isAi = marker.type === "ai_agent";
                         
                         return (
                           <div key={marker.id || mIdx} className={`border rounded-xl overflow-hidden shadow-sm ${currentStyles.text}`}>
                             <div className={`px-4 py-3 flex items-center gap-2 border-b ${currentStyles.headerBg}`}>
                               {isAi ? (
                                 <Bot className="w-4 h-4 text-red-500 animate-pulse" />
                               ) : marker.level === "high" ? (
                                 <AlertTriangle className="w-4 h-4 text-rose-500" />
                               ) : marker.level === "moderate" ? (
                                 <AlertCircle className="w-4 h-4 text-amber-500" />
                               ) : (
                                 <ShieldAlert className="w-4 h-4 text-slate-500" />
                               )}
                               <h4 className="text-sm font-bold">
                                 {isAi ? "Signals of AI Agent Use" : marker.label}
                               </h4>
                               <span className="ml-auto text-[10px] font-bold uppercase tracking-widest bg-white border px-2 py-0.5 rounded shadow-sm">
                                 {isAi ? "AI Agent Use" : marker.shortLabel || marker.level}
                               </span>
                             </div>
                             <div className="p-4 space-y-2 bg-white/50">
                               <div className="text-sm font-semibold">{marker.reason}</div>
                               {marker.suggestedAction && (
                                 <div className="text-xs text-slate-600 bg-white/80 p-2.5 rounded border border-slate-100 mt-2">
                                   <strong>Teacher Guidance:</strong> {marker.suggestedAction}
                                 </div>
                               )}
                               <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100/65">
                                 {marker.evidenceStrength && (
                                   <span>
                                     <strong>Evidence:</strong> <span className="capitalize">{marker.evidenceStrength}</span>
                                   </span>
                                 )}
                                 {marker.dataCompleteness && (
                                   <span>
                                     <strong>Pacing Completeness:</strong> <span className="capitalize">{marker.dataCompleteness}</span>
                                   </span>
                                 )}
                                 {marker.count && (
                                   <span>
                                     <strong>Events:</strong> {marker.count}
                                   </span>
                                 )}
                               </div>
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   )}

                   {/* Collapsible Raw Activity Records */}
                   {activeDrawerStepData.signals && activeDrawerStepData.signals.length > 0 && (
                     <details className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm group">
                       <summary className="bg-slate-50 px-4 py-3 flex items-center gap-2 cursor-pointer font-bold text-sm text-slate-700 hover:bg-slate-100/70 select-none transition-colors">
                         <Activity className="w-4 h-4 text-slate-500" />
                         <span>Raw Activity Records ({activeDrawerStepData.signals.length})</span>
                         <ChevronRight className="w-4 h-4 text-slate-400 ml-auto transition-transform group-open:rotate-90" />
                       </summary>
                       <div className="p-4 space-y-3 bg-slate-50/20 border-t border-slate-100">
                           <p className="text-xs text-slate-500 mb-2">
                             <Info className="w-3.5 h-3.5 inline-block mr-1 text-slate-400 align-text-bottom" />
                             Review the raw timing and event timestamps recorded during this specific step.
                           </p>
                           {activeDrawerStepData.signals.map((sig: any, sIdx: number) => (
                              <div key={sIdx} className="flex gap-3 bg-white p-3 rounded-md border border-slate-100 shadow-sm text-xs">
                                 <div className="mt-0.5 shrink-0">
                                   {sig.type.includes('clipboard') || sig.type.includes('paste') ? <FileText className="w-3.5 h-3.5 text-slate-400" /> :
                                    sig.type.includes('visibility') || sig.type.includes('fullscreen') ? <Maximize className="w-3.5 h-3.5 text-slate-400" /> :
                                    sig.type.includes('guard_marker') ? <Bot className="w-3.5 h-3.5 text-rose-500" /> :
                                    <MousePointerClick className="w-3.5 h-3.5 text-slate-400" />}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                   <div className="font-bold text-slate-700">{getSignalLabel(sig.type)}</div>
                                   <div className="text-slate-500 mt-0.5 break-words">{sig.details || "No additional context."}</div>
                                   <div className="text-[10px] font-mono text-slate-400 mt-1.5 uppercase tracking-wide">
                                     {sig.timestamp && !isNaN(new Date(sig.timestamp).getTime())
                                       ? `Recorded ${new Date(sig.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}, ${new Date(sig.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                       : "Time unavailable"}
                                   </div>
                                 </div>
                              </div>
                           ))}
                       </div>
                     </details>
                   )}

                   {/* Class Comparison Section */}
                   {activeClassStats && (
                     <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex items-center gap-2">
                           <LayoutList className="w-4 h-4 text-slate-500" />
                           <h4 className="text-sm font-bold text-slate-700">Class Comparison</h4>
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-4">
                           <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Status Distribution</div>
                              <div className="text-sm text-slate-700">{activeClassStats.submitted} of {displayStudents.filter(s => !s.isPreview).length} students submitted</div>
                           </div>
                           <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Needs Review</div>
                              <div className="text-sm text-slate-700">{activeClassStats.needsGrading} students pending grading</div>
                           </div>
                           <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Integrity Activity</div>
                              <div className="text-sm text-slate-700">{activeClassStats.signalsCount} students with signals</div>
                           </div>
                           {(activeDrawerStepData.score !== null && activeClassStats.avgScore !== null) && (
                              <div>
                                 <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Relative Standing</div>
                                 <div className="text-sm text-slate-700">
                                    {activeDrawerStepData.score > activeClassStats.avgScore + (activeDrawerStepData.maxScore * 0.1) ? "Above class average" :
                                     activeDrawerStepData.score < activeClassStats.avgScore - (activeDrawerStepData.maxScore * 0.1) ? "Below class average" :
                                     "Near class average"}
                                 </div>
                              </div>
                           )}
                        </div>
                     </div>
                   )}
                   
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
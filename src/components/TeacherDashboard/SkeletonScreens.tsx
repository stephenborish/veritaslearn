import React from "react";
import { 
  BookOpen, 
  Grid, 
  Database, 
  Settings, 
  Plus, 
  ChevronDown,
  Trash,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  HelpCircle,
  MessageSquare,
  AlertTriangle
} from "lucide-react";

/**
 * LESSON BUILDER SKELETON
 * Re-creators standard list view with pulsing cards
 */
export const LessonsBuilderSkeleton: React.FC = () => {
  return (
    <div className="space-y-6 font-sans animate-pulse">
      {/* Top action header button mock */}
      <div className="flex justify-end mb-4">
        <div className="bg-slate-200 h-9 w-44 rounded-md"></div>
      </div>

      {/* Grid mimicking lessons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((idx) => (
          <div 
            key={idx}
            className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm flex flex-col justify-between min-h-[160px]"
          >
            <div>
              <div className="flex justify-between items-start">
                {/* Lesson title skeleton */}
                <div className="h-4 bg-slate-300 rounded w-1/2"></div>
                {/* Status indicator tag skeleton */}
                <div className="h-5 bg-slate-200 rounded w-16"></div>
              </div>
              
              {/* Short educational description lines */}
              <div className="space-y-2 mt-4">
                <div className="h-3 bg-slate-200 rounded w-full"></div>
                <div className="h-3 bg-slate-200 rounded w-5/6"></div>
              </div>
            </div>

            {/* Bottom meta row and config buttons */}
            <div className="mt-4 border-t border-slate-100 pt-4 flex justify-between items-center text-[10px] text-slate-400 font-semibold">
              <div className="flex gap-2 w-1/2">
                <div className="h-2 bg-slate-200 rounded w-12"></div>
                <div className="h-2 bg-slate-200 rounded w-10"></div>
              </div>
              <div className="flex gap-2">
                <div className="h-7 bg-slate-200 rounded w-28"></div>
                <div className="h-7 bg-slate-100 rounded w-14"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * GRADEBOOK SKELETON
 * Re-creates standard spreadsheet style grade table layout
 */
export const GradebookSkeleton: React.FC = () => {
  return (
    <div className="space-y-4 font-sans animate-pulse">
      {/* Top Endorsement Controls button */}
      <div className="flex justify-end">
        <div className="bg-slate-200 h-8 w-28 rounded"></div>
      </div>

      {/* Sheet board container shadow table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-4 px-6 min-w-[200px]">
                  <div className="h-3 bg-slate-300 rounded w-32"></div>
                </th>
                <th className="py-4 px-6 min-w-[150px]">
                  <div className="h-3 bg-slate-200 rounded w-28"></div>
                </th>
                <th className="py-4 px-6 min-w-[150px]">
                  <div className="h-3 bg-slate-200 rounded w-36"></div>
                </th>
                <th className="py-4 px-6 min-w-[150px]">
                  <div className="h-3 bg-slate-200 rounded w-24"></div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[1, 2, 3, 4, 5].map((rowIdx) => (
                <tr key={rowIdx} className="hover:bg-slate-50/50 transition">
                  {/* Student column */}
                  <td className="py-4 px-6">
                    <div className="h-4 bg-slate-300 rounded w-28 mb-1.5"></div>
                    <div className="h-2.5 bg-slate-200 rounded w-36"></div>
                  </td>
                  {/* Quiz column 1 */}
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-slate-200 rounded-sm"></div>
                      <div className="h-3 bg-slate-200 rounded w-16"></div>
                    </div>
                  </td>
                  {/* Quiz column 2 */}
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2 animate-pulse">
                      <div className="w-4 h-4 bg-slate-200 rounded-sm"></div>
                      <div className="h-3 bg-slate-300 rounded w-12"></div>
                      <div className="h-4 bg-slate-100 rounded w-14"></div>
                    </div>
                  </td>
                  {/* Quiz column 3 */}
                  <td className="py-4 px-6">
                    <div className="h-5 bg-slate-100 rounded w-24"></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/**
 * AI REVIEW BOARD SKELETON
 * Shows filters panel and cards feed stack
 */
export const AIReviewSkeleton: React.FC = () => {
  return (
    <div className="space-y-5 font-sans animate-pulse">
      {/* Top custom filter pills */}
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md p-1 w-fit shadow-sm">
        {[100, 120, 110, 95].map((w, i) => (
          <div 
            key={i} 
            style={{ width: `${w}px` }} 
            className="bg-slate-200 h-7 rounded"
          ></div>
        ))}
      </div>

      {/* Review Queue Alerts scroll layout */}
      <div className="space-y-4">
        {/* Card 1: Short Answer Grading Module Alert */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 bg-slate-300 rounded-full"></div>
              <div>
                <div className="h-3.5 bg-slate-300 rounded w-44 mb-1"></div>
                <div className="h-3 bg-slate-200 rounded w-32"></div>
              </div>
            </div>
            <div className="h-5 bg-slate-200 rounded w-24"></div>
          </div>
          
          <div className="space-y-3">
            <div className="h-5 bg-slate-100 rounded w-full"></div>
            <div className="h-5 bg-slate-100 rounded w-11/12"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 bg-slate-50/55 p-3.5 rounded border border-slate-200/50 gap-4">
            <div className="space-y-2">
              <div className="h-3 bg-slate-200 rounded w-36"></div>
              <div className="h-4.5 bg-slate-300 rounded w-2/3"></div>
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-slate-200 rounded w-40"></div>
              <div className="h-10 bg-slate-200 rounded w-full"></div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <div className="h-8 bg-slate-200 rounded w-24"></div>
            <div className="flex gap-2">
              <div className="h-8 bg-slate-300 rounded w-28"></div>
              <div className="h-8 bg-slate-200 rounded w-16"></div>
            </div>
          </div>
        </div>

        {/* Card 2: Academic Integrity / focus blurred alarm indicator */}
        <div className="bg-white border-l-4 border-l-red-400 border border-slate-200 rounded-lg p-5 shadow-sm flex justify-between items-start gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-100 rounded-full"></div>
              <div className="h-4 bg-slate-300 rounded w-44"></div>
            </div>
            <div className="h-3 bg-slate-200 rounded w-2/3"></div>
            <div className="h-3 bg-slate-100 rounded w-1/2"></div>
          </div>
          <div className="h-7 bg-slate-200 rounded w-20"></div>
        </div>

        {/* Card 3: Anomaly detection mock */}
        <div className="bg-white border-l-4 border-l-amber-400 border border-slate-200 rounded-lg p-5 shadow-sm flex justify-between items-start gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-amber-100 rounded-full"></div>
              <div className="h-4 bg-slate-300 rounded w-36"></div>
            </div>
            <div className="h-3 bg-slate-200 rounded w-5/6"></div>
          </div>
          <div className="h-7 bg-slate-200 rounded w-20"></div>
        </div>
      </div>
    </div>
  );
};

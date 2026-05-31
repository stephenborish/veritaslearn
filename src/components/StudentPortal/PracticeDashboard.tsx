import { Play, CheckCircle, Clock, BookOpen, Clock3 } from "lucide-react";

interface PracticeDashboardProps {
  lessons: any[];
  attempts: any[];
  onStartAttempt: (id: string) => void;
  onLogout: () => void;
  user: any;
}

export default function PracticeDashboard({ lessons, attempts, onStartAttempt, onLogout, user }: PracticeDashboardProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Course info banner */}
        <div className="bg-white border border-slate-200 rounded p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
          <div>
            <h2 className="font-sans font-bold text-slate-800 text-[26px] leading-[35px] text-left bg-white">AP United States History Course</h2>
            <p className="text-xs text-slate-500 mt-1">Complete each lesson independently and in order. The platform records activity and progress to help your teacher review your work quality.</p>
          </div>
          <div className="bg-[#0A192F] font-sans text-white w-[132.695px] h-[30px] text-center text-[10px] leading-[0px] rounded-[14px] pt-[15px] pb-[15px] whitespace-nowrap box-border flex items-center justify-center">
            TERM 3 - LECTURES
          </div>
        </div>

        {/* Assignments items grid */}
        <div className="space-y-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#0A192F] font-mono text-left">Published Curriculum</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lessons.map((lesson) => {
              const attempt = attempts.find((a) => a.lessonId === lesson.id && a.studentId === user.id);
              const isComp = attempt?.status === "completed";

              return (
                <div 
                  key={lesson.id}
                  className="bg-white border text-slate-800 border-slate-200 rounded overflow-hidden shadow-sm flex flex-col justify-between min-h-[170px]"
                >
                  <div className="p-5">
                    <div className="flex justify-between items-start gap-3">
                      <h4 className="text-[17px] leading-[21px] font-bold text-slate-800 tracking-tight text-left">{lesson.title}</h4>
                      {isComp ? (
                        <span className="shrink-0 font-sans not-italic font-bold leading-[10px] text-[9px] px-[6px] py-[4px] border-none rounded-[30px] bg-[#f79112] text-white flex items-center gap-1">
                          <CheckCircle className="w-2.5 h-2.5" /> Completed
                        </span>
                      ) : attempt ? (
                        <span className="shrink-0 font-sans not-italic font-bold leading-[10px] text-[9px] px-[6px] py-[4px] border-none rounded-[30px] bg-[#f79112] text-white">
                          Progress
                        </span>
                      ) : (
                        <span className="shrink-0 font-sans not-italic font-bold leading-[10px] text-[9px] px-[6px] py-[4px] border-none rounded-[30px] bg-[#f79112] text-white">
                          Assigned
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                      {typeof lesson.description === "object"
                        ? (lesson.description.plainText || (lesson.description.html ? lesson.description.html.replace(/<[^>]*>/g, "") : ""))
                        : (lesson.description || "Introductory history readings & interactive checks.")}
                    </p>
                  </div>

                  <div className="bg-slate-50 border-t border-slate-150 px-5 py-3.5 flex justify-between items-center">
                    <span className="font-sans text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1.5 tracking-wider">
                      <Clock3 className="w-3.5 h-3.5 text-slate-400" />
                      {lesson.estimatedMinutes} M
                    </span>

                    <button
                      onClick={() => onStartAttempt(lesson.id)}
                      className="bg-[#0A192F] hover:bg-[#15294b] text-white text-[12px] leading-[15px] font-bold uppercase tracking-widest px-4 py-1.5 rounded flex items-center gap-1 transition cursor-pointer shadow-sm"
                    >
                      {isComp ? "Review" : attempt ? "Resume" : "Begin"}
                      <Play className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

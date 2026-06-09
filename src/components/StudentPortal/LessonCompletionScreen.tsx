import React from "react";
import { motion } from "motion/react";
import { Check, ClipboardCheck, ArrowRight, LayoutDashboard, BookOpen, Sparkles, Award } from "lucide-react";
import { cn } from "../../lib/utils";

interface LessonCompletionScreenProps {
  lessonTitle: string;
  onExit: () => void;
  onReview: () => void;
  reduceMotion?: boolean;
}

export default function LessonCompletionScreen({
  lessonTitle,
  onExit,
  onReview,
  reduceMotion = false,
}: LessonCompletionScreenProps) {
  // Anim variants matching design goals
  const containerVariants: any = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants: any = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { opacity: 0, y: 15 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
      };

  const iconVariants: any = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { scale: 0.8, opacity: 0 },
        visible: {
          scale: 1,
          opacity: 1,
          transition: { type: "spring", stiffness: 100, damping: 10, delay: 0.2 },
        },
      };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-center items-center overflow-y-auto bg-gradient-to-tr from-sky-50 via-indigo-50/30 to-rose-50 px-6 py-12 select-none">
      {/* Decorative floating blurred circles for immersive, academically warm background */}
      {!reduceMotion && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <motion.div
            animate={{
              y: [0, -10, 0],
              x: [0, 10, 0],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute -top-12 -left-12 w-64 h-64 bg-sky-200/30 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              y: [0, 15, 0],
              x: [0, -15, 0],
            }}
            transition={{
              duration: 16,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute -bottom-16 -right-16 w-80 h-80 bg-rose-200/20 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              y: [0, -15, 0],
              x: [0, -10, 0],
            }}
            transition={{
              duration: 14,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute top-1/3 right-1/4 w-48 h-48 bg-indigo-200/25 rounded-full blur-3xl"
          />
        </div>
      )}

      {/* Main Content Card container */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 w-full max-w-xl bg-white border border-slate-100/80 rounded-3xl shadow-xl shadow-slate-100/60 p-8 md:p-12 text-center"
      >
        {/* Soft radial glow behind active check circle */}
        <motion.div
          variants={iconVariants}
          className="relative flex justify-center items-center mx-auto w-24 h-24 mb-8"
        >
          <div className="absolute inset-0 bg-indigo-100/60 rounded-full blur-xl scale-125 animate-pulse" />
          <div className="relative flex justify-center items-center w-20 h-20 bg-indigo-600 rounded-full shadow-lg shadow-indigo-100/50 text-white animate-pulse">
            <Check className="w-10 h-10 stroke-[2.5]" />
          </div>
          {/* Subtle sparkle indicators */}
          <Sparkles className="absolute -top-1 -right-1 w-6 h-6 text-amber-500 animate-bounce" />
        </motion.div>

        {/* Celebrating Header */}
        <motion.div variants={itemVariants} className="space-y-3">
          <span className="text-xs font-bold uppercase tracking-widest text-indigo-600 px-3 py-1 bg-indigo-50 rounded-full inline-flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5" /> Course readiness assignment complete
          </span>
          <h2 className="text-3xl md:text-4xl font-serif font-semibold text-slate-900 tracking-tight leading-tight pt-1">
            You made it.
          </h2>
          <h3 className="text-lg md:text-xl font-medium text-slate-800 leading-snug">
            {lessonTitle} Complete
          </h3>
        </motion.div>

        {/* Informative Explanation block */}
        <motion.div
          variants={itemVariants}
          className="my-8 rounded-2xl bg-slate-50 border border-slate-100 p-5 text-left space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="bg-emerald-100 text-emerald-700 p-1.5 rounded-lg shrink-0 mt-0.5">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-slate-800">Your work is safe</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                All checkpoint answers, readings, video milestones, and written explanations have been compiled and verified with the server. They are saved in your permanent student file.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="bg-sky-100 text-sky-700 p-1.5 rounded-lg shrink-0 mt-0.5">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-slate-800">Here's what happens next</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Your teacher receives an asynchronous progress notification to review any short answer entries or readiness criteria before the academic term starts.
              </p>
            </div>
          </div>
        </motion.div>

        {/* User Options */}
        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            type="button"
            onClick={onExit}
            className="learn-focusable w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition cursor-pointer shadow-sm shadow-indigo-100 focus-visible:ring-4 focus-visible:ring-indigo-500/20"
          >
            <LayoutDashboard className="w-4 h-4" />
            Return to dashboard
          </button>

          <button
            type="button"
            onClick={onReview}
            className="learn-focusable w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer focus-visible:ring-4 focus-visible:ring-slate-100"
          >
            <BookOpen className="w-4 h-4" />
            Review lesson material
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}

import React from "react";
import { motion } from "motion/react";
import { Check, ClipboardCheck, ArrowRight, LayoutDashboard, BookOpen, Sparkles } from "lucide-react";
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
  // Balanced staggering animations
  const containerVariants: any = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants: any = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { opacity: 0, y: 12 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
        },
      };

  const checkMarkVariants: any = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { scale: 0.7, opacity: 0 },
        visible: {
          scale: [0.7, 1.12, 1],
          opacity: 1,
          transition: {
            type: "spring",
            stiffness: 300,
            damping: 18,
            delay: 0.1,
          },
        },
      };

  const sparkleVariants: any = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { scale: 0, opacity: 0 },
        visible: {
          scale: [0, 1.3, 1],
          opacity: 1,
          transition: {
            type: "spring",
            stiffness: 400,
            damping: 15,
            delay: 0.4,
          },
        },
      };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-center items-center overflow-y-auto bg-gradient-to-tr from-emerald-50/20 via-slate-50 to-indigo-50/30 px-6 py-12 select-none">
      {/* Decorative floating ambient background blur element */}
      {!reduceMotion && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <motion.div
            animate={{
              y: [0, -12, 0],
              x: [0, 8, 0],
            }}
            transition={{
              duration: 14,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute -top-16 -left-16 w-72 h-72 bg-emerald-100/20 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              y: [0, 12, 0],
              x: [0, -8, 0],
            }}
            transition={{
              duration: 18,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute -bottom-16 -right-16 w-80 h-80 bg-indigo-100/25 rounded-full blur-3xl"
          />
        </div>
      )}

      {/* Main Card */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 w-full max-w-xl bg-white border border-slate-200/60 rounded-3xl shadow-xl shadow-slate-100/50 p-8 md:p-12 text-center"
      >
        {/* Celebration State Circle */}
        <div className="relative flex justify-center items-center mx-auto w-24 h-24 mb-6">
          <div className="absolute inset-0 bg-emerald-100/50 rounded-full blur-xl scale-125 animate-pulse" />
          <motion.div
            variants={checkMarkVariants}
            className="relative flex justify-center items-center w-20 h-20 bg-emerald-500 rounded-full shadow-lg shadow-emerald-200 text-white"
          >
            <Check className="w-10 h-10 stroke-[2.5]" />
          </motion.div>
          {/* Subtle sparkles to catch the eye */}
          <motion.div
            variants={sparkleVariants}
            className="absolute -top-1 -right-1"
          >
            <Sparkles className="w-6 h-6 text-amber-400" />
          </motion.div>
        </div>

        {/* Headline Section */}
        <motion.div variants={itemVariants} className="space-y-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full inline-flex items-center gap-1.5">
            Saved and submitted
          </span>
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-slate-900 tracking-tight leading-tight">
            You’re all set.
          </h2>
          <p className="text-slate-500 text-sm md:text-base font-medium truncate max-w-md mx-auto">
            Lesson complete · {lessonTitle}
          </p>
        </motion.div>

        {/* Content Breakdown Cards */}
        <motion.div
          variants={itemVariants}
          className="my-8 rounded-2xl bg-slate-50 border border-slate-150 p-5 text-left space-y-4"
        >
          {/* Card 1: Your work is saved */}
          <div className="flex items-start gap-3.5">
            <div className="bg-emerald-100 text-emerald-700 p-1.5 rounded-xl shrink-0 mt-0.5">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-slate-800">Your work is saved</h4>
              <p className="text-xs text-slate-500 leading-relaxed font-normal">
                Your progress and responses have been submitted. You can return to your dashboard now, or review the lesson materials again.
              </p>
            </div>
          </div>

          <hr className="border-slate-200/60" />

          {/* Card 2: What happens next */}
          <div className="flex items-start gap-3.5">
            <div className="bg-indigo-100 text-indigo-700 p-1.5 rounded-xl shrink-0 mt-0.5">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-slate-800">What happens next</h4>
              <p className="text-xs text-slate-500 leading-relaxed font-normal">
                Your teacher will review any responses that need feedback. When feedback is released, it will appear with your completed work.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Actions Selection */}
        <motion.div
          variants={itemVariants}
          className="flex flex-col sm:flex-row gap-3 justify-center items-center"
        >
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

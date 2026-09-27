"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const STEPS = [
  {
    title: "Find Your Workspace",
    description:
      "Search venues with AI-powered recommendations tailored to your needs. Ask anything — quiet cafe, fast WiFi, near transit.",
    icon: "🔍",
  },
  {
    title: "See Real Reviews",
    description:
      "Browse detailed community ratings for WiFi quality, noise level, and outlet availability — so you know before you go.",
    icon: "⭐",
  },
  {
    title: "Save Your Favorites",
    description:
      "Build personal collections of your go-to spots. Organise venues by category, tag, or trip so they're always a tap away.",
    icon: "❤️",
  },
];

const TITLE_ID = "onboarding-modal-title";

export function OnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem("worksphere_onboarded")) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem("worksphere_onboarded", "1");
    setVisible(false);
  };

  const next = () =>
    step < STEPS.length - 1 ? setStep(step + 1) : dismiss();

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
        className="relative z-10 w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-hidden"
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          aria-label="Dismiss onboarding"
          className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Step content */}
        <div className="px-8 pt-10 pb-6 min-h-[220px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.22 }}
              className="flex flex-col items-center text-center"
            >
              <span className="text-5xl mb-5" aria-hidden="true">
                {STEPS[step].icon}
              </span>
              <h2
                id={TITLE_ID}
                className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-3"
              >
                {STEPS[step].title}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {STEPS[step].description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress dots */}
        <div
          role="tablist"
          aria-label="Onboarding steps"
          className="flex justify-center gap-2 pb-2"
        >
          {STEPS.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1} of ${STEPS.length}`}
              onClick={() => setStep(i)}
              className={`rounded-full transition-all duration-200 ${
                i === step
                  ? "w-6 h-2 accent-bg"
                  : "w-2 h-2 bg-zinc-300 dark:bg-zinc-600 hover:bg-zinc-400 dark:hover:bg-zinc-500"
              }`}
            />
          ))}
        </div>

        {/* Navigation actions */}
        <div className="flex gap-3 px-8 py-6">
          <button
            onClick={back}
            disabled={step === 0}
            className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Back
          </button>
          <button
            onClick={next}
            className="flex-1 py-2.5 rounded-xl accent-bg text-white text-sm font-semibold transition-opacity hover:opacity-90 shadow-md"
          >
            {isLast ? "Get Started" : "Next"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

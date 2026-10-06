"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Monitor,
  Headphones,
  Zap,
  Coffee,
  VolumeX,
  Volume2,
  Users,
  Compass,
  Laptop,
  Check,
  RotateCcw,
  Loader2,
} from "lucide-react";
import {
  type QuizAnswers,
  type DeskArchetype,
  matchDeskArchetype,
  DESK_ARCHETYPES,
} from "@/lib/quiz/deskMatcher";

export interface DeskMatcherQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMatched?: (archetype: DeskArchetype) => void;
}

export function DeskMatcherQuizModal({
  isOpen,
  onClose,
  onMatched,
}: DeskMatcherQuizModalProps) {
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [answers, setAnswers] = useState<Partial<QuizAnswers>>({
    primaryActivity: "dev",
    noisePreference: "silent",
    hardwareNeed: "dual_monitor",
    seatingPlacement: "corner_wall",
    sessionDuration: "half_day",
  });

  const [matchedResult, setMatchedResult] = useState<DeskArchetype | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const totalSteps = 5;

  const handleSelect = (key: keyof QuizAnswers, value: any) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Calculate Match Result
      const result = matchDeskArchetype(answers as QuizAnswers);
      setMatchedResult(result);
      onMatched?.(result);

      // Auto-save to profile
      void saveArchetypeToBackend(result);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleRetake = () => {
    setMatchedResult(null);
    setCurrentStep(1);
    setSavedSuccess(false);
  };

  const saveArchetypeToBackend = async (archetype: DeskArchetype) => {
    setIsSaving(true);
    try {
      await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workStyleProfile: archetype.name,
        }),
      });
      setSavedSuccess(true);
    } catch {
      // Non-fatal
    } finally {
      setIsSaving(false);
    }
  };

  const handleExploreDesks = () => {
    if (!matchedResult) return;
    onClose();
    router.push(
      `/ai?${matchedResult.searchFilterQuery}&q=${encodeURIComponent(matchedResult.name)}`,
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desk-matcher-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-xl rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="desk-matcher-title"
                className="text-base font-bold text-white"
              >
                Smart Desk Matcher Quiz
              </h2>
              <p className="text-xs text-zinc-400">
                {matchedResult
                  ? "Your Personalized Workspace Match"
                  : `Question ${currentStep} of ${totalSteps}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar (During Quiz) */}
        {!matchedResult && (
          <div className="h-1 w-full bg-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-violet-500 via-indigo-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-6">
          {matchedResult ? (
            /* Results Screen */
            <div className="space-y-6 animate-in zoom-in-95 duration-300">
              {/* Archetype Hero Card */}
              <div
                className={`rounded-3xl border ${matchedResult.themeColor.border} bg-gradient-to-b ${matchedResult.themeColor.gradient} p-6 sm:p-7 space-y-4 shadow-xl text-center`}
              >
                <div className="text-5xl mb-2">{matchedResult.icon}</div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-wider font-mono">
                  {matchedResult.name}
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white">
                  {matchedResult.tagline}
                </h3>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-md mx-auto">
                  {matchedResult.description}
                </p>
              </div>

              {/* Recommended Desk & Amenities */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Recommended Desk Type
                  </span>
                  <div className="text-sm font-bold text-emerald-400">
                    {matchedResult.idealDeskTypeLabel}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Target Noise Level
                  </span>
                  <div className="text-sm font-bold text-indigo-400 capitalize">
                    {matchedResult.idealNoiseLevel} Zone (&lt;50 dB)
                  </div>
                </div>
              </div>

              {/* Radar / Stat Indicators */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Workspace Match DNA
                </span>
                <div className="space-y-2 text-xs">
                  {Object.entries(matchedResult.radarScores).map(([key, score]) => (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between text-zinc-300">
                        <span className="capitalize">
                          {key.replace(/([A-Z])/g, " $1")}
                        </span>
                        <span className="font-mono font-bold">{score}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 rounded-full"
                          style={{ width: `${score}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Quiz Step Questions */
            <div className="space-y-5">
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      1. What's your core work mode for this session?
                    </h3>
                    <p className="text-xs text-zinc-400">
                      We calibrate desk ergonomics and equipment density to your primary task.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      { id: "dev", title: "💻 Software Engineering & Deep Code", desc: "Dual monitors, mechanical keyboards, multi-power" },
                      { id: "calls", title: "📞 Calls & Video Pitching", desc: "Acoustic soundproof booth, low-latency video Wi-Fi" },
                      { id: "creative", title: "🎨 Creative Writing & Design", desc: "Sunlit cafe ambiance, pour-over coffee, relaxed vibe" },
                      { id: "study", title: "📚 Deep Study & Reading", desc: "Silent library desk, warm light, zero distractions" },
                      { id: "hybrid", title: "⚡ Agile Sprint & Multi-Tasking", desc: "Hot desk with quick outlet access" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelect("primaryActivity", opt.id)}
                        className={`p-3.5 rounded-2xl border text-left transition-all ${
                          answers.primaryActivity === opt.id
                            ? "border-violet-500 bg-violet-500/10 text-white ring-1 ring-violet-500/30"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      2. What is your ambient noise preference?
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Match with venues based on crowd levels and decibel sensors.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      { id: "silent", title: "🤫 Pin-Drop Silence (< 35 dB)", desc: "Quiet study carrels, strict no-talking zones" },
                      { id: "moderate", title: "🎧 Cozy Ambient Hum (45 - 55 dB)", desc: "Lo-fi cafe background hum, keyboard clicks" },
                      { id: "energetic", title: "🗣️ Buzzing Collaborative Vibe (> 60 dB)", desc: "Energetic coworking concourse, networking" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelect("noisePreference", opt.id)}
                        className={`p-3.5 rounded-2xl border text-left transition-all ${
                          answers.noisePreference === opt.id
                            ? "border-violet-500 bg-violet-500/10 text-white ring-1 ring-violet-500/30"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      3. What hardware &amp; desk setup do you need?
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Filter for specialized desk hardware and power configurations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      { id: "dual_monitor", title: "🖥️ External Monitor Included", desc: "Desks equipped with 4K display or dual monitors" },
                      { id: "standing", title: "🪑 Standing Desk & Herman Miller", desc: "Motorized height-adjustable desk & lumbar chair" },
                      { id: "power_heavy", title: "🔌 Dedicated Multi-Plug AC & USB-C", desc: "Power at every seat with high-wattage charging" },
                      { id: "minimal", title: "☕ Just My Laptop & Coffee", desc: "Flexible lightweight seating with general power access" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelect("hardwareNeed", opt.id)}
                        className={`p-3.5 rounded-2xl border text-left transition-all ${
                          answers.hardwareNeed === opt.id
                            ? "border-violet-500 bg-violet-500/10 text-white ring-1 ring-violet-500/30"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 4 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      4. Where on the floor do you sit best?
                    </h3>
                    <p className="text-xs text-zinc-400">
                      3D floor plan positioning preference.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      { id: "corner_wall", title: "🧱 Quiet Corner / Back Against Wall", desc: "Maximum privacy with no traffic behind you" },
                      { id: "sunlit_window", title: "☀️ Window-Side Natural Daylight", desc: "Inspiring outdoor view and natural lighting" },
                      { id: "phone_booth", title: "🚪 Enclosed Acoustic Pod", desc: "Glass-door soundproof booth for isolated focus" },
                      { id: "center_island", title: "🤝 Shared Central Island", desc: "Spacious community desk near cafe bar" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelect("seatingPlacement", opt.id)}
                        className={`p-3.5 rounded-2xl border text-left transition-all ${
                          answers.seatingPlacement === opt.id
                            ? "border-violet-500 bg-violet-500/10 text-white ring-1 ring-violet-500/30"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 5 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      5. Typical session duration?
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Ensures desk booking windows and amenities align with your rhythm.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      { id: "quick_sprint", title: "⚡ Quick 1 - 2 Hour Sprint", desc: "Short agile block, drop-in hot desk" },
                      { id: "half_day", title: "⏱️ Half-Day Focus (3 - 5 Hours)", desc: "Solid productive session with ergonomic seating" },
                      { id: "marathon", title: "🌅 Full-Day Deep Work (8+ Hours)", desc: "Dedicated fixed desk, full locker and cafe access" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelect("sessionDuration", opt.id)}
                        className={`p-3.5 rounded-2xl border text-left transition-all ${
                          answers.sessionDuration === opt.id
                            ? "border-violet-500 bg-violet-500/10 text-white ring-1 ring-violet-500/30"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <div className="text-sm font-bold text-white">{opt.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
          {matchedResult ? (
            <div className="flex items-center justify-between w-full gap-3">
              <button
                type="button"
                onClick={handleRetake}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-700 bg-zinc-800/80 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retake Quiz
              </button>

              <button
                type="button"
                onClick={handleExploreDesks}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 text-white text-xs font-bold shadow-lg shadow-violet-500/20 transition-all cursor-pointer"
              >
                <Compass className="w-4 h-4" />
                Explore Matched Desks
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
              >
                <span>{currentStep === totalSteps ? "Generate Match" : "Next"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

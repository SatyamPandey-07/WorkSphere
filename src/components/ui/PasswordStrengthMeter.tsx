"use client";

import React from "react";

export type PasswordStrength = "empty" | "weak" | "fair" | "good" | "strong";

interface PasswordStrengthResult {
  strength: PasswordStrength;
  score: number; // 0–4
  feedback: string[];
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) return { strength: "empty", score: 0, feedback: [] };

  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else feedback.push("At least 8 characters");

  if (password.length >= 12) score++;
  else if (password.length >= 8) feedback.push("12+ characters makes it stronger");

  if (/[A-Z]/.test(password)) score++;
  else feedback.push("Add an uppercase letter");

  if (/[0-9]/.test(password)) score++;
  else feedback.push("Add a number");

  if (/[^A-Za-z0-9]/.test(password)) score++;
  else feedback.push("Add a special character (!, @, #, …)");

  const strength: PasswordStrength =
    score === 0 ? "weak"
    : score <= 1 ? "weak"
    : score === 2 ? "fair"
    : score === 3 ? "good"
    : "strong";

  return { strength, score: Math.min(score, 4), feedback };
}

const STRENGTH_CONFIG: Record<
  Exclude<PasswordStrength, "empty">,
  { label: string; barClass: string; segments: number }
> = {
  weak:   { label: "Weak",   barClass: "bg-red-500",    segments: 1 },
  fair:   { label: "Fair",   barClass: "bg-amber-400",  segments: 2 },
  good:   { label: "Good",   barClass: "bg-blue-500",   segments: 3 },
  strong: { label: "Strong", barClass: "bg-green-500",  segments: 4 },
};

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

export function PasswordStrengthMeter({ password, className = "" }: PasswordStrengthMeterProps) {
  const { strength, score, feedback } = evaluatePasswordStrength(password);

  if (strength === "empty") return null;

  const config = STRENGTH_CONFIG[strength];

  return (
    <div className={`space-y-1.5 ${className}`} aria-live="polite" aria-label={`Password strength: ${config.label}`}>
      {/* Segmented bar */}
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((seg) => (
          <div
            key={seg}
            className={`h-1 flex-1 rounded-full transition-all duration-200 ${
              seg <= config.segments ? config.barClass : "bg-zinc-200 dark:bg-zinc-700"
            }`}
          />
        ))}
      </div>

      {/* Strength label and first feedback hint */}
      <div className="flex items-center justify-between text-xs">
        <span
          className={`font-semibold ${
            strength === "weak"   ? "text-red-500" :
            strength === "fair"   ? "text-amber-500" :
            strength === "good"   ? "text-blue-600 dark:text-blue-400" :
            "text-green-600 dark:text-green-400"
          }`}
        >
          {config.label}
        </span>
        {feedback.length > 0 && (
          <span className="text-zinc-500 dark:text-zinc-400 truncate ml-2 max-w-[180px]">
            {feedback[0]}
          </span>
        )}
      </div>
    </div>
  );
}

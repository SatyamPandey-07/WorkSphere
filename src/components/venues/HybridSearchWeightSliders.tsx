"use client";

import React, { useCallback } from "react";
import { Sparkles, FileText, RotateCcw, Sliders, Info } from "lucide-react";

export interface HybridSearchWeightSlidersProps {
  semanticWeight: number; // 0 to 100 (or 0 to 1)
  fullTextWeight: number; // 0 to 100 (or 0 to 1)
  onSemanticWeightChange: (weight: number) => void;
  onFullTextWeightChange: (weight: number) => void;
  onWeightsChange?: (semanticWeight: number, fullTextWeight: number) => void;
  defaultSemanticWeight?: number; // default: 50
  defaultFullTextWeight?: number; // default: 50
  className?: string;
  showPresets?: boolean;
  showHelpText?: boolean;
}

export const HYBRID_WEIGHT_PRESETS = [
  { id: "balanced", label: "Balanced", semantic: 50, fullText: 50, desc: "Equal blend of AI semantic and exact keyword match" },
  { id: "semantic-focus", label: "Semantic Focus", semantic: 80, fullText: 20, desc: "Prioritize AI conceptual and vibe relevance" },
  { id: "keyword-focus", label: "Keyword Focus", semantic: 20, fullText: 80, desc: "Prioritize exact name and amenity term matches" },
  { id: "semantic-only", label: "Vector Only", semantic: 100, fullText: 0, desc: "Pure vector embedding similarity" },
  { id: "text-only", label: "Full-Text Only", semantic: 0, fullText: 100, desc: "Pure BM25 keyword matching" },
];

/**
 * Normalizes weight to 0-100 range regardless of whether 0-1 or 0-100 was passed.
 */
function toPercent(val: number): number {
  if (val <= 1 && val > 0) return Math.round(val * 100);
  return Math.min(100, Math.max(0, Math.round(val)));
}

export function HybridSearchWeightSliders({
  semanticWeight,
  fullTextWeight,
  onSemanticWeightChange,
  onFullTextWeightChange,
  onWeightsChange,
  defaultSemanticWeight = 50,
  defaultFullTextWeight = 50,
  className = "",
  showPresets = true,
  showHelpText = true,
}: HybridSearchWeightSlidersProps) {
  const normSemantic = toPercent(semanticWeight);
  const normFullText = toPercent(fullTextWeight);

  const isDefault =
    normSemantic === toPercent(defaultSemanticWeight) &&
    normFullText === toPercent(defaultFullTextWeight);

  const handleSemanticChange = useCallback(
    (val: number) => {
      onSemanticWeightChange(val);
      if (onWeightsChange) {
        onWeightsChange(val, normFullText);
      }
    },
    [onSemanticWeightChange, onWeightsChange, normFullText]
  );

  const handleFullTextChange = useCallback(
    (val: number) => {
      onFullTextWeightChange(val);
      if (onWeightsChange) {
        onWeightsChange(normSemantic, val);
      }
    },
    [onFullTextWeightChange, onWeightsChange, normSemantic]
  );

  const handlePresetApply = useCallback(
    (preset: (typeof HYBRID_WEIGHT_PRESETS)[number]) => {
      onSemanticWeightChange(preset.semantic);
      onFullTextWeightChange(preset.fullText);
      if (onWeightsChange) {
        onWeightsChange(preset.semantic, preset.fullText);
      }
    },
    [onSemanticWeightChange, onFullTextWeightChange, onWeightsChange]
  );

  const handleReset = useCallback(() => {
    onSemanticWeightChange(defaultSemanticWeight);
    onFullTextWeightChange(defaultFullTextWeight);
    if (onWeightsChange) {
      onWeightsChange(defaultSemanticWeight, defaultFullTextWeight);
    }
  }, [
    defaultSemanticWeight,
    defaultFullTextWeight,
    onSemanticWeightChange,
    onFullTextWeightChange,
    onWeightsChange,
  ]);

  return (
    <div
      data-testid="hybrid-search-weight-sliders"
      className={`space-y-4 p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <label
              htmlFor="semantic-weight-slider"
              className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300"
            >
              Hybrid Scoring Weights
            </label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Tune balance between AI Semantic & Full-Text keyword matching
            </p>
          </div>
        </div>

        {!isDefault && (
          <button
            type="button"
            data-testid="reset-hybrid-weights-btn"
            onClick={handleReset}
            title="Reset weights to default"
            aria-label="Reset scoring weights to default"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Semantic (Vector) Weight Slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span>Semantic (Vector) Weight</span>
          </div>
          <span
            data-testid="semantic-weight-readout"
            className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
          >
            {normSemantic}%
          </span>
        </div>
        <div className="relative flex items-center">
          <input
            id="semantic-weight-slider"
            data-testid="semantic-weight-slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={normSemantic}
            onChange={(e) => handleSemanticChange(Number(e.target.value))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={normSemantic}
            aria-label="Semantic search vector scoring weight percentage"
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
          <span>0% (Disabled)</span>
          <span>50% (Default)</span>
          <span>100% (Maximum)</span>
        </div>
      </div>

      {/* Full-Text (BM25 Keyword) Weight Slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
            <FileText className="w-3.5 h-3.5 text-blue-500" />
            <span>Full-Text (Keyword) Weight</span>
          </div>
          <span
            data-testid="fulltext-weight-readout"
            className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
          >
            {normFullText}%
          </span>
        </div>
        <div className="relative flex items-center">
          <input
            id="fulltext-weight-slider"
            data-testid="fulltext-weight-slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={normFullText}
            onChange={(e) => handleFullTextChange(Number(e.target.value))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={normFullText}
            aria-label="Full text BM25 keyword scoring weight percentage"
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
          <span>0% (Disabled)</span>
          <span>50% (Default)</span>
          <span>100% (Maximum)</span>
        </div>
      </div>

      {/* Quick Presets */}
      {showPresets && (
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            Quick Ratios:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {HYBRID_WEIGHT_PRESETS.map((preset) => {
              const isSelected =
                normSemantic === preset.semantic &&
                normFullText === preset.fullText;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`preset-weight-${preset.id}`}
                  onClick={() => handlePresetApply(preset)}
                  title={preset.desc}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-400/50"
                  }`}
                >
                  {preset.label} ({preset.semantic}/{preset.fullText})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Help info footer */}
      {showHelpText && (
        <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-start gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <Info className="w-3.5 h-3.5 shrink-0 text-zinc-400 mt-0.5" />
          <span>
            Hybrid search combines PostgreSQL BM25 full-text indexing and Cohere vector embeddings using Reciprocal Rank Fusion (RRF) scaled by these weights.
          </span>
        </div>
      )}
    </div>
  );
}

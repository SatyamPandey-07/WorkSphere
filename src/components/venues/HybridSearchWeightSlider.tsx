"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Sparkles, Search, SlidersHorizontal, RotateCcw, Info } from "lucide-react";

export interface HybridSearchWeightSliderProps {
  semanticWeight?: number; // 0.0 to 1.0 (default: 0.5)
  fullTextWeight?: number; // 0.0 to 1.0 (default: 0.5)
  onChange: (weights: { semanticWeight: number; fullTextWeight: number }) => void;
  className?: string;
  defaultSemanticWeight?: number;
  defaultFullTextWeight?: number;
}

export interface SearchWeightPreset {
  id: string;
  label: string;
  fullText: number;
  semantic: number;
  description: string;
}

export const SEARCH_WEIGHT_PRESETS: SearchWeightPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    fullText: 0.5,
    semantic: 0.5,
    description: "Equal blend of exact keyword matches and AI semantic intent",
  },
  {
    id: "exact_keywords",
    label: "Exact Terms",
    fullText: 0.8,
    semantic: 0.2,
    description: "Prioritizes precise venue names, addresses, and explicit amenities",
  },
  {
    id: "semantic_vibe",
    label: "Vibe & Intent",
    fullText: 0.2,
    semantic: 0.8,
    description: "Emphasizes conversational concepts, atmosphere, and natural descriptions",
  },
  {
    id: "pure_keyword",
    label: "Keyword Only",
    fullText: 1.0,
    semantic: 0.0,
    description: "Traditional BM25 text rank scoring without vector embeddings",
  },
  {
    id: "pure_semantic",
    label: "Semantic Only",
    fullText: 0.0,
    semantic: 1.0,
    description: "Dense vector cosine similarity across semantic workspace embeddings",
  },
];

export function HybridSearchWeightSlider({
  semanticWeight: propSemanticWeight = 0.5,
  fullTextWeight: propFullTextWeight = 0.5,
  onChange,
  className = "",
  defaultSemanticWeight = 0.5,
  defaultFullTextWeight = 0.5,
}: HybridSearchWeightSliderProps) {
  // Normalize internal state into 0-100 percentages
  const [semanticPct, setSemanticPct] = useState<number>(() =>
    Math.round(propSemanticWeight * 100),
  );
  const [fullTextPct, setFullTextPct] = useState<number>(() =>
    Math.round(propFullTextWeight * 100),
  );

  useEffect(() => {
    setSemanticPct(Math.round(propSemanticWeight * 100));
  }, [propSemanticWeight]);

  useEffect(() => {
    setFullTextPct(Math.round(propFullTextWeight * 100));
  }, [propFullTextWeight]);

  // Handle single balance slider change (0 = 100% full-text, 50 = balanced, 100 = 100% semantic)
  const handleBalanceSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value); // 0 to 100
      const semWeight = Number((val / 100).toFixed(2));
      const textWeight = Number(((100 - val) / 100).toFixed(2));
      setSemanticPct(val);
      setFullTextPct(100 - val);
      onChange({ semanticWeight: semWeight, fullTextWeight: textWeight });
    },
    [onChange],
  );

  // Handle preset activation
  const handlePresetSelect = useCallback(
    (preset: SearchWeightPreset) => {
      setFullTextPct(Math.round(preset.fullText * 100));
      setSemanticPct(Math.round(preset.semantic * 100));
      onChange({
        semanticWeight: preset.semantic,
        fullTextWeight: preset.fullText,
      });
    },
    [onChange],
  );

  // Reset to default 50/50 balance
  const handleReset = useCallback(() => {
    setFullTextPct(Math.round(defaultFullTextWeight * 100));
    setSemanticPct(Math.round(defaultSemanticWeight * 100));
    onChange({
      semanticWeight: defaultSemanticWeight,
      fullTextWeight: defaultFullTextWeight,
    });
  }, [onChange, defaultSemanticWeight, defaultFullTextWeight]);

  const isBalanced =
    Math.abs(semanticPct - 50) <= 2 && Math.abs(fullTextPct - 50) <= 2;

  // Active preset matching
  const currentPreset = SEARCH_WEIGHT_PRESETS.find(
    (p) =>
      Math.abs(Math.round(p.semantic * 100) - semanticPct) <= 3 &&
      Math.abs(Math.round(p.fullText * 100) - fullTextPct) <= 3,
  );

  return (
    <div
      data-testid="hybrid-search-weight-slider-container"
      className={`space-y-3.5 p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      {/* Header with Badges and Reset Action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <SlidersHorizontal className="w-4 h-4" />
          </div>
          <div>
            <label
              htmlFor="hybrid-search-balance-slider"
              className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300"
            >
              Hybrid Search Scoring Weights
            </label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Tune balance between exact keywords and semantic meaning
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isBalanced && (
            <button
              type="button"
              data-testid="reset-search-weights-btn"
              onClick={handleReset}
              title="Reset to 50/50 balanced scoring"
              aria-label="Reset search scoring weights to balanced"
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Dual Weight Visual Badges */}
      <div className="grid grid-cols-2 gap-2">
        <div
          data-testid="fulltext-weight-badge"
          className="flex items-center justify-between p-2.5 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20"
        >
          <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs font-semibold">Full-Text BM25</span>
          </div>
          <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
            {fullTextPct}%
          </span>
        </div>

        <div
          data-testid="semantic-weight-badge"
          className="flex items-center justify-between p-2.5 rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20"
        >
          <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs font-semibold">Semantic AI</span>
          </div>
          <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
            {semanticPct}%
          </span>
        </div>
      </div>

      {/* Interactive Balance Slider */}
      <div className="space-y-1.5 pt-1">
        <div className="relative flex items-center">
          <input
            id="hybrid-search-balance-slider"
            data-testid="hybrid-search-balance-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={semanticPct}
            onChange={handleBalanceSliderChange}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={semanticPct}
            aria-label="Hybrid search balance slider (Full-Text to Semantic AI)"
            className="w-full h-2 bg-gradient-to-r from-blue-500 via-zinc-400 to-purple-500 rounded-lg appearance-none cursor-pointer accent-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
          />
        </div>

        {/* Labels below slider */}
        <div className="flex justify-between text-[10px] font-mono font-bold text-zinc-400 select-none">
          <span className="text-blue-600 dark:text-blue-400">100% Keywords</span>
          <span className={isBalanced ? "text-zinc-700 dark:text-zinc-200 font-black" : ""}>
            50/50 Balanced
          </span>
          <span className="text-purple-600 dark:text-purple-400">100% Semantic</span>
        </div>
      </div>

      {/* Preset Quick-Buttons */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
          Scoring Presets:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SEARCH_WEIGHT_PRESETS.map((preset) => {
            const isSelected = currentPreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`preset-search-weight-${preset.id}`}
                onClick={() => handlePresetSelect(preset)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                  isSelected
                    ? "bg-purple-600 text-white shadow-sm shadow-purple-500/20"
                    : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-purple-400/50"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Description / Explanatory footer */}
      <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-purple-500" />
        <p className="text-[11px] leading-tight">
          {currentPreset
            ? currentPreset.description
            : `${fullTextPct}% keyword exactness + ${semanticPct}% contextual vector relevance blended via Reciprocal Rank Fusion (RRF).`}
        </p>
      </div>
    </div>
  );
}

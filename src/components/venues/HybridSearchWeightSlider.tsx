"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles,
  Search,
  SlidersHorizontal,
  RotateCcw,
  Info,
  MapPin,
  Star,
  Cpu,
} from "lucide-react";
import {
  HybridScoringWeights,
  VenueScoringRecord,
} from "@/lib/search/hybridSearchWorkerEngine";
import { useHybridSearchWorker } from "@/hooks/useHybridSearchWorker";

export interface HybridSearchWeights {
  semanticWeight: number; // 0.0 to 1.0
  fullTextWeight: number; // 0.0 to 1.0
  proximityWeight?: number; // 0.0 to 1.0
  ratingWeight?: number; // 0.0 to 1.0
}

export interface HybridSearchWeightSliderProps {
  semanticWeight?: number; // 0.0 to 1.0 (default: 0.5)
  fullTextWeight?: number; // 0.0 to 1.0 (default: 0.5)
  proximityWeight?: number; // 0.0 to 1.0 (default: 0.5)
  ratingWeight?: number; // 0.0 to 1.0 (default: 0.5)
  onChange: (weights: HybridSearchWeights) => void;
  className?: string;
  defaultSemanticWeight?: number;
  defaultFullTextWeight?: number;
  defaultProximityWeight?: number;
  defaultRatingWeight?: number;
  venues?: VenueScoringRecord[];
  preIndexedVenues?: {
    venueIds: string[];
    scoresBuffer: ArrayBuffer;
    stride?: number;
  };
  onSortedVenueIdsChange?: (sortedIds: string[]) => void;
  onScoringComplete?: (result: {
    sortedIds: string[];
    executionTimeMs: number;
  }) => void;
  showMultiMetricSliders?: boolean;
}

export interface SearchWeightPreset {
  id: string;
  label: string;
  fullText: number;
  semantic: number;
  proximity: number;
  rating: number;
  description: string;
}

export const SEARCH_WEIGHT_PRESETS: SearchWeightPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    fullText: 0.5,
    semantic: 0.5,
    proximity: 0.5,
    rating: 0.5,
    description: "Equal blend of exact keyword matches and AI semantic intent",
  },
  {
    id: "exact_keywords",
    label: "Exact Terms",
    fullText: 0.8,
    semantic: 0.2,
    proximity: 0.3,
    rating: 0.3,
    description:
      "Prioritizes precise venue names, addresses, and explicit amenities",
  },
  {
    id: "semantic_vibe",
    label: "Vibe & Intent",
    fullText: 0.2,
    semantic: 0.8,
    proximity: 0.2,
    rating: 0.4,
    description:
      "Emphasizes conversational concepts, atmosphere, and natural descriptions",
  },
  {
    id: "nearby_first",
    label: "Closest First",
    fullText: 0.3,
    semantic: 0.3,
    proximity: 0.8,
    rating: 0.3,
    description:
      "Heavily prioritizes proximity distance to the user's current location",
  },
  {
    id: "top_rated",
    label: "Top Rated",
    fullText: 0.3,
    semantic: 0.3,
    proximity: 0.2,
    rating: 0.8,
    description:
      "Highlights venues with highest member ratings and verified reviews",
  },
  {
    id: "pure_keyword",
    label: "Keyword Only",
    fullText: 1.0,
    semantic: 0.0,
    proximity: 0.0,
    rating: 0.0,
    description: "Traditional BM25 text rank scoring without vector embeddings",
  },
  {
    id: "pure_semantic",
    label: "Semantic Only",
    fullText: 0.0,
    semantic: 1.0,
    proximity: 0.0,
    rating: 0.0,
    description:
      "Dense vector cosine similarity across semantic workspace embeddings",
  },
];

export function HybridSearchWeightSlider({
  semanticWeight: propSemanticWeight = 0.5,
  fullTextWeight: propFullTextWeight = 0.5,
  proximityWeight: propProximityWeight = 0.5,
  ratingWeight: propRatingWeight = 0.5,
  onChange,
  className = "",
  defaultSemanticWeight = 0.5,
  defaultFullTextWeight = 0.5,
  defaultProximityWeight = 0.5,
  defaultRatingWeight = 0.5,
  venues,
  preIndexedVenues,
  onSortedVenueIdsChange,
  onScoringComplete,
  showMultiMetricSliders = true,
}: HybridSearchWeightSliderProps) {
  // Normalize internal state into 0-100 percentages
  const [semanticPct, setSemanticPct] = useState<number>(() =>
    Math.round(propSemanticWeight * 100),
  );
  const [fullTextPct, setFullTextPct] = useState<number>(() =>
    Math.round(propFullTextWeight * 100),
  );
  const [proximityPct, setProximityPct] = useState<number>(() =>
    Math.round(propProximityWeight * 100),
  );
  const [ratingPct, setRatingPct] = useState<number>(() =>
    Math.round(propRatingWeight * 100),
  );

  // Sync with prop updates
  useEffect(() => {
    setSemanticPct(Math.round(propSemanticWeight * 100));
  }, [propSemanticWeight]);

  useEffect(() => {
    setFullTextPct(Math.round(propFullTextWeight * 100));
  }, [propFullTextWeight]);

  useEffect(() => {
    setProximityPct(Math.round(propProximityWeight * 100));
  }, [propProximityWeight]);

  useEffect(() => {
    setRatingPct(Math.round(propRatingWeight * 100));
  }, [propRatingWeight]);

  // Dedicated Web Worker for offloaded scoring
  const initialWeights = useMemo<HybridScoringWeights>(
    () => ({
      semanticWeight: propSemanticWeight,
      fullTextWeight: propFullTextWeight,
      proximityWeight: propProximityWeight,
      ratingWeight: propRatingWeight,
    }),
    [
      propSemanticWeight,
      propFullTextWeight,
      propProximityWeight,
      propRatingWeight,
    ],
  );

  const { sortedIds, isScoring, executionTimeMs, score } =
    useHybridSearchWorker({
      venues,
      preIndexedVenues,
      initialWeights,
      onSortedIds: onSortedVenueIdsChange,
      onScoringComplete,
    });

  // Dispatches updated weights and triggers worker scoring
  const dispatchWeightChanges = useCallback(
    (sem: number, txt: number, prox: number, rat: number) => {
      const weights: HybridSearchWeights = {
        semanticWeight: Number((sem / 100).toFixed(2)),
        fullTextWeight: Number((txt / 100).toFixed(2)),
        proximityWeight: Number((prox / 100).toFixed(2)),
        ratingWeight: Number((rat / 100).toFixed(2)),
      };

      onChange(weights);
      score(weights);
    },
    [onChange, score],
  );

  // Handle single balance slider change (0 = 100% full-text, 50 = balanced, 100 = 100% semantic)
  const handleBalanceSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      const textVal = 100 - val;
      setSemanticPct(val);
      setFullTextPct(textVal);
      dispatchWeightChanges(val, textVal, proximityPct, ratingPct);
    },
    [dispatchWeightChanges, proximityPct, ratingPct],
  );

  // Handle individual slider changes
  const handleSemanticSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setSemanticPct(val);
      dispatchWeightChanges(val, fullTextPct, proximityPct, ratingPct);
    },
    [dispatchWeightChanges, fullTextPct, proximityPct, ratingPct],
  );

  const handleProximitySliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setProximityPct(val);
      dispatchWeightChanges(semanticPct, fullTextPct, val, ratingPct);
    },
    [dispatchWeightChanges, semanticPct, fullTextPct, ratingPct],
  );

  const handleRatingSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setRatingPct(val);
      dispatchWeightChanges(semanticPct, fullTextPct, proximityPct, val);
    },
    [dispatchWeightChanges, semanticPct, fullTextPct, proximityPct],
  );

  // Handle preset activation
  const handlePresetSelect = useCallback(
    (preset: SearchWeightPreset) => {
      const txt = Math.round(preset.fullText * 100);
      const sem = Math.round(preset.semantic * 100);
      const prox = Math.round(preset.proximity * 100);
      const rat = Math.round(preset.rating * 100);

      setFullTextPct(txt);
      setSemanticPct(sem);
      setProximityPct(prox);
      setRatingPct(rat);

      dispatchWeightChanges(sem, txt, prox, rat);
    },
    [dispatchWeightChanges],
  );

  // Reset to default balance
  const handleReset = useCallback(() => {
    const txt = Math.round(defaultFullTextWeight * 100);
    const sem = Math.round(defaultSemanticWeight * 100);
    const prox = Math.round(defaultProximityWeight * 100);
    const rat = Math.round(defaultRatingWeight * 100);

    setFullTextPct(txt);
    setSemanticPct(sem);
    setProximityPct(prox);
    setRatingPct(rat);

    dispatchWeightChanges(sem, txt, prox, rat);
  }, [
    defaultFullTextWeight,
    defaultSemanticWeight,
    defaultProximityWeight,
    defaultRatingWeight,
    dispatchWeightChanges,
  ]);

  const isBalanced =
    Math.abs(semanticPct - 50) <= 2 &&
    Math.abs(fullTextPct - 50) <= 2 &&
    Math.abs(proximityPct - 50) <= 2 &&
    Math.abs(ratingPct - 50) <= 2;

  // Active preset matching
  const currentPreset = SEARCH_WEIGHT_PRESETS.find(
    (p) =>
      Math.abs(Math.round(p.semantic * 100) - semanticPct) <= 4 &&
      Math.abs(Math.round(p.fullText * 100) - fullTextPct) <= 4,
  );

  return (
    <div
      data-testid="hybrid-search-weight-slider-container"
      className={`space-y-3.5 p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      {/* Header with Badges, 60fps Worker Status, and Reset Action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <SlidersHorizontal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="hybrid-search-balance-slider"
                className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300"
              >
                Hybrid Search Scoring Weights
              </label>
              {/* Web Worker 60fps status pill */}
              <div
                data-testid="worker-scoring-status"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                  isScoring
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                    : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                }`}
                title="Scoring calculations offloaded to dedicated Web Worker (hybridSearch.worker.ts)"
              >
                <Cpu className="w-2.5 h-2.5" />
                <span>
                  {isScoring
                    ? "Worker: Scoring..."
                    : `Worker: 60fps (${executionTimeMs.toFixed(1)}ms)`}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Tune balance between semantic match, proximity, and rating
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isBalanced && (
            <button
              type="button"
              data-testid="reset-search-weights-btn"
              onClick={handleReset}
              title="Reset to balanced scoring"
              aria-label="Reset search scoring weights to balanced"
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Dual / Multi Weight Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div
          data-testid="fulltext-weight-badge"
          className="flex items-center justify-between p-2 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20"
        >
          <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
            <Search className="w-3 h-3 shrink-0" />
            <span className="text-[11px] font-semibold">Keywords</span>
          </div>
          <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
            {fullTextPct}%
          </span>
        </div>

        <div
          data-testid="semantic-weight-badge"
          className="flex items-center justify-between p-2 rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20"
        >
          <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300">
            <Sparkles className="w-3 h-3 shrink-0" />
            <span className="text-[11px] font-semibold">Semantic</span>
          </div>
          <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
            {semanticPct}%
          </span>
        </div>

        <div
          data-testid="proximity-weight-badge"
          className="flex items-center justify-between p-2 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20"
        >
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="text-[11px] font-semibold">Proximity</span>
          </div>
          <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
            {proximityPct}%
          </span>
        </div>

        <div
          data-testid="rating-weight-badge"
          className="flex items-center justify-between p-2 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20"
        >
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <Star className="w-3 h-3 shrink-0" />
            <span className="text-[11px] font-semibold">Rating</span>
          </div>
          <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
            {ratingPct}%
          </span>
        </div>
      </div>

      {/* Main Dual Balance Slider */}
      <div className="space-y-1.5 pt-1">
        <div className="flex justify-between items-center text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          <span>Keywords vs Semantic Balance</span>
          <span className="font-mono text-[11px]">
            {100 - semanticPct}% : {semanticPct}%
          </span>
        </div>
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
        <div className="flex justify-between text-[10px] font-mono font-bold text-zinc-400 select-none">
          <span className="text-blue-600 dark:text-blue-400">
            100% Keywords
          </span>
          <span
            className={
              isBalanced ? "text-zinc-700 dark:text-zinc-200 font-black" : ""
            }
          >
            50/50 Balanced
          </span>
          <span className="text-purple-600 dark:text-purple-400">
            100% Semantic
          </span>
        </div>
      </div>

      {/* Multi-Criteria Sliders: Semantic, Proximity, Rating */}
      {showMultiMetricSliders && (
        <div className="space-y-3 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70">
          {/* Semantic Match Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                <Sparkles className="w-3 h-3" />
                Semantic Match Weight
              </span>
              <span className="font-mono font-bold">{semanticPct}%</span>
            </div>
            <input
              id="semantic-weight-slider"
              data-testid="semantic-weight-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={semanticPct}
              onChange={handleSemanticSliderChange}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={semanticPct}
              aria-label="Semantic match scoring weight percentage"
              className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-600 focus:outline-none"
            />
          </div>

          {/* Proximity Distance Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <MapPin className="w-3 h-3" />
                Proximity / Distance Weight
              </span>
              <span className="font-mono font-bold">{proximityPct}%</span>
            </div>
            <input
              id="proximity-weight-slider"
              data-testid="proximity-weight-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={proximityPct}
              onChange={handleProximitySliderChange}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={proximityPct}
              aria-label="Proximity scoring weight percentage"
              className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-600 focus:outline-none"
            />
          </div>

          {/* Rating / Quality Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Star className="w-3 h-3" />
                Venue Rating / Quality Weight
              </span>
              <span className="font-mono font-bold">{ratingPct}%</span>
            </div>
            <input
              id="rating-weight-slider"
              data-testid="rating-weight-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={ratingPct}
              onChange={handleRatingSliderChange}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ratingPct}
              aria-label="Rating scoring weight percentage"
              className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-600 focus:outline-none"
            />
          </div>
        </div>
      )}

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

      {/* Explanatory footer with worker summary */}
      <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-purple-500" />
        <p className="text-[11px] leading-tight">
          {currentPreset
            ? currentPreset.description
            : `${fullTextPct}% keywords + ${semanticPct}% semantic + ${proximityPct}% proximity + ${ratingPct}% rating blended via Web Worker offloaded RRF ranking.`}
          {sortedIds.length > 0 && (
            <span
              data-testid="sorted-venues-count"
              className="ml-1 text-purple-600 dark:text-purple-400 font-semibold"
            >
              ({sortedIds.length} venues sorted)
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

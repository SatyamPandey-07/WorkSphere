export type SentimentLabel = "positive" | "mixed" | "needs_improvement";

export interface SentimentReview {
  comment?: string | null;
  wifiQuality?: number | null;
  noiseLevel?: string | null;
  hasOutlets?: boolean | null;
  createdAt?: string | Date | null;
}

export interface SentimentSummary {
  label: SentimentLabel;
  /** Average review score from -1 (very negative) to 1 (very positive). */
  score: number;
  /** Number of reviews that contributed to the score. */
  reviewCount: number;
  /** Short "Loved for" tags, strongest first (max 3). */
  highlights: string[];
}

export const MIN_REVIEWS_FOR_SENTIMENT = 3;
export const MAX_REVIEWS_FOR_SENTIMENT = 50;

const POSITIVE_THRESHOLD = 0.3;
const NEEDS_IMPROVEMENT_THRESHOLD = -0.2;
const MAX_HIGHLIGHTS = 3;

const POSITIVE_WORDS = new Set([
  "great",
  "good",
  "excellent",
  "amazing",
  "awesome",
  "fantastic",
  "perfect",
  "love",
  "loved",
  "best",
  "nice",
  "lovely",
  "fast",
  "quiet",
  "calm",
  "peaceful",
  "comfortable",
  "comfy",
  "cozy",
  "clean",
  "friendly",
  "helpful",
  "reliable",
  "spacious",
  "smooth",
  "productive",
  "recommend",
]);

const NEGATIVE_WORDS = new Set([
  "bad",
  "poor",
  "terrible",
  "awful",
  "worst",
  "slow",
  "noisy",
  "loud",
  "crowded",
  "cramped",
  "dirty",
  "uncomfortable",
  "unreliable",
  "unstable",
  "laggy",
  "broken",
  "rude",
  "overpriced",
  "disappointing",
]);

const NEGATIONS = new Set([
  "not",
  "no",
  "never",
  "isn't",
  "wasn't",
  "aren't",
  "don't",
  "doesn't",
  "didn't",
  "hardly",
  "barely",
]);

const INTENSIFIERS = new Set(["very", "really", "so", "too", "that"]);

const SEATING_PATTERN =
  /\b(seat|seats|seating|chair|chairs|sofa|sofas|couch|couches|desk|desks)\b/i;

const isNegated = (tokens: string[], index: number): boolean => {
  let previous = index - 1;
  if (previous >= 0 && INTENSIFIERS.has(tokens[previous])) previous -= 1;
  return previous >= 0 && NEGATIONS.has(tokens[previous]);
};

export interface SentimentAnalysisResult {
  score: number;
  category: "positive" | "neutral" | "negative";
  tokenCount: number;
}

/**
 * Analyzes sentiment for a text string.
 * Returns clean neutral score object ({ score: 0.0, category: "neutral", tokenCount: 0 })
 * when the string is empty or contains only emoji/punctuation.
 */
export function analyzeSentiment(
  comment: string | null | undefined,
): SentimentAnalysisResult {
  if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
    return { score: 0.0, category: "neutral", tokenCount: 0 };
  }

  const tokens = comment.toLowerCase().match(/[a-z']+/g);
  if (!tokens || tokens.length === 0) {
    return { score: 0.0, category: "neutral", tokenCount: 0 };
  }

  let positive = 0;
  let negative = 0;
  tokens.forEach((token, index) => {
    const isPositive = POSITIVE_WORDS.has(token);
    const isNegative = NEGATIVE_WORDS.has(token);
    if (!isPositive && !isNegative) return;
    const flipped = isNegated(tokens, index);
    if (isPositive !== flipped) positive += 1;
    else negative += 1;
  });

  const total = positive + negative;
  if (total === 0) {
    return { score: 0.0, category: "neutral", tokenCount: tokens.length };
  }

  const rawScore = (positive - negative) / total;
  const score = Math.round(rawScore * 100) / 100;
  const category: "positive" | "neutral" | "negative" =
    score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";

  return { score, category, tokenCount: tokens.length };
}

/**
 * Scores one comment from -1 (all negative words) to 1 (all positive words).
 * Returns null when it contains no sentiment words or when token count is zero.
 * "not bad" counts as positive and "not good" as negative.
 */
export function scoreComment(
  comment: string | null | undefined,
): number | null {
  if (!comment || typeof comment !== "string" || comment.trim().length === 0) return null;
  const tokens = comment.toLowerCase().match(/[a-z']+/g);
  if (!tokens || tokens.length === 0) return null;

  let positive = 0;
  let negative = 0;
  tokens.forEach((token, index) => {
    const isPositive = POSITIVE_WORDS.has(token);
    const isNegative = NEGATIVE_WORDS.has(token);
    if (!isPositive && !isNegative) return;
    const flipped = isNegated(tokens, index);
    if (isPositive !== flipped) positive += 1;
    else negative += 1;
  });

  const total = positive + negative;
  return total === 0 ? null : (positive - negative) / total;
}

const wifiSignal = (quality: number | null | undefined): number | null =>
  typeof quality === "number" && quality >= 1 && quality <= 5
    ? (quality - 3) / 2
    : null;

const noiseSignal = (level: string | null | undefined): number | null => {
  const value = level?.toLowerCase();
  if (value === "quiet") return 1;
  if (value === "moderate") return 0;
  if (value === "loud") return -1;
  return null;
};

const isNumber = (value: number | null): value is number =>
  typeof value === "number" && !Number.isNaN(value) && Number.isFinite(value);

/** Average of the available signals: comment words, WiFi rating, noise level. */
function reviewScore(review: SentimentReview): number | null {
  const signals = [
    scoreComment(review.comment),
    wifiSignal(review.wifiQuality),
    noiseSignal(review.noiseLevel),
  ].filter(isNumber);
  if (signals.length === 0) return null;
  const avg = signals.reduce((sum, value) => sum + value, 0) / signals.length;
  return Number.isNaN(avg) || !Number.isFinite(avg) ? null : avg;
}

const timestamp = (review: SentimentReview): number => {
  if (!review.createdAt) return 0;
  const time = new Date(review.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
};

interface Theme {
  label: string;
  strength: number;
}

function buildHighlights(reviews: SentimentReview[]): string[] {
  const themes: Theme[] = [];

  const noise = reviews.map((r) => noiseSignal(r.noiseLevel)).filter(isNumber);
  if (noise.length >= MIN_REVIEWS_FOR_SENTIMENT) {
    const quietShare = noise.filter((v) => v === 1).length / noise.length;
    if (quietShare >= 0.6) {
      themes.push({ label: "Quiet atmosphere", strength: quietShare });
    }
  }

  const wifi = reviews
    .map((r) => r.wifiQuality)
    .filter((q): q is number => typeof q === "number" && q >= 1 && q <= 5);
  if (wifi.length >= MIN_REVIEWS_FOR_SENTIMENT) {
    const average = wifi.reduce((sum, q) => sum + q, 0) / wifi.length;
    if (average >= 4) {
      themes.push({ label: "Fast WiFi", strength: (average - 3) / 2 });
    }
  }

  const outlets = reviews
    .map((r) => r.hasOutlets)
    .filter((v): v is boolean => typeof v === "boolean");
  if (outlets.length >= MIN_REVIEWS_FOR_SENTIMENT) {
    const share = outlets.filter(Boolean).length / outlets.length;
    if (share >= 0.7) {
      themes.push({ label: "Plenty of outlets", strength: share });
    }
  }

  let positiveSeating = 0;
  let negativeSeating = 0;
  for (const review of reviews) {
    if (!review.comment || !SEATING_PATTERN.test(review.comment)) continue;
    const score = scoreComment(review.comment);
    if (score === null) continue;
    if (score > 0) positiveSeating += 1;
    else if (score < 0) negativeSeating += 1;
  }
  if (positiveSeating >= 2 && positiveSeating > negativeSeating) {
    themes.push({
      label: "Comfortable seating",
      strength: positiveSeating / (positiveSeating + negativeSeating),
    });
  }

  return themes
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_HIGHLIGHTS)
    .map((theme) => theme.label);
}

/**
 * Summarises the sentiment of the most recent reviews. Returns null when
 * fewer than MIN_REVIEWS_FOR_SENTIMENT reviews carry a usable signal, so the
 * UI never shows a label based on one or two opinions.
 */
export function summarizeReviewSentiment(
  reviews: SentimentReview[] | null | undefined,
): SentimentSummary | null {
  if (!reviews || reviews.length === 0) return null;

  const recent = [...reviews]
    .sort((a, b) => timestamp(b) - timestamp(a))
    .slice(0, MAX_REVIEWS_FOR_SENTIMENT);

  const scores = recent.map(reviewScore).filter(isNumber);
  if (scores.length < MIN_REVIEWS_FOR_SENTIMENT) return null;

  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  if (Number.isNaN(score) || !Number.isFinite(score)) return null;

  let label: SentimentLabel = "mixed";
  if (score >= POSITIVE_THRESHOLD) label = "positive";
  else if (score <= NEEDS_IMPROVEMENT_THRESHOLD) label = "needs_improvement";

  return {
    label,
    score: Math.round(score * 100) / 100,
    reviewCount: scores.length,
    highlights: buildHighlights(recent),
  };
}

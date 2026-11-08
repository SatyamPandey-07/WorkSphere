/**
 * Review Moderation & Content Scoring Service.
 *
 * Provides profanity filtering, sentiment scoring, spam detection heuristics,
 * and text sanitization for user-generated venue reviews and comments.
 */

import { ModerationResult } from "./types";

const DEFAULT_PROFANITY_LIST = [
  "abuse",
  "asshole",
  "bastard",
  "bitch",
  "bullshit",
  "crap",
  "cunt",
  "damn",
  "dick",
  "douche",
  "fuck",
  "motherfucker",
  "nigger",
  "piss",
  "prick",
  "pussy",
  "shit",
  "slut",
  "twat",
  "wanker",
  "whore",
];

const POSITIVE_WORDS = [
  "great",
  "excellent",
  "amazing",
  "awesome",
  "quiet",
  "fast",
  "perfect",
  "clean",
  "friendly",
  "comfortable",
  "productive",
  "good",
  "best",
  "love",
  "loved",
  "recommend",
  "reliable",
  "spacious",
  "helpful",
  "superb",
  "solid",
];

const NEGATIVE_WORDS = [
  "bad",
  "terrible",
  "horrible",
  "awful",
  "loud",
  "slow",
  "noisy",
  "dirty",
  "rude",
  "uncomfortable",
  "cramped",
  "broken",
  "worst",
  "hate",
  "hated",
  "unusable",
  "unreliable",
  "poor",
  "avoid",
  "disaster",
  "disappointing",
];

export class ReviewModerator {
  private profanitySet: Set<string>;

  constructor(customProfanityList: string[] = DEFAULT_PROFANITY_LIST) {
    this.profanitySet = new Set(
      customProfanityList.map((w) => w.toLowerCase()),
    );
  }

  /**
   * Evaluates text for profanity, sentiment, spam, and policy violations.
   */
  public moderateComment(comment: string | null | undefined): ModerationResult {
    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return {
        flagged: false,
        score: 0,
        sentiment: "neutral",
        sanitizedComment: "",
        reasons: [],
      };
    }

    const trimmed = comment.trim();
    const reasons: string[] = [];
    const lower = trimmed.toLowerCase();

    // 1. Profanity Detection
    const words = lower.match(/\b[a-z0-9_-]+\b/g) || [];
    const flaggedWords: string[] = [];

    for (const word of words) {
      if (this.profanitySet.has(word)) {
        flaggedWords.push(word);
      }
    }

    if (flaggedWords.length > 0) {
      reasons.push(
        `Contains prohibited terminology: ${Array.from(new Set(flaggedWords)).join(", ")}`,
      );
    }

    // 2. Spam & Heuristic Checks
    const urlMatches = trimmed.match(/https?:\/\/[^\s]+/gi) || [];
    if (urlMatches.length > 2) {
      reasons.push("Excessive links detected");
    }

    if (/([a-zA-Z])\1{5,}/.test(trimmed)) {
      reasons.push("Excessive character repetition detected");
    }

    const capsLength = (trimmed.match(/[A-Z]/g) || []).length;
    if (trimmed.length > 20 && capsLength / trimmed.length > 0.75) {
      reasons.push("Excessive capitalization detected");
    }

    // 3. Sentiment Scoring
    const score = this.calculateSentimentScore(words);
    const sentiment: "positive" | "neutral" | "negative" =
      score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";

    // 4. Comment Sanitization
    let sanitizedComment = trimmed;
    for (const flaggedWord of flaggedWords) {
      const regex = new RegExp(`\\b${flaggedWord}\\b`, "gi");
      sanitizedComment = sanitizedComment.replace(
        regex,
        "*".repeat(flaggedWord.length),
      );
    }

    return {
      flagged: reasons.length > 0,
      score,
      sentiment,
      sanitizedComment,
      reasons,
    };
  }

  /**
   * Calculates a normalized sentiment score between -1.0 and 1.0.
   */
  public calculateSentimentScore(words: string[]): number {
    if (words.length === 0) return 0;

    let positiveCount = 0;
    let negativeCount = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const isNegated =
        i > 0 && ["not", "no", "never", "hardly", "barely", "isnt", "wasnt"].includes(words[i - 1]);

      if (POSITIVE_WORDS.includes(word)) {
        if (isNegated) negativeCount++;
        else positiveCount++;
      } else if (NEGATIVE_WORDS.includes(word)) {
        if (isNegated) positiveCount++;
        else negativeCount++;
      }
    }

    const totalMatches = positiveCount + negativeCount;
    if (totalMatches === 0) return 0;

    const rawScore = (positiveCount - negativeCount) / totalMatches;
    return Math.round(rawScore * 100) / 100;
  }

  /**
   * Validates general review content payload.
   */
  public validateReviewContent(review: {
    comment?: string | null;
    wifiQuality?: number;
    noiseLevel?: string;
  }): { isValid: boolean; moderation: ModerationResult } {
    const moderation = this.moderateComment(review.comment);
    return {
      isValid: !moderation.flagged,
      moderation,
    };
  }
}

export const defaultReviewModerator = new ReviewModerator();

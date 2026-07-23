"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type SpeedOption = (typeof SPEED_OPTIONS)[number];

export function splitTextIntoSentences(text: string): string[] {
  if (!text) return [];
  // Strip UI components <ui-component ... />
  const cleanText = text
    .replace(/<ui-component\s+name="[^"]+"\s+props='[^']+'\s*\/>/g, "")
    .trim();
  if (!cleanText) return [];

  // Split on sentence boundaries (. ! ?) avoiding numbered list prefixes like "1."
  const sentences = cleanText.split(/(?<=[!?])\s+|(?<=(?<!\b\d+)\.)\s+/g);
  return sentences.length > 0 ? sentences : [cleanText];
}

export interface UseSpeechSynthesisOptions {
  /** Initial playback rate (default: 1) */
  defaultRate?: number;
  /** Initial pitch parameter (default: 1, range: 0 to 2) */
  defaultPitch?: number;
  /** Optional language tag (e.g., "en-US") */
  lang?: string;
  /** Callback fired when speech starts */
  onStart?: () => void;
  /** Callback fired when speech ends normally */
  onEnd?: () => void;
  /** Callback fired on speech synthesis error */
  onError?: (event: SpeechSynthesisErrorEvent) => void;
}

export interface UseSpeechSynthesisReturn {
  /** Whether window.speechSynthesis and SpeechSynthesisUtterance are supported */
  isSupported: boolean;
  /** True while speech is currently active */
  isSpeaking: boolean;
  /** True while speech is paused */
  isPaused: boolean;
  /** Current playback rate (0.75x to 2x) */
  rate: number;
  /** Current pitch (0 to 2) */
  pitch: number;
  /** Currently selected voice */
  voice: SpeechSynthesisVoice | null;
  /** List of available system voices */
  voices: SpeechSynthesisVoice[];
  /** Error message if synthesis fails */
  error: string | null;
  /** Active speaking message ID (for sentence highlighting player) */
  speakingMessageId: string | null;
  /** Active speaking sentence index (for sentence highlighting player) */
  speakingSentenceIndex: number | null;
  /** Start or restart speaking text */
  speak: (textToSpeak?: string) => void;
  /** Speak a specific message ID with sentence tracking */
  speakMessage: (messageId: string, text: string) => void;
  /** Stop speech and reset state */
  stopSpeech: () => void;
  /** Stop speech and cancel queue */
  cancel: () => void;
  /** Pause active speech */
  pause: () => void;
  /** Resume paused speech */
  resume: () => void;
  /** Update playback rate (clamped between 0.75 and 2) */
  setRate: (newRate: number) => void;
  /** Update pitch parameter (clamped between 0 and 2) */
  setPitch: (newPitch: number) => void;
  /** Select specific voice */
  setVoice: (newVoice: SpeechSynthesisVoice | null) => void;
}

/**
 * Custom hook wrapping the Web Speech API's SpeechSynthesis interface.
 * Manages playback rate, pitch, voice selection, sentence highlighting, and state handlers.
 */
export function useSpeechSynthesis(
  textToSpeakDefault: string = "",
  options: UseSpeechSynthesisOptions = {},
): UseSpeechSynthesisReturn {
  const {
    defaultRate = 1,
    defaultPitch = 1,
    lang = "en-US",
    onStart,
    onEnd,
    onError,
  } = options;

  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [rate, setRateState] = useState<number>(defaultRate);
  const [pitch, setPitchState] = useState<number>(defaultPitch);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const [speakingSentenceIndex, setSpeakingSentenceIndex] = useState<
    number | null
  >(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const currentTextRef = useRef<string>(textToSpeakDefault);

  useEffect(() => {
    currentTextRef.current = textToSpeakDefault;
  }, [textToSpeakDefault]);

  // Check browser support and load available voices
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window
    ) {
      setIsSupported(true);

      const updateVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        setVoices(availableVoices);
        if (availableVoices.length > 0 && !voice) {
          const defaultLangVoice =
            availableVoices.find((v) => v.lang.startsWith(lang)) ||
            availableVoices.find((v) => v.default) ||
            availableVoices[0];
          setVoice(defaultLangVoice || null);
        }
      };

      updateVoices();

      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = updateVoices;
      }
    } else {
      setIsSupported(false);
    }
  }, [lang, voice]);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      setSpeakingMessageId(null);
      setSpeakingSentenceIndex(null);
      utterancesRef.current = [];
    }
  }, []);

  const stopSpeech = useCallback(() => {
    cancel();
  }, [cancel]);

  const pause = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  const speak = useCallback(
    (textOverride?: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setError("Speech synthesis is not supported in this environment.");
        return;
      }

      const textToRead = textOverride ?? currentTextRef.current;
      if (!textToRead || textToRead.trim() === "") {
        return;
      }

      // Cancel ongoing speech before starting a new utterance
      window.speechSynthesis.cancel();
      setError(null);

      const utterance = new SpeechSynthesisUtterance(textToRead);
      utterance.rate = rate;
      utterance.pitch = pitch;
      if (voice) {
        utterance.voice = voice;
      } else if (lang) {
        utterance.lang = lang;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
        onStart?.();
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        onEnd?.();
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        setIsSpeaking(false);
        setIsPaused(false);
        setError(event.error || "Speech synthesis error occurred.");
        onError?.(event);
      };

      utterance.onpause = () => {
        setIsPaused(true);
      };

      utterance.onresume = () => {
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [rate, pitch, voice, lang, onStart, onEnd, onError],
  );

  const speakMessage = useCallback(
    (messageId: string, text: string) => {
      stopSpeech();

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }

      const sentences = splitTextIntoSentences(text);
      if (sentences.length === 0) return;

      const utterances: SpeechSynthesisUtterance[] = [];

      sentences.forEach((sentenceText, idx) => {
        const utterance = new SpeechSynthesisUtterance(sentenceText.trim());
        utterance.rate = rate;
        utterance.pitch = pitch;
        if (voice) utterance.voice = voice;

        utterance.onstart = () => {
          setIsSpeaking(true);
          setIsPaused(false);
          setSpeakingMessageId(messageId);
          setSpeakingSentenceIndex(idx);
          if (idx === 0) onStart?.();
        };
        utterance.onend = () => {
          if (idx === sentences.length - 1) {
            setIsSpeaking(false);
            setIsPaused(false);
            setSpeakingMessageId(null);
            setSpeakingSentenceIndex(null);
            onEnd?.();
          }
        };
        utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
          setIsSpeaking(false);
          setIsPaused(false);
          setSpeakingMessageId(null);
          setSpeakingSentenceIndex(null);
          onError?.(event);
        };
        utterances.push(utterance);
      });

      utterancesRef.current = utterances;
      utterances.forEach((u) => window.speechSynthesis.speak(u));
    },
    [stopSpeech, rate, pitch, voice, onStart, onEnd, onError],
  );

  const setRate = useCallback(
    (newRate: number) => {
      const clampedRate = Math.max(0.75, Math.min(2, newRate));
      setRateState(clampedRate);

      // If speech is actively playing, restart with the updated playback rate
      if (isSpeaking) {
        speak();
      }
    },
    [isSpeaking, speak],
  );

  const setPitch = useCallback((newPitch: number) => {
    const clampedPitch = Math.max(0, Math.min(2, newPitch));
    setPitchState(clampedPitch);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    isSupported,
    isSpeaking,
    isPaused,
    rate,
    pitch,
    voice,
    voices,
    error,
    speakingMessageId,
    speakingSentenceIndex,
    speak,
    speakMessage,
    stopSpeech,
    cancel,
    pause,
    resume,
    setRate,
    setPitch,
    setVoice,
  };
}

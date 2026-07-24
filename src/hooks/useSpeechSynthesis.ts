"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type SpeedOption = (typeof SPEED_OPTIONS)[number];

const VOICE_STORAGE_KEY = "speechSynthesis:selectedVoiceURI";

function getPersistedVoiceURI(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistVoiceURI(uri: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (uri) {
      window.localStorage.setItem(VOICE_STORAGE_KEY, uri);
    } else {
      window.localStorage.removeItem(VOICE_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private mode etc.) — ignore
  }
}

export function splitTextIntoSentences(text: string): string[] {
  if (!text) return [];
  const cleanText = text
    .replace(/<ui-component\s+name="[^"]+"\s+props='[^']+'\s*\/>/g, "")
    .trim();
  if (!cleanText) return [];

  const sentences = cleanText.split(/(?<=[!?])\s+|(?<=(?<!\b\d+)\.)\s+/g);
  return sentences.length > 0 ? sentences : [cleanText];
}

export interface UseSpeechSynthesisOptions {
  defaultRate?: number;
  defaultPitch?: number;
  lang?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (event: SpeechSynthesisErrorEvent) => void;
}

export interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  isPaused: boolean;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  voices: SpeechSynthesisVoice[];
  error: string | null;
  speakingMessageId: string | null;
  speakingSentenceIndex: number | null;
  speak: (textToSpeak?: string) => void;
  speakMessage: (messageId: string, text: string) => void;
  stopSpeech: () => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  setRate: (newRate: number) => void;
  setPitch: (newPitch: number) => void;
  setVoice: (newVoice: SpeechSynthesisVoice | null) => void;
}

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

  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRateState] = useState(defaultRate);
  const [pitch, setPitchState] = useState(defaultPitch);
  const [voices, setVoices] = useState([]);
  const [voice, setVoiceState] = useState(null);
  const [error, setError] = useState(null);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [speakingSentenceIndex, setSpeakingSentenceIndex] = useState(null);

  const utteranceRef = useRef(null);
  const utterancesRef = useRef([]);
  const currentTextRef = useRef(textToSpeakDefault);
  const selectedVoiceURIRef = useRef(getPersistedVoiceURI());

  useEffect(() => {
    currentTextRef.current = textToSpeakDefault;
  }, [textToSpeakDefault]);

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
        if (availableVoices.length === 0) return;

        setVoiceState((prev) => {
          if (prev) {
            const stillAvailable = availableVoices.find(
              (v) => v.voiceURI === prev.voiceURI,
            );
            if (stillAvailable) return stillAvailable;
          }

          const persistedURI = selectedVoiceURIRef.current;
          const persistedVoice = persistedURI
            ? availableVoices.find((v) => v.voiceURI === persistedURI)
            : null;
          if (persistedVoice) return persistedVoice;

          const defaultLangVoice =
            availableVoices.find((v) => v.lang.startsWith(lang)) ||
            availableVoices.find((v) => v.default) ||
            availableVoices[0];
          return defaultLangVoice || null;
        });
      };

      updateVoices();

      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = updateVoices;
      }
    } else {
      setIsSupported(false);
    }
  }, [lang]);

  const setVoice = useCallback((newVoice) => {
    selectedVoiceURIRef.current = newVoice ? newVoice.voiceURI : null;
    persistVoiceURI(selectedVoiceURIRef.current);
    setVoiceState(newVoice);
  }, []);

  const resolveVoice = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return null;
    }
    const uri = selectedVoiceURIRef.current ?? voice?.voiceURI ?? null;
    if (!uri) return voice;
    const currentVoices = window.speechSynthesis.getVoices();
    return currentVoices.find((v) => v.voiceURI === uri) || voice;
  }, [voice]);

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
    (textOverride) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setError("Speech synthesis is not supported in this environment.");
        return;
      }

      const textToRead = textOverride ?? currentTextRef.current;
      if (!textToRead || textToRead.trim() === "") {
        return;
      }

      window.speechSynthesis.cancel();
      setError(null);

      const utterance = new SpeechSynthesisUtterance(textToRead);
      utterance.rate = rate;
      utterance.pitch = pitch;

      const resolvedVoice = resolveVoice();
      if (resolvedVoice) {
        utterance.voice = resolvedVoice;
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

      utterance.onerror = (event) => {
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
    [rate, pitch, resolveVoice, lang, onStart, onEnd, onError],
  );

  const speakMessage = useCallback(
    (messageId, text) => {
      stopSpeech();

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }

      const sentences = splitTextIntoSentences(text);
      if (sentences.length === 0) return;

      const utterances = [];
      const resolvedVoice = resolveVoice();

      sentences.forEach((sentenceText, idx) => {
        const utterance = new SpeechSynthesisUtterance(sentenceText.trim());
        utterance.rate = rate;
        utterance.pitch = pitch;
        if (resolvedVoice) utterance.voice = resolvedVoice;

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
        utterance.onerror = (event) => {
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
    [stopSpeech, rate, pitch, resolveVoice, onStart, onEnd, onError],
  );

  const setRate = useCallback(
    (newRate) => {
      const clampedRate = Math.max(0.75, Math.min(2, newRate));
      setRateState(clampedRate);

      if (isSpeaking) {
        speak();
      }
    },
    [isSpeaking, speak],
  );

  const setPitch = useCallback((newPitch) => {
    const clampedPitch = Math.max(0, Math.min(2, newPitch));
    setPitchState(clampedPitch);
  }, []);

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

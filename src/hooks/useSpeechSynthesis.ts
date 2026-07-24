import { useCallback, useEffect, useRef, useState } from "react";

export type SpeedOption = number;
export const SPEED_OPTIONS: SpeedOption[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

const VOICE_STORAGE_KEY = "worksphere_selected_voice_uri";

export function getPersistedVoiceURI(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistVoiceURI(uri: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (uri) {
      localStorage.setItem(VOICE_STORAGE_KEY, uri);
    } else {
      localStorage.removeItem(VOICE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function splitTextIntoSentences(text: string): string[] {
  if (!text) return [];
  // Split on sentence boundaries (. ! ?) while preserving reasonable chunks
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface UseSpeechSynthesisOptions {
  textToSpeakDefault?: string;
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
  voices: SpeechSynthesisVoice[];
  voice: SpeechSynthesisVoice | null;
  error: string | null;
  speakingMessageId: string | null;
  speakingSentenceIndex: number | null;
  speak: (textOverride?: string) => void;
  speakMessage: (messageId: string, text: string) => void;
  cancel: () => void;
  stopSpeech: () => void;
  pause: () => void;
  resume: () => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
}

export function useSpeechSynthesis(
  textToSpeakDefaultOrOptions?: string | UseSpeechSynthesisOptions,
  optionsParam?: UseSpeechSynthesisOptions,
): UseSpeechSynthesisReturn {
  const options: UseSpeechSynthesisOptions =
    typeof textToSpeakDefaultOrOptions === "string"
      ? { textToSpeakDefault: textToSpeakDefaultOrOptions, ...optionsParam }
      : (textToSpeakDefaultOrOptions || {});

  const {
    textToSpeakDefault = "",
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoiceState] = useState<SpeechSynthesisVoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [speakingSentenceIndex, setSpeakingSentenceIndex] = useState<number | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
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

  const setVoice = useCallback((newVoice: SpeechSynthesisVoice | null) => {
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
    (textOverride?: string) => {
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
    (messageId: string, text: string) => {
      stopSpeech();

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }

      const sentences = splitTextIntoSentences(text);
      if (sentences.length === 0) return;

      const utterances: SpeechSynthesisUtterance[] = [];
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
    (newRate: number) => {
      const clampedRate = Math.max(0.75, Math.min(2, newRate));
      setRateState(clampedRate);

      if (isSpeaking) {
        speak(currentTextRef.current);
      }
    },
    [isSpeaking, speak],
  );

  const setPitch = useCallback((newPitch: number) => {
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
    voices,
    voice,
    error,
    speakingMessageId,
    speakingSentenceIndex,
    speak,
    speakMessage,
    cancel,
    stopSpeech,
    pause,
    resume,
    setRate,
    setPitch,
    setVoice,
  };
}

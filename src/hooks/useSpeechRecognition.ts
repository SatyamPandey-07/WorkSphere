"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Web Speech API type declarations ────────────────────────────────────────
//
// The Web Speech API is not yet part of the official TypeScript DOM lib on all
// TS versions, so we declare the minimal interface shapes we need here. This
// avoids a hard dependency on a third-party @types package and keeps the hook
// self-contained.

interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult:
    | ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void)
    | null;
}

interface ISpeechRecognitionEvent extends Event {
  readonly results: ISpeechRecognitionResultList;
}

interface ISpeechRecognitionResultList {
  readonly length: number;
  item(index: number): ISpeechRecognitionResult;
  [index: number]: ISpeechRecognitionResult;
}

interface ISpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): ISpeechRecognitionAlternative;
  [index: number]: ISpeechRecognitionAlternative;
}

interface ISpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface ISpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

type SpeechRecognitionConstructor = new () => ISpeechRecognition;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpeechRecognitionStatus =
  | "idle"
  | "listening"
  | "processing"
  | "unsupported"
  | "error";

export interface UseSpeechRecognitionReturn {
  /** Whether the Web Speech API is available in this browser */
  isSupported: boolean;
  /** Current status of the recognition instance */
  status: SpeechRecognitionStatus;
  /** Most recent transcript returned by the API */
  transcript: string;
  /** Human-readable error message (null when no error) */
  errorMessage: string | null;
  /** Start listening – no-op when unsupported */
  startListening: () => void;
  /** Stop listening – no-op when unsupported */
  stopListening: () => void;
}

// ─── Browser support detection ────────────────────────────────────────────────

/**
 * Returns the SpeechRecognition constructor available in the current browser,
 * or null if the API is absent (e.g. Firefox Nightly with the flag disabled,
 * Safari without the webkit prefix, etc.).
 *
 * Checks both the standard name and the webkit-prefixed variant used by
 * Chrome / Edge / Chromium-based browsers so we never crash on assignment.
 */
function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;

  // Standard (Chrome 33+, Edge 79+)
  if ("SpeechRecognition" in window) {
    return (window as unknown as { SpeechRecognition: SpeechRecognitionConstructor }).SpeechRecognition;
  }

  // Webkit-prefixed (Chrome, Edge, Safari TP)
  if ("webkitSpeechRecognition" in window) {
    return (window as unknown as { webkitSpeechRecognition: SpeechRecognitionConstructor }).webkitSpeechRecognition;
  }

  // Firefox does not expose SpeechRecognition by default. In Firefox Nightly
  // the flag `media.webspeech.recognition.enable` must be toggled in
  // about:config. Without it the property simply does not exist, which is
  // what we detect here.
  return null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useSpeechRecognition
 *
 * Wraps the Web Speech API with proper browser-support detection so that
 * unsupported environments (Firefox Nightly, older browsers) fail gracefully
 * with a clear user-facing message instead of a silent crash.
 *
 * @param onTranscript - Callback invoked with the final transcript string once
 *                       recognition completes or the user stops listening.
 */
export function useSpeechRecognition(
  onTranscript: (text: string) => void,
): UseSpeechRecognitionReturn {
  const RecognitionCtor = useRef<SpeechRecognitionConstructor | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  const [isSupported, setIsSupported] = useState(false);
  const [status, setStatus] = useState<SpeechRecognitionStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Run support check once on the client (avoids SSR mismatch)
  useEffect(() => {
    const Ctor = getSpeechRecognitionConstructor();
    if (Ctor) {
      RecognitionCtor.current = Ctor;
      setIsSupported(true);
    } else {
      setIsSupported(false);
      setStatus("unsupported");
    }
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported || !RecognitionCtor.current) {
      // Surface a message so callers can display it even if they call this
      // without checking isSupported first.
      setErrorMessage(
        "Voice input is not supported in this browser. Please use Chrome, Edge, or enable speech recognition in Firefox (about:config → media.webspeech.recognition.enable).",
      );
      setStatus("unsupported");
      return;
    }

    // Clean up any existing instance before starting a new one
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new RecognitionCtor.current();
    recognition.lang = "en-US";
    recognition.interimResults = false; // we want a single final result
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      setStatus("listening");
      setTranscript("");
      setErrorMessage(null);
    };

    recognition.onresult = (event: ISpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        const text = result[0].transcript.trim();
        setTranscript(text);
        setStatus("processing");
        onTranscript(text);
      }
    };

    recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
      let message: string;

      switch (event.error) {
        case "not-allowed":
        case "permission-denied":
          message =
            "Microphone access was denied. Please allow microphone permissions in your browser settings.";
          break;
        case "no-speech":
          message = "No speech was detected. Please try again.";
          break;
        case "network":
          message =
            "A network error occurred during voice recognition. Please check your connection.";
          break;
        case "service-not-allowed":
          message =
            "Voice input is not supported in this browser. Please use Chrome, Edge, or enable the required Firefox feature.";
          break;
        default:
          message = `Voice recognition error: ${event.error}. Please try again.`;
      }

      setErrorMessage(message);
      setStatus("error");
    };

    recognition.onend = () => {
      // Only revert to idle if we weren't already in an error or processing state
      setStatus((prev) =>
        prev === "listening" || prev === "processing" ? "idle" : prev,
      );
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      // Some browsers throw synchronously (e.g. when already listening)
      setErrorMessage(
        "Could not start voice recognition. Please refresh and try again.",
      );
      setStatus("error");
    }
  }, [isSupported, onTranscript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setStatus("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return {
    isSupported,
    status,
    transcript,
    errorMessage,
    startListening,
    stopListening,
  };
}

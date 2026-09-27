"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSpeechSynthesis,
  type UseSpeechSynthesisOptions,
} from "@/hooks/useSpeechSynthesis";

interface UseSpeechQueueOptions extends UseSpeechSynthesisOptions {
  /** Max number of messages to keep in the queue (oldest are dropped). Default: 20 */
  maxQueueLength?: number;
}

interface UseSpeechQueueReturn {
  /** Whether speech is currently playing */
  isSpeaking: boolean;
  /** Number of pending messages in the queue */
  queueLength: number;
  /** Add a text message to the end of the queue */
  enqueue: (text: string, messageId?: string) => void;
  /** Remove and return the next message from the front of the queue without playing it */
  dequeue: () => string | undefined;
  /** Clear all pending messages and stop current speech */
  clearQueue: () => void;
  /** Play the next message in the queue immediately (skips current) */
  playNext: () => void;
  /** Current speech rate (0.75–2) */
  rate: number;
  /** Set speech rate */
  setRate: (rate: number) => void;
  /** Available voices */
  voices: SpeechSynthesisVoice[];
  /** Currently selected voice */
  voice: SpeechSynthesisVoice | null;
  /** Select a voice */
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
}

/**
 * Speech synthesis queue — wraps `useSpeechSynthesis` with FIFO message-queue
 * semantics so callers can enqueue multiple messages and have them play in
 * order, automatically advancing when each utterance ends.
 *
 * Extracted from `EnhancedChatbot.tsx` (Issue #1933).
 */
export function useSpeechQueue(
  options: UseSpeechQueueOptions = {},
): UseSpeechQueueReturn {
  const { maxQueueLength = 20, ...speechOptions } = options;

  const [pendingQueue, setPendingQueue] = useState<
    Array<{ text: string; id: string }>
  >([]);
  const idCounterRef = useRef(0);

  const {
    isSpeaking,
    speakMessage,
    cancel,
    rate,
    setRate,
    voices,
    voice,
    setVoice,
    isSupported,
  } = useSpeechSynthesis({
    ...speechOptions,
    onEnd: () => {
      options.onEnd?.();
      // Advance queue when a message finishes
      setPendingQueue((prev) => prev.slice(1));
    },
  });

  const playingIdRef = useRef<string | null>(null);

  // When queue changes and nothing is playing, start the next message
  useEffect(() => {
    if (!isSupported || isSpeaking || pendingQueue.length === 0) return;
    const next = pendingQueue[0];
    if (next && next.id !== playingIdRef.current) {
      playingIdRef.current = next.id;
      speakMessage(next.id, next.text);
    }
  }, [isSupported, isSpeaking, pendingQueue, speakMessage]);

  const enqueue = useCallback(
    (text: string, messageId?: string) => {
      const id = messageId ?? `sq-${++idCounterRef.current}`;
      setPendingQueue((prev) => {
        const next = [...prev, { text, id }];
        return next.length > maxQueueLength
          ? next.slice(next.length - maxQueueLength)
          : next;
      });
    },
    [maxQueueLength],
  );

  const dequeue = useCallback((): string | undefined => {
    let text: string | undefined;
    setPendingQueue((prev) => {
      if (prev.length === 0) return prev;
      text = prev[0].text;
      return prev.slice(1);
    });
    return text;
  }, []);

  const clearQueue = useCallback(() => {
    cancel();
    playingIdRef.current = null;
    setPendingQueue([]);
  }, [cancel]);

  const playNext = useCallback(() => {
    cancel();
    playingIdRef.current = null;
    setPendingQueue((prev) => prev.slice(1));
  }, [cancel]);

  return {
    isSpeaking,
    queueLength: pendingQueue.length,
    enqueue,
    dequeue,
    clearQueue,
    playNext,
    rate,
    setRate,
    voices,
    voice,
    setVoice,
  };
}

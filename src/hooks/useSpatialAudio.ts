import { useEffect, useRef, useCallback } from "react";

export function useSpatialAudio(
  audioContext: AudioContext | null,
  sourceNode: AudioNode | null,
) {
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !audioContext || !sourceNode) return;

    let isMounted = true;
    let localWorkletNode: AudioWorkletNode | null = null;

    async function initWorklet() {
      try {
        await audioContext!.audioWorklet.addModule(
          "/audio/SpatialAudioWorkletProcessor.js",
        );
        if (!isMounted) return;

        const NodeCtor =
          window.AudioWorkletNode || (window as any).webkitAudioWorkletNode;

        if (!NodeCtor) {
          console.warn(
            "AudioWorkletNode is not supported in this browser environment.",
          );
          return;
        }

        localWorkletNode = new NodeCtor(
          audioContext!,
          "spatial-audio-worklet-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          },
        );

        sourceNode!.connect(localWorkletNode);
        localWorkletNode.connect(audioContext!.destination);
        workletNodeRef.current = localWorkletNode;
      } catch (err) {
        console.error("Failed to initialize spatial audio worklet:", err);
      }
    }

    initWorklet();

    return () => {
      isMounted = false;
      if (localWorkletNode) {
        try {
          sourceNode?.disconnect(localWorkletNode);
          localWorkletNode.disconnect();
        } catch {
          // Ignore cleanup errors on context teardown
        }
      }
      workletNodeRef.current = null;
    };
  }, [audioContext, sourceNode]);

  const updateOrientation = useCallback(
    (azimuth: number, elevation: number) => {
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({
          type: "UPDATE_ORIENTATION",
          azimuth,
          elevation,
        });
      }
    },
    [],
  );

  return { updateOrientation };
}

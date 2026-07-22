# Speech Synthesis

## Overview

The `useSpeechSynthesis` hook provides text-to-speech functionality using the browser's Web Speech API. It allows chat messages to be read aloud sentence by sentence.

## API

### Returned values

- `isSupported` – Indicates whether the browser supports the Web Speech API.
- `speakingMessageId` – ID of the message currently being spoken.
- `speakingSentenceIndex` – Index of the sentence currently being spoken.
- `speakMessage(messageId, text)` – Starts reading the provided message aloud.
- `stopSpeech()` – Stops any active speech playback.

## Example

```tsx
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";

function ReadAloudButton() {
  const {
    isSupported,
    speakMessage,
    stopSpeech,
  } = useSpeechSynthesis();

  if (!isSupported) return null;

  return (
    <>
      <button
        onClick={() =>
          speakMessage("message-1", "Hello! Welcome to WorkSphere.")
        }
      >
        Read Aloud
      </button>

      <button onClick={stopSpeech}>
        Stop
      </button>
    </>
  );
}
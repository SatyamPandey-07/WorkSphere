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

## ReadAloudButton Component

The `ReadAloudButton` component integrates the `useSpeechSynthesis` hook into a reusable UI control that allows users to play or stop speech synthesis for any text content.

### Props

| Prop          | Type          | Description                                                        |
| ------------- | ------------- | ------------------------------------------------------------------ |
| `text`        | `string`      | The text content that will be spoken when the button is activated. |
| `defaultRate` | `SpeedOption` | Initial playback speed used for speech synthesis.                  |
| `pitch`       | `number`      | Initial speech pitch.                                              |
| `onStart`     | `() => void`  | Optional callback fired when speech starts.                        |
| `onEnd`       | `() => void`  | Optional callback fired when speech completes.                     |
| `className`   | `string`      | Optional CSS classes applied to the component container.           |

## Component Integration

```tsx
import { ReadAloudButton } from "@/components/ReadAloudButton";

export default function ChatMessage() {
  return (
    <div className="flex items-center gap-2">
      <p>Welcome to WorkSphere!</p>

      <ReadAloudButton
        text="Welcome to WorkSphere!"
        defaultRate={1}
        onEnd={() => console.log("Speech finished")}
      />
    </div>
  );
}
```

## Browser Support

`ReadAloudButton` relies on the browser's Web Speech API.

When the Web Speech API is unavailable:

- A disabled **Read Aloud** button is displayed.
- The control indicates that text-to-speech is not supported in the current browser.
- Users can continue interacting with the application normally without speech playback.

## Example

```tsx
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";

function ReadAloudButton() {
  const { isSupported, speakMessage, stopSpeech } = useSpeechSynthesis();

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

      <button onClick={stopSpeech}>Stop</button>
    </>
  );
}
```

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

### Browser Compatibility

| Browser | Voice Availability             | Voice Loading     | Notes                          |
| ------- | ------------------------------ | ----------------- | ------------------------------ |
| Chrome  | ✅ Wide range of system voices | `onvoiceschanged` | Full Web Speech API support    |
| Edge    | ✅ Wide range of system voices | `onvoiceschanged` | Chromium-based implementation  |
| Safari  | ✅ System voices available     | `onvoiceschanged` | Voices may load asynchronously |
| Firefox | ⚠️ Limited voice availability  | Limited           | Support varies by platform     |

### Voice Loading

Some browsers load voices asynchronously. To ensure voices are available before speaking, listen for the `onvoiceschanged` event.

```ts
let voices = speechSynthesis.getVoices();

if (!voices.length) {
  speechSynthesis.onvoiceschanged = () => {
    voices = speechSynthesis.getVoices();
  };
}
```

### Mobile WebView Fallback

Some Android and iOS embedded WebViews do not fully support the Web Speech API.

Applications should detect Web Speech API support (`window.speechSynthesis`) before enabling speech features. If speech synthesis is unavailable, disable text-to-speech controls, inform the user that the feature is unsupported, and continue providing the normal text-based experience.

When speech synthesis is unavailable:

- A disabled **Read Aloud** button is displayed.
- The UI indicates that speech synthesis is not supported.
- Users can continue using the application without speech playback.

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

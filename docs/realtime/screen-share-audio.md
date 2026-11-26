# Screen-Share Audio Controller & Browser Permission Matrix

## 1. Overview & Purpose

WorkSphere real-time collaborative workspaces allow nomadic teams to share screens, review architectural diagrams, and present video content during live peer sessions. Capturing system and browser-tab audio alongside video streams is critical for media reviews and presentations.

However, browser implementations of the W3C Screen Capture specification (`MediaDevices.getDisplayMedia()`) exhibit significant disparity regarding audio capture support across rendering engines (Blink, Gecko, WebKit) and operating systems (macOS, Windows, Linux, ChromeOS).

This document serves as the canonical technical guide for:

- The `ScreenShareAudioController` abstraction (`src/lib/realtime/screenShareAudioController.ts`)
- The `ScreenShareAudioToggle` UI control (`src/components/realtime/ScreenShareAudioToggle.tsx`)
- The browser and platform capability matrix
- Dual-attempt graceful audio fallback logic
- Error recovery protocols for `NotAllowedError`, `AbortError`, and `NotSupportedError`

---

## 2. Architecture & Controller Abstractions

The screen-share audio subsystem is implemented in `src/lib/realtime/screenShareAudioController.ts`:

```typescript
export interface ScreenShareSessionResult {
  stream: MediaStreamLike;
  videoTrack: MediaStreamTrackLike | null;
  audioTrack: MediaStreamTrackLike | null;
  audioIncluded: boolean;
  audioFallbackUsed: boolean;
  fallbackReason?: string;
}
```

### Core Functions:

1. **`buildDisplayMediaConstraints(includeSystemAudio: boolean)`**:
   Returns `{ video: true, audio: Boolean(includeSystemAudio) }`.
2. **`acquireScreenShareStream(options)`**:
   Initiates screen capture using `navigator.mediaDevices.getDisplayMedia()`. If the user or browser rejects audio capture, it intercepts the error and executes a secondary video-only request without terminating the screen-sharing flow.
3. **`releaseScreenShareSession(session)`**:
   Iterates through all video and audio tracks on the active stream and invokes `track.stop()`, ensuring hardware indicators and browser sharing banners terminate cleanly.

---

## 3. Browser & Platform Compatibility Matrix

Screen audio capture behavior varies across browsers, operating systems, and capture surface types (Browser Tab, Window, Entire Screen):

| Browser Engine | Browser / Version         | Tab Audio Capture                                                      | Window Audio Capture   | Entire Screen Audio                | macOS Audio Support                                                                   | Windows Audio Support                |
| -------------- | ------------------------- | ---------------------------------------------------------------------- | ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| **Blink**      | **Google Chrome** (74+)   | ✅ Full support                                                        | ❌ Not supported by OS | ✅ Supported on Windows & ChromeOS | ⚠️ Tab audio only (system audio blocked by macOS permissions without loopback driver) | ✅ Full support (tab & system audio) |
| **Blink**      | **Microsoft Edge** (79+)  | ✅ Full support                                                        | ❌ Not supported by OS | ✅ Supported on Windows            | ⚠️ Tab audio only                                                                     | ✅ Full support                      |
| **Gecko**      | **Mozilla Firefox** (66+) | ❌ Disabled by default (`media.getusermedia.screensharing.audio` pref) | ❌ Not supported       | ❌ Not supported                   | ❌ Not supported                                                                      | ❌ Disabled in stable releases       |
| **WebKit**     | **Apple Safari** (13+)    | ❌ Not supported                                                       | ❌ Not supported       | ❌ Not supported                   | ❌ Safari omits audio support in `getDisplayMedia`                                    | ❌ Not applicable                    |

### Platform-Specific Constraints:

- **macOS:** Apple sandbox restrictions prevent user-space applications from capturing global system audio without specialized audio loopback drivers (e.g., BlackHole or CoreAudio HAL plugins). However, Chrome and Edge allow capturing audio from individual browser tabs.
- **Windows:** Supports both individual tab audio capture and entire screen system audio mixing directly through WASAPI loopback.
- **Linux:** Depends on PipeWire / PulseAudio integration. Modern Wayland environments via `xdg-desktop-portal` support audio capture when PipeWire is configured.

---

## 4. Dual-Attempt Audio Fallback Strategy

When a user enables the **"Share tab / system audio"** toggle, `acquireScreenShareStream()` first requests `{ video: true, audio: true }`. If the browser or user rejects audio capture, throwing a recoverable exception, the controller immediately falls back to `{ video: true, audio: false }`:

```mermaid
sequenceDiagram
    autonumber
    participant User as Nomad Presenter
    participant UI as ScreenShareAudioToggle
    participant Controller as ScreenShareAudioController
    participant Browser as Browser getDisplayMedia API

    User->>UI: Check "Share tab / system audio"
    User->>Controller: acquireScreenShareStream({ includeSystemAudio: true })
    Controller->>Browser: getDisplayMedia({ video: true, audio: true })

    alt User grants video and tab audio
        Browser-->>Controller: MediaStream (VideoTrack + AudioTrack)
        Controller-->>UI: ScreenShareSessionResult { audioIncluded: true, audioFallbackUsed: false }
    else Browser / User denies audio (NotAllowedError / NotSupportedError)
        Browser-->>Controller: Reject with DOMException (NotAllowedError)
        Note over Controller: Detect isAudioDeniedError(err)<br/>Trigger graceful fallback
        Controller->>Browser: getDisplayMedia({ video: true, audio: false })
        Browser-->>Controller: MediaStream (VideoTrack only)
        Controller-->>UI: ScreenShareSessionResult { audioIncluded: false, audioFallbackUsed: true, fallbackReason: "..." }
        UI-->>User: Display amber status notice: "Tab/system audio denied by browser; continuing with video only."
    end
```

### Detection Logic (`isAudioDeniedError`):

The controller inspects the rejected error:

```typescript
function isAudioDeniedError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) {
    return (
      error.name === "NotAllowedError" ||
      error.name === "NotSupportedError" ||
      error.name === "AbortError"
    );
  }
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    return (
      m.includes("audio") ||
      m.includes("notsupported") ||
      m.includes("notallowed") ||
      m.includes("permission")
    );
  }
  return false;
}
```

---

## 5. Error Recovery Procedures

| Error Type              | Root Cause                                                                                                            | Controller Recovery Action                                                                                                                                                           | Presenter Guidance                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`NotAllowedError`**   | 1. User unchecked "Share audio" in the browser picker.<br/>2. System policy or OS permissions blocked screen audio.   | Controller catches the error and executes a secondary video-only request. Session continues with `audioFallbackUsed: true`.                                                          | Advise presenter to select a **Chrome Tab** instead of "Entire Screen" on macOS, and verify the "Also share tab audio" checkbox is checked in the native picker. |
| **`AbortError`**        | 1. The user cancelled the picker dialog.<br/>2. Audio device constraint negotiation failed or pipeline stalled.       | If triggered during audio constraint negotiation, controller retries video-only. If user cancelled the picker entirely, the error propagates so the UI can reset the sharing toggle. | Re-open the sharing picker and select the desired window or screen.                                                                                              |
| **`NotSupportedError`** | The browser does not support audio capture inside `getDisplayMedia` (e.g., Safari or Firefox).                        | Intercepted by `isAudioDeniedError`. Seamlessly acquires video-only stream without throwing an unhandled exception.                                                                  | Display an in-app notice informing the presenter that their current browser only supports video screen sharing. Recommend Chrome or Edge for system audio.       |
| **Missing Audio Track** | The user selected "Entire Screen" on macOS where the browser cannot capture system audio, but did not throw an error. | Controller inspects `stream.getAudioTracks()`. If empty, flags `audioFallbackUsed: true` with reason: `"Selected share source did not include tab or system audio."`                 | Presenter is notified via the `ScreenShareAudioToggle` notice banner.                                                                                            |

---

## 6. UI Integration: `ScreenShareAudioToggle`

The UI component at `src/components/realtime/ScreenShareAudioToggle.tsx` provides an accessible, non-intrusive control:

```tsx
<ScreenShareAudioToggle
  includeTabAudio={includeAudio}
  onToggle={(checked) => setIncludeAudio(checked)}
  disabled={isSharingActive}
  fallbackNotice={session?.fallbackReason}
/>
```

- **`data-testid="screen-share-audio-control"`**: Container wrapper.
- **`data-testid="include-tab-audio-checkbox"`**: Checkbox allowing user to opt into audio capture before presenting.
- **`data-testid="screen-share-audio-fallback"`**: Role `status` element rendering amber feedback when fallback is activated.

---

## 7. Resource Cleanup & Teardown

To prevent lingering hardware indicators or memory leaks when screen sharing ends, `releaseScreenShareSession` safely invokes `.stop()` on all tracks:

```typescript
export function releaseScreenShareSession(
  session: ScreenShareSessionResult | null | undefined,
): void {
  if (!session?.stream) return;
  const tracks = session.stream.getTracks?.() ?? [
    ...(session.stream.getVideoTracks?.() ?? []),
    ...(session.stream.getAudioTracks?.() ?? []),
  ];
  for (const t of tracks) {
    try {
      t.stop?.();
    } catch {}
  }
}
```

---

## 8. Related Documentation & Source Files

- [Screen Share Audio Controller Implementation](file:///d:/Opensource/WorkSphere-Opensource/src/lib/realtime/screenShareAudioController.ts)
- [Screen Share Audio Toggle UI Component](file:///d:/Opensource/WorkSphere-Opensource/src/components/realtime/ScreenShareAudioToggle.tsx)
- [Controller & UI Unit Test Suite](file:///d:/Opensource/WorkSphere-Opensource/src/__tests__/lib/realtime/screenShareAudioController.test.tsx)
- [WebRTC Audio Bitrate Management](file:///d:/Opensource/WorkSphere-Opensource/src/__tests__/lib/screenShareBitrate.test.ts)

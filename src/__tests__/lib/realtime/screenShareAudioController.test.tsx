import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  acquireScreenShareStream,
  buildDisplayMediaConstraints,
  releaseScreenShareSession,
  type MediaStreamLike,
} from '@/lib/realtime/screenShareAudioController';
import { ScreenShareAudioToggle } from '@/components/realtime/ScreenShareAudioToggle';

function makeStream(options: {
  withVideo?: boolean;
  withAudio?: boolean;
  onStop?: () => void;
}): MediaStreamLike {
  const stop = options.onStop ?? jest.fn();
  const videoTracks =
    options.withVideo === false
      ? []
      : [{ id: 'vid-1', kind: 'video', readyState: 'live' as const, stop }];
  const audioTracks = options.withAudio
    ? [{ id: 'aud-1', kind: 'audio', readyState: 'live' as const, stop }]
    : [];

  return {
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

describe('Screen-Share Audio Toggle & getDisplayMedia Controller', () => {
  it('builds exact getDisplayMedia constraints for video + optional system/tab audio', () => {
    expect(buildDisplayMediaConstraints(true)).toEqual({
      video: true,
      audio: true,
    });
    expect(buildDisplayMediaConstraints(false)).toEqual({
      video: true,
      audio: false,
    });
  });

  it('captures tab audio when permitted and releases tracks cleanly', async () => {
    const stopSpy = jest.fn();
    const getDisplayMedia = jest
      .fn()
      .mockResolvedValue(makeStream({ withAudio: true, onStop: stopSpy }));

    const session = await acquireScreenShareStream({
      includeSystemAudio: true,
      getDisplayMedia,
    });

    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: true,
      audio: true,
    });
    expect(session.audioIncluded).toBe(true);
    expect(session.audioFallbackUsed).toBe(false);
    expect(session.audioTrack?.id).toBe('aud-1');

    releaseScreenShareSession(session);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back gracefully to video-only when browser denies tab audio capture', async () => {
    const getDisplayMedia = jest
      .fn()
      .mockRejectedValueOnce(
        new DOMException('System audio capture denied', 'NotAllowedError')
      )
      .mockResolvedValueOnce(makeStream({ withAudio: false }));

    const session = await acquireScreenShareStream({
      includeSystemAudio: true,
      getDisplayMedia,
    });

    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    expect(getDisplayMedia).toHaveBeenNthCalledWith(1, {
      video: true,
      audio: true,
    });
    expect(getDisplayMedia).toHaveBeenNthCalledWith(2, {
      video: true,
      audio: false,
    });
    expect(session.audioIncluded).toBe(false);
    expect(session.audioFallbackUsed).toBe(true);
    expect(session.fallbackReason).toContain('continuing with video only');
  });

  it('toggles tab audio checkbox and displays fallback notice in UI', async () => {
    const Harness = () => {
      const [checked, setChecked] = useState(false);
      const [notice, setNotice] = useState<string | null>(null);

      return (
        <ScreenShareAudioToggle
          includeTabAudio={checked}
          fallbackNotice={notice}
          onToggle={(next) => {
            setChecked(next);
            if (next) {
              setNotice('Tab audio fell back to video only.');
            } else {
              setNotice(null);
            }
          }}
        />
      );
    };

    render(<Harness />);
    const checkbox = screen.getByTestId(
      'include-tab-audio-checkbox'
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(checkbox.checked).toBe(true);
      expect(screen.getByTestId('screen-share-audio-fallback').textContent).toBe(
        'Tab audio fell back to video only.'
      );
    });
  });
});

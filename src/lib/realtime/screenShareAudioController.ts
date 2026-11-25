export interface MediaStreamTrackLike {
  id: string;
  kind?: string;
  readyState?: 'live' | 'ended';
  stop?: () => void;
}

export interface MediaStreamLike {
  getTracks?: () => MediaStreamTrackLike[];
  getVideoTracks?: () => MediaStreamTrackLike[];
  getAudioTracks?: () => MediaStreamTrackLike[];
}

export type GetDisplayMediaFn = (
  constraints?: DisplayMediaStreamConstraints
) => Promise<MediaStreamLike>;

export interface ScreenShareSessionResult {
  stream: MediaStreamLike;
  videoTrack: MediaStreamTrackLike | null;
  audioTrack: MediaStreamTrackLike | null;
  audioIncluded: boolean;
  audioFallbackUsed: boolean;
  fallbackReason?: string;
}

export function buildDisplayMediaConstraints(
  includeSystemAudio: boolean
): DisplayMediaStreamConstraints {
  return {
    video: true,
    audio: Boolean(includeSystemAudio),
  };
}

function isAudioDeniedError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) {
    return (
      error.name === 'NotAllowedError' ||
      error.name === 'NotSupportedError' ||
      error.name === 'AbortError'
    );
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('audio') ||
      msg.includes('notsupported') ||
      msg.includes('notallowed') ||
      msg.includes('permission')
    );
  }
  return false;
}

function stopStreamTracksSafely(stream?: MediaStreamLike | null): void {
  if (!stream) return;
  const tracks =
    typeof stream.getTracks === 'function'
      ? stream.getTracks()
      : [
          ...(typeof stream.getVideoTracks === 'function'
            ? stream.getVideoTracks()
            : []),
          ...(typeof stream.getAudioTracks === 'function'
            ? stream.getAudioTracks()
            : []),
        ];

  for (const track of tracks) {
    try {
      track.stop?.();
    } catch {
      // Ignore cleanup errors on already-stopped tracks
    }
  }
}

export async function acquireScreenShareStream(options: {
  includeSystemAudio: boolean;
  getDisplayMedia?: GetDisplayMediaFn;
}): Promise<ScreenShareSessionResult> {
  const displayMediaFn: GetDisplayMediaFn | undefined =
    options.getDisplayMedia ??
    (typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
      ? (navigator.mediaDevices.getDisplayMedia.bind(
          navigator.mediaDevices
        ) as GetDisplayMediaFn)
      : undefined);

  if (!displayMediaFn) {
    throw new Error('getDisplayMedia is not supported in this environment');
  }

  const primaryConstraints = buildDisplayMediaConstraints(
    options.includeSystemAudio
  );

  let stream: MediaStreamLike;
  let audioFallbackUsed = false;
  let fallbackReason: string | undefined;

  try {
    stream = await displayMediaFn(primaryConstraints);
  } catch (err) {
    if (options.includeSystemAudio && isAudioDeniedError(err)) {
      audioFallbackUsed = true;
      fallbackReason =
        err instanceof Error && err.message
          ? `Tab/system audio unavailable (${err.message}); continuing with video only.`
          : 'Tab/system audio denied by browser; continuing with video only.';
      stream = await displayMediaFn(buildDisplayMediaConstraints(false));
    } else {
      throw err;
    }
  }

  const videoTracks =
    typeof stream.getVideoTracks === 'function'
      ? stream.getVideoTracks().filter((t) => t.readyState !== 'ended')
      : [];
  const audioTracks =
    typeof stream.getAudioTracks === 'function'
      ? stream.getAudioTracks().filter((t) => t.readyState !== 'ended')
      : [];

  const videoTrack = videoTracks[0] ?? null;
  const audioTrack =
    options.includeSystemAudio && !audioFallbackUsed
      ? audioTracks[0] ?? null
      : null;

  if (
    options.includeSystemAudio &&
    !audioFallbackUsed &&
    audioTracks.length === 0
  ) {
    audioFallbackUsed = true;
    fallbackReason =
      'Selected share source did not include tab or system audio.';
  }

  return {
    stream,
    videoTrack,
    audioTrack,
    audioIncluded: Boolean(audioTrack),
    audioFallbackUsed,
    fallbackReason,
  };
}

export function releaseScreenShareSession(
  session: ScreenShareSessionResult | null | undefined
): void {
  if (!session) return;
  stopStreamTracksSafely(session.stream);
}

export interface MediaStreamTrackLike { id: string; kind?: string; readyState?: 'live' | 'ended'; stop?: () => void; }
export interface MediaStreamLike { getTracks?: () => MediaStreamTrackLike[]; getVideoTracks?: () => MediaStreamTrackLike[]; getAudioTracks?: () => MediaStreamTrackLike[]; }
export type GetDisplayMediaFn = (constraints?: DisplayMediaStreamConstraints) => Promise<MediaStreamLike>;
export interface ScreenShareSessionResult { stream: MediaStreamLike; videoTrack: MediaStreamTrackLike | null; audioTrack: MediaStreamTrackLike | null; audioIncluded: boolean; audioFallbackUsed: boolean; fallbackReason?: string; }
export function buildDisplayMediaConstraints(includeSystemAudio: boolean): DisplayMediaStreamConstraints { return { video: true, audio: Boolean(includeSystemAudio) }; }
function isAudioDeniedError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === 'NotAllowedError' || error.name === 'NotSupportedError' || error.name === 'AbortError';
  if (error instanceof Error) { const m = error.message.toLowerCase(); return m.includes('audio') || m.includes('notsupported') || m.includes('notallowed') || m.includes('permission'); }
  return false;
}
export async function acquireScreenShareStream(options: { includeSystemAudio: boolean; getDisplayMedia?: GetDisplayMediaFn }): Promise<ScreenShareSessionResult> {
  const fn = options.getDisplayMedia ?? (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) as GetDisplayMediaFn : undefined);
  if (!fn) throw new Error('getDisplayMedia is not supported in this environment');
  let stream: MediaStreamLike; let audioFallbackUsed = false; let fallbackReason: string | undefined;
  try { stream = await fn(buildDisplayMediaConstraints(options.includeSystemAudio)); } catch (err) {
    if (options.includeSystemAudio && isAudioDeniedError(err)) { audioFallbackUsed = true; fallbackReason = err instanceof Error && err.message ? `Tab/system audio unavailable (${err.message}); continuing with video only.` : 'Tab/system audio denied by browser; continuing with video only.'; stream = await fn(buildDisplayMediaConstraints(false)); }
    else throw err;
  }
  const videoTrack = (stream.getVideoTracks?.().filter((t) => t.readyState !== 'ended') ?? [])[0] ?? null;
  const audioTrack = options.includeSystemAudio && !audioFallbackUsed ? ((stream.getAudioTracks?.().filter((t) => t.readyState !== 'ended') ?? [])[0] ?? null) : null;
  if (options.includeSystemAudio && !audioFallbackUsed && !audioTrack) { audioFallbackUsed = true; fallbackReason = 'Selected share source did not include tab or system audio.'; }
  return { stream, videoTrack, audioTrack, audioIncluded: Boolean(audioTrack), audioFallbackUsed, fallbackReason };
}
export function releaseScreenShareSession(session: ScreenShareSessionResult | null | undefined): void {
  if (!session?.stream) return;
  const tracks = session.stream.getTracks?.() ?? [...(session.stream.getVideoTracks?.() ?? []), ...(session.stream.getAudioTracks?.() ?? [])];
  for (const t of tracks) { try { t.stop?.(); } catch {} }
}

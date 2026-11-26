export type MediaKind = 'audio' | 'video' | 'screen';
export type NegotiationState = 'stable' | 'negotiating' | 'queued_renegotiation';
export interface MediaTrackLike { id: string; kind?: string; enabled?: boolean; readyState?: 'live' | 'ended'; stop?: () => void; }
export interface TrackSnapshot { micActive: boolean; cameraActive: boolean; screenShareActive: boolean; fallbackToMediaOnly: boolean; negotiationState: NegotiationState; activeTrackIds: string[]; lastError: string | null; }
export interface RenegotiationRunner { performNegotiation: (reason: string) => Promise<void> | void; }
export class WebRtcTrackController {
  private negotiationState: NegotiationState = 'stable';
  private pendingReason: string | null = null;
  private activeDrainPromise: Promise<void> | null = null;
  private micTrack: MediaTrackLike | null = null;
  private cameraTrack: MediaTrackLike | null = null;
  private screenTrack: MediaTrackLike | null = null;
  private fallbackToMediaOnly = false;
  private lastError: string | null = null;
  private readonly runner: RenegotiationRunner;
  constructor(runner: RenegotiationRunner) { this.runner = runner; }
  private normalizeTrack(track: MediaTrackLike | null, fallbackIdPrefix: string): MediaTrackLike | null {
    if (!track || track.readyState === 'ended') return null;
    return { id: track.id || `${fallbackIdPrefix}-${Math.random().toString(36).slice(2, 8)}`, kind: track.kind, enabled: track.enabled ?? true, readyState: track.readyState ?? 'live', stop: track.stop };
  }
  private stopTrackSafely(track: MediaTrackLike): void { try { track.stop?.(); } catch {} }
  private cleanupEndedTracksInternal(): void {
    if (this.micTrack?.readyState === 'ended') this.micTrack = null;
    if (this.cameraTrack?.readyState === 'ended') this.cameraTrack = null;
    if (this.screenTrack?.readyState === 'ended') this.screenTrack = null;
  }
  public setMicTrack(track: MediaTrackLike | null): TrackSnapshot { if (this.micTrack && this.micTrack.id !== track?.id) this.stopTrackSafely(this.micTrack); this.micTrack = this.normalizeTrack(track, 'mic'); return this.getSnapshot(); }
  public setCameraTrack(track: MediaTrackLike | null): TrackSnapshot { if (this.cameraTrack && this.cameraTrack.id !== track?.id) this.stopTrackSafely(this.cameraTrack); this.cameraTrack = this.normalizeTrack(track, 'cam'); return this.getSnapshot(); }
  public startScreenShare(track: MediaTrackLike): TrackSnapshot { if (this.screenTrack) this.stopTrackSafely(this.screenTrack); const normalized = this.normalizeTrack(track, 'screen'); if (!normalized) return this.handleScreenShareFallback('Screen track was already ended'); this.screenTrack = normalized; this.fallbackToMediaOnly = false; this.lastError = null; return this.getSnapshot(); }
  public stopScreenShare(): TrackSnapshot { if (this.screenTrack) { this.stopTrackSafely(this.screenTrack); this.screenTrack = null; } return this.getSnapshot(); }
  public handleScreenShareFallback(reason = 'Screen capture unavailable'): TrackSnapshot { if (this.screenTrack) { this.stopTrackSafely(this.screenTrack); this.screenTrack = null; } this.fallbackToMediaOnly = true; this.lastError = reason; return this.getSnapshot(); }
  public cleanupEndedTracks(): TrackSnapshot { if (this.micTrack?.readyState === 'ended') this.micTrack = null; if (this.cameraTrack?.readyState === 'ended') this.cameraTrack = null; if (this.screenTrack?.readyState === 'ended') { this.screenTrack = null; this.fallbackToMediaOnly = true; } return this.getSnapshot(); }
  public getNegotiationState(): NegotiationState { return this.negotiationState; }
  public getSnapshot(): TrackSnapshot {
    this.cleanupEndedTracksInternal();
    const activeTrackIds: string[] = [];
    if (this.micTrack && this.micTrack.enabled !== false) activeTrackIds.push(this.micTrack.id);
    if (this.cameraTrack && this.cameraTrack.enabled !== false) activeTrackIds.push(this.cameraTrack.id);
    if (this.screenTrack && this.screenTrack.enabled !== false) activeTrackIds.push(this.screenTrack.id);
    return { micActive: Boolean(this.micTrack && this.micTrack.enabled !== false), cameraActive: Boolean(this.cameraTrack && this.cameraTrack.enabled !== false), screenShareActive: Boolean(this.screenTrack && this.screenTrack.enabled !== false), fallbackToMediaOnly: this.fallbackToMediaOnly, negotiationState: this.negotiationState, activeTrackIds, lastError: this.lastError };
  }
  public async requestRenegotiation(reason = 'track-update'): Promise<void> {
    if (this.negotiationState === 'negotiating' || this.negotiationState === 'queued_renegotiation') {
      this.negotiationState = 'queued_renegotiation';
      this.pendingReason = reason;
      if (this.activeDrainPromise) await this.activeDrainPromise;
      return;
    }
    this.pendingReason = reason;
    this.activeDrainPromise = this.drainQueue();
    try { await this.activeDrainPromise; } finally { this.activeDrainPromise = null; }
  }
  private async drainQueue(): Promise<void> {
    while (this.pendingReason !== null) {
      const nextReason = this.pendingReason;
      this.pendingReason = null;
      this.negotiationState = 'negotiating';
      try { await this.runner.performNegotiation(nextReason); } catch (err) { this.lastError = err instanceof Error ? err.message : 'SDP renegotiation failed'; this.negotiationState = 'stable'; throw err; }
      this.negotiationState = this.pendingReason !== null ? 'queued_renegotiation' : 'stable';
    }
  }
  public dispose(): void { this.pendingReason = null; this.negotiationState = 'stable'; for (const t of [this.micTrack, this.cameraTrack, this.screenTrack]) if (t) this.stopTrackSafely(t); this.micTrack = null; this.cameraTrack = null; this.screenTrack = null; }
}

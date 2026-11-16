/**
 * ICEReconnectManager - Resilient WebRTC ICE Reconnection and Failover Manager
 *
 * Implements exponential backoff with decorrelated full jitter, disconnect grace periods,
 * automated ICE restart negotiation, and dynamic STUN/TURN fallback server cycling.
 */

export type ReconnectState =
  | 'idle'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export interface ICEReconnectConfig {
  /** Initial delay before first retry in milliseconds (default: 500) */
  baseDelayMs?: number;
  /** Maximum retry delay cap in milliseconds (default: 8000) */
  maxDelayMs?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffFactor?: number;
  /** Full jitter randomization ratio between 0 and 1 (default: 0.3) */
  jitterRatio?: number;
  /** Maximum number of sequential reconnection attempts before failing (default: 5) */
  maxAttempts?: number;
  /** Grace window in milliseconds before a 'disconnected' state triggers retry (default: 3000) */
  disconnectGracePeriodMs?: number;
  /** Fallback STUN/TURN servers to apply if initial reconnection fails (e.g. after attempt 2) */
  fallbackIceServers?: RTCIceServer[];
  /** Attempt threshold at which fallback ICE servers are activated (default: 2) */
  fallbackAttemptThreshold?: number;
  /** Whether to execute peerConnection.restartIce() during reconnection (default: true) */
  enableIceRestart?: boolean;
}

export type StateChangeHandler = (state: ReconnectState) => void;
export type AttemptHandler = (attempt: number, delayMs: number) => void;
export type IceRestartHandler = () => void;
export type FallbackHandler = (servers: RTCIceServer[]) => void;
export type FatalFailureHandler = (finalAttempt: number) => void;

export class ICEReconnectManager {
  private config: Required<ICEReconnectConfig>;
  private state: ReconnectState = 'idle';
  private attemptCount = 0;
  private peerConnection: RTCPeerConnection | null = null;
  private renegotiateOfferHandler: (() => Promise<void>) | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackApplied = false;
  /** True while one ICE restart/renegotiation cycle is awaiting completion. */
  private reconnectInFlight = false;
  /** Coalesces failure notifications received during an active reconnect cycle. */
  private reconnectRequested = false;

  private stateChangeListeners = new Set<StateChangeHandler>();
  private attemptListeners = new Set<AttemptHandler>();
  private iceRestartListeners = new Set<IceRestartHandler>();
  private fallbackListeners = new Set<FallbackHandler>();
  private fatalFailureListeners = new Set<FatalFailureHandler>();

  constructor(config?: ICEReconnectConfig) {
    this.config = {
      baseDelayMs: config?.baseDelayMs ?? 500,
      maxDelayMs: config?.maxDelayMs ?? 8000,
      backoffFactor: config?.backoffFactor ?? 2,
      jitterRatio: Math.max(0, Math.min(1, config?.jitterRatio ?? 0.3)),
      maxAttempts: config?.maxAttempts ?? 5,
      disconnectGracePeriodMs: config?.disconnectGracePeriodMs ?? 3000,
      fallbackIceServers: config?.fallbackIceServers ?? [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
      fallbackAttemptThreshold: config?.fallbackAttemptThreshold ?? 2,
      enableIceRestart: config?.enableIceRestart ?? true,
    };
  }

  /**
   * Attaches the reconnect manager to a live RTCPeerConnection instance.
   */
  public attach(
    pc: RTCPeerConnection,
    renegotiateOffer?: () => Promise<void>,
  ): void {
    this.peerConnection = pc;
    this.renegotiateOfferHandler = renegotiateOffer ?? null;

    // Track state initially
    this.syncPeerConnectionState();
  }

  /**
   * Evaluates and updates the reconnection state machine based on RTCIceConnectionState.
   */
  public handleIceConnectionStateChange(state: RTCIceConnectionState): void {
    if (this.state === 'closed') return;

    switch (state) {
      case 'connected':
      case 'completed':
        this.clearGraceTimer();
        this.clearReconnectTimer();
        this.reconnectRequested = false;
        this.attemptCount = 0;
        this.fallbackApplied = false;
        this.transitionState('connected');
        break;

      case 'disconnected':
        this.handleTransientDisconnect();
        break;

      case 'failed':
        this.clearGraceTimer();
        // Preserve an already-scheduled or active retry state when duplicate
        // failure events arrive; the current cycle owns the next transition.
        if (!this.reconnectInFlight && this.reconnectTimer === null) {
          this.transitionState('disconnected');
        }
        this.scheduleReconnect();
        break;

      case 'closed':
        this.dispose();
        break;

      default:
        // 'new' or 'checking'
        break;
    }
  }

  /**
   * Evaluates changes on standard RTCPeerConnection.connectionState.
   */
  public handleConnectionStateChange(state: RTCPeerConnectionState): void {
    if (this.state === 'closed') return;

    if (state === 'connected') {
      this.clearGraceTimer();
      this.clearReconnectTimer();
      this.attemptCount = 0;
      this.transitionState('connected');
    } else if (state === 'failed') {
      this.clearGraceTimer();
      this.scheduleReconnect();
    } else if (state === 'closed') {
      this.dispose();
    }
  }

  /**
   * Disconnect grace period handling: delays reconnection if disconnected might be transient.
   */
  private handleTransientDisconnect(): void {
    if (this.graceTimer !== null) return;

    this.transitionState('disconnected');
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.state === 'disconnected') {
        this.scheduleReconnect();
      }
    }, this.config.disconnectGracePeriodMs);
  }

  /**
   * Computes exponential backoff with full randomized jitter.
   */
  public computeBackoff(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    const unjittered = Math.min(
      this.config.maxDelayMs,
      this.config.baseDelayMs * Math.pow(this.config.backoffFactor, exponent),
    );

    const jitterRange = unjittered * this.config.jitterRatio;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // +/- jitterRange
    return Math.max(this.config.baseDelayMs, Math.round(unjittered + jitter));
  }

  /**
   * Schedules a reconnect attempt based on backoff calculation.
   */
  private scheduleReconnect(): void {
    if (this.state === 'closed') return;

    // A notification during an active ICE restart should request at most one
    // follow-up attempt; it must never start a second negotiation concurrently.
    if (this.reconnectInFlight) {
      this.reconnectRequested = true;
      return;
    }

    // A pending timeout already represents the next reconnect attempt. Check it
    // before the retry budget so duplicate events cannot exhaust the budget early.
    if (this.reconnectTimer !== null) return;

    if (this.attemptCount >= this.config.maxAttempts) {
      this.transitionState('failed');
      this.fatalFailureListeners.forEach((cb) => cb(this.attemptCount));
      return;
    }

    this.attemptCount++;
    const delay = this.computeBackoff(this.attemptCount);
    this.transitionState('reconnecting');
    this.attemptListeners.forEach((cb) => cb(this.attemptCount, delay));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.executeReconnectCycle();
    }, delay);
  }

  /**
   * Executes a single reconnect cycle including fallback check and ICE restart.
   */
  public async executeReconnectCycle(): Promise<boolean> {
    if (this.state === 'closed') return false;

    if (this.reconnectInFlight) {
      this.reconnectRequested = true;
      return false;
    }

    this.reconnectInFlight = true;
    this.reconnectRequested = false;

    try {
      // Check if we should activate fallback ICE servers
      if (
        !this.fallbackApplied &&
        this.attemptCount >= this.config.fallbackAttemptThreshold &&
        this.config.fallbackIceServers.length > 0 &&
        this.peerConnection
      ) {
        this.applyFallbackIceServers();
      }

      // Trigger ICE restart if enabled
      if (this.config.enableIceRestart && this.peerConnection) {
        if (typeof this.peerConnection.restartIce === 'function') {
          this.peerConnection.restartIce();
        }
        this.iceRestartListeners.forEach((cb) => cb());

        if (this.renegotiateOfferHandler) {
          await this.renegotiateOfferHandler();
        }
      }

      return true;
    } catch (err) {
      console.warn('[ICEReconnectManager] ICE restart error:', err);
      // The finally block schedules one coalesced retry after releasing the lock.
      this.reconnectRequested = true;
      return false;
    } finally {
      this.reconnectInFlight = false;
      if (this.reconnectRequested && this.state !== 'closed') {
        this.reconnectRequested = false;
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Applies fallback STUN/TURN configuration to the peer connection.
   */
  private applyFallbackIceServers(): void {
    if (!this.peerConnection || typeof this.peerConnection.setConfiguration !== 'function') {
      return;
    }

    try {
      const currentConfig = this.peerConnection.getConfiguration?.() ?? {};
      const newConfig: RTCConfiguration = {
        ...currentConfig,
        iceServers: [...this.config.fallbackIceServers],
      };
      this.peerConnection.setConfiguration(newConfig);
      this.fallbackApplied = true;
      this.fallbackListeners.forEach((cb) => cb(this.config.fallbackIceServers));
    } catch (err) {
      console.warn('[ICEReconnectManager] Failed to apply fallback ICE configuration:', err);
    }
  }

  /**
   * Manually triggers an immediate reconnection attempt, resetting backoff if desired.
   */
  public async manualReconnect(resetAttempts = false): Promise<boolean> {
    if (this.state === 'closed') return false;

    if (this.reconnectInFlight) {
      this.reconnectRequested = true;
      return false;
    }

    if (resetAttempts) {
      this.attemptCount = 0;
    }

    this.clearGraceTimer();
    this.clearReconnectTimer();
    this.attemptCount++;
    this.transitionState('reconnecting');
    return this.executeReconnectCycle();
  }

  /**
   * Synchronizes internal state with the attached peer connection.
   */
  private syncPeerConnectionState(): void {
    if (!this.peerConnection) return;

    const iceState = this.peerConnection.iceConnectionState;
    if (iceState === 'connected' || iceState === 'completed') {
      this.state = 'connected';
    } else if (iceState === 'disconnected') {
      this.state = 'disconnected';
    } else if (iceState === 'failed') {
      this.state = 'disconnected';
    } else {
      this.state = 'idle';
    }
  }

  private transitionState(newState: ReconnectState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.stateChangeListeners.forEach((cb) => cb(newState));
  }

  private clearGraceTimer(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- Public Query API ---

  public getState(): ReconnectState {
    return this.state;
  }

  public getAttemptCount(): number {
    return this.attemptCount;
  }

  public isFallbackActive(): boolean {
    return this.fallbackApplied;
  }

  public getConfig(): Readonly<Required<ICEReconnectConfig>> {
    return this.config;
  }

  // --- Event Subscription API ---

  public onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeListeners.add(handler);
    return () => this.stateChangeListeners.delete(handler);
  }

  public onAttempt(handler: AttemptHandler): () => void {
    this.attemptListeners.add(handler);
    return () => this.attemptListeners.delete(handler);
  }

  public onIceRestart(handler: IceRestartHandler): () => void {
    this.iceRestartListeners.add(handler);
    return () => this.iceRestartListeners.delete(handler);
  }

  public onFallbackApplied(handler: FallbackHandler): () => void {
    this.fallbackListeners.add(handler);
    return () => this.fallbackListeners.delete(handler);
  }

  public onFatalFailure(handler: FatalFailureHandler): () => void {
    this.fatalFailureListeners.add(handler);
    return () => this.fatalFailureListeners.delete(handler);
  }

  /**
   * Resets the reconnect counters and transitions to idle.
   */
  public reset(): void {
    this.clearGraceTimer();
    this.clearReconnectTimer();
    this.reconnectRequested = false;
    this.attemptCount = 0;
    this.fallbackApplied = false;
    this.transitionState('idle');
  }

  /**
   * Fully disposes all active timers and event listeners, preventing memory leaks.
   */
  public dispose(): void {
    this.clearGraceTimer();
    this.clearReconnectTimer();
    this.reconnectRequested = false;
    this.state = 'closed';
    this.peerConnection = null;
    this.renegotiateOfferHandler = null;
    this.stateChangeListeners.clear();
    this.attemptListeners.clear();
    this.iceRestartListeners.clear();
    this.fallbackListeners.clear();
    this.fatalFailureListeners.clear();
  }
}

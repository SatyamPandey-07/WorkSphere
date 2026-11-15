export const WS_CLOSE_UNAUTHORIZED = 4401;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const BASE_RECONNECT_DELAY_MS = 1000;

export type TelemetryConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "refreshing_token"
  | "session_expired"
  | "disconnected";

export interface TelemetryWsClientOptions {
  url: string;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  onMessage?: (data: unknown) => void;
  onStatusChange?: (
    status: TelemetryConnectionStatus,
    message?: string,
  ) => void;
  maxReconnectAttempts?: number;
  baseDelayMs?: number;
}

export function isUnauthorizedCloseEvent(event: CloseEvent): boolean {
  if (event.code === WS_CLOSE_UNAUTHORIZED) return true;
  const reason = (event.reason ?? "").toLowerCase();
  return reason.includes("4401") || reason.includes("unauthorized");
}

export function computeReconnectDelay(
  attempt: number,
  baseDelayMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exponential + jitter, 30_000);
}

export class TelemetryWebSocketClient {
  private readonly url: string;
  private readonly getToken: (options?: {
    skipCache?: boolean;
  }) => Promise<string | null>;
  private readonly onMessage?: (data: unknown) => void;
  private readonly onStatusChange?: (
    status: TelemetryConnectionStatus,
    message?: string,
  ) => void;
  private readonly maxReconnectAttempts: number;
  private readonly baseDelayMs: number;

  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManuallyClosed = false;
  private isRefreshingAuth = false;

  constructor(options: TelemetryWsClientOptions) {
    this.url = options.url;
    this.getToken = options.getToken;
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? BASE_RECONNECT_DELAY_MS;
  }

  public async connect(skipCache = false): Promise<void> {
    if (this.isManuallyClosed) return;

    this.clearReconnectTimer();
    this.onStatusChange?.(skipCache ? "refreshing_token" : "connecting");

    let token: string | null = null;
    try {
      token = await this.getToken(skipCache ? { skipCache: true } : undefined);
    } catch {
      token = null;
    }

    if (this.isManuallyClosed) return;

    if (!token) {
      this.haltWithSessionExpired(
        "Session expired. Please sign in again to resume live telemetry.",
      );
      return;
    }

    const authenticatedUrl = this.buildAuthenticatedUrl(token);
    const ws = new WebSocket(authenticatedUrl);
    this.socket = ws;

    ws.onopen = () => {
      if (this.isManuallyClosed) {
        ws.close(1000, "Client closed");
        return;
      }
      this.reconnectAttempts = 0;
      this.isRefreshingAuth = false;
      this.onStatusChange?.("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!this.onMessage) return;
      try {
        const parsed: unknown =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        this.onMessage(parsed);
      } catch {
        this.onMessage(event.data);
      }
    };

    ws.onerror = () => {
      // Errors are followed by onclose; handled cleanly there without unhandled rejections
    };

    ws.onclose = (event: CloseEvent) => {
      this.socket = null;

      if (this.isManuallyClosed) {
        this.onStatusChange?.("disconnected");
        return;
      }

      if (isUnauthorizedCloseEvent(event)) {
        void this.handleUnauthorizedClose();
        return;
      }

      this.scheduleReconnect();
    };
  }

  private async handleUnauthorizedClose(): Promise<void> {
    // Halt standard reconnection loops immediately
    this.clearReconnectTimer();

    // Prevent concurrent token refresh loops if 4401 repeats even after a fresh token
    if (this.isRefreshingAuth) {
      this.haltWithSessionExpired("Session expired. Please sign in again.");
      return;
    }

    this.isRefreshingAuth = true;
    this.onStatusChange?.("refreshing_token");

    try {
      const freshToken = await this.getToken({ skipCache: true });

      if (this.isManuallyClosed) return;

      if (!freshToken) {
        this.haltWithSessionExpired(
          "Your session has expired. Please sign in again.",
        );
        return;
      }

      // Re-establish connection with the newly refreshed Clerk token
      await this.connectWithExplicitToken(freshToken);
    } catch {
      this.haltWithSessionExpired(
        "Unable to refresh session. Please sign in again.",
      );
    }
  }

  private async connectWithExplicitToken(token: string): Promise<void> {
    if (this.isManuallyClosed) return;

    const ws = new WebSocket(this.buildAuthenticatedUrl(token));
    this.socket = ws;

    ws.onopen = () => {
      if (this.isManuallyClosed) {
        ws.close(1000, "Client closed");
        return;
      }
      this.reconnectAttempts = 0;
      this.isRefreshingAuth = false;
      this.onStatusChange?.("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!this.onMessage) return;
      try {
        const parsed: unknown =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        this.onMessage(parsed);
      } catch {
        this.onMessage(event.data);
      }
    };

    ws.onerror = () => {};

    ws.onclose = (event: CloseEvent) => {
      this.socket = null;

      if (this.isManuallyClosed) {
        this.onStatusChange?.("disconnected");
        return;
      }

      if (isUnauthorizedCloseEvent(event)) {
        this.haltWithSessionExpired("Session expired. Please sign in again.");
        return;
      }

      this.isRefreshingAuth = false;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.isManuallyClosed) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.haltWithSessionExpired(
        "Telemetry connection lost after 5 attempts. Your session may have expired—please refresh or sign in again.",
      );
      return;
    }

    this.reconnectAttempts += 1;
    const delay = computeReconnectDelay(
      this.reconnectAttempts,
      this.baseDelayMs,
    );
    this.onStatusChange?.("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      void this.connect(false);
    }, delay);
  }

  private haltWithSessionExpired(warningMessage: string): void {
    this.clearReconnectTimer();
    this.isRefreshingAuth = false;
    this.onStatusChange?.("session_expired", warningMessage);
  }

  private buildAuthenticatedUrl(token: string): string {
    const separator = this.url.includes("?") ? "&" : "?";
    return `${this.url}${separator}token=${encodeURIComponent(token)}`;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public disconnect(): void {
    this.isManuallyClosed = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.close(1000, "Component unmounted");
      this.socket = null;
    }
    this.onStatusChange?.("disconnected");
  }
}

/**
 * Standardized Connection Lifecycle States for Real-Time Services (WebRTC & PartySocket).
 *
 * Supported standardized states:
 * - CONNECTING: Connection establishment is in progress.
 * - CONNECTED: Connection is open, healthy, and operational.
 * - DEGRADED: Connection is active but experiencing packet loss, high latency, or reduced quality.
 * - RECONNECTING: Connection was interrupted and is actively retrying / renegotiating.
 * - DISCONNECTED: Connection is closed, terminated, or failed beyond retry limits.
 */

export const ConnectionLifecycleState = {
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  DEGRADED: "DEGRADED",
  RECONNECTING: "RECONNECTING",
  DISCONNECTED: "DISCONNECTED",
} as const;

export type ConnectionLifecycleState =
  (typeof ConnectionLifecycleState)[keyof typeof ConnectionLifecycleState];

/**
 * Backwards-compatible ConnectionState enum supporting both legacy states
 * and standardized lifecycle states.
 */
export enum ConnectionState {
  CLOSED = "CLOSED",
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DEGRADED = "DEGRADED",
  RECONNECTING = "RECONNECTING",
}

/**
 * Maps WebRTC RTCIceConnectionState / RTCPeerConnectionState to standardized ConnectionLifecycleState.
 */
export function mapIceToLifecycleState(
  iceState: RTCIceConnectionState | string,
  isDegraded = false,
): ConnectionLifecycleState {
  switch (iceState) {
    case "new":
    case "checking":
      return ConnectionLifecycleState.CONNECTING;
    case "connected":
    case "completed":
      return isDegraded
        ? ConnectionLifecycleState.DEGRADED
        : ConnectionLifecycleState.CONNECTED;
    case "disconnected":
      return ConnectionLifecycleState.RECONNECTING;
    case "failed":
    case "closed":
    default:
      return ConnectionLifecycleState.DISCONNECTED;
  }
}

/**
 * Maps WebRTC RTCPeerConnectionState to standardized ConnectionLifecycleState.
 */
export function mapPeerConnectionToLifecycleState(
  peerState: RTCPeerConnectionState | string,
  isDegraded = false,
): ConnectionLifecycleState {
  switch (peerState) {
    case "new":
    case "connecting":
      return ConnectionLifecycleState.CONNECTING;
    case "connected":
      return isDegraded
        ? ConnectionLifecycleState.DEGRADED
        : ConnectionLifecycleState.CONNECTED;
    case "disconnected":
      return ConnectionLifecycleState.RECONNECTING;
    case "failed":
    case "closed":
    default:
      return ConnectionLifecycleState.DISCONNECTED;
  }
}

/**
 * Maps PartySocket connection state to standardized ConnectionLifecycleState.
 */
export function mapPartySocketToLifecycleState(
  state: ConnectionState | string,
  isDegraded = false,
): ConnectionLifecycleState {
  switch (state) {
    case ConnectionState.CONNECTING:
    case "CONNECTING":
    case "connecting":
      return ConnectionLifecycleState.CONNECTING;
    case ConnectionState.CONNECTED:
    case "CONNECTED":
    case "connected":
      return isDegraded
        ? ConnectionLifecycleState.DEGRADED
        : ConnectionLifecycleState.CONNECTED;
    case ConnectionState.RECONNECTING:
    case "RECONNECTING":
    case "reconnecting":
      return ConnectionLifecycleState.RECONNECTING;
    case ConnectionState.CLOSED:
    case ConnectionState.DISCONNECTED:
    case "CLOSED":
    case "DISCONNECTED":
    case "closed":
    case "disconnected":
    case "offline":
    default:
      return ConnectionLifecycleState.DISCONNECTED;
  }
}

/**
 * Returns true if the connection is currently alive (CONNECTED or DEGRADED).
 */
export function isConnectionAlive(
  state: ConnectionLifecycleState | ConnectionState | string,
): boolean {
  return (
    state === ConnectionLifecycleState.CONNECTED ||
    state === ConnectionLifecycleState.DEGRADED ||
    state === ConnectionState.CONNECTED ||
    state === ConnectionState.DEGRADED ||
    state === "connected"
  );
}

/**
 * Returns true if the connection is in a transitional state (CONNECTING or RECONNECTING).
 */
export function isConnectionTransitioning(
  state: ConnectionLifecycleState | ConnectionState | string,
): boolean {
  return (
    state === ConnectionLifecycleState.CONNECTING ||
    state === ConnectionLifecycleState.RECONNECTING ||
    state === ConnectionState.CONNECTING ||
    state === ConnectionState.RECONNECTING ||
    state === "connecting" ||
    state === "reconnecting"
  );
}

# WorkSphere Flutter SSE & PartyKit WebSocket Client Integration

Documents how Flutter (`apps/flutter/`) integrates with WorkSphere's real-time transport layers:

1. **Replayable Server-Sent Events (SSE)** via `GET /api/reservations/events` (`Last-Event-ID` cursor replay & `resync_required` recovery).
2. **PartyKit WebSockets** (`party/server.ts`, `party/venueRoom.ts`) with **Folder ACL Leases** (`src/lib/realtime/folderAclLease.ts`).
3. **Exponential Reconnect Backoff & Heartbeat Handling** in Dart matching the web client invariants.

---

## 1. Replayable SSE Client (`/api/reservations/events`)

### 1.1 Endpoint Contract (`src/app/api/reservations/events/route.ts`)

* **URL:** `GET /api/reservations/events?venueId=<venueId>` (returns HTTP `400` if `venueId` is missing).
* **Authentication:** Send the active Clerk session JWT (`Authorization: Bearer <token>`) or authenticated cookie. Unauthenticated requests are redirected (`307`) by Clerk middleware and must trigger a token refresh rather than an infinite SSE retry loop.
* **Resume Cursor:** Include `Last-Event-ID: <cursor>` in the request headers (or `?lastEventId=<cursor>` query parameter fallback) on reconnects so `replayVenueAvailabilityAfter(venueId, lastEventId)` replays missed events from `SharedReservationReplayLog` (`maxRetainedEvents = 1000`).

### 1.2 Server Frame Types

| SSE `event:` | `id:` Present | Payload Shape | Dart Client Action |
| :--- | :--- | :--- | :--- |
| `connected` | No | `{ "type": "connected", "venueId": "...", "timestamp": "..." }` | Mark stream active; reset `retryAttempt = 0`. |
| `heartbeat` | No | `{ "type": "heartbeat", "venueId": "...", "timestamp": "..." }` | Update `lastFrameAt` watchdog timestamp (emitted every `15,000 ms`). |
| `availability` | Yes (`cursor`) | `{ "type": "RESERVATION_CREATED" \| ..., "venueId": "...", ... }` | Persist `lastEventId = id`, update local seat/hold state. |
| `desk_expired` | Yes (`cursor`) | `{ "type": "DESK_HOLD_EXPIRED" \| "SEAT_HOLD_EXPIRED", ... }` | Persist `lastEventId = id`, expire matching local hold countdown. |
| `resync_required` | No | `{ "reason": "malformed_cursor" \| "cursor_expired" \| "cursor_ahead_of_stream", "latestCursor": <int>, "venueId": "..." }` | Clear stored `lastEventId`, run full REST snapshot fetch, reconnect without stale cursor. |

### 1.3 Reconnect Backoff Parity (`src/lib/sseReconnect.ts`)

Mirror the web client's exponential backoff with ±20% jitter:

* **Initial Delay:** `1,000 ms` (`SSE_RECONNECT_INITIAL_DELAY`)
* **Max Delay:** `30,000 ms` (`SSE_RECONNECT_MAX_DELAY`)
* **Jitter:** `±20%` (`SSE_RECONNECT_JITTER = 0.2`)

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;

int computeReconnectDelayMs(int attempt, [Random? rng]) {
  final random = rng ?? Random();
  const initialDelayMs = 1000;
  const maxDelayMs = 30000;
  const jitter = 0.2;

  final safeAttempt = max(0, attempt);
  final baseDelay = min(
    initialDelayMs * pow(2, min(safeAttempt, 30)).toInt(),
    maxDelayMs,
  );
  final jitterMultiplier = (1 - jitter) + random.nextDouble() * (jitter * 2);
  return min(maxDelayMs, (baseDelay * jitterMultiplier).round());
}

class ReservationSseClient {
  ReservationSseClient({
    required this.baseUri,
    required this.venueId,
    required this.tokenProvider,
    required this.onEvent,
    required this.onResyncRequired,
  });

  final Uri baseUri;
  final String venueId;
  final Future<String?> Function() tokenProvider;
  final void Function(String eventName, Map<String, dynamic> data) onEvent;
  final Future<void> Function(String reason) onResyncRequired;

  static const Duration heartbeatTimeout = Duration(seconds: 40); // > 2x 15s server heartbeat

  http.Client? _httpClient;
  StreamSubscription<String>? _lineSub;
  Timer? _retryTimer;
  Timer? _watchdogTimer;
  String? _lastEventId;
  int _retryAttempt = 0;
  bool _disposed = false;

  Future<void> connect() async {
    if (_disposed) return;
    _cleanupSocket();

    final token = await tokenProvider();
    if (_disposed) return;

    final client = http.Client();
    _httpClient = client;

    final uri = baseUri.replace(
      path: '/api/reservations/events',
      queryParameters: {
        'venueId': venueId,
        if (_lastEventId != null) 'lastEventId': _lastEventId!,
      },
    );

    final request = http.Request('GET', uri)
      ..headers['Accept'] = 'text/event-stream'
      ..headers['Cache-Control'] = 'no-cache'
      ..followRedirects = false;

    if (token != null) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    if (_lastEventId != null) {
      request.headers['Last-Event-ID'] = _lastEventId!;
    }

    try {
      final response = await client.send(request);
      if (_disposed) return;

      if (response.statusCode == 401 || response.statusCode == 307) {
        _scheduleReconnect();
        return;
      }
      if (response.statusCode != 200) {
        _scheduleReconnect();
        return;
      }

      _resetWatchdog();
      String currentEvent = 'message';
      String? currentId;
      final dataLines = <String>[];

      _lineSub = response.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
        (line) {
          _resetWatchdog();
          if (line.isEmpty) {
            if (dataLines.isNotEmpty) {
              final raw = dataLines.join('\n');
              _dispatchFrame(currentEvent, currentId, raw);
            }
            currentEvent = 'message';
            currentId = null;
            dataLines.clear();
            return;
          }
          if (line.startsWith(':')) return;
          if (line.startsWith('event:')) {
            currentEvent = line.substring(6).trim();
          } else if (line.startsWith('id:')) {
            currentId = line.substring(3).trim();
          } else if (line.startsWith('data:')) {
            dataLines.add(line.substring(5).trimLeft());
          }
        },
        onError: (_) => _scheduleReconnect(),
        onDone: _scheduleReconnect,
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _dispatchFrame(String eventName, String? id, String rawData) {
    if (id != null && id.isNotEmpty) {
      _lastEventId = id;
    }
    final decoded = jsonDecode(rawData);
    if (decoded is! Map<String, dynamic>) return;

    if (eventName == 'connected') {
      _retryAttempt = 0;
      return;
    }
    if (eventName == 'heartbeat') {
      return;
    }
    if (eventName == 'resync_required') {
      _lastEventId = null;
      unawaited(onResyncRequired(decoded['reason']?.toString() ?? 'unknown'));
      return;
    }
    onEvent(eventName, decoded);
  }

  void _resetWatchdog() {
    _watchdogTimer?.cancel();
    _watchdogTimer = Timer(heartbeatTimeout, () {
      _scheduleReconnect();
    });
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _cleanupSocket();
    if (_retryTimer?.isActive ?? false) return;

    final delayMs = computeReconnectDelayMs(_retryAttempt++);
    _retryTimer = Timer(Duration(milliseconds: delayMs), () {
      _retryTimer = null;
      unawaited(connect());
    });
  }

  void _cleanupSocket() {
    _watchdogTimer?.cancel();
    _watchdogTimer = null;
    unawaited(_lineSub?.cancel());
    _lineSub = null;
    _httpClient?.close();
    _httpClient = null;
  }

  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    _cleanupSocket();
  }
}
```

> **Lifecycle Note:** Always cancel `_retryTimer` and `_watchdogTimer` in `dispose()` (and pause/close on `AppLifecycleState.paused` when backgrounded) to prevent dangling timers after widget unmount.

---

## 2. PartyKit WebSockets & `folderAclLease`

### 2.1 Connection Handshake & Authorization (`party/server.ts`, `src/app/api/partykit/auth/route.ts`)

1. Client connects via `WebSocket` (e.g., `web_socket_channel`) to:
   `wss://<PARTYKIT_HOST>/party/<roomId>?token=<clerkJwt>&lastSeq=<lastSeq>&epoch=<epoch>`
2. In `onConnect` (`party/server.ts`), the server verifies the Clerk JWT and calls `GET /api/partykit/auth?userId=...&folderId=...` (for folder rooms).
3. `/api/partykit/auth` mints a short-lived `FolderAclLease` via `FolderAclCoordinator.issueLease`:
   * **Default TTL:** `60,000 ms` (`DEFAULT_LEASE_TTL_MS`), capped at `300,000 ms` (`MAX_LEASE_TTL_MS`).
   * **Payload:** `{ role: "OWNER" | "EDITOR" | "VIEWER", member: bool, aclVersion: number, leaseExpiresAt: number }`.
   * **Fail-Closed Enforcement:** `ActiveConnectionLeaseEnforcer` rejects writes/deletes if the lease is missing, `nowMs > expiresAtMs`, or `aclVersion` is superseded.

### 2.2 ACL Lease Warnings, Revocation & Close Codes

| Signal / Close Code | Meaning | Dart Client Handling |
| :--- | :--- | :--- |
| `lease_expiring` (warning, `remainingMs <= 30000`) | Advisory warning emitted before `expiresAtMs`. | Trigger proactive room/token lease renewal; do not drop local UI state yet. |
| `acl:revoked` (message) | Folder membership revoked or role downgraded. | Clear cached folder state immediately; switch UI to read-only or exit room. |
| WS Close `4001` | `Unauthorized: Token expired`. | Fetch a fresh Clerk JWT before scheduling reconnect. |
| WS Close `4003` or `1008` | `Forbidden: collection notes are limited to members` / ACL revoked. | Stop automatic reconnect unless user re-authenticates or explicitly retries; clear restricted folder cache. |

### 2.3 WebSocket Heartbeat & Presence Protocol

* **Liveness Ping/Pong (`party/server.ts`, `party/venueRoom.ts`):**
  * `party/server.ts` sweeps every `15,000 ms`: sends `{"type":"ping"}` once `now - lastPong >= 10,000 ms` and closes stale sockets after `45,000 ms` (`party/venueRoom.ts` uses `10,000 ms` ping interval and `30,000 ms` eviction timeout).
  * The Dart client **must** reply immediately with `{"type":"pong"}` whenever `msg["type"] == "ping"`, and run a client-side `45s` liveness timer to detect silent mobile cellular drops.
* **Typing / Presence Heartbeat:** Active collaborative rooms expect `{"type":"presence_heartbeat"}` every `5,000 ms` (entries inactive `> 15,000 ms` are pruned).

```dart
class PartyKitRealtimeClient {
  PartyKitRealtimeClient({
    required this.roomUri,
    required this.jwtProvider,
    required this.onMessage,
    required this.onAclRevoked,
  });

  final Uri roomUri;
  final Future<String> Function() jwtProvider;
  final void Function(Map<String, dynamic> message) onMessage;
  final void Function(String reason) onAclRevoked;

  static const Duration serverHeartbeatTimeout = Duration(seconds: 45);

  WebSocket? _socket;
  Timer? _livenessTimer;
  Timer? _reconnectTimer;
  int _retryAttempt = 0;
  int? _lastSeq;
  int? _epoch;
  bool _disposed = false;

  Future<void> connect() async {
    if (_disposed) return;
    final token = await jwtProvider();
    if (_disposed) return;

    final uri = roomUri.replace(
      queryParameters: {
        ...roomUri.queryParameters,
        'token': token,
        if (_lastSeq != null) 'lastSeq': '$_lastSeq',
        if (_epoch != null) 'epoch': '$_epoch',
      },
    );

    try {
      final ws = await WebSocket.connect(uri.toString());
      _socket = ws;
      _retryAttempt = 0;
      _resetLivenessTimer();

      ws.listen(
        (raw) {
          _resetLivenessTimer();
          if (raw is! String) return;
          final msg = jsonDecode(raw);
          if (msg is! Map<String, dynamic>) return;

          if (msg['type'] == 'ping') {
            ws.add(jsonEncode({'type': 'pong'}));
            return;
          }
          if (msg['type'] == 'acl:revoked') {
            onAclRevoked(msg['reason']?.toString() ?? 'acl_revoked');
            return;
          }
          if (msg['sequenceId'] is int) _lastSeq = msg['sequenceId'] as int;
          if (msg['epoch'] is int) _epoch = msg['epoch'] as int;

          onMessage(msg);
        },
        onError: (_) => _handleDisconnect(ws.closeCode),
        onDone: () => _handleDisconnect(ws.closeCode),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _resetLivenessTimer() {
    _livenessTimer?.cancel();
    _livenessTimer = Timer(serverHeartbeatTimeout, () {
      _socket?.close(4000, 'Heartbeat timeout');
      _scheduleReconnect();
    });
  }

  void _handleDisconnect(int? closeCode) {
    _livenessTimer?.cancel();
    _socket = null;
    if (_disposed) return;

    // 4003 / 1008 = Forbidden / Policy Violation (ACL revoked) -> do not spin reconnect
    if (closeCode == 4003 || closeCode == 1008) {
      onAclRevoked('ws_close_$closeCode');
      return;
    }
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed || (_reconnectTimer?.isActive ?? false)) return;
    final delayMs = computeReconnectDelayMs(_retryAttempt++);
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      _reconnectTimer = null;
      unawaited(connect());
    });
  }

  void dispose() {
    _disposed = true;
    _livenessTimer?.cancel();
    _reconnectTimer?.cancel();
    unawaited(_socket?.close(1000, 'Client disposed'));
    _socket = null;
  }
}
```

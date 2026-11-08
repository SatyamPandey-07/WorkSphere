# Local PartyKit Development Setup

This guide explains how to run the PartyKit real-time server alongside the Next.js dev server so you can develop and test multiplayer features (seat check-ins, collaborative notes, live venue updates) locally.

---

## Prerequisites

* Node.js 20+ with `npm`
* A completed `.env.local` (see the root [README](../README.md#-environment-variables))
* `npx partykit dev` requires no separate account for local development

---

## 1. Install Dependencies

PartyKit and its socket client are already listed in `package.json`. Run the root install if you haven't already:

```bash
npm install
```

---

## 2. Environment Variables

Add these to your `.env.local`:

```env
# PartyKit server URL (local dev server)
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999
NEXT_PUBLIC_PARTYKIT_URL=http://127.0.0.1:1999

# Shared secret for the /api/partykit/auth endpoint
# Use any long random string for local dev; must match what PartyKit sends
PARTYKIT_SHARED_SECRET=your-local-dev-secret
```

> **Note:** `NEXT_PUBLIC_PARTYKIT_HOST` is used by the Yjs CRDT providers; `NEXT_PUBLIC_PARTYKIT_URL` is used by HTTP calls to the PartyKit REST API.

---

## 3. Start Both Servers

Open **two terminal windows** in the project root:

**Terminal 1 — PartyKit dev server**

```bash
npx partykit dev
```

You should see:

```
PartyKit dev server starting...
Listening on http://127.0.0.1:1999
```

**Terminal 2 — Next.js dev server**

```bash
npm run dev
```

The app will be available at `http://localhost:3000`. Real-time features will connect to the PartyKit server on port 1999.

---

## 4. Verifying the Connection

Open two browser tabs on `http://localhost:3000` and navigate to a venue detail dialog. Check-in one tab and confirm the seat count updates live in the other. The browser console should show WebSocket frames to `ws://127.0.0.1:1999`.

---

## 5. Troubleshooting

### PartyKit server not reachable

* Make sure `npx partykit dev` is still running.
* Confirm `NEXT_PUBLIC_PARTYKIT_HOST` is set to `127.0.0.1:1999` in `.env.local`.
* Restart the Next.js dev server after any `.env.local` change.

### `PARTYKIT_SHARED_SECRET is not set` error in the console

* Add `PARTYKIT_SHARED_SECRET` to your `.env.local`.
* Restart the Next.js dev server.

### WebSocket connection refused

* Check your firewall isn't blocking port 1999.
* Confirm no other process is using port 1999: `lsof -i :1999` (Linux/macOS) or `netstat -ano | findstr :1999` (Windows).

### PartyKit TypeScript compilation errors

* Run `npm run typecheck` from the project root to catch type errors in `party/server.ts` before starting.

---

## 6. Project Structure for PartyKit

```
party/
  server.ts          # Main PartyKit Durable Object server
  multiRegionServer.ts  # Multi-region replication logic
partykit.json        # PartyKit config (server entrypoint, compatibility date)
```

The `partykit.json` in the project root points to `party/server.ts` as the main server. Changes to `server.ts` are hot-reloaded by `npx partykit dev`.

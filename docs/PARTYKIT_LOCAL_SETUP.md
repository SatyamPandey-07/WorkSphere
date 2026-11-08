# PartyKit Local Development Setup

This guide explains how to run the PartyKit signaling server alongside Next.js during local development so that real-time features (collaborative editing, cursor presence, seat availability, WebRTC signaling) work end-to-end on your machine.

---

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | 18 or later |
| npm | 9 or later (bundled with Node.js 18+) |
| WorkSphere dependencies installed | `npm install` already run |
| Clerk account (dev keys) | Required for token verification on connect |

---

## Install Dependencies

If you have not already installed project dependencies:

```bash
npm install
```

`partykit` and `partysocket` are listed as regular dependencies in `package.json`, so they are included in the standard install.

---

## Start the PartyKit Server

The PartyKit server is defined in `party/server.ts` and configured in `partykit.json`. Start it with:

```bash
npx partykit dev
```

By default this binds to `127.0.0.1:1999`. You should see output similar to:

```
PartyKit dev server running at http://127.0.0.1:1999
```

Keep this process running in a separate terminal while you run the Next.js dev server.

---

## Start the Next.js App

In a second terminal:

```bash
npm run dev
```

The Next.js app starts on port 3000. Both servers must be running at the same time for real-time features to work.

---

## Required Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Then add or verify the following values in `.env.local`:

### Next.js client (browser-visible)

```env
# Points the browser-side PartySocket client at the local PartyKit server.
# Defaults to 127.0.0.1:1999 if unset, but setting it explicitly is recommended.
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999

# Base URL the PartyKit server uses when calling /api/partykit/auth.
# Must match where your Next.js dev server is listening.
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
```

### Clerk authentication (also read by the PartyKit process)

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key
CLERK_SECRET_KEY=sk_test_your_secret_key
```

The PartyKit server (`party/server.ts`) calls `verifyToken` from `@clerk/backend` using `CLERK_SECRET_KEY` to authenticate WebSocket connections. Without it, all connections without a valid token are treated as unauthenticated viewers or rejected outright.

### Full minimal `.env.local` for PartyKit development

```env
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

DATABASE_URL=postgresql://worksphere:worksphere@localhost:5432/worksphere
```

---

## How the Next.js App Connects to the Local Server

Every hook or component that opens a WebSocket reads `NEXT_PUBLIC_PARTYKIT_HOST` at runtime:

```ts
const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
```

Because the variable is prefixed `NEXT_PUBLIC_`, Next.js inlines it into the browser bundle at build time. If you change it after starting `npm run dev`, restart the Next.js server so the new value is picked up.

### Room names used by the app

| Feature | Room pattern |
| --- | --- |
| Folder collaboration (Yjs) | `folder-<id>` |
| Canvas whiteboard | `canvas-<id>` |
| Seat availability | `seat-availability` |
| Group notes | `notes-<roomId>` |
| Multi-region | `multi-region-room` |

---

## Troubleshooting

### WebSocket connection refused

Confirm `npx partykit dev` is still running and listening on port 1999:

```bash
npx partykit dev
# Look for: PartyKit dev server running at http://127.0.0.1:1999
```

If the port is taken, stop the other process or change the port and update `NEXT_PUBLIC_PARTYKIT_HOST` accordingly.

### WebSocket CORS errors in the browser console

During local development the PartyKit dev server (`npx partykit dev`) allows connections from any origin, so CORS should not be an issue. If you do see CORS errors:

1. Verify `NEXT_PUBLIC_PARTYKIT_HOST` is set to `127.0.0.1:1999` (not `localhost:1999`) — some browsers treat these differently.
2. Make sure you are connecting over `ws://` (not `wss://`) when both servers are running without TLS locally. `partysocket` chooses the protocol based on whether the page is served over HTTPS. Running both servers without HTTPS is the default local setup.
3. If you are using a reverse proxy or tunnelling service (e.g. ngrok) in front of the PartyKit server, ensure the proxy forwards the `Origin` header correctly.

### Token verification fails / connections close with code 4001

The server closes a connection with close code `4001` when the Clerk JWT is invalid or expired. In local development this means:

- `CLERK_SECRET_KEY` in `.env.local` does not match the publishable key you are using.
- The Clerk token has expired and the `usePartySocketReconnect` hook has not yet refreshed it (it retries automatically).
- You are testing without signing in — unauthenticated connections are accepted as read-only viewers for most rooms.

### PartyKit server cannot reach `/api/partykit/auth`

The server calls `http://127.0.0.1:3000/api/partykit/auth` to look up a user's folder role. If that request fails the user is treated as a viewer. Ensure:

- The Next.js dev server is running on port 3000.
- `NEXT_PUBLIC_APP_URL` is set to `http://127.0.0.1:3000` in `.env.local`.
- Your database connection (`DATABASE_URL`) is correct so the auth route can query folder membership.

### Environment variable not picked up

`NEXT_PUBLIC_PARTYKIT_HOST` is baked into the browser bundle by Next.js at startup. After editing `.env.local`, restart `npm run dev` for the change to take effect.

---

## Quick-Start Checklist

- [ ] `npm install` complete
- [ ] `.env.local` created from `.env.example`
- [ ] `NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999` set in `.env.local`
- [ ] `CLERK_SECRET_KEY` set with a valid dev key
- [ ] Terminal 1: `npx partykit dev` running (port 1999)
- [ ] Terminal 2: `npm run dev` running (port 3000)
- [ ] Browser: sign in via Clerk, open a folder — presence cursors and collaborative editing should be active

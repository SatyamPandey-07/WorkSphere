# Local PartySocket / PartyKit Setup

This guide explains how to run WorkSphere’s local PartyKit WebSocket server with PartySocket clients. Use it when developing real-time features (presence, seats, Yjs folders, collaboration).

For architecture details, see [PARTYKIT_ARCHITECTURE.md](./PARTYKIT_ARCHITECTURE.md).

---

## Prerequisites

1. Node.js and npm installed (repo already lists `partykit` in `package.json`).
2. Dependencies installed from the repo root:

```bash
npm install
```

3. Next.js env configured (at least Clerk keys from `.env.example`). PartyKit auth uses `CLERK_SECRET_KEY` when verifying JWTs on connect.

---

## Step-by-step: start the local PartyKit server

### 1. Open a terminal at the repo root

```bash
cd /path/to/WorkSphere
```

### 2. Confirm PartyKit config

`partykit.json` points at the main server entry:

```json
{
  "name": "worksphere-multiplayer",
  "main": "party/server.ts",
  "compatibilityDate": "2024-03-20"
}
```

### 3. Start PartyKit in development mode

In its **own** terminal (leave it running):

```bash
npx partykit dev
```

By default the local WebSocket host is **`127.0.0.1:1999`**.

You should see PartyKit report that the server is listening. Keep this process up while you use collections, seat rings, or multiplayer chat.

### 4. Start the Next.js app (second terminal)

```bash
npm run dev
```

Typical local pair:

| Process | Command | Default URL / host |
| ------- | ------- | ------------------ |
| Next.js | `npm run dev` | `http://localhost:3000` |
| PartyKit | `npx partykit dev` | `127.0.0.1:1999` |

### 5. Point the client at the local host (optional)

Clients already default to `127.0.0.1:1999`. Override only if needed in `.env.local`:

```bash
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999
NEXT_PUBLIC_PARTYKIT_URL=http://127.0.0.1:1999
```

- `NEXT_PUBLIC_PARTYKIT_HOST` — browser PartySocket / YProvider host  
- `NEXT_PUBLIC_PARTYKIT_URL` — server-to-server posts (e.g. folder refresh)

### 6. Verify the WebSocket is up

1. Open the app (e.g. a collection page or map with seat presence).
2. In DevTools → **Network** → **WS**, confirm a connection to `127.0.0.1:1999` (or your configured host).
3. If the socket never connects, ensure `npx partykit dev` is still running and the host env matches.

---

## Quick reference

```bash
# Terminal A — PartyKit WebSocket server
npx partykit dev

# Terminal B — Next.js
npm run dev
```

Room examples used by the app:

| Room id | Purpose |
| ------- | ------- |
| `folder-{folderId}` | Collection / Yjs collaboration |
| `seat-availability` | Map seat presence |

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Sockets fail / reconnect forever | Start `npx partykit dev`; check nothing else bound to port `1999` |
| Auth rejected on connect | Set `CLERK_SECRET_KEY`; ensure Next is on `NEXT_PUBLIC_APP_URL` (default `http://127.0.0.1:3000`) |
| Wrong host | Align `NEXT_PUBLIC_PARTYKIT_HOST` / `NEXT_PUBLIC_PARTYKIT_URL` with the PartyKit listen address |

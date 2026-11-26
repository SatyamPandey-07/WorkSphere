# Clerk Webhook Setup for Local Development

## Overview

WorkSphere receives Clerk user lifecycle events at
`/api/webhooks/clerk`. The handler verifies each request with the endpoint's
Svix signature before it reads the event data or writes to the database.
Verified `user.created` and `user.updated` events create or refresh the local
user profile; `user.deleted` removes the matching local user record.

Webhook delivery is asynchronous. Configure a webhook when you need to test
Clerk-to-WorkSphere profile synchronization and account cleanup locally; a
webhook is not needed for UI-only development. The local user record is keyed
by the Clerk user ID and is used by database-backed features and user-scoped
permissions. The webhook does **not** assign roles or copy Clerk metadata into
WorkSphere. Administrator checks are handled separately using verified Clerk
role metadata or the configured `ADMIN_EMAILS` / `ADMIN_EMAIL` values.

## Prerequisites

- Access to a Clerk development instance and its Dashboard.
- The WorkSphere dependencies and local application environment configured.
  See [Local Development Setup](../guides/LOCAL_DEVELOPMENT_SETUP.md) and
  [Getting Started & Environment Setup](../setup.md).
- Node.js 20 or newer and npm, as used by the repository.
- A running WorkSphere development server on port `3000`.
- One tunneling option:
  - **LocalTunnel:** Node.js/npm is sufficient; no separate global install is
    needed for the `npx` command below.
  - **ngrok:** an ngrok account and the ngrok agent. Follow the
    [ngrok installation guide](https://ngrok.com/download); ngrok requires an
    account authtoken for the agent.

## Local webhook forwarding

1. Start the WorkSphere development server from the repository root:

   ```bash
   npm run dev
   ```

   Keep the server running at `http://localhost:3000`.

2. In a separate terminal, start **one** HTTPS tunnel to port `3000`.

   With LocalTunnel:

   ```bash
   npx localtunnel --port 3000
   ```

   Or, after [installing ngrok](https://ngrok.com/download), configure the
   agent with the authtoken from your ngrok account and start the tunnel.
   Replace `YOUR_NGROK_AUTHTOKEN` below with your own token and run this
   configuration command once:

   ```bash
   ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
   ```

   Then start the tunnel:

   ```bash
   ngrok http 3000
   ```

   Do not share or commit the authtoken.

   Leave the tunnel process running. It prints a public HTTPS forwarding URL,
   for example `https://<generated-host>`. Use the URL printed by your tunnel;
   the example is not a real endpoint.

3. In the [Clerk Dashboard Webhooks](https://dashboard.clerk.com/~/webhooks)
   page, open the same development instance used by WorkSphere and create an
   endpoint with this destination:

   ```text
   https://<generated-host>/api/webhooks/clerk
   ```

   This public HTTPS address forwards requests to the local handler at:

   ```text
   http://localhost:3000/api/webhooks/clerk
   ```

   Subscribe the endpoint to `user.created`, `user.updated`, and
   `user.deleted`. Those are the only event types this handler processes.

4. Save the endpoint, then copy its **signing secret** from the endpoint
   details. Configure that secret as described below. Keep the endpoint and
   tunnel running while testing.

Free or randomly assigned tunnel URLs can change when a tunnel is restarted.
If the URL changes, update the destination on the same Clerk endpoint and
keep using that endpoint's signing secret. If you create a new endpoint, copy
its signing secret and update `.env.local` to match.

## Environment configuration

Add the signing secret for the configured Clerk endpoint to the root
`.env.local` file:

```dotenv
CLERK_WEBHOOK_SECRET=<paste the endpoint signing secret from Clerk>
```

Replace the placeholder with the secret shown in the Clerk Dashboard; do not
include the angle brackets. The secret is endpoint-specific and must match the
endpoint sending events. Restart `npm run dev` after changing environment
variables.

The verifier prefers `CLERK_WEBHOOK_SIGNING_SECRET` when that variable is set,
then uses `CLERK_WEBHOOK_SECRET`. It also accepts `WEBHOOK_SECRET` as a legacy
fallback when neither preferred variable is set. For local Clerk setup, use
`CLERK_WEBHOOK_SECRET` and make sure no higher-priority variable contains a
different secret. Do not copy any secret into source control.

## Supported webhook events

The handler in `src/app/api/webhooks/clerk/route.ts` processes these events:

| Event          | WorkSphere behavior                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `user.created` | Creates or updates the local user row with the Clerk user ID, primary email (when present), first and last names, and profile image. |
| `user.updated` | Updates those same profile fields for the corresponding Clerk user ID.                                                               |
| `user.deleted` | Deletes the local user row for the Clerk user ID. Repeated deletion is safe.                                                         |

Other signed Clerk event types are acknowledged and ignored; they do not
change the WorkSphere database. In particular, user role or administrator
permissions are not synchronized by this endpoint.

## Testing webhook delivery

Use the development Clerk instance, not a production account:

1. Confirm the local server and tunnel are running, the Clerk endpoint points
   to the current HTTPS tunnel URL, and the matching signing secret is set.
2. Create a test account through the WorkSphere sign-up flow that uses this
   Clerk development instance. Clerk sends `user.created`; check the
   endpoint's message attempts in the Clerk Dashboard and the local server
   output.
3. To exercise deletion, delete that test account from the Clerk Dashboard.
   Clerk sends `user.deleted`; confirm the delivery succeeds.
4. To exercise an update, change the test user's profile in Clerk and check
   for a `user.updated` delivery.

Clerk webhook payloads are JSON event envelopes. The following examples show
the relevant shape and fields; the IDs, timestamp, email, and image are
illustrative, not credentials or actual requests:

```json
{
  "data": {
    "id": "user_2abc123xyz",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "image_url": "https://img.clerk.com/example-image",
    "primary_email_address_id": "idn_2abc123xyz",
    "email_addresses": [
      {
        "id": "idn_2abc123xyz",
        "email_address": "ada@example.test",
        "verification": {
          "status": "verified"
        }
      }
    ]
  },
  "object": "event",
  "type": "user.created",
  "instance_id": "ins_2abc123xyz",
  "timestamp": 1710000000000
}
```

A deletion event contains the user ID in its `data` object:

```json
{
  "data": {
    "id": "user_2abc123xyz",
    "deleted": true
  },
  "object": "event",
  "type": "user.deleted",
  "instance_id": "ins_2abc123xyz",
  "timestamp": 1710000000000
}
```

These JSON examples are **not signed requests**. Posting them directly with
`curl` will fail because the endpoint requires valid `svix-id`,
`svix-timestamp`, and `svix-signature` headers calculated for the exact raw
request body using the endpoint's signing secret. Do not weaken or bypass
signature verification for local testing. Trigger actual lifecycle events
through the development Clerk instance and inspect their delivery attempts in
the Clerk Dashboard. Use the dashboard's replay action for a failed delivery
when appropriate.

## Troubleshooting

- **Invalid webhook signature (HTTP 400):** Confirm the request is from the
  intended Clerk endpoint, the tunnel destination is current, and
  `CLERK_WEBHOOK_SECRET` matches that endpoint's signing secret. Check that
  `CLERK_WEBHOOK_SIGNING_SECRET` is not set to a different value.
- **Missing signing secret (HTTP 500):** Set `CLERK_WEBHOOK_SECRET` in the
  repository-root `.env.local`, then restart the development server.
- **Connection refused:** Confirm `npm run dev` is listening on port `3000`,
  then check that the tunnel targets port `3000` and is still running.
- **Incorrect endpoint URL:** The public Clerk endpoint must end with
  `/api/webhooks/clerk` (plural `webhooks`). It should use the HTTPS URL
  printed by the tunnel, not `localhost`.
- **Unsupported event type:** Subscribe only to the listed user lifecycle
  events. Other signed events receive a successful ignored response and do
  not update user data.
- **Duplicate delivery:** Clerk may retry deliveries. WorkSphere uses an
  upsert for create/update and `deleteMany` for deletion, so the profile
  database operations are idempotent. The handler does not maintain a
  processed-event ledger; do not assume exactly-once delivery.
- **HTTP error response:** Missing Svix headers, invalid signatures, and
  malformed JSON are rejected with HTTP 400. Missing secret configuration
  and database processing failures return HTTP 500. Check the Clerk endpoint's
  message attempts and the local server logs for the cause.

## Security considerations

- Treat the Clerk signing secret as a credential. Never put it in source
  code, screenshots, issue comments, or logs.
- Keep `.env.local` out of commits; it is ignored by the repository.
- Preserve Svix signature verification. Do not test by bypassing it or
  accepting client-submitted event data.
- Configure Clerk with the public HTTPS tunnel URL. The tunnel forwards to
  local HTTP, but the externally reachable webhook endpoint must use HTTPS.
- Use a Clerk development instance and test accounts for local testing.

## Cleanup

Stop the tunnel with `Ctrl+C` in its terminal. In the Clerk development
Dashboard, disable or delete the temporary endpoint if you no longer need it.
If webhook testing is finished, remove only the `CLERK_WEBHOOK_SECRET` line
from `.env.local`; keep the rest of your local environment configuration.

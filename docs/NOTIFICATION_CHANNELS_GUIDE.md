# Notification Channels Guide

This document explains how WorkSphere's user-facing notification settings map to the
actual delivery channels in the codebase: what is configurable, what actually sends
a message today, and what environment variables are required for each channel.

---

## Where Settings Live

Users configure their notification preferences in **Notification Settings**
(`src/app/dashboard/NotificationSettings.tsx`), which reads and writes through
`GET`/`POST /api/user/settings` (`src/app/api/user/settings/route.ts`).

The following fields are stored on the `User` model and returned by that endpoint:

| Field | Purpose |
|---|---|
| `phoneNumber` | E.164-format phone number used for SMS reminders. |
| `smsAlertsEnabled` | Opt-in flag controlling whether SMS reminders are sent. |
| `whatsappWebhookUrl` | A webhook URL a user can save (see note below). |
| `telegramWebhookUrl` | Configured separately, on the Webhooks page (see below). |
| `notificationStart` / `notificationEnd` | Daily time window during which reminders may be sent. |
| `timezone` | Timezone used to evaluate the daily window. |

---

## Channel 1: Email Reminders

**Status: active.**

Two code paths send email reminders using `nodemailer`:

- `src/app/api/cron/reminders/route.ts` (`POST`) — sends reminders ~30 minutes before
  a `CoworkingSession` starts, to the host and all confirmed/maybe RSVPs.
- `src/lib/reminderCron.ts` (`processUpcomingReservationAlerts`, invoked via the `GET`
  handler in the same route file) — sends a reminder ~15–45 minutes before a confirmed
  `Booking`.

Both paths:
- Require `SMTP_USER` and `SMTP_PASS` to be set, or the email is silently skipped.
- Use `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default `587`), and
  `SMTP_SECURE`.
- Respect the recipient's `notificationStart`/`notificationEnd`/`timezone` window via
  `isWithinNotificationWindow` (`src/lib/notificationWindow.ts`).
- Deduplicate sends using Redis (`booking-reminder:<id>` / `session-reminder:<id>` keys),
  so a reminder is sent at most once per booking/session.

A separate booking-confirmation email path exists in `src/lib/guests/email-service.ts`
and uses the same `SMTP_*` variables plus `SMTP_FROM_NAME` / `SMTP_FROM_EMAIL`.

---

## Channel 2: SMS Reminders

**Status: active, session reminders only.**

`src/app/api/cron/reminders/route.ts` sends SMS via Twilio when:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` are all set, and
- the recipient has `smsAlertsEnabled: true` and a `phoneNumber` on file, and
- the recipient is within their notification window.

SMS is only sent from the coworking-session reminder path. The booking-reminder path in
`src/lib/reminderCron.ts` sends email only — it does not currently dispatch SMS.

---

## Channel 3: WhatsApp Webhook

**Status: configurable in the UI, not yet wired to a sender.**

`whatsappWebhookUrl` is accepted, validated as a URL by the `<input type="url">` field,
and persisted via `/api/user/settings`. However, no code path in this repository
currently performs an outbound request to that URL. There is no subscriber or cron job
that reads `whatsappWebhookUrl` and POSTs to it.

The helper text in `NotificationSettings.tsx` currently states that WorkSphere "will
POST venue details and a location pin automatically when a booking is confirmed" —
this describes intended behavior, not current behavior. If you are picking up work in
this area, the missing piece is a sender (e.g. a `core/subscribers/whatsapp.ts`
following the pattern in `core/subscribers/telegram.ts`) that fires on booking
confirmation.

---

## Channel 4: Telegram

**Status: active, but configured on a separate page.**

Telegram is fully wired end-to-end, but it is **not** part of `NotificationSettings.tsx`.
It has its own settings UI and action file:

- UI: `src/app/dashboard/webhooks/TelegramSettings.tsx`
- Server actions: `src/app/dashboard/webhooks/actions.ts`
  (`saveTelegramWebhookUrl`, `getTelegramWebhookUrl`)
- Validation: `src/lib/telegram.ts` (`isValidTelegramWebhookUrl`)
- Sender: `src/core/subscribers/telegram.ts`, which reads `telegramWebhookUrl` and
  calls `sendTelegramAlert` on booking events.

If you're looking for a working example of "webhook URL saved by user, then actually
used to send a notification," Telegram is the pattern to copy for WhatsApp.

---

## Daily Notification Window

All email and SMS reminder paths gate delivery through
`isWithinNotificationWindow` (`src/lib/notificationWindow.ts`), using the recipient's
`notificationStart`, `notificationEnd`, and `timezone`. If either bound is unset, the
window is treated as unrestricted (alerts can be sent at any time).

---

## Required Environment Variables

See `docs/ENV_VARS.md` for the full reference. Variables relevant to notification
channels:

| Variable | Required for |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Email reminders |
| `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Guest booking-confirmation emails |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS reminders |
| `CRON_SECRET_TOKEN`, `CRON_SECRET` | Authorizing calls to `/api/cron/reminders` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Reminder deduplication |

**Note:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
`CRON_SECRET_TOKEN`, and `CRON_SECRET` are used in the codebase but are not yet listed
in `docs/ENV_VARS.md`. Consider adding them there as a follow-up.
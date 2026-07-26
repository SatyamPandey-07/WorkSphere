# WorkSphere API Reference

This document provides a high-level reference for the REST API endpoints available in WorkSphere. The routes are organized by feature to help developers locate the appropriate endpoints when integrating or extending the application.

> **Note:** Endpoint behaviour, request validation, and response payloads are defined in their corresponding `route.ts` implementations under `src/app/api`.

---

# Authentication

| Endpoint                         | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `POST /api/auth/csrf-token`      | Generate a CSRF token for secure requests.        |
| `POST /api/auth/forgot-password` | Initiate the password reset workflow.             |
| `POST /api/auth/reset-password`  | Complete the password reset process.              |
| `POST /api/auth/resend-otp`      | Resend a one-time password.                       |
| `POST /api/auth/verify-otp`      | Verify a submitted one-time password.             |
| `POST /api/auth/sso/pkce`        | Generate a PKCE challenge for SSO authentication. |
| `GET /api/auth/sso/metadata`     | Retrieve SSO metadata.                            |
| `POST /api/auth/sso/saml`        | Handle SAML authentication requests.              |
| `POST /api/auth/webauthn/verify` | Verify a WebAuthn authentication request.         |

---

# Venues

| Endpoint                                           | Description                       |
| -------------------------------------------------- | --------------------------------- |
| `GET /api/venues`                                  | Retrieve available venues.        |
| `POST /api/venues`                                 | Create or submit a venue.         |
| `POST /api/venues/amenity-vote`                    | Submit an amenity vote.           |
| `GET /api/venues/updates`                          | Subscribe to venue updates.       |
| `POST /api/venues/updates`                         | Broadcast a venue update.         |
| `POST /api/venues/{venueId}/rate`                  | Submit a venue rating.            |
| `GET /api/venues/{venueId}/reviews`                | Retrieve venue reviews.           |
| `GET /api/venues/{venueId}/menu`                   | Retrieve venue menu information.  |
| `GET /api/venues/{venueId}/photo`                  | Retrieve venue photos.            |
| `GET /api/venues/{venueId}/noise-metrics`          | Retrieve venue noise metrics.     |
| `GET /api/venues/{venueId}/noise-metrics/forecast` | Retrieve predicted noise levels.  |
| `GET /api/venues/{venueId}/wifi-prediction`        | Retrieve Wi-Fi prediction data.   |
| `GET /api/venues/{venueId}/seating-forecast`       | Retrieve seating forecasts.       |
| `GET /api/venues/{venueId}/telemetry`              | Retrieve venue telemetry.         |
| `GET /api/venues/{venueId}/live-stream`            | Connect to the venue live stream. |

---

# Bookings

| Endpoint                                 | Description                                        |
| ---------------------------------------- | -------------------------------------------------- |
| `POST /api/bookings/confirm`             | Confirm a booking.                                 |
| `GET /api/bookings/history`              | Retrieve the authenticated user's booking history. |
| `GET /api/bookings/export`               | Export booking information.                        |
| `GET /api/bookings/{bookingId}`          | Retrieve booking details.                          |
| `GET /api/bookings/{bookingId}/download` | Download a booking receipt or confirmation.        |
| `GET /api/bookings/{bookingId}/guests`   | Retrieve guest information for a booking.          |

---

# Receipts

| Endpoint                        | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `GET /api/receipts/{bookingId}` | Retrieve receipt information for a booking. |

---

# Reservations

| Endpoint                                | Description                        |
| --------------------------------------- | ---------------------------------- |
| `GET /api/reservations/availability`    | Retrieve reservation availability. |
| `POST /api/reservations/book`           | Create a reservation.              |
| `GET /api/reservations/events`          | Retrieve reservation events.       |
| `POST /api/reservations/recurring-book` | Create recurring reservations.     |

---

# Folders

| Endpoint                                 | Description                            |
| ---------------------------------------- | -------------------------------------- |
| `GET /api/folders`                       | Retrieve folders.                      |
| `POST /api/folders`                      | Create a folder.                       |
| `POST /api/folders/join`                 | Join a shared folder.                  |
| `GET /api/folders/{id}`                  | Retrieve folder details.               |
| `GET /api/folders/{id}/export-pdf`       | Export a folder as a PDF.              |
| `GET /api/folders/{id}/export-billing`   | Export billing information.            |
| `GET /api/folders/{id}/invites`          | Retrieve folder invitations.           |
| `POST /api/folders/{id}/refresh`         | Refresh folder data.                   |
| `GET /api/folders/{id}/venues`           | Retrieve venues within a folder.       |
| `GET /api/folders/{id}/venues/{venueId}` | Retrieve a specific venue in a folder. |

---

# User

| Endpoint                        | Description                          |
| ------------------------------- | ------------------------------------ |
| `GET /api/user/badges`          | Retrieve user badges.                |
| `GET /api/user/notifications`   | Retrieve user notifications.         |
| `GET /api/user/settings`        | Retrieve or update user settings.    |
| `GET /api/user/streak`          | Retrieve the user's activity streak. |
| `POST /api/user/verify-student` | Verify student status.               |

---

# Favorites

| Endpoint                                          | Description                      |
| ------------------------------------------------- | -------------------------------- |
| `GET /api/favorites`                              | Retrieve saved favourite venues. |
| `POST /api/favorites`                             | Add a favourite venue.           |
| `POST /api/favorites/tags/sync`                   | Synchronise favourite tags.      |
| `GET /api/favorites/{favoriteId}/notes`           | Retrieve notes for a favourite.  |
| `GET /api/favorites/{favoriteId}/tags`            | Retrieve tags for a favourite.   |
| `DELETE /api/favorites/{favoriteId}/tags/{tagId}` | Remove a tag from a favourite.   |

---

# Collections

| Endpoint                              | Description                  |
| ------------------------------------- | ---------------------------- |
| `GET /api/collections/public`         | Retrieve public collections. |
| `POST /api/collections/public/share`  | Share a public collection.   |
| `POST /api/collections/public/upvote` | Upvote a public collection.  |

---

# Conversations

| Endpoint                      | Description                       |
| ----------------------------- | --------------------------------- |
| `GET /api/conversations`      | Retrieve conversations.           |
| `POST /api/conversations`     | Create a conversation.            |
| `GET /api/conversations/{id}` | Retrieve a specific conversation. |

---

# Social

| Endpoint                                | Description                         |
| --------------------------------------- | ----------------------------------- |
| `GET /api/social/status`                | Retrieve social status information. |
| `GET /api/social/sessions`              | Retrieve social sessions.           |
| `GET /api/social/sessions/{slug}`       | Retrieve a social session.          |
| `POST /api/social/sessions/{slug}/rsvp` | RSVP for a social session.          |

---

# Analytics & Administration

| Endpoint                                  | Description                          |
| ----------------------------------------- | ------------------------------------ |
| `GET /api/analytics`                      | Retrieve analytics data.             |
| `GET /api/admin/analytics`                | Retrieve administrative analytics.   |
| `GET /api/admin/performance`              | Retrieve system performance metrics. |
| `GET /api/admin/system`                   | Retrieve system status.              |
| `GET /api/admin/system/partitions`        | Retrieve partition information.      |
| `GET /api/admin/system/partitions/export` | Export partition data.               |

---

# Maps & Location

| Endpoint                        | Description                               |
| ------------------------------- | ----------------------------------------- |
| `GET /api/location`             | Retrieve the user's location information. |
| `GET /api/map/heatmap`          | Retrieve the workspace heatmap.           |
| `POST /api/map/heatmap/seed`    | Seed heatmap data.                        |
| `GET /api/map/noise-heatmap`    | Retrieve the noise heatmap.               |
| `GET /api/map/forecast-heatmap` | Retrieve forecast heatmap data.           |

---

# Other APIs

| Endpoint                         | Description                          |
| -------------------------------- | ------------------------------------ |
| `POST /api/chat`                 | AI chat endpoint.                    |
| `POST /api/upload`               | Upload files.                        |
| `POST /api/translate`            | Translate content.                   |
| `POST /api/menu-translate`       | Translate venue menus.               |
| `GET /api/newsletter`            | Newsletter subscription endpoint.    |
| `GET /api/memory`                | Memory service endpoint.             |
| `POST /api/memory/extract`       | Extract structured memory.           |
| `GET /api/sync`                  | Synchronise application data.        |
| `GET /api/jobs/{jobId}`          | Retrieve job status.                 |
| `POST /api/push/subscribe`       | Subscribe to push notifications.     |
| `POST /api/push/unsubscribe`     | Unsubscribe from push notifications. |
| `GET /api/push/vapid-public-key` | Retrieve the VAPID public key.       |
| `POST /api/webhook`              | Webhook endpoint.                    |
| `POST /api/webhooks/test`        | Test webhook endpoint.               |
| `POST /api/webhooks/worker`      | Worker webhook endpoint.             |
| `POST /api/partykit/auth`        | Authenticate PartyKit connections.   |
| `GET /api/availability/delta`    | Retrieve availability updates.       |
| `POST /api/cron/reminders`       | Scheduled reminder task.             |
| `GET /api/ar/anchors`            | Retrieve AR anchors.                 |
| `GET /api/ar/anchors/{id}`       | Retrieve a specific AR anchor.       |

---

# Notes

- API routes are implemented under `src/app/api`.
- Dynamic route segments are represented using `{parameter}` placeholders.
- Authentication requirements and request validation are defined within each endpoint's implementation.
- This document serves as a route reference and should be kept in sync with the project structure as new endpoints are added.

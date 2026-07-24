# Guest RSVP & Calendar Invite Generation System

This document outlines the architecture, data schema, and endpoint logic handling automated email invitations, `.ics` calendar generation, and guest responses for multi-guest reservations.

## 1. Multi-Guest Booking Workflow Overview

When a multi-guest reservation is processed via the booking endpoint (`/api/reservations/book`), the system triggers background email workflows. Each invitee receives a customized notification containing transactional details and an embedded `.ics` file attachment mapping directly to their email address.

## 2. iCalendar (.ics) Generation Architecture

Calendar files are generated programmatically using the tracking utilities housed in `src/lib/guests/ics-generator.ts`.

### Key Properties Configured:

- **UID**: Unique identification string mapped to individual `guestId` fields to prevent collision tracking.
- **DTSTART / DTEND**: Formatted explicitly under UTC/ISO timestamp guidelines to preserve cross-timezone formatting accuracy.
- **LOCATION**: Embedded venue geolocation metadata derived from host coordinates.

## 3. Guest Response Endpoints

Guests handle confirmation status workflows interactively via the public-facing guest routing endpoints:

### Update RSVP Status

- **URL Path**: `/api/bookings/[bookingId]/guests`
- **Method**: `POST` / `PUT`
- **Payload Structure**:

```json
{
  "guestEmail": "user@example.com",
  "status": "ACCEPTED" | "DECLINED" | "TENTATIVE"
}
```

## 4. Email Template Customization for Admins

WorkSphere administrators can modify layout headers, brand color accents, and response body templates through the system notification dashboard utility modules. Ensure structural template fields preserve the core parsing tokens (`{{guest_name}}`, `{{booking_date}}`) to maintain runtime dynamic data injections.

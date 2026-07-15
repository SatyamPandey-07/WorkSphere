# Guest Invitation System

## Overview

This module handles guest invitations for workspace bookings. When a user books a workspace, they can invite guests (both existing users and email-only guests) who receive automated ICS calendar invites with venue details, directions links, and photos.

## Architecture

```
src/lib/guests/
├── README.md           # This file
├── types.ts            # Type definitions
├── ics-generator.ts    # ICS file generation
├── email-service.ts    # Email sending with ICS attachments
├── map-provider.ts     # Map/directions/venue photos (modular provider)
├── guest-manager.ts    # Core business logic
└── index.ts            # Public API exports
```

## Flow

1. User books a workspace → Booking confirmed event fires
2. User adds guest emails via the UI → POST /api/bookings/[bookingId]/guests
3. System creates BookingGuest records and sends ICS invites
4. Guests receive email with calendar file, directions link, and venue photo

## Extending Map Provider

To switch from Google Maps to another provider:

1. Create a new provider file in `src/lib/guests/providers/`
2. Implement the `MapProvider` interface from `map-provider.ts`
3. Update `getMapProvider()` in `map-provider.ts` to return your new provider

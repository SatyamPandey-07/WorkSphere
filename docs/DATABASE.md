# Database Schema Documentation

This document provides an overview of the WorkSphere database architecture, Prisma models, entity relationships, indexing strategy, and cascade rules.

It is intended to help contributors understand how data is organized and how different models interact before making changes to the database schema.

---

# Database Technology

WorkSphere uses **Prisma ORM** with **PostgreSQL** as the primary database.

The Prisma schema is located at:

```
prisma/schema.prisma
```

The project also enables the PostgreSQL **vector** extension for AI-powered semantic search and embeddings.

Current database provider:

- PostgreSQL
- Prisma ORM
- PostgreSQL Vector Extension (`vector`)

---

# Database Overview

The database is organized around a few core entities.

- **User** manages authentication and user-related data.
- **Venue** stores information about cafés, coworking spaces, and libraries.
- **Booking** records workspace reservations.
- **VenueRating** stores community reviews and workspace ratings.
- **Favorite** stores saved venues for each user.
- **Conversation** and **Message** manage AI chat history.
- **UserMemory** stores semantic memory embeddings.
- **SemanticCache** caches AI responses.
- **WorkBuddyStatus** tracks coworking availability.
- **CoworkingSession** manages hosted collaboration sessions.
- **SessionRsvp** stores participation records.
- **VenueSeat** represents reservable workspace seats.

---

# Entity Relationship Overview

The database follows a relational design.

```
User
 ├── Favorites
 ├── VenueRatings
 ├── Bookings
 ├── Conversations
 │      └── Messages
 ├── UserMemory
 ├── WorkBuddyStatus
 ├── HostedSessions
 │      └── SessionRsvp
 └── SessionRsvp

Venue
 ├── VenueRatings
 ├── Favorites
 ├── Bookings
 ├── WorkBuddyStatus
 ├── CoworkingSessions
 └── VenueSeats
        └── Bookings
```

These relationships allow WorkSphere to connect users, venues, reservations, reviews, AI conversations, and coworking sessions while keeping the schema normalized and easy to maintain.
---

# Core Database Models

## User

The `User` model acts as the central entity of the application.

It stores basic user information and connects to most user-specific features across WorkSphere.

### Responsibilities

- User profile information
- Favorite venues
- Venue ratings
- Workspace bookings
- AI conversations
- Semantic memory
- WorkBuddy availability
- Hosted coworking sessions
- Session RSVPs

### Related Models

- Favorite (One-to-Many)
- VenueRating (One-to-Many)
- Booking (One-to-Many)
- Conversation (One-to-Many)
- UserMemory (One-to-Many)
- WorkBuddyStatus (One-to-One)
- CoworkingSession (One-to-Many)
- SessionRsvp (One-to-Many)

---

## Venue

The `Venue` model represents every workspace available inside WorkSphere.

Examples include:

- Cafés
- Coworking Spaces
- Libraries

Each venue stores location information together with workspace-specific metadata used for search and recommendations.

### Responsibilities

- Geographic coordinates
- Workspace information
- Wi-Fi details
- Noise level
- Amenities
- Images
- Google Places references
- Community ratings
- Bookings
- Seat layouts
- Coworking sessions

### Related Models

- VenueRating
- Favorite
- Booking
- WorkBuddyStatus
- CoworkingSession
- VenueSeat

---

## Booking

The `Booking` model stores workspace reservations.

Each booking belongs to exactly one user and one venue.

Bookings may also reference a specific seat if seat reservation is enabled.

### Stores

- Booking date
- Time
- Status
- Confirmation ID
- Customer contact information
- Reserved seat
- Duration
- Requested amenities

---

## VenueRating

The `VenueRating` model stores community feedback.

Each user can rate the same venue only once.

Ratings help calculate workspace quality based on real user experiences.

### Stores

- Wi-Fi quality
- Internet speed
- Noise level
- Outlet availability
- Ergonomic seating
- User comments
- Audio measurements

---

## Favorite

The `Favorite` model stores bookmarked venues.

A user cannot bookmark the same venue multiple times because the database enforces a composite unique constraint.

---

## Conversation & Message

These models power the built-in AI assistant.

A Conversation contains multiple Messages.

This separation keeps conversation history organized while allowing efficient retrieval of individual chat messages.

---

## UserMemory

`UserMemory` stores semantic memory used by AI features.

Each memory can optionally include a PostgreSQL vector embedding, allowing similarity search for personalized responses.

---

## SemanticCache

The SemanticCache model stores previously generated AI responses.

Instead of generating identical responses repeatedly, the application can reuse cached semantic matches to improve performance and reduce AI processing costs.

---

## WorkBuddyStatus

This model tracks whether a user is currently available for coworking.

It links a user to a venue together with:

- availability
- visibility
- expiration time
- optional note

---

## CoworkingSession

CoworkingSession represents scheduled collaborative work sessions hosted by users.

Each session contains:

- Host
- Venue
- Title
- Description
- Start time
- End time
- Maximum guests

Participants are managed separately through the SessionRsvp model.

---

## SessionRsvp

SessionRsvp records a user's participation status for a coworking session.

Supported RSVP states include:

- GOING
- MAYBE
- DECLINED

The database prevents duplicate RSVPs for the same user and session.

---

## VenueSeat

VenueSeat represents physical seats inside a venue.

Each seat stores:

- Seat number
- Seat type
- Position coordinates
- Size
- Amenities
- Availability

Bookings may optionally reference a VenueSeat when seat reservation is enabled.

---

# Database Index Strategy

WorkSphere uses Prisma indexes to improve query performance for frequently accessed data. These indexes reduce lookup time, improve filtering, and optimize relationships between models.

## Venue Indexes

| Index | Purpose |
|-------|---------|
| `@@index([latitude, longitude])` | Optimizes location-based searches and nearby venue lookups. |
| `@@index([category])` | Speeds up filtering by workspace type such as cafés, coworking spaces, or libraries. |

---

## VenueRating Indexes

| Index | Purpose |
|-------|---------|
| `@@unique([userId, venueId])` | Prevents duplicate ratings from the same user for the same venue. |
| `@@index([venueId])` | Improves retrieval of all ratings for a specific venue. |

---

## Favorite Indexes

| Index | Purpose |
|-------|---------|
| `@@unique([userId, venueId])` | Ensures a user can favorite a venue only once. |
| `@@index([userId])` | Speeds up loading a user's saved venues. |

---

## Conversation & Message Indexes

| Index | Purpose |
|-------|---------|
| `Conversation @@index([userId])` | Quickly retrieves conversations belonging to a user. |
| `Message @@index([conversationId])` | Efficiently loads messages within a conversation. |

---

## Booking Indexes

| Index | Purpose |
|-------|---------|
| `@@index([userId])` | Retrieves bookings created by a user. |
| `@@index([venueId])` | Retrieves bookings for a venue. |
| `@@index([seatId])` | Optimizes seat-specific reservation queries. |

---

## AI Feature Indexes

| Index | Purpose |
|-------|---------|
| `UserMemory @@index([userId])` | Loads semantic memory associated with a user. |
| `SemanticCache @@index([query])` | Speeds up lookup of cached AI responses for repeated queries. |

---

## WorkBuddy Indexes

| Index | Purpose |
|-------|---------|
| `@@index([venueId])` | Finds users available at a specific venue. |
| `@@index([until])` | Helps identify expired or active availability records. |

---

## Coworking Session Indexes

| Index | Purpose |
|-------|---------|
| `@@index([hostId])` | Retrieves sessions hosted by a user. |
| `@@index([venueId])` | Retrieves sessions scheduled at a venue. |
| `@@index([startsAt])` | Supports sorting and filtering upcoming sessions. |

---

## Session RSVP Indexes

| Index | Purpose |
|-------|---------|
| `@@unique([sessionId, userId])` | Prevents duplicate RSVPs. |
| `@@index([userId])` | Retrieves sessions joined by a user. |

---

## VenueSeat Indexes

| Index | Purpose |
|-------|---------|
| `@@unique([venueId, seatNumber])` | Ensures seat numbers remain unique within a venue. |
| `@@index([venueId])` | Loads all seats belonging to a venue efficiently. |

---

# Query Optimization Notes

The current indexing strategy is designed around the application's most common query patterns.

Typical optimizations include:

- Fast location-based venue searches using latitude and longitude indexes.
- Efficient category filtering for workspace discovery.
- Quick loading of user-specific resources such as favorites, bookings, and conversations.
- Rapid retrieval of venue ratings and reviews.
- Efficient scheduling and lookup of coworking sessions.
- Faster semantic cache lookups for AI-generated responses.
- Optimized retrieval of seat layouts and reservations.

These indexes help reduce unnecessary full-table scans and improve overall database performance as application data grows.

---

# Cascade Rules

Several relationships use `onDelete: Cascade` to automatically remove dependent records when a parent record is deleted.

Current cascade relationships include:

| Parent Model | Child Model |
|-------------|-------------|
| User | WorkBuddyStatus |
| Venue | WorkBuddyStatus |
| User | CoworkingSession |
| Venue | CoworkingSession |
| CoworkingSession | SessionRsvp |
| User | SessionRsvp |
| Venue | VenueSeat |

Using cascade deletion helps maintain referential integrity by preventing orphaned records after related entities are removed.

---

# Best Practices

When modifying the database schema, keep the following recommendations in mind:

- Update `prisma/schema.prisma` before introducing new database fields.
- Add indexes only for fields that are frequently queried or filtered.
- Avoid unnecessary duplicate indexes, as they increase write overhead.
- Review existing relationships before introducing new foreign keys.
- Use cascading deletes carefully to avoid accidental removal of related data.
- Keep model names and field names descriptive and consistent.
- Document any schema changes so future contributors can understand the reasoning.

---

# Updating the Schema

Whenever the database schema changes:

1. Update `prisma/schema.prisma`.
2. Regenerate the Prisma Client.

```bash
npx prisma generate
```

3. If migrations are used in the future, create and apply a migration.

```bash
npx prisma migrate dev
```

4. Update this documentation to reflect:
   - New models
   - New relationships
   - Added or removed indexes
   - Modified cascade rules

Keeping the documentation synchronized with the schema helps contributors understand the project more quickly and reduces onboarding time.

---

# Contributor Notes

Before making changes to the database:

- Understand how the affected model is used throughout the application.
- Verify whether an existing index already satisfies your query requirements.
- Consider the performance impact of adding new indexes.
- Ensure foreign key relationships remain consistent.
- Test schema changes locally before submitting a pull request.

---

# Summary

The WorkSphere database is organized around a relational Prisma schema that supports workspace discovery, bookings, community ratings, AI-powered conversations, semantic memory, coworking sessions, and offline collaboration features.

The combination of relational modeling, targeted indexes, and cascade rules helps keep queries efficient while maintaining data consistency across the application.
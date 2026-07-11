\# Database Query Optimization \& Image Lazy Loading Strategy



This document explains how WorkSphere optimizes database queries (via Prisma) and handles image loading, along with recommendations for further improvements.



\## Overview



WorkSphere's backend is built on \*\*Prisma ORM\*\* with PostgreSQL, and the frontend uses \*\*Next.js `<Image>`\*\* for rendering venue photos. Both areas directly impact app performance — slow queries increase API latency, and unoptimized images increase page load time.



\## Part 1: Database Query Optimization



\### Current Query Pattern



The main venues listing endpoint (`src/app/api/venues/route.ts`) fetches venue data like this:



```ts

const venues = await prisma.venue.findMany({

&#x20; include: {

&#x20;   \_count: {

&#x20;     select: { favorites: true, ratings: true },

&#x20;   },

&#x20; },

&#x20; take: 50,

});

```



\*\*What's already done well:\*\*

\- Uses `include` with a nested `select` to fetch only aggregate counts (`favorites`, `ratings`) instead of loading full related records — this avoids over-fetching.

\- Uses `take: 50` to cap the number of results returned in a single query.



\### Where Queries Happen



Database queries (`findMany`, `findFirst`, `findUnique`) are used across \*\*22 API routes\*\*, including:
### Existing Indexes



The Prisma schema (`prisma/schema.prisma`) already defines indexes on frequently queried fields, for example:



```prisma

model CoworkingSession {

&#x20; ...

&#x20; @@index(\[hostId])

&#x20; @@index(\[venueId])

&#x20; @@index(\[startsAt])

}



model SessionRsvp {

&#x20; ...

&#x20; @@index(\[userId])

}



model VenueSeat {

&#x20; ...

&#x20; @@index(\[venueId])

}

```



Indexes like these speed up lookups on foreign keys and frequently filtered columns (e.g. fetching all sessions for a given `venueId`).



\### Recommended Optimizations



1\. \*\*Add cursor-based pagination\*\*

&#x20;  The current `venues.findMany()` uses only `take: 50` without `skip` or a cursor, meaning there's no way to fetch "the next page" of venues. For scalability, consider:

```ts

&#x20;  const venues = await prisma.venue.findMany({

&#x20;    take: 50,

&#x20;    skip: cursorId ? 1 : 0,

&#x20;    cursor: cursorId ? { id: cursorId } : undefined,

&#x20;    orderBy: { createdAt: "desc" },

&#x20;  });

```

&#x20;  Cursor-based pagination performs better than offset (`skip`) pagination at scale, since `skip` requires the database to count and discard rows.



2\. \*\*Always use `select` for list views\*\*

&#x20;  When returning many rows (e.g. a venue list), explicitly `select` only the fields the UI needs, rather than returning full model objects:

```ts

&#x20;  const venues = await prisma.venue.findMany({

&#x20;    select: {

&#x20;      id: true,

&#x20;      name: true,

&#x20;      address: true,

&#x20;      rating: true,

&#x20;      imageUrl: true,

&#x20;    },

&#x20;    take: 50,

&#x20;  });

```



3\. \*\*Avoid N+1 queries\*\*

&#x20;  When looping over results and querying related data separately (e.g. fetching ratings per venue in a loop), use `include` or a single batched query instead. Prisma's `include`/`select` mentioned above already avoids this in the venues endpoint — this pattern should be followed in any new endpoint.



4\. \*\*Add missing indexes as new query patterns emerge\*\*

&#x20;  Any field frequently used in a `where` clause (e.g. `category`, `noiseLevel` if filtered often) is a candidate for an index:

```prisma

&#x20;  model Venue {

&#x20;    ...

&#x20;    @@index(\[category])

&#x20;  }

```



\## Part 2: Image Lazy Loading Strategy



\### Current Implementation



Venue photos are rendered using Next.js's built-in `<Image>` component in `src/components/VenueCard.tsx`:



```tsx

import Image from "next/image";



<Image

&#x20; src={photos\[photoIndex]}

&#x20; alt={venue.name}

&#x20; fill

&#x20; className="object-cover"

/>

```



By default, Next.js `<Image>` already lazy-loads images that are off-screen (this is the default `loading="lazy"` behavior), so images below the fold do not block initial page load.



\### Recommended Improvements



1\. \*\*Add `placeholder="blur"` for smoother loading\*\*

&#x20;  Currently no placeholder is set, which can cause a layout "pop-in" when the image finishes loading. A blur placeholder improves perceived performance:

```tsx

&#x20;  <Image

&#x20;    src={photos\[photoIndex]}

&#x20;    alt={venue.name}

&#x20;    fill

&#x20;    className="object-cover"

&#x20;    placeholder="blur"

&#x20;    blurDataURL="/placeholder-venue.jpg"

&#x20;  />

```



2\. \*\*Use `priority` for above-the-fold images\*\*

&#x20;  For the first venue card visible on page load (e.g. the top result in a list), consider adding `priority` to skip lazy loading for that one image, since it's immediately visible:

```tsx

&#x20;  <Image

&#x20;    src={photos\[photoIndex]}

&#x20;    alt={venue.name}

&#x20;    fill

&#x20;    priority={isFirstCard}

&#x20;    className="object-cover"

&#x20;  />

```



3\. \*\*Define `sizes` for responsive images\*\*

&#x20;  Since the component uses `fill`, adding a `sizes` prop helps the browser download an appropriately sized image instead of the largest available version:

```tsx

&#x20;  <Image

&#x20;    src={photos\[photoIndex]}

&#x20;    alt={venue.name}

&#x20;    fill

&#x20;    sizes="(max-width: 768px) 100vw, 33vw"

&#x20;    className="object-cover"

&#x20;  />

```



\## Summary



WorkSphere already follows several good practices — using `include`/`select` to limit query payloads, indexing frequently queried foreign keys, and relying on Next.js's default image lazy loading. The main opportunities for improvement are: switching to cursor-based pagination for scalability, being more selective with fields on list-view queries, and adding `placeholder`, `priority`, and `sizes` props to the `<Image>` component for smoother, more responsive image loading.


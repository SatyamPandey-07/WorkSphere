VisitedVenuesCard
Overview
VisitedVenuesCard is a client-side profile dashboard component that displays a user's visited workspace statistics.
The component retrieves booking records from the /api/bookings endpoint and derives the number of unique venues from those records.
It is designed to provide a compact profile statistic without requiring the parent dashboard to fetch booking data itself.
The card can display loading, empty, error, and populated states.
It also provides a small visual list of visited venue names when booking data is available.
The component is suitable for profile pages, dashboard summary sections, and workspace activity areas.
Component location
The component is located at:
src/components/profile/VisitedVenuesCard.tsx
The documentation file is:
docs/components/visited-venues-card.md
Purpose
The main purpose of VisitedVenuesCard is to answer a simple profile question:
How many unique workspaces has this user visited or booked?

The component does not display the total number of bookings.
Instead, it groups booking records by venue ID and counts each venue only once.
For example, if a user has booked the same venue five times, that venue contributes only one item to the displayed count.
This makes the statistic an indicator of workspace exploration rather than booking frequency.
Current API
The current component is rendered without props:
<VisitedVenuesCard />
There is currently no exported VisitedVenuesCardProps interface in the component source.
There are also no configurable component props such as:

- userId
- title
- className
- limit
- showBadge
- onVenueClick
  Therefore, documentation must not imply that these values can currently be passed to the component.
  If a future implementation introduces VisitedVenuesCardProps, this document should be updated with the actual interface and default values.
  Props
  Current props interface
  The current component effectively has an empty props interface.
  The component declaration is:
  export function VisitedVenuesCard() {
  Because no parameter is declared, callers should not pass props to the component.
  The valid usage is:
  <VisitedVenuesCard />
  The following would not represent the current component API:
  <VisitedVenuesCard userId="123" />
  <VisitedVenuesCard limit={5} />
  <VisitedVenuesCard className="mt-4" />
  Those examples would require corresponding props to be added to the component first.
  Props table
  Prop Type Required Default Description
  None N/A N/A N/A The current component does not accept props.

The component obtains its data internally from /api/bookings.
This means the parent component does not need to provide booking data.
Default values
There are no public component prop defaults because the component does not accept props.
The component does contain internal fallback values.
The venue name fallback is:
name: booking.venue?.name || "Workspace"
This means a booking with a valid venue ID but without a venue name is represented as Workspace.
The initial visited venue list is:
useState<BookingVenue[]>([])
The initial loading state is:
useState(true)
The initial error state is:
useState<string | null>(null)
Internal data types
The component defines an internal BookingVenue interface.
interface BookingVenue {
id: string;
name: string;
category?: string;
}
This type represents the venue information required by the card.
The id is required.
The name is required.
The category is optional.
The category is currently stored during data processing but is not rendered by the card.
BookingRecord
The component also defines an internal BookingRecord interface.
interface BookingRecord {
id: string;
venueId: string;
status?: string;
venue?: BookingVenue;
}
This interface represents a booking returned by the bookings API.
The booking ID is required.
The venue ID is required by the current TypeScript type.
The booking status is optional.
The nested venue object is optional.
The component uses the venue ID and nested venue information to build the unique venue collection.
Data source
The component fetches booking information from:
/api/bookings
The request is made with:
fetch("/api/bookings", { cache: "no-store" })
The no-store cache option ensures that the browser does not reuse a cached response for this request.
This is useful for profile statistics because booking information may change between visits.
The request is performed inside a useEffect.
Client component
The file begins with:
"use client";
This is required because the component uses client-side React hooks.
The component uses:

- useEffect
- useState
  It also performs a browser-side fetch request.
  Because of these client-side behaviors, it should remain a client component.
  Imports
  The component imports React hooks:
  import React, { useEffect, useState } from "react";
  It imports Next.js Link:
  import Link from "next/link";
  It imports three icons:
  import { MapPin, ArrowRight, Sparkles } from "lucide-react";
  It imports the shared skeleton component:
  import { Skeleton } from "@/components/ui/skeleton";
  These dependencies provide the component's navigation, visual icons, loading state, and React behavior.
  Loading state
  The component starts with:
  const [loading, setLoading] = useState(true);
  This means the loading UI is displayed before the initial API request completes.
  The component checks the loading state before rendering the normal card.
  The loading branch returns a skeleton card.
  The loading card uses:
  data-testid="visited-venues-loading"
  This test identifier allows automated tests to locate the loading state.
  The loading container also has:
  aria-busy="true"
  This communicates that the content is currently being loaded.
  It also has:
  aria-label="Loading visited venues statistics"
  This provides an accessible description for assistive technology.
  Loading skeleton structure
  The loading state contains a skeleton for the icon:
  <Skeleton className="w-10 h-10 rounded-xl" />
  It contains two smaller skeleton blocks for the heading area.
  It also contains a larger skeleton representing the statistic value.
  The loading layout intentionally resembles the final card.
  This reduces visual movement when the real data is displayed.
  Fetch lifecycle
  The data request is implemented inside fetchVisitedVenues.
  The function first sets:
  setLoading(true);
  It then clears any previous error:
  setError(null);
  It performs the API request.
  After the response is processed, the visited venue state is updated.
  Finally, the loading state is disabled.
  The cleanup behavior prevents state updates after the component has been unmounted.
  Mounted guard
  The component creates:
  let isMounted = true;
  The asynchronous function checks this value before updating state.
  For example:
  if (isMounted) {
  setVisitedVenues(...);
  }
  The effect cleanup function sets:
  isMounted = false;
  This protects the component from updating state after unmounting.
  The pattern is particularly relevant because the API request is asynchronous.
  Authentication behavior
  The component handles HTTP 401 separately.
  The relevant behavior is:
  if (res.status === 401) {
  A 401 response is treated as an unauthenticated or guest state.
  The component clears the visited venues list.
  It also stops the loading state.
  It does not display the generic error message for a 401.
  This allows an unauthenticated profile context to remain visually clean.
  Non-success responses
  For responses other than 401, the component checks:
  if (!res.ok)
  If the response is not successful, it throws:
  throw new Error("Failed to load visited venues");
  The error is then handled by the surrounding catch.
  The displayed error message is:
  Unable to load visited venues statistics
  The original thrown error is not rendered directly to the user.
  This prevents internal error details from becoming part of the UI.
  API response shape
  The component expects the JSON response to contain a data property.
  The data is read with:
  const bookings: BookingRecord[] = json.data || [];
  If json.data is missing or falsy, an empty array is used.
  This means the component can safely render an empty state when no booking records are returned.
  The expected conceptual response is:
  {
  "data": [
  {
  "id": "booking-1",
  "venueId": "venue-1",
  "status": "confirmed",
  "venue": {
  "id": "venue-1",
  "name": "Workspace One",
  "category": "Coworking"
  }
  }
  ]
  }
  Unique venue aggregation
  The component uses a Map to remove duplicate venues.
  The map is initialized with:
  const venueMap = new Map<string, BookingVenue>();
  Each booking is then processed.
  The venue ID is resolved using:
  const vId = booking.venueId || booking.venue?.id;
  If a venue ID exists and has not already been added, a venue object is inserted into the map.
  This provides unique venue aggregation.
  Why a Map is used
  A Map is appropriate because venue IDs are used as unique keys.
  Consider the following bookings:
  Booking 1 -> Venue A
  Booking 2 -> Venue A
  Booking 3 -> Venue B
  Booking 4 -> Venue A
  Booking 5 -> Venue C
  The resulting map contains:
  Venue A
  Venue B
  Venue C
  The final count is therefore 3.
  The component does not count bookings individually.
  Duplicate handling
  Duplicate venue IDs are ignored after the first occurrence.
  The condition is:
  if (vId && !venueMap.has(vId))
  The first booking for a venue creates the map entry.
  Later bookings for the same venue do not replace it.
  This also means the first available venue name is retained.
  Venue name fallback
  The aggregation creates a venue object with:
  name: booking.venue?.name || "Workspace"
  If the nested venue name is present, it is used.
  If the name is missing, the fallback is:
  Workspace
  This prevents an undefined venue name from appearing in the UI.
  Category handling
  The component stores:
  category: booking.venue?.category
  The category is optional.
  At present, the category is not rendered.
  It remains part of the internal BookingVenue representation.
  Future documentation should be updated if category becomes visible or configurable.
  Converting the Map
  After processing all bookings, the component converts the map into an array:
  Array.from(venueMap.values())
  The resulting array is passed to:

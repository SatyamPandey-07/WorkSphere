/**
 * Builds a human-readable address line from OpenStreetMap address tags.
 * Missing, empty or whitespace-only parts are dropped, so a venue without a
 * postcode renders "Main St, Seattle" and never "Main St, Seattle, ".
 * Returns undefined when no part is available.
 */
export function formatOsmAddress(
  tags: Record<string, string | undefined | null>,
): string | undefined {
  return (
    [tags["addr:street"], tags["addr:city"], tags["addr:postcode"]]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ") || undefined
  );
}

/**
 * Screen reader text for the current venue result set (#7609),
 * e.g. "Found 12 matching workspaces with 2 filters applied".
 */
export function formatVenueResultsAnnouncement(
  count: number,
  activeFilterCount = 0,
): string {
  const results =
    count === 0
      ? "No matching workspaces found"
      : `Found ${count} matching workspace${count === 1 ? "" : "s"}`;

  if (activeFilterCount <= 0) return results;

  return `${results} with ${activeFilterCount} filter${
    activeFilterCount === 1 ? "" : "s"
  } applied`;
}

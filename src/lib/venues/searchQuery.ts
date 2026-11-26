export interface VenueSearchQueryState {
  q?: string;
  category?: string;
  sort?: string;
  amenities?: string[];
  minDb?: number;
  maxDb?: number;
  minWifi?: number;
  maxWifi?: number;
  minWifiSpeed?: number;
}

export function buildVenueSearchParams(
  state: VenueSearchQueryState,
  existingParams?: URLSearchParams | string,
): URLSearchParams {
  const params = new URLSearchParams(
    typeof existingParams === "string"
      ? existingParams
      : existingParams
        ? existingParams.toString()
        : "",
  );

  if (state.q !== undefined) {
    const trimmed = state.q.trim().replace(/\s+/g, " ");
    if (trimmed) {
      params.set("q", trimmed);
    } else {
      params.delete("q");
    }
  }

  if (state.category !== undefined) {
    if (!state.category || state.category === "all") {
      params.delete("category");
    } else {
      params.set("category", state.category);
    }
  }

  if (state.sort !== undefined) {
    if (!state.sort || state.sort === "recommended") {
      params.delete("sort");
    } else {
      params.set("sort", state.sort);
    }
  }

  if (state.amenities !== undefined) {
    const cleaned = Array.from(
      new Set(state.amenities.map((a) => a.trim()).filter(Boolean)),
    );
    if (cleaned.length > 0) {
      params.set("amenities", cleaned.join(","));
    } else {
      params.delete("amenities");
    }
  }

  if (state.minDb !== undefined) {
    params.set("minDb", String(state.minDb));
  }
  if (state.maxDb !== undefined) {
    params.set("maxDb", String(state.maxDb));
  }
  if (state.minWifi !== undefined) {
    params.set("minWifi", String(state.minWifi));
  }
  if (state.maxWifi !== undefined) {
    params.set("maxWifi", String(state.maxWifi));
  }
  if (state.minWifiSpeed !== undefined) {
    if (
      state.minWifiSpeed !== null &&
      Number.isFinite(state.minWifiSpeed) &&
      state.minWifiSpeed > 0
    ) {
      params.set("minWifiSpeed", String(state.minWifiSpeed));
    } else {
      params.delete("minWifiSpeed");
    }
  }

  return params;
}

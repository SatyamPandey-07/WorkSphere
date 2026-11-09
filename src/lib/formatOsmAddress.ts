/**
 * Builds a human-readable address line from OpenStreetMap address tags.
 * Missing, empty or whitespace-only parts are dropped, so a venue without a
 * postcode renders "123 Main St, Seattle" and never "123 Main St, Seattle, ".
 *
 * Supports comprehensive OSM address tag conventions:
 * - `addr:full`: Unparsed pre-formatted single-line address.
 * - `addr:housename`: Named building/complex.
 * - `addr:housenumber` + `addr:street`: Building/street address number and street name.
 * - `addr:unit` / `addr:suite` / `addr:flats`: Unit or suite within a complex.
 * - Locality: `addr:city` || `addr:town` || `addr:village` || `addr:hamlet` || `addr:municipality`,
 *   with support for distinct `addr:suburb`.
 * - State / Province: `addr:state` || `addr:province`.
 * - Postal Code: `addr:postcode` || `addr:postal_code`.
 * - Country: `addr:country`.
 *
 * Returns undefined when no address part is available.
 */
export function formatOsmAddress(
  tags?: Record<string, string | undefined | null> | null,
): string | undefined {
  if (!tags) return undefined;

  const getTag = (key: string): string => {
    const val = tags[key];
    return typeof val === "string" ? val.trim() : "";
  };

  const full = getTag("addr:full");
  if (full) {
    return full;
  }

  const housename = getTag("addr:housename");
  const housenumber = getTag("addr:housenumber");
  const street = getTag("addr:street");
  const unit = getTag("addr:unit") || getTag("addr:suite") || getTag("addr:flats");

  const suburb = getTag("addr:suburb");
  const city = getTag("addr:city");
  const town = getTag("addr:town");
  const village = getTag("addr:village");
  const hamlet = getTag("addr:hamlet");
  const municipality = getTag("addr:municipality");
  const locality = city || town || village || hamlet || municipality;

  const state = getTag("addr:state") || getTag("addr:province");
  const postcode = getTag("addr:postcode") || getTag("addr:postal_code");
  const country = getTag("addr:country");

  const parts: string[] = [];

  if (housename) {
    parts.push(housename);
  }

  let streetLine = "";
  if (housenumber && street) {
    streetLine = `${housenumber} ${street}`;
  } else if (street) {
    streetLine = street;
  } else if (housenumber) {
    streetLine = housenumber;
  }

  if (streetLine && unit) {
    parts.push(`${streetLine}, ${unit}`);
  } else if (streetLine) {
    parts.push(streetLine);
  } else if (unit) {
    parts.push(unit);
  }

  if (suburb && locality && suburb.toLowerCase() !== locality.toLowerCase()) {
    parts.push(suburb);
    parts.push(locality);
  } else if (locality) {
    parts.push(locality);
  } else if (suburb) {
    parts.push(suburb);
  }

  if (state) {
    parts.push(state);
  }

  if (postcode) {
    parts.push(postcode);
  }

  if (country) {
    parts.push(country);
  }

  return parts.length > 0 ? parts.join(", ") : undefined;
}

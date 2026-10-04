export interface PostalAddressSchema {
  "@type": "PostalAddress";
  streetAddress: string;
  addressLocality: string;
  postalCode: string;
  addressCountry: string;
}

export interface GeoCoordinatesSchema {
  "@type": "GeoCoordinates";
  latitude: number;
  longitude: number;
}

export interface AggregateRatingSchema {
  "@type": "AggregateRating";
  ratingValue: number;
  reviewCount: number;
}

export interface LocationFeatureSpecificationSchema {
  "@type": "LocationFeatureSpecification";
  name: string;
  value: boolean | string | number;
}

export interface VenueJsonLd {
  "@context": "https://schema.org";
  "@type": "LocalBusiness";
  name: string;
  address: PostalAddressSchema;
  geo: GeoCoordinatesSchema;
  telephone: string;
  aggregateRating?: AggregateRatingSchema;
  amenityFeature: LocationFeatureSpecificationSchema[];
  [key: string]: any;
}

export interface VenueLike {
  id?: string;
  name: string;
  address?: string | null | {
    streetAddress?: string;
    addressLocality?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  latitude: number;
  longitude: number;
  telephone?: string | null;
  phoneNumber?: string | null;
  rating?: number | null;
  ratingValue?: number;
  reviewCount?: number;
  ratings?: Array<{ id?: string; wifiQuality?: number | null }> | null;
  _count?: { ratings?: number } | null;
  wifiQuality?: number | null;
  wifiSpeed?: number | null;
  hasOutlets?: boolean | null;
  hasErgonomic?: boolean | null;
  hasQuietZone?: boolean | null;
  hasPhoneBooths?: boolean | null;
  hasNoMusic?: boolean | null;
  hasAncHeadsetRental?: boolean | null;
  dogFriendly?: boolean | null;
  petsAllowedIndoors?: boolean | null;
  catsAllowed?: boolean | null;
  specialtyEspresso?: boolean | null;
  singleOriginBeans?: boolean | null;
  pourOverAvailable?: boolean | null;
  hasCCTV?: boolean | null;
  amenities?: any;
  amenityFeature?: LocationFeatureSpecificationSchema[];
  [key: string]: any;
}

/**
 * Parses raw address string or object into a Schema.org PostalAddress
 */
export function parsePostalAddress(
  address?: VenueLike["address"]
): PostalAddressSchema {
  if (!address) {
    return {
      "@type": "PostalAddress",
      streetAddress: "",
      addressLocality: "",
      postalCode: "",
      addressCountry: "US",
    };
  }

  if (typeof address === "object") {
    return {
      "@type": "PostalAddress",
      streetAddress: address.streetAddress || "",
      addressLocality: address.addressLocality || "",
      postalCode: address.postalCode || "",
      addressCountry: address.addressCountry || "US",
    };
  }

  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      "@type": "PostalAddress",
      streetAddress: address,
      addressLocality: "",
      postalCode: "",
      addressCountry: "US",
    };
  }

  if (parts.length === 1) {
    return {
      "@type": "PostalAddress",
      streetAddress: parts[0],
      addressLocality: "",
      postalCode: "",
      addressCountry: "US",
    };
  }

  const streetAddress = parts[0];
  const addressLocality = parts[1];
  let postalCode = "";
  let addressCountry = "US";

  const remainder = parts.slice(2);
  if (remainder.length > 0) {
    const lastPart = remainder[remainder.length - 1];
    // If last part is country name/code (letters and spaces only, no digits)
    if (/^[A-Za-z\s]+$/.test(lastPart) && !/\d/.test(lastPart)) {
      addressCountry = lastPart;
      remainder.pop();
    }

    const rest = remainder.join(" ").trim();
    const zipMatch =
      rest.match(/\b\d{5}(?:-\d{4})?\b/) ||
      rest.match(/\b[A-Z]{1,2}\d[A-Z0-9]?\s*\d[A-Z]{2}\b/i) ||
      rest.match(/\b[A-Z0-9]{3,10}\b/i);
    if (zipMatch) {
      postalCode = zipMatch[0].trim();
    }
  }

  return {
    "@type": "PostalAddress",
    streetAddress,
    addressLocality,
    postalCode,
    addressCountry,
  };
}

/**
 * Extracts location amenity features into Schema.org LocationFeatureSpecification array
 */
export function extractAmenityFeatures(
  venue: VenueLike
): LocationFeatureSpecificationSchema[] {
  if (Array.isArray(venue.amenityFeature)) {
    return venue.amenityFeature;
  }

  const features: LocationFeatureSpecificationSchema[] = [];

  const addFeature = (name: string, value: boolean | string | number = true) => {
    if (!features.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      features.push({
        "@type": "LocationFeatureSpecification",
        name,
        value,
      });
    }
  };

  if (venue.wifiQuality || venue.wifiSpeed) {
    addFeature("WiFi");
  }

  if (venue.hasOutlets) {
    addFeature("Power Outlets");
  }

  if (venue.hasErgonomic) {
    addFeature("Ergonomic Seating");
  }

  if (venue.hasQuietZone) {
    addFeature("Quiet Zone");
  }

  if (venue.hasPhoneBooths) {
    addFeature("Phone Booths");
  }

  if (venue.hasNoMusic) {
    addFeature("No Music");
  }

  if (venue.hasAncHeadsetRental) {
    addFeature("ANC Headset Rental");
  }

  if (venue.dogFriendly || venue.petsAllowedIndoors || venue.catsAllowed) {
    addFeature("Pet Friendly");
  }

  if (
    venue.specialtyEspresso ||
    venue.singleOriginBeans ||
    venue.pourOverAvailable
  ) {
    addFeature("Specialty Coffee");
  }

  if (venue.hasCCTV) {
    addFeature("CCTV Security");
  }

  // Handle object-based amenities (e.g. MapMarker.amenities)
  if (
    venue.amenities &&
    typeof venue.amenities === "object" &&
    !Array.isArray(venue.amenities)
  ) {
    if (venue.amenities.wifi) addFeature("WiFi");
    if (venue.amenities.outlets) addFeature("Power Outlets");
    if (venue.amenities.quiet) addFeature("Quiet Zone");
    if (venue.amenities.hasErgonomic) addFeature("Ergonomic Seating");
    if (venue.amenities.hasAncHeadsetRental) addFeature("ANC Headset Rental");
    if (venue.amenities.specialtyEspresso) addFeature("Specialty Coffee");
  }

  // Handle string array amenities
  if (Array.isArray(venue.amenities)) {
    for (const item of venue.amenities) {
      if (typeof item === "string" && item.trim()) {
        addFeature(item.trim());
      } else if (
        item &&
        typeof item === "object" &&
        typeof item.name === "string"
      ) {
        addFeature(item.name, item.value ?? true);
      }
    }
  }

  return features;
}

/**
 * Builds Schema.org JSON-LD object for LocalBusiness (coworking / cafe / workspace)
 */
export function generateVenueJsonLd(venue: VenueLike): VenueJsonLd {
  let ratingValue = 0;
  if (typeof venue.ratingValue === "number") {
    ratingValue = venue.ratingValue;
  } else if (typeof venue.rating === "number") {
    ratingValue = venue.rating;
  } else if (Array.isArray(venue.ratings) && venue.ratings.length > 0) {
    const sum = venue.ratings.reduce(
      (acc, r) =>
        acc + (typeof r.wifiQuality === "number" ? r.wifiQuality : 5),
      0
    );
    ratingValue = Math.round((sum / venue.ratings.length) * 10) / 10;
  }

  let reviewCount = 0;
  if (typeof venue.reviewCount === "number") {
    reviewCount = venue.reviewCount;
  } else if (Array.isArray(venue.ratings) && venue.ratings.length > 0) {
    reviewCount = venue.ratings.length;
  } else if (venue._count?.ratings != null) {
    reviewCount = venue._count.ratings;
  }

  const telephone = String(venue.telephone || venue.phoneNumber || "");

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: venue.name,
    address: parsePostalAddress(venue.address),
    geo: {
      "@type": "GeoCoordinates",
      latitude: Number(venue.latitude),
      longitude: Number(venue.longitude),
    },
    telephone,
    ...(reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue,
            reviewCount,
          },
        }
      : {}),
    amenityFeature: extractAmenityFeatures(venue),
  };
}

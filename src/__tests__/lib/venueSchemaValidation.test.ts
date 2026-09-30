/**
 * Tests for venue data schema validation before database writes.
 */

interface VenueSchema {
  name: string;
  description?: string;
  address: string;
  city: string;
  country: string;
  category: "cafe" | "library" | "coworking" | "hotel" | "other";
  capacity: number;
  hourlyRateCents: number;
}

interface ValidationError {
  field: string;
  message: string;
}

function validateVenueSchema(data: Partial<VenueSchema>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!data.name?.trim()) errors.push({ field: "name", message: "Name is required" });
  if (data.name && data.name.length > 100) errors.push({ field: "name", message: "Name too long" });
  if (!data.address?.trim()) errors.push({ field: "address", message: "Address is required" });
  if (!data.city?.trim()) errors.push({ field: "city", message: "City is required" });
  if (!data.country?.trim()) errors.push({ field: "country", message: "Country is required" });
  if (!data.category) errors.push({ field: "category", message: "Category is required" });
  if (data.capacity !== undefined && (data.capacity <= 0 || !Number.isInteger(data.capacity))) {
    errors.push({ field: "capacity", message: "Capacity must be a positive integer" });
  }
  if (data.hourlyRateCents !== undefined && data.hourlyRateCents < 0) {
    errors.push({ field: "hourlyRateCents", message: "Rate cannot be negative" });
  }
  return errors;
}

function isValidVenue(data: Partial<VenueSchema>): boolean {
  return validateVenueSchema(data).length === 0;
}

const VALID_VENUE: Partial<VenueSchema> = {
  name: "The Hub",
  address: "123 Main St",
  city: "NYC",
  country: "USA",
  category: "coworking",
  capacity: 50,
  hourlyRateCents: 1000,
};

describe("Venue schema validation", () => {
  it("valid venue → no errors", () => {
    expect(validateVenueSchema(VALID_VENUE)).toHaveLength(0);
  });

  it("missing name → error", () => {
    const errors = validateVenueSchema({ ...VALID_VENUE, name: "" });
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("name too long → error", () => {
    const errors = validateVenueSchema({ ...VALID_VENUE, name: "a".repeat(101) });
    expect(errors.some((e) => e.field === "name" && /long/i.test(e.message))).toBe(true);
  });

  it("missing address → error", () => {
    expect(validateVenueSchema({ ...VALID_VENUE, address: "" }).some((e) => e.field === "address")).toBe(true);
  });

  it("missing category → error", () => {
    expect(validateVenueSchema({ ...VALID_VENUE, category: undefined }).some((e) => e.field === "category")).toBe(true);
  });

  it("negative capacity → error", () => {
    expect(validateVenueSchema({ ...VALID_VENUE, capacity: -5 }).some((e) => e.field === "capacity")).toBe(true);
  });

  it("zero capacity → error", () => {
    expect(validateVenueSchema({ ...VALID_VENUE, capacity: 0 }).some((e) => e.field === "capacity")).toBe(true);
  });

  it("negative hourlyRate → error", () => {
    expect(validateVenueSchema({ ...VALID_VENUE, hourlyRateCents: -100 }).some((e) => e.field === "hourlyRateCents")).toBe(true);
  });

  it("zero hourlyRate (free) → valid", () => {
    expect(validateVenueSchema({ ...VALID_VENUE, hourlyRateCents: 0 })).toHaveLength(0);
  });

  it("isValidVenue: valid → true", () => {
    expect(isValidVenue(VALID_VENUE)).toBe(true);
  });
});

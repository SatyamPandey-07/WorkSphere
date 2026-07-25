import {
  favoriteNotesSchema,
  createFavoriteTagSchema,
  updateFavoriteTagSchema,
  syncFavoriteTagsSchema,
  validateRequest,
} from "@/lib/validations";

describe("Validations - favoriteNotesSchema", () => {
  it("should accept valid notes", () => {
    const result = favoriteNotesSchema.safeParse({ notes: "Great place to work!" });
    expect(result.success).toBe(true);
  });

  it("should accept null notes (clearing notes)", () => {
    const result = favoriteNotesSchema.safeParse({ notes: null });
    expect(result.success).toBe(true);
  });

  it("should accept empty string notes", () => {
    const result = favoriteNotesSchema.safeParse({ notes: "" });
    expect(result.success).toBe(true);
  });

  it("should reject notes exceeding 2000 characters", () => {
    const result = favoriteNotesSchema.safeParse({ notes: "a".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("should accept notes at exactly 2000 characters", () => {
    const result = favoriteNotesSchema.safeParse({ notes: "a".repeat(2000) });
    expect(result.success).toBe(true);
  });
});

describe("Validations - createFavoriteTagSchema", () => {
  it("should accept valid tag with hex color", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "Quiet Spot",
      color: "#3b82f6",
    });
    expect(result.success).toBe(true);
  });

  it("should trim whitespace from tag name", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "  Quiet Spot  ",
      color: "#22c55e",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Quiet Spot");
    }
  });

  it("should reject empty tag name", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "",
      color: "#3b82f6",
    });
    expect(result.success).toBe(false);
  });

  it("should reject tag name exceeding 50 characters", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "a".repeat(51),
      color: "#3b82f6",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid hex color", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "Test",
      color: "red",
    });
    expect(result.success).toBe(false);
  });

  it("should reject short hex color", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "Test",
      color: "#fff",
    });
    expect(result.success).toBe(false);
  });

  it("should accept uppercase hex color", () => {
    const result = createFavoriteTagSchema.safeParse({
      name: "Test",
      color: "#FF5733",
    });
    expect(result.success).toBe(true);
  });
});

describe("Validations - updateFavoriteTagSchema", () => {
  it("should accept partial update with name only", () => {
    const result = updateFavoriteTagSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("should accept partial update with color only", () => {
    const result = updateFavoriteTagSchema.safeParse({ color: "#ef4444" });
    expect(result.success).toBe(true);
  });

  it("should accept both name and color", () => {
    const result = updateFavoriteTagSchema.safeParse({
      name: "Updated",
      color: "#22c55e",
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty object (no changes)", () => {
    const result = updateFavoriteTagSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should reject invalid color format", () => {
    const result = updateFavoriteTagSchema.safeParse({ color: "blue" });
    expect(result.success).toBe(false);
  });
});

describe("Validations - syncFavoriteTagsSchema", () => {
  it("should accept a batch of tag updates", () => {
    const result = syncFavoriteTagsSchema.safeParse({
      updates: [
        { id: "tag-1", name: "Quiet" },
        { id: "tag-2", color: "#22c55e" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject an update with neither name nor color", () => {
    const result = syncFavoriteTagsSchema.safeParse({
      updates: [{ id: "tag-1" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject an empty updates array", () => {
    const result = syncFavoriteTagsSchema.safeParse({ updates: [] });
    expect(result.success).toBe(false);
  });
});

describe("validateRequest helper", () => {
  it("should return success with valid data", () => {
    const result = validateRequest(createFavoriteTagSchema, {
      name: "Fast WiFi",
      color: "#3b82f6",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Fast WiFi");
    }
  });

  it("should return error with invalid data", () => {
    const result = validateRequest(createFavoriteTagSchema, {
      name: "",
      color: "invalid",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("name");
    }
  });
});

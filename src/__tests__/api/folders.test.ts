import { createFolderSchema, updateFolderSchema } from "../../lib/validations";

describe("Collection Folders API & Schema Validation", () => {
  describe("POST /api/folders validation", () => {
    it("should allow valid folder creation data", () => {
      const payload = {
        name: "My Favorite Workspaces",
        description: "Quiet cafes with fast wifi",
        isPublic: true,
      };

      const result = createFolderSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Favorite Workspaces");
        expect(result.data.description).toBe("Quiet cafes with fast wifi");
        expect(result.data.isPublic).toBe(true);
      }
    });

    it("should trim folder names and descriptions automatically", () => {
      const payload = {
        name: "   Focus Zone   ",
        description: "   Libraries and quiet rooms   ",
      };

      const result = createFolderSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Focus Zone");
        expect(result.data.description).toBe("Libraries and quiet rooms");
      }
    });

    it("should reject empty string folder names when rapidly submitted", () => {
      const payload = {
        name: "",
        description: "",
      };

      const result = createFolderSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Folder name is required");
      }
    });

    it("should reject whitespace-only folder names when rapidly hitting Enter", () => {
      const payload = {
        name: "     ",
        description: "Valid description",
      };

      const result = createFolderSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Folder name is required");
      }
    });

    it("should reject folder names longer than 100 characters", () => {
      const payload = {
        name: "A".repeat(101),
      };

      const result = createFolderSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Folder name must be 100 characters or less");
      }
    });
  });

  describe("PUT /api/folders/[id] validation", () => {
    it("should allow valid folder update data", () => {
      const payload = {
        name: "Renamed Collection",
        isPublic: false,
      };

      const result = updateFolderSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Renamed Collection");
        expect(result.data.isPublic).toBe(false);
      }
    });

    it("should reject empty or whitespace-only name updates", () => {
      const payload = {
        name: "   ",
      };

      const result = updateFolderSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });
});

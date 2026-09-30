/**
 * Tests for file upload validation (size, type, name).
 */

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_DOC_TYPES = ["application/pdf", "text/plain", "application/json"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DOC_BYTES = 10 * 1024 * 1024;  // 10 MB

interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

function validateImageUpload(file: { name: string; type: string; size: number }): FileValidationResult {
  const errors: string[] = [];
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) errors.push(`File type '${file.type}' not allowed`);
  if (file.size > MAX_IMAGE_BYTES) errors.push(`File exceeds 5 MB limit`);
  if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) errors.push("File extension doesn't match type");
  return { valid: errors.length === 0, errors };
}

function validateDocUpload(file: { name: string; type: string; size: number }): FileValidationResult {
  const errors: string[] = [];
  if (!ALLOWED_DOC_TYPES.includes(file.type)) errors.push(`File type '${file.type}' not allowed`);
  if (file.size > MAX_DOC_BYTES) errors.push("File exceeds 10 MB limit");
  return { valid: errors.length === 0, errors };
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

describe("File upload validation", () => {
  it("valid JPEG → no errors", () => {
    const result = validateImageUpload({ name: "photo.jpg", type: "image/jpeg", size: 1_000_000 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("invalid image type → error", () => {
    const result = validateImageUpload({ name: "doc.pdf", type: "application/pdf", size: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not allowed/);
  });

  it("image too large → error", () => {
    const result = validateImageUpload({ name: "big.png", type: "image/png", size: 6_000_000 });
    expect(result.errors.some((e) => /5 MB/i.test(e))).toBe(true);
  });

  it("valid PDF → no errors", () => {
    const result = validateDocUpload({ name: "report.pdf", type: "application/pdf", size: 500_000 });
    expect(result.valid).toBe(true);
  });

  it("doc too large → error", () => {
    const result = validateDocUpload({ name: "big.pdf", type: "application/pdf", size: 11_000_000 });
    expect(result.errors.some((e) => /10 MB/i.test(e))).toBe(true);
  });

  it("sanitizeFileName: replaces spaces with underscore", () => {
    expect(sanitizeFileName("my file name.jpg")).toBe("my_file_name.jpg");
  });

  it("sanitizeFileName: collapses multiple underscores", () => {
    expect(sanitizeFileName("a!!b")).toBe("a_b");
  });

  it("sanitizeFileName: truncates to 100 chars", () => {
    expect(sanitizeFileName("a".repeat(200))).toHaveLength(100);
  });
});

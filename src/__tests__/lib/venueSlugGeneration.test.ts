/**
 * Tests for URL slug generation from venue names.
 */

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")   // remove non-alphanumeric except dash
    .replace(/\s+/g, "-")       // spaces to dashes
    .replace(/-+/g, "-")        // collapse multiple dashes
    .replace(/^-|-$/g, "");     // trim leading/trailing dashes
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

function uniquifySlug(base: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(base)) return base;
  let counter = 2;
  while (existingSlugs.has(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
}

describe("Venue slug generation", () => {
  it("basic name → slug", () => {
    expect(generateSlug("Coffee Hub")).toBe("coffee-hub");
  });

  it("special chars stripped", () => {
    expect(generateSlug("Café & Co!")).toBe("caf-co");
  });

  it("extra whitespace collapsed", () => {
    expect(generateSlug("Quiet   Place")).toBe("quiet-place");
  });

  it("multiple dashes collapsed", () => {
    expect(generateSlug("A---B")).toBe("a-b");
  });

  it("leading/trailing dashes removed", () => {
    expect(generateSlug(" Downtown Work ")).toBe("downtown-work");
  });

  it("isValidSlug: valid slug", () => {
    expect(isValidSlug("downtown-hub")).toBe(true);
  });

  it("isValidSlug: single char is valid", () => {
    expect(isValidSlug("a")).toBe(true);
  });

  it("isValidSlug: leading dash → invalid", () => {
    expect(isValidSlug("-bad")).toBe(false);
  });

  it("isValidSlug: uppercase → invalid", () => {
    expect(isValidSlug("Bad-slug")).toBe(false);
  });

  it("uniquifySlug: no collision", () => {
    expect(uniquifySlug("hub", new Set(["cafe"]))).toBe("hub");
  });

  it("uniquifySlug: collision appends -2", () => {
    expect(uniquifySlug("hub", new Set(["hub"]))).toBe("hub-2");
  });

  it("uniquifySlug: multiple collisions", () => {
    expect(uniquifySlug("hub", new Set(["hub", "hub-2", "hub-3"]))).toBe("hub-4");
  });
});

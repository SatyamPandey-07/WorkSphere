describe("String utilities for venue booking", () => {
  function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 3) + "...";
  }
  function slugify(s: string): string {
    return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  function initials(name: string): string {
    return name.split(" ").map((w) => w.charAt(0).toUpperCase()).join("");
  }
  it("truncates long string", () => { expect(truncate("Hello World", 8)).toBe("Hello..."); });
  it("short string unchanged", () => { expect(truncate("Hi", 10)).toBe("Hi"); });
  it("slugify converts spaces", () => { expect(slugify("Grand Hall London")).toBe("grand-hall-london"); });
  it("capitalize first letter", () => { expect(capitalize("hello")).toBe("Hello"); });
  it("initials from full name", () => { expect(initials("John Smith")).toBe("JS"); });
});

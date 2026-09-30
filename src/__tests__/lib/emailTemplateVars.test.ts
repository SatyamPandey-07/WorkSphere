/**
 * Tests for email template variable interpolation.
 */

type TemplateVars = Record<string, string | number>;

function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = vars[key];
    return value !== undefined ? String(value) : match; // keep placeholder if missing
  });
}

function missingVars(template: string, vars: TemplateVars): string[] {
  const required = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  return [...new Set(required)].filter((key) => vars[key] === undefined);
}

function hasAllVars(template: string, vars: TemplateVars): boolean {
  return missingVars(template, vars).length === 0;
}

const BOOKING_TEMPLATE =
  "Hi {{name}}, your booking at {{venueName}} on {{date}} is {{status}}.";

describe("Email template variable interpolation", () => {
  it("replaces all variables", () => {
    const vars = { name: "Alice", venueName: "Café Hub", date: "2026-10-01", status: "confirmed" };
    const result = interpolate(BOOKING_TEMPLATE, vars);
    expect(result).toBe("Hi Alice, your booking at Café Hub on 2026-10-01 is confirmed.");
  });

  it("numeric variable replaced as string", () => {
    expect(interpolate("Total: {{amount}}", { amount: 1500 })).toBe("Total: 1500");
  });

  it("missing var keeps placeholder", () => {
    const result = interpolate("Hi {{name}}", {});
    expect(result).toBe("Hi {{name}}");
  });

  it("missingVars lists missing keys", () => {
    const vars = { name: "Alice" };
    const missing = missingVars(BOOKING_TEMPLATE, vars);
    expect(missing).toContain("venueName");
    expect(missing).toContain("date");
    expect(missing).not.toContain("name");
  });

  it("missingVars deduplicates", () => {
    const template = "{{x}} and {{x}}";
    expect(missingVars(template, {})).toHaveLength(1);
  });

  it("hasAllVars: all supplied → true", () => {
    const vars = { name: "A", venueName: "B", date: "C", status: "D" };
    expect(hasAllVars(BOOKING_TEMPLATE, vars)).toBe(true);
  });

  it("hasAllVars: missing vars → false", () => {
    expect(hasAllVars(BOOKING_TEMPLATE, { name: "A" })).toBe(false);
  });

  it("empty template → empty result", () => {
    expect(interpolate("", { name: "X" })).toBe("");
  });

  it("template with no placeholders → unchanged", () => {
    expect(interpolate("Static text", {})).toBe("Static text");
  });
});

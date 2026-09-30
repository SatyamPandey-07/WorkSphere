/**
 * Tests for venue custom booking form field management.
 */

type FieldType = "text" | "number" | "select" | "checkbox" | "date" | "textarea";

interface CustomField {
  fieldId: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];  // for select type
  minValue?: number;
  maxValue?: number;
  placeholder?: string;
}

type FieldValue = string | number | boolean | null;

function validateField(field: CustomField, value: FieldValue): string | null {
  if (field.required && (value === null || value === "" || value === undefined)) {
    return `${field.label} is required`;
  }
  if (field.type === "number" && value !== null && value !== "") {
    const num = Number(value);
    if (isNaN(num)) return `${field.label} must be a number`;
    if (field.minValue !== undefined && num < field.minValue) return `Min value is ${field.minValue}`;
    if (field.maxValue !== undefined && num > field.maxValue) return `Max value is ${field.maxValue}`;
  }
  if (field.type === "select" && field.options && value !== null) {
    if (!field.options.includes(String(value))) return `Invalid option for ${field.label}`;
  }
  return null;
}

function validateForm(
  fields: CustomField[],
  values: Record<string, FieldValue>
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateField(field, values[field.fieldId] ?? null);
    if (error) errors[field.fieldId] = error;
  }
  return errors;
}

function isFormValid(fields: CustomField[], values: Record<string, FieldValue>): boolean {
  return Object.keys(validateForm(fields, values)).length === 0;
}

const FIELDS: CustomField[] = [
  { fieldId: "name",    label: "Contact Name", type: "text",   required: true                          },
  { fieldId: "guests",  label: "Guest Count",  type: "number", required: true, minValue: 1, maxValue: 50 },
  { fieldId: "purpose", label: "Purpose",      type: "select", required: false, options: ["meeting", "focus", "event"] },
];

describe("Venue custom booking form", () => {
  it("validateField: required text empty → error", () => {
    expect(validateField(FIELDS[0], "")).toBeTruthy();
  });

  it("validateField: required text filled → null", () => {
    expect(validateField(FIELDS[0], "Alice")).toBeNull();
  });

  it("validateField: number below min → error", () => {
    expect(validateField(FIELDS[1], 0)).toBeTruthy();
  });

  it("validateField: number above max → error", () => {
    expect(validateField(FIELDS[1], 100)).toBeTruthy();
  });

  it("validateField: valid number → null", () => {
    expect(validateField(FIELDS[1], 5)).toBeNull();
  });

  it("validateField: invalid select option → error", () => {
    expect(validateField(FIELDS[2], "party")).toBeTruthy();
  });

  it("validateField: valid select option → null", () => {
    expect(validateField(FIELDS[2], "meeting")).toBeNull();
  });

  it("isFormValid: valid values → true", () => {
    const values = { name: "Alice", guests: 5, purpose: "meeting" };
    expect(isFormValid(FIELDS, values)).toBe(true);
  });

  it("isFormValid: missing required → false", () => {
    const values = { guests: 5 };
    expect(isFormValid(FIELDS, values)).toBe(false);
  });
});

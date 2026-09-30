/**
 * Tests for saved payment method vault management.
 */

type PaymentType = "card" | "bank_transfer" | "wallet" | "crypto";

interface PaymentMethod {
  id: string;
  userId: string;
  type: PaymentType;
  label: string;         // e.g. "Visa •••• 4242"
  isDefault: boolean;
  expiresAt?: number;    // for cards
  isVerified: boolean;
}

function defaultPaymentMethod(methods: PaymentMethod[]): PaymentMethod | null {
  return methods.find((m) => m.isDefault && m.isVerified) ?? null;
}

function isExpired(method: PaymentMethod, nowMs: number): boolean {
  if (!method.expiresAt) return false;
  return nowMs > method.expiresAt;
}

function validPaymentMethods(methods: PaymentMethod[], nowMs: number): PaymentMethod[] {
  return methods.filter((m) => m.isVerified && !isExpired(m, nowMs));
}

function setDefault(
  methods: PaymentMethod[],
  id: string
): PaymentMethod[] {
  return methods.map((m) => ({ ...m, isDefault: m.id === id }));
}

function removeMethod(
  methods: PaymentMethod[],
  id: string
): PaymentMethod[] {
  return methods.filter((m) => m.id !== id);
}

const NOW = 1_700_000_000_000;
const METHODS: PaymentMethod[] = [
  { id: "pm1", userId: "u1", type: "card",    label: "Visa 4242", isDefault: true,  expiresAt: NOW + 86_400_000 * 365, isVerified: true  },
  { id: "pm2", userId: "u1", type: "card",    label: "MC 1111",   isDefault: false, expiresAt: NOW - 1000,             isVerified: true  }, // expired
  { id: "pm3", userId: "u1", type: "wallet",  label: "PayPal",    isDefault: false,                                   isVerified: false }, // unverified
];

describe("Payment method vault", () => {
  it("defaultPaymentMethod: pm1 is default and verified", () => {
    expect(defaultPaymentMethod(METHODS)!.id).toBe("pm1");
  });

  it("defaultPaymentMethod: none if default is unverified", () => {
    const modified = METHODS.map((m) => m.id === "pm1" ? { ...m, isVerified: false } : m);
    expect(defaultPaymentMethod(modified)).toBeNull();
  });

  it("isExpired: past expiresAt → true", () => {
    expect(isExpired(METHODS[1], NOW)).toBe(true);
  });

  it("isExpired: future expiresAt → false", () => {
    expect(isExpired(METHODS[0], NOW)).toBe(false);
  });

  it("isExpired: no expiresAt → false", () => {
    expect(isExpired(METHODS[2], NOW)).toBe(false);
  });

  it("validPaymentMethods: excludes expired and unverified", () => {
    const valid = validPaymentMethods(METHODS, NOW);
    expect(valid).toHaveLength(1);
    expect(valid[0].id).toBe("pm1");
  });

  it("setDefault: changes default to pm2", () => {
    const updated = setDefault(METHODS, "pm2");
    expect(updated.find((m) => m.id === "pm2")!.isDefault).toBe(true);
    expect(updated.find((m) => m.id === "pm1")!.isDefault).toBe(false);
  });

  it("removeMethod: removes pm1", () => {
    const updated = removeMethod(METHODS, "pm1");
    expect(updated.find((m) => m.id === "pm1")).toBeUndefined();
    expect(updated).toHaveLength(2);
  });
});

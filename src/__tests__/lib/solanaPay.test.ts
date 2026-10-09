import {
  DEFAULT_MAX_RELAY_FEE_LAMPORTS,
  validateRelayFeeLamports,
} from "@/lib/payments/solanaPay";

describe("validateRelayFeeLamports", () => {
  it("accepts fees within the configured ceiling", () => {
    expect(validateRelayFeeLamports(5_000, 10_000)).toBe(5_000);
  });

  it("uses a conservative default fee ceiling", () => {
    expect(() =>
      validateRelayFeeLamports(DEFAULT_MAX_RELAY_FEE_LAMPORTS + 1),
    ).toThrow("Transaction fee exceeds the relayer limit");
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid fee value %p",
    (fee) => {
      expect(() => validateRelayFeeLamports(fee)).toThrow(
        "Relay fee must be a non-negative integer",
      );
    },
  );

  it("rejects an invalid configured ceiling", () => {
    expect(() => validateRelayFeeLamports(1, -1)).toThrow(
      "Maximum relay fee must be a non-negative integer",
    );
  });
});

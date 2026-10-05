import { formatOsmAddress } from "@/lib/formatOsmAddress";

describe("formatOsmAddress", () => {
  it("joins street, city and postcode when all are present", () => {
    expect(
      formatOsmAddress({
        "addr:street": "Pine St",
        "addr:city": "Seattle",
        "addr:postcode": "98101",
      }),
    ).toBe("Pine St, Seattle, 98101");
  });

  it("has no trailing comma when the postcode is missing", () => {
    expect(
      formatOsmAddress({
        "addr:street": "Pine St",
        "addr:city": "Seattle",
      }),
    ).toBe("Pine St, Seattle");
  });

  it("has no trailing comma when the postcode is empty or whitespace", () => {
    expect(
      formatOsmAddress({
        "addr:street": "Pine St",
        "addr:city": "Seattle",
        "addr:postcode": "   ",
      }),
    ).toBe("Pine St, Seattle");
    expect(
      formatOsmAddress({
        "addr:street": "Pine St",
        "addr:city": "Seattle",
        "addr:postcode": "",
      }),
    ).toBe("Pine St, Seattle");
  });

  it("skips a missing city without leaving a gap", () => {
    expect(
      formatOsmAddress({
        "addr:street": "Pine St",
        "addr:postcode": "98101",
      }),
    ).toBe("Pine St, 98101");
  });

  it("returns just the street when it is the only part", () => {
    expect(formatOsmAddress({ "addr:street": "Pine St" })).toBe("Pine St");
  });

  it("returns undefined when there are no address parts", () => {
    expect(formatOsmAddress({})).toBeUndefined();
    expect(
      formatOsmAddress({ "addr:street": " ", "addr:city": null }),
    ).toBeUndefined();
  });
});

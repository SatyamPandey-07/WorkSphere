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

  describe("extended OSM address tags (#6716)", () => {
    it("prepends addr:housenumber to addr:street", () => {
      expect(
        formatOsmAddress({
          "addr:housenumber": "123",
          "addr:street": "Pine St",
          "addr:city": "Seattle",
          "addr:postcode": "98101",
        }),
      ).toBe("123 Pine St, Seattle, 98101");
    });

    it("supports addr:housenumber without addr:street", () => {
      expect(
        formatOsmAddress({
          "addr:housenumber": "100",
          "addr:city": "Seattle",
        }),
      ).toBe("100, Seattle");
    });

    it("supports addr:housename alongside street and unit", () => {
      expect(
        formatOsmAddress({
          "addr:housename": "Apex Tower",
          "addr:housenumber": "500",
          "addr:street": "Pine St",
          "addr:unit": "Suite 300",
          "addr:city": "Seattle",
        }),
      ).toBe("Apex Tower, 500 Pine St, Suite 300, Seattle");
    });

    it("supports unit/suite without housename or street", () => {
      expect(
        formatOsmAddress({
          "addr:unit": "Suite 400",
          "addr:city": "Seattle",
        }),
      ).toBe("Suite 400, Seattle");
    });

    it("falls back to addr:town, addr:village, addr:hamlet, or addr:municipality when addr:city is missing", () => {
      expect(
        formatOsmAddress({
          "addr:street": "High St",
          "addr:town": "Epsom",
          "addr:postcode": "KT19 8DD",
        }),
      ).toBe("High St, Epsom, KT19 8DD");

      expect(
        formatOsmAddress({
          "addr:housenumber": "5",
          "addr:street": "Church Lane",
          "addr:village": "Eversholt",
          "addr:postcode": "MK17 9DU",
        }),
      ).toBe("5 Church Lane, Eversholt, MK17 9DU");
    });

    it("includes distinct addr:suburb before locality", () => {
      expect(
        formatOsmAddress({
          "addr:housenumber": "10",
          "addr:street": "100ft Road",
          "addr:suburb": "Indiranagar",
          "addr:city": "Bengaluru",
          "addr:postcode": "560038",
        }),
      ).toBe("10 100ft Road, Indiranagar, Bengaluru, 560038");
    });

    it("deduplicates addr:suburb when identical to locality", () => {
      expect(
        formatOsmAddress({
          "addr:street": "Broadway",
          "addr:suburb": "Seattle",
          "addr:city": "seattle",
        }),
      ).toBe("Broadway, seattle");
    });

    it("includes addr:state or addr:province", () => {
      expect(
        formatOsmAddress({
          "addr:housenumber": "123",
          "addr:street": "Pine St",
          "addr:city": "Seattle",
          "addr:state": "WA",
          "addr:postcode": "98101",
        }),
      ).toBe("123 Pine St, Seattle, WA, 98101");

      expect(
        formatOsmAddress({
          "addr:street": "Yonge St",
          "addr:city": "Toronto",
          "addr:province": "ON",
          "addr:postcode": "M4Y 1Z9",
        }),
      ).toBe("Yonge St, Toronto, ON, M4Y 1Z9");
    });

    it("includes addr:country when present", () => {
      expect(
        formatOsmAddress({
          "addr:street": "Unter den Linden",
          "addr:city": "Berlin",
          "addr:country": "Germany",
        }),
      ).toBe("Unter den Linden, Berlin, Germany");
    });

    it("prefers non-empty addr:full when provided", () => {
      expect(
        formatOsmAddress({
          "addr:full": "742 Evergreen Terrace, Springfield, OR 97477",
          "addr:street": "Other St",
        }),
      ).toBe("742 Evergreen Terrace, Springfield, OR 97477");
    });

    it("falls back to structured parts when addr:full is empty or whitespace", () => {
      expect(
        formatOsmAddress({
          "addr:full": "   ",
          "addr:street": "Pine St",
          "addr:city": "Seattle",
        }),
      ).toBe("Pine St, Seattle");
    });

    it("handles non-string values defensively", () => {
      expect(
        formatOsmAddress({
          "addr:street": 123 as any,
          "addr:city": "Seattle",
        }),
      ).toBe("Seattle");
    });
  });
});

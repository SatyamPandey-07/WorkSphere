import {
  isPrivateIPv4,
  isPrivateIPv6,
  parseIPv6Hextets,
  isSafeWebhookUrl,
} from "@/lib/ssrfValidation";

describe("ssrfValidation", () => {
  describe("isPrivateIPv4", () => {
    test("detects standard private Class A, B, and C networks", () => {
      expect(isPrivateIPv4("10.0.0.1")).toBe(true);
      expect(isPrivateIPv4("10.255.255.255")).toBe(true);
      expect(isPrivateIPv4("172.16.0.1")).toBe(true);
      expect(isPrivateIPv4("172.31.255.255")).toBe(true);
      expect(isPrivateIPv4("192.168.0.1")).toBe(true);
      expect(isPrivateIPv4("192.168.1.254")).toBe(true);
    });

    test("detects loopback and current network", () => {
      expect(isPrivateIPv4("127.0.0.1")).toBe(true);
      expect(isPrivateIPv4("127.255.255.255")).toBe(true);
      expect(isPrivateIPv4("0.0.0.0")).toBe(true);
    });

    test("detects link-local cloud metadata (AWS, GCP, Azure)", () => {
      expect(isPrivateIPv4("169.254.169.254")).toBe(true);
      expect(isPrivateIPv4("169.254.0.1")).toBe(true);
    });

    test("detects carrier-grade NAT, test-nets, and multicast/broadcast", () => {
      expect(isPrivateIPv4("100.64.0.1")).toBe(true);
      expect(isPrivateIPv4("100.127.255.255")).toBe(true);
      expect(isPrivateIPv4("192.0.2.1")).toBe(true);
      expect(isPrivateIPv4("198.51.100.1")).toBe(true);
      expect(isPrivateIPv4("203.0.113.1")).toBe(true);
      expect(isPrivateIPv4("224.0.0.1")).toBe(true);
      expect(isPrivateIPv4("255.255.255.255")).toBe(true);
    });

    test("permits public IPv4 addresses", () => {
      expect(isPrivateIPv4("8.8.8.8")).toBe(false);
      expect(isPrivateIPv4("1.1.1.1")).toBe(false);
      expect(isPrivateIPv4("93.184.216.34")).toBe(false);
      expect(isPrivateIPv4("172.32.0.1")).toBe(false);
    });

    test("treats empty segments, octal, and malformed strings as unsafe", () => {
      expect(isPrivateIPv4("8..8.8")).toBe(true);
      expect(isPrivateIPv4("0127.0.0.1")).toBe(true);
      expect(isPrivateIPv4("invalid")).toBe(true);
      expect(isPrivateIPv4("1.2.3")).toBe(true);
      expect(isPrivateIPv4("1.2.3.4.5")).toBe(true);
    });
  });

  describe("parseIPv6Hextets", () => {
    test("expands compressed :: notation accurately", () => {
      expect(parseIPv6Hextets("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIPv6Hextets("fe80::1")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIPv6Hextets("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    test("handles full 8-hextet strings", () => {
      expect(
        parseIPv6Hextets("2001:0db8:0000:0000:0000:0000:0000:0001"),
      ).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
    });

    test("parses embedded IPv4 addresses in IPv6", () => {
      expect(parseIPv6Hextets("::ffff:192.168.1.1")).toEqual([
        0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101,
      ]);
      expect(parseIPv6Hextets("::127.0.0.1")).toEqual([
        0, 0, 0, 0, 0, 0, 0x7f00, 0x0001,
      ]);
    });

    test("strips surrounding brackets and zone identifiers", () => {
      expect(parseIPv6Hextets("[::1]")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIPv6Hextets("fe80::1%eth0")).toEqual([
        0xfe80, 0, 0, 0, 0, 0, 0, 1,
      ]);
    });

    test("returns null for malformed IPv6 strings", () => {
      expect(parseIPv6Hextets(":::1")).toBeNull();
      expect(parseIPv6Hextets("1::2::3")).toBeNull();
      expect(parseIPv6Hextets("gggg::1")).toBeNull();
      expect(parseIPv6Hextets("12345::1")).toBeNull();
    });
  });

  describe("isPrivateIPv6", () => {
    test("detects loopback across all zero-padded representations", () => {
      expect(isPrivateIPv6("::1")).toBe(true);
      expect(isPrivateIPv6("::01")).toBe(true);
      expect(isPrivateIPv6("0:0:0:0:0:0:0:0001")).toBe(true);
      expect(
        isPrivateIPv6("0000:0000:0000:0000:0000:0000:0000:0001"),
      ).toBe(true);
      expect(isPrivateIPv6("::")).toBe(true);
    });

    test("detects IPv4-compatible IPv6 addresses (RFC 4291 §2.5.5.1)", () => {
      expect(isPrivateIPv6("::127.0.0.1")).toBe(true);
      expect(isPrivateIPv6("::169.254.169.254")).toBe(true);
      expect(isPrivateIPv6("::10.0.0.1")).toBe(true);
      expect(isPrivateIPv6("0:0:0:0:0:0:192.168.1.1")).toBe(true);
      expect(isPrivateIPv6("::8.8.8.8")).toBe(false);
    });

    test("detects IPv4-mapped IPv6 addresses (RFC 4291)", () => {
      expect(isPrivateIPv6("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateIPv6("::ffff:7f00:1")).toBe(true);
      expect(isPrivateIPv6("::ffff:192.168.1.1")).toBe(true);
      expect(isPrivateIPv6("::ffff:8.8.8.8")).toBe(false);
    });

    test("detects link-local, unique-local, and site-local (RFC 3879)", () => {
      expect(isPrivateIPv6("fe80::1")).toBe(true);
      expect(isPrivateIPv6("febf::ffff")).toBe(true);
      expect(isPrivateIPv6("fc00::1")).toBe(true);
      expect(isPrivateIPv6("fd00::1")).toBe(true);
      expect(isPrivateIPv6("fec0::1")).toBe(true);
      expect(isPrivateIPv6("feff::1")).toBe(true);
    });

    test("detects 6to4 addresses embedding private IPv4 (RFC 3056)", () => {
      expect(isPrivateIPv6("2002:7f00:0001::")).toBe(true); // 127.0.0.1
      expect(isPrivateIPv6("2002:0a00:0001::")).toBe(true); // 10.0.0.1
      expect(isPrivateIPv6("2002:a9fe:a9fe::")).toBe(true); // 169.254.169.254
      expect(isPrivateIPv6("2002:0808:0808::")).toBe(false); // 8.8.8.8
    });

    test("detects multicast, documentation, benchmarking, and discard prefixes", () => {
      expect(isPrivateIPv6("ff02::1")).toBe(true);
      expect(isPrivateIPv6("2001:db8::1")).toBe(true);
      expect(isPrivateIPv6("100::1")).toBe(true);
      expect(isPrivateIPv6("2001:2::1")).toBe(true);
    });

    test("permits public IPv6 addresses", () => {
      expect(isPrivateIPv6("2606:4700:4700::1111")).toBe(false);
      expect(isPrivateIPv6("2001:4860:4860::8888")).toBe(false);
    });

    test("treats unparseable or malformed IPv6 as unsafe", () => {
      expect(isPrivateIPv6("not-an-ip")).toBe(true);
      expect(isPrivateIPv6(":::1")).toBe(true);
    });
  });

  describe("isSafeWebhookUrl", () => {
    test("rejects invalid URL protocols", async () => {
      const res = await isSafeWebhookUrl("ftp://example.com/webhook");
      expect(res.isSafe).toBe(false);
      expect(res.reason).toContain("Only HTTP and HTTPS are allowed");
    });

    test("blocks direct private IPv4 URLs", async () => {
      const res = await isSafeWebhookUrl("http://127.0.0.1:8080/hook");
      expect(res.isSafe).toBe(false);
      expect(res.reason).toContain("Target IP");
    });

    test("blocks direct IPv4-compatible and IPv4-mapped IPv6 URLs", async () => {
      const res1 = await isSafeWebhookUrl("http://[::127.0.0.1]:8080/hook");
      expect(res1.isSafe).toBe(false);

      const res2 = await isSafeWebhookUrl("http://[::ffff:169.254.169.254]/meta");
      expect(res2.isSafe).toBe(false);

      const res3 = await isSafeWebhookUrl("http://[fec0::1]:9000/hook");
      expect(res3.isSafe).toBe(false);
    });

    test("allows direct public IP URLs", async () => {
      const res = await isSafeWebhookUrl("https://8.8.8.8/webhook");
      expect(res.isSafe).toBe(true);
    });
  });
});

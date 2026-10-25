import dns from "dns";
import net from "net";
import { promisify } from "util";

const lookupAsync = promisify(dns.lookup);
const resolve4Async = promisify(dns.resolve4);
const resolve6Async = promisify(dns.resolve6);

export function isPrivateIPv4(ip: string): boolean {
  if (typeof ip !== "string") return true;
  const rawParts = ip.split(".");
  if (
    rawParts.length !== 4 ||
    rawParts.some((p) => {
      const trimmed = p.trim();
      return trimmed === "" || !/^\d+$/.test(trimmed) || /^0\d+/.test(trimmed);
    })
  ) {
    return true; // Treat invalid, empty, or ambiguous octal notation as unsafe
  }

  const parts = rawParts.map((p) => Number(p.trim()));
  if (parts.some(isNaN) || parts.some((p) => p < 0 || p > 255)) {
    return true; // Treat invalid as unsafe
  }

  const [first, second, third] = parts;

  // 0.0.0.0/8 (Current network / wildcard)
  if (first === 0) return true;
  // 10.0.0.0/8 (Private Class A)
  if (first === 10) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (first === 100 && second >= 64 && second <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (first === 127) return true;
  // 169.254.0.0/16 (Link Local / AWS & Cloud Metadata)
  if (first === 169 && second === 254) return true;
  // 172.16.0.0/12 (Private Class B)
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments) & 192.0.2.0/24 (TEST-NET-1)
  if (first === 192 && second === 0 && (third === 0 || third === 2)) return true;
  // 192.168.0.0/16 (Private Class C)
  if (first === 192 && second === 168) return true;
  // 198.18.0.0/15 (Benchmarking)
  if (first === 198 && (second === 18 || second === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (first === 198 && second === 51 && third === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (first === 203 && second === 0 && third === 113) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved/broadcast
  if (first >= 224) return true;

  return false;
}

/**
 * Canonicalizes an IPv6 address string into 8 16-bit numeric hextets (0 to 65535).
 * Correctly expands compressed "::", embedded IPv4 addresses (e.g. ::192.168.1.1),
 * strips brackets, and strips zone identifiers (%eth0).
 * Returns null if the address is malformed.
 */
export function parseIPv6Hextets(ip: string): number[] | null {
  if (typeof ip !== "string") return null;
  let str = ip.toLowerCase().trim();

  // Strip brackets if present (e.g. [::1])
  if (str.startsWith("[") && str.endsWith("]")) {
    str = str.slice(1, -1);
  }

  // Strip zone index (e.g. %eth0 or %1)
  const zoneIndex = str.indexOf("%");
  if (zoneIndex !== -1) {
    str = str.slice(0, zoneIndex);
  }

  // Check for embedded IPv4 representation at the end (e.g. ::ffff:192.168.1.1 or ::127.0.0.1)
  let embeddedIPv4: number[] | null = null;
  const lastColon = str.lastIndexOf(":");
  if (lastColon !== -1) {
    const potentialIpv4 = str.slice(lastColon + 1);
    if (potentialIpv4.includes(".")) {
      const parts = potentialIpv4.split(".").map(Number);
      if (
        parts.length === 4 &&
        parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)
      ) {
        embeddedIPv4 = [
          (parts[0] << 8) | parts[1],
          (parts[2] << 8) | parts[3],
        ];
        str = str.slice(0, lastColon);
        if (str.endsWith(":")) {
          str += ":"; // preserve double colon if preceding was "::"
        }
      } else {
        return null; // Malformed embedded IPv4
      }
    }
  }

  const parts = str.split("::");
  if (parts.length > 2) return null; // Only one "::" is permitted

  const head: number[] = [];
  const tail: number[] = [];

  if (parts[0].length > 0) {
    for (const h of parts[0].split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      head.push(parseInt(h, 16));
    }
  }

  if (parts.length === 2 && parts[1].length > 0) {
    for (const t of parts[1].split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
      tail.push(parseInt(t, 16));
    }
  }

  const neededTotal = 8 - (embeddedIPv4 ? 2 : 0);
  if (parts.length === 1) {
    if (head.length !== neededTotal) return null;
  } else {
    const current = head.length + tail.length;
    if (current > neededTotal) return null;
    const zeros = new Array(neededTotal - current).fill(0);
    head.push(...zeros, ...tail);
  }

  if (embeddedIPv4) {
    head.push(...embeddedIPv4);
  }

  return head.length === 8 ? head : null;
}

export function isPrivateIPv6(ip: string): boolean {
  const h = parseIPv6Hextets(ip);
  if (!h) return true; // Treat invalid / unparseable IPv6 addresses as unsafe

  // 1. :: (Unspecified address)
  if (h.every((v) => v === 0)) return true;

  // 2. ::1 (Loopback address, including all zero-padded representations)
  if (h.slice(0, 7).every((v) => v === 0) && h[7] === 1) return true;

  // 3. fc00::/7 (Unique Local Address range: fc00:: - fdff::)
  if ((h[0] & 0xfe00) === 0xfc00) return true;

  // 4. fe80::/10 (Link-Local unicast: fe80:: - febf::)
  if ((h[0] & 0xffc0) === 0xfe80) return true;

  // 5. fec0::/10 (Site-Local unicast deprecated RFC 3879: fec0:: - feff::)
  if ((h[0] & 0xffc0) === 0xfec0) return true;

  // 6. ff00::/8 (Multicast)
  if ((h[0] & 0xff00) === 0xff00) return true;

  // 7. 100::/64 (Discard-only prefix RFC 6666)
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;

  // 8. 2001:db8::/32 (Documentation prefix RFC 3849)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;

  // 9. 2001:2::/48 (Benchmarking prefix RFC 5180)
  if (h[0] === 0x2001 && h[1] === 0x0002 && h[2] === 0) return true;

  // 10. ::ffff:0:0/96 (IPv4-mapped) & ::ffff:0:a.b.c.d (IPv4-translated)
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0xffff
  ) {
    const b1 = (h[6] >> 8) & 0xff;
    const b2 = h[6] & 0xff;
    const b3 = (h[7] >> 8) & 0xff;
    const b4 = h[7] & 0xff;
    return isPrivateIPv4(`${b1}.${b2}.${b3}.${b4}`);
  }

  // 11. ::/96 (IPv4-compatible IPv6 addresses RFC 4291 §2.5.5.1)
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    (h[6] !== 0 || h[7] > 1)
  ) {
    const b1 = (h[6] >> 8) & 0xff;
    const b2 = h[6] & 0xff;
    const b3 = (h[7] >> 8) & 0xff;
    const b4 = h[7] & 0xff;
    return isPrivateIPv4(`${b1}.${b2}.${b3}.${b4}`);
  }

  // 12. 2002::/16 (6to4 RFC 3056 embedding IPv4 in hextets 1 and 2)
  if (h[0] === 0x2002) {
    const b1 = (h[1] >> 8) & 0xff;
    const b2 = h[1] & 0xff;
    const b3 = (h[2] >> 8) & 0xff;
    const b4 = h[2] & 0xff;
    return isPrivateIPv4(`${b1}.${b2}.${b3}.${b4}`);
  }

  return false;
}

/**
 * Resolves all DNS records for a given hostname (both IPv4 A records and IPv6 AAAA records),
 * falling back to lookupAsync for local host resolution.
 */
export async function resolveAllDnsRecords(hostname: string): Promise<string[]> {
  const ipSet = new Set<string>();

  // If hostname is already a direct IP address, return it directly
  if (net.isIP(hostname)) {
    return [hostname];
  }

  // Query IPv4 (A records), IPv6 (AAAA records), and system getaddrinfo (lookup)
  const [res4, res6, resLookup] = await Promise.allSettled([
    resolve4Async(hostname),
    resolve6Async(hostname),
    lookupAsync(hostname, { all: true }),
  ]);

  if (res4.status === "fulfilled" && Array.isArray(res4.value)) {
    for (const ip of res4.value) {
      if (typeof ip === "string") ipSet.add(ip.trim());
    }
  }

  if (res6.status === "fulfilled" && Array.isArray(res6.value)) {
    for (const ip of res6.value) {
      if (typeof ip === "string") ipSet.add(ip.trim());
    }
  }

  if (resLookup.status === "fulfilled" && resLookup.value) {
    const lookupAddrs = Array.isArray(resLookup.value)
      ? resLookup.value
      : [resLookup.value];
    for (const entry of lookupAddrs) {
      if (typeof entry === "string") {
        ipSet.add(entry.trim());
      } else if (entry && typeof entry.address === "string") {
        ipSet.add(entry.address.trim());
      }
    }
  }

  return Array.from(ipSet);
}

/**
 * Checks if a given URL is safe from SSRF attacks.
 * It resolves all DNS records (A and AAAA) and checks if any resolved IP is a private/internal address.
 */
export async function isSafeWebhookUrl(
  urlString: string,
): Promise<{ isSafe: boolean; reason?: string }> {
  try {
    const url = new URL(urlString);

    // 1. Validate Scheme
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        isSafe: false,
        reason: "Invalid protocol. Only HTTP and HTTPS are allowed.",
      };
    }

    // 2. Resolve DNS (all A and AAAA records)
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    // Direct IP address check
    if (net.isIP(hostname)) {
      const isIPv6 = net.isIPv6(hostname) || hostname.includes(":");
      const isPrivate = isIPv6 ? isPrivateIPv6(hostname) : isPrivateIPv4(hostname);
      if (isPrivate) {
        return {
          isSafe: false,
          reason: `Target IP (${hostname}) falls into a forbidden private network range.`,
        };
      }
      return { isSafe: true };
    }

    const addresses = await resolveAllDnsRecords(hostname);
    if (!addresses.length) {
      return { isSafe: false, reason: "Hostname did not resolve." };
    }

    // 3. Parse and Validate IP ranges natively without external packages
    for (const address of addresses) {
      const isIPv6 = address.includes(":") || net.isIPv6(address);
      const isPrivate = isIPv6
        ? isPrivateIPv6(address)
        : isPrivateIPv4(address);
      if (isPrivate) {
        return {
          isSafe: false,
          reason: `Resolved IP (${address}) falls into a forbidden private network range.`,
        };
      }
    }

    return { isSafe: true };
  } catch (error: any) {
    return {
      isSafe: false,
      reason: error.message || "Failed to parse or resolve URL.",
    };
  }
}

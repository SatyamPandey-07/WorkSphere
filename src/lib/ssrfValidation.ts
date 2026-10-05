import dns from "dns";
import net from "net";
import { promisify } from "util";

const lookupAsync = promisify(dns.lookup);
const resolve4Async = promisify(dns.resolve4);
const resolve6Async = promisify(dns.resolve6);

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN) || parts.some((p) => p < 0 || p > 255)) {
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

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback and unspecified addresses
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:0" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  // Unique local addresses (fc00::/7) start with fc or fd
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // Link-local addresses (fe80::/10) start with fe8, fe9, fea, feb
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  // IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1 or ::ffff:7f00:1)
  const mappedMatch = normalized.match(/^(?:(?:::)|(?:0+:){5})ffff:(.+)$/);
  if (mappedMatch) {
    const ipv4Part = mappedMatch[1];
    if (ipv4Part.includes(".")) {
      return isPrivateIPv4(ipv4Part);
    }
    const hexParts = ipv4Part.split(":");
    if (hexParts.length === 2) {
      const high = parseInt(hexParts[0], 16);
      const low = parseInt(hexParts[1], 16);
      if (
        !isNaN(high) &&
        !isNaN(low) &&
        high >= 0 &&
        high <= 0xffff &&
        low >= 0 &&
        low <= 0xffff
      ) {
        const b1 = (high >> 8) & 0xff;
        const b2 = high & 0xff;
        const b3 = (low >> 8) & 0xff;
        const b4 = low & 0xff;
        return isPrivateIPv4(`${b1}.${b2}.${b3}.${b4}`);
      }
      return true; // Treat malformed mapped address as unsafe
    }
    return true;
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

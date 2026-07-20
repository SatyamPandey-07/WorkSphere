import dns from "dns/promises";

// Restricted IP ranges (Private, Loopback, Link-Local, Cloud Metadata)
const BLOCKED_IP_PATTERNS = [
  /^127\./,                         // Loopback (127.0.0.0/8)
  /^10\./,                          // Private class A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // Private class B (172.16.0.0/12)
  /^192\.168\./,                    // Private class C (192.168.0.0/16)
  /^169\.254\./,                    // Link-local / Cloud Metadata (169.254.0.0/16)
  /^0\./,                           // Reserved (0.0.0.0/8)
  /^::1$/,                          // IPv6 loopback
  /^fc00:/i,                        // IPv6 Unique Local Address
  /^fe80:/i,                        // IPv6 Link-Local
];

export async function validateWebhookUrl(urlString: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const parsedUrl = new URL(urlString);

    // 1. Protocol Restriction
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { valid: false, reason: "Only http and https protocols are allowed." };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 2. Reject explicit loopback/metadata hostnames
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      return { valid: false, reason: "Internal hostnames are strictly forbidden." };
    }

    // 3. DNS Lookup Resolution
    let addresses: string[] = [];
    try {
      const records = await dns.lookup(hostname, { all: true });
      addresses = records.map((r) => r.address);
    } catch {
      return { valid: false, reason: "Unable to resolve destination hostname." };
    }

    // 4. Validate all resolved IPs against blocked ranges
    for (const ip of addresses) {
      if (BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(ip))) {
        return { valid: false, reason: "Destination resolves to a restricted internal network address." };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "Invalid URL structure." };
  }
}
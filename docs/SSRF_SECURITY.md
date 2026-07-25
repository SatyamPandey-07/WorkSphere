# Server-Side Request Forgery (SSRF) Security Model

WorkSphere processes outbound server-side HTTP requests when fetching third-party workspace APIs, indexing external telemetry streams, fetching venue photo assets, and invoking user-defined webhook actions.

To prevent Server-Side Request Forgery (SSRF) attacks, WorkSphere employs a rigorous validation layer in [ssrfValidation.ts](file:///c:/Users/shrut/OneDrive/Desktop/WorkSphere/src/lib/ssrfValidation.ts) to verify target hosts before initiating server network socket connections.

---

## 1. The SSRF Attack Vector

An SSRF vulnerability occurs when an application server fetches a remote resource without validating the target URL. An attacker can supply a URL pointing to internal hosts (e.g. `http://127.0.0.1:3000/api/admin` or cloud metadata endpoints like `http://169.254.169.254/latest/meta-data/`) to access private resources, query local databases, or scan the internal network from the trusted context of the application server.

---

## 2. Forbidden IP Address Block Lists

WorkSphere resolves every domain name before issuing a request and cross-checks the resolved IP address against blacklisted IPv4 and IPv6 private, loopback, and link-local ranges:

### IPv4 Forbidden Ranges

- **Loopback Address**: `127.0.0.0/8` (RFC 5735) - Points to localhost.
- **Private Networks (RFC 1918)**:
  - Class A: `10.0.0.0/8`
  - Class B: `172.16.0.0/12`
  - Class C: `192.168.0.0/16`
- **Link-Local / Autoconfiguration**: `169.254.0.0/16` (RFC 3927) - Used by cloud providers (e.g. AWS, GCP) to host instance metadata.
- **Unspecified/Wildcard Address**: `0.0.0.0` - Can route to local interfaces in some environments.

### IPv6 Forbidden Ranges

- **Loopback & Unspecified**: `::1`, `::`, `0:0:0:0:0:0:0:1`, `0:0:0:0:0:0:0:0`
- **Unique Local Addresses (ULA)**: `fc00::/7` (starts with `fc` or `fd`) - Private local IPv6 spaces.
- **Link-Local Unicast**: `fe80::/10` (starts with `fe8`, `fe9`, `fea`, or `feb`)
- **IPv4-Mapped IPv6**: `::ffff:0:0/96` (e.g., `::ffff:192.168.1.1`) - Checked by extracting the lower IPv4 segment and running the standard IPv4 blacklist algorithm.

---

## 3. DNS Resolution & Anti-Rebinding Check

To prevent DNS rebinding attacks (where an attacker associates a domain name with a safe IP during validation, then quickly updates the DNS record to point to a private IP for the actual request), WorkSphere validates the IP address resolved directly by the system resolver:

1. **Protocol Check**: Limits the protocol strictly to `http:` and `https:`.
2. **DNS Resolution**: Performs lookup using Node’s native `dns.lookup` (promisified as `lookupAsync`).
3. **Blacklist Match**: Verifies whether the resolved IP falls into a forbidden range.

```typescript
import dns from "dns";
import { promisify } from "util";

const lookupAsync = promisify(dns.lookup);

export async function isSafeWebhookUrl(
  urlString: string,
): Promise<{ isSafe: boolean; reason?: string }> {
  try {
    const url = new URL(urlString);

    // 1. Validate Scheme
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { isSafe: false, reason: "Invalid protocol." };
    }

    // 2. Resolve DNS
    const hostname = url.hostname;
    const { address } = await lookupAsync(hostname);

    // 3. Parse and Validate IP
    const isIPv6 = address.includes(":");
    const isPrivate = isIPv6 ? isPrivateIPv6(address) : isPrivateIPv4(address);

    if (isPrivate) {
      return { isSafe: false, reason: "Forbidden private network range." };
    }

    return { isSafe: true };
  } catch (error: any) {
    return { isSafe: false, reason: "Failed to parse/resolve URL." };
  }
}
```

---

## 4. Webhook and External Proxy Inspection

SSRF protection is integrated into WorkSphere's webhook dispatch and proxy handlers:

- **Webhooks (e.g. `src/app/dashboard/webhooks/actions.ts`)**:
  Before saving a user-configured webhook URL, the server invokes `isSafeWebhookUrl(url)` to prevent users from binding webhooks pointing to localhost or cloud metadata services.
- **Image Proxying / Fetch Services**:
  Endpoints executing proxy requests verify user-supplied parameters before firing outbound fetches, ensuring requests do not leak internal database state or local files.

---

## 5. Domain Whitelisting Guidelines

If the application must interface with trusted external APIs (e.g., Foursquare, Yelp, Google Places, custom workspace telemetry streams), we implement **Domain Whitelisting** to bypass general DNS block checks for authenticated partners:

### How to Add a Whitelisted Domain

1. Create a `TRUSTED_DOMAINS` array in [ssrfValidation.ts](file:///c:/Users/shrut/OneDrive/Desktop/WorkSphere/src/lib/ssrfValidation.ts):
   ```typescript
   const TRUSTED_DOMAINS = [
     "api.foursquare.com",
     "maps.googleapis.com",
     "api.yelp.com",
     "api.cohere.ai",
   ];
   ```
2. Integrate the check into the `isSafeWebhookUrl` function before DNS resolution:
   ```typescript
   const hostname = url.hostname.toLowerCase();
   if (TRUSTED_DOMAINS.includes(hostname)) {
     return { isSafe: true }; // Whitelisted domains bypass private IP checks
   }
   ```
3. Always verify that whitelisted API endpoints are secure and do not support open redirects that could lead back to local network addresses.

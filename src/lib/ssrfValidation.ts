import dns from 'dns';
import { promisify } from 'util';

const lookupAsync = promisify(dns.lookup);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true; // Treat invalid as unsafe
  
  const [first, second] = parts;
  
  // 127.0.0.0/8 (Loopback)
  if (first === 127) return true;
  // 10.0.0.0/8 (Private Class A)
  if (first === 10) return true;
  // 172.16.0.0/12 (Private Class B)
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.168.0.0/16 (Private Class C)
  if (first === 192 && second === 168) return true;
  // 169.254.0.0/16 (Link Local / AWS Metadata)
  if (first === 169 && second === 254) return true;
  // 0.0.0.0 (Wildcard / Localhost)
  if (first === 0) return true;
  
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  
  // Loopback and unspecified addresses
  if (normalized === '::' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:0' || normalized === '0:0:0:0:0:0:0:1') return true;
  
  // Unique local addresses (fc00::/7) start with fc or fd
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  
  // Link-local addresses (fe80::/10) start with fe8, fe9, fea, feb
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  
  // IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = ip.substring(7);
    return isPrivateIPv4(ipv4Part);
  }
  
  return false;
}

/**
 * Checks if a given URL is safe from SSRF attacks.
 * It resolves the domain to an IP and checks if the IP is a private/internal address.
 */
export async function isSafeWebhookUrl(urlString: string): Promise<{ isSafe: boolean; reason?: string }> {
  try {
    const url = new URL(urlString);
    
    // 1. Validate Scheme
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { isSafe: false, reason: 'Invalid protocol. Only HTTP and HTTPS are allowed.' };
    }

    // 2. Resolve DNS
    const hostname = url.hostname;
    const { address } = await lookupAsync(hostname);
    
    // 3. Parse and Validate IP ranges natively without external packages
    const isIPv6 = address.includes(':');
    const isPrivate = isIPv6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
    
    if (isPrivate) {
      return { isSafe: false, reason: `Resolved IP (${address}) falls into a forbidden private network range.` };
    }

    return { isSafe: true };
  } catch (error: any) {
    return { isSafe: false, reason: error.message || 'Failed to parse or resolve URL.' };
  }
}

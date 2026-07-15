import dns from 'dns';
import { promisify } from 'util';
import ipaddr from 'ipaddr.js';

const lookupAsync = promisify(dns.lookup);

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
    
    // 3. Parse and Validate IP
    if (!ipaddr.isValid(address)) {
       return { isSafe: false, reason: 'Could not resolve to a valid IP address.' };
    }

    const parsedIp = ipaddr.parse(address);
    const range = parsedIp.range();

    // The 'unicast' range is generally considered public in ipaddr.js for IPv4,
    // though we must explicitly block specific known internal ranges that might slip through.
    const forbiddenRanges = [
      'unspecified',
      'broadcast',
      'multicast',
      'linkLocal',
      'loopback',
      'private',
      'carrierGradeNat',
      'reserved',
      'uniqueLocal',
      'ipv4Mapped',
      'rfc6145',
      'rfc6052',
      '6to4',
      'teredo'
    ];

    if (forbiddenRanges.includes(range)) {
      return { isSafe: false, reason: `Resolved IP (${address}) falls into a forbidden network range (${range}).` };
    }

    // Specifically block AWS Metadata IP which might classify oddly depending on parser versions
    if (address === '169.254.169.254') {
        return { isSafe: false, reason: 'Cloud metadata service access is forbidden.' };
    }
    
    // Catch-all for basic local/0.0.0.0 bypasses
    if (address === '0.0.0.0' || address === '::') {
        return { isSafe: false, reason: 'Wildcard addresses are forbidden.' };
    }

    return { isSafe: true };
  } catch (error: any) {
    return { isSafe: false, reason: error.message || 'Failed to parse or resolve URL.' };
  }
}

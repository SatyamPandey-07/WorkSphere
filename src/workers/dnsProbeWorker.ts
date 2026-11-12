/**
 * DNS Probe Worker
 * Performs asynchronous DNS lookups and measures routing latency to major cloud provider endpoints.
 */

interface ProbeRequest {
    type: 'PROBE_DNS';
    targets: string[]; // e.g., ['aws.amazon.com', 'gcp.googleapis.com']
}

interface ProbeResult {
    type: 'PROBE_RESULT';
    results: Record<string, { latency: number; resolved: boolean; error?: string }>;
}

self.onmessage = async (event: MessageEvent<ProbeRequest>) => {
    if (event.data.type === 'PROBE_DNS') {
        const { targets } = event.data;
        const results: Record<string, { latency: number; resolved: boolean; error?: string }> = {};

        for (const target of targets) {
            results[target] = await measureDNSLatency(target);
        }

        const response: ProbeResult = {
            type: 'PROBE_RESULT',
            results
        };

        self.postMessage(response);
    }
};

async function measureDNSLatency(domain: string): Promise<{ latency: number; resolved: boolean; error?: string }> {
    // Browsers don't expose raw DNS lookup times directly. 
    // We proxy this by measuring the time to first byte (TTFB) of a lightweight HTTPS request 
    // to the domain, which includes DNS + TCP + TLS. 
    // For a pure DNS measure, one would use DNS-over-HTTPS (DoH).

    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`;
    const start = performance.now();

    try {
        const response = await fetch(dohUrl, {
            headers: { 'Accept': 'application/dns-json' },
            cache: 'no-store' // Force fresh lookup
        });

        if (response.ok) {
            const data = await response.json();
            const end = performance.now();

            return {
                latency: Math.round(end - start),
                resolved: data.Answer && data.Answer.length > 0
            };
        } else {
            return { latency: -1, resolved: false, error: `HTTP ${response.status}` };
        }
    } catch (error: any) {
        return { latency: -1, resolved: false, error: error.message };
    }
}

export { };

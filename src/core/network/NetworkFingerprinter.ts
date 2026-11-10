/**
 * NetworkFingerprinter
 * Orchestrates a series of non-intrusive network probes to classify the venue's 
 * NAT type and firewall strictness.
 */

export enum NATType {
  OPEN = 'OPEN',
  FULL_CONE = 'FULL_CONE',
  RESTRICTED_CONE = 'RESTRICTED_CONE',
  PORT_RESTRICTED = 'PORT_RESTRICTED',
  SYMMETRIC = 'SYMMETRIC',
  UNKNOWN = 'UNKNOWN'
}

export interface FingerprintResult {
  natType: NATType;
  firewallStrictness: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK_ALL';
  publicIp: string | null;
  udpBlocked: boolean;
  websocketsSupported: boolean;
  timestamp: number;
}

export class NetworkFingerprinter {
  private stunServers: string[] = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302'
  ];

  public async runProbes(): Promise<FingerprintResult> {
    const [natResult, wsResult, udpResult] = await Promise.allSettled([
      this.detectNATType(),
      this.testWebSockets(),
      this.testUDPConnectivity()
    ]);

    const natType = natResult.status === 'fulfilled' ? natResult.value : NATType.UNKNOWN;
    const websocketsSupported = wsResult.status === 'fulfilled' ? wsResult.value : false;
    const udpBlocked = udpResult.status === 'fulfilled' ? !udpResult.value : true;

    const firewallStrictness = this.calculateFirewallStrictness(natType, websocketsSupported, udpBlocked);

    return {
      natType,
      firewallStrictness,
      publicIp: null, // Would be populated by STUN response parsing
      udpBlocked,
      websocketsSupported,
      timestamp: Date.now()
    };
  }

  private async detectNATType(): Promise<NATType> {
    // Simplified STUN-based NAT detection logic
    // In production, this requires a WebRTC RTCPeerConnection to multiple STUN servers
    // and analyzes the mapped addresses returned.
    
    return new Promise((resolve) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: this.stunServers }] });
        let candidatesGathered = 0;
        let hasHost = false;
        let hasSrflx = false;
        let hasRelay = false;

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            candidatesGathered++;
            if (event.candidate.type === 'host') hasHost = true;
            if (event.candidate.type === 'srflx') hasSrflx = true;
            if (event.candidate.type === 'relay') hasRelay = true;
          } else {
            // Gathering complete
            pc.close();
            if (hasRelay) resolve(NATType.SYMMETRIC);
            else if (hasSrflx && hasHost) resolve(NATType.FULL_CONE); // Simplified assumption
            else resolve(NATType.UNKNOWN);
          }
        };

        pc.createDataChannel('test');
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        
        // Timeout fallback
        setTimeout(() => {
          pc.close();
          resolve(NATType.UNKNOWN);
        }, 5000);
      } catch (e) {
        resolve(NATType.UNKNOWN);
      }
    });
  }

  private async testWebSockets(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // Test against a known public echo server
        const ws = new WebSocket('wss://ws.postman-echo.com/raw');
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 3000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  private async testUDPConnectivity(): Promise<boolean> {
    // WebRTC DataChannels use UDP (with TCP fallback). 
    // If we can establish a direct P2P connection via STUN, UDP is likely open.
    // This is a simplified proxy for UDP availability in the browser context.
    return this.detectNATType().then(nat => nat !== NATType.UNKNOWN && nat !== NATType.SYMMETRIC);
  }

  private calculateFirewallStrictness(
    nat: NATType, 
    ws: boolean, 
    udpBlocked: boolean
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK_ALL' {
    if (!ws && udpBlocked) return 'BLOCK_ALL';
    if (nat === NATType.SYMMETRIC || udpBlocked) return 'HIGH';
    if (nat === NATType.PORT_RESTRICTED || nat === NATType.RESTRICTED_CONE) return 'MEDIUM';
    return 'LOW';
  }
}

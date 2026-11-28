import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PeerConnectionHud,
  getQualityTier,
  parseRtcStatsReport,
} from '@/components/realtime/PeerConnectionHud';

describe('PeerConnectionHud - Stats and Quality Calculations', () => {
  it('correctly categorizes quality tiers based on RTT and packet loss thresholds', () => {
    // Green: < 100ms
    const excellentTier = getQualityTier(50, 0);
    expect(excellentTier.tier).toBe('Excellent');
    expect(excellentTier.color).toBe('#10b981');

    // Yellow: 100ms - 300ms
    const goodTier = getQualityTier(150, 1.2);
    expect(goodTier.tier).toBe('Good');
    expect(goodTier.color).toBe('#eab308');

    // Red: > 300ms
    const poorRtt = getQualityTier(350, 0);
    expect(poorRtt.tier).toBe('Poor');
    expect(poorRtt.color).toBe('#ef4444');

    // Red due to high packet loss >= 5%
    const poorLoss = getQualityTier(80, 6.5);
    expect(poorLoss.tier).toBe('Poor');
  });

  it('parses RTCStatsReport entries for candidate-pair RTT and inbound packet loss', () => {
    const mockReports = [
      {
        type: 'candidate-pair',
        state: 'succeeded',
        currentRoundTripTime: 0.082, // 82ms
      },
      {
        type: 'inbound-rtp',
        packetsLost: 2,
        packetsReceived: 98,
      },
    ];

    const parsed = parseRtcStatsReport(mockReports);
    expect(parsed.rttMs).toBe(82);
    expect(parsed.packetsLost).toBe(2);
    expect(parsed.packetsTotal).toBe(100);
    expect(parsed.packetLossPct).toBe(2);
  });
});

describe('PeerConnectionHud - Component Rendering & Interaction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders HUD with connection stats and allows minimizing and expanding', async () => {
    const mockPc = {
      getStats: jest.fn().mockResolvedValue([
        {
          type: 'candidate-pair',
          state: 'succeeded',
          currentRoundTripTime: 0.065,
        },
        {
          type: 'inbound-rtp',
          packetsLost: 0,
          packetsReceived: 150,
        },
      ]),
    } as unknown as RTCPeerConnection;

    await act(async () => {
      render(
        <PeerConnectionHud
          peerConnections={{ 'peer-1': mockPc }}
          activePeerId="peer-1"
          sampleIntervalMs={3000}
        />
      );
    });

    expect(screen.getByTestId('peer-connection-hud')).toBeInTheDocument();
    expect(screen.getByText('Network Health HUD')).toBeInTheDocument();
    expect(screen.getByTestId('peer-hud-quality-tier')).toHaveTextContent('Excellent');

    // Minimize HUD
    const minimizeBtn = screen.getByTestId('peer-hud-minimize-btn');
    fireEvent.click(minimizeBtn);

    expect(screen.queryByTestId('peer-connection-hud')).not.toBeInTheDocument();
    const pill = screen.getByTestId('peer-hud-minimized-pill');
    expect(pill).toBeInTheDocument();

    // Expand HUD
    fireEvent.click(pill);
    expect(screen.getByTestId('peer-connection-hud')).toBeInTheDocument();
  });
});

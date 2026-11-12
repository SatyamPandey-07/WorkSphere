import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CollimatedHUDOverlay, Waypoint } from '@/components/ar/CollimatedHUDOverlay';

describe('CollimatedHUDOverlay Component', () => {
  const mockClearRect = jest.fn();
  const mockSave = jest.fn();
  const mockRestore = jest.fn();
  const mockBeginPath = jest.fn();
  const mockArc = jest.fn();
  const mockStroke = jest.fn();
  const mockMoveTo = jest.fn();
  const mockLineTo = jest.fn();
  const mockFill = jest.fn();
  const mockFillText = jest.fn();
  const mockTranslate = jest.fn();
  const mockRotate = jest.fn();
  const mockSetLineDash = jest.fn();
  const mockClosePath = jest.fn();

  let rafCallback: FrameRequestCallback | null = null;

  const mockCtx = {
    clearRect: mockClearRect,
    save: mockSave,
    restore: mockRestore,
    beginPath: mockBeginPath,
    arc: mockArc,
    stroke: mockStroke,
    moveTo: mockMoveTo,
    lineTo: mockLineTo,
    fill: mockFill,
    fillText: mockFillText,
    translate: mockTranslate,
    rotate: mockRotate,
    setLineDash: mockSetLineDash,
    closePath: mockClosePath,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rafCallback = null;
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCtx);
    window.requestAnimationFrame = jest.fn((cb) => {
      rafCallback = cb;
      return 1;
    });
    window.cancelAnimationFrame = jest.fn();
  });

  it('renders HUD overlay and initial status indicator', () => {
    render(<CollimatedHUDOverlay />);
    expect(screen.getByText(/HUD STATUS:/i)).toBeInTheDocument();
    expect(screen.getByTestId('hud-session-state')).toBeInTheDocument();
  });

  it('renders start session button when idle or unsupported', () => {
    render(<CollimatedHUDOverlay />);
    expect(screen.getByRole('button', { name: /Start WebXR HUD/i })).toBeInTheDocument();
  });

  it('draws crosshair, pitch ladder, and valid waypoints on canvas', () => {
    const waypoints: Waypoint[] = [
      { id: 'wp-1', name: 'Alpha Tower', bearing: 45, distanceMeters: 350 },
    ];

    render(<CollimatedHUDOverlay waypoints={waypoints} accentColor="#10b981" />);

    act(() => {
      rafCallback?.(100);
    });

    expect(mockClearRect).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
    expect(mockStroke).toHaveBeenCalled();
    expect(mockFillText).toHaveBeenCalledWith(expect.stringContaining('Alpha Tower'), expect.any(Number), expect.any(Number));
  });

  it('sanitizes NaN and invalid waypoints without breaking canvas matrix transformations', () => {
    const invalidWaypoints: Waypoint[] = [
      { id: 'wp-nan', name: 'Broken Beacon', bearing: NaN, distanceMeters: NaN },
      { id: 'wp-null', name: null as unknown as string, bearing: 90, distanceMeters: 50 },
    ];

    render(<CollimatedHUDOverlay waypoints={invalidWaypoints} />);

    act(() => {
      rafCallback?.(100);
    });

    // Ensure none of the translate calls were given NaN
    mockTranslate.mock.calls.forEach(([x, y]) => {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    });
  });

  it('updates orientation upon receiving deviceorientation events', () => {
    render(<CollimatedHUDOverlay />);

    act(() => {
      const event = new Event('deviceorientation') as any;
      event.beta = 25.5; // pitch
      event.gamma = -12.3; // roll
      window.dispatchEvent(event);
      rafCallback?.(100);
    });

    expect(mockRotate).toHaveBeenCalled();
  });

  it('starts and ends WebXR session via user buttons', async () => {
    const mockSessionEnd = jest.fn().mockResolvedValue(undefined);
    const mockAddEventListener = jest.fn();
    const mockRequestSession = jest.fn().mockResolvedValue({
      addEventListener: mockAddEventListener,
      end: mockSessionEnd,
      visibilityState: 'visible',
    });

    (window.navigator as any).xr = {
      isSessionSupported: jest.fn().mockResolvedValue(true),
      requestSession: mockRequestSession,
    };

    render(<CollimatedHUDOverlay />);

    const startBtn = screen.getByRole('button', { name: /Start WebXR HUD/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(mockRequestSession).toHaveBeenCalledWith('immersive-ar', expect.any(Object));

    const exitBtn = screen.getByRole('button', { name: /Exit Session/i });
    expect(exitBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(exitBtn);
    });

    expect(mockSessionEnd).toHaveBeenCalled();
  });

  it('cleans up active WebXR session on component unmount', async () => {
    const mockSessionEnd = jest.fn().mockResolvedValue(undefined);
    const mockRequestSession = jest.fn().mockResolvedValue({
      addEventListener: jest.fn(),
      end: mockSessionEnd,
      visibilityState: 'visible',
    });

    (window.navigator as any).xr = {
      isSessionSupported: jest.fn().mockResolvedValue(true),
      requestSession: mockRequestSession,
    };

    const { unmount } = render(<CollimatedHUDOverlay />);

    const startBtn = screen.getByRole('button', { name: /Start WebXR HUD/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    unmount();
    expect(mockSessionEnd).toHaveBeenCalled();
  });
});

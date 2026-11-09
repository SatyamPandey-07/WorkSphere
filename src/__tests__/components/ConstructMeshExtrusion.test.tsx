import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConstructMeshExtrusion, Point2D } from '@/components/whiteboard/ConstructMeshExtrusion';

describe('ConstructMeshExtrusion Component', () => {
  const mockClearRect = jest.fn();
  const mockSave = jest.fn();
  const mockRestore = jest.fn();
  const mockBeginPath = jest.fn();
  const mockClosePath = jest.fn();
  const mockMoveTo = jest.fn();
  const mockLineTo = jest.fn();
  const mockFill = jest.fn();
  const mockStroke = jest.fn();
  const mockTranslate = jest.fn();

  let rafCallback: FrameRequestCallback | null = null;

  const mockCtx = {
    clearRect: mockClearRect,
    save: mockSave,
    restore: mockRestore,
    beginPath: mockBeginPath,
    closePath: mockClosePath,
    moveTo: mockMoveTo,
    lineTo: mockLineTo,
    fill: mockFill,
    stroke: mockStroke,
    translate: mockTranslate,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1.0,
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
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

  it('renders mesh extrusion canvas and control indicators', () => {
    render(<ConstructMeshExtrusion />);
    expect(screen.getByText(/MESH EXTRUSION:/i)).toBeInTheDocument();
    expect(screen.getByTestId('mesh-canvas')).toBeInTheDocument();
  });

  it('renders interactive rotation controls and triggers onTransformChange', () => {
    const onTransformChange = jest.fn();
    render(<ConstructMeshExtrusion onTransformChange={onTransformChange} />);

    const rotateYBtn = screen.getByRole('button', { name: /Rotate Y/i });
    const rotateXBtn = screen.getByRole('button', { name: /Rotate X/i });

    fireEvent.click(rotateYBtn);
    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ rotationY: 45 })
    );

    fireEvent.click(rotateXBtn);
    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ rotationX: 30 })
    );
  });

  it('handles invalid or null strokePoints without crashing', () => {
    const invalidPoints = [
      null as unknown as Point2D,
      { x: NaN, y: 10 },
      { x: 50, y: undefined as unknown as number },
    ];

    render(<ConstructMeshExtrusion strokePoints={invalidPoints} />);

    act(() => {
      rafCallback?.(100);
    });

    expect(mockClearRect).toHaveBeenCalled();
    expect(mockBeginPath).toHaveBeenCalled();
  });

  it('renders customized points and draws front/back faces', () => {
    const validPoints: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];

    render(
      <ConstructMeshExtrusion
        strokePoints={validPoints}
        extrusionDepth={50}
        emissiveColor="#3b82f6"
        wireframeColor="#60a5fa"
      />
    );

    act(() => {
      rafCallback?.(100);
    });

    expect(mockClearRect).toHaveBeenCalled();
    expect(mockTranslate).toHaveBeenCalled();
    expect(mockFill).toHaveBeenCalled();
    expect(mockStroke).toHaveBeenCalled();
  });

  it('connects to PartyKit WebSocket and syncs incoming transform messages', () => {
    const mockSend = jest.fn();
    const mockClose = jest.fn();
    let socketInstance: any = null;

    class MockWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      send = mockSend;
      close = mockClose;

      constructor(url: string) {
        socketInstance = this;
      }
    }

    (window as any).WebSocket = MockWebSocket;

    const onTransformChange = jest.fn();
    render(
      <ConstructMeshExtrusion
        partykitHost="localhost:1999"
        roomId="room-42"
        onTransformChange={onTransformChange}
      />
    );

    expect(socketInstance).not.toBeNull();

    // Trigger onopen
    act(() => {
      socketInstance.onopen();
    });

    expect(screen.getByTestId('sync-status').textContent).toBe('(connected)');
    expect(mockSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'join', payload: { client: 'mesh-extruder' } })
    );

    // Trigger onmessage with transform payload
    act(() => {
      socketInstance.onmessage({
        data: JSON.stringify({
          type: 'sync-transform',
          payload: { rotationX: 45, rotationY: 90, scale: 2 },
        }),
      });
    });

    expect(onTransformChange).toHaveBeenCalledWith(
      expect.objectContaining({ rotationX: 45, rotationY: 90, scale: 2 })
    );
  });

  it('cleans up WebSocket and event listeners on unmount', () => {
    const mockClose = jest.fn();
    let socketInstance: any = null;

    class MockWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      close = mockClose;

      constructor() {
        socketInstance = this;
      }
    }

    (window as any).WebSocket = MockWebSocket;

    const { unmount } = render(
      <ConstructMeshExtrusion partykitHost="partykit.dev" roomId="room-1" />
    );

    unmount();
    expect(mockClose).toHaveBeenCalled();
    expect(socketInstance.onopen).toBeNull();
    expect(socketInstance.onmessage).toBeNull();
  });
});

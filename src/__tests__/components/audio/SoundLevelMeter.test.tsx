import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  SoundLevelMeter,
  type AudioContextLike,
} from '@/components/audio/SoundLevelMeter';

describe('SoundLevelMeter suspended AudioContext handling', () => {
  it('shows "Tap to Start Meter" when suspended and transitions to Running after resume()', async () => {
    const mockCtx: AudioContextLike = {
      state: 'suspended',
      resume: jest.fn(async () => {
        mockCtx.state = 'running';
      }),
    };
    const onReady = jest.fn();

    render(
      <SoundLevelMeter
        audioContext={mockCtx}
        decibels={58.4}
        onReady={onReady}
      />
    );

    expect(screen.getByTestId('tap-to-start-meter-btn')).toHaveTextContent(
      'Tap to Start Meter'
    );
    expect(screen.getByTestId('sound-meter-status')).toHaveTextContent('Suspended');
    expect(screen.getByTestId('sound-level-db')).toHaveTextContent('-- dB');

    await act(async () => {
      fireEvent.click(screen.getByTestId('tap-to-start-meter-btn'));
    });

    await waitFor(() => {
      expect(mockCtx.resume).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('sound-meter-status')).toHaveTextContent('Running');
      expect(screen.getByTestId('sound-level-db')).toHaveTextContent('58.4 dB');
      expect(onReady).toHaveBeenCalledTimes(1);
    });
  });

  it('resumes automatically on one-time touchstart and omits prompt when already running', async () => {
    const suspendedCtx: AudioContextLike = {
      state: 'suspended',
      resume: jest.fn(async () => {
        suspendedCtx.state = 'running';
      }),
    };

    const { rerender } = render(
      <SoundLevelMeter audioContext={suspendedCtx} decibels={62} />
    );

    await act(async () => {
      fireEvent.touchStart(window);
    });

    await waitFor(() => {
      expect(suspendedCtx.resume).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('tap-to-start-meter-btn')).not.toBeInTheDocument();
    });

    const runningCtx: AudioContextLike = {
      state: 'running',
      resume: jest.fn(),
    };
    rerender(<SoundLevelMeter audioContext={runningCtx} decibels={47.2} />);

    expect(screen.queryByTestId('tap-to-start-meter-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('sound-meter-status')).toHaveTextContent('Running');
    expect(screen.getByTestId('sound-level-db')).toHaveTextContent('47.2 dB');
  });
});
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import {
  StateChecksumVerifier,
  computeAdler32Checksum,
} from '@/components/crdt/StateChecksumVerifier';

describe('StateChecksumVerifier (150ms Debounced Adler-32)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('computes standard RFC 1950 Adler-32 digest accurately', () => {
    // Known RFC 1950 test vector: Adler32("Wikipedia") === 0x11e60398
    expect(computeAdler32Checksum('Wikipedia')).toBe('11e60398');
  });

  test('debounces checksum calculation by 150ms and cancels superseded edits during rapid typing bursts', () => {
    const onComputed = jest.fn();

    const { rerender } = render(
      <StateChecksumVerifier
        stateVector="Initial text"
        revision={1}
        debounceMs={150}
        onChecksumComputed={onComputed}
      />
    );

    // Simulate rapid typing / paste burst (updates every 30ms < 150ms debounce)
    act(() => {
      jest.advanceTimersByTime(30);
    });
    rerender(
      <StateChecksumVerifier
        stateVector="Initial text + burst 1"
        revision={2}
        debounceMs={150}
        onChecksumComputed={onComputed}
      />
    );

    act(() => {
      jest.advanceTimersByTime(30);
    });
    rerender(
      <StateChecksumVerifier
        stateVector={'A'.repeat(2000)}
        revision={3}
        debounceMs={150}
        onChecksumComputed={onComputed}
      />
    );

    // No synchronous or intermediate checksum calculations should have executed yet
    expect(onComputed).not.toHaveBeenCalled();
    expect(screen.getByTestId('state-checksum-verifier')).toHaveAttribute(
      'data-status',
      'computing'
    );

    // Advance remaining 150ms after final edit settles
    act(() => {
      jest.advanceTimersByTime(150);
    });

    const expectedFinalDigest = computeAdler32Checksum('A'.repeat(2000));
    expect(onComputed).toHaveBeenCalledTimes(1);
    expect(onComputed).toHaveBeenCalledWith(expectedFinalDigest);
    expect(screen.getByTestId('adler32-digest')).toHaveTextContent(
      `Adler-32: ${expectedFinalDigest}`
    );
  });

  test('flags checksum mismatch when local digest diverges from expectedRemoteChecksum', () => {
    const localState = new Map<number, number>([
      [101, 14],
      [202, 9],
    ]);

    render(
      <StateChecksumVerifier
        stateVector={localState}
        expectedRemoteChecksum="deadbeef"
        debounceMs={150}
      />
    );

    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(screen.getByTestId('state-checksum-verifier')).toHaveAttribute(
      'data-status',
      'mismatch'
    );
  });
});
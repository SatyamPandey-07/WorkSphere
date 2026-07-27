import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadAloudButton } from './ReadAloudButton';
import '@testing-library/jest-dom';

// Mock the speech hook so the component renders without errors in the test environment
jest.mock('@/hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    isSupported: true,
    isSpeaking: false,
    rate: 1,
    setRate: jest.fn(),
    speak: jest.fn(),
    cancel: jest.fn(),
  }),
  SPEED_OPTIONS: [1, 1.5, 2],
}));

describe('ReadAloudButton Tooltip Positioning', () => {
  it('positions tooltip at the bottom if near the top edge, hides on touch, and prevents focus reopening', () => {
    render(<ReadAloudButton text="Test message" />);
    
    const button = screen.getByRole('button', { name: /Read message aloud/i });
    const tooltipContainer = button.parentElement; 

    // Mock the bounding rect
    if (tooltipContainer) {
      tooltipContainer.getBoundingClientRect = jest.fn(() => ({
        top: 20, 
        bottom: 60,
        left: 0,
        right: 100,
        width: 100,
        height: 40,
        x: 0,
        y: 20,
        toJSON: () => {}
      })) as any;
    }

    // 1. Simulate mouse hover
    fireEvent.mouseEnter(tooltipContainer!);
    const tooltip = screen.getByTestId('tooltip');
    
    // Verify it is visible and positioned at the bottom (top-full)
    expect(tooltip.className).toContain('opacity-100');
    expect(tooltip.className).toContain('top-full');

    // 2. Simulate a mobile touch event
    fireEvent.touchStart(tooltipContainer!);
    
    // Verify the tooltip hides itself
    expect(tooltip.className).toContain('opacity-0');

    // 3. Simulate focus (which browsers fire after a touch event)
    fireEvent.focus(tooltipContainer!);

    // Verify the tooltip REMAINS hidden due to the new isTouchDismissed check
    expect(tooltip.className).toContain('opacity-0');

    // 4. Simulate blur to reset the state
    fireEvent.blur(tooltipContainer!);

    // 5. Normal mouse enter should work again
    fireEvent.mouseEnter(tooltipContainer!);
    expect(tooltip.className).toContain('opacity-100');
  });
});

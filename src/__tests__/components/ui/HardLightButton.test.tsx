import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { HardLightButton } from '@/components/ui/HardLightButton';

describe('HardLightButton', () => {
  it('renders children with default primary variant and md size', () => {
    render(<HardLightButton>Launch Vector</HardLightButton>);

    const button = screen.getByTestId('hard-light-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveTextContent('Launch Vector');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(button.className).toContain('bg-emerald-600');
    expect(button.className).toContain('px-5 py-2.5');

    expect(screen.getByTestId('hard-light-beam')).toBeInTheDocument();
    expect(screen.getByTestId('hard-light-content')).toBeInTheDocument();
    expect(screen.queryByTestId('hard-light-loading-spinner')).toBeNull();
  });

  it('renders wireframe variant correctly', () => {
    render(
      <HardLightButton variant="wireframe">Scan Sector</HardLightButton>
    );

    const button = screen.getByTestId('hard-light-button');
    expect(button.className).toContain('text-emerald-300');
    expect(button.className).toContain('border-emerald-500/60');
  });

  it('renders danger variant correctly', () => {
    render(
      <HardLightButton variant="danger">Abort Protocol</HardLightButton>
    );

    const button = screen.getByTestId('hard-light-button');
    expect(button.className).toContain('bg-red-600');
    expect(button.className).toContain('border-red-400');
  });

  it('falls back safely on unknown variant and size', () => {
    render(
      <HardLightButton variant={'quantum' as any} size={'ultra' as any}>
        Quantum Leap
      </HardLightButton>
    );

    const button = screen.getByTestId('hard-light-button');
    expect(button.className).toContain('bg-emerald-600');
    expect(button.className).toContain('px-5 py-2.5');
  });

  it('renders sm and lg sizes correctly', () => {
    const { rerender } = render(
      <HardLightButton size="sm">Small</HardLightButton>
    );
    expect(screen.getByTestId('hard-light-button').className).toContain(
      'px-3 py-1.5'
    );

    rerender(<HardLightButton size="lg">Large</HardLightButton>);
    expect(screen.getByTestId('hard-light-button').className).toContain(
      'px-7 py-3.5'
    );
  });

  it('triggers onClick handler when clicked', () => {
    const handleClick = jest.fn();
    render(<HardLightButton onClick={handleClick}>Click Me</HardLightButton>);

    const button = screen.getByTestId('hard-light-button');
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('disables button and prevents clicks when disabled=true', () => {
    const handleClick = jest.fn();
    render(
      <HardLightButton disabled onClick={handleClick}>
        Disabled Button
      </HardLightButton>
    );

    const button = screen.getByTestId('hard-light-button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders loading state with spinner and disables button when isLoading=true', () => {
    const handleClick = jest.fn();
    render(
      <HardLightButton isLoading onClick={handleClick}>
        Engaging Warp
      </HardLightButton>
    );

    const button = screen.getByTestId('hard-light-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('hard-light-loading-spinner')).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('allows overriding button type attribute to submit or reset', () => {
    const { rerender } = render(
      <HardLightButton type="submit">Submit Form</HardLightButton>
    );
    expect(screen.getByTestId('hard-light-button')).toHaveAttribute(
      'type',
      'submit'
    );

    rerender(<HardLightButton type="reset">Reset Form</HardLightButton>);
    expect(screen.getByTestId('hard-light-button')).toHaveAttribute(
      'type',
      'reset'
    );
  });

  it('merges custom className and forwards custom attributes', () => {
    render(
      <HardLightButton
        className="custom-glow-modifier"
        id="hud-trigger-btn"
        aria-label="Engage Hyperdrive"
      >
        Engage
      </HardLightButton>
    );

    const button = screen.getByTestId('hard-light-button');
    expect(button.className).toContain('custom-glow-modifier');
    expect(button).toHaveAttribute('id', 'hud-trigger-btn');
    expect(button).toHaveAttribute('aria-label', 'Engage Hyperdrive');
  });
});

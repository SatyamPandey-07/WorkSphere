// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConstructMeshExtrusion } from '@/components/whiteboard/ConstructMeshExtrusion';

describe('ConstructMeshExtrusion Component', () => {
  it('renders mesh extrusion canvas and control indicators', () => {
    render(<ConstructMeshExtrusion />);
    expect(screen.getByText(/MESH EXTRUSION:/i)).toBeInTheDocument();
  });

  it('renders interactive rotation controls', () => {
    render(<ConstructMeshExtrusion />);
    expect(screen.getByRole('button', { name: /Rotate Y/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rotate X/i })).toBeInTheDocument();
  });
});
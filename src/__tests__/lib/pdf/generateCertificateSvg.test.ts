import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  buildCertificateFilename,
  downloadCertificateSvg,
  generateCertificateSvg,
} from '@/lib/pdf/generateCertificateSvg';
import { NomadCertificateModal } from '@/components/profile/NomadCertificateModal';

describe('generateCertificateSvg & NomadCertificateModal', () => {
  const sampleCertificate = {
    bookingId: 'BK-9042',
    nomadName: 'Soham Gonbhare',
    venueName: 'WorkSphere Bandra Hub',
    city: 'Mumbai',
    attendedDate: '2026-11-24',
    hoursLogged: 6,
    verificationHash: '0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  };

  it('builds responsive SVG with badge, venue details, QR matrix, and cryptographic hash footer', () => {
    const svg = generateCertificateSvg(sampleCertificate);

    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 1200 760"');
    expect(svg).toContain('id="nomad-vector-badge"');
    expect(svg).toContain('id="certificate-qr-code"');
    expect(svg).toContain('WorkSphere Bandra Hub');
    expect(svg).toContain(sampleCertificate.verificationHash);
    expect(buildCertificateFilename('BK-9042')).toBe('nomad-certificate-BK-9042.svg');
  });

  it('sanitizes XML/script characters in certificate fields', () => {
    const svg = generateCertificateSvg({
      ...sampleCertificate,
      nomadName: '<script>alert(1)</script> & "Friends"',
    });

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Friends&quot;');
  });

  it('renders Download SVG button in modal and triggers SVG blob download', () => {
    const createObjectURLMock = jest.fn(() => 'blob:cert-svg');
    const revokeObjectURLMock = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURLMock,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURLMock,
      writable: true,
    });

    render(
      <NomadCertificateModal
        isOpen
        onClose={jest.fn()}
        certificate={sampleCertificate}
      />
    );

    const downloadBtn = screen.getByTestId('download-certificate-svg-btn');
    expect(downloadBtn.textContent).toContain('Download SVG');

    fireEvent.click(downloadBtn);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:cert-svg');

    const direct = downloadCertificateSvg(sampleCertificate);
    expect(direct.filename).toBe('nomad-certificate-BK-9042.svg');
  });
});

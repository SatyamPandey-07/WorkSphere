import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  buildNomadCredentialSvg,
  NomadPassportCertificate,
} from '../NomadPassportCertificate';

describe('NomadPassportCertificate', () => {
  it('renders valid SVG markup with dynamic username, date, and hash watermark', () => {
    const svg = buildNomadCredentialSvg({
      username: 'Soham <Dev>',
      verifiedAt: '2026-11-21',
      credentialHash: 'abcdef1234567890abcdef1234567890',
    });

    expect(svg).toContain('<svg');
    expect(svg).toContain('Soham &lt;Dev&gt;');
    expect(svg).toContain('2026-11-21');
    expect(svg).toContain('abcdef1234567890abcdef1234567890');
  });

  it('triggers instant SVG blob download when clicking Download Credential (.SVG)', () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:mock-credential-url');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const onDownload = jest.fn();

    render(
      <NomadPassportCertificate
        username="CoderSoham345"
        verifiedAt="2026-11-21"
        credentialHash="1234567890abcdef1234567890abcdef"
        onDownload={onDownload}
      />
    );

    fireEvent.click(screen.getByTestId('download-credential-svg-btn'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-credential-url');
    expect(onDownload).toHaveBeenCalledWith(
      'nomad-passport-codersoham345.svg',
      expect.stringContaining('CoderSoham345')
    );

    clickSpy.mockRestore();
  });
});
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockToPng = jest.fn();

jest.mock(
  'html-to-image',
  () => ({
    toPng: (...args: unknown[]) => mockToPng(...args),
  }),
  { virtual: true }
);

jest.mock(
  'qrcode.react',
  () => ({
    QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
      <div data-testid="mock-qrcode" data-value={value} data-size={size}>
        QR:{value}
      </div>
    ),
  }),
  { virtual: true }
);

import { FlightClearancePasscard } from '@/components/bookings/FlightClearancePasscard';

describe('FlightClearancePasscard Component', () => {
  const originalPrint = window.print;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.print = jest.fn();
    mockToPng.mockResolvedValue('data:image/png;base64,mockPngData');
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  afterAll(() => {
    window.print = originalPrint;
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <FlightClearancePasscard isOpen={false} onClose={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders modal dialog with default booking details when isOpen is true', () => {
    render(<FlightClearancePasscard isOpen={true} onClose={jest.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'clearance-passcard-title');

    expect(screen.getByText('Flight Clearance Passcard')).toBeInTheDocument();
    expect(screen.getByText('TACTICAL CLEARANCE PASS')).toBeInTheDocument();
    expect(screen.getByText('VANGUARD-1')).toBeInTheDocument();
    expect(screen.getByText('DSK-ALPHA-09')).toBeInTheDocument();
    expect(screen.getByText('Chetna Gehlot')).toBeInTheDocument();
    expect(screen.getByText('GL-8940-SEC4')).toBeInTheDocument();
    expect(screen.getByText('2026-10-15')).toBeInTheDocument();

    const closeButton = screen.getByTestId('flight-clearance-close-button');
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('aria-label', 'Close clearance passcard');
  });

  it('renders custom booking details properly', () => {
    const customDetails = {
      callsign: 'PHOENIX-07',
      deskTailNumber: 'DSK-BETA-42',
      sectorCoordinates: '40°42\'46"N 74°00\'21"W',
      pilotName: 'Astraea Vance',
      clearanceCode: 'AV-9912-ORB',
      date: '2026-11-01',
    };

    render(
      <FlightClearancePasscard
        isOpen={true}
        onClose={jest.fn()}
        bookingDetails={customDetails}
      />
    );

    expect(screen.getByText('PHOENIX-07')).toBeInTheDocument();
    expect(screen.getByText('DSK-BETA-42')).toBeInTheDocument();
    expect(screen.getByText('Astraea Vance')).toBeInTheDocument();
    expect(screen.getByText('AV-9912-ORB')).toBeInTheDocument();
    expect(screen.getByText('40°42\'46"N 74°00\'21"W')).toBeInTheDocument();
    expect(screen.getByText('2026-11-01')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = jest.fn();
    render(<FlightClearancePasscard isOpen={true} onClose={handleClose} />);

    fireEvent.click(screen.getByTestId('flight-clearance-close-button'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = jest.fn();
    render(<FlightClearancePasscard isOpen={true} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside modal on the backdrop', () => {
    const handleClose = jest.fn();
    render(<FlightClearancePasscard isOpen={true} onClose={handleClose} />);

    const backdrop = screen.getByRole('dialog');
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the modal dialog container', () => {
    const handleClose = jest.fn();
    render(<FlightClearancePasscard isOpen={true} onClose={handleClose} />);

    const cardContent = screen.getByTestId('flight-clearance-card-content');
    fireEvent.click(cardContent);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('handles Export PNG button click and triggers onExportPng callback', async () => {
    const handleExport = jest.fn();

    render(
      <FlightClearancePasscard
        isOpen={true}
        onClose={jest.fn()}
        onExportPng={handleExport}
      />
    );

    const exportBtn = screen.getByTestId('export-png-button');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockToPng).toHaveBeenCalled();
      expect(handleExport).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  it('handles Print Pass button click and triggers onPrint callback', () => {
    const handlePrint = jest.fn();
    render(
      <FlightClearancePasscard
        isOpen={true}
        onClose={jest.fn()}
        onPrint={handlePrint}
      />
    );

    const printBtn = screen.getByTestId('print-pass-button');
    fireEvent.click(printBtn);

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(handlePrint).toHaveBeenCalledTimes(1);
  });

  it('sanitizes clearance code and respects custom className and testId', () => {
    render(
      <FlightClearancePasscard
        isOpen={true}
        onClose={jest.fn()}
        className="custom-passcard-class"
        testId="custom-passcard"
        bookingDetails={{
          clearanceCode: 'CODE/WITH SPECIAL#CHARS',
        }}
      />
    );

    const dialog = screen.getByTestId('custom-passcard');
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain('custom-passcard-class');
    expect(screen.getByText('CODE/WITH SPECIAL#CHARS')).toBeInTheDocument();

    const qrMock = screen.getByTestId('mock-qrcode');
    expect(qrMock).toHaveAttribute(
      'data-value',
      'https://workspace.sector.command/verify?code=CODE%2FWITH%20SPECIAL%23CHARS'
    );
  });
});

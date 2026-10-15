import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toPng } from 'html-to-image';
import { Download, Printer, Shield, Plane } from 'lucide-react';

interface FlightClearancePasscardProps {
  isOpen: boolean;
  onClose: () => void;
  bookingDetails?: {
    callsign?: string;
    deskTailNumber?: string;
    sectorCoordinates?: string;
    pilotName?: string;
    clearanceCode?: string;
    date?: string;
  };
}

export const FlightClearancePasscard: React.FC<FlightClearancePasscardProps> = ({
  isOpen,
  onClose,
  bookingDetails = {
    callsign: 'VANGUARD-1',
    deskTailNumber: 'DSK-ALPHA-09',
    sectorCoordinates: '34°05\'22"N 118°14\'23"W',
    pilotName: 'Chetna Gehlot',
    clearanceCode: 'GL-8940-SEC4',
    date: '2026-10-15',
  },
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleDownloadPng = async () => {
    if (cardRef.current === null) return;
    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true });
      const link = document.createElement('a');
      link.download = `Flight_Clearance_${bookingDetails.clearanceCode}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export PNG:', err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      {/* Container Modal */}
      <div className="relative w-full max-w-lg bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl text-slate-100 font-mono">
        {/* Header Controls */}
        <div className="flex justify-between items-center mb-4 border-b border-emerald-500/20 pb-3">
          <div className="flex items-center gap-2 text-emerald-400 font-bold tracking-widest text-sm uppercase">
            <Shield className="w-5 h-5 animate-pulse" />
            <span>Flight Clearance Passcard</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-xl font-bold px-2"
          >

          </button>
        </div>

        {/* Holographic Clearance Passcard Area */}
        <div
          ref={cardRef}
          className="relative overflow-hidden rounded-xl border-2 border-emerald-500/50 p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-[0_0_25px_rgba(16,185,129,0.25)]"
        >
          {/* Animated Holographic Foil Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-teal-400/15 to-transparent opacity-70 pointer-events-none animate-pulse" />
          <div className="absolute -inset-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-400/20 via-transparent to-transparent blur-2xl pointer-events-none transform -rotate-12" />

          {/* Holographic Green Lantern Crest Watermark */}
          <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
            <svg
              className="w-64 h-64 text-emerald-400 animate-spin"
              style={{ animationDuration: '25s' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="6" x2="22" y2="6" />
              <line x1="2" y1="18" x2="22" y2="18" />
              <circle cx="12" cy="12" r="4" fill="currentColor" />
            </svg>
          </div>

          {/* Pass Header */}
          <div className="relative z-10 flex justify-between items-start border-b border-emerald-500/30 pb-3 mb-4">
            <div>
              <p className="text-[10px] text-emerald-400/80 uppercase tracking-widest">
                UNITED SECTOR COMMAND
              </p>
              <h3 className="text-lg font-extrabold tracking-wider text-emerald-300 flex items-center gap-2">
                <Plane className="w-5 h-5 text-emerald-400" />
                TACTICAL CLEARANCE PASS
              </h3>
            </div>
            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold px-2 py-1 rounded tracking-wider uppercase">
              CLEARED
            </span>
          </div>

          {/* Pass Main Grid Info */}
          <div className="relative z-10 grid grid-cols-2 gap-4 mb-4 text-xs">
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider">Pilot Callsign</p>
              <p className="text-emerald-300 font-bold text-sm tracking-wide">
                {bookingDetails.callsign}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider">Desk / Tail No.</p>
              <p className="text-emerald-300 font-bold text-sm tracking-wide">
                {bookingDetails.deskTailNumber}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider">Pilot Name</p>
              <p className="text-slate-200 font-semibold">{bookingDetails.pilotName}</p>
            </div>
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider">Clearance Code</p>
              <p className="text-slate-200 font-semibold">{bookingDetails.clearanceCode}</p>
            </div>
            <div className="col-span-2">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider">Sector Coordinates</p>
              <p className="text-slate-300 font-mono text-[11px]">
                {bookingDetails.sectorCoordinates}
              </p>
            </div>
          </div>

          {/* QR Code & Verification Section */}
          <div className="relative z-10 flex items-center justify-between pt-3 border-t border-emerald-500/30">
            <div className="bg-white p-2 rounded-lg shadow-inner">
              <QRCodeSVG
                value={`https://workspace.sector.command/verify?code=${bookingDetails.clearanceCode}`}
                size={70}
                bgColor="#FFFFFF"
                fgColor="#022c22"
                level="H"
              />
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-400">ISSUED ON</p>
              <p className="text-xs text-emerald-400 font-bold">{bookingDetails.date}</p>
              <p className="text-[9px] text-emerald-500/70 mt-1 uppercase">Apple Wallet Ready</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap sm:flex-nowrap gap-3">
          <button
            onClick={handleDownloadPng}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-2 px-4 rounded-lg transition-all text-sm shadow-lg shadow-emerald-900/30"
          >
            <Download className="w-4 h-4" /> Export PNG
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-bold py-2 px-4 rounded-lg transition-all text-sm"
          >
            <Printer className="w-4 h-4" /> Print Pass
          </button>
        </div>
      </div>
    </div>
  );
};

export default FlightClearancePasscard;

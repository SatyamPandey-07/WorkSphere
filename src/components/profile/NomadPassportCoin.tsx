import React, { useState } from 'react';

interface NomadPassportCoinProps {
  passportId: string;
  nomadName: string;
  countryCode: string;
  stampsCount: number;
  isVerified?: boolean;
}

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  passportId,
  nomadName,
  countryCode,
  stampsCount,
  isVerified = true,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [stampRevealed, setStampRevealed] = useState(false);

  const triggerHaptic = (pattern: number | number[]) => {
    if (typeof window !== 'undefined' && 'navigator' in window && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  };

  const handleCardClick = () => {
    triggerHaptic(15);
    setIsFlipped((prev) => !prev);
  };

  const handleStampClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic([10, 30, 10]);
    setStampRevealed((prev) => !prev);
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div
        onClick={handleCardClick}
        className={elative w-72 h-44 rounded-2xl cursor-pointer transition-transform duration-500 transform-gpu shadow-xl }
        style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
      >
        <div
          className={bsolute inset-0 w-full h-full rounded-2xl p-5 flex flex-col justify-between bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white shadow-lg backface-hidden }
        >
          <div className="flex justify-between items-center">
            <span className="text-xs uppercase tracking-widest font-semibold opacity-80">Digital Nomad Passport</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-xs font-mono">{countryCode}</span>
          </div>
          <div>
            <h3 className="text-lg font-bold truncate">{nomadName}</h3>
            <p className="text-xs font-mono opacity-90">{passportId}</p>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-xs bg-black/20 px-2.5 py-1 rounded-full">{stampsCount} stamps verified</span>
            <span className={	ext-xs px-2 py-0.5 rounded }>
              {isVerified ? 'Active' : 'Pending'}
            </span>
          </div>
        </div>

        <div
          onClick={handleStampClick}
          className={bsolute inset-0 w-full h-full rounded-2xl p-5 flex flex-col justify-between bg-slate-900 border border-purple-500/40 text-white shadow-lg rotate-y-180 backface-hidden }
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-indigo-400">SECURE HASH VERIFICATION</span>
            <span className="text-xs text-slate-400">Tap stamp</span>
          </div>
          <div className="flex flex-col items-center justify-center my-auto">
            <div
              className={px-4 py-2 rounded-lg border text-sm font-bold transition-colors duration-300 }
            >
              {stampRevealed ? '? Stamp Authenticated' : 'Click to Verify Stamp'}
            </div>
          </div>
          <div className="text-center text-[10px] text-slate-500 font-mono">WorkSphere Decentralized Protocol</div>
        </div>
      </div>
    </div>
  );
};

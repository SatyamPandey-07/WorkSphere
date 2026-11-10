import React, { useState } from 'react';

// Simple translation lookup helper with fallback
interface LanternRingBiometricUnlockProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  currentLocale?: 'en' | 'hi' | 'de' | 'pt';
}

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    biometricTitle: 'Lantern Ring Biometric Unlock',
    biometricSubtitle: 'Securely authenticate using your passkey or biometric scan',
    promptBiometric: 'Place your finger on the biometric scanner',
    cancel: 'Cancel',
    success: 'Authentication Successful',
    error: 'Authentication failed. Please try again.',
  },
  hi: {
    biometricTitle: 'lantern ring बायोमेट्रिक अनलॉक',
    biometricSubtitle: 'पासकी या biometric पहचान के साथ सुरक्षित रूप से प्रमाणित करें',
    promptBiometric: 'biometric स्कैनर पर उंगली रखें',
    cancel: 'रद्द करें',
    success: 'प्रमाणन सफल रहा',
    error: 'प्रमाणन विफल रहा। कृपया पुनः प्रयास करें।',
  },
  de: {
    biometricTitle: 'Lantern Ring Biometrische Entsperrung',
    biometricSubtitle: 'Sicher authentifizieren mit Passkey oder biometrischer Erkennung',
    promptBiometric: 'Legen Sie Ihren Finger auf den Biometrie-Scanner',
    cancel: 'Abbrechen',
    success: 'Authentifizierung erfolgreich',
    error: 'Authentifizierung fehlgeschlagen. Bitte versuchen Sie es erneut.',
  },
  pt: {
    biometricTitle: 'Desbloqueio Biométrico Lantern Ring',
    biometricSubtitle: 'Autentique com segurança usando passkey ou reconhecimento biométrico',
    promptBiometric: 'Coloque o dedo no leitor biométrico',
    cancel: 'Cancelar',
    success: 'Autenticação bem-sucedida',
    error: 'Falha na autenticação. Tente novamente.',
  },
};

export const LanternRingBiometricUnlock: React.FC<LanternRingBiometricUnlockProps> = ({
  onSuccess,
  onCancel,
  currentLocale = 'en',
}) => {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  
  const dict = TRANSLATIONS[currentLocale] || TRANSLATIONS['en'];

  const handleStartScan = async () => {
    setStatus('scanning');
    try {
      // Simulate WebAuthn navigator.credentials.get() biometric prompt
      if (window.PublicKeyCredential) {
        // Mock authentication delay
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setStatus('success');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Biometric authentication error:', err);
      setStatus('error');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white shadow-2xl max-w-md mx-auto text-center space-y-6 relative overflow-hidden">
      <div className="space-y-2">
        <h2 className="text-lg font-bold text-slate-100">{dict.biometricTitle}</h2>
        <p className="text-xs text-slate-400 leading-relaxed">{dict.biometricSubtitle}</p>
      </div>

      <div className="flex flex-col items-center justify-center py-6">
        <button
          onClick={handleStartScan}
          disabled={status === 'scanning'}
          className={`w-24 h-24 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer shadow-lg ${
            status === 'scanning'
              ? 'border-amber-500 bg-amber-500/10 animate-pulse text-amber-400'
              : status === 'success'
              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
              : status === 'error'
              ? 'border-rose-500 bg-rose-500/20 text-rose-400'
              : 'border-emerald-500/50 bg-slate-800 hover:bg-slate-700 text-emerald-400'
          }`}
          aria-label={dict.promptBiometric}
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 7.5 16.5" />
            <path d="M12 6a6 6 0 0 1 4.5 9.9" />
            <path d="M12 10a2 2 0 0 1 1.5 3.3" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
        </button>
        <span className="text-xs text-slate-400 font-medium mt-4">
          {status === 'scanning' && dict.promptBiometric}
          {status === 'success' && dict.success}
          {status === 'error' && dict.error}
          {status === 'idle' && 'Tap sensor to begin'}
        </span>
      </div>

      <div className="flex justify-center gap-3 pt-4 border-t border-slate-800">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition cursor-pointer"
        >
          {dict.cancel}
        </button>
      </div>
    </div>
  );
};

export default LanternRingBiometricUnlock;
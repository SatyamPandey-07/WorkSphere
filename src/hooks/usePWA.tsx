"use client";

import { useEffect, useState } from "react";
import { X, Download, Sparkles } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Hook to register service worker and manage PWA state
 */
export function useServiceWorker() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    setIsInstalled(window.matchMedia('(display-mode: standalone)').matches);
    setIsOnline(navigator.onLine);

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service worker registered');
          setRegistration(reg);
        })
        .catch((err) => {
          console.error('[PWA] Service worker registration failed:', err);
        });
    }

    // Online/offline detection
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isInstalled, isOnline, registration };
}

/**
 * Hook for PWA install prompt
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Detect iOS Safari environment
    const detectIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      const isIPad = userAgent.includes('ipad') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isIPhone = userAgent.includes('iphone') || userAgent.includes('ipod');
      const isIOSDevice = isIPad || isIPhone;
      
      // Safari detection (other iOS browsers have "crios", "fxios" etc.)
      const isSafari = userAgent.includes('safari') && !userAgent.includes('crios') && !userAgent.includes('fxios') && !userAgent.includes('opios');
      
      // Check if already in standalone mode
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      
      return isIOSDevice && isSafari && !isStandalone;
    };

    if (typeof window !== 'undefined') {
      const ios = detectIOS();
      setIsIOS(ios);
      if (ios) {
        setCanInstall(true);
      }
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const install = async () => {
    if (isIOS) {
      return 'ios';
    }

    if (!deferredPrompt) return false;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    setDeferredPrompt(null);
    setCanInstall(false);
    
    return outcome === 'accepted';
  };

  return { canInstall, isIOS, install };
}

/**
 * Offline indicator component
 */
export function OfflineIndicator() {
  const { isOnline } = useServiceWorker();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-auto z-50">
      <div className="bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
          />
        </svg>
        <span className="text-sm font-medium">You&apos;re offline</span>
      </div>
    </div>
  );
}

/**
 * Install app button component
 */
export function InstallAppButton() {
  const { canInstall, install } = useInstallPrompt();
  const [showIOSOverlay, setShowIOSOverlay] = useState(false);

  if (!canInstall) return null;

  const handleInstallClick = async () => {
    const res = await install();
    if (res === 'ios') {
      setShowIOSOverlay(true);
    }
  };

  return (
    <>
      <button
        onClick={handleInstallClick}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span>Install App</span>
      </button>

      {showIOSOverlay && <IOSInstallOverlay onClose={() => setShowIOSOverlay(false)} />}
    </>
  );
}

/**
 * iOS Safari PWA Installation overlay/guidance modal
 */
export function IOSInstallOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[11000] flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl max-w-sm w-full animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 animate-pulse">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white">Install WorkSphere</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 font-medium">
          Add WorkSphere to your home screen for quick, fullscreen app access and offline-enabled workspace discovery.
        </p>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-300">
              1
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Tap the Share button
              </p>
              <p className="text-[10px] text-zinc-505 mt-0.5 flex items-center gap-1.5">
                Look for 
                <span className="inline-flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                  <svg className="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>
                in Safari's navigation bar.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-300">
              2
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Select 'Add to Home Screen'
              </p>
              <p className="text-[10px] text-zinc-505 mt-0.5 flex items-center gap-1.5">
                Scroll down and select
                <span className="inline-flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                  <svg className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </span>
                from the share menu options.
              </p>
            </div>
          </div>
        </div>

        <button 
          onClick={onClose} 
          className="w-full mt-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-blue-500/25"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * Premium PWA Install Banner Component
 */
export function PWABanner() {
  const { canInstall, install } = useInstallPrompt();
  const { isOnline } = useServiceWorker();
  const [showIOSOverlay, setShowIOSOverlay] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true); // Default to true until checked in client side

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = localStorage.getItem("pwa-banner-dismissed") === "true";
      setIsDismissed(dismissed);
    }
  }, []);

  if (!canInstall || isDismissed || !isOnline) return null;

  const handleInstallClick = async () => {
    const res = await install();
    if (res === 'ios') {
      setShowIOSOverlay(true);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-banner-dismissed", "true");
    setIsDismissed(true);
  };

  return (
    <>
      <div className="fixed bottom-20 left-4 right-4 md:bottom-6 md:right-6 md:left-auto md:w-96 z-50 animate-in slide-in-from-bottom duration-300">
        <div className="relative overflow-hidden bg-zinc-900/90 dark:bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl text-white">
          {/* Subtle colored background glow */}
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-blue-500/10 rounded-full blur-xl pointer-events-none" />
          
          <button 
            onClick={handleDismiss}
            className="absolute top-3 right-3 p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white">
              <Download className="w-4 h-4" />
            </div>
            <div className="flex-1 pr-4">
              <h4 className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                Install WorkSphere
                <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              </h4>
              <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed font-medium">
                Install as a lightweight app for faster load times, seamless offline searches, and native feel.
              </p>
              
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleInstallClick}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all shadow-md shadow-blue-500/20"
                >
                  Install Now
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-wider rounded-lg border border-white/10 transition-all"
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showIOSOverlay && <IOSInstallOverlay onClose={() => setShowIOSOverlay(false)} />}
    </>
  );
}

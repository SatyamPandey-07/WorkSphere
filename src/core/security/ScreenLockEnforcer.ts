/**
 * ScreenLockEnforcer
 * Interfaces with the browser's Screen Wake Lock API and local OS hooks to trigger 
 * immediate screen obscuration upon tether breach.
 */

export class ScreenLockEnforcer {
    private wakeLock: WakeLockSentinel | null = null;
    private overlayElement: HTMLDivElement | null = null;
    private isLocked: boolean = false;

    constructor() {
        this.createOverlay();
        this.setupVisibilityListeners();
    }

    private createOverlay(): void {
        if (typeof document === 'undefined') return;

        this.overlayElement = document.createElement('div');
        this.overlayElement.id = 'tether-lock-overlay';
        this.overlayElement.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: #000000;
      z-index: 999999;
      display: none;
      justify-content: center;
      align-items: center;
      color: #ffffff;
      font-family: system-ui, sans-serif;
      font-size: 24px;
      flex-direction: column;
    `;
        this.overlayElement.innerHTML = `
      <div style="text-align: center;">
        <h2>🔒 Device Tether Breached</h2>
        <p>Your authenticated device moved out of range.</p>
        <p style="font-size: 16px; opacity: 0.7;">Bring your phone closer to unlock.</p>
      </div>
    `;
        document.body.appendChild(this.overlayElement);
    }

    private setupVisibilityListeners(): void {
        if (typeof document === 'undefined') return;

        // If the user tries to switch tabs while locked, we ensure the lock persists
        document.addEventListener('visibilitychange', () => {
            if (this.isLocked && document.visibilityState === 'visible') {
                this.reassertLock();
            }
        });
    }

    public async engageLock(): Promise<void> {
        if (this.isLocked) return;
        this.isLocked = true;

        if (this.overlayElement) {
            this.overlayElement.style.display = 'flex';
        }

        // Attempt to keep the screen awake so the lock message is visible
        await this.requestWakeLock();

        // Blur the main content for extra security
        if (typeof document !== 'undefined') {
            document.body.style.filter = 'blur(20px)';
            document.body.style.pointerEvents = 'none';
        }
    }

    public disengageLock(): void {
        if (!this.isLocked) return;
        this.isLocked = false;

        if (this.overlayElement) {
            this.overlayElement.style.display = 'none';
        }

        if (typeof document !== 'undefined') {
            document.body.style.filter = 'none';
            document.body.style.pointerEvents = 'auto';
        }

        this.releaseWakeLock();
    }

    private async requestWakeLock(): Promise<void> {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => {
                    console.log('Screen Wake Lock was released');
                });
            } catch (err) {
                console.error('Failed to acquire Wake Lock:', err);
            }
        }
    }

    private releaseWakeLock(): void {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    private reassertLock(): void {
        if (this.isLocked) {
            this.engageLock();
        }
    }

    public getStatus(): boolean {
        return this.isLocked;
    }
}

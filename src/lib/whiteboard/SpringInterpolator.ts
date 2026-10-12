/**
 * SpringInterpolator.ts
 * Implements spring physics-based interpolation for smooth 2D cursor movement,
 * eliminating robotic, discrete jumps during remote collaborative sessions.
 */

export interface CursorState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    targetX: number;
    targetY: number;
    isVisible: boolean;
    lastUpdate: number;
}

export class SpringInterpolator {
    private state: CursorState;
    private tension: number;
    private friction: number;
    private idleTimeout: number;
    private animationFrame: number | null;

    constructor(
        initialX: number,
        initialY: number,
        tension: number = 150,
        friction: number = 15,
        idleTimeoutMs: number = 5000
    ) {
        this.state = {
            x: initialX,
            y: initialY,
            vx: 0,
            vy: 0,
            targetX: initialX,
            targetY: initialY,
            isVisible: true,
            lastUpdate: Date.now(),
        };
        this.tension = tension;
        this.friction = friction;
        this.idleTimeout = idleTimeoutMs;
        this.animationFrame = null;
    }

    public setTarget(x: number, y: number): void {
        this.state.targetX = x;
        this.state.targetY = y;
        this.state.isVisible = true;
        this.state.lastUpdate = Date.now();

        if (!this.animationFrame) {
            this.startAnimation();
        }
    }

    public hide(): void {
        this.state.isVisible = false;
    }

    public getCurrentState(): CursorState {
        return { ...this.state };
    }

    private startAnimation(): void {
        const animate = () => {
            const now = Date.now();
            const dt = 1 / 60; // Assume 60fps for consistent physics

            // Check for idle timeout
            if (now - this.state.lastUpdate > this.idleTimeout) {
                this.state.isVisible = false;
            }

            // Spring physics calculation
            const dx = this.state.targetX - this.state.x;
            const dy = this.state.targetY - this.state.y;

            const ax = (dx * this.tension - this.state.vx * this.friction) * dt;
            const ay = (dy * this.tension - this.state.vy * this.friction) * dt;

            this.state.vx += ax;
            this.state.vy += ay;
            this.state.x += this.state.vx * dt;
            this.state.y += this.state.vy * dt;

            // Stop animation if close enough to target and not updating
            const distance = Math.sqrt(dx * dx + dy * dy);
            const speed = Math.sqrt(this.state.vx * this.state.vx + this.state.vy * this.state.vy);

            if (distance < 0.5 && speed < 0.5 && now - this.state.lastUpdate > 100) {
                this.state.x = this.state.targetX;
                this.state.y = this.state.targetY;
                this.state.vx = 0;
                this.state.vy = 0;
                this.animationFrame = null;
                return;
            }

            this.animationFrame = requestAnimationFrame(animate);
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    public destroy(): void {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
}

/**
 * PhysicsSimulationEngine.ts
 * Runs lightweight particle simulations to predict crowd flow and bottleneck 
 * formation based on real-time occupancy data from the Digital Twin.
 */

export interface Vector2D {
    x: number;
    y: number;
}

export interface Particle {
    id: string;
    position: Vector2D;
    velocity: Vector2D;
    target: Vector2D;
    radius: number;
}

export interface BottleneckAlert {
    zoneId: string;
    severity: 'low' | 'medium' | 'high';
    density: number;
    coordinates: Vector2D;
    timestamp: number;
}

export class PhysicsSimulationEngine {
    private particles: Map<string, Particle> = new Map();
    private readonly MAX_SPEED = 1.5; // meters per second
    private readonly REPULSION_FORCE = 0.5;
    private readonly ZONE_WIDTH = 50;
    private readonly ZONE_HEIGHT = 50;

    constructor() { }

    public addAgent(id: string, startPos: Vector2D, targetPos: Vector2D): void {
        this.particles.set(id, {
            id,
            position: { ...startPos },
            velocity: { x: 0, y: 0 },
            target: { ...targetPos },
            radius: 0.5
        });
    }

    public removeAgent(id: string): void {
        this.particles.delete(id);
    }

    /**
     * Steps the simulation forward by `dt` seconds.
     * Applies social force models (attraction to target, repulsion from others).
     */
    public step(dt: number): void {
        const agents = Array.from(this.particles.values());

        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];

            // 1. Attraction force towards target
            const dx = agent.target.x - agent.position.x;
            const dy = agent.target.y - agent.position.y;
            const distToTarget = Math.sqrt(dx * dx + dy * dy);

            if (distToTarget < 0.5) {
                agent.velocity = { x: 0, y: 0 };
                continue; // Reached destination
            }

            let forceX = (dx / distToTarget) * 1.0;
            let forceY = (dy / distToTarget) * 1.0;

            // 2. Repulsion force from other agents
            for (let j = 0; j < agents.length; j++) {
                if (i === j) continue;
                const other = agents[j];

                const rx = agent.position.x - other.position.x;
                const ry = agent.position.y - other.position.y;
                const dist = Math.sqrt(rx * rx + ry * ry);

                if (dist < 2.0 && dist > 0) {
                    const repulsion = this.REPULSION_FORCE / (dist * dist);
                    forceX += (rx / dist) * repulsion;
                    forceY += (ry / dist) * repulsion;
                }
            }

            // Update velocity
            agent.velocity.x += forceX * dt;
            agent.velocity.y += forceY * dt;

            // Clamp speed
            const speed = Math.sqrt(agent.velocity.x ** 2 + agent.velocity.y ** 2);
            if (speed > this.MAX_SPEED) {
                agent.velocity.x = (agent.velocity.x / speed) * this.MAX_SPEED;
                agent.velocity.y = (agent.velocity.y / speed) * this.MAX_SPEED;
            }

            // Update position
            agent.position.x += agent.velocity.x * dt;
            agent.position.y += agent.velocity.y * dt;

            // Boundary constraints
            agent.position.x = Math.max(0, Math.min(this.ZONE_WIDTH, agent.position.x));
            agent.position.y = Math.max(0, Math.min(this.ZONE_HEIGHT, agent.position.y));
        }
    }

    /**
     * Analyzes the current particle distribution to detect crowding/bottlenecks.
     */
    public detectBottlenecks(): BottleneckAlert[] {
        const alerts: BottleneckAlert[] = [];
        const gridSize = 5; // 5x5 meter grid cells
        const grid: number[][] = Array(this.ZONE_WIDTH / gridSize).fill(null)
            .map(() => Array(this.ZONE_HEIGHT / gridSize).fill(0));

        this.particles.forEach(p => {
            const gx = Math.floor(p.position.x / gridSize);
            const gy = Math.floor(p.position.y / gridSize);
            if (gx >= 0 && gx < grid.length && gy >= 0 && gy < grid[0].length) {
                grid[gx][gy]++;
            }
        });

        for (let x = 0; x < grid.length; x++) {
            for (let y = 0; y < grid[0].length; y++) {
                const density = grid[x][y];
                if (density >= 4) {
                    alerts.push({
                        zoneId: `grid_${x}_${y}`,
                        severity: density >= 8 ? 'high' : density >= 6 ? 'medium' : 'low',
                        density,
                        coordinates: { x: x * gridSize + gridSize / 2, y: y * gridSize + gridSize / 2 },
                        timestamp: Date.now()
                    });
                }
            }
        }

        return alerts;
    }
}

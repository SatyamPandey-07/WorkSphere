/**
 * WarRoomTrigger.ts
 * Monitors Git webhooks and local repository states to detect massive, 
 * multi-file merge conflicts requiring physical collaboration.
 */

export interface GitConflict {
    filePath: string;
    conflictMarkers: number;
    linesAffected: number;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface MergeEvent {
    repository: string;
    branch: string;
    targetBranch: string;
    author: string;
    conflicts: GitConflict[];
    timestamp: number;
}

export interface WarRoomCriteria {
    minFilesAffected: number;
    minTotalLines: number;
    criticalFilePatterns: string[]; // e.g., ['src/core/auth/*', 'prisma/schema.prisma']
}

export class WarRoomTrigger {
    private criteria: WarRoomCriteria;
    private activeWarRooms: Map<string, MergeEvent> = new Map();

    constructor(criteria: WarRoomCriteria) {
        this.criteria = criteria;
    }

    public evaluateMergeEvent(event: MergeEvent): { trigger: boolean; reason: string; roomId: string } {
        const totalFiles = event.conflicts.length;
        const totalLines = event.conflicts.reduce((sum, c) => sum + c.linesAffected, 0);

        let criticalHits = 0;
        for (const conflict of event.conflicts) {
            for (const pattern of this.criteria.criticalFilePatterns) {
                if (this.matchPattern(conflict.filePath, pattern)) {
                    criticalHits++;
                    conflict.severity = 'CRITICAL';
                }
            }
        }

        // Determine if War Room should be triggered
        const trigger = (
            totalFiles >= this.criteria.minFilesAffected ||
            totalLines >= this.criteria.minTotalLines ||
            criticalHits > 0
        );

        if (trigger) {
            const roomId = `warroom-${event.repository}-${Date.now()}`;
            this.activeWarRooms.set(roomId, event);

            let reason = `Conflict detected: ${totalFiles} files, ${totalLines} lines.`;
            if (criticalHits > 0) {
                reason += ` ${criticalHits} critical infrastructure files affected.`;
            }

            return { trigger: true, reason, roomId };
        }

        return { trigger: false, reason: 'Conflict below war-room threshold.', roomId: '' };
    }

    private matchPattern(filePath: string, pattern: string): boolean {
        // Simple glob matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        return regex.test(filePath);
    }

    public resolveWarRoom(roomId: string): boolean {
        if (this.activeWarRooms.has(roomId)) {
            this.activeWarRooms.delete(roomId);
            return true;
        }
        return false;
    }

    public getActiveWarRooms(): MergeEvent[] {
        return Array.from(this.activeWarRooms.values());
    }
}

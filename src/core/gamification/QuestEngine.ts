/**
 * QuestEngine.ts
 * Evaluates user telemetry and booking history against predefined quest parameters to trigger completions.
 * Tracks progress toward "Digital Nomad" achievements in a deterministic, replayable manner.
 */

export type QuestType = 'VENUE_COUNT' | 'WIFI_VERIFICATIONS' | 'STREAK_DAYS' | 'COMMUNITY_REVIEWS';

export interface QuestDefinition {
    id: string;
    type: QuestType;
    title: string;
    description: string;
    targetValue: number;
    rewardBadgeId: string;
}

export interface UserQuestProgress {
    questId: string;
    currentValue: number;
    isCompleted: boolean;
    lastUpdated: number;
}

export class QuestEngine {
    private quests: Map<string, QuestDefinition>;
    private progress: Map<string, UserQuestProgress>;

    constructor() {
        this.quests = new Map();
        this.progress = new Map();
        this.initializeDefaultQuests();
    }

    private initializeDefaultQuests(): void {
        this.quests.set('quest-1', {
            id: 'quest-1',
            type: 'VENUE_COUNT',
            title: 'Global Explorer',
            description: 'Work from 3 different libraries or cafes this week.',
            targetValue: 3,
            rewardBadgeId: 'badge-explorer'
        });

        this.quests.set('quest-2', {
            id: 'quest-2',
            type: 'WIFI_VERIFICATIONS',
            title: 'Network Guardian',
            description: 'Verify WiFi speeds at 5 different venues.',
            targetValue: 5,
            rewardBadgeId: 'badge-guardian'
        });
    }

    public recordTelemetry(userId: string, questId: string, increment: number = 1): UserQuestProgress {
        let progress = this.progress.get(questId);

        if (!progress) {
            progress = {
                questId,
                currentValue: 0,
                isCompleted: false,
                lastUpdated: Date.now()
            };
        }

        if (!progress.isCompleted) {
            progress.currentValue += increment;
            progress.lastUpdated = Date.now();

            const quest = this.quests.get(questId);
            if (quest && progress.currentValue >= quest.targetValue) {
                progress.isCompleted = true;
            }
        }

        this.progress.set(questId, progress);
        return progress;
    }

    public getActiveQuests(): QuestDefinition[] {
        return Array.from(this.quests.values());
    }

    public getUserProgress(): UserQuestProgress[] {
        return Array.from(this.progress.values());
    }

    public getCompletedQuests(): string[] {
        return Array.from(this.progress.values())
            .filter(p => p.isCompleted)
            .map(p => p.questId);
    }
}

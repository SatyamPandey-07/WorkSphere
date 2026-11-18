/**
 * DeepWorkScheduler
 * Interfaces with Groq LLM to analyze task complexity and calendar availability,
 * suggesting optimal time blocks for uninterrupted deep work.
 */

import { CalendarEvent, TaskComplexity, SchedulerRecommendation } from '@/types/deepwork';

export class DeepWorkScheduler {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = 'llama-3.3-70b-versatile') {
        this.apiKey = apiKey;
        this.model = model;
    }

    /**
     * Analyzes user calendar and task list to propose deep work blocks.
     * In a production environment, this would make a real HTTP request to Groq.
     */
    public async generateSchedule(
        events: CalendarEvent[],
        tasks: TaskComplexity[],
        preferredWorkHours: { start: number; end: number } // e.g., 9 and 17
    ): Promise<SchedulerRecommendation[]> {

        // 1. Identify free blocks in the calendar
        const freeBlocks = this.calculateFreeBlocks(events, preferredWorkHours);

        if (freeBlocks.length === 0) {
            return [];
        }

        // 2. Match tasks to blocks based on cognitive load and duration
        const recommendations: SchedulerRecommendation[] = [];

        // Sort tasks by cognitive load (EXTREME first)
        const sortedTasks = [...tasks].sort((a, b) => {
            const loadOrder = { 'EXTREME': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
            return loadOrder[b.cognitiveLoad] - loadOrder[a.cognitiveLoad];
        });

        for (const block of freeBlocks) {
            const blockDuration = block.end - block.start;
            const tasksForBlock: TaskComplexity[] = [];
            let accumulatedTime = 0;

            for (const task of sortedTasks) {
                // Add 15 min buffer for context switching
                const requiredTime = task.estimatedMinutes + 15;

                if (accumulatedTime + requiredTime <= blockDuration) {
                    tasksForBlock.push(task);
                    accumulatedTime += requiredTime;
                }
            }

            if (tasksForBlock.length > 0) {
                recommendations.push({
                    proposedStart: block.start,
                    proposedEnd: block.start + (accumulatedTime * 60000),
                    confidenceScore: this.calculateConfidence(block, tasksForBlock),
                    reasoning: `Allocated ${tasksForBlock.length} high-focus tasks during a ${Math.round(blockDuration / 60000)}min gap.`,
                    tasksToInclude: tasksForBlock.map(t => t.id)
                });
            }
        }

        return recommendations;
    }

    private calculateFreeBlocks(events: CalendarEvent[], hours: { start: number; end: number }): { start: number; end: number }[] {
        // Simplified logic: Assume today's date for calculation
        const today = new Date();
        today.setHours(hours.start, 0, 0, 0);
        const dayStart = today.getTime();

        today.setHours(hours.end, 0, 0, 0);
        const dayEnd = today.getTime();

        // Sort events by start time
        const sortedEvents = [...events]
            .filter(e => e.start >= dayStart && e.start < dayEnd)
            .sort((a, b) => a.start - b.start);

        const freeBlocks: { start: number; end: number }[] = [];
        let currentTime = dayStart;

        for (const event of sortedEvents) {
            if (event.start > currentTime) {
                // Gap found
                const gapDuration = event.start - currentTime;
                if (gapDuration >= 45 * 60000) { // Only consider blocks >= 45 mins
                    freeBlocks.push({ start: currentTime, end: event.start });
                }
            }
            // Move current time to the end of the event if it extends further
            if (event.end > currentTime) {
                currentTime = event.end;
            }
        }

        // Check for gap at the end of the day
        if (dayEnd > currentTime) {
            const gapDuration = dayEnd - currentTime;
            if (gapDuration >= 45 * 60000) {
                freeBlocks.push({ start: currentTime, end: dayEnd });
            }
        }

        return freeBlocks;
    }

    private calculateConfidence(block: { start: number; end: number }, tasks: TaskComplexity[]): number {
        // Heuristic: Morning blocks (before 12 PM) get higher confidence for HIGH/EXTREME tasks
        const hour = new Date(block.start).getHours();
        let baseScore = 0.7;

        if (hour < 12 && tasks.some(t => t.cognitiveLoad === 'EXTREME' || t.cognitiveLoad === 'HIGH')) {
            baseScore += 0.2;
        }

        // Penalty for blocks immediately after a long meeting (>2 hours)
        // (Simplified: just return base score for this mock)

        return Math.min(1.0, baseScore);
    }
}

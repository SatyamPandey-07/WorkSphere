import {
    ActionItemSynthesizer,
    TranscriptInput,
    TranscriptTurn
} from '../../core/agents/ActionItemSynthesizer';

describe('ActionItemSynthesizer', () => {
    let synthesizer: ActionItemSynthesizer;
    const refDate = '2026-11-17T10:00:00Z';

    beforeEach(() => {
        synthesizer = new ActionItemSynthesizer();
    });

    describe('Turn-Level Action Item & Decision Extraction', () => {
        it('extracts self-commitments with high confidence and relative date resolution', () => {
            const input: TranscriptInput = {
                meetingId: 'meet-sync-01',
                title: 'Sprint Planning Sync',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob', 'Charlie'],
                turns: [
                    {
                        speaker: 'Alice',
                        timestamp: 1000,
                        text: 'Good morning everyone. I will deploy the staging database migration by tomorrow.'
                    }
                ]
            };

            const report = synthesizer.synthesize(input);
            expect(report.totalItems).toBe(1);
            expect(report.assignedItems.length).toBe(1);

            const item = report.assignedItems[0];
            expect(item.assignee).toBe('Alice');
            expect(item.assigner).toBe('Alice');
            expect(item.task).toContain('Deploy the staging database migration');
            expect(item.dueDate).toBe('2026-11-18');
            expect(item.confidenceScore).toBeGreaterThanOrEqual(0.9);
            expect(item.priority).toBe('MEDIUM');
        });

        it('extracts direct delegation to attendees', () => {
            const input: TranscriptInput = {
                meetingId: 'meet-sync-02',
                title: 'Architecture Review',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob', 'Charlie'],
                turns: [
                    {
                        speaker: 'Alice',
                        timestamp: 2000,
                        text: 'Bob, please handle the API authentication rate limiting before Friday.'
                    }
                ]
            };

            const report = synthesizer.synthesize(input);
            expect(report.assignedItems.length).toBe(1);

            const item = report.assignedItems[0];
            expect(item.assignee).toBe('Bob');
            expect(item.assigner).toBe('Alice');
            expect(item.task).toContain('Api authentication rate limiting');
        });

        it('detects unassigned tasks and urgent priority markers', () => {
            const input: TranscriptInput = {
                meetingId: 'meet-sync-03',
                title: 'Incident Post-Mortem',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob'],
                turns: [
                    {
                        speaker: 'Bob',
                        timestamp: 3000,
                        text: 'Someone needs to fix the memory leak in the WebRTC service ASAP.'
                    }
                ]
            };

            const report = synthesizer.synthesize(input);
            expect(report.unassignedItems.length).toBe(1);

            const item = report.unassignedItems[0];
            expect(item.assignee).toBe('UNASSIGNED');
            expect(item.priority).toBe('CRITICAL');
        });

        it('extracts key architectural decisions from turns', () => {
            const input: TranscriptInput = {
                meetingId: 'meet-sync-04',
                title: 'Database Alignment',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob'],
                turns: [
                    {
                        speaker: 'Alice',
                        timestamp: 4000,
                        text: 'After evaluating benchmarks, we decided to adopt ClickHouse for time-series analytics.'
                    }
                ]
            };

            const report = synthesizer.synthesize(input);
            expect(report.keyDecisions.length).toBe(1);
            expect(report.keyDecisions[0]).toContain('adopt ClickHouse for time-series analytics');
        });
    });

    describe('Deduplication & Cross-Task Dependencies', () => {
        it('deduplicates repetitive tasks mentioned across multiple turns', () => {
            const input: TranscriptInput = {
                meetingId: 'meet-sync-05',
                title: 'Weekly Standup',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob'],
                turns: [
                    {
                        speaker: 'Alice',
                        timestamp: 5000,
                        text: 'I will prepare the client presentation by tomorrow.'
                    },
                    {
                        speaker: 'Alice',
                        timestamp: 6000,
                        text: 'Just to reiterate, I will prepare the client presentation slides tomorrow.'
                    }
                ]
            };

            const report = synthesizer.synthesize(input);
            expect(report.totalItems).toBe(1);
            expect(report.assignedItems[0].assignee).toBe('Alice');
        });

        it('resolves task dependencies and calculates the critical path', () => {
            const input: TranscriptInput = {
                meetingId: 'meet-sync-06',
                title: 'Release Coordination',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob'],
                turns: [
                    {
                        speaker: 'Alice',
                        timestamp: 7000,
                        text: 'I will finalize the security audit fixes.'
                    },
                    {
                        speaker: 'Bob',
                        timestamp: 8000,
                        text: 'I will trigger the production deployment once Alice finishes.'
                    }
                ]
            };

            const report = synthesizer.synthesize(input);
            expect(report.totalItems).toBe(2);

            const bobTask = report.assignedItems.find(i => i.assignee === 'Bob');
            const aliceTask = report.assignedItems.find(i => i.assignee === 'Alice');

            expect(bobTask).toBeDefined();
            expect(aliceTask).toBeDefined();
            expect(bobTask?.dependencies).toContain(aliceTask?.id);

            expect(report.criticalPath.length).toBe(2);
            expect(report.criticalPath[0]).toBe(aliceTask?.id);
            expect(report.criticalPath[1]).toBe(bobTask?.id);
        });
    });
});

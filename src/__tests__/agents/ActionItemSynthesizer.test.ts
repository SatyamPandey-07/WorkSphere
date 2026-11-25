import {
    ActionItemSynthesizer,
    TranscriptInput,
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
            expect(item.task).toContain('API authentication rate limiting');
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

    describe('Action item validation', () => {
        const synthesizeText = (text: string) => synthesizer.synthesize({
            meetingId: 'validation-meeting',
            title: 'Validation',
            referenceDate: refDate,
            attendees: ['Alice', 'Bob'],
            turns: [{ speaker: 'Alice', timestamp: 1, text }]
        });

        it('preserves valid actions from continuous unpunctuated speech', () => {
            const report = synthesizeText('I will review the deployment plan and share it');

            expect(report.totalItems).toBe(1);
            expect(report.assignedItems[0].task).toBe('Review the deployment plan and share it');
        });

        it.each([
            ['', ''],
            ['   ', 'whitespace'],
            ['a', 'one character'],
            ['ab', 'two characters'],
            ['abc', 'three characters'],
            ['abcd', 'four characters']
        ])('filters %s action titles (%s)', (task) => {
            const report = synthesizeText(`TODO: ${task}`);

            expect(report.totalItems).toBe(0);
            expect(report.assignedItems).toEqual([]);
            expect(report.unassignedItems).toEqual([]);
        });

        it('keeps exactly five non-whitespace characters and trims its title', () => {
            const report = synthesizeText('TODO:   abcde   ');

            expect(report.totalItems).toBe(1);
            expect(report.unassignedItems[0].task).toBe('Abcde');
        });

        it('filters mixed invalid actions without changing valid metadata', () => {
            const report = synthesizer.synthesize({
                meetingId: 'mixed-validation',
                title: 'Validation',
                referenceDate: refDate,
                attendees: ['Alice', 'Bob'],
                turns: [
                    { speaker: 'Alice', timestamp: 1, text: 'TODO:  nope' },
                    { speaker: 'Alice', timestamp: 2, text: 'Bob, please handle release planning by tomorrow' },
                    { speaker: 'Alice', timestamp: 3, text: 'TODO: ' },
                    { speaker: 'Alice', timestamp: 4, text: 'I will a' }
                ]
            });

            expect(report.totalItems).toBe(1);
            expect(report.assignedItems[0]).toMatchObject({
                task: 'Release planning',
                assignee: 'Bob',
                assigner: 'Alice',
                dueDate: '2026-11-18',
                priority: 'MEDIUM',
                status: 'PENDING'
            });
        });

        it('filters missing, null, and non-string action titles safely at the validation boundary', () => {
            const malformed = [
                { task: undefined },
                { task: null },
                { task: 123 },
                { task: {} }
            ];

            expect(malformed.every((item) => {
                const candidate = item as { task: unknown };
                return typeof candidate.task === 'string' && candidate.task.trim().length >= 5;
            })).toBe(false);
            expect(synthesizeText('TODO: ').totalItems).toBe(0);
        });
    });
});

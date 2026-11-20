/**
 * @file ActionItemSynthesizer.ts
 * @description Autonomous meeting transcript action-item synthesizer.
 * Ingests multi-speaker dialogue turns, extracts linguistic commitments,
 * resolves assignees and relative temporal deadlines, builds DAG task dependencies,
 * flags unassigned ambiguities, and computes the critical path of execution.
 */

export interface TranscriptTurn {
    speaker: string;
    timestamp: number;
    text: string;
}

export interface TranscriptInput {
    meetingId: string;
    title: string;
    referenceDate: string | number; // ISO string or epoch ms
    attendees: string[];
    turns: TranscriptTurn[];
}

export type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ActionStatus = 'PENDING' | 'ACCEPTED' | 'BLOCKED' | 'COMPLETED';

export interface ActionItem {
    id: string;
    task: string;
    assignee: string; // Speaker name or 'UNASSIGNED'
    assigner: string;
    dueDate?: string; // Resolved ISO date (YYYY-MM-DD)
    priority: ActionPriority;
    status: ActionStatus;
    confidenceScore: number; // 0.0 to 1.0
    contextQuote: string;
    dependencies: string[]; // IDs of preceding required tasks
}

export interface SynthesisReport {
    meetingId: string;
    title: string;
    summary: string;
    totalItems: number;
    assignedItems: ActionItem[];
    unassignedItems: ActionItem[];
    keyDecisions: string[];
    criticalPath: string[];
}

const MIN_ACTION_ITEM_LENGTH = 5;

function sanitizeActionItem(item: ActionItem): ActionItem | null {
    if (typeof item.task !== 'string') return null;

    const task = item.task.trim();
    if (task.replace(/\s/g, '').length < MIN_ACTION_ITEM_LENGTH) return null;

    return { ...item, task };
}

export class ActionItemSynthesizer {
    private counter = 0;

    /**
     * Synthesizes an entire meeting transcript into structured action items,
     * decisions, and execution graphs.
     */
    public synthesize(input: TranscriptInput): SynthesisReport {
        const refDate = typeof input.referenceDate === 'number'
            ? new Date(input.referenceDate)
            : new Date(input.referenceDate);

        const rawItems: ActionItem[] = [];
        const keyDecisions: string[] = [];

        // 1. Process each conversational turn
        for (const turn of input.turns) {
            const extracted = this.extractFromTurn(turn, input.attendees, refDate);
            for (const item of extracted.items) {
                const sanitized = sanitizeActionItem(item);
                if (sanitized) rawItems.push(sanitized);
            }
            keyDecisions.push(...extracted.decisions);
        }

        // 2. Deduplicate overlapping or redundant action items
        const deduplicatedItems = this.deduplicateItems(rawItems);

        // 3. Link cross-task dependencies
        const linkedItems = this.resolveDependencies(deduplicatedItems);

        // 4. Split into assigned vs unassigned
        const assignedItems = linkedItems.filter(item => item.assignee !== 'UNASSIGNED');
        const unassignedItems = linkedItems.filter(item => item.assignee === 'UNASSIGNED');

        // 5. Compute critical path in dependency DAG
        const criticalPath = this.computeCriticalPath(linkedItems);

        // 6. Summary generation
        const summary = `Synthesized ${linkedItems.length} action item(s) (${assignedItems.length} assigned, ${unassignedItems.length} unassigned) and ${keyDecisions.length} key decision(s) for meeting: "${input.title}".`;

        return {
            meetingId: input.meetingId,
            title: input.title,
            summary,
            totalItems: linkedItems.length,
            assignedItems,
            unassignedItems,
            keyDecisions,
            criticalPath
        };
    }

    /**
     * Extracts potential action items and decisions from a single speaker utterance.
     */
    private extractFromTurn(
        turn: TranscriptTurn,
        attendees: string[],
        refDate: Date
    ): { items: ActionItem[]; decisions: string[] } {
        const items: ActionItem[] = [];
        const decisions: string[] = [];
        const text = turn.text;

        // Check for Key Decisions
        const decisionRegex = /(?:we decided to|decision[:\s]+|agreed that|the conclusion is)\s+([^.!?]+)/gi;
        let dMatch: RegExpExecArray | null;
        while ((dMatch = decisionRegex.exec(text)) !== null) {
            decisions.push(dMatch[1].trim());
        }

        // 1. Self Commitment ("I will deploy...", "I'll take care of...")
        const selfRegex = /(?:I will|I'll|I am going to|I'm going to|I can handle|I'll take care of|let me handle)\s+([^.!?]+)/gi;
        let sMatch: RegExpExecArray | null;
        while ((sMatch = selfRegex.exec(text)) !== null) {
            const taskText = sMatch[1].trim();
            items.push(this.createActionItem({
                task: this.cleanTaskDescription(taskText),
                assignee: turn.speaker,
                assigner: turn.speaker,
                turn,
                refDate,
                confidence: this.scoreConfidence(sMatch[0], 0.95)
            }));
        }

        // 2. Direct Delegation ("Alice, please review...", "Can you handle...")
        for (const attendee of attendees) {
            if (attendee.toLowerCase() === turn.speaker.toLowerCase()) continue;
            const delegateRegex = new RegExp(
                `(?:@?${attendee}[,:]\\s*(?:please\\s+)?(?:can you|could you|you need to|handle|take care of)|can\\s+@?${attendee}\\s+(?:please\\s+)?)\\s+([^.!?]+)`,
                'gi'
            );
            let delMatch: RegExpExecArray | null;
            while ((delMatch = delegateRegex.exec(text)) !== null) {
                const taskText = delMatch[1].trim();
                items.push(this.createActionItem({
                    task: this.cleanTaskDescription(taskText),
                    assignee: attendee,
                    assigner: turn.speaker,
                    turn,
                    refDate,
                    confidence: this.scoreConfidence(delMatch[0], 0.85)
                }));
            }
        }

        // 3. Explicit To-Do Markers ("TODO: ...", "Action item: ...")
        const explicitRegex = /(?:action item|TODO|task)[:\s]+([^.!?]+)/gi;
        let exMatch: RegExpExecArray | null;
        while ((exMatch = explicitRegex.exec(text)) !== null) {
            const taskText = exMatch[1].trim();
            // Check if attendee mentioned
            let foundAssignee = 'UNASSIGNED';
            for (const att of attendees) {
                if (taskText.toLowerCase().includes(att.toLowerCase())) {
                    foundAssignee = att;
                    break;
                }
            }
            items.push(this.createActionItem({
                task: this.cleanTaskDescription(taskText),
                assignee: foundAssignee,
                assigner: turn.speaker,
                turn,
                refDate,
                confidence: 0.90
            }));
        }

        // 4. Ambiguous Unassigned Tasks ("Someone needs to...", "We need to...")
        const unassignedRegex = /(?:someone needs to|someone should|we need to|somebody must)\s+([^.!?]+)/gi;
        let uMatch: RegExpExecArray | null;
        while ((uMatch = unassignedRegex.exec(text)) !== null) {
            const taskText = uMatch[1].trim();
            items.push(this.createActionItem({
                task: this.cleanTaskDescription(taskText),
                assignee: 'UNASSIGNED',
                assigner: turn.speaker,
                turn,
                refDate,
                confidence: 0.65
            }));
        }

        return { items, decisions };
    }

    private createActionItem(params: {
        task: string;
        assignee: string;
        assigner: string;
        turn: TranscriptTurn;
        refDate: Date;
        confidence: number;
    }): ActionItem {
        this.counter++;
        const id = `act-${Date.now().toString(36)}-${this.counter}`;
        const priority = this.detectPriority(params.turn.text);
        const dueDate = this.resolveDueDate(params.turn.text, params.refDate);

        return {
            id,
            task: params.task,
            assignee: params.assignee,
            assigner: params.assigner,
            dueDate,
            priority,
            status: 'PENDING',
            confidenceScore: params.confidence,
            contextQuote: params.turn.text,
            dependencies: []
        };
    }

    private cleanTaskDescription(text: string): string {
        // Strip temporal phrases at tail
        let cleaned = text.replace(/\b(?:by tomorrow|by EOD|by Friday|next week|ASAP|as soon as possible)\b/gi, '').trim();
        // Capitalize first letter
        if (cleaned.length > 0) {
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }
        return cleaned;
    }

    private detectPriority(text: string): ActionPriority {
        const lower = text.toLowerCase();
        if (lower.includes('urgent') || lower.includes('asap') || lower.includes('critical') || lower.includes('p0') || lower.includes('blocker')) {
            return 'CRITICAL';
        }
        if (lower.includes('high priority') || lower.includes('p1') || lower.includes('important')) {
            return 'HIGH';
        }
        if (lower.includes('nice to have') || lower.includes('low priority') || lower.includes('p3') || lower.includes('whenever')) {
            return 'LOW';
        }
        return 'MEDIUM';
    }

    private resolveDueDate(text: string, refDate: Date): string | undefined {
        const lower = text.toLowerCase();
        const d = new Date(refDate);

        if (lower.includes('by tomorrow') || lower.includes('tomorrow')) {
            d.setDate(d.getDate() + 1);
            return d.toISOString().split('T')[0];
        }
        if (lower.includes('by eod') || lower.includes('end of day') || lower.includes('today')) {
            return d.toISOString().split('T')[0];
        }
        if (lower.includes('next week')) {
            d.setDate(d.getDate() + 7);
            return d.toISOString().split('T')[0];
        }

        const daysMatch = lower.match(/in\s+(\d+)\s+days/);
        if (daysMatch) {
            const addDays = parseInt(daysMatch[1], 10);
            d.setDate(d.getDate() + addDays);
            return d.toISOString().split('T')[0];
        }

        const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (isoMatch) {
            return isoMatch[1];
        }

        return undefined;
    }

    private scoreConfidence(phrase: string, base: number): number {
        const lower = phrase.toLowerCase();
        if (lower.includes('definitely') || lower.includes('guarantee') || lower.includes('promise')) {
            return Math.min(1.0, base + 0.05);
        }
        if (lower.includes('maybe') || lower.includes('might') || lower.includes('if possible')) {
            return Math.max(0.4, base - 0.35);
        }
        return base;
    }

    private deduplicateItems(items: ActionItem[]): ActionItem[] {
        const unique: ActionItem[] = [];

        for (const item of items) {
            const existing = unique.find(u => {
                const sameAssignee = u.assignee.toLowerCase() === item.assignee.toLowerCase();
                const similarity = this.calculateJaccardSimilarity(u.task, item.task);
                return sameAssignee && similarity > 0.65;
            });

            if (existing) {
                // Keep higher confidence score and better due date
                if (item.confidenceScore > existing.confidenceScore) {
                    existing.confidenceScore = item.confidenceScore;
                }
                if (!existing.dueDate && item.dueDate) {
                    existing.dueDate = item.dueDate;
                }
            } else {
                unique.push(item);
            }
        }

        return unique;
    }

    private calculateJaccardSimilarity(strA: string, strB: string): number {
        const wordsA = new Set(strA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const wordsB = new Set(strB.toLowerCase().split(/\s+/).filter(w => w.length > 2));

        if (wordsA.size === 0 || wordsB.size === 0) return 0;

        let intersection = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) intersection++;
        }
        const union = wordsA.size + wordsB.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    private resolveDependencies(items: ActionItem[]): ActionItem[] {
        for (const item of items) {
            const lower = item.contextQuote.toLowerCase();
            // Look for "after X", "once Y finishes", "following Z"
            for (const other of items) {
                if (other.id === item.id) continue;
                // If this task mentions words from other task or other assignee
                if (lower.includes(`after ${other.assignee.toLowerCase()}`) ||
                    lower.includes(`once ${other.assignee.toLowerCase()}`)) {
                    if (!item.dependencies.includes(other.id)) {
                        item.dependencies.push(other.id);
                    }
                }
            }
        }
        return items;
    }

    private computeCriticalPath(items: ActionItem[]): string[] {
        // Build graph of dependencies
        let longestPath: string[] = [];

        const dfs = (currentId: string, visited: Set<string>, currentPath: string[]) => {
            currentPath.push(currentId);
            visited.add(currentId);

            // Find items that depend on currentId
            const dependents = items.filter(i => i.dependencies.includes(currentId));
            if (dependents.length === 0) {
                if (currentPath.length > longestPath.length) {
                    longestPath = [...currentPath];
                }
            } else {
                for (const dep of dependents) {
                    if (!visited.has(dep.id)) {
                        dfs(dep.id, visited, currentPath);
                    }
                }
            }

            currentPath.pop();
            visited.delete(currentId);
        };

        // Start DFS from root tasks (tasks with 0 dependencies)
        const rootTasks = items.filter(i => i.dependencies.length === 0);
        for (const root of rootTasks) {
            dfs(root.id, new Set(), []);
        }

        return longestPath;
    }
}

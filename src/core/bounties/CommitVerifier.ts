/**
 * CommitVerifier.ts
 * Analyzes local Git logs and AST changes to mathematically verify 
 * that the claimed coding task was actually completed.
 */

export interface GitCommit {
    hash: string;
    author: string;
    timestamp: number;
    message: string;
    filesChanged: string[];
    insertions: number;
    deletions: number;
}

export interface ASTChangeMetrics {
    functionsAdded: number;
    functionsModified: number;
    complexityDelta: number; // Cyclomatic complexity change
    testCoverageDelta: number;
}

export class CommitVerifier {
    private requiredKeywords: string[];
    private minNetLinesChanged: number;

    constructor(requiredKeywords: string[] = [], minNetLinesChanged: number = 10) {
        this.requiredKeywords = requiredKeywords;
        this.minNetLinesChanged = minNetLinesChanged;
    }

    public verifyCommits(
        commits: GitCommit[],
        claimerId: string,
        bountyClaimedAt: number,
        astMetrics: ASTChangeMetrics
    ): { verified: boolean; score: number; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;

        // 1. Filter commits by author and time
        const validCommits = commits.filter(c =>
            c.author === claimerId && c.timestamp >= bountyClaimedAt
        );

        if (validCommits.length === 0) {
            reasons.push('No commits found by claimer after bounty was claimed.');
            return { verified: false, score: 0, reasons };
        }

        // 2. Check for meaningful code changes (not just whitespace/formatting)
        let totalInsertions = 0;
        let totalDeletions = 0;

        for (const commit of validCommits) {
            totalInsertions += commit.insertions;
            totalDeletions += commit.deletions;
        }

        const netChange = Math.abs(totalInsertions - totalDeletions);
        if (netChange < this.minNetLinesChanged) {
            reasons.push(`Net line change (${netChange}) below minimum threshold (${this.minNetLinesChanged}).`);
        } else {
            score += 30;
        }

        // 3. Check commit messages for required keywords
        if (this.requiredKeywords.length > 0) {
            const messages = validCommits.map(c => c.message.toLowerCase()).join(' ');
            const keywordHits = this.requiredKeywords.filter(kw => messages.includes(kw.toLowerCase())).length;

            if (keywordHits === 0) {
                reasons.push('Commit messages do not contain required bounty keywords.');
            } else {
                score += (keywordHits / this.requiredKeywords.length) * 30;
            }
        } else {
            score += 30; // No keywords required
        }

        // 4. Evaluate AST Complexity and Test Coverage
        if (astMetrics.functionsAdded > 0 || astMetrics.functionsModified > 0) {
            score += 20;
        } else {
            reasons.push('No structural AST changes detected (functions added/modified).');
        }

        if (astMetrics.testCoverageDelta > 0) {
            score += 20;
        } else if (astMetrics.testCoverageDelta < -5) {
            score -= 10;
            reasons.push('Test coverage significantly decreased.');
        }

        // 5. Penalize "dump" commits (one massive commit vs iterative work)
        if (validCommits.length === 1 && totalInsertions > 500) {
            score -= 15;
            reasons.push('Penalty: Single massive commit dump detected. Iterative work preferred.');
        } else if (validCommits.length >= 3) {
            score += 10; // Bonus for iterative commits
        }

        score = Math.max(0, Math.min(100, score));
        const verified = score >= 70; // 70% threshold to pass verification

        return { verified, score, reasons };
    }

    public generateCommitProof(commits: GitCommit[]): string {
        // Generate a deterministic hash of the commit hashes to serve as proof
        const hashString = commits.map(c => c.hash).join('');
        let hash = 0;
        for (let i = 0; i < hashString.length; i++) {
            hash = ((hash << 5) - hash) + hashString.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }
}

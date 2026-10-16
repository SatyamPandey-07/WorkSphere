/**
 * @file AllergenMatcher.ts
 * @description High-performance multi-pattern string matching engine for identifying 
 * allergens and macro-nutrient keywords in extracted menu text. Utilizes the Aho-Corasick 
 * algorithm to process large blocks of text against a user's biological profile in O(N) time.
 */

export interface BiologicalProfile {
    allergies: string[];
    intolerances: string[];
    dietaryRestrictions: string[];
    targetMacros: {
        proteinMin: number;
        carbsMax: number;
        fatsMax: number;
    };
}

export interface MatchResult {
    keyword: string;
    category: 'allergy' | 'intolerance' | 'restriction' | 'macro';
    startIndex: number;
    endIndex: number;
    riskLevel: 'critical' | 'warning' | 'info';
}

interface TrieNode {
    children: Map<string, TrieNode>;
    fail: TrieNode | null;
    outputs: Array<{ keyword: string; category: MatchResult['category']; riskLevel: MatchResult['riskLevel'] }>;
}

export class AllergenMatcher {
    private root: TrieNode;
    private profile: BiologicalProfile | null = null;

    constructor() {
        this.root = { children: new Map(), fail: null, outputs: [] };
    }

    public loadProfile(profile: BiologicalProfile): void {
        this.profile = profile;
        this.buildTrie();
    }

    private buildTrie(): void {
        this.root = { children: new Map(), fail: null, outputs: [] };
        if (!this.profile) return;

        const addKeyword = (keyword: string, category: MatchResult['category'], riskLevel: MatchResult['riskLevel']) => {
            let node = this.root;
            const lower = keyword.toLowerCase();
            for (const char of lower) {
                if (!node.children.has(char)) {
                    node.children.set(char, { children: new Map(), fail: null, outputs: [] });
                }
                node = node.children.get(char)!;
            }
            node.outputs.push({ keyword, category, riskLevel });
        };

        this.profile.allergies.forEach(a => addKeyword(a, 'allergy', 'critical'));
        this.profile.intolerances.forEach(i => addKeyword(i, 'intolerance', 'warning'));
        this.profile.dietaryRestrictions.forEach(r => addKeyword(r, 'restriction', 'info'));

        addKeyword('protein', 'macro', 'info');
        addKeyword('carbs', 'macro', 'info');
        addKeyword('fat', 'macro', 'info');
        addKeyword('calories', 'macro', 'info');

        this.buildFailureLinks();
    }

    private buildFailureLinks(): void {
        const queue: TrieNode[] = [];
        this.root.fail = this.root;

        for (const child of this.root.children.values()) {
            child.fail = this.root;
            queue.push(child);
        }

        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const [char, child] of current.children.entries()) {
                queue.push(child);
                let failNode = current.fail;
                while (failNode !== this.root && !failNode!.children.has(char)) {
                    failNode = failNode!.fail;
                }
                child.fail = failNode!.children.get(char) || this.root;
                if (child.fail === child) child.fail = this.root;
                child.outputs = child.outputs.concat(child.fail.outputs);
            }
        }
    }

    public scanText(text: string): MatchResult[] {
        const results: MatchResult[] = [];
        let node = this.root;
        const lowerText = text.toLowerCase();

        for (let i = 0; i < lowerText.length; i++) {
            const char = lowerText[i];
            while (node !== this.root && !node.children.has(char)) {
                node = node.fail!;
            }
            if (node.children.has(char)) {
                node = node.children.get(char)!;
            }
            for (const output of node.outputs) {
                results.push({
                    keyword: output.keyword,
                    category: output.category,
                    startIndex: i - output.keyword.length + 1,
                    endIndex: i + 1,
                    riskLevel: output.riskLevel,
                });
            }
        }
        return this.deduplicateResults(results);
    }

    private deduplicateResults(results: MatchResult[]): MatchResult[] {
        const unique = new Map<string, MatchResult>();
        for (const res of results) {
            const key = `${res.keyword}_${res.startIndex}`;
            if (!unique.has(key) || unique.get(key)!.riskLevel === 'info') {
                unique.set(key, res);
            }
        }
        return Array.from(unique.values());
    }
}

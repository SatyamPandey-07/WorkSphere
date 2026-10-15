/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { ContractRedlineEngine, LegalClause, RedlineSuggestion } from '../core/legal/ContractRedlineEngine';
import { NDAClauseExtractor } from '../core/legal/NDAClauseExtractor';

interface WorkerMessage {
    type: 'PARSE_DOCUMENT' | 'ANALYZE_CLAUSE';
    payload: any;
}

interface WorkerResponse {
    type: 'CLAUSES_EXTRACTED' | 'CLAUSE_ANALYZED' | 'ERROR';
    payload: any;
}

const extractor = new NDAClauseExtractor();
const engine = new ContractRedlineEngine();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        if (type === 'PARSE_DOCUMENT') {
            handleParseDocument(payload.text);
        } else if (type === 'ANALYZE_CLAUSE') {
            handleAnalyzeClause(payload.clause, payload.llmResponse);
        }
    } catch (error: any) {
        self.postMessage({
            type: 'ERROR',
            payload: { message: error.message }
        } as WorkerResponse);
    }
};

function handleParseDocument(text: string): void {
    const clauses = extractor.extractClauses(text);

    // Apply heuristic risk scoring before sending to main thread
    const scoredClauses = clauses.map(c => ({
        ...c,
        riskLevel: engine.calculateHeuristicRisk(c)
    }));

    self.postMessage({
        type: 'CLAUSES_EXTRACTED',
        payload: { clauses: scoredClauses }
    } as WorkerResponse);
}

function handleAnalyzeClause(clause: LegalClause, llmResponse: string): void {
    const suggestion = engine.parseLLMResponse(clause.id, clause.originalText, llmResponse);

    self.postMessage({
        type: 'CLAUSE_ANALYZED',
        payload: { suggestion }
    } as WorkerResponse);
}

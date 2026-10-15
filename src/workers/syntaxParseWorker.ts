/**
 * syntaxParseWorker.ts
 * Web Worker for offloading heavy syntax tree parsing and tokenization.
 */

export interface Token {
    type: string;
    value: string;
    start: number;
    end: number;
}

export interface ParseRequest {
    id: string;
    code: string;
    language: string;
}

export interface ParseResponse {
    id: string;
    tokens: Token[];
    error?: string;
}

// Simple regex-based tokenizer for demonstration purposes
// In a real scenario, this would integrate with tree-sitter or monaco's tokenizer
function tokenize(code: string, language: string): Token[] {
    const tokens: Token[] = [];

    const keywords = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'async', 'await']);
    const regex = /([a-zA-Z_$][a-zA-Z0-9_$]*)|("[^"]*")|('[^']*')|(\d+)|([{}()\[\];,\.])|(\s+)|([+\-*/%=<>!&|^~?:])/g;

    let match;
    while ((match = regex.exec(code)) !== null) {
        const value = match[0];
        let type = 'unknown';

        if (match[1]) {
            type = keywords.has(value) ? 'keyword' : 'identifier';
        } else if (match[2] || match[3]) {
            type = 'string';
        } else if (match[4]) {
            type = 'number';
        } else if (match[5]) {
            type = 'punctuation';
        } else if (match[6]) {
            type = 'whitespace';
        } else if (match[7]) {
            type = 'operator';
        }

        if (type !== 'whitespace') {
            tokens.push({
                type,
                value,
                start: match.index,
                end: match.index + value.length,
            });
        }
    }

    return tokens;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
    const { id, code, language } = event.data;

    try {
        const tokens = tokenize(code, language);
        const response: ParseResponse = { id, tokens };
        self.postMessage(response);
    } catch (err: any) {
        const response: ParseResponse = {
            id,
            tokens: [],
            error: err.message || 'Unknown parsing error'
        };
        self.postMessage(response);
    }
};

// Signal that the worker is ready
self.postMessage({ type: 'worker-ready' });

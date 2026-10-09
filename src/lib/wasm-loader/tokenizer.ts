/**
 * tokenizer.ts
 * TypeScript bridge to pass raw UTF-8 strings to the WASM tokenizer and receive segmented arrays.
 * Manages WebAssembly memory allocation and string encoding/decoding.
 */

export class UnicodeTokenizer {
    private wasmModule: WebAssembly.Module | null = null;
    private wasmInstance: WebAssembly.Instance | null = null;
    private wasmMemory: WebAssembly.Memory | null = null;
    private isReady: boolean = false;
    private resolveReady: (() => void) | null = null;
    private readyPromise: Promise<void>;

    constructor() {
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    public async initialize(wasmUrl: string = '/wasm/unicode_tokenizer.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            this.wasmModule = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 64 }),
                },
            };

            this.wasmInstance = await WebAssembly.instantiate(this.wasmModule, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) {
                this.resolveReady();
            }
        } catch (error) {
            console.error('Failed to initialize Unicode Tokenizer WASM:', error);
            throw error;
        }
    }

    public async tokenize(text: string): Promise<string[]> {
        await this.readyPromise;
        if (!this.wasmInstance || !this.wasmMemory) {
            throw new Error('WASM instance not initialized');
        }

        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(text);
        const inputLength = uint8Array.length;

        const inputPtr = 0;
        const resultPtr = inputLength + 4;

        const memoryView = new Uint8Array(this.wasmMemory.buffer, inputPtr, inputLength);
        memoryView.set(uint8Array);

        const tokenizeFn = this.wasmInstance.exports.tokenize_utf8 as CallableFunction;
        const getCountFn = this.wasmInstance.exports.get_token_count as CallableFunction;
        const getStartFn = this.wasmInstance.exports.get_token_start as CallableFunction;
        const getEndFn = this.wasmInstance.exports.get_token_end as CallableFunction;

        tokenizeFn(inputPtr, inputLength, resultPtr);

        const count = getCountFn(resultPtr);
        const tokens: string[] = [];
        const decoder = new TextDecoder();

        for (let i = 0; i < count; i++) {
            const start = getStartFn(resultPtr, i);
            const end = getEndFn(resultPtr, i);
            const tokenBytes = new Uint8Array(this.wasmMemory.buffer, inputPtr + start, end - start);
            tokens.push(decoder.decode(tokenBytes));
        }

        return tokens;
    }
}

export const unicodeTokenizer = new UnicodeTokenizer();

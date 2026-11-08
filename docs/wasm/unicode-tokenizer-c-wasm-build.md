# Unicode Tokenizer C-to-Wasm Build Process & Vocabulary Mappings

## 1. Architectural Overview & Executive Summary

WorkSphere incorporates client-side Natural Language Processing (NLP) for multilingual semantic search, booking vibe analysis, and review moderation. To process arbitrary Unicode text across Latin, Cyrillic, Devanagari (Hindi), Arabic, and CJK (Chinese, Japanese, Korean) scripts at sub-millisecond latencies without taxing JavaScript garbage collection, the core segmentation engine is implemented in **C** (`src/wasm/nlp/unicode_tokenizer.c`) and compiled into **WebAssembly (Wasm)** (`public/wasm/unicode_tokenizer.wasm`).

The TypeScript runtime bridge (`src/lib/wasm-loader/tokenizer.ts`) mounts the compiled Wasm module into browser and Node.js environments, managing linear memory allocation, zero-copy pointer exchanges, and text decoding.

```
+-----------------------------------------------------------------------------------------+
|                                TYPESCRIPT RUNTIME LAYER                                 |
|                         (src/lib/wasm-loader/tokenizer.ts)                              |
+--------------------------------------------+--------------------------------------------+
                                             |
                         TextEncoder.encode(inputString)
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                               WASM LINEAR MEMORY (64 KB+)                               |
|   [0 ... inputLength-1]            : Raw UTF-8 bytes                                    |
|   [inputLength+4 ... resultPtr]    : TokenizerResult C-struct (Boundaries + Count)      |
+--------------------------------------------+--------------------------------------------+
                                             |
              tokenize_utf8(inputPtr, inputLength, resultPtr) via wasmInstance
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                              C WEBASSEMBLY ENGINE CORE                                  |
|                         (src/wasm/nlp/unicode_tokenizer.c)                              |
|   - Multi-byte UTF-8 Decoder (1 to 4 bytes per codepoint)                               |
|   - UAX #29 Word Boundary Classifier & Unicode Script Range Filter                      |
|   - BPE Subword Splitter & Vocabulary Token Serializer                                  |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Emscripten Toolchain & Compilation Flags

The C source is compiled to WebAssembly using the Emscripten SDK (`emcc`) targeting a standalone, high-performance Wasm binary.

### 2.1 Prerequisites
- **Emscripten SDK (emsdk):** `>= 3.1.50`
- **Clang 18+:** WebAssembly target (`wasm32-unknown-emscripten` / `wasm32-wasi`)
- **Node.js runtime:** `>= 20.x` for development testing

### 2.2 Compilation Command
```bash
emcc src/wasm/nlp/unicode_tokenizer.c \
  -O3 \
  -s WASM=1 \
  -s STANDALONE_WASM=1 \
  -s SIDE_MODULE=0 \
  -s INITIAL_MEMORY=65536 \
  -s MAXIMUM_MEMORY=16777216 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS="['_tokenize_utf8','_get_token_count','_get_token_start','_get_token_end','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString']" \
  -s NO_FILESYSTEM=1 \
  -s ENVIRONMENT='web,worker,node' \
  -o public/wasm/unicode_tokenizer.wasm
```

### 2.3 Compilation Flags Breakdown

| Flag | Value | Rationale |
| :--- | :--- | :--- |
| `-O3` | Optimized | Aggressive loop unrolling, instruction pipelining, and inlining of `decode_utf8` and `is_word_character`. |
| `-s WASM=1` | 1 | Generates standard WebAssembly bytecode instead of asm.js fallback. |
| `-s STANDALONE_WASM=1` | 1 | Emits a pure, standalone `.wasm` binary without requiring heavy Emscripten JS glue wrappers. |
| `-s INITIAL_MEMORY=65536` | 1 page (64KB) | Allocates the baseline memory footprint required for typical review and search query payloads. |
| `-s ALLOW_MEMORY_GROWTH=1` | Dynamic | Permits dynamic `memory.grow` invocations up to 16MB for batch document indexing. |
| `-s EXPORTED_FUNCTIONS` | Array | Exposes explicit ABI entry points to the WebAssembly export table (`exports.*`). |
| `-s NO_FILESYSTEM=1` | Stripped | Strips POSIX filesystem emulation (`FS.*`), reducing binary size below 8 KB. |
| `-s ENVIRONMENT` | Web, Worker, Node | Allows seamless cross-execution across UI threads, Web Workers, and SSR environments. |

---

## 3. UTF-8 Stream Decoding & Unicode Normalization (UAX #29)

### 3.1 Variable-Length UTF-8 Stream Decoder

Standard ASCII handles byte values in $[0, 127]$. Unicode codepoints above $127$ utilize multi-byte sequences per RFC 3629:

- **1 Byte (ASCII):** `0xxxxxxx` $\rightarrow$ Codepoint range `0x0000` to `0x007F`
- **2 Bytes:** `110xxxxx 10xxxxxx` $\rightarrow$ Codepoint range `0x0080` to `0x07FF`
- **3 Bytes:** `1110xxxx 10xxxxxx 10xxxxxx` $\rightarrow$ Codepoint range `0x0800` to `0xFFFF`
- **4 Bytes:** `11110xxx 10xxxxxx 10xxxxxx 10xxxxxx` $\rightarrow$ Codepoint range `0x10000` to `0x10FFFF`

In `unicode_tokenizer.c`, bitwise mask extraction unpacks payload bits into a 32-bit scalar codepoint value:
```c
static uint32_t decode_utf8(const uint8_t *str, int *bytes_read) {
  if (!str || !bytes_read)
    return 0;

  if ((str[0] & 0x80) == 0) {
    *bytes_read = 1;
    return str[0];
  } else if ((str[0] & 0xE0) == 0xC0) {
    *bytes_read = 2;
    return ((str[0] & 0x1F) << 6) | (str[1] & 0x3F);
  } else if ((str[0] & 0xF0) == 0xE0) {
    *bytes_read = 3;
    return ((str[0] & 0x0F) << 12) | ((str[1] & 0x3F) << 6) | (str[2] & 0x3F);
  } else if ((str[0] & 0xF8) == 0xF0) {
    *bytes_read = 4;
    return ((str[0] & 0x07) << 18) | ((str[1] & 0x3F) << 12) |
           ((str[2] & 0x3F) << 6) | (str[3] & 0x3F);
  }

  *bytes_read = 1;
  return str[0];
}
```

### 3.2 Script Classification & Unicode Character Ranges

To provide language-agnostic segmentation complying with Unicode Standard Annex #29, codepoints are categorized by script boundaries:

| Unicode Script / Block | Hex Range | Linguistic Coverage |
| :--- | :--- | :--- |
| **Basic Latin** | `0x0041 - 0x005A`, `0x0061 - 0x007A` | English, standard Latin alphabet |
| **Latin Extended (A & B)** | `0x00C0 - 0x024F` | Accented characters (French, German, Spanish, Scandinavian) |
| **Cyrillic** | `0x0400 - 0x04FF` | Russian, Ukrainian, Bulgarian |
| **Devanagari** | `0x0900 - 0x097F` | Hindi, Sanskrit, Marathi |
| **Arabic** | `0x0600 - 0x06FF` | Arabic, Persian, Urdu |
| **CJK Unified Ideographs** | `0x4E00 - 0x9FFF` | Chinese Hanzi, Japanese Kanji, Korean Hanja |

### 3.3 Normalization Guidelines
Before passing raw input strings to the tokenizer, caller applications should ensure Unicode Normalization Form C (NFC) is applied:
```typescript
const normalizedText = rawInput.normalize('NFC');
```
This merges precomposed character sequences with combining diacritics, preventing spurious word splits.

---

## 4. Byte-Pair Encoding (BPE) & Vocabulary Mappings

WorkSphere's search and embedding pipelines map extracted token boundaries into numerical vocabulary IDs via a pre-trained BPE vocabulary index.

### 4.1 Boundary Storage Model (`TokenizerResult`)

The C module returns a fixed-overhead contiguous struct storing token start and end byte offsets:

```c
typedef struct {
  uint32_t start;
  uint32_t end;
} TokenBoundary;

typedef struct {
  TokenBoundary boundaries[MAX_TOKENS]; // MAX_TOKENS = 1024
  int count;
} TokenizerResult;
```

### 4.2 Memory Layout & Offsets
Inside the WebAssembly linear memory:
- **`inputPtr` (Offset 0):** Byte array containing UTF-8 encoded text.
- **`resultPtr` (Offset `inputLength + 4`):** Memory aligned boundary structure.
- **Boundaries:** Each `TokenBoundary` occupies 8 bytes (two 4-byte `uint32_t` values).

### 4.3 Vocabulary Serialization Format

Extracted tokens are converted to model input tensors using a compact JSON or binary vocabulary table:
```json
{
  "vocab_version": "1.0",
  "special_tokens": {
    "[PAD]": 0,
    "[UNK]": 1,
    "[BOS]": 2,
    "[EOS]": 3
  },
  "merges": [
    "w o",
    "wo rk",
    "work sp",
    "worksp ace"
  ],
  "token_to_id": {
    "work": 104,
    "sphere": 512,
    "workspace": 1024,
    "coworking": 1025
  }
}
```

When an extracted token segment is not directly present in the pre-computed vocabulary:
1. The BPE merger iterates through sub-character pairs based on rank hierarchy.
2. Out-of-vocabulary sub-words fall back to individual Unicode character byte IDs.
3. Unrecognized bytes resolve to the special `[UNK]` token ID (`1`).

---

## 5. TypeScript Integration & Zero-Copy Execution

The TypeScript wrapper `UnicodeTokenizer` (`src/lib/wasm-loader/tokenizer.ts`) eliminates unnecessary string cloning:

```typescript
import { unicodeTokenizer } from '@/lib/wasm-loader/tokenizer';

// Initialize the Wasm binary
await unicodeTokenizer.initialize('/wasm/unicode_tokenizer.wasm');

// Tokenize multilingual text
const tokens = await unicodeTokenizer.tokenize('WorkSphere provides high-speed WiFi at ワークスペース.');
console.log(tokens);
// Output: ["WorkSphere", "provides", "high", "speed", "WiFi", "at", "ワークスペース"]
```

### 5.1 Lifecycle & Memory Management
1. **Compilation & Instantiation:** Single WebAssembly compilation cached across all active tabs and workers.
2. **Buffer Reuse:** Text encoded directly into `Uint8Array` view backed by `WebAssembly.Memory.buffer`.
3. **Zero-Allocation Boundary Lookups:** `get_token_start` and `get_token_end` access the contiguous struct without allocating intermediary JavaScript objects.
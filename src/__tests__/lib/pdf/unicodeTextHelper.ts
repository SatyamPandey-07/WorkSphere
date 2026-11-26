import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';

// Common Devanagari & Unicode punctuation/symbol transliterations for WinAnsi fallback
const SCRIPT_TRANSLITERATION_MAP: Record<string, string> = {
    // Common Indian city / locality words & Devanagari vowels/consonants
    'पुणे': 'Pune',
    'मुंबई': 'Mumbai',
    'दिल्ली': 'Delhi',
    'बेंगलुरु': 'Bengaluru',
    'हैदराबाद': 'Hyderabad',
    'चेन्नई': 'Chennai',
    'कोलकाता': 'Kolkata',
    // Devanagari consonants & matras (basic phonetic fallback)
    'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
    'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'am', 'अः': 'ah',
    'क': 'ka', 'ख': 'kha', 'ग': 'ga', 'घ': 'gha', 'ङ': 'nga',
    'च': 'cha', 'छ': 'chha', 'ज': 'ja', 'झ': 'jha', 'ञ': 'nya',
    'ट': 'ta', 'ठ': 'tha', 'ड': 'da', 'ढ': 'dha', 'ण': 'na',
    'त': 'ta', 'थ': 'tha', 'द': 'da', 'ध': 'dha', 'न': 'na',
    'प': 'pa', 'फ': 'pha', 'ब': 'ba', 'भ': 'bha', 'म': 'ma',
    'य': 'ya', 'र': 'ra', 'ल': 'la', 'व': 'va',
    'श': 'sha', 'ष': 'sha', 'स': 'sa', 'ह': 'ha',
    'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
    'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ः': 'h', '्': '',
    // Typographic symbols & currencies outside WinAnsi
    '₹': 'INR ',
    '₩': 'KRW ',
    '฿': 'THB ',
    '₫': 'VND ',
    '—': '-',
    '–': '-',
    '…': '...',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
};

// WinAnsi (Windows-1252) extended code points 0x80..0x9F mapped to Unicode
const WINANSI_EXTENDED_CODEPOINTS = new Set<number>([
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
    0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
    0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
    0x0153, 0x017e, 0x0178,
]);

/**
 * Checks whether a single Unicode code point is encodable in pdf-lib's WinAnsiEncoding.
 */
export function isWinAnsiEncodableChar(char: string): boolean {
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
    if (code >= 0x20 && code <= 0x7e) return true;
    if (code >= 0xa0 && code <= 0xff) return true;
    return WINANSI_EXTENDED_CODEPOINTS.has(code);
}

/**
 * Sanitizes and transliterates arbitrary Unicode text (Devanagari, accented European,
 * CJK, currency symbols, emojis) so it is 100% encodable by StandardFonts.Helvetica
 * without ever throwing `WinAnsi cannot encode`.
 */
export function sanitizeForWinAnsi(input: string): string {
    if (!input) return '';

    let processed = input;

    // 1. Replace known multi-character words & symbols first
    for (const [token, replacement] of Object.entries(SCRIPT_TRANSLITERATION_MAP)) {
        if (token.length > 1 && processed.includes(token)) {
            processed = processed.split(token).join(replacement);
        }
    }

    // 2. Apply single-character phonetic/symbol mappings
    let mapped = '';
    for (const char of processed) {
        if (Object.prototype.hasOwnProperty.call(SCRIPT_TRANSLITERATION_MAP, char)) {
            mapped += SCRIPT_TRANSLITERATION_MAP[char];
        } else {
            mapped += char;
        }
    }

    // 3. Decompose Latin diacritics (e.g., "München" -> "Munchen", "Café" -> "Cafe")
    //    while preserving characters already native to WinAnsi (like é, ü, ñ)
    let result = '';
    for (const char of mapped) {
        if (isWinAnsiEncodableChar(char)) {
            result += char;
            continue;
        }

        const decomposed = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        let asciiPart = '';
        for (const dChar of decomposed) {
            if (isWinAnsiEncodableChar(dChar)) {
                asciiPart += dChar;
            }
        }

        if (asciiPart.length > 0) {
            result += asciiPart;
        } else if (!/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(char)) {
            // Replace unrepresentable non-Latin glyphs (e.g. CJK without custom TTF) with '?'
            result += '?';
        }
    }

    return result.replace(/\s+/g, ' ').trim();
}

export interface ReceiptFontBundle {
    regular: PDFFont;
    bold: PDFFont;
    isUnicodeEmbedded: boolean;
    encodeText: (text: string) => string;
}

/**
 * Loads an embedded Unicode TrueType font via `@pdf-lib/fontkit` if font bytes are provided,
 * and gracefully falls back to `StandardFonts.Helvetica` + `sanitizeForWinAnsi` so serverless
 * PDF generation never crashes on non-Latin characters.
 */
export async function resolveReceiptFonts(
    pdfDoc: PDFDocument,
    unicodeFontBytes?: { regular?: Uint8Array; bold?: Uint8Array }
): Promise<ReceiptFontBundle> {
    if (unicodeFontBytes?.regular) {
        try {
            const fontkitModule = await import('@pdf-lib/fontkit');
            const fontkit = fontkitModule.default ?? fontkitModule;
            pdfDoc.registerFontkit(fontkit as never);

            const regular = await pdfDoc.embedFont(unicodeFontBytes.regular, {
                subset: true,
            });
            const bold = unicodeFontBytes.bold
                ? await pdfDoc.embedFont(unicodeFontBytes.bold, { subset: true })
                : regular;

            return {
                regular,
                bold,
                isUnicodeEmbedded: true,
                encodeText: (text: string) => text,
            };
        } catch {
            // Fall back to StandardFonts + WinAnsi sanitization if fontkit/font bytes fail
        }
    }

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    return {
        regular,
        bold,
        isUnicodeEmbedded: false,
        encodeText: (text: string) => sanitizeForWinAnsi(text),
    };
}
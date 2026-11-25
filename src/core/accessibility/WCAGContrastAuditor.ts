/**
 * @file WCAGContrastAuditor.ts
 * @description Automated WCAG 2.2 (Level AA & AAA) and APCA color contrast compliance
 * audit engine. Implements ITU-R BT.709 sRGB relative luminance, alpha compositing,
 * intelligent color remediation suggestions, and theme matrix auditing.
 */

export interface RGBA {
    r: number; // 0 - 255
    g: number; // 0 - 255
    b: number; // 0 - 255
    a: number; // 0.0 - 1.0
}

export type TextContext = 'NORMAL' | 'LARGE' | 'UI_COMPONENT';
export type WCAGLevel = 'AAA' | 'AA' | 'AA_LARGE' | 'FAIL';

export interface AuditResult {
    foregroundHex: string;
    backgroundHex: string;
    contrastRatio: number;
    relativeLuminanceForeground: number;
    relativeLuminanceBackground: number;
    passesAA_NormalText: boolean;  // >= 4.5:1
    passesAA_LargeText: boolean;   // >= 3.0:1
    passesAA_UIComponent: boolean; // >= 3.0:1
    passesAAA_NormalText: boolean; // >= 7.0:1
    passesAAA_LargeText: boolean;  // >= 4.5:1
    apcaScore: number;
    suggestedRemediation?: {
        targetRatio: number;
        suggestedHex: string;
    };
}

export interface ThemeAuditPair {
    element: string;
    foreground: string;
    background: string;
    context?: TextContext;
}

export interface ThemeAuditReport {
    totalAudited: number;
    passedCount: number;
    failedCount: number;
    results: Array<AuditResult & { element: string; context: TextContext }>;
}

export class WCAGContrastAuditor {
    /**
     * Parses HEX, RGB, or RGBA color strings into RGBA component struct.
     */
    public static parseColor(colorStr: string): RGBA {
        const trimmed = colorStr.trim().toLowerCase();

        // Named Colors
        if (trimmed === 'black') return { r: 0, g: 0, b: 0, a: 1.0 };
        if (trimmed === 'white') return { r: 255, g: 255, b: 255, a: 1.0 };
        if (trimmed === 'transparent') return { r: 0, g: 0, b: 0, a: 0.0 };

        // Hex Colors
        if (trimmed.startsWith('#')) {
            const hex = trimmed.substring(1);
            if (hex.length === 3) {
                // #RGB
                const r = parseInt(hex[0] + hex[0], 16);
                const g = parseInt(hex[1] + hex[1], 16);
                const b = parseInt(hex[2] + hex[2], 16);
                return { r, g, b, a: 1.0 };
            }
            if (hex.length === 4) {
                // #RGBA
                const r = parseInt(hex[0] + hex[0], 16);
                const g = parseInt(hex[1] + hex[1], 16);
                const b = parseInt(hex[2] + hex[2], 16);
                const a = parseInt(hex[3] + hex[3], 16) / 255;
                return { r, g, b, a: Math.round(a * 100) / 100 };
            }
            if (hex.length === 6) {
                // #RRGGBB
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                return { r, g, b, a: 1.0 };
            }
            if (hex.length === 8) {
                // #RRGGBBAA
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                const a = parseInt(hex.substring(6, 8), 16) / 255;
                return { r, g, b, a: Math.round(a * 100) / 100 };
            }
        }

        // Functional rgb() and rgba()
        const rgbMatch = trimmed.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
        if (rgbMatch) {
            const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10)));
            const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10)));
            const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10)));
            const a = rgbMatch[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(rgbMatch[4]))) : 1.0;
            return { r, g, b, a: Math.round(a * 100) / 100 };
        }

        throw new Error(`Unsupported color format: "${colorStr}"`);
    }

    /**
     * Converts RGBA color to 6-digit hex string (#RRGGBB).
     */
    public static toHex(color: RGBA): string {
        const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
        return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
    }

    /**
     * Composites a semi-transparent foreground color onto an opaque background color.
     */
    public static composite(fg: RGBA, bg: RGBA): RGBA {
        if (fg.a >= 1.0) return { ...fg, a: 1.0 };
        const alpha = fg.a + bg.a * (1.0 - fg.a);
        if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };

        const r = (fg.r * fg.a + bg.r * bg.a * (1.0 - fg.a)) / alpha;
        const g = (fg.g * fg.a + bg.g * bg.a * (1.0 - fg.a)) / alpha;
        const b = (fg.b * fg.a + bg.b * bg.a * (1.0 - fg.a)) / alpha;

        return {
            r: Math.round(r),
            g: Math.round(g),
            b: Math.round(b),
            a: alpha
        };
    }

    /**
     * Computes relative luminance according to WCAG 2.2 / ITU-R BT.709:
     * L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
     */
    public static calculateRelativeLuminance(color: RGBA): number {
        const toLinear = (val: number): number => {
            const s = val / 255;
            return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };

        const rLin = toLinear(color.r);
        const gLin = toLinear(color.g);
        const bLin = toLinear(color.b);

        const luminance = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
        return Math.round(luminance * 10000) / 10000;
    }

    /**
     * Computes the WCAG contrast ratio between foreground and background:
     * Ratio = (L1 + 0.05) / (L2 + 0.05) where L1 is lighter and L2 is darker.
     */
    public static calculateContrastRatio(fgInput: string | RGBA, bgInput: string | RGBA): number {
        const fgRaw = typeof fgInput === 'string' ? WCAGContrastAuditor.parseColor(fgInput) : fgInput;
        const bgRaw = typeof bgInput === 'string' ? WCAGContrastAuditor.parseColor(bgInput) : bgInput;

        // Composite if foreground has transparency
        const fg = fgRaw.a < 1.0 ? WCAGContrastAuditor.composite(fgRaw, bgRaw) : fgRaw;

        const l1 = WCAGContrastAuditor.calculateRelativeLuminance(fg);
        const l2 = WCAGContrastAuditor.calculateRelativeLuminance(bgRaw);

        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);

        const ratio = (lighter + 0.05) / (darker + 0.05);
        return Math.round(ratio * 100) / 100;
    }

    /**
     * Computes an APCA Lightness Contrast (Lc) value approximating WCAG 3.0 perceptual vision models.
     */
    public static calculateAPCA(fgInput: string | RGBA, bgInput: string | RGBA): number {
        const fgRaw = typeof fgInput === 'string' ? WCAGContrastAuditor.parseColor(fgInput) : fgInput;
        const bgRaw = typeof bgInput === 'string' ? WCAGContrastAuditor.parseColor(bgInput) : bgInput;

        const fg = fgRaw.a < 1.0 ? WCAGContrastAuditor.composite(fgRaw, bgRaw) : fgRaw;
        const yTxt = Math.max(0.001, WCAGContrastAuditor.calculateRelativeLuminance(fg));
        const yBg = Math.max(0.001, WCAGContrastAuditor.calculateRelativeLuminance(bgRaw));

        // Simplified APCA SAPC power-law representation
        const sapc = (Math.pow(yBg, 0.56) - Math.pow(yTxt, 0.56)) * 1.14;
        return Math.round(sapc * 1000) / 10;
    }

    /**
     * Generates an automated contrast remediation color that satisfies target contrast ratio.
     */
    public static suggestRemediation(
        fgInput: string | RGBA,
        bgInput: string | RGBA,
        targetRatio: number = 4.5
    ): string {
        const currentRatio = WCAGContrastAuditor.calculateContrastRatio(fgInput, bgInput);
        const fgRaw = typeof fgInput === 'string' ? WCAGContrastAuditor.parseColor(fgInput) : fgInput;
        const bgRaw = typeof bgInput === 'string' ? WCAGContrastAuditor.parseColor(bgInput) : bgInput;

        if (currentRatio >= targetRatio) {
            return WCAGContrastAuditor.toHex(fgRaw);
        }

        const bgLum = WCAGContrastAuditor.calculateRelativeLuminance(bgRaw);
        // If background is light (lum > 0.4), darken foreground towards black; else lighten towards white
        const targetColor: RGBA = bgLum > 0.4
            ? { r: 0, g: 0, b: 0, a: 1.0 }
            : { r: 255, g: 255, b: 255, a: 1.0 };

        // Binary search for minimal delta
        let low = 0.0;
        let high = 1.0;
        let bestHex = WCAGContrastAuditor.toHex(targetColor);

        for (let i = 0; i < 15; i++) {
            const mid = (low + high) / 2;
            const candidate: RGBA = {
                r: Math.round(fgRaw.r + (targetColor.r - fgRaw.r) * mid),
                g: Math.round(fgRaw.g + (targetColor.g - fgRaw.g) * mid),
                b: Math.round(fgRaw.b + (targetColor.b - fgRaw.b) * mid),
                a: 1.0
            };

            const ratio = WCAGContrastAuditor.calculateContrastRatio(candidate, bgRaw);
            if (ratio >= targetRatio) {
                bestHex = WCAGContrastAuditor.toHex(candidate);
                high = mid; // Try smaller change
            } else {
                low = mid;
            }
        }

        return bestHex;
    }

    /**
     * Audits a specific foreground and background pair.
     */
    public auditPair(foreground: string, background: string): AuditResult {
        const fg = WCAGContrastAuditor.parseColor(foreground);
        const bg = WCAGContrastAuditor.parseColor(background);

        const ratio = WCAGContrastAuditor.calculateContrastRatio(fg, bg);
        const lumFg = WCAGContrastAuditor.calculateRelativeLuminance(fg);
        const lumBg = WCAGContrastAuditor.calculateRelativeLuminance(bg);
        const apca = WCAGContrastAuditor.calculateAPCA(fg, bg);

        const passesAA_NormalText = ratio >= 4.5;
        const passesAA_LargeText = ratio >= 3.0;
        const passesAA_UIComponent = ratio >= 3.0;
        const passesAAA_NormalText = ratio >= 7.0;
        const passesAAA_LargeText = ratio >= 4.5;

        let suggestedRemediation = undefined;
        if (!passesAA_NormalText) {
            suggestedRemediation = {
                targetRatio: 4.5,
                suggestedHex: WCAGContrastAuditor.suggestRemediation(fg, bg, 4.5)
            };
        }

        return {
            foregroundHex: WCAGContrastAuditor.toHex(fg),
            backgroundHex: WCAGContrastAuditor.toHex(bg),
            contrastRatio: ratio,
            relativeLuminanceForeground: lumFg,
            relativeLuminanceBackground: lumBg,
            passesAA_NormalText,
            passesAA_LargeText,
            passesAA_UIComponent,
            passesAAA_NormalText,
            passesAAA_LargeText,
            apcaScore: apca,
            suggestedRemediation
        };
    }

    /**
     * Audits an entire design system theme palette.
     */
    public auditTheme(pairs: ThemeAuditPair[]): ThemeAuditReport {
        let passedCount = 0;
        let failedCount = 0;

        const results = pairs.map(p => {
            const audit = this.auditPair(p.foreground, p.background);
            const context = p.context ?? 'NORMAL';

            let passed = false;
            if (context === 'NORMAL') passed = audit.passesAA_NormalText;
            else if (context === 'LARGE') passed = audit.passesAA_LargeText;
            else if (context === 'UI_COMPONENT') passed = audit.passesAA_UIComponent;

            if (passed) passedCount++;
            else failedCount++;

            return {
                ...audit,
                element: p.element,
                context
            };
        });

        return {
            totalAudited: pairs.length,
            passedCount,
            failedCount,
            results
        };
    }
}

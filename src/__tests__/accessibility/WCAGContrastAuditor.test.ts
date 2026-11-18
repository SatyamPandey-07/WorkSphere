import {
    WCAGContrastAuditor,
    ThemeAuditPair
} from '../../core/accessibility/WCAGContrastAuditor';

describe('WCAGContrastAuditor', () => {
    let auditor: WCAGContrastAuditor;

    beforeEach(() => {
        auditor = new WCAGContrastAuditor();
    });

    describe('Color Parsing and Formatting', () => {
        it('parses various hex, rgb, and named color formats', () => {
            const white = WCAGContrastAuditor.parseColor('#ffffff');
            expect(white).toEqual({ r: 255, g: 255, b: 255, a: 1.0 });

            const shortHex = WCAGContrastAuditor.parseColor('#000');
            expect(shortHex).toEqual({ r: 0, g: 0, b: 0, a: 1.0 });

            const rgba = WCAGContrastAuditor.parseColor('rgba(255, 128, 0, 0.8)');
            expect(rgba).toEqual({ r: 255, g: 128, b: 0, a: 0.8 });

            const named = WCAGContrastAuditor.parseColor('black');
            expect(named).toEqual({ r: 0, g: 0, b: 0, a: 1.0 });
        });

        it('throws an error on malformed color inputs', () => {
            expect(() => WCAGContrastAuditor.parseColor('invalid-color')).toThrow();
        });
    });

    describe('Relative Luminance and Mathematical Contrast Ratios', () => {
        it('calculates exact 21:1 ratio for pure black against pure white', () => {
            const black = WCAGContrastAuditor.parseColor('#000000');
            const white = WCAGContrastAuditor.parseColor('#ffffff');

            expect(WCAGContrastAuditor.calculateRelativeLuminance(black)).toBe(0);
            expect(WCAGContrastAuditor.calculateRelativeLuminance(white)).toBe(1);

            const ratio = WCAGContrastAuditor.calculateContrastRatio(black, white);
            expect(ratio).toBe(21);
        });

        it('calculates 1:1 ratio for identical colors', () => {
            const ratio = WCAGContrastAuditor.calculateContrastRatio('#123456', '#123456');
            expect(ratio).toBe(1.0);
        });

        it('verifies standard accessible gray (#767676 on #ffffff) satisfies AA 4.5:1', () => {
            const ratio = WCAGContrastAuditor.calculateContrastRatio('#767676', '#ffffff');
            expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
    });

    describe('Alpha Compositing over Solid Backgrounds', () => {
        it('composites semi-transparent foreground over white canvas', () => {
            const semiBlack = WCAGContrastAuditor.parseColor('rgba(0, 0, 0, 0.5)');
            const white = WCAGContrastAuditor.parseColor('#ffffff');
            const composited = WCAGContrastAuditor.composite(semiBlack, white);

            expect(composited.r).toBeCloseTo(128, -1);
            expect(composited.g).toBeCloseTo(128, -1);
            expect(composited.b).toBeCloseTo(128, -1);
            expect(composited.a).toBe(1.0);
        });
    });

    describe('Pair Auditing & Automated Remediation', () => {
        it('generates complete audit result and flags failing low-contrast text', () => {
            // Low contrast gray on white (#aaaaaa on #ffffff has ratio ~2.3:1)
            const result = auditor.auditPair('#aaaaaa', '#ffffff');

            expect(result.contrastRatio).toBeLessThan(4.5);
            expect(result.passesAA_NormalText).toBe(false);
            expect(result.passesAAA_NormalText).toBe(false);
            expect(result.suggestedRemediation).toBeDefined();

            // Verify the remediation actually satisfies target ratio 4.5
            const remediatedHex = result.suggestedRemediation!.suggestedHex;
            const newRatio = WCAGContrastAuditor.calculateContrastRatio(remediatedHex, '#ffffff');
            expect(newRatio).toBeGreaterThanOrEqual(4.5);
        });

        it('confirms high contrast passes AAA standards without suggesting remediation', () => {
            const result = auditor.auditPair('#000000', '#ffffff');
            expect(result.passesAA_NormalText).toBe(true);
            expect(result.passesAAA_NormalText).toBe(true);
            expect(result.suggestedRemediation).toBeUndefined();
        });
    });

    describe('Theme Palette Matrix Auditing', () => {
        it('audits multi-element design system theme and generates summary report', () => {
            const themeTokens: ThemeAuditPair[] = [
                { element: 'Primary Button Text', foreground: '#ffffff', background: '#0066cc', context: 'NORMAL' },
                { element: 'Muted Caption', foreground: '#cccccc', background: '#ffffff', context: 'NORMAL' }, // fails
                { element: 'Hero Header', foreground: '#222222', background: '#f5f5f5', context: 'LARGE' },
                { element: 'Focus Ring Outline', foreground: '#0055ff', background: '#ffffff', context: 'UI_COMPONENT' }
            ];

            const report = auditor.auditTheme(themeTokens);
            expect(report.totalAudited).toBe(4);
            expect(report.passedCount).toBeGreaterThanOrEqual(3);
            expect(report.failedCount).toBe(1);
        });
    });
});

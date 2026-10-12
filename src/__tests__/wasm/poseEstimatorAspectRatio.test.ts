/**
 * poseEstimatorAspectRatio.test.ts
 * Unit test harness testing portrait (9:16), square (1:1), and ultrawide (21:9) aspect ratios
 * to verify dynamic stride calculation, letterboxing, and prevention of buffer overruns (#5740).
 */

describe('pose_estimator non-standard aspect ratios and buffer safety (#5740)', () => {
    const MODEL_INPUT_WIDTH = 256;
    const MODEL_INPUT_HEIGHT = 256;

    interface LetterboxParams {
        scale: number;
        padX: number;
        padY: number;
        scaledW: number;
        scaledH: number;
        targetW: number;
        targetH: number;
        srcW: number;
        srcH: number;
        srcStride: number;
    }

    /**
     * JavaScript reference implementation matching C calculate_letterbox_params in pose_estimator.c
     */
    function calculateLetterboxParams(
        srcW: number,
        srcH: number,
        srcStride: number,
        targetW: number = MODEL_INPUT_WIDTH,
        targetH: number = MODEL_INPUT_HEIGHT
    ): LetterboxParams {
        const safeSrcW = srcW <= 0 ? 1 : srcW;
        const safeSrcH = srcH <= 0 ? 1 : srcH;
        const safeTargetW = targetW <= 0 ? MODEL_INPUT_WIDTH : targetW;
        const safeTargetH = targetH <= 0 ? MODEL_INPUT_HEIGHT : targetH;
        const stride = srcStride > 0 ? srcStride : safeSrcW;

        const scaleX = safeTargetW / safeSrcW;
        const scaleY = safeTargetH / safeSrcH;
        const scale = Math.min(scaleX, scaleY);

        let scaledW = Math.round(safeSrcW * scale);
        let scaledH = Math.round(safeSrcH * scale);
        if (scaledW > safeTargetW) scaledW = safeTargetW;
        if (scaledH > safeTargetH) scaledH = safeTargetH;

        const padX = Math.floor((safeTargetW - scaledW) / 2);
        const padY = Math.floor((safeTargetH - scaledH) / 2);

        return {
            scale,
            padX,
            padY,
            scaledW,
            scaledH,
            targetW: safeTargetW,
            targetH: safeTargetH,
            srcW: safeSrcW,
            srcH: safeSrcH,
            srcStride: stride
        };
    }

    /**
     * JavaScript reference implementation matching C preprocess_letterbox in pose_estimator.c
     */
    function preprocessLetterbox(
        src: Uint8Array,
        srcW: number,
        srcH: number,
        srcStride: number,
        targetW: number = MODEL_INPUT_WIDTH,
        targetH: number = MODEL_INPUT_HEIGHT
    ): { dst: Uint8Array; params: LetterboxParams; maxAccessedSrcIdx: number } {
        const params = calculateLetterboxParams(srcW, srcH, srcStride, targetW, targetH);
        const dst = new Uint8Array(targetW * targetH);
        const totalDstPixels = targetW * targetH;
        const maxSrcIdx = srcH * params.srcStride - 1;
        let maxAccessedSrcIdx = -1;

        for (let dy = 0; dy < params.scaledH; dy++) {
            const dstY = params.padY + dy;
            if (dstY < 0 || dstY >= targetH) continue;

            let srcY = Math.floor(dy / params.scale);
            if (srcY >= srcH) srcY = srcH - 1;
            if (srcY < 0) srcY = 0;

            const rowOffset = srcY * params.srcStride;

            for (let dx = 0; dx < params.scaledW; dx++) {
                const dstX = params.padX + dx;
                if (dstX < 0 || dstX >= targetW) continue;

                let srcX = Math.floor(dx / params.scale);
                if (srcX >= srcW) srcX = srcW - 1;
                if (srcX < 0) srcX = 0;

                const srcIdx = rowOffset + srcX;
                const dstIdx = dstY * targetW + dstX;

                // Strict bounds assertion
                expect(srcIdx).toBeGreaterThanOrEqual(0);
                expect(srcIdx).toBeLessThanOrEqual(maxSrcIdx);
                expect(dstIdx).toBeGreaterThanOrEqual(0);
                expect(dstIdx).toBeLessThan(totalDstPixels);

                if (srcIdx > maxAccessedSrcIdx) {
                    maxAccessedSrcIdx = srcIdx;
                }

                dst[dstIdx] = src[srcIdx];
            }
        }

        return { dst, params, maxAccessedSrcIdx };
    }

    describe('Portrait Aspect Ratio (9:16)', () => {
        it('safely normalizes portrait frames (e.g. 720x1280) with horizontal letterbox padding', () => {
            const width = 720;
            const height = 1280;
            const src = new Uint8Array(width * height);
            // Fill with gradient test pattern
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    src[y * width + x] = (x + y) % 255;
                }
            }

            const { dst, params, maxAccessedSrcIdx } = preprocessLetterbox(src, width, height, width);

            // Scale should be constrained by height (256 / 1280 = 0.2)
            expect(params.scale).toBeCloseTo(256 / 1280, 4);
            expect(params.scaledH).toBe(256);
            expect(params.padY).toBe(0);
            expect(params.scaledW).toBe(144);
            expect(params.padX).toBe((256 - 144) / 2); // 56px horizontal padding on each side

            // Check that left and right border padding is unwritten (neutral 0)
            expect(dst[0]).toBe(0); // (0, 0) is outside the centered portrait frame
            expect(dst[128 * 256 + 10]).toBe(0); // Mid-height far left margin

            // Memory bounds: never exceed buffer length
            expect(maxAccessedSrcIdx).toBeLessThan(width * height);
        });
    });

    describe('Square Aspect Ratio (1:1)', () => {
        it('safely normalizes 1:1 square frames (e.g. 500x500) without padding', () => {
            const width = 500;
            const height = 500;
            const src = new Uint8Array(width * height);
            src.fill(128);

            const { dst, params, maxAccessedSrcIdx } = preprocessLetterbox(src, width, height, width);

            expect(params.scale).toBeCloseTo(256 / 500, 4);
            expect(params.scaledW).toBe(256);
            expect(params.scaledH).toBe(256);
            expect(params.padX).toBe(0);
            expect(params.padY).toBe(0);

            // Whole destination buffer should be filled with 128
            expect(dst[0]).toBe(128);
            expect(dst[256 * 256 - 1]).toBe(128);
            expect(maxAccessedSrcIdx).toBeLessThan(width * height);
        });
    });

    describe('Ultrawide Aspect Ratio (21:9)', () => {
        it('safely normalizes 21:9 ultrawide frames (e.g. 2560x1080) with vertical letterbox padding', () => {
            const width = 2560;
            const height = 1080;
            // Test with dynamic row stride (e.g. 2560 + 64 byte hardware alignment padding = 2624)
            const stride = width + 64;
            const src = new Uint8Array(stride * height);
            src.fill(200);

            const { dst, params, maxAccessedSrcIdx } = preprocessLetterbox(src, width, height, stride);

            // Scale constrained by width (256 / 2560 = 0.1)
            expect(params.scale).toBeCloseTo(256 / 2560, 4);
            expect(params.scaledW).toBe(256);
            expect(params.padX).toBe(0);
            expect(params.scaledH).toBe(108);
            expect(params.padY).toBe((256 - 108) / 2); // 74px vertical padding on top and bottom

            // Top margin should be empty/neutral
            expect(dst[0]).toBe(0);
            expect(dst[20 * 256 + 128]).toBe(0);

            // Center image should be populated
            const centerIdx = (params.padY + 10) * 256 + 128;
            expect(dst[centerIdx]).toBe(200);

            // Absolute buffer bounds check with dynamic stride
            expect(maxAccessedSrcIdx).toBeLessThan(stride * height);
        });
    });

    describe('Extreme Ratios and Edge Cases', () => {
        it('handles 1-pixel high or wide frames without divide-by-zero or crash', () => {
            const src1 = new Uint8Array(100 * 1);
            const { params: p1 } = preprocessLetterbox(src1, 100, 1, 100);
            expect(p1.scaledW).toBe(256);
            expect(p1.scaledH).toBeGreaterThanOrEqual(1);

            const src2 = new Uint8Array(1 * 100);
            const { params: p2 } = preprocessLetterbox(src2, 1, 100, 1);
            expect(p2.scaledH).toBe(256);
            expect(p2.scaledW).toBeGreaterThanOrEqual(1);
        });

        it('handles zero or negative dimensions safely', () => {
            const params = calculateLetterboxParams(0, 0, 0);
            expect(params.scale).toBeGreaterThan(0);
            expect(params.scaledW).toBeGreaterThan(0);
            expect(params.scaledH).toBeGreaterThan(0);
        });
    });
});

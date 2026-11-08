/**
 * FrequencyResponseCanvas.tsx
 * Draws real-time frequency response curve using an HTML5 canvas.
 * Supports both light and dark mode themes.
 */

import React, { useRef, useEffect } from 'react';

interface FrequencyResponseCanvasProps {
    getFrequencyResponse: () => { frequencies: Float32Array; magnitudes: Float32Array };
    isDarkMode: boolean;
}

export const FrequencyResponseCanvas: React.FC<FrequencyResponseCanvasProps> = ({
    getFrequencyResponse,
    isDarkMode,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let isMounted = true;

        const draw = () => {
            if (!isMounted) return;

            const width = canvas.width;
            const height = canvas.height;

            if (width <= 0 || height <= 0) {
                animationRef.current = requestAnimationFrame(draw);
                return;
            }

            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = isDarkMode ? '#111827' : '#f3f4f6';
            ctx.fillRect(0, 0, width, height);

            // Grid lines
            ctx.strokeStyle = isDarkMode ? '#374151' : '#d1d5db';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 1; i < 5; i++) {
                const y = (height / 5) * i;
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
            ctx.stroke();

            // Safe retrieval of frequency response data
            let responseData: { frequencies?: Float32Array; magnitudes?: Float32Array } | null = null;
            try {
                if (typeof getFrequencyResponse === 'function') {
                    responseData = getFrequencyResponse();
                }
            } catch {
                responseData = null;
            }

            const frequencies = responseData?.frequencies;
            const magnitudes = responseData?.magnitudes;

            if (
                frequencies &&
                magnitudes &&
                frequencies.length > 0 &&
                magnitudes.length > 0
            ) {
                // Frequency curve
                ctx.strokeStyle = isDarkMode ? '#3b82f6' : '#2563eb';
                ctx.lineWidth = 2;
                ctx.beginPath();

                const step = Math.max(1, Math.ceil(frequencies.length / width));
                for (let i = 0; i < width; i++) {
                    const rawMagnitude = magnitudes[i * step];
                    const safeMagnitude =
                        typeof rawMagnitude === 'number' && Number.isFinite(rawMagnitude) && rawMagnitude > 0
                            ? rawMagnitude
                            : 0.0001;

                    // Convert magnitude (0 to 1+) to dB, then map to canvas height
                    const db = 20 * Math.log10(safeMagnitude);
                    const safeDb = Number.isFinite(db) ? db : -20;
                    const clampedDb = Math.max(-20, Math.min(20, safeDb));
                    const y = height - ((clampedDb + 20) / 40) * height;
                    const safeY = Number.isFinite(y) ? y : height / 2;

                    if (i === 0) {
                        ctx.moveTo(i, safeY);
                    } else {
                        ctx.lineTo(i, safeY);
                    }
                }
                ctx.stroke();
            }

            if (isMounted) {
                animationRef.current = requestAnimationFrame(draw);
            }
        };

        draw();

        return () => {
            isMounted = false;
            if (animationRef.current !== undefined) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [getFrequencyResponse, isDarkMode]);

    return (
        <canvas
            ref={canvasRef}
            data-testid="frequency-response-canvas"
            aria-label="Equalizer frequency response curve"
            width={600}
            height={150}
            className="w-full h-32 rounded-lg border border-gray-200 dark:border-gray-700"
        />
    );
};

export default FrequencyResponseCanvas;

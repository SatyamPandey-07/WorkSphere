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
    const animationRef = useRef<number>();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const draw = () => {
            const { frequencies, magnitudes } = getFrequencyResponse();
            const width = canvas.width;
            const height = canvas.height;

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

            // Frequency curve
            ctx.strokeStyle = isDarkMode ? '#3b82f6' : '#2563eb';
            ctx.lineWidth = 2;
            ctx.beginPath();

            const step = Math.ceil(frequencies.length / width);
            for (let i = 0; i < width; i++) {
                const magnitude = magnitudes[i * step];
                // Convert magnitude (0 to 1+) to dB, then map to canvas height
                const db = 20 * Math.log10(magnitude || 0.0001);
                const clampedDb = Math.max(-20, Math.min(20, db));
                const y = height - ((clampedDb + 20) / 40) * height;

                if (i === 0) {
                    ctx.moveTo(i, y);
                } else {
                    ctx.lineTo(i, y);
                }
            }
            ctx.stroke();

            animationRef.current = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [getFrequencyResponse, isDarkMode]);

    return (
        <canvas
            ref={canvasRef}
            width={600}
            height={150}
            className="w-full h-32 rounded-lg border border-gray-200 dark:border-gray-700"
        />
    );
};

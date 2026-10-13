/**
 * OffscreenHeatmapRenderer.test.ts
 * Unit tests for the OffscreenHeatmapRenderer class.
 */

import { OffscreenHeatmapRenderer } from '@/lib/admin/OffscreenHeatmapRenderer';

describe('OffscreenHeatmapRenderer', () => {
    let mockCanvas: any;
    let mockGl: any;

    beforeEach(() => {
        mockGl = {
            getContext: jest.fn().mockReturnValue({
                createShader: jest.fn().mockReturnValue({}),
                shaderSource: jest.fn(),
                compileShader: jest.fn(),
                createProgram: jest.fn().mockReturnValue({}),
                attachShader: jest.fn(),
                linkProgram: jest.fn(),
                useProgram: jest.fn(),
                createBuffer: jest.fn().mockReturnValue({}),
                bindBuffer: jest.fn(),
                bufferData: jest.fn(),
                viewport: jest.fn(),
                clearColor: jest.fn(),
                clear: jest.fn(),
                enable: jest.fn(),
                blendFunc: jest.fn(),
                getAttribLocation: jest.fn().mockReturnValue(0),
                enableVertexAttribArray: jest.fn(),
                vertexAttribPointer: jest.fn(),
                drawArrays: jest.fn(),
                VERTEX_SHADER: 1,
                FRAGMENT_SHADER: 2,
                ARRAY_BUFFER: 1,
                DYNAMIC_DRAW: 1,
                BLEND: 1,
                SRC_ALPHA: 1,
                ONE: 1,
                POINTS: 0,
                FLOAT: 1,
            }),
        };

        mockCanvas = {
            getContext: jest.fn().mockReturnValue(mockGl),
        };
    });

    it('should initialize WebGL context and buffers', () => {
        const renderer = new OffscreenHeatmapRenderer(mockCanvas, 800, 600);
        expect(mockCanvas.getContext).toHaveBeenCalledWith('webgl', { alpha: true });
        expect(renderer['gl']).not.toBeNull();
    });

    it('should update data buffers correctly', () => {
        const renderer = new OffscreenHeatmapRenderer(mockCanvas, 800, 600);
        const coords = new Float32Array([0.1, 0.2]);
        const intensities = new Float32Array([0.5]);

        renderer.updateData(coords, intensities);

        expect(renderer['gl']!.bindBuffer).toHaveBeenCalled();
        expect(renderer['gl']!.bufferData).toHaveBeenCalled();
    });

    it('should trigger render with correct WebGL calls', () => {
        const renderer = new OffscreenHeatmapRenderer(mockCanvas, 800, 600);
        renderer.render();

        expect(renderer['gl']!.clear).toHaveBeenCalled();
        expect(renderer['gl']!.drawArrays).toHaveBeenCalled();
    });
});

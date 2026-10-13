import { CongestionHeatmapBuilder } from './CongestionHeatmapBuilder';

describe('CongestionHeatmapBuilder routing', () => {
    it('removes stale nodes and finds a route around a disconnected node', () => {
        const builder = new CongestionHeatmapBuilder();
        const now = 100000;

        for (const nodeId of ['start', 'stale', 'alternate', 'destination']) {
            builder.recordNodeHeartbeat(nodeId, now - (nodeId === 'stale' ? 20000 : 0));
        }
        builder.updateRoutingTable({
            start: ['stale', 'alternate'],
            stale: ['start', 'destination'],
            alternate: ['start', 'destination'],
            destination: ['stale', 'alternate']
        });

        expect(builder.getActiveRoutingTable(now)).not.toHaveProperty('stale');
        expect(builder.getActiveRoutingTable(now).start).toEqual(['alternate']);
        expect(builder.getRoute('start', 'destination', now)).toEqual([
            'start',
            'alternate',
            'destination'
        ]);
    });

    it('excludes stale node telemetry from bandwidth heatmap values', () => {
        const builder = new CongestionHeatmapBuilder();
        const now = 100000;

        builder.addDataPoint({
            x: 1,
            y: 1,
            downloadSpeedMbps: 100,
            uploadSpeedMbps: 50,
            timestamp: now - 20000,
            nodeId: 'stale-node'
        });
        builder.addDataPoint({
            x: 1,
            y: 1,
            downloadSpeedMbps: 10,
            uploadSpeedMbps: 5,
            timestamp: now,
            nodeId: 'active-node'
        });

        expect(builder.generateHeatmapData(now)).toEqual([{ x: 2.5, y: 2.5, value: 10 }]);
    });
});

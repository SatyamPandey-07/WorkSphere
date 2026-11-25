import {
  MapTileZoomController,
  type MapTilePayload,
} from '@/lib/maps/mapTileLoader';

describe('MapTileZoomController stale response protection', () => {
  it('discards out-of-order slow responses from a previous zoom level and keeps the latest zoom layer', async () => {
    const applied: Array<MapTilePayload<string>> = [];
    const controller = new MapTileZoomController<string>({
      initialZoom: 10,
      nowFn: () => 1_000,
    });

    let resolveZoom12!: (val: string) => void;
    let resolveZoom15!: (val: string) => void;

    const slowZoom12Promise = controller.loadTile(
      { z: 12, x: 100, y: 200 },
      () =>
        new Promise<string>((resolve) => {
          resolveZoom12 = resolve;
        }),
      (p) => applied.push(p)
    );

    const fastZoom15Promise = controller.loadTile(
      { z: 15, x: 800, y: 1600 },
      () =>
        new Promise<string>((resolve) => {
          resolveZoom15 = resolve;
        }),
      (p) => applied.push(p)
    );

    resolveZoom15('tile-z15');
    const outcome15 = await fastZoom15Promise;
    expect(outcome15.status).toBe('applied');
    expect(outcome15.payload?.data).toBe('tile-z15');

    resolveZoom12('tile-z12-late');
    const outcome12 = await slowZoom12Promise;
    expect(['stale_discarded', 'aborted']).toContain(outcome12.status);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.coord.z).toBe(15);
    expect(applied[0]?.data).toBe('tile-z15');
    expect(controller.getCurrentZoom()).toBe(15);
  });

  it('discards non-aborted out-of-order responses when token advances without signal abort', async () => {
    const applied: string[] = [];
    const controller = new MapTileZoomController<string>({ initialZoom: 8 });

    let resolveFirst!: (val: string) => void;
    const firstPromise = controller.loadTile(
      { z: 9, x: 10, y: 20 },
      (_coord, _signal) =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
      (p) => applied.push(p.data)
    );

    controller.setZoom(11, false);

    resolveFirst('stale-z9-data');
    const result = await firstPromise;

    expect(result.status).toBe('stale_discarded');
    expect(applied).toEqual([]);
  });
});

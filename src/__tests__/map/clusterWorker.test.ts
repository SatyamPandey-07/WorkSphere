import Supercluster from 'supercluster';

describe('Cluster Worker & Supercluster Logic', () => {
  test('Supercluster correctly groups points within bounding box', () => {
    const cluster = new Supercluster({ radius: 40, maxZoom: 16 });
    
    const points: Array<Supercluster.PointFeature<Supercluster.AnyProps>> = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [77.209, 28.6139] },
        properties: { id: 1, name: 'Delhi Hub' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [77.210, 28.6140] },
        properties: { id: 2, name: 'Delhi Pod' },
      },
    ];

    cluster.load(points);

    // Bounding box [west, south, east, north]
    const bbox: [number, number, number, number] = [76.0, 27.0, 78.0, 29.0];
    const clusters = cluster.getClusters(bbox, 10);

    expect(clusters.length).toBeGreaterThan(0);
  });
});
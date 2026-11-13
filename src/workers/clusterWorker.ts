import Supercluster from 'supercluster';

let cluster: Supercluster | null = null;

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT': {
      const { points, options } = payload;
      cluster = new Supercluster(options || { radius: 40, maxZoom: 16 });
      cluster.load(points);
      self.postMessage({ type: 'INIT_SUCCESS' });
      break;
    }

    case 'GET_CLUSTERS': {
      if (!cluster) {
        self.postMessage({ type: 'ERROR', message: 'Cluster index not initialized.' });
        return;
      }
      const { bbox, zoom } = payload;
      const clusters = cluster.getClusters(bbox, zoom);
      self.postMessage({ type: 'CLUSTERS_RESULT', payload: clusters });
      break;
    }

    default:
      console.warn('Unknown message type in clusterWorker:', type);
  }
};
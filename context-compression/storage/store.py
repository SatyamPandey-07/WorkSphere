import json
import os
import pickle
from collections import OrderedDict
from typing import Any, Dict, List, Optional

try:
    from ..embedding.embedder import Embedder
    from ..index.hnsw_index import HNSWIndex, _HNSWNode
except (ImportError, ValueError):
    from embedding.embedder import Embedder
    from index.hnsw_index import HNSWIndex, _HNSWNode


class VectorStore:
    def __init__(
        self,
        dimension: int = 128,
        m: int = 16,
        ef_search: int = 50,
        cache_size: int = 1000,
    ):
        self.dimension = dimension
        self.index = HNSWIndex(
            dimension=dimension, m=m, ef_search=ef_search
        )
        self.embedder = Embedder(dimension=dimension)
        self._metadata: Dict[int, dict] = {}
        self._cache_size = max(0, cache_size)
        self._embedding_cache: OrderedDict[str, List[float]] = OrderedDict()
        self._cache_hits: int = 0
        self._cache_misses: int = 0

    def add(self, text: str, metadata: Optional[Dict] = None) -> int:
        vector = self.embedder.embed(text)
        node_id = self.index.add(vector, metadata=metadata)
        self._metadata[node_id] = {"text": text, **(metadata or {})}
        return node_id

    def add_batch(self, texts: List[str], metadatas: Optional[List[Dict]] = None) -> List[int]:
        vectors = self.embedder.embed_batch(texts)
        ids = []
        for i, (text, vector) in enumerate(zip(texts, vectors)):
            meta = metadatas[i] if metadatas else None
            node_id = self.index.add(vector, metadata=meta)
            self._metadata[node_id] = {"text": text, **(meta or {})}
            ids.append(node_id)
        return ids

    def _get_embedding(self, text: str) -> List[float]:
        """Return the embedding for *text*, using the LRU cache when possible."""
        if self._cache_size <= 0:
            self._cache_misses += 1
            return self.embedder.embed(text)

        if text in self._embedding_cache:
            # Move to end (most-recently used)
            self._embedding_cache.move_to_end(text)
            self._cache_hits += 1
            return self._embedding_cache[text]

        # Cache miss – compute, store, and possibly evict
        self._cache_misses += 1
        vector = self.embedder.embed(text)
        self._embedding_cache[text] = vector
        if len(self._embedding_cache) > self._cache_size:
            self._embedding_cache.popitem(last=False)  # evict LRU
        return vector

    def search(self, query: str, k: int = 10) -> List[Dict]:
        query_vector = self._get_embedding(query)
        results = self.index.search(query_vector, k=k)
        output = []
        for similarity, node_id, metadata in results:
            item = {"similarity": similarity, "node_id": node_id}
            if node_id in self._metadata:
                item["text"] = self._metadata[node_id].get("text", "")
                item["metadata"] = self._metadata[node_id]
            if metadata:
                item["metadata"] = {**(item.get("metadata", {})), **metadata}
            output.append(item)
        return output

    def remove(self, node_id: int) -> bool:
        if node_id in self._metadata:
            del self._metadata[node_id]
        return self.index.remove(node_id)

    def save(self, path: str):
        data = {
            "dimension": self.dimension,
            "metadata": self._metadata,
        }
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(f"{path}.meta.json", "w") as f:
            json.dump(data, f)
        state = {
            "nodes": {
                nid: {
                    "id": node.id,
                    "vector": node.vector,
                    "metadata": node.metadata,
                    "neighbors": node.neighbors,
                }
                for nid, node in self.index._nodes.items()
            },
            "entry_point": self.index._entry_point,
            "max_level": self.index._max_level,
            "size": self.index._size,
            "next_id": self.index._next_id,
        }
        with open(f"{path}.hnsw.pkl", "wb") as f:
            pickle.dump(state, f)

    def load(self, path: str):
        with open(f"{path}.meta.json", "r") as f:
            data = json.load(f)
        self.dimension = data["dimension"]
        self._metadata = {int(k): v for k, v in data["metadata"].items()}
        with open(f"{path}.hnsw.pkl", "rb") as f:
            state = pickle.load(f)
        self.index = HNSWIndex(dimension=self.dimension)
        self.index._entry_point = state["entry_point"]
        self.index._max_level = state["max_level"]
        self.index._size = state["size"]
        self.index._next_id = state["next_id"]

        for nid, ndata in state["nodes"].items():
            nid_int = int(nid)
            node = _HNSWNode(nid_int, ndata["vector"], ndata["metadata"])
            node.neighbors = {
                int(lvl): nbrs for lvl, nbrs in ndata["neighbors"].items()
            }
            self.index._nodes[nid_int] = node

        # Invalidate embedding cache – the loaded index may differ from the
        # previous state, so cached query vectors could be stale.
        self._embedding_cache.clear()
        self._cache_hits = 0
        self._cache_misses = 0

    def size(self) -> int:
        return self.index.size()

    def clear(self):
        self.index.clear()
        self._metadata.clear()
        self._embedding_cache.clear()
        self._cache_hits = 0
        self._cache_misses = 0

    def get_cache_metrics(self) -> Dict[str, Any]:
        """Return embedding-cache statistics for the /api/metrics endpoint."""
        total = self._cache_hits + self._cache_misses
        return {
            "cache_size": len(self._embedding_cache),
            "cache_capacity": self._cache_size,
            "cache_hits": self._cache_hits,
            "cache_misses": self._cache_misses,
            "cache_hit_rate": round(self._cache_hits / total, 4) if total > 0 else 0.0,
        }

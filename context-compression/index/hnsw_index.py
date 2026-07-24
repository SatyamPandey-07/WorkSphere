import heapq
import math
import random
from typing import Any, Callable, Dict, List, Optional, Tuple


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(ai * bi for ai, bi in zip(a, b))
    na = math.sqrt(sum(ai * ai for ai in a))
    nb = math.sqrt(sum(bi * bi for bi in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _l2_distance(a: List[float], b: List[float]) -> float:
    return math.sqrt(sum((ai - bi) ** 2 for ai, bi in zip(a, b)))


class _HNSWNode:
    __slots__ = ("id", "vector", "metadata", "neighbors")

    def __init__(self, node_id: int, vector: List[float], metadata: Optional[Dict] = None):
        self.id = node_id
        self.vector = vector
        self.metadata = metadata or {}
        self.neighbors: Dict[int, List[int]] = {}


class HNSWIndex:
    def __init__(
        self,
        dimension: int,
        max_elements: int = 10000,
        m: int = 16,
        ef_construction: int = 200,
        ef_search: int = 50,
        ml: Optional[float] = None,
        distance_fn: Optional[Callable] = None,
    ):
        self.dimension = dimension
        self.max_elements = max_elements
        self.m = m
        self.m_max = m
        self.m_max0 = 2 * m
        self.ef_construction = ef_construction
        self.ef_search = ef_search
        self.ml = ml if ml is not None else 1.0 / math.log(max(1.0, m))
        self.distance_fn = distance_fn or _l2_distance
        self.similarity_fn = _cosine_similarity

        self._nodes: Dict[int, _HNSWNode] = {}
        self._entry_point: Optional[int] = None
        self._max_level = 0
        self._size = 0
        self._next_id = 0
        self._level_mult = self.ml

    def _random_level(self) -> int:
        r = random.random()
        level = int(-math.log(r) * self._level_mult)
        return min(level, 32)

    def _distance(self, a: List[float], b: List[float]) -> float:
        return self.distance_fn(a, b)

    def _search_layer(
        self, query: List[float], ep: int, level: int, ef: int
    ) -> Tuple[Dict[int, float], Dict[int, float]]:
        visited = {ep}
        candidates = [(self._distance(query, self._nodes[ep].vector), ep)]
        result = {ep: self._distance(query, self._nodes[ep].vector)}

        while candidates:
            dist, node_id = heapq.heappop(candidates)
            farthest_dist = max(result.values()) if result else float("inf")
            if dist > farthest_dist:
                break

            for neighbor in self._nodes[node_id].neighbors.get(level, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    d = self._distance(query, self._nodes[neighbor].vector)
                    farthest_dist = max(result.values()) if result else float("inf")
                    if d < farthest_dist or len(result) < ef:
                        heapq.heappush(candidates, (d, neighbor))
                        result[neighbor] = d
                        if len(result) > ef:
                            farthest = max(result, key=lambda k: result[k])
                            del result[farthest]

        return result, visited

    def _select_neighbors_simple(
        self, candidates: Dict[int, float], m: int
    ) -> List[int]:
        sorted_candidates = sorted(candidates.items(), key=lambda x: x[1])
        return [node_id for node_id, _ in sorted_candidates[:m]]

    def add(self, vector: List[float], metadata: Optional[Dict] = None) -> int:
        if len(vector) != self.dimension:
            raise ValueError(
                f"Vector dimension {len(vector)} != index dimension {self.dimension}"
            )
        if self._size >= self.max_elements:
            raise ValueError("Index is full")

        node_id = self._next_id
        self._next_id += 1
        node = _HNSWNode(node_id, vector, metadata)
        level = self._random_level()

        self._nodes[node_id] = node
        self._size += 1

        if self._entry_point is None:
            self._entry_point = node_id
            self._max_level = level
            for lvl in range(level + 1):
                node.neighbors[lvl] = []
            return node_id

        ep = self._entry_point
        curr_level = self._max_level

        for lvl in range(curr_level, level, -1):
            result, _ = self._search_layer(vector, ep, lvl, 1)
            ep = min(result, key=lambda k: result[k])

        for lvl in range(min(level, curr_level), -1, -1):
            result, _ = self._search_layer(vector, ep, lvl, self.ef_construction)
            neighbors = self._select_neighbors_simple(result, self.m)
            node.neighbors[lvl] = neighbors
            for neighbor_id in neighbors:
                if lvl not in self._nodes[neighbor_id].neighbors:
                    self._nodes[neighbor_id].neighbors[lvl] = []
                nbr_neighbors = self._nodes[neighbor_id].neighbors[lvl]
                nbr_neighbors.append(node_id)
                m_max_lvl = self.m_max0 if lvl == 0 else self.m_max
                if len(nbr_neighbors) > m_max_lvl:
                    dists = {
                        n: self._distance(
                            self._nodes[neighbor_id].vector, self._nodes[n].vector
                        )
                        for n in nbr_neighbors
                    }
                    sorted_nbrs = sorted(dists, key=lambda k: dists[k])
                    self._nodes[neighbor_id].neighbors[lvl] = sorted_nbrs[:m_max_lvl]
            ep = node_id

        if level > self._max_level:
            self._max_level = level
            self._entry_point = node_id

        return node_id

    def search(
        self, query: List[float], k: int = 10
    ) -> List[Tuple[float, int, Dict]]:
        if self._size == 0:
            return []

        ef = max(k, self.ef_search)
        ep = self._entry_point

        for lvl in range(self._max_level, 0, -1):
            result, _ = self._search_layer(query, ep, lvl, 1)
            ep = min(result, key=lambda r: result[r])

        result, _ = self._search_layer(query, ep, 0, ef)
        sorted_results = sorted(result.items(), key=lambda x: x[1])

        top_k = []
        for node_id, distance in sorted_results[:k]:
            node = self._nodes[node_id]
            similarity = _cosine_similarity(query, node.vector)
            top_k.append((similarity, node_id, node.metadata))

        return top_k

    def get(self, node_id: int) -> Optional[Dict]:
        node = self._nodes.get(node_id)
        if node is None:
            return None
        return {"id": node.id, "vector": node.vector, "metadata": node.metadata}

    def remove(self, node_id: int) -> bool:
        if node_id not in self._nodes:
            return False
        del self._nodes[node_id]
        self._size -= 1
        if self._entry_point == node_id:
            if self._size > 0:
                self._entry_point = next(iter(self._nodes))
            else:
                self._entry_point = None
        for node in self._nodes.values():
            for lvl in list(node.neighbors.keys()):
                if node_id in node.neighbors[lvl]:
                    node.neighbors[lvl].remove(node_id)
        return True

    def size(self) -> int:
        return self._size

    def clear(self):
        self._nodes.clear()
        self._entry_point = None
        self._max_level = 0
        self._size = 0
        self._next_id = 0

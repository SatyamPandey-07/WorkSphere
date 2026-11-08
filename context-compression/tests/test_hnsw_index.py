"""Regression tests for the HNSW graph invariants in ``index/hnsw_index.py``.

``add`` used to seed the search on each lower layer with the node being
inserted instead of the closest element found on the layer above. That node has
no links on the lower layers yet, so the search returned only itself: nodes
that drew a level >= 1 ended up with a self-loop and no inbound edges at layer
0, and recall collapsed to a few percent. These tests pin the graph invariants
and the search quality so that cannot silently regress again.
"""

import importlib
import math
import random
import sys
from pathlib import Path

import pytest

root_dir = str(Path(__file__).resolve().parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

cc_dir = str(Path(__file__).resolve().parent.parent)
if cc_dir not in sys.path:
    sys.path.insert(0, cc_dir)

cc = importlib.import_module("context-compression")
HNSWIndex = cc.HNSWIndex
VectorStore = cc.VectorStore

DIM = 32
N = 500
# Mutating tests (remove) rebuild their own index, so keep it small.
N_MUTATE = 300


def _unit(vec):
    norm = math.sqrt(sum(x * x for x in vec))
    return [x / norm for x in vec]


def _l2(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _random_vectors(count, seed):
    rng = random.Random(seed)
    return [_unit([rng.gauss(0, 1) for _ in range(DIM)]) for _ in range(count)]


def _build_index(vectors, seed=1234):
    # Node levels come from the global ``random`` module; seed it so the graph
    # (and therefore every assertion below) is reproducible.
    random.seed(seed)
    index = HNSWIndex(
        dimension=DIM,
        max_elements=len(vectors) + 10,
        m=16,
        ef_construction=100,
        ef_search=50,
    )
    for vector in vectors:
        index.add(vector)
    return index


def _reachable_on_layer_zero(index):
    seen = {index._entry_point}
    stack = [index._entry_point]
    while stack:
        current = stack.pop()
        for neighbor in index._nodes[current].neighbors.get(0, []):
            if neighbor in index._nodes and neighbor not in seen:
                seen.add(neighbor)
                stack.append(neighbor)
    return seen


def _recall_at_k(index, live_vectors, queries, k=10):
    hits = total = 0
    for query in queries:
        truth = set(
            sorted(live_vectors, key=lambda i: _l2(query, live_vectors[i]))[:k]
        )
        found = {node_id for _, node_id, _ in index.search(query, k=k)}
        hits += len(truth & found)
        total += k
    return hits / total


def _level(node):
    return max(node.neighbors) if node.neighbors else 0


@pytest.fixture(scope="module")
def vectors():
    return _random_vectors(N, seed=7)


@pytest.fixture(scope="module")
def queries():
    return _random_vectors(40, seed=99)


@pytest.fixture(scope="module")
def built_index(vectors):
    """One index shared by the read-only tests; never mutate it."""
    return _build_index(vectors)


@pytest.fixture
def mutable_index(vectors):
    return _build_index(vectors[:N_MUTATE])


class TestInsertionKeepsGraphConnected:
    def test_no_node_links_to_itself(self, built_index):
        index = built_index
        self_loops = [
            node.id
            for node in index._nodes.values()
            for neighbors in node.neighbors.values()
            if node.id in neighbors
        ]
        assert self_loops == []

    def test_nearly_every_node_is_reachable_on_layer_zero(self, built_index):
        index = built_index
        reachable = _reachable_on_layer_zero(index)
        assert len(reachable) >= 0.99 * N

    def test_every_node_has_layer_zero_neighbors(self, built_index):
        index = built_index
        isolated = [
            node.id for node in index._nodes.values() if not node.neighbors.get(0)
        ]
        assert isolated == []

    def test_node_has_an_adjacency_list_for_each_of_its_layers(self, built_index):
        index = built_index
        top = max(index._nodes.values(), key=_level)
        assert _level(top) == index._max_level
        assert set(top.neighbors) == set(range(index._max_level + 1))


class TestSearchQuality:
    def test_recall_matches_brute_force(self, built_index, vectors, queries):
        index = built_index
        live = dict(enumerate(vectors))
        assert _recall_at_k(index, live, queries) >= 0.9

    def test_stored_vector_is_its_own_nearest_neighbour(self, built_index, vectors):
        index = built_index
        sample = list(range(0, N, 5))
        misses = [
            i
            for i in sample
            if not index.search(vectors[i], k=1) or index.search(vectors[i], k=1)[0][1] != i
        ]
        assert len(misses) <= 0.05 * len(sample)


class TestRemove:
    def test_remove_unknown_id_returns_false(self, vectors):
        index = _build_index(vectors[:50])
        assert index.remove(10_000) is False
        assert index.size() == 50

    def test_removing_entry_point_selects_highest_remaining_layer(self, mutable_index):
        index = mutable_index
        for _ in range(6):
            assert index.remove(index._entry_point) is True
            top_level = max(_level(n) for n in index._nodes.values())
            assert _level(index._nodes[index._entry_point]) == top_level
            assert index._max_level == top_level

    def test_remove_scrubs_inbound_edges(self, mutable_index):
        index = mutable_index
        victims = list(range(0, N_MUTATE, 3))
        for victim in victims:
            assert index.remove(victim) is True
        dangling = [
            (node.id, target)
            for node in index._nodes.values()
            for neighbors in node.neighbors.values()
            for target in neighbors
            if target not in index._nodes
        ]
        assert dangling == []
        assert index.size() == N_MUTATE - len(victims)

    def test_search_stays_accurate_after_many_removals(self, mutable_index, vectors, queries):
        index = mutable_index
        rng = random.Random(3)
        victims = rng.sample(range(N_MUTATE), int(N_MUTATE * 0.4))
        for victim in victims:
            index.remove(victim)

        live = {i: vectors[i] for i in index._nodes}
        removed = set(victims)
        for query in queries:
            returned = {node_id for _, node_id, _ in index.search(query, k=10)}
            assert returned.isdisjoint(removed)
        assert len(_reachable_on_layer_zero(index)) >= 0.99 * len(live)
        assert _recall_at_k(index, live, queries) >= 0.9

    def test_removing_every_node_resets_the_index(self, vectors):
        index = _build_index(vectors[:25])
        for node_id in list(index._nodes):
            assert index.remove(node_id) is True
        assert index.size() == 0
        assert index._entry_point is None
        assert index._max_level == 0
        assert index.search(vectors[0], k=3) == []

    def test_index_is_reusable_after_being_emptied(self, vectors):
        index = _build_index(vectors[:25])
        for node_id in list(index._nodes):
            index.remove(node_id)
        new_id = index.add(vectors[30])
        assert index.search(vectors[30], k=1)[0][1] == new_id


class TestPersistenceRoundTrip:
    def test_saved_and_loaded_store_returns_the_same_results(self, tmp_path):
        random.seed(11)
        store = VectorStore(dimension=64)
        texts = [f"document number {i} about topic {i % 7}" for i in range(80)]
        store.add_batch(texts)
        before = [(r["node_id"], r["similarity"]) for r in store.search("topic 3", k=5)]

        path = str(tmp_path / "index")
        store.save(path)
        restored = VectorStore(dimension=64)
        restored.load(path)
        after = [(r["node_id"], r["similarity"]) for r in restored.search("topic 3", k=5)]

        assert after == before

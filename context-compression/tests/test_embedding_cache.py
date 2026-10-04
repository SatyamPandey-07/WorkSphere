import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

root_dir = str(Path(__file__).resolve().parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

cc_dir = str(Path(__file__).resolve().parent.parent)
if cc_dir not in sys.path:
    sys.path.insert(0, cc_dir)

cc = importlib.import_module("context-compression")
ContextCompressor = cc.ContextCompressor
VectorStore = cc.VectorStore
create_app = cc.create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def store() -> VectorStore:
    """A small VectorStore with a tiny cache for easy eviction testing."""
    return VectorStore(dimension=64, cache_size=3)


@pytest.fixture
def populated_store(store: VectorStore) -> VectorStore:
    """A store pre-loaded with a few documents so searches return results."""
    store.add("the capital of France is Paris")
    store.add("French cuisine includes croissants and coq au vin")
    store.add("the Eiffel Tower is in Paris")
    return store


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """TestClient wired to a fresh app with a small-cache store."""
    monkeypatch.delenv("COMPRESSION_API_KEY", raising=False)
    comp = ContextCompressor(dimension=64, max_tokens=1000)
    st = VectorStore(dimension=64, cache_size=1000)
    app = create_app(compressor=comp, store=st, api_key=None)
    with TestClient(app) as tc:
        yield tc, st


# ---------------------------------------------------------------------------
# Unit tests – VectorStore cache behaviour
# ---------------------------------------------------------------------------

class TestEmbeddingCacheBasics:
    """Validate core LRU cache mechanics on VectorStore."""

    def test_default_cache_size(self):
        """Default cache_size should be 1000."""
        s = VectorStore(dimension=32)
        assert s._cache_size == 1000

    def test_custom_cache_size(self):
        s = VectorStore(dimension=32, cache_size=500)
        assert s._cache_size == 500

    def test_zero_cache_size_disables_caching(self):
        s = VectorStore(dimension=32, cache_size=0)
        s.add("hello world")
        s.search("hello world")
        s.search("hello world")
        assert s._cache_hits == 0
        assert s._cache_misses == 2
        assert len(s._embedding_cache) == 0

    def test_negative_cache_size_treated_as_zero(self):
        s = VectorStore(dimension=32, cache_size=-5)
        assert s._cache_size == 0


class TestCacheHitMiss:
    """Cache hit / miss counting and LRU semantics."""

    def test_first_search_is_miss(self, populated_store):
        populated_store.search("Paris")
        assert populated_store._cache_misses == 1
        assert populated_store._cache_hits == 0

    def test_repeated_search_is_hit(self, populated_store):
        populated_store.search("Paris")
        populated_store.search("Paris")
        assert populated_store._cache_hits == 1
        assert populated_store._cache_misses == 1

    def test_different_queries_are_misses(self, populated_store):
        populated_store.search("Paris")
        populated_store.search("cuisine")
        assert populated_store._cache_misses == 2
        assert populated_store._cache_hits == 0

    def test_cache_returns_same_vector(self, populated_store):
        """Cached embedding must be identical to the freshly computed one."""
        populated_store.search("Paris")
        vec1 = populated_store._embedding_cache["Paris"]
        populated_store.search("Paris")
        vec2 = populated_store._embedding_cache["Paris"]
        assert vec1 == vec2


class TestCacheEviction:
    """LRU eviction policy when the cache is full."""

    def test_eviction_at_capacity(self, populated_store):
        """cache_size=3 → 4th unique query should evict the oldest."""
        populated_store.search("query_a")
        populated_store.search("query_b")
        populated_store.search("query_c")
        assert len(populated_store._embedding_cache) == 3

        populated_store.search("query_d")
        assert len(populated_store._embedding_cache) == 3
        assert "query_a" not in populated_store._embedding_cache
        assert "query_d" in populated_store._embedding_cache

    def test_access_refreshes_lru_order(self, populated_store):
        """Accessing an entry should move it to most-recent, protecting it."""
        populated_store.search("query_a")
        populated_store.search("query_b")
        populated_store.search("query_c")

        # Touch query_a so it becomes most-recent
        populated_store.search("query_a")

        # Insert query_d → should evict query_b (now the oldest)
        populated_store.search("query_d")
        assert "query_a" in populated_store._embedding_cache
        assert "query_b" not in populated_store._embedding_cache


class TestCacheMetrics:
    """get_cache_metrics() correctness."""

    def test_metrics_empty_store(self):
        s = VectorStore(dimension=32, cache_size=100)
        m = s.get_cache_metrics()
        assert m["cache_size"] == 0
        assert m["cache_capacity"] == 100
        assert m["cache_hits"] == 0
        assert m["cache_misses"] == 0
        assert m["cache_hit_rate"] == 0.0

    def test_metrics_after_searches(self, populated_store):
        populated_store.search("Paris")
        populated_store.search("Paris")
        populated_store.search("food")

        m = populated_store.get_cache_metrics()
        assert m["cache_hits"] == 1
        assert m["cache_misses"] == 2
        assert m["cache_size"] == 2
        assert m["cache_capacity"] == 3
        expected_rate = round(1 / 3, 4)
        assert m["cache_hit_rate"] == expected_rate


class TestCacheClear:
    """clear() must reset the cache and counters."""

    def test_clear_resets_cache(self, populated_store):
        populated_store.search("Paris")
        populated_store.search("Paris")
        populated_store.clear()

        assert len(populated_store._embedding_cache) == 0
        assert populated_store._cache_hits == 0
        assert populated_store._cache_misses == 0

        m = populated_store.get_cache_metrics()
        assert m["cache_size"] == 0
        assert m["cache_hit_rate"] == 0.0


# ---------------------------------------------------------------------------
# Integration test – /api/metrics endpoint
# ---------------------------------------------------------------------------

class TestMetricsEndpoint:
    """Verify that cache stats appear in the /api/metrics response."""

    def test_metrics_includes_cache_fields(self, client):
        tc, store = client
        resp = tc.get("/api/metrics")
        assert resp.status_code == 200
        body = resp.json()
        for key in ("cache_size", "cache_capacity", "cache_hits", "cache_misses", "cache_hit_rate"):
            assert key in body, f"Missing key '{key}' in /api/metrics response"

    def test_metrics_reflect_searches(self, client):
        tc, store = client
        # Populate the store so searches return something
        store.add("Python is a programming language")

        tc.post("/api/store/search", json={"query": "Python", "k": 5})
        tc.post("/api/store/search", json={"query": "Python", "k": 5})

        resp = tc.get("/api/metrics")
        body = resp.json()
        assert body["cache_hits"] == 1
        assert body["cache_misses"] == 1
        assert body["cache_size"] == 1
        assert body["cache_hit_rate"] == 0.5

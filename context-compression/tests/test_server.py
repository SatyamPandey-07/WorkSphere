import importlib
import os
from pathlib import Path
import sys
from typing import Generator

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


@pytest.fixture
def isolated_compressor() -> ContextCompressor:
    """Provide a fresh isolated ContextCompressor instance."""
    return ContextCompressor(dimension=64, max_tokens=1000)


@pytest.fixture
def isolated_store() -> VectorStore:
    """Provide a fresh isolated VectorStore instance."""
    return VectorStore(dimension=64)


@pytest.fixture
def app(isolated_compressor: ContextCompressor, isolated_store: VectorStore):
    """Provide a fresh isolated FastAPI application without authentication."""
    return create_app(
        compressor=isolated_compressor,
        store=isolated_store,
        api_key=None,
    )


@pytest.fixture
def client(app, monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient with COMPRESSION_API_KEY unset."""
    monkeypatch.delenv("COMPRESSION_API_KEY", raising=False)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_app(isolated_compressor: ContextCompressor, isolated_store: VectorStore):
    """Provide a fresh FastAPI application configured with a Bearer API key."""
    return create_app(
        compressor=isolated_compressor,
        store=isolated_store,
        api_key="test-secret-token",
    )


@pytest.fixture
def auth_client(auth_app, monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    """Provide a FastAPI TestClient pointing to the authenticated app."""
    monkeypatch.delenv("COMPRESSION_API_KEY", raising=False)
    with TestClient(auth_app) as test_client:
        yield test_client


class TestHealthEndpoint:
    """Coverage for GET /health endpoint."""

    def test_health_status_code_and_response_structure(self, client: TestClient):
        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)
        assert "status" in data
        assert "uptime_seconds" in data
        assert "version" in data

    def test_health_expected_fields(self, client: TestClient):
        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ok"
        assert isinstance(data["uptime_seconds"], (int, float))
        assert data["uptime_seconds"] >= 0.0
        assert data["version"] is None or isinstance(data["version"], str)


class TestCompressEndpoint:
    """Coverage for POST /api/compress endpoint."""

    def test_compress_valid_request(self, client: TestClient):
        # Pre-seed compressor with context
        add_resp = client.post(
            "/api/add",
            json={"role": "user", "content": "Antigravity context compression engine."},
        )
        assert add_resp.status_code == 200

        response = client.post(
            "/api/compress",
            json={"query": "context compression"},
        )
        assert response.status_code == 200

        data = response.json()
        assert "compressed" in data
        assert "total_tokens" in data
        assert "stats" in data
        assert isinstance(data["compressed"], (list, str))
        assert isinstance(data["total_tokens"], int)
        assert isinstance(data["stats"], dict)
        assert data["total_tokens"] > 0

    def test_compress_valid_with_max_tokens(self, client: TestClient):
        client.post(
            "/api/add",
            json={"role": "user", "content": "Machine learning enables computers to learn."},
        )
        response = client.post(
            "/api/compress",
            json={"query": "machine learning", "max_tokens": 10},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_tokens"] <= 10

    def test_compress_invalid_empty_query_rejected(self, client: TestClient):
        response = client.post(
            "/api/compress",
            json={"query": ""},
        )
        assert response.status_code == 422

    def test_compress_missing_query_field_rejected(self, client: TestClient):
        response = client.post(
            "/api/compress",
            json={},
        )
        assert response.status_code == 422

    def test_compress_invalid_max_tokens_type_rejected(self, client: TestClient):
        response = client.post(
            "/api/compress",
            json={"query": "search query", "max_tokens": "not_an_int"},
        )
        assert response.status_code == 422

    def test_compress_malformed_json_body_rejected(self, client: TestClient):
        response = client.post(
            "/api/compress",
            content=b"invalid-json-body",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


class TestAddMessageEndpoint:
    """Coverage for POST /api/add endpoint."""

    def test_add_message_success(self, client: TestClient):
        response = client.post(
            "/api/add",
            json={"content": "Hello world message"},
        )
        assert response.status_code == 200

        data = response.json()
        assert "node_id" in data
        assert isinstance(data["node_id"], int)

    def test_add_message_with_role_and_metadata(self, client: TestClient):
        response = client.post(
            "/api/add",
            json={
                "role": "assistant",
                "content": "Deep learning models operate over tensors.",
                "metadata": {"doc_id": "dl-01", "author": "tester"},
            },
        )
        assert response.status_code == 200

        data = response.json()
        assert "node_id" in data
        assert isinstance(data["node_id"], int)

    def test_add_message_empty_content_rejected(self, client: TestClient):
        response = client.post(
            "/api/add",
            json={"content": ""},
        )
        assert response.status_code == 422

    def test_add_message_missing_content_rejected(self, client: TestClient):
        response = client.post(
            "/api/add",
            json={"role": "user"},
        )
        assert response.status_code == 422

    def test_add_message_invalid_metadata_type_rejected(self, client: TestClient):
        response = client.post(
            "/api/add",
            json={"content": "valid message", "metadata": "not-a-dictionary"},
        )
        assert response.status_code == 422

    def test_add_message_malformed_body_rejected(self, client: TestClient):
        response = client.post(
            "/api/add",
            content=b"{bad-json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


class TestSearchEndpoint:
    """Coverage for POST /api/search endpoint."""

    def test_search_add_retrieve_flow(self, client: TestClient):
        target_content = "Vector indices speed up nearest neighbor lookups."
        add_resp = client.post(
            "/api/add",
            json={"role": "user", "content": target_content},
        )
        assert add_resp.status_code == 200
        node_id = add_resp.json()["node_id"]

        search_resp = client.post(
            "/api/search",
            json={"query": "nearest neighbor search lookup", "k": 5},
        )
        assert search_resp.status_code == 200

        data = search_resp.json()
        assert "results" in data
        assert isinstance(data["results"], list)
        assert len(data["results"]) >= 1

        top_match = data["results"][0]
        assert top_match["node_id"] == node_id
        assert top_match["content"] == target_content
        assert top_match["role"] == "user"
        assert "similarity" in top_match
        assert "tokens" in top_match

    def test_search_with_custom_k(self, client: TestClient):
        client.post("/api/add", json={"content": "Item number 1"})
        client.post("/api/add", json={"content": "Item number 2"})
        client.post("/api/add", json={"content": "Item number 3"})

        search_resp = client.post(
            "/api/search",
            json={"query": "Item", "k": 1},
        )
        assert search_resp.status_code == 200
        assert len(search_resp.json()["results"]) <= 1

    def test_search_empty_query_rejected(self, client: TestClient):
        response = client.post(
            "/api/search",
            json={"query": "", "k": 5},
        )
        assert response.status_code == 422

    def test_search_missing_query_rejected(self, client: TestClient):
        response = client.post(
            "/api/search",
            json={"k": 5},
        )
        assert response.status_code == 422

    def test_search_invalid_k_lower_bound_rejected(self, client: TestClient):
        response = client.post(
            "/api/search",
            json={"query": "query", "k": 0},
        )
        assert response.status_code == 422

        response_neg = client.post(
            "/api/search",
            json={"query": "query", "k": -1},
        )
        assert response_neg.status_code == 422

    def test_search_invalid_k_upper_bound_rejected(self, client: TestClient):
        response = client.post(
            "/api/search",
            json={"query": "query", "k": 101},
        )
        assert response.status_code == 422

    def test_search_invalid_k_type_rejected(self, client: TestClient):
        response = client.post(
            "/api/search",
            json={"query": "query", "k": "invalid_k"},
        )
        assert response.status_code == 422

    def test_search_malformed_body_rejected(self, client: TestClient):
        response = client.post(
            "/api/search",
            content=b"malformed-body",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


class TestDeduplicateEndpoint:
    """Coverage for POST /api/deduplicate endpoint."""

    def test_deduplicate_valid_request_with_threshold(self, client: TestClient):
        msg = "Exact repeated text string for deduplication test."
        client.post("/api/add", json={"content": msg})
        client.post("/api/add", json={"content": msg})

        response = client.post(
            "/api/deduplicate",
            json={"threshold": 0.8},
        )
        assert response.status_code == 200

        data = response.json()
        assert "removed" in data
        assert "stats" in data
        assert isinstance(data["removed"], int)
        assert isinstance(data["stats"], dict)
        assert data["removed"] >= 1

    def test_deduplicate_valid_request_empty_body(self, client: TestClient):
        response = client.post(
            "/api/deduplicate",
            json={},
        )
        assert response.status_code == 200

        data = response.json()
        assert "removed" in data
        assert "stats" in data
        assert isinstance(data["removed"], int)

    def test_deduplicate_response_structure_and_status(self, client: TestClient):
        response = client.post(
            "/api/deduplicate",
            json={"threshold": 0.95},
        )
        assert response.status_code == 200

        data = response.json()
        assert "removed" in data
        assert "stats" in data
        assert "total_messages" in data["stats"]
        assert "current_tokens" in data["stats"]
        assert "index_size" in data["stats"]

    def test_deduplicate_invalid_threshold_below_zero_rejected(self, client: TestClient):
        response = client.post(
            "/api/deduplicate",
            json={"threshold": -0.01},
        )
        assert response.status_code == 422

    def test_deduplicate_invalid_threshold_above_one_rejected(self, client: TestClient):
        response = client.post(
            "/api/deduplicate",
            json={"threshold": 1.05},
        )
        assert response.status_code == 422

    def test_deduplicate_invalid_threshold_type_rejected(self, client: TestClient):
        response = client.post(
            "/api/deduplicate",
            json={"threshold": "not-a-number"},
        )
        assert response.status_code == 422

    def test_deduplicate_malformed_body_rejected(self, client: TestClient):
        response = client.post(
            "/api/deduplicate",
            content=b"malformed",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


class TestStoreAndClearEndpoints:
    """Coverage for POST /api/store/add, POST /api/store/search, and DELETE /api/clear."""

    def test_store_add_and_search_flow(self, client: TestClient):
        doc_text = "Vector store stores raw embeddings and metadata."
        add_resp = client.post(
            "/api/store/add",
            json={"text": doc_text, "metadata": {"category": "vector"}},
        )
        assert add_resp.status_code == 200
        assert "node_id" in add_resp.json()

        search_resp = client.post(
            "/api/store/search",
            json={"query": "embeddings and metadata", "k": 2},
        )
        assert search_resp.status_code == 200
        results = search_resp.json().get("results", [])
        assert len(results) >= 1

    def test_store_add_empty_text_rejected(self, client: TestClient):
        response = client.post(
            "/api/store/add",
            json={"text": ""},
        )
        assert response.status_code == 422

    def test_store_search_empty_query_rejected(self, client: TestClient):
        response = client.post(
            "/api/store/search",
            json={"query": ""},
        )
        assert response.status_code == 422

    def test_clear_endpoint_resets_store_and_compressor(self, client: TestClient):
        client.post("/api/add", json={"content": "Compressor data"})
        client.post("/api/store/add", json={"text": "Store data"})

        clear_resp = client.delete("/api/clear")
        assert clear_resp.status_code == 200
        assert clear_resp.json() == {"status": "cleared"}

        comp_search = client.post("/api/search", json={"query": "data"})
        assert comp_search.status_code == 200
        assert comp_search.json().get("results") == []

        store_search = client.post("/api/store/search", json={"query": "data"})
        assert store_search.status_code == 200
        assert store_search.json().get("results") == []


class TestBearerAuthentication:
    """Coverage for optional Bearer token authentication."""

    def test_unauthenticated_request_rejected_when_auth_configured(
        self, auth_client: TestClient
    ):
        response = auth_client.post(
            "/api/compress",
            json={"query": "test query"},
        )
        assert response.status_code == 401
        assert response.json() == {"detail": "Unauthorized"}

    def test_invalid_bearer_token_rejected(self, auth_client: TestClient):
        response = auth_client.post(
            "/api/compress",
            json={"query": "test query"},
            headers={"Authorization": "Bearer wrong-token-xyz"},
        )
        assert response.status_code == 401
        assert response.json() == {"detail": "Unauthorized"}

    def test_malformed_auth_header_rejected(self, auth_client: TestClient):
        response = auth_client.post(
            "/api/compress",
            json={"query": "test query"},
            headers={"Authorization": "Basic test-secret-token"},
        )
        assert response.status_code == 401

    def test_valid_bearer_token_accepted(self, auth_client: TestClient):
        response = auth_client.post(
            "/api/compress",
            json={"query": "test query"},
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert response.status_code == 200

    def test_health_endpoint_public_when_auth_configured(
        self, auth_client: TestClient
    ):
        response = auth_client.get("/health")
        assert response.status_code == 200
        assert response.json().get("status") == "ok"

    def test_auth_via_compression_api_key_env_var(
        self,
        isolated_compressor: ContextCompressor,
        isolated_store: VectorStore,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.setenv("COMPRESSION_API_KEY", "env-configured-token")
        env_app = create_app(
            compressor=isolated_compressor,
            store=isolated_store,
            api_key=None,
        )
        with TestClient(env_app) as env_client:
            unauth_resp = env_client.post(
                "/api/compress",
                json={"query": "test query"},
            )
            assert unauth_resp.status_code == 401

            auth_resp = env_client.post(
                "/api/compress",
                json={"query": "test query"},
                headers={"Authorization": "Bearer env-configured-token"},
            )
            assert auth_resp.status_code == 200

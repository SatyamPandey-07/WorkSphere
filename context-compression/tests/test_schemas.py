import importlib
import json
from pathlib import Path
import sys
import unittest

root_dir = str(Path(__file__).resolve().parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from pydantic import ValidationError
from starlette.testclient import TestClient

cc = importlib.import_module("context-compression")
ContextCompressor = cc.ContextCompressor
VectorStore = cc.VectorStore
create_app = cc.create_app

server_schemas = importlib.import_module("context-compression.server.schemas")
AddMessageRequest = server_schemas.AddMessageRequest
CompressRequest = server_schemas.CompressRequest
CompressResponse = server_schemas.CompressResponse
DeduplicateRequest = server_schemas.DeduplicateRequest
SearchRequest = server_schemas.SearchRequest
StoreAddRequest = server_schemas.StoreAddRequest


class TestPydanticSchemasDirectly(unittest.TestCase):
    """Direct unit tests for Pydantic v2 schemas and validation constraints."""

    def test_compress_request_valid(self):
        req = CompressRequest(query="find relevant docs")
        self.assertEqual(req.query, "find relevant docs")
        self.assertIsNone(req.max_tokens)

        req_with_tokens = CompressRequest(query="find relevant docs", max_tokens=256)
        self.assertEqual(req_with_tokens.max_tokens, 256)

    def test_compress_request_invalid_empty_query(self):
        with self.assertRaises(ValidationError):
            CompressRequest(query="")

    def test_compress_request_invalid_missing_query(self):
        with self.assertRaises(ValidationError):
            CompressRequest()

    def test_compress_request_invalid_type(self):
        with self.assertRaises(ValidationError):
            CompressRequest(query=12345)  # non-string or uncoercible
        with self.assertRaises(ValidationError):
            CompressRequest(query="valid", max_tokens="not_an_int")

    def test_compress_response_valid(self):
        # Supports string compressed representation
        resp_str = CompressResponse(
            compressed="summary text",
            total_tokens=15,
            stats={"items": 1},
        )
        self.assertEqual(resp_str.compressed, "summary text")
        self.assertEqual(resp_str.total_tokens, 15)

        # Supports list of message dictionaries (actual compressor output)
        resp_list = CompressResponse(
            compressed=[{"node_id": 1, "content": "text", "tokens": 5}],
            total_tokens=5,
            stats={"items": 1},
        )
        self.assertIsInstance(resp_list.compressed, list)
        self.assertEqual(len(resp_list.compressed), 1)

    def test_compress_response_missing_fields(self):
        with self.assertRaises(ValidationError):
            CompressResponse(compressed="text")
        with self.assertRaises(ValidationError):
            CompressResponse(total_tokens=10, stats={})

    def test_add_message_request_valid(self):
        # Default role should be "user" and metadata should be None
        req = AddMessageRequest(content="hello")
        self.assertEqual(req.role, "user")
        self.assertEqual(req.content, "hello")
        self.assertIsNone(req.metadata)

        # Custom role and metadata
        req_custom = AddMessageRequest(
            role="assistant",
            content="hi there",
            metadata={"session_id": "123"},
        )
        self.assertEqual(req_custom.role, "assistant")
        self.assertEqual(req_custom.metadata, {"session_id": "123"})

    def test_add_message_request_invalid_content(self):
        with self.assertRaises(ValidationError):
            AddMessageRequest(content="")
        with self.assertRaises(ValidationError):
            AddMessageRequest()

    def test_add_message_request_invalid_metadata_type(self):
        with self.assertRaises(ValidationError):
            AddMessageRequest(content="hello", metadata="invalid-string-meta")

    def test_search_request_valid(self):
        # Default k is 10
        req = SearchRequest(query="lookup")
        self.assertEqual(req.query, "lookup")
        self.assertEqual(req.k, 10)

        req_k = SearchRequest(query="lookup", k=50)
        self.assertEqual(req_k.k, 50)

    def test_search_request_invalid_k_bounds(self):
        with self.assertRaises(ValidationError):
            SearchRequest(query="lookup", k=0)
        with self.assertRaises(ValidationError):
            SearchRequest(query="lookup", k=-1)
        with self.assertRaises(ValidationError):
            SearchRequest(query="lookup", k=101)

    def test_search_request_invalid_empty_query(self):
        with self.assertRaises(ValidationError):
            SearchRequest(query="", k=10)
        with self.assertRaises(ValidationError):
            SearchRequest(k=10)

    def test_store_add_request_valid(self):
        req = StoreAddRequest(text="stored document")
        self.assertEqual(req.text, "stored document")
        self.assertIsNone(req.metadata)

        req_meta = StoreAddRequest(text="stored doc", metadata={"type": "note"})
        self.assertEqual(req_meta.metadata, {"type": "note"})

    def test_store_add_request_invalid_text(self):
        with self.assertRaises(ValidationError):
            StoreAddRequest(text="")
        with self.assertRaises(ValidationError):
            StoreAddRequest()

    def test_store_add_request_invalid_metadata_type(self):
        with self.assertRaises(ValidationError):
            StoreAddRequest(text="some text", metadata="not-a-dict")

    def test_deduplicate_request_valid(self):
        # Default threshold is None
        req = DeduplicateRequest()
        self.assertIsNone(req.threshold)

        req_val = DeduplicateRequest(threshold=0.85)
        self.assertEqual(req_val.threshold, 0.85)

        # Boundary values
        req_zero = DeduplicateRequest(threshold=0.0)
        self.assertEqual(req_zero.threshold, 0.0)
        req_one = DeduplicateRequest(threshold=1.0)
        self.assertEqual(req_one.threshold, 1.0)

    def test_deduplicate_request_invalid_threshold_bounds(self):
        with self.assertRaises(ValidationError):
            DeduplicateRequest(threshold=-0.1)
        with self.assertRaises(ValidationError):
            DeduplicateRequest(threshold=1.1)

    def test_deduplicate_request_invalid_type(self):
        with self.assertRaises(ValidationError):
            DeduplicateRequest(threshold="not-a-float")


class TestFastAPIEndpointsValidation(unittest.TestCase):
    """Integration tests verifying HTTP 200 for valid requests and HTTP 422 for invalid requests."""

    def setUp(self):
        self.compressor = ContextCompressor(dimension=32, max_tokens=1000)
        self.store = VectorStore(dimension=32)
        # Prepopulate compressor with initial messages
        self.compressor.add_message("user", "What is artificial intelligence?")
        self.compressor.add_message(
            "assistant",
            "Artificial intelligence is intelligence demonstrated by machines.",
        )
        # Prepopulate store
        self.store.add("Machine learning is a subset of AI.", {"category": "ai"})

        self.app = create_app(compressor=self.compressor, store=self.store)
        self.client = TestClient(self.app)

    # ---------------- VALID REQUEST TESTS ----------------

    def test_valid_compress_endpoint(self):
        # Without max_tokens
        resp = self.client.post("/api/compress", json={"query": "artificial intelligence"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("compressed", data)
        self.assertIn("total_tokens", data)
        self.assertIn("stats", data)
        self.assertIsInstance(data["compressed"], list)
        self.assertIsInstance(data["total_tokens"], int)
        self.assertIsInstance(data["stats"], dict)

        # With max_tokens
        resp = self.client.post(
            "/api/compress",
            json={"query": "artificial intelligence", "max_tokens": 50},
        )
        self.assertEqual(resp.status_code, 200)

    def test_valid_add_message_endpoint(self):
        # Default role and metadata omitted
        resp = self.client.post("/api/add", json={"content": "Tell me more."})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("node_id", data)

        # Explicit role and metadata
        resp = self.client.post(
            "/api/add",
            json={
                "role": "assistant",
                "content": "Deep learning models require lots of data.",
                "metadata": {"source": "manual"},
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("node_id", resp.json())

    def test_valid_search_endpoint(self):
        # Default k
        resp = self.client.post("/api/search", json={"query": "intelligence"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("results", data)
        self.assertIsInstance(data["results"], list)

        # Explicit k
        resp = self.client.post("/api/search", json={"query": "intelligence", "k": 1})
        self.assertEqual(resp.status_code, 200)
        self.assertLessEqual(len(resp.json()["results"]), 1)

    def test_valid_store_add_endpoint(self):
        # Without metadata
        resp = self.client.post("/api/store/add", json={"text": "Neural networks process vectors."})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("node_id", resp.json())

        # With metadata
        resp = self.client.post(
            "/api/store/add",
            json={"text": "Transformers revolutionized NLP.", "metadata": {"year": 2017}},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("node_id", resp.json())

    def test_valid_store_search_endpoint(self):
        resp = self.client.post("/api/store/search", json={"query": "machine learning"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("results", data)
        self.assertIsInstance(data["results"], list)

        resp_k = self.client.post("/api/store/search", json={"query": "machine learning", "k": 5})
        self.assertEqual(resp_k.status_code, 200)

    def test_valid_deduplicate_endpoint(self):
        # Explicit threshold
        resp = self.client.post("/api/deduplicate", json={"threshold": 0.85})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("removed", data)
        self.assertIn("stats", data)

        # Empty json payload defaults threshold to None
        resp_empty = self.client.post("/api/deduplicate", json={})
        self.assertEqual(resp_empty.status_code, 200)
        data_empty = resp_empty.json()
        self.assertIn("removed", data_empty)
        self.assertIn("stats", data_empty)

    def test_valid_compress_stream_endpoint(self):
        resp = self.client.post(
            "/api/compress/stream",
            json={"query": "intelligence", "max_tokens": 100},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/event-stream", resp.headers.get("content-type", ""))

    # ---------------- INVALID REQUEST TESTS (HTTP 422) ----------------

    def test_invalid_empty_query_rejected(self):
        # Empty query on /api/compress
        resp = self.client.post("/api/compress", json={"query": ""})
        self.assertEqual(resp.status_code, 422)

        # Empty query on /api/search
        resp = self.client.post("/api/search", json={"query": ""})
        self.assertEqual(resp.status_code, 422)

        # Empty query on /api/store/search
        resp = self.client.post("/api/store/search", json={"query": ""})
        self.assertEqual(resp.status_code, 422)

        # Empty query on /api/compress/stream
        resp = self.client.post("/api/compress/stream", json={"query": ""})
        self.assertEqual(resp.status_code, 422)

    def test_invalid_empty_content_rejected(self):
        resp = self.client.post("/api/add", json={"content": ""})
        self.assertEqual(resp.status_code, 422)

    def test_invalid_empty_text_rejected(self):
        resp = self.client.post("/api/store/add", json={"text": ""})
        self.assertEqual(resp.status_code, 422)

    def test_invalid_k_rejected(self):
        # k < 1 on /api/search
        resp = self.client.post("/api/search", json={"query": "ai", "k": 0})
        self.assertEqual(resp.status_code, 422)

        resp = self.client.post("/api/search", json={"query": "ai", "k": -1})
        self.assertEqual(resp.status_code, 422)

        # k > 100 on /api/search
        resp = self.client.post("/api/search", json={"query": "ai", "k": 101})
        self.assertEqual(resp.status_code, 422)

        # k < 1 on /api/store/search
        resp = self.client.post("/api/store/search", json={"query": "ai", "k": 0})
        self.assertEqual(resp.status_code, 422)

        # k > 100 on /api/store/search
        resp = self.client.post("/api/store/search", json={"query": "ai", "k": 101})
        self.assertEqual(resp.status_code, 422)

    def test_invalid_threshold_rejected(self):
        # threshold < 0
        resp = self.client.post("/api/deduplicate", json={"threshold": -0.1})
        self.assertEqual(resp.status_code, 422)

        # threshold > 1
        resp = self.client.post("/api/deduplicate", json={"threshold": 1.1})
        self.assertEqual(resp.status_code, 422)

    def test_missing_required_fields_rejected(self):
        # Missing query
        resp = self.client.post("/api/compress", json={})
        self.assertEqual(resp.status_code, 422)

        resp = self.client.post("/api/search", json={})
        self.assertEqual(resp.status_code, 422)

        resp = self.client.post("/api/store/search", json={})
        self.assertEqual(resp.status_code, 422)

        resp = self.client.post("/api/compress/stream", json={})
        self.assertEqual(resp.status_code, 422)

        # Missing content on add
        resp = self.client.post("/api/add", json={"role": "user"})
        self.assertEqual(resp.status_code, 422)

        # Missing text on store/add
        resp = self.client.post("/api/store/add", json={"metadata": {"doc": 1}})
        self.assertEqual(resp.status_code, 422)

        # Missing body on deduplicate
        resp_dedup = self.client.post("/api/deduplicate")
        self.assertEqual(resp_dedup.status_code, 422)

    def test_invalid_field_types_rejected(self):
        # max_tokens not an int
        resp = self.client.post(
            "/api/compress",
            json={"query": "test", "max_tokens": "not_an_int"},
        )
        self.assertEqual(resp.status_code, 422)

        # k not an int
        resp = self.client.post(
            "/api/search",
            json={"query": "test", "k": "not_an_int"},
        )
        self.assertEqual(resp.status_code, 422)

        # threshold not a float
        resp = self.client.post(
            "/api/deduplicate",
            json={"threshold": "not_a_float"},
        )
        self.assertEqual(resp.status_code, 422)

        # metadata not a dict
        resp = self.client.post(
            "/api/add",
            json={"content": "test", "metadata": "not_a_dict"},
        )
        self.assertEqual(resp.status_code, 422)

        resp = self.client.post(
            "/api/store/add",
            json={"text": "test", "metadata": "not_a_dict"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_openapi_schema_exposes_request_bodies(self):
        openapi = self.app.openapi()
        paths = openapi.get("paths", {})

        # Verify /api/compress/stream correctly documents CompressRequest in OpenAPI
        stream_post = paths.get("/api/compress/stream", {}).get("post", {})
        self.assertIn("requestBody", stream_post)
        content = stream_post["requestBody"].get("content", {})
        schema_ref = content.get("application/json", {}).get("schema", {}).get("$ref", "")
        self.assertIn("CompressRequest", schema_ref)

        # Verify /api/compress documents request body and response model
        compress_post = paths.get("/api/compress", {}).get("post", {})
        self.assertIn("requestBody", compress_post)
        resp_schema_ref = (
            compress_post.get("responses", {})
            .get("200", {})
            .get("content", {})
            .get("application/json", {})
            .get("schema", {})
            .get("$ref", "")
        )
        self.assertIn("CompressResponse", resp_schema_ref)

        # Verify /api/deduplicate documents DeduplicateRequest
        dedup_post = paths.get("/api/deduplicate", {}).get("post", {})
        self.assertIn("requestBody", dedup_post)
        dedup_ref = (
            dedup_post["requestBody"]
            .get("content", {})
            .get("application/json", {})
            .get("schema", {})
            .get("$ref", "")
        )
        self.assertIn("DeduplicateRequest", dedup_ref)


if __name__ == "__main__":
    unittest.main()

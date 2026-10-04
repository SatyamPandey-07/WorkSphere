import asyncio
import importlib
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

root_dir = str(Path(__file__).resolve().parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from starlette.testclient import TestClient

cc = importlib.import_module("context-compression")
ContextCompressor = cc.ContextCompressor
VectorStore = cc.VectorStore
create_app = cc.create_app

server_module = importlib.import_module("context-compression.server.server")
get_memory_rss_mb = server_module.get_memory_rss_mb
get_service_version = server_module.get_service_version


class TestObservabilityEndpoints(unittest.TestCase):
    def setUp(self):
        self.compressor = ContextCompressor(dimension=128, max_tokens=2000)
        self.store = VectorStore(dimension=128)
        self.app = create_app(compressor=self.compressor, store=self.store)
        self.client = TestClient(self.app)

    def test_health_endpoint_status_and_keys(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertIn("uptime_seconds", data)
        self.assertIsInstance(data["uptime_seconds"], (int, float))
        self.assertGreaterEqual(data["uptime_seconds"], 0.0)

        # Version is present from package.json
        expected_version = get_service_version()
        if expected_version is not None:
            self.assertIn("version", data)
            self.assertEqual(data["version"], expected_version)

    def test_health_uptime_increases_on_repeated_calls(self):
        resp1 = self.client.get("/health")
        self.assertEqual(resp1.status_code, 200)
        uptime1 = resp1.json()["uptime_seconds"]

        time.sleep(0.05)

        resp2 = self.client.get("/health")
        self.assertEqual(resp2.status_code, 200)
        uptime2 = resp2.json()["uptime_seconds"]

        self.assertGreaterEqual(uptime2, uptime1)

    def test_health_lifespan_context(self):
        with TestClient(self.app) as client:
            resp = client.get("/health")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data.get("status"), "ok")
            self.assertGreaterEqual(data["uptime_seconds"], 0.0)

    def test_health_direct_coroutine_call(self):
        async def run_test():
            endpoint = next(
                r.endpoint
                for r in self.app.routes
                if getattr(r, "path", None) == "/health"
            )
            result = await endpoint()
            self.assertEqual(result.status, "ok")
            self.assertEqual(result["status"], "ok")
            self.assertGreaterEqual(result.uptime_seconds, 0.0)
            self.assertGreaterEqual(result["uptime_seconds"], 0.0)

        asyncio.run(run_test())

    def test_health_with_custom_startup_timestamp(self):
        self.app.state.start_time = time.monotonic() - 100.0
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreaterEqual(data["uptime_seconds"], 99.0)

    def test_api_metrics_keys_and_types(self):
        response = self.client.get("/api/metrics")
        self.assertEqual(response.status_code, 200)

        data = response.json()
        required_keys = [
            "vector_count",
            "total_messages",
            "dimension",
            "memory_rss_mb",
        ]
        for key in required_keys:
            self.assertIn(key, data)

        self.assertIsInstance(data["vector_count"], int)
        self.assertGreaterEqual(data["vector_count"], 0)

        self.assertIsInstance(data["total_messages"], int)
        self.assertGreaterEqual(data["total_messages"], 0)

        self.assertIsInstance(data["dimension"], int)
        self.assertEqual(data["dimension"], 128)

        self.assertIsInstance(data["memory_rss_mb"], (int, float))
        self.assertGreaterEqual(data["memory_rss_mb"], 0.0)

    def test_api_metrics_custom_dimension(self):
        compressor = ContextCompressor(dimension=64)
        store = VectorStore(dimension=64)
        app = create_app(compressor=compressor, store=store)
        client = TestClient(app)

        resp = client.get("/api/metrics")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["dimension"], 64)

    def test_api_metrics_updates_with_application_state(self):
        # Initial empty state
        initial = self.client.get("/api/metrics").json()
        self.assertEqual(initial["vector_count"], 0)
        self.assertEqual(initial["total_messages"], 0)

        # Add message to compressor via API
        resp_add = self.client.post(
            "/api/add",
            json={"role": "user", "content": "What is semantic search?"},
        )
        self.assertEqual(resp_add.status_code, 200)

        after_msg = self.client.get("/api/metrics").json()
        self.assertEqual(after_msg["total_messages"], 1)
        self.assertEqual(after_msg["vector_count"], 0)

        # Add vector to store via API
        resp_store = self.client.post(
            "/api/store/add",
            json={"text": "Semantic search matches by meaning."},
        )
        self.assertEqual(resp_store.status_code, 200)

        after_store = self.client.get("/api/metrics").json()
        self.assertEqual(after_store["total_messages"], 1)
        self.assertEqual(after_store["vector_count"], 1)

        # Clear both
        resp_clear = self.client.delete("/api/clear")
        self.assertEqual(resp_clear.status_code, 200)

        after_clear = self.client.get("/api/metrics").json()
        self.assertEqual(after_clear["total_messages"], 0)
        self.assertEqual(after_clear["vector_count"], 0)

    def test_api_metrics_direct_coroutine_call(self):
        async def run_test():
            endpoint = next(
                r.endpoint
                for r in self.app.routes
                if getattr(r, "path", None) == "/api/metrics"
            )
            result = await endpoint()
            self.assertEqual(result.vector_count, 0)
            self.assertEqual(result["vector_count"], 0)
            self.assertEqual(result.total_messages, 0)
            self.assertEqual(result["total_messages"], 0)
            self.assertEqual(result.dimension, 128)
            self.assertEqual(result["dimension"], 128)
            self.assertGreaterEqual(result.memory_rss_mb, 0.0)

        asyncio.run(run_test())

    def test_api_metrics_with_mocked_components(self):
        mock_compressor = MagicMock()
        mock_compressor.get_stats.return_value = {"total_messages": 42}
        mock_compressor.dimension = 256

        mock_store = MagicMock()
        mock_store.size.return_value = 17
        mock_store.dimension = 256

        app = create_app(compressor=mock_compressor, store=mock_store)
        client = TestClient(app)

        resp = client.get("/api/metrics")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["vector_count"], 17)
        self.assertEqual(data["total_messages"], 42)
        self.assertEqual(data["dimension"], 256)

    def test_memory_rss_mb_measurement(self):
        # psutil path
        rss = get_memory_rss_mb()
        self.assertIsInstance(rss, float)
        self.assertGreaterEqual(rss, 0.0)

        # Fallback when psutil is not available
        with patch.dict(sys.modules, {"psutil": None}):
            fallback_rss = get_memory_rss_mb()
            self.assertIsInstance(fallback_rss, float)
            self.assertGreaterEqual(fallback_rss, 0.0)

    def test_existing_endpoints_preserved(self):
        # Verify /api/health still functions as expected
        resp_health = self.client.get("/api/health")
        self.assertEqual(resp_health.status_code, 200)
        self.assertEqual(resp_health.json(), {"status": "ok"})

        # Verify /api/stats still functions as expected
        resp_stats = self.client.get("/api/stats")
        self.assertEqual(resp_stats.status_code, 200)
        self.assertIn("compressor", resp_stats.json())
        self.assertIn("store", resp_stats.json())


if __name__ == "__main__":
    unittest.main()

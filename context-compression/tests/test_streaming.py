import asyncio
import json
import os
import sys
import time
import unittest

from pathlib import Path
import importlib

root_dir = str(Path(__file__).resolve().parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from starlette.testclient import TestClient

cc = importlib.import_module("context-compression")
ContextCompressor = cc.ContextCompressor
CompressionServer = cc.CompressionServer
create_app = cc.create_app
CompressionClient = cc.CompressionClient


class TestStreamingCompression(unittest.TestCase):
    def setUp(self):
        self.compressor = ContextCompressor(dimension=64, max_tokens=2000)
        # Seed test messages
        self.compressor.add_message("user", "What is quantum computing?")
        self.compressor.add_message(
            "assistant",
            "Quantum computing uses qubits to perform computations exponentially faster for certain problems.",
        )
        self.compressor.add_message("user", "Tell me about superposition.")
        self.compressor.add_message(
            "assistant",
            "Superposition allows quantum particles to exist in multiple states simultaneously.",
        )
        self.compressor.add_message("user", "What about quantum entanglement?")
        self.compressor.add_message(
            "assistant",
            "Entanglement links particles such that one state immediately determines the other.",
        )

    def test_compress_context_stream_generator(self):
        async def run_test():
            chunks = []
            async for chunk in self.compressor.compress_context_stream("quantum superposition", max_tokens=500):
                chunks.append(chunk)
                self.assertIn("node_id", chunk)
                self.assertIn("similarity", chunk)
                self.assertIn("role", chunk)
                self.assertIn("content", chunk)
                self.assertIn("tokens", chunk)
                self.assertIn("total_tokens", chunk)

            self.assertGreater(len(chunks), 0)
            # Verify total tokens are monotonically increasing
            prev_tokens = 0
            for c in chunks:
                self.assertGreaterEqual(c["total_tokens"], prev_tokens)
                prev_tokens = c["total_tokens"]

        asyncio.run(run_test())

    def test_compress_context_stream_token_budget_enforcement(self):
        async def run_test():
            # Set a very tight token budget
            chunks = []
            async for chunk in self.compressor.compress_context_stream("quantum", max_tokens=15):
                chunks.append(chunk)

            self.assertTrue(len(chunks) <= 2)
            if chunks:
                self.assertLessEqual(chunks[-1]["total_tokens"], 15)

        asyncio.run(run_test())

    def test_fastapi_sse_streaming_endpoint(self):
        app = create_app(compressor=self.compressor)
        client = TestClient(app)

        response = client.post(
            "/api/compress/stream",
            json={"query": "quantum superposition", "max_tokens": 1000},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers.get("content-type", ""))

        lines = response.text.strip().split("\n\n")
        events = []
        for line in lines:
            line = line.strip()
            if line.startswith("data: "):
                data_str = line[6:]
                if data_str != "[DONE]":
                    events.append(json.loads(data_str))

        self.assertGreater(len(events), 0)
        # Check chunks
        chunk_events = [e for e in events if not e.get("done")]
        done_events = [e for e in events if e.get("done")]

        self.assertGreater(len(chunk_events), 0)
        self.assertEqual(len(done_events), 1)
        self.assertTrue(done_events[0]["done"])
        self.assertIn("stats", done_events[0])

    def test_compress_context_stream_early_abort(self):
        async def run_test():
            gen = self.compressor.compress_context_stream("quantum", max_tokens=1000)
            first_chunk = await anext(gen)
            self.assertIn("node_id", first_chunk)
            # Early abort by closing generator
            await gen.aclose()

        asyncio.run(run_test())

    def test_client_disconnection_handling(self):
        async def run_test():
            # Test generator aborts when is_disconnected returns True
            class MockRequest:
                def __init__(self):
                    self.calls = 0

                async def is_disconnected(self):
                    self.calls += 1
                    return self.calls > 1

                async def json(self):
                    return {"query": "quantum", "max_tokens": 1000}

            mock_request = MockRequest()
            app = create_app(compressor=self.compressor)

            # Find the route endpoint handler directly
            compress_stream_route = None
            for route in app.routes:
                if getattr(route, "path", "") == "/api/compress/stream":
                    compress_stream_route = route.endpoint
                    break

            self.assertIsNotNone(compress_stream_route)
            response = await compress_stream_route(mock_request)
            chunks_received = []
            async for chunk_bytes in response.body_iterator:
                chunks_received.append(chunk_bytes)

            # Because is_disconnected returned True after the first check, it aborted early
            self.assertLessEqual(len(chunks_received), 2)

        asyncio.run(run_test())

    def test_process_time_header(self):
        app = create_app(compressor=self.compressor)
        client = TestClient(app)

        response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertIn("x-process-time", response.headers)
        self.assertTrue(response.headers["x-process-time"].endswith("ms"))

    def test_client_server_integration_streaming(self):
        server = CompressionServer(port=8895, dimension=64)
        server.compressor.add_message("user", "Hello streaming world")
        server.compressor.add_message("assistant", "Streaming response received chunk by chunk.")
        server.run_in_thread()
        time.sleep(0.5)

        try:
            client = CompressionClient(server_url="http://127.0.0.1:8895")
            health = client.health()
            self.assertEqual(health.get("status"), "ok")

            stream_results = list(client.compress_context_stream("streaming world"))
            self.assertGreater(len(stream_results), 0)
        finally:
            server.stop()


if __name__ == "__main__":
    unittest.main()

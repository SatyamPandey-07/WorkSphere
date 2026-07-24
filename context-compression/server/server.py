import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional

from ..compression.compressor import ContextCompressor
from ..storage.store import VectorStore

logger = logging.getLogger(__name__)


class CompressionServer:
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8890,
        dimension: int = 128,
        max_tokens: int = 4096,
        similarity_threshold: float = 0.85,
        persist_path: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.persist_path = persist_path

        self.compressor = ContextCompressor(
            dimension=dimension,
            max_tokens=max_tokens,
            similarity_threshold=similarity_threshold,
        )
        self.store = VectorStore(dimension=dimension)

        self._server: Optional[HTTPServer] = None

    def _make_handler(self):
        compressor = self.compressor
        store = self.store

        class Handler(BaseHTTPRequestHandler):
            def _send_json(self, data: Any, status: int = 200):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_OPTIONS(self):
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.end_headers()

            def do_POST(self):
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    body = json.loads(self.rfile.read(length)) if length > 0 else {}
                except Exception as e:
                    self._send_json({"error": f"Invalid request: {e}"}, 400)
                    return

                if self.path == "/api/compress":
                    query = body.get("query", "")
                    max_tokens = body.get("max_tokens")
                    result, tokens = compressor.compress_context(
                        query, max_tokens=max_tokens
                    )
                    self._send_json({
                        "compressed": result,
                        "total_tokens": tokens,
                        "stats": compressor.get_stats(),
                    })

                elif self.path == "/api/deduplicate":
                    threshold = body.get("threshold")
                    removed = compressor.deduplicate(threshold=threshold)
                    self._send_json({
                        "removed": removed,
                        "stats": compressor.get_stats(),
                    })

                elif self.path == "/api/add":
                    role = body.get("role", "user")
                    content = body.get("content", "")
                    metadata = body.get("metadata")
                    node_id = compressor.add_message(role, content, metadata)
                    self._send_json({"node_id": node_id})

                elif self.path == "/api/search":
                    query = body.get("query", "")
                    k = body.get("k", 10)
                    results = compressor.get_relevant_context(query, k)
                    self._send_json({"results": results})

                elif self.path == "/api/store/add":
                    text = body.get("text", "")
                    metadata = body.get("metadata")
                    node_id = store.add(text, metadata)
                    self._send_json({"node_id": node_id})

                elif self.path == "/api/store/search":
                    query = body.get("query", "")
                    k = body.get("k", 10)
                    results = store.search(query, k)
                    self._send_json({"results": results})

                else:
                    self._send_json({"error": "Not found"}, 404)

            def do_GET(self):
                if self.path == "/api/stats":
                    self._send_json({
                        "compressor": compressor.get_stats(),
                        "store": {"size": store.size()},
                    })
                elif self.path == "/api/health":
                    self._send_json({"status": "ok"})
                else:
                    self._send_json({"error": "Not found"}, 404)

            def do_DELETE(self):
                if self.path == "/api/clear":
                    compressor.clear()
                    store.clear()
                    self._send_json({"status": "cleared"})
                else:
                    self._send_json({"error": "Not found"}, 404)

            def log_message(self, fmt, *args):
                logger.debug(f"{self.address_string()} - {fmt % args}")

        return Handler

    def start(self):
        handler = self._make_handler()
        self._server = HTTPServer((self.host, self.port), handler)
        logger.info(
            f"CompressionServer listening on http://{self.host}:{self.port}"
        )
        try:
            self._server.serve_forever()
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        if self._server:
            self._server.shutdown()
            logger.info("CompressionServer stopped")

    def run_in_thread(self):
        import threading

        handler = self._make_handler()
        self._server = HTTPServer((self.host, self.port), handler)
        thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        thread.start()
        logger.info(
            f"CompressionServer running in thread on http://{self.host}:{self.port}"
        )
        return thread

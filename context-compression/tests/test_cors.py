import importlib
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

root_dir = str(Path(__file__).resolve().parent.parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from starlette.testclient import TestClient

cc = importlib.import_module("context-compression")
ContextCompressor = cc.ContextCompressor
VectorStore = cc.VectorStore
create_app = cc.create_app
CompressionServer = cc.CompressionServer

server_module = importlib.import_module("context-compression.server.server")
parse_cors_allowed_origins = server_module.parse_cors_allowed_origins
DEFAULT_CORS_ALLOWED_ORIGINS = server_module.DEFAULT_CORS_ALLOWED_ORIGINS


class TestCorsOriginParsing(unittest.TestCase):
    """Verify parsing and validation of CORS_ALLOWED_ORIGINS configuration."""

    def test_default_origins_when_env_not_set(self):
        with patch.dict(os.environ, {}, clear=True):
            origins = parse_cors_allowed_origins()
            self.assertEqual(origins, ["http://localhost:3000", "http://127.0.0.1:3000"])

    def test_parse_comma_separated_origins(self):
        result = parse_cors_allowed_origins("http://localhost:3000,https://example.com")
        self.assertEqual(result, ["http://localhost:3000", "https://example.com"])

    def test_parse_origins_strips_whitespace_and_ignores_empty(self):
        raw = "  http://localhost:3000 , ,   https://example.com  ,   ,  "
        result = parse_cors_allowed_origins(raw)
        self.assertEqual(result, ["http://localhost:3000", "https://example.com"])

    def test_parse_origins_empty_string(self):
        result = parse_cors_allowed_origins("")
        self.assertEqual(result, [])

    def test_parse_origins_from_env_var(self):
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": "https://api.test.com, https://app.test.com"}):
            result = parse_cors_allowed_origins()
            self.assertEqual(result, ["https://api.test.com", "https://app.test.com"])


class TestCorsMiddleware(unittest.TestCase):
    """Verify CORSMiddleware configuration and behavior on endpoints."""

    def setUp(self):
        # Create an app using default CORS origins
        with patch.dict(os.environ, {}, clear=True):
            self.compressor = ContextCompressor(dimension=64, max_tokens=1000)
            self.store = VectorStore(dimension=64)
            self.app = create_app(compressor=self.compressor, store=self.store)
            self.client = TestClient(self.app)

    def test_default_allowed_origin_localhost_receives_cors_headers(self):
        # Requirement a: Default allowed origin http://localhost:3000 receives appropriate CORS headers
        response = self.client.get("/health", headers={"Origin": "http://localhost:3000"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000")
        self.assertEqual(response.headers.get("access-control-allow-credentials"), "true")

    def test_default_allowed_origin_127_0_0_1_allowed(self):
        # Requirement b: Default allowed origin http://127.0.0.1:3000 is allowed
        response = self.client.get("/health", headers={"Origin": "http://127.0.0.1:3000"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:3000")
        self.assertEqual(response.headers.get("access-control-allow-credentials"), "true")

    def test_non_whitelisted_origin_not_granted_cors_access(self):
        # Requirement c: Non-whitelisted origin is not granted CORS access
        response = self.client.get("/health", headers={"Origin": "http://untrusted-origin.com"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_options_preflight_succeeds_for_whitelisted_origin(self):
        # Requirement d: OPTIONS preflight succeeds for a whitelisted origin
        response = self.client.options(
            "/api/compress",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000")

    def test_preflight_includes_allowed_methods_and_headers(self):
        # Requirement e: Preflight includes appropriate allowed methods/headers
        response = self.client.options(
            "/api/compress",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type, Authorization",
            },
        )
        self.assertEqual(response.status_code, 200)

        # Check allowed methods
        allow_methods_hdr = response.headers.get("access-control-allow-methods", "")
        methods = {m.strip() for m in allow_methods_hdr.split(",") if m.strip()}
        expected_methods = {"GET", "POST", "DELETE", "OPTIONS"}
        self.assertEqual(methods, expected_methods)

        # Check allowed headers
        allow_headers_hdr = response.headers.get("access-control-allow-headers", "")
        headers = {h.strip().lower() for h in allow_headers_hdr.split(",") if h.strip()}
        self.assertIn("content-type", headers)
        self.assertIn("authorization", headers)

    def test_preflight_rejected_for_non_whitelisted_origin(self):
        # Preflight from non-whitelisted origin does not receive access-control-allow-origin
        response = self.client.options(
            "/api/compress",
            headers={
                "Origin": "http://untrusted-origin.com",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_credentials_support_configured_correctly(self):
        # Requirement f: Credentials support is configured correctly
        # Verify both simple and preflight responses include access-control-allow-credentials: true
        simple_res = self.client.get("/health", headers={"Origin": "http://localhost:3000"})
        self.assertEqual(simple_res.headers.get("access-control-allow-credentials"), "true")

        preflight_res = self.client.options(
            "/api/compress",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(preflight_res.headers.get("access-control-allow-credentials"), "true")

    def test_cors_allowed_origins_env_override(self):
        # Requirement g: CORS_ALLOWED_ORIGINS can override the defaults
        custom_origin = "https://custom-dashboard.company.internal"
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": custom_origin}):
            custom_app = create_app()
            client = TestClient(custom_app)

            # Whitelisted custom origin succeeds
            res_allowed = client.get("/health", headers={"Origin": custom_origin})
            self.assertEqual(res_allowed.status_code, 200)
            self.assertEqual(res_allowed.headers.get("access-control-allow-origin"), custom_origin)

            # Default origin is now NOT granted CORS access because defaults were overridden
            res_denied = client.get("/health", headers={"Origin": "http://localhost:3000"})
            self.assertEqual(res_denied.status_code, 200)
            self.assertNotIn("access-control-allow-origin", res_denied.headers)

    def test_multiple_comma_separated_origins(self):
        # Requirement h: Multiple comma-separated origins are parsed correctly
        origins_str = "http://localhost:3000, https://service-a.com, https://service-b.org"
        with patch.dict(os.environ, {"CORS_ALLOWED_ORIGINS": origins_str}):
            app = create_app()
            client = TestClient(app)

            for origin in ["http://localhost:3000", "https://service-a.com", "https://service-b.org"]:
                res = client.get("/health", headers={"Origin": origin})
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.headers.get("access-control-allow-origin"), origin)

            # Check that an unlisted origin is rejected
            res_unlisted = client.get("/health", headers={"Origin": "https://service-c.com"})
            self.assertNotIn("access-control-allow-origin", res_unlisted.headers)

    def test_explicit_cors_allowed_origins_argument(self):
        # Ensure create_app supports direct argument configuration
        explicit_origins = ["https://direct-arg.com"]
        app = create_app(cors_allowed_origins=explicit_origins)
        client = TestClient(app)

        res = client.get("/health", headers={"Origin": "https://direct-arg.com"})
        self.assertEqual(res.headers.get("access-control-allow-origin"), "https://direct-arg.com")

        res_other = client.get("/health", headers={"Origin": "http://localhost:3000"})
        self.assertNotIn("access-control-allow-origin", res_other.headers)

    def test_compression_server_cors_parameter(self):
        # Ensure CompressionServer passes cors_allowed_origins through to create_app
        server = CompressionServer(
            dimension=64,
            cors_allowed_origins=["https://server-test.com"],
        )
        client = TestClient(server.app)

        res = client.get("/health", headers={"Origin": "https://server-test.com"})
        self.assertEqual(res.headers.get("access-control-allow-origin"), "https://server-test.com")

    def test_existing_api_behavior_remains_intact(self):
        # Requirement i: Existing API behavior remains intact
        # Requests without Origin header work normally
        res_health = self.client.get("/health")
        self.assertEqual(res_health.status_code, 200)
        self.assertEqual(res_health.json()["status"], "ok")

        res_metrics = self.client.get("/api/metrics")
        self.assertEqual(res_metrics.status_code, 200)
        self.assertIn("memory_rss_mb", res_metrics.json())

        # Post request with whitelisted Origin returns result AND CORS headers
        res_add = self.client.post(
            "/api/add",
            json={"role": "user", "content": "Hello world"},
            headers={"Origin": "http://localhost:3000"},
        )
        self.assertEqual(res_add.status_code, 200)
        self.assertIn("node_id", res_add.json())
        self.assertEqual(res_add.headers.get("access-control-allow-origin"), "http://localhost:3000")

        # Search request works
        res_search = self.client.post(
            "/api/search",
            json={"query": "Hello", "k": 1},
            headers={"Origin": "http://localhost:3000"},
        )
        self.assertEqual(res_search.status_code, 200)
        self.assertIn("results", res_search.json())

        # Compress request works
        res_compress = self.client.post(
            "/api/compress",
            json={"query": "Hello"},
            headers={"Origin": "http://localhost:3000"},
        )
        self.assertEqual(res_compress.status_code, 200)
        self.assertIn("compressed", res_compress.json())

        # Clear endpoint works
        res_clear = self.client.delete(
            "/api/clear",
            headers={"Origin": "http://localhost:3000"},
        )
        self.assertEqual(res_clear.status_code, 200)
        self.assertEqual(res_clear.json()["status"], "cleared")
        self.assertEqual(res_clear.headers.get("access-control-allow-origin"), "http://localhost:3000")

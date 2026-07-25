import json
import logging
from typing import Any, Dict, List, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


class CompressionClient:
    def __init__(self, server_url: str = "http://127.0.0.1:8890"):
        self.server_url = server_url.rstrip("/")

    def _request(
        self, method: str, path: str, data: Optional[Dict] = None
    ) -> Any:
        url = f"{self.server_url}{path}"
        body = json.dumps(data).encode() if data else None
        req = Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except URLError as e:
            logger.error(f"Request failed: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            raise

    def health(self) -> Dict:
        return self._request("GET", "/api/health")

    def stats(self) -> Dict:
        return self._request("GET", "/api/stats")

    def add_message(
        self,
        role: str,
        content: str,
        metadata: Optional[Dict] = None,
    ) -> int:
        result = self._request(
            "POST", "/api/add",
            {"role": role, "content": content, "metadata": metadata},
        )
        return result["node_id"]

    def compress_context(
        self, query: str, max_tokens: Optional[int] = None
    ) -> Dict:
        body = {"query": query}
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return self._request("POST", "/api/compress", body)

    def search_context(self, query: str, k: int = 10) -> List[Dict]:
        result = self._request(
            "POST", "/api/search", {"query": query, "k": k}
        )
        return result["results"]

    def deduplicate(self, threshold: Optional[float] = None) -> int:
        body = {}
        if threshold is not None:
            body["threshold"] = threshold
        result = self._request("POST", "/api/deduplicate", body)
        return result["removed"]

    def store_add(self, text: str, metadata: Optional[Dict] = None) -> int:
        result = self._request(
            "POST", "/api/store/add",
            {"text": text, "metadata": metadata},
        )
        return result["node_id"]

    def store_search(self, query: str, k: int = 10) -> List[Dict]:
        result = self._request(
            "POST", "/api/store/search", {"query": query, "k": k}
        )
        return result["results"]

    def clear(self) -> Dict:
        return self._request("DELETE", "/api/clear")

import hashlib
from typing import Dict, List, Optional, Tuple

from ..embedding.embedder import Embedder
from ..index.hnsw_index import HNSWIndex


class ContextCompressor:
    def __init__(
        self,
        dimension: int = 128,
        similarity_threshold: float = 0.85,
        max_tokens: int = 4096,
        ef_search: int = 50,
        m: int = 16,
    ):
        self.dimension = dimension
        self.similarity_threshold = similarity_threshold
        self.max_tokens = max_tokens

        self.embedder = Embedder(dimension=dimension)
        self.index = HNSWIndex(
            dimension=dimension,
            m=m,
            ef_search=ef_search,
            ef_construction=200,
        )

        self._messages: Dict[int, dict] = {}
        self._token_budget: int = max_tokens
        self._current_tokens: int = 0

    def _estimate_tokens(self, text: str) -> int:
        return len(text) // 4 + 1

    def _content_hash(self, text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    def add_message(
        self,
        role: str,
        content: str,
        metadata: Optional[Dict] = None,
    ) -> int:
        meta = {"role": role, "content_hash": self._content_hash(content)}
        if metadata:
            meta.update(metadata)

        self.embedder.update_from_doc(content)

        vector = self.embedder.embed(content)

        node_id = self.index.add(vector, metadata=meta)

        token_count = self._estimate_tokens(content)
        self._messages[node_id] = {
            "role": role,
            "content": content,
            "tokens": token_count,
            "timestamp": len(self._messages),
            "metadata": metadata or {},
        }
        self._current_tokens += token_count

        return node_id

    def get_relevant_context(
        self, query: str, max_results: int = 5
    ) -> List[Dict]:
        query_vector = self.embedder.embed(query)
        results = self.index.search(query_vector, k=max_results)

        context = []
        for similarity, node_id, metadata in results:
            msg = self._messages.get(node_id)
            if msg is None:
                continue
            context.append({
                "node_id": node_id,
                "similarity": similarity,
                "role": msg["role"],
                "content": msg["content"],
                "tokens": msg["tokens"],
                "metadata": msg["metadata"],
            })

        return context

    def compress_context(
        self, query: str, max_tokens: Optional[int] = None
    ) -> Tuple[List[Dict], int]:
        if max_tokens is None:
            max_tokens = self.max_tokens

        query_vector = self.embedder.embed(query)

        k = min(len(self._messages), 50) if self._messages else 0
        if k == 0:
            return [], 0

        results = self.index.search(query_vector, k=k)

        compressed = []
        total_tokens = 0

        for similarity, node_id, metadata in results:
            msg = self._messages.get(node_id)
            if msg is None:
                continue
            if total_tokens + msg["tokens"] > max_tokens:
                continue
            compressed.append({
                "node_id": node_id,
                "similarity": similarity,
                "role": msg["role"],
                "content": msg["content"],
                "tokens": msg["tokens"],
            })
            total_tokens += msg["tokens"]

        compressed.sort(key=lambda x: x["similarity"], reverse=True)

        return compressed, total_tokens

    def deduplicate(
        self, threshold: Optional[float] = None
    ) -> int:
        if threshold is None:
            threshold = self.similarity_threshold

        if self.index.size() < 2:
            return 0

        all_ids = list(self._messages.keys())
        removed = 0

        for i in range(len(all_ids)):
            node_id_i = all_ids[i]
            if node_id_i not in self._messages:
                continue
            msg_i = self._messages[node_id_i]
            vec_i = self.embedder.embed(msg_i["content"])

            results = self.index.search(vec_i, k=min(10, self.index.size()))
            for similarity, node_id_j, _ in results:
                if node_id_j == node_id_i:
                    continue
                if similarity >= threshold:
                    msg_j = self._messages.get(node_id_j)
                    if msg_j is None:
                        continue
                    if msg_i["tokens"] >= msg_j["tokens"]:
                        self.index.remove(node_id_j)
                        del self._messages[node_id_j]
                        self._current_tokens -= msg_j["tokens"]
                    else:
                        self.index.remove(node_id_i)
                        del self._messages[node_id_i]
                        self._current_tokens -= msg_i["tokens"]
                    removed += 1
                    break

        return removed

    def get_stats(self) -> Dict:
        return {
            "total_messages": len(self._messages),
            "current_tokens": self._current_tokens,
            "token_budget": self.max_tokens,
            "token_utilization_pct": round(
                (self._current_tokens / self.max_tokens) * 100, 2
            )
            if self.max_tokens > 0
            else 0,
            "index_size": self.index.size(),
        }

    def clear(self):
        self.index.clear()
        self._messages.clear()
        self._current_tokens = 0

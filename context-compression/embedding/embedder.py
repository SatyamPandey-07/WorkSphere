import hashlib
import math
import re
from collections import Counter
from typing import List, Optional


class Embedder:
    def __init__(self, dimension: int = 128, use_tfidf: bool = True):
        self.dimension = dimension
        self.use_tfidf = use_tfidf
        self._vocab: Counter = Counter()
        self._doc_count: int = 0
        self._idf_cache: dict = {}

    def _tokenize(self, text: str) -> List[str]:
        tokens = re.findall(r"\b[a-z0-9]+\b", text.lower())
        return tokens

    def _hash_feature(self, token: str, seed: int = 0) -> int:
        h = int(hashlib.md5(f"{token}:{seed}".encode()).hexdigest(), 16)
        return h % self.dimension

    def _bow_vector(self, tokens: List[str]) -> List[float]:
        vec = [0.0] * self.dimension
        for token in set(tokens):
            idx = self._hash_feature(token)
            vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    def _tfidf_vector(self, tokens: List[str]) -> List[float]:
        vec = [0.0] * self.dimension
        term_counts = Counter(tokens)
        max_tf = max(term_counts.values()) if term_counts else 1
        for token, count in term_counts.items():
            idx = self._hash_feature(token)
            tf = count / max_tf
            idf = self._idf_cache.get(token, 1.0)
            vec[idx] += tf * idf
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    def embed(self, text: str) -> List[float]:
        tokens = self._tokenize(text)
        if not tokens:
            return [0.0] * self.dimension
        if self.use_tfidf:
            return self._tfidf_vector(tokens)
        return self._bow_vector(tokens)

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        return [self.embed(t) for t in texts]

    def update_vocab(self, texts: List[str]):
        for text in texts:
            tokens = self._tokenize(text)
            self._vocab.update(set(tokens))
            self._doc_count += 1
        for token in self._vocab:
            df = self._vocab[token]
            self._idf_cache[token] = math.log((self._doc_count + 1) / (df + 1)) + 1.0

    def update_from_doc(self, doc: str):
        self.update_vocab([doc])

from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class CompressRequest(BaseModel):
    query: str = Field(min_length=1)
    max_tokens: Optional[int] = None


class CompressResponse(BaseModel):
    # Note: Issue #3318 specifies `compressed: str`, but ContextCompressor.compress_context()
    # returns List[Dict] with structured message items (node_id, similarity, role, content, tokens).
    # Union[str, List[Dict[str, Any]]] preserves the existing API contract while accepting string schemas.
    compressed: Union[str, List[Dict[str, Any]]]
    total_tokens: int
    stats: Dict[str, Any]


class AddMessageRequest(BaseModel):
    role: str = "user"
    content: str = Field(min_length=1)
    metadata: Optional[Dict[str, Any]] = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    k: int = Field(default=10, ge=1, le=100)


class StoreAddRequest(BaseModel):
    text: str = Field(min_length=1)
    metadata: Optional[Dict[str, Any]] = None


class DeduplicateRequest(BaseModel):
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class HealthResponse(BaseModel):
    status: str = "ok"
    uptime_seconds: float = Field(ge=0.0)
    version: Optional[str] = None

    def __getitem__(self, item):
        return getattr(self, item)


class MetricsResponse(BaseModel):
    vector_count: int = Field(ge=0)
    total_messages: int = Field(ge=0)
    dimension: int = Field(gt=0)
    memory_rss_mb: float = Field(ge=0.0)
    cache_size: int = Field(default=0, ge=0)
    cache_capacity: int = Field(default=0, ge=0)
    cache_hits: int = Field(default=0, ge=0)
    cache_misses: int = Field(default=0, ge=0)
    cache_hit_rate: float = Field(default=0.0, ge=0.0, le=1.0)

    def __getitem__(self, item):
        return getattr(self, item)

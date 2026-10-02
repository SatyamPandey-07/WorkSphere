import asyncio
import json
import logging
import threading
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

try:
    from ..compression.compressor import ContextCompressor
    from ..storage.store import VectorStore
    from .schemas import (
        AddMessageRequest,
        CompressRequest,
        CompressResponse,
        DeduplicateRequest,
        SearchRequest,
        StoreAddRequest,
    )
except (ImportError, ValueError):
    from compression.compressor import ContextCompressor
    from storage.store import VectorStore
    try:
        from server.schemas import (
            AddMessageRequest,
            CompressRequest,
            CompressResponse,
            DeduplicateRequest,
            SearchRequest,
            StoreAddRequest,
        )
    except (ImportError, ValueError):
        from schemas import (
            AddMessageRequest,
            CompressRequest,
            CompressResponse,
            DeduplicateRequest,
            SearchRequest,
            StoreAddRequest,
        )

logger = logging.getLogger(__name__)


def create_app(
    compressor: Optional[ContextCompressor] = None,
    store: Optional[VectorStore] = None,
) -> FastAPI:
    if compressor is None:
        compressor = ContextCompressor()
    if store is None:
        store = VectorStore()

    app = FastAPI(title="Context Compression Server")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/stats")
    async def stats():
        return {
            "compressor": compressor.get_stats(),
            "store": {"size": store.size()},
        }

    @app.post("/api/add")
    async def add_message(request: AddMessageRequest):
        node_id = compressor.add_message(request.role, request.content, request.metadata)
        return {"node_id": node_id}

    @app.post("/api/search")
    async def search(request: SearchRequest):
        results = compressor.get_relevant_context(request.query, request.k)
        return {"results": results}

    @app.post("/api/compress", response_model=CompressResponse)
    async def compress(request: CompressRequest):
        result, tokens = compressor.compress_context(
            request.query, max_tokens=request.max_tokens
        )
        return {
            "compressed": result,
            "total_tokens": tokens,
            "stats": compressor.get_stats(),
        }

    @app.post("/api/compress/stream")
    async def compress_stream(
        payload: CompressRequest,
        request: Request = None,
    ):
        if not isinstance(payload, CompressRequest):
            raw_req = payload
            data = await raw_req.json()
            payload = CompressRequest.model_validate(data)
            request = raw_req

        query = payload.query
        max_tokens = payload.max_tokens

        async def event_generator():
            try:
                total_yielded = 0
                async for chunk in compressor.compress_context_stream(
                    query, max_tokens=max_tokens
                ):
                    if await request.is_disconnected():
                        logger.info("Client disconnected, aborting compression stream early")
                        break

                    chunk_payload = json.dumps({
                        "chunk": chunk,
                        "done": False,
                    })
                    yield f"data: {chunk_payload}\n\n"
                    total_yielded += 1
                    await asyncio.sleep(0)

                if not await request.is_disconnected():
                    done_payload = json.dumps({
                        "done": True,
                        "total_yielded": total_yielded,
                        "stats": compressor.get_stats(),
                    })
                    yield f"data: {done_payload}\n\n"
                    yield "data: [DONE]\n\n"
            except (asyncio.CancelledError, GeneratorExit):
                logger.info("Compression streaming cancelled due to client disconnect")
                raise

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/api/deduplicate")
    async def deduplicate(payload: DeduplicateRequest):
        removed = compressor.deduplicate(threshold=payload.threshold)
        return {
            "removed": removed,
            "stats": compressor.get_stats(),
        }

    @app.post("/api/store/add")
    async def store_add(request: StoreAddRequest):
        node_id = store.add(request.text, request.metadata)
        return {"node_id": node_id}

    @app.post("/api/store/search")
    async def store_search(request: SearchRequest):
        results = store.search(request.query, request.k)
        return {"results": results}

    @app.delete("/api/clear")
    async def clear():
        compressor.clear()
        store.clear()
        return {"status": "cleared"}

    return app


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
        self.app = create_app(compressor=self.compressor, store=self.store)

        self._server: Optional[uvicorn.Server] = None
        self._thread: Optional[threading.Thread] = None

    def start(self):
        config = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="info",
        )
        self._server = uvicorn.Server(config)
        logger.info(
            f"CompressionServer listening on http://{self.host}:{self.port}"
        )
        try:
            self._server.run()
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        if self._server:
            self._server.should_exit = True
            logger.info("CompressionServer stopped")

    def run_in_thread(self):
        config = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="warning",
        )
        self._server = uvicorn.Server(config)
        thread = threading.Thread(target=self._server.run, daemon=True)
        thread.start()
        self._thread = thread
        logger.info(
            f"CompressionServer running in thread on http://{self.host}:{self.port}"
        )
        return thread

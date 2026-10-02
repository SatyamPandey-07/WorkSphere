import asyncio
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Union

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

DEFAULT_CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def parse_cors_allowed_origins(
    origins_val: Optional[str] = None,
) -> List[str]:
    """Parse comma-separated allowed origins from a string or environment variable.

    Defaults to http://localhost:3000,http://127.0.0.1:3000 if not set in the environment.
    Splits by comma, strips whitespace, and filters out empty values.
    """
    if origins_val is None:
        origins_val = os.getenv("CORS_ALLOWED_ORIGINS")
    if origins_val is None:
        return list(DEFAULT_CORS_ALLOWED_ORIGINS)
    return [origin.strip() for origin in origins_val.split(",") if origin.strip()]


get_cors_allowed_origins = parse_cors_allowed_origins

try:
    from ..compression.compressor import ContextCompressor
    from ..storage.store import VectorStore
    from .schemas import (
        AddMessageRequest,
        CompressRequest,
        CompressResponse,
        DeduplicateRequest,
        HealthResponse,
        MetricsResponse,
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
            HealthResponse,
            MetricsResponse,
            SearchRequest,
            StoreAddRequest,
        )
    except (ImportError, ValueError):
        from schemas import (
            AddMessageRequest,
            CompressRequest,
            CompressResponse,
            DeduplicateRequest,
            HealthResponse,
            MetricsResponse,
            SearchRequest,
            StoreAddRequest,
        )

logger = logging.getLogger(__name__)

_SERVICE_VERSION: Optional[str] = None
_VERSION_INITIALIZED: bool = False


def get_service_version() -> Optional[str]:
    global _SERVICE_VERSION, _VERSION_INITIALIZED
    if not _VERSION_INITIALIZED:
        try:
            pkg_path = Path(__file__).resolve().parents[2] / "package.json"
            if pkg_path.is_file():
                with open(pkg_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    _SERVICE_VERSION = data.get("version")
        except Exception:
            _SERVICE_VERSION = None
        _VERSION_INITIALIZED = True
    return _SERVICE_VERSION


def get_memory_rss_mb() -> float:
    # 1. psutil (preferred if installed)
    try:
        import psutil

        process = psutil.Process()
        return round(process.memory_info().rss / (1024 * 1024), 2)
    except Exception:
        pass

    # 2. Linux /proc/self/status
    try:
        with open("/proc/self/status", "r") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    return round(float(parts[1]) / 1024.0, 2)
    except Exception:
        pass

    # 3. Windows ctypes K32GetProcessMemoryInfo
    try:
        import ctypes
        import ctypes.wintypes

        class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.wintypes.DWORD),
                ("PageFaultCount", ctypes.wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        fn = getattr(ctypes.windll.kernel32, "K32GetProcessMemoryInfo", None)
        if fn is None and hasattr(ctypes.windll, "psapi"):
            fn = getattr(ctypes.windll.psapi, "GetProcessMemoryInfo", None)

        if fn:
            fn.argtypes = [
                ctypes.wintypes.HANDLE,
                ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX),
                ctypes.wintypes.DWORD,
            ]
            fn.restype = ctypes.wintypes.BOOL
            counters = PROCESS_MEMORY_COUNTERS_EX()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if fn(handle, ctypes.byref(counters), counters.cb):
                return round(counters.WorkingSetSize / (1024 * 1024), 2)
    except Exception:
        pass

    # 4. Unix resource.getrusage (macOS / BSD / Unix)
    try:
        import resource
        import sys

        rusage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform == "darwin":
            return round(rusage / (1024 * 1024), 2)
        else:
            return round(rusage / 1024.0, 2)
    except Exception:
        pass

    return 0.0


def create_app(
    compressor: Optional[ContextCompressor] = None,
    store: Optional[VectorStore] = None,
    api_key: Optional[str] = None,
    cors_allowed_origins: Optional[Union[List[str], str]] = None,
) -> FastAPI:
    if compressor is None:
        compressor = ContextCompressor()
    if store is None:
        store = VectorStore()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.start_time = time.monotonic()
        yield

    app = FastAPI(title="Context Compression Server", lifespan=lifespan)
    app.state.start_time = time.monotonic()
    app.state.compressor = compressor
    app.state.store = store

    if cors_allowed_origins is None:
        allowed_origins = parse_cors_allowed_origins()
    elif isinstance(cors_allowed_origins, str):
        allowed_origins = parse_cors_allowed_origins(cors_allowed_origins)
    else:
        allowed_origins = [
            origin.strip()
            for origin in cors_allowed_origins
            if origin and origin.strip()
        ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.middleware("http")
    async def add_process_time_header(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        process_time = (time.perf_counter() - start) * 1000
        response.headers["x-process-time"] = f"{process_time:.2f}ms"
        return response

    @app.middleware("http")
    async def api_key_auth_middleware(request: Request, call_next):
        token_to_check = api_key or os.environ.get("COMPRESSION_API_KEY")
        if not token_to_check:
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        if (
            request.url.path in {"/health", "/docs", "/openapi.json", "/redoc"}
            or request.url.path.startswith("/docs")
        ):
            return await call_next(request)
        auth_header = request.headers.get("Authorization", "")
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer" or parts[1] != token_to_check:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        return await call_next(request)

    @app.get("/health", response_model=HealthResponse)
    async def get_health():
        start_time = getattr(app.state, "start_time", None)
        if start_time is None:
            start_time = time.monotonic()
            app.state.start_time = start_time
        uptime = max(0.0, time.monotonic() - start_time)
        return HealthResponse(
            status="ok",
            uptime_seconds=uptime,
            version=get_service_version(),
        )

    @app.get("/api/metrics", response_model=MetricsResponse)
    async def get_metrics():
        active_store = getattr(app.state, "store", store)
        active_compressor = getattr(app.state, "compressor", compressor)
        v_count = (
            active_store.size()
            if hasattr(active_store, "size") and callable(active_store.size)
            else 0
        )
        if hasattr(active_compressor, "get_stats") and callable(
            active_compressor.get_stats
        ):
            t_messages = active_compressor.get_stats().get("total_messages", 0)
        elif hasattr(active_compressor, "_messages"):
            t_messages = len(active_compressor._messages)
        else:
            t_messages = 0
        dim = getattr(
            active_store,
            "dimension",
            getattr(active_compressor, "dimension", 128),
        )
        rss = get_memory_rss_mb()
        return MetricsResponse(
            vector_count=v_count,
            total_messages=t_messages,
            dimension=dim,
            memory_rss_mb=rss,
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
        api_key: Optional[str] = None,
        cors_allowed_origins: Optional[Union[List[str], str]] = None,
    ):
        self.host = host
        self.port = port
        self.persist_path = persist_path
        self.api_key = api_key or os.environ.get("COMPRESSION_API_KEY")

        self.compressor = ContextCompressor(
            dimension=dimension,
            max_tokens=max_tokens,
            similarity_threshold=similarity_threshold,
        )
        self.store = VectorStore(dimension=dimension)
        self.app = create_app(
            compressor=self.compressor,
            store=self.store,
            api_key=self.api_key,
            cors_allowed_origins=cors_allowed_origins,
        )

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

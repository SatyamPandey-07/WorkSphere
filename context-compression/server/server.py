import asyncio
import json
import logging
import threading
import time
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

try:
    from ..compression.compressor import ContextCompressor
    from ..storage.store import VectorStore
except (ImportError, ValueError):
    from compression.compressor import ContextCompressor
    from storage.store import VectorStore

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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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

    @app.middleware("http")
    async def add_process_time_header(request: Request, call_next):
        start_time = time.perf_counter()
        response = await call_next(request)
        process_time_ms = (time.perf_counter() - start_time) * 1000
        response.headers["X-Process-Time"] = f"{process_time_ms:.2f}ms"
        logger.info(
            f"{request.method} {request.url.path} - Status: {response.status_code} - Duration: {process_time_ms:.2f}ms"
        )
        return response

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
    async def add_message(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        role = body.get("role", "user")
        content = body.get("content", "")
        metadata = body.get("metadata")
        node_id = compressor.add_message(role, content, metadata)
        return {"node_id": node_id}

    @app.post("/api/search")
    async def search(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        query = body.get("query", "")
        k = body.get("k", 10)
        results = compressor.get_relevant_context(query, k)
        return {"results": results}

    @app.post("/api/compress")
    async def compress(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        query = body.get("query", "")
        max_tokens = body.get("max_tokens")
        result, tokens = compressor.compress_context(
            query, max_tokens=max_tokens
        )
        return {
            "compressed": result,
            "total_tokens": tokens,
            "stats": compressor.get_stats(),
        }

    @app.post("/api/compress/stream")
    async def compress_stream(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        query = body.get("query", "")
        max_tokens = body.get("max_tokens")

        async def event_generator():
            try:
                total_yielded = 0
                async for chunk in compressor.compress_context_stream(
                    query, max_tokens=max_tokens
                ):
                    if await request.is_disconnected():
                        logger.info("Client disconnected, aborting compression stream early")
                        break

                    payload = json.dumps({
                        "chunk": chunk,
                        "done": False,
                    })
                    yield f"data: {payload}\n\n"
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
    async def deduplicate(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        threshold = body.get("threshold")
        removed = compressor.deduplicate(threshold=threshold)
        return {
            "removed": removed,
            "stats": compressor.get_stats(),
        }

    @app.post("/api/store/add")
    async def store_add(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        text = body.get("text", "")
        metadata = body.get("metadata")
        node_id = store.add(text, metadata)
        return {"node_id": node_id}

    @app.post("/api/store/search")
    async def store_search(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        query = body.get("query", "")
        k = body.get("k", 10)
        results = store.search(query, k)
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

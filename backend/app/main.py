"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import Settings, get_settings
from app.deps import Container
from app.errors import install_error_handlers
from app.logging_config import configure_logging
from app.routers import analysis, system
from app.services.analysis import AnalysisService
from app.services.cache import DiskCache
from app.services.elexon_client import ElexonClient
from app.services.ingestion import IngestionService

log = logging.getLogger("windscope")

API_DESCRIPTION = """
Wind-forecast accuracy analytics for a UK day-ahead trading team, built only from Elexon
**FUELHH** (actual wind generation, `fuelType=WIND`) and **WINDFOR** (wind forecasts).

For each half-hourly delivery interval the API selects the **latest WINDFOR forecast whose
`publishTime` is at or before the configured decision cutoff**, matches it to the actual on
normalised UTC timestamps, and reports MAE, RMSE, signed bias (forecast - actual) and WAPE
(only when its denominator is valid). Units: megawatts (MW). `null` means *not available*, never zero.
"""


def create_app(
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        cache = DiskCache(settings.cache_dir)
        client = ElexonClient(settings, transport=transport)
        ingestion = IngestionService(settings, cache, client)
        await asyncio.to_thread(ingestion.load_from_cache)
        container = Container(
            settings=settings,
            cache=cache,
            client=client,
            ingestion=ingestion,
            analysis=AnalysisService(ingestion, settings),
        )
        app.state.container = container
        if settings.auto_ingest_on_startup:
            task = asyncio.create_task(ingestion.run(force=False))
            container.tasks.add(task)
            task.add_done_callback(container.tasks.discard)
        log.info("windscope started", extra={"version": __version__, "cache_dir": str(settings.cache_dir)})
        try:
            yield
        finally:
            for t in list(container.tasks):
                t.cancel()
            await client.aclose()

    app = FastAPI(
        title="WindScope UK API",
        version=__version__,
        description=API_DESCRIPTION,
        lifespan=lifespan,
    )
    install_error_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        expose_headers=["Content-Disposition"],
        max_age=600,
    )

    @app.middleware("http")
    async def access_log(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        started = time.monotonic()
        response = await call_next(request)
        if request.url.path != "/health":
            log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": int((time.monotonic() - started) * 1000),
                },
            )
        return response

    app.include_router(system.router)
    app.include_router(analysis.router)
    return app


app = create_app()

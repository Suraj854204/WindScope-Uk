"""Health, configuration and dataset-status endpoints."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from fastapi import APIRouter

from app import presenters
from app.deps import ContainerDep
from app.schemas import ConfigOut, DatasetStatusOut, HealthOut, RefreshOut, RefreshRequest
from app.services.analysis import _expected

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/health", response_model=HealthOut, tags=["system"], summary="Liveness probe")
@router.get("/api/v1/health", response_model=HealthOut, tags=["system"], include_in_schema=False)
def health() -> HealthOut:
    return HealthOut(status="ok", version=presenters.version(), time=datetime.now(UTC))


@router.get("/api/v1/config", response_model=ConfigOut, tags=["system"])
def get_config(container: ContainerDep) -> ConfigOut:
    s = container.settings
    return ConfigOut(
        version=presenters.version(),
        environment=s.app_env,
        period=presenters.period_out(s.period_start, s.period_end, len(_expected(s.period_start, s.period_end))),
        default_cutoff=presenters.cutoff_out(presenters.default_policy(s), s),
        wape_min_mean_actual_mw=s.wape_min_mean_actual_mw,
        min_sample_warning=s.min_sample_warning,
        cache_stale_after_hours=s.cache_stale_after_hours,
        api_base_url=s.elexon_base_url,
        datasets=presenters.DATASET_DESCRIPTIONS,
    )


@router.get("/api/v1/dataset/status", response_model=DatasetStatusOut, tags=["dataset"])
def dataset_status(container: ContainerDep) -> DatasetStatusOut:
    s = container.settings
    return presenters.dataset_status_out(container.ingestion, s, len(_expected(s.period_start, s.period_end)))


@router.post("/api/v1/dataset/refresh", response_model=RefreshOut, tags=["dataset"])
async def refresh_dataset(body: RefreshRequest, container: ContainerDep) -> RefreshOut:
    """Start (or retry) the download in the background. Cached requests are skipped unless
    ``force`` is true. Poll ``/api/v1/dataset/status`` for progress."""
    s = container.settings
    ing = container.ingestion
    expected = len(_expected(s.period_start, s.period_end))

    def reply(accepted: bool, message: str) -> RefreshOut:
        return RefreshOut(
            accepted=accepted,
            message=message,
            status=presenters.dataset_status_out(ing, s, expected),
        )

    if ing.state.running:
        return reply(False, "A download is already in progress.")
    if body.force and ing.state.last_attempt_at is not None:
        age = (datetime.now(UTC) - ing.state.last_attempt_at).total_seconds()
        if age < s.refresh_cooldown_s:
            wait = int(s.refresh_cooldown_s - age) + 1
            return reply(False, f"A forced refresh was started recently. Try again in {wait}s.")

    task = asyncio.create_task(ing.run(force=body.force))
    container.tasks.add(task)
    task.add_done_callback(container.tasks.discard)
    # give the task a chance to flip `running` so the response reflects it
    await asyncio.sleep(0)
    return reply(
        True, "Forced re-download started." if body.force else "Download started (cached requests are reused)."
    )

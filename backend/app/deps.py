"""Application container and shared request-parameter dependencies."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date, time
from typing import Annotated, Literal

from fastapi import Depends, Query, Request

from app.config import Settings
from app.domain.cutoff import CutoffPolicy
from app.errors import ApiError
from app.presenters import default_policy
from app.services.analysis import AnalysisParams, AnalysisService
from app.services.cache import DiskCache
from app.services.elexon_client import ElexonClient
from app.services.ingestion import IngestionService


@dataclass
class Container:
    settings: Settings
    cache: DiskCache
    client: ElexonClient
    ingestion: IngestionService
    analysis: AnalysisService
    tasks: set[asyncio.Task[object]] = field(default_factory=set)


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


ContainerDep = Annotated[Container, Depends(get_container)]

_HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


def analysis_params(
    container: ContainerDep,
    date_from: Annotated[date | None, Query(description="First London delivery date (inclusive)")] = None,
    date_to: Annotated[date | None, Query(description="Last London delivery date (inclusive)")] = None,
    cutoff_mode: Annotated[Literal["day_ahead", "lead_time"], Query()] = "day_ahead",
    cutoff_time: Annotated[str | None, Query(pattern=_HHMM, description="HH:MM Europe/London")] = None,
    days_before: Annotated[int | None, Query(ge=0, le=14)] = None,
    lead_hours: Annotated[float | None, Query(ge=0, le=336)] = None,
) -> AnalysisParams:
    s = container.settings
    start = date_from or s.period_start
    end = date_to or s.period_end
    if start > end:
        raise ApiError(422, "invalid_date_range", "date_from must be on or before date_to")
    if start < s.period_start or end > s.period_end:
        raise ApiError(
            422,
            "date_out_of_range",
            f"Dates must lie within the analysis period {s.period_start} to {s.period_end}",
        )
    default = default_policy(s)
    if cutoff_mode == "lead_time":
        policy = CutoffPolicy(
            "lead_time",
            default.local_time,
            default.days_before,
            lead_hours if lead_hours is not None else s.default_lead_hours,
        )
    else:
        if cutoff_time is not None:
            hh, mm = cutoff_time.split(":")
            local = time(int(hh), int(mm))
        else:
            local = default.local_time
        policy = CutoffPolicy(
            "day_ahead",
            local,
            days_before if days_before is not None else default.days_before,
            default.lead_hours,
        )
    return AnalysisParams(start, end, policy)


ParamsDep = Annotated[AnalysisParams, Depends(analysis_params)]

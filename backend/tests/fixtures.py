"""TEST FIXTURES ONLY - a synthetic stand-in for the Elexon API.

Nothing here is real generation data and none of it is reachable from the running application.
The values are designed so end-to-end results are hand-checkable:

* actual(start)            = 3000 + (half-hour index mod 40) * 50  MW
* forecast published at T  = actual(start) + offset(T.hour)         MW, offsets 00:00 -> +50,
  06:00 -> +100, 12:00 -> +150, 18:00 -> +200. Forecasts are published every 6 h and look
  72 h ahead.

Hence with the default 09:00 London D-1 cutoff the selected vintage is always the 06:00 D-1 run,
so every matched interval has signed error exactly +100 MW (MAE = RMSE = bias = 100).
With a 13:00 cutoff the 12:00 run is selected and the error is +150 MW.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx

from app.config import Settings
from app.domain.timeutils import (
    HALF_HOUR,
    expected_interval_starts,
    iso_z,
    settlement_date_and_period,
)

EPOCH = datetime(2026, 1, 1, tzinfo=UTC)
OFFSETS = {0: 50.0, 6: 100.0, 12: 150.0, 18: 200.0}


def actual_mw(start: datetime) -> float:
    steps = int((start - EPOCH) / HALF_HOUR)
    return 3000.0 + (steps % 40) * 50.0


def make_settings(tmp_path: Path, **overrides: object) -> Settings:
    base: dict[str, object] = {
        "cache_dir": tmp_path / "cache",
        "period_start": date(2026, 1, 1),
        "period_end": date(2026, 1, 3),
        "windfor_lookback_days": 3,
        "fuelhh_chunk_days": 2,
        "windfor_chunk_hours": 24,
        "elexon_min_request_interval_s": 0.0,
        "elexon_backoff_base_s": 0.0,
        "elexon_backoff_max_s": 0.0,
        "elexon_max_retries": 1,
        "auto_ingest_on_startup": True,
        "log_json": False,
        "refresh_cooldown_s": 0,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


def _parse_z(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


class SyntheticElexon:
    """httpx.MockTransport handler. Records every request in ``self.calls``."""

    def __init__(
        self,
        fail_all: int | None = None,
        fail_windfor_from: set[str] | None = None,
        extra_actuals: Callable[[date], list[dict[str, object]]] | None = None,
    ) -> None:
        self.calls: list[httpx.Request] = []
        self.fail_all = fail_all  # HTTP status to return for every request
        self.fail_windfor_from = fail_windfor_from or set()
        self.extra_actuals = extra_actuals

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.__call__)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.fail_all is not None:
            return httpx.Response(self.fail_all, json={"error": "synthetic failure"})
        path = request.url.path
        q = request.url.params
        if path.endswith("/datasets/FUELHH/stream"):
            return httpx.Response(200, json=self._fuelhh(q["settlementDateFrom"], q["settlementDateTo"]))
        if path.endswith("/datasets/WINDFOR/stream"):
            if q["publishDateTimeFrom"] in self.fail_windfor_from:
                return httpx.Response(503, json={"error": "synthetic outage"})
            return httpx.Response(200, json=self._windfor(q["publishDateTimeFrom"], q["publishDateTimeTo"]))
        return httpx.Response(404, json={"error": "unknown"})

    @staticmethod
    def _fuelhh(d_from: str, d_to: str) -> list[dict[str, object]]:
        out: list[dict[str, object]] = []
        d = date.fromisoformat(d_from)
        end = date.fromisoformat(d_to)
        while d <= end:
            for i, s in enumerate(expected_interval_starts(d, d)):
                _, period = settlement_date_and_period(s)
                out.append(
                    {
                        "dataset": "FUELHH",
                        "publishTime": iso_z(s + timedelta(minutes=35)),
                        "startTime": iso_z(s),
                        "settlementDate": d.isoformat(),
                        "settlementPeriod": period,
                        "fuelType": "WIND",
                        "generation": actual_mw(s),
                    }
                )
                if i == 0:  # a non-wind record the app must ignore
                    out.append({**out[-1], "fuelType": "CCGT", "generation": 99999})
            d += timedelta(days=1)
        return out

    @staticmethod
    def _windfor(p_from: str, p_to: str) -> list[dict[str, object]]:
        start = _parse_z(p_from)
        end = _parse_z(p_to)
        t = start.replace(minute=0, second=0, microsecond=0)
        while t < start or t.hour % 6 != 0:
            t += timedelta(hours=1)
        out: list[dict[str, object]] = []
        while t <= end:  # inclusive upper bound => boundary records appear in two requests
            for k in range(1, 72 * 2 + 1):
                s = t + HALF_HOUR * k
                out.append(
                    {
                        "dataset": "WINDFOR",
                        "publishTime": iso_z(t),
                        "startTime": iso_z(s),
                        "generation": actual_mw(s) + OFFSETS[t.hour],
                    }
                )
            t += timedelta(hours=6)
        return out

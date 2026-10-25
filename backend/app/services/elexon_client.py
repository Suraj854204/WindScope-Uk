"""Resilient async client for the Elexon Insights ``/datasets/{DATASET}/stream`` endpoints.

* Stream endpoints return a single JSON array with no pagination; the body is read as a
  chunked byte stream into a size-capped buffer, then decoded.
* Requests are throttled (min interval + concurrency cap) to respect rate limits.
* Transient failures (timeouts, connection errors, HTTP 429/5xx, truncated JSON) are retried
  with exponential backoff + jitter and honour ``Retry-After``. Other 4xx responses fail fast.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import httpx

from app.config import Settings
from app.services.planning import ChunkSpec

log = logging.getLogger(__name__)

ErrorKind = Literal["timeout", "network", "rate_limited", "http", "bad_response", "too_large"]


class ElexonError(Exception):
    def __init__(self, kind: ErrorKind, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.kind: ErrorKind = kind
        self.message = message
        self.status_code = status_code
        self.retry_after: float | None = None


@dataclass(frozen=True, slots=True)
class FetchResult:
    records: list[Any]
    http_status: int
    attempts: int
    duration_ms: int
    url: str
    retrieved_at: datetime


class ElexonClient:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self._s = settings
        self._sleep = sleep
        self._rng = rng or random.Random()
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=settings.elexon_timeout_connect_s,
                read=settings.elexon_timeout_read_s,
                write=30.0,
                pool=30.0,
            ),
            transport=transport,
            headers={"Accept": "application/json", "User-Agent": "WindScopeUK/1.0"},
            follow_redirects=True,
        )
        self._sem = asyncio.Semaphore(max(1, settings.elexon_max_concurrency))
        self._throttle_lock = asyncio.Lock()
        self._last_request = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _throttle(self) -> None:
        async with self._throttle_lock:
            wait = self._s.elexon_min_request_interval_s - (time.monotonic() - self._last_request)
            if wait > 0:
                await self._sleep(wait)
            self._last_request = time.monotonic()

    def _backoff(self, attempt: int, retry_after: float | None) -> float:
        base = min(self._s.elexon_backoff_max_s, self._s.elexon_backoff_base_s * (2**attempt))
        delay = base * self._rng.uniform(0.5, 1.0)
        if retry_after is not None:
            delay = max(delay, min(retry_after, self._s.elexon_backoff_max_s))
        return float(delay)

    async def fetch(self, spec: ChunkSpec) -> FetchResult:
        url = f"{self._s.elexon_base_url.rstrip('/')}/datasets/{spec.dataset}/stream"
        max_attempts = self._s.elexon_max_retries + 1
        last_error: ElexonError | None = None

        for attempt in range(max_attempts):
            started = time.monotonic()
            retry_after: float | None = None
            try:
                async with self._sem:
                    await self._throttle()
                    payload, status, final_url = await self._request(url, spec.params)
                records = self._extract_records(payload)
                return FetchResult(
                    records=records,
                    http_status=status,
                    attempts=attempt + 1,
                    duration_ms=int((time.monotonic() - started) * 1000),
                    url=final_url,
                    retrieved_at=datetime.now(UTC),
                )
            except ElexonError as exc:
                last_error = exc
                if exc.kind in ("http", "too_large"):
                    raise  # non-retryable
                retry_after = exc.retry_after
            except httpx.TimeoutException as exc:
                last_error = ElexonError("timeout", f"Request timed out ({type(exc).__name__})")
            except httpx.TransportError as exc:
                last_error = ElexonError("network", f"Network error: {type(exc).__name__}: {exc}")

            if attempt + 1 < max_attempts:
                delay = self._backoff(attempt, retry_after)
                log.warning(
                    "elexon request failed; retrying",
                    extra={
                        "dataset": spec.dataset,
                        "chunk": spec.key,
                        "attempt": attempt + 1,
                        "kind": last_error.kind if last_error else None,
                        "delay_s": round(delay, 2),
                    },
                )
                await self._sleep(delay)

        assert last_error is not None
        raise last_error

    async def _request(self, url: str, params: dict[str, str]) -> tuple[Any, int, str]:
        async with self._client.stream("GET", url, params=params) as resp:
            status = resp.status_code
            if status == 429 or status >= 500:
                err = ElexonError(
                    "rate_limited" if status == 429 else "bad_response",
                    f"Elexon returned HTTP {status}",
                    status,
                )
                err.retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
                raise err
            if status >= 400:
                snippet = (await resp.aread())[:300].decode("utf-8", "replace")
                raise ElexonError("http", f"Elexon rejected the request (HTTP {status}): {snippet}", status)

            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > self._s.elexon_max_response_bytes:
                    raise ElexonError("too_large", "Response exceeded the configured size limit")
            try:
                payload = json.loads(bytes(buf))
            except ValueError as exc:
                raise ElexonError("bad_response", f"Response was not valid JSON: {exc}", status) from exc
            return payload, status, str(resp.url)

    @staticmethod
    def _extract_records(payload: Any) -> list[Any]:
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict) and isinstance(payload.get("data"), list):
            return list(payload["data"])
        raise ElexonError("bad_response", "Unexpected response shape (expected a JSON array)")


def _parse_retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None

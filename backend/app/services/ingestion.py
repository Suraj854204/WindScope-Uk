"""Download orchestration: cache-first, resumable, honest about partial failure."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.services.cache import DiskCache
from app.services.dataset_store import (
    ChunkPayload,
    DatasetSnapshot,
    build_snapshot,
    empty_snapshot,
)
from app.services.elexon_client import ElexonClient, ElexonError
from app.services.planning import ChunkSpec, ChunkStatus, delivery_window, plan_chunks

log = logging.getLogger(__name__)


@dataclass(slots=True)
class IngestionState:
    running: bool = False
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_error: str | None = None
    total: int = 0
    completed: int = 0
    failed: int = 0


class IngestionService:
    def __init__(self, settings: Settings, cache: DiskCache, client: ElexonClient) -> None:
        self.settings = settings
        self.cache = cache
        self.client = client
        self.snapshot: DatasetSnapshot = empty_snapshot()
        self.state = IngestionState()
        self._lock = asyncio.Lock()
        self._specs = plan_chunks(settings)
        self._restore_state()

    # ------------------------------------------------------------------ startup
    def _restore_state(self) -> None:
        saved = self.cache.read_state()
        if saved.get("last_attempt_at"):
            with contextlib.suppress(ValueError):
                self.state.last_attempt_at = datetime.fromisoformat(saved["last_attempt_at"])
        self.state.last_error = saved.get("last_error")

    def load_from_cache(self) -> None:
        """Populate the snapshot from disk only (no network)."""
        payloads: list[ChunkPayload] = []
        statuses: list[ChunkStatus] = []
        for spec in self._specs:
            cached = self.cache.read(spec.key)
            status = ChunkStatus(spec.dataset, spec.key, spec.window)
            if cached is not None:
                status.state = "cached"
                status.retrieved_at = cached.retrieved_at
                status.record_count = cached.record_count
                payloads.append(ChunkPayload(spec, cached.records, cached.retrieved_at))
            statuses.append(status)
        self._set_snapshot(payloads, statuses)

    def _set_snapshot(self, payloads: list[ChunkPayload], statuses: list[ChunkStatus]) -> None:
        if not payloads:
            self.snapshot = empty_snapshot(statuses)
            return
        start, end = delivery_window(self.settings)
        self.snapshot = build_snapshot(payloads, statuses, start, end)

    @property
    def planned_chunks(self) -> int:
        return len(self._specs)

    # --------------------------------------------------------------------- run
    async def run(self, force: bool = False) -> bool:
        """Download whatever is missing (or everything when ``force``). Returns False when an
        ingestion is already running."""
        if self._lock.locked():
            return False
        async with self._lock:
            now = datetime.now(UTC)
            st = self.state
            st.running = True
            st.started_at = now
            st.last_attempt_at = now
            st.finished_at = None
            st.total = len(self._specs)
            st.completed = 0
            st.failed = 0
            st.last_error = None
            try:
                results = await asyncio.gather(*(self._load_chunk(s, force) for s in self._specs))
                payloads = [p for p, _ in results if p is not None]
                statuses = [s for _, s in results]
                await asyncio.to_thread(self._set_snapshot, payloads, statuses)
                errors = [s.error for s in statuses if s.error]
                st.last_error = errors[0] if errors else None
                log.info(
                    "ingestion finished",
                    extra={
                        "chunks": len(statuses),
                        "failed": st.failed,
                        "records_actual": self.snapshot.actual_stats.raw_records,
                        "records_forecast": self.snapshot.forecast_stats.raw_records,
                    },
                )
            except Exception as exc:  # defensive: never leave the service stuck in "running"
                log.exception("ingestion crashed")
                st.last_error = f"Ingestion crashed: {type(exc).__name__}: {exc}"
            finally:
                st.running = False
                st.finished_at = datetime.now(UTC)
                self.cache.write_state(
                    {
                        "last_attempt_at": st.last_attempt_at.isoformat() if st.last_attempt_at else None,
                        "last_error": st.last_error,
                    }
                )
        return True

    async def _load_chunk(self, spec: ChunkSpec, force: bool) -> tuple[ChunkPayload | None, ChunkStatus]:
        status = ChunkStatus(spec.dataset, spec.key, spec.window)
        cached = await asyncio.to_thread(self.cache.read, spec.key)
        try:
            if cached is not None and not force:
                status.state = "cached"
                status.retrieved_at = cached.retrieved_at
                status.record_count = cached.record_count
                return ChunkPayload(spec, cached.records, cached.retrieved_at), status

            try:
                result = await self.client.fetch(spec)
            except ElexonError as exc:
                status.error = f"{exc.kind}: {exc.message}"
                if cached is not None:
                    status.state = "cached_stale"
                    status.retrieved_at = cached.retrieved_at
                    status.record_count = cached.record_count
                    return ChunkPayload(spec, cached.records, cached.retrieved_at), status
                status.state = "failed"
                self.state.failed += 1
                return None, status

            await asyncio.to_thread(
                self.cache.write,
                spec.key,
                result.records,
                result.retrieved_at,
                result.url,
                result.http_status,
            )
            status.state = "downloaded"
            status.retrieved_at = result.retrieved_at
            status.record_count = len(result.records)
            status.attempts = result.attempts
            status.duration_ms = result.duration_ms
            return ChunkPayload(spec, result.records, result.retrieved_at), status
        except Exception as exc:  # e.g. disk error
            log.exception("chunk failed unexpectedly", extra={"chunk": spec.key})
            status.state = "failed"
            status.error = f"internal: {type(exc).__name__}: {exc}"
            self.state.failed += 1
            return None, status
        finally:
            self.state.completed += 1

    # ------------------------------------------------------------------ status
    def is_stale(self) -> bool:
        usable = [c for c in self.snapshot.chunks if c.usable and c.retrieved_at]
        if not usable:
            return False
        oldest = min(c.retrieved_at for c in usable if c.retrieved_at)
        too_old = datetime.now(UTC) - oldest > timedelta(hours=self.settings.cache_stale_after_hours)
        return too_old or any(c.state == "cached_stale" for c in usable)

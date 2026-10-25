"""Chunk planning, cache-first ingestion, partial failure and overlap handling."""

import asyncio
import itertools
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.config import Settings
from app.services.cache import DiskCache
from app.services.elexon_client import ElexonClient
from app.services.ingestion import IngestionService
from app.services.planning import plan_chunks

from .fixtures import SyntheticElexon, make_settings


def build(tmp_path: Path, fake: SyntheticElexon, **overrides) -> tuple[IngestionService, ElexonClient, Settings]:  # type: ignore[no-untyped-def]
    s = make_settings(tmp_path, **overrides)
    client = ElexonClient(s, transport=fake.transport())
    return IngestionService(s, DiskCache(s.cache_dir), client), client, s


def test_default_plan_for_january_2026() -> None:
    s = Settings(_env_file=None, cache_dir=Path("/tmp/x"))
    specs = plan_chunks(s)
    fuelhh = [c for c in specs if c.dataset == "FUELHH"]
    windfor = [c for c in specs if c.dataset == "WINDFOR"]
    assert len(fuelhh) == 5  # 7-day windows over 31 days
    assert fuelhh[0].params == {
        "settlementDateFrom": "2026-01-01",
        "settlementDateTo": "2026-01-07",
        "fuelType": "WIND",
    }
    assert fuelhh[-1].params["settlementDateTo"] == "2026-01-31"
    assert len(windfor) == 39  # 8-day lookback + 31 days, 24 h windows
    assert windfor[0].params["publishDateTimeFrom"] == "2025-12-24T00:00:00Z"
    assert windfor[-1].params["publishDateTimeTo"] == "2026-02-01T00:00:00Z"
    assert len({c.key for c in specs}) == len(specs)


def test_plan_windows_are_contiguous() -> None:
    s = Settings(_env_file=None, cache_dir=Path("/tmp/x"))
    wf = [c for c in plan_chunks(s) if c.dataset == "WINDFOR"]
    for prev, nxt in itertools.pairwise(wf):
        assert prev.params["publishDateTimeTo"] == nxt.params["publishDateTimeFrom"]


async def test_full_ingestion_downloads_caches_and_builds_snapshot(tmp_path: Path) -> None:
    fake = SyntheticElexon()
    svc, client, _ = build(tmp_path, fake)
    assert await svc.run() is True
    await client.aclose()

    assert len(fake.calls) == svc.planned_chunks
    assert all(c.state == "downloaded" for c in svc.snapshot.chunks)
    assert len(svc.snapshot.actuals.by_start) == 3 * 48
    assert svc.snapshot.actual_stats.issues.non_wind == 3  # CCGT records ignored
    assert svc.snapshot.forecast_stats.max_publish_time is not None
    assert svc.is_stale() is False
    assert svc.state.running is False and svc.state.last_error is None


async def test_second_start_serves_from_cache_without_network(tmp_path: Path) -> None:
    fake = SyntheticElexon()
    svc, client, s = build(tmp_path, fake)
    await svc.run()
    await client.aclose()

    offline = SyntheticElexon(fail_all=503)
    svc2, client2, _ = build(tmp_path, offline)
    svc2.load_from_cache()
    assert len(svc2.snapshot.actuals.by_start) == 3 * 48  # available immediately
    await svc2.run()  # nothing missing => no requests
    await client2.aclose()
    assert offline.calls == []
    assert all(c.state == "cached" for c in svc2.snapshot.chunks)
    assert s.cache_dir.exists()


async def test_overlapping_windows_are_not_double_counted(tmp_path: Path) -> None:
    fake = SyntheticElexon()  # inclusive upper bound => 00:00 run appears in two adjacent requests
    svc, client, _ = build(tmp_path, fake)
    await svc.run()
    await client.aclose()
    assert svc.snapshot.forecast_stats.overlap_duplicates > 0
    # no source duplicates remain after overlap removal
    assert svc.snapshot.forecasts.duplicate_records_dropped == 0
    assert svc.snapshot.forecasts.conflicting_groups == 0


async def test_total_failure_is_reported_honestly(tmp_path: Path) -> None:
    fake = SyntheticElexon(fail_all=503)
    svc, client, _ = build(tmp_path, fake, elexon_max_retries=0)
    await svc.run()
    await client.aclose()
    assert svc.snapshot.has_data is False
    assert all(c.state == "failed" for c in svc.snapshot.chunks)
    assert svc.state.last_error is not None and "503" in svc.state.last_error
    assert not any(p.name.endswith(".json.gz") for p in (tmp_path / "cache").iterdir())  # nothing cached


async def test_partial_failure_keeps_successful_chunks(tmp_path: Path) -> None:
    fake = SyntheticElexon(fail_windfor_from={"2025-12-30T00:00:00Z"})
    svc, client, _ = build(tmp_path, fake, elexon_max_retries=0)
    await svc.run()
    await client.aclose()
    failed = [c for c in svc.snapshot.chunks if c.state == "failed"]
    assert len(failed) == 1 and failed[0].dataset == "WINDFOR"
    assert len(svc.snapshot.actuals.by_start) == 3 * 48
    assert svc.state.last_error and "503" in svc.state.last_error


async def test_failed_chunks_are_retried_on_next_run_and_good_ones_are_not(tmp_path: Path) -> None:
    flaky = SyntheticElexon(fail_windfor_from={"2025-12-30T00:00:00Z"})
    svc, client, _ = build(tmp_path, flaky, elexon_max_retries=0)
    await svc.run()
    await client.aclose()

    healthy = SyntheticElexon()
    svc2, client2, _ = build(tmp_path, healthy, elexon_max_retries=0)
    svc2.load_from_cache()
    await svc2.run()
    await client2.aclose()
    assert len(healthy.calls) == 1  # only the previously failed window is requested
    assert all(c.usable for c in svc2.snapshot.chunks)


async def test_forced_refresh_failure_keeps_cached_data_and_marks_stale(tmp_path: Path) -> None:
    ok = SyntheticElexon()
    svc, client, _ = build(tmp_path, ok)
    await svc.run()
    await client.aclose()

    down = SyntheticElexon(fail_all=500)
    svc2, client2, _ = build(tmp_path, down, elexon_max_retries=0)
    svc2.load_from_cache()
    await svc2.run(force=True)
    await client2.aclose()
    assert all(c.state == "cached_stale" for c in svc2.snapshot.chunks)
    assert len(svc2.snapshot.actuals.by_start) == 3 * 48  # old data still served
    assert svc2.is_stale() is True
    assert svc2.state.last_error is not None


async def test_concurrent_run_is_rejected(tmp_path: Path) -> None:
    gate = asyncio.Event()

    async def slow(request: httpx.Request) -> httpx.Response:
        await gate.wait()
        return httpx.Response(200, json=[])

    s = make_settings(tmp_path)
    client = ElexonClient(s, transport=httpx.MockTransport(slow))
    svc = IngestionService(s, DiskCache(s.cache_dir), client)
    first = asyncio.create_task(svc.run())
    await asyncio.sleep(0.05)
    assert svc.state.running is True
    assert await svc.run() is False
    gate.set()
    assert await first is True
    await client.aclose()
    # empty-but-successful responses => ready snapshot with zero records, not an error
    assert svc.snapshot.has_data is False
    assert svc.state.last_error is None
    assert all(c.state == "downloaded" and c.record_count == 0 for c in svc.snapshot.chunks)


def test_corrupt_cache_file_is_ignored(tmp_path: Path) -> None:
    s = make_settings(tmp_path)
    cache = DiskCache(s.cache_dir)
    spec = plan_chunks(s)[0]
    cache.write(spec.key, [{"a": 1}], datetime.now(UTC), "u", 200)
    assert cache.read(spec.key) is not None
    (s.cache_dir / f"{spec.key}.json.gz").write_bytes(b"not gzip")
    assert cache.read(spec.key) is None

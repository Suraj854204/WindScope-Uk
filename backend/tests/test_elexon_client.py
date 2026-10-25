"""Elexon client: parameters, retries, backoff, timeouts and failure modes (mock transport)."""

import random
from pathlib import Path

import httpx
import pytest

from app.services.elexon_client import ElexonClient, ElexonError
from app.services.planning import ChunkSpec

from .fixtures import make_settings

FUELHH = ChunkSpec(
    "FUELHH",
    "k",
    {"settlementDateFrom": "2026-01-01", "settlementDateTo": "2026-01-02", "fuelType": "WIND"},
    "w",
)


class Recorder:
    def __init__(self) -> None:
        self.sleeps: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.sleeps.append(seconds)


def make(tmp_path: Path, handler, **overrides):  # type: ignore[no-untyped-def]
    rec = Recorder()
    client = ElexonClient(
        make_settings(tmp_path, **overrides),
        transport=httpx.MockTransport(handler),
        sleep=rec,
        rng=random.Random(1),
    )
    return client, rec


async def test_success_returns_records_and_sends_documented_params(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=[{"a": 1}, {"a": 2}])

    client, _ = make(tmp_path, handler)
    res = await client.fetch(FUELHH)
    await client.aclose()
    assert res.records == [{"a": 1}, {"a": 2}]
    assert res.attempts == 1 and res.http_status == 200
    req = seen[0]
    assert req.url.path.endswith("/datasets/FUELHH/stream")
    assert req.url.params["fuelType"] == "WIND"
    assert req.url.params["settlementDateFrom"] == "2026-01-01"
    assert req.headers["accept"] == "application/json"


async def test_accepts_data_envelope(tmp_path: Path) -> None:
    client, _ = make(tmp_path, lambda r: httpx.Response(200, json={"data": [{"x": 1}]}))
    assert (await client.fetch(FUELHH)).records == [{"x": 1}]
    await client.aclose()


async def test_empty_array_is_a_valid_empty_result(tmp_path: Path) -> None:
    client, _ = make(tmp_path, lambda r: httpx.Response(200, json=[]))
    assert (await client.fetch(FUELHH)).records == []
    await client.aclose()


async def test_retries_503_then_succeeds(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, json=[])

    client, rec = make(tmp_path, handler, elexon_max_retries=4, elexon_backoff_base_s=1.0, elexon_backoff_max_s=30.0)
    res = await client.fetch(FUELHH)
    await client.aclose()
    assert res.attempts == 3
    assert len([s for s in rec.sleeps if s > 0]) == 2  # two backoff sleeps


async def test_429_honours_retry_after(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "7"})
        return httpx.Response(200, json=[])

    client, rec = make(tmp_path, handler, elexon_backoff_base_s=0.1, elexon_backoff_max_s=30.0)
    await client.fetch(FUELHH)
    await client.aclose()
    assert max(rec.sleeps) >= 7.0


async def test_retry_after_is_capped_by_backoff_max(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "9999"}) if calls["n"] == 1 else httpx.Response(200, json=[])

    client, rec = make(tmp_path, handler, elexon_backoff_base_s=0.1, elexon_backoff_max_s=5.0)
    await client.fetch(FUELHH)
    await client.aclose()
    assert max(rec.sleeps) <= 5.0


async def test_4xx_fails_fast_without_retry(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, text="bad parameter")

    client, _ = make(tmp_path, handler, elexon_max_retries=4)
    with pytest.raises(ElexonError) as exc:
        await client.fetch(FUELHH)
    await client.aclose()
    assert exc.value.kind == "http" and exc.value.status_code == 400
    assert "bad parameter" in exc.value.message
    assert calls["n"] == 1


async def test_persistent_5xx_gives_up_after_max_retries(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(500)

    client, _ = make(tmp_path, handler, elexon_max_retries=2)
    with pytest.raises(ElexonError) as exc:
        await client.fetch(FUELHH)
    await client.aclose()
    assert calls["n"] == 3  # 1 try + 2 retries
    assert exc.value.status_code == 500


async def test_timeout_is_retried_then_reported(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.ReadTimeout("slow", request=req)

    client, _ = make(tmp_path, handler, elexon_max_retries=2)
    with pytest.raises(ElexonError) as exc:
        await client.fetch(FUELHH)
    await client.aclose()
    assert exc.value.kind == "timeout"
    assert calls["n"] == 3


async def test_connection_error_is_retried(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("refused", request=req)
        return httpx.Response(200, json=[{"ok": True}])

    client, _ = make(tmp_path, handler)
    assert (await client.fetch(FUELHH)).attempts == 2
    await client.aclose()


async def test_truncated_json_is_retried_then_bad_response(tmp_path: Path) -> None:
    client, _ = make(tmp_path, lambda r: httpx.Response(200, content=b'[{"a": 1}, {"a"'), elexon_max_retries=1)
    with pytest.raises(ElexonError) as exc:
        await client.fetch(FUELHH)
    await client.aclose()
    assert exc.value.kind == "bad_response"


async def test_unexpected_json_shape_is_rejected(tmp_path: Path) -> None:
    client, _ = make(tmp_path, lambda r: httpx.Response(200, json={"message": "hello"}), elexon_max_retries=0)
    with pytest.raises(ElexonError) as exc:
        await client.fetch(FUELHH)
    await client.aclose()
    assert exc.value.kind == "bad_response"


async def test_oversized_response_is_rejected_without_retry(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, content=b"[" + b"1," * 5000 + b"1]")

    client, _ = make(tmp_path, handler, elexon_max_response_bytes=100)
    with pytest.raises(ElexonError) as exc:
        await client.fetch(FUELHH)
    await client.aclose()
    assert exc.value.kind == "too_large"
    assert calls["n"] == 1

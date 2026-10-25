"""End-to-end API tests: real ingestion -> cache -> analysis pipeline against the synthetic
Elexon transport (TEST FIXTURES ONLY, see tests/fixtures.py)."""

import csv
import io
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.domain.timeutils import expected_interval_starts
from app.main import create_app

from .fixtures import OFFSETS, SyntheticElexon, actual_mw, make_settings


def wait_until_settled(client: TestClient, timeout: float = 20.0) -> dict:  # type: ignore[type-arg]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get("/api/v1/dataset/status").json()
        if not body["ingestion_running"] and body["progress_total"] > 0:
            return body  # type: ignore[no-any-return]
        time.sleep(0.02)
    raise AssertionError("ingestion did not finish")


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    fake = SyntheticElexon()
    app = create_app(make_settings(tmp_path), transport=fake.transport())
    with TestClient(app) as c:
        wait_until_settled(c)
        yield c


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert client.get("/api/v1/health").status_code == 200


def test_config_exposes_documented_default_cutoff(client: TestClient) -> None:
    body = client.get("/api/v1/config").json()
    assert body["default_cutoff"]["cutoff_time"] == "09:00"
    assert body["default_cutoff"]["days_before"] == 1
    assert body["default_cutoff"]["is_default"] is True
    assert "ASSUMPTION" in body["default_cutoff"]["disclosure"]


def test_dataset_status_ready(client: TestClient) -> None:
    body = client.get("/api/v1/dataset/status").json()
    assert body["state"] == "ready"
    assert body["chunks_failed"] == 0
    assert body["retrieved_at_latest"] is not None
    assert body["source_max_publish_time_forecast"] is not None  # source time, distinct from retrieval


def test_summary_matches_hand_computed_metrics(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/summary").json()
    m = body["metrics"]
    # default cutoff 09:00 D-1 -> the 06:00 run (+100 MW) is always selected
    assert m["n"] == 144
    assert m["mae_mw"] == pytest.approx(100.0)
    assert m["rmse_mw"] == pytest.approx(100.0)
    assert m["bias_mw"] == pytest.approx(100.0)
    starts = expected_interval_starts(datetime(2026, 1, 1).date(), datetime(2026, 1, 3).date())
    total_actual = sum(actual_mw(s) for s in starts)
    assert m["wape"] == pytest.approx(100.0 * 144 / total_actual)
    assert m["wape_status"] == "ok"
    cov = body["coverage"]
    assert cov["expected_intervals"] == 144 and cov["matched"] == 144 and cov["coverage_ratio"] == 1.0
    assert body["exclusion_counts"] == {}
    assert len(body["daily"]) == 3 and all(d["n_matched"] == 48 for d in body["daily"])
    assert sum(b["count"] for b in body["histogram"]["bins"]) == 144
    assert body["cutoff"]["is_default"] is True
    assert any(w["code"] == "cutoff_assumption" for w in body["warnings"])


def test_later_cutoff_selects_later_vintage(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/summary", params={"cutoff_time": "13:00"}).json()
    assert body["metrics"]["bias_mw"] == pytest.approx(150.0)  # 12:00 run
    assert body["cutoff"]["is_default"] is False
    body = client.get("/api/v1/analysis/summary", params={"cutoff_time": "05:59"}).json()
    assert body["metrics"]["bias_mw"] == pytest.approx(50.0)  # 00:00 run (06:00 not yet published)
    body = client.get("/api/v1/analysis/summary", params={"cutoff_time": "06:00"}).json()
    assert body["metrics"]["bias_mw"] == pytest.approx(100.0)  # 06:00 run, inclusive boundary


def test_lead_time_cutoff(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/summary", params={"cutoff_mode": "lead_time", "lead_hours": 24}).json()
    assert body["cutoff"]["mode"] == "lead_time"
    assert body["metrics"]["n"] == 144
    # hand-derivable: cutoff = start - 24 h, selected run = latest 6-hourly run at/before it
    starts = expected_interval_starts(datetime(2026, 1, 1).date(), datetime(2026, 1, 3).date())
    expected = [OFFSETS[(s - timedelta(hours=24)).hour // 6 * 6] for s in starts]
    assert body["metrics"]["bias_mw"] == pytest.approx(sum(expected) / len(expected))


def test_date_subrange(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/summary", params={"date_from": "2026-01-02", "date_to": "2026-01-02"}).json()
    assert body["period"]["expected_intervals"] == 48
    assert body["metrics"]["n"] == 48


@pytest.mark.parametrize(
    "params",
    [
        {"cutoff_time": "25:00"},
        {"cutoff_time": "9am"},
        {"days_before": 99},
        {"lead_hours": -1},
        {"date_from": "2025-12-31"},
        {"date_to": "2026-02-01"},
        {"date_from": "2026-01-03", "date_to": "2026-01-01"},
        {"date_from": "garbage"},
        {"cutoff_mode": "whenever"},
    ],
)
def test_invalid_parameters_return_422_with_error_envelope(client: TestClient, params: dict[str, str]) -> None:
    r = client.get("/api/v1/analysis/summary", params=params)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] and err["message"]


def test_series_has_one_point_per_expected_interval(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/series").json()
    assert len(body["points"]) == 144
    p = body["points"][0]
    assert p["start_time"] == "2026-01-01T00:00:00Z"
    assert p["actual_mw"] == actual_mw(datetime(2026, 1, 1, tzinfo=UTC))
    assert p["forecast_mw"] == p["actual_mw"] + 100
    assert p["signed_error_mw"] == pytest.approx(100.0)


def test_intervals_pagination_sorting_filtering(client: TestClient) -> None:
    page = client.get("/api/v1/analysis/intervals", params={"page_size": 20}).json()
    assert page["total"] == 144 and page["total_pages"] == 8 and len(page["items"]) == 20
    assert page["items"][0]["start_time_utc"] == "2026-01-01T00:00:00Z"
    assert page["items"][0]["settlement_period"] == 1

    desc = client.get(
        "/api/v1/analysis/intervals", params={"sort_by": "actual_mw", "sort_dir": "desc", "page_size": 5}
    ).json()
    actuals = [i["actual_mw"] for i in desc["items"]]
    assert actuals == sorted(actuals, reverse=True)

    search = client.get("/api/v1/analysis/intervals", params={"q": "2026-01-02 12:30"}).json()
    assert search["total"] == 1 and search["items"][0]["start_time_utc"] == "2026-01-02T12:30:00Z"

    p5 = client.get("/api/v1/analysis/intervals", params={"q": "p5 2026-01-01"}).json()
    assert p5["total"] == 1

    none_over = client.get("/api/v1/analysis/intervals", params={"direction": "under"}).json()
    assert none_over["total"] == 0 and none_over["items"] == []  # no under-forecasts in the fixture
    over = client.get("/api/v1/analysis/intervals", params={"direction": "over"}).json()
    assert over["total"] == 144

    assert client.get("/api/v1/analysis/intervals", params={"status": "bogus"}).status_code == 422
    assert client.get("/api/v1/analysis/intervals", params={"page_size": 5000}).status_code == 422
    clamped = client.get("/api/v1/analysis/intervals", params={"page": 999}).json()
    assert clamped["page"] == clamped["total_pages"]


def test_csv_export_matches_filters_and_never_writes_zero_for_missing(client: TestClient) -> None:
    r = client.get(
        "/api/v1/analysis/intervals.csv",
        params={"date_from": "2026-01-02", "date_to": "2026-01-02", "sort_by": "actual_mw", "sort_dir": "desc"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "windscope_intervals_2026-01-02_2026-01-02.csv" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert len(rows) == 48
    assert rows[0]["status"] == "matched" and rows[0]["exclusion_reasons"] == ""
    assert float(rows[0]["signed_error_mw"]) == pytest.approx(100.0)
    assert "start_time_europe_london" in rows[0]

    filtered = client.get("/api/v1/analysis/intervals.csv", params={"q": "2026-01-01 00:30"}).text
    exported = list(csv.DictReader(io.StringIO(filtered)))
    assert len(exported) == 1 and exported[0]["start_time_utc"] == "2026-01-01T00:30:00Z"


def test_interval_detail_lists_vintages_and_marks_selected(client: TestClient) -> None:
    r = client.get("/api/v1/analysis/intervals/2026-01-02T12:00:00Z")
    assert r.status_code == 200
    body = r.json()
    assert body["interval"]["status"] == "matched"
    assert body["interval"]["cutoff_utc"] == "2026-01-01T09:00:00Z"
    selected = [v for v in body["vintages"] if v["selected"]]
    assert len(selected) == 1 and selected[0]["publish_time"] == "2026-01-01T06:00:00Z"
    assert all(
        v["published_at_or_before_cutoff"] is False
        for v in body["vintages"]
        if v["publish_time"] > "2026-01-01T09:00:00Z"
    )
    assert all(
        v["published_at_or_before_cutoff"] for v in body["vintages"] if v["publish_time"] <= "2026-01-01T09:00:00Z"
    )
    publish_times = [v["publish_time"] for v in body["vintages"]]
    assert publish_times == sorted(publish_times, reverse=True)
    assert body["actual_record_count"] == 1

    assert client.get("/api/v1/analysis/intervals/not-a-time").status_code == 422
    assert client.get("/api/v1/analysis/intervals/2026-01-02T12:15:00Z").status_code == 422
    assert client.get("/api/v1/analysis/intervals/2027-01-02T12:00:00Z").status_code == 404


def test_accuracy_endpoint(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/accuracy", params={"granularity": "week", "top_n": 3}).json()
    assert body["granularity"] == "week"
    assert len(body["buckets"]) == 1 and body["buckets"][0]["partial_bucket"] is True  # Thu-Sat only
    assert body["bias_direction"]["over_share"] == 1.0 and body["bias_direction"]["under_count"] == 0
    assert len(body["high_error_intervals"]) == 3
    assert "descriptive" in body["high_error_note"]
    daily = client.get("/api/v1/analysis/accuracy").json()
    assert len(daily["buckets"]) == 3 and daily["buckets"][0]["partial_bucket"] is False


def test_cutoff_sensitivity(client: TestClient) -> None:
    body = client.get("/api/v1/analysis/cutoff-sensitivity").json()
    by_label = {r["label"]: r for r in body["rows"]}
    assert set(by_label) >= {"06:00", "09:00", "12:00"}
    assert by_label["09:00"]["is_selected"] is True
    assert by_label["09:00"]["bias_mw"] == pytest.approx(100.0)
    assert by_label["12:00"]["bias_mw"] == pytest.approx(150.0)
    assert by_label["09:00"]["common_matched"] > 0


def test_quality_report(client: TestClient) -> None:
    body = client.get("/api/v1/quality").json()
    assert body["actual"]["expected_intervals"] == 144
    assert body["actual"]["intervals_valid"] == 144 and body["actual"]["intervals_missing"] == 0
    assert body["forecast"]["intervals_valid_at_cutoff"] == 144
    assert body["forecast"]["half_hourly_start_share"] == 1.0
    assert body["alignment"]["actual_non_wind_ignored"] == 3
    assert body["alignment"]["overlap_duplicates_forecast"] > 0
    assert body["missing_runs"] == []
    assert {s["dataset"] for s in body["sources"]} == {"FUELHH", "WINDFOR"}
    assert body["sources"][0]["requests_failed"] == 0


def test_refresh_endpoint(client: TestClient) -> None:
    r = client.post("/api/v1/dataset/refresh", json={"force": True})
    assert r.status_code == 200 and r.json()["accepted"] is True
    wait_until_settled(client)
    again = client.post("/api/v1/dataset/refresh", json={})
    assert again.json()["accepted"] is True  # cached: completes quickly
    wait_until_settled(client)
    assert client.get("/api/v1/dataset/status").json()["state"] == "ready"


# ------------------------------------------------------------------ degraded states


def test_total_outage_returns_structured_empty_state_not_a_crash(tmp_path: Path) -> None:
    fake = SyntheticElexon(fail_all=503)
    app = create_app(make_settings(tmp_path, elexon_max_retries=0), transport=fake.transport())
    with TestClient(app) as c:
        status = wait_until_settled(c)
        assert status["state"] == "failed" and "503" in status["last_error"]

        s = c.get("/api/v1/analysis/summary")
        assert s.status_code == 200
        body = s.json()
        m = body["metrics"]
        assert m["n"] == 0 and m["mae_mw"] is None and m["rmse_mw"] is None and m["bias_mw"] is None
        assert m["wape"] is None and m["wape_status"] == "no_data"
        assert body["coverage"]["matched"] == 0 and body["coverage"]["coverage_ratio"] == 0.0
        assert body["histogram"]["bins"] == []
        assert any(w["code"] == "data_failed" and w["severity"] == "error" for w in body["warnings"])
        assert body["exclusion_counts"]["missing_actual"] == 144

        pts = c.get("/api/v1/analysis/series").json()["points"]
        assert len(pts) == 144 and all(p["actual_mw"] is None and p["forecast_mw"] is None for p in pts)
        assert all(p["status"] == "excluded" for p in pts)

        assert c.get("/api/v1/analysis/intervals.csv").status_code == 200
        assert c.get("/api/v1/quality").status_code == 200
        assert c.get("/api/v1/analysis/accuracy").json()["high_error_intervals"] == []
        assert c.get("/api/v1/analysis/cutoff-sensitivity").status_code == 200


def test_partial_data_reduces_coverage_and_is_flagged(tmp_path: Path) -> None:
    # one 24 h window of forecast publications is unavailable
    fake = SyntheticElexon(fail_windfor_from={"2025-12-31T00:00:00Z"})
    app = create_app(make_settings(tmp_path, elexon_max_retries=0), transport=fake.transport())
    with TestClient(app) as c:
        status = wait_until_settled(c)
        assert status["state"] == "partial" and status["chunks_failed"] == 1
        body = c.get("/api/v1/analysis/summary").json()
        # Jan 1 intervals need the 06:00 run published on 31 Dec, which was never retrieved. The
        # 00:00 run on 31 Dec is the boundary record that also appears in the neighbouring request,
        # so only older runs (Dec 30) remain -> they are selected instead; nothing is invented.
        assert any(w["code"] == "data_partial" for w in body["warnings"])
        q = c.get("/api/v1/quality").json()
        assert q["sources"][1]["requests_failed"] == 1
        failed = [ch for ch in q["sources"][1]["chunks"] if ch["state"] == "failed"]
        assert failed and "503" in failed[0]["error"]
        assert body["data"]["state"] == "partial"


def test_interval_excluded_when_all_forecasts_published_after_cutoff(tmp_path: Path) -> None:
    fake = SyntheticElexon()
    app = create_app(make_settings(tmp_path), transport=fake.transport())
    with TestClient(app) as c:
        wait_until_settled(c)
        # lead_time=95h: cutoff 95h before delivery; the 72h look-ahead means nothing qualifies
        body = c.get("/api/v1/analysis/summary", params={"cutoff_mode": "lead_time", "lead_hours": 100}).json()
        assert body["metrics"]["n"] == 0
        assert (
            body["exclusion_counts"]["forecast_only_after_cutoff"]
            + body["exclusion_counts"].get("no_forecast_record", 0)
            == 144
        )
        page = c.get(
            "/api/v1/analysis/intervals",
            params={"cutoff_mode": "lead_time", "lead_hours": 100, "status": "forecast_only_after_cutoff"},
        ).json()
        assert page["total"] > 0
        item = page["items"][0]
        assert item["status"] == "excluded" and item["forecast_mw"] is None
        assert "after the cutoff" in item["explanation"]


def test_status_before_any_ingestion_is_empty(tmp_path: Path) -> None:
    fake = SyntheticElexon()
    app = create_app(make_settings(tmp_path, auto_ingest_on_startup=False), transport=fake.transport())
    with TestClient(app) as c:
        body = c.get("/api/v1/dataset/status").json()
        assert body["state"] == "empty"
        s = c.get("/api/v1/analysis/summary").json()
        assert s["metrics"]["n"] == 0
        assert any(w["code"] == "data_empty" for w in s["warnings"])
        assert fake.calls == []


def test_stale_cache_is_flagged(tmp_path: Path) -> None:
    fake = SyntheticElexon()
    app = create_app(make_settings(tmp_path), transport=fake.transport())
    with TestClient(app) as c:
        wait_until_settled(c)
    # restart with a zero-hour freshness threshold: cached data is served but flagged stale
    app2 = create_app(
        make_settings(tmp_path, cache_stale_after_hours=0, auto_ingest_on_startup=False),
        transport=SyntheticElexon(fail_all=500).transport(),
    )
    with TestClient(app2) as c2:
        time.sleep(0.01)
        st = c2.get("/api/v1/dataset/status").json()
        assert st["state"] == "ready" and st["stale"] is True
        s = c2.get("/api/v1/analysis/summary").json()
        assert s["metrics"]["n"] == 144
        assert any(w["code"] == "data_stale" for w in s["warnings"])
        assert datetime.fromisoformat(st["retrieved_at_latest"].replace("Z", "+00:00")) < datetime.now(UTC) + timedelta(
            seconds=1
        )


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    r = client.get("/api/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "http_error"

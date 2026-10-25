"""Tolerant parsing of raw API records (TEST FIXTURES ONLY)."""

from datetime import UTC, datetime

from app.domain.parsing import parse_actuals, parse_forecasts, parse_generation


def rec(**kw: object) -> dict[str, object]:
    base: dict[str, object] = {
        "dataset": "FUELHH",
        "publishTime": "2026-01-01T00:35:00Z",
        "startTime": "2026-01-01T00:00:00Z",
        "settlementDate": "2026-01-01",
        "settlementPeriod": 1,
        "fuelType": "WIND",
        "generation": 1234.5,
    }
    base.update(kw)
    return base


def test_only_wind_is_kept_case_insensitively() -> None:
    recs, issues = parse_actuals([rec(), rec(fuelType="wind"), rec(fuelType="CCGT"), rec(fuelType="NUCLEAR")])
    assert len(recs) == 2
    assert issues.non_wind == 2


def test_missing_fuel_type_cannot_be_confirmed_as_wind() -> None:
    raw = rec()
    del raw["fuelType"]
    recs, issues = parse_actuals([raw, rec(fuelType=None), rec(fuelType="")])
    assert recs == []
    assert issues.missing_fuel_type == 3


def test_null_generation_stays_none_never_zero() -> None:
    recs, issues = parse_actuals([rec(generation=None)])
    assert recs[0].generation is None
    assert issues.null_generation == 1


def test_invalid_generation_values() -> None:
    assert parse_generation("abc") == (None, "invalid")
    assert parse_generation(-5) == (None, "invalid")
    assert parse_generation(float("nan")) == (None, "invalid")
    assert parse_generation(float("inf")) == (None, "invalid")
    assert parse_generation(True) == (None, "invalid")
    assert parse_generation([1]) == (None, "invalid")
    assert parse_generation("") == (None, "invalid")
    assert parse_generation("12.5") == (12.5, "ok")
    assert parse_generation(0) == (0.0, "ok")


def test_absent_fields_never_crash_and_are_counted() -> None:
    recs, issues = parse_actuals([{}, "junk", None, 42, {"fuelType": "WIND"}, rec(startTime="bad")])
    assert recs == []
    assert issues.total_raw == 6
    assert issues.malformed == 5  # all but the {} which has no fuelType
    assert issues.missing_fuel_type == 1


def test_misaligned_start_is_dropped_and_counted() -> None:
    recs, issues = parse_actuals([rec(startTime="2026-01-01T00:15:00Z")])
    assert recs == []
    assert issues.misaligned_start == 1


def test_naive_timestamp_assumed_utc_and_flagged() -> None:
    recs, issues = parse_actuals([rec(startTime="2026-01-01T00:00:00")])
    assert recs[0].start_time == datetime(2026, 1, 1, tzinfo=UTC)
    assert issues.naive_timestamps == 1


def test_offset_timestamp_is_normalised_to_utc() -> None:
    recs, _ = parse_actuals(
        [rec(startTime="2026-07-01T01:00:00+01:00", settlementDate="2026-07-01", settlementPeriod=3)]
    )
    assert recs[0].start_time == datetime(2026, 7, 1, 0, 0, tzinfo=UTC)


def test_settlement_mismatch_detected_on_spring_forward_day() -> None:
    ok = rec(startTime="2026-03-29T01:00:00Z", settlementDate="2026-03-29", settlementPeriod=3)
    bad = rec(startTime="2026-03-29T01:00:00Z", settlementDate="2026-03-29", settlementPeriod=5)
    recs, issues = parse_actuals([ok, bad])
    assert len(recs) == 2  # startTime stays authoritative; mismatch is only reported
    assert issues.settlement_mismatch == 1


def test_missing_publish_time_on_actual_is_kept() -> None:
    recs, issues = parse_actuals([rec(publishTime=None)])
    assert recs[0].publish_time is None
    assert issues.missing_publish_time == 1


def test_forecast_without_publish_time_is_dropped_never_assumed_available() -> None:
    raw = [
        {"startTime": "2026-01-02T00:00:00Z", "generation": 10},
        {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T06:00:00Z", "generation": 11},
    ]
    recs, issues = parse_forecasts(raw)
    assert len(recs) == 1
    assert recs[0].generation == 11
    assert issues.missing_publish_time == 1


def test_forecast_resolution_diagnostic_counts_start_minutes() -> None:
    raw = [
        {"startTime": f"2026-01-02T0{h}:{m}:00Z", "publishTime": "2026-01-01T06:00:00Z", "generation": 1}
        for h in range(3)
        for m in ("00", "30")
    ] + [{"startTime": "2026-01-02T05:00:00Z", "publishTime": "2026-01-01T06:00:00Z", "generation": 1}]
    _, issues = parse_forecasts(raw)
    assert issues.start_minute_counts[0] == 4
    assert issues.start_minute_counts[30] == 3

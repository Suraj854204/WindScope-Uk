"""Cutoff selection, matching, deduplication and missing-data rules.

TEST FIXTURES ONLY: all values are synthetic and chosen so results are checkable by hand.
"""

from datetime import UTC, date, datetime

from app.domain.cutoff import CutoffPolicy
from app.domain.parsing import ActualRecord, ForecastRecord
from app.domain.selection import (
    ExclusionReason as R,
)
from app.domain.selection import (
    build_actual_index,
    build_forecast_index,
    build_intervals,
    select_forecast,
)
from app.domain.timeutils import expected_interval_starts


def t(day: int, h: int = 0, m: int = 0, s: int = 0, month: int = 1) -> datetime:
    return datetime(2026, month, day, h, m, s, tzinfo=UTC)


START = t(15, 12, 0)  # delivery interval 2026-01-15 12:00Z
CUTOFF = t(14, 9, 0)  # default policy: 09:00 London on D-1 (GMT in January)


def fc(publish: datetime, value: float | None, start: datetime = START) -> ForecastRecord:
    return ForecastRecord(start, publish, value)


def ac(value: float | None, publish: datetime | None = None, start: datetime = START) -> ActualRecord:
    return ActualRecord(start, publish, value)


def run_one(
    forecasts: list[ForecastRecord],
    actuals: list[ActualRecord],
    policy: CutoffPolicy | None = None,
):
    return build_intervals(
        [START], build_actual_index(actuals), build_forecast_index(forecasts), policy or CutoffPolicy()
    )[0]


# --------------------------------------------------------------------- cutoff selection


def test_default_cutoff_for_interval_is_0900_previous_day() -> None:
    assert CutoffPolicy().cutoff_for(START) == CUTOFF


def test_selects_latest_forecast_at_or_before_cutoff() -> None:
    r = run_one(
        [fc(t(13, 21), 100), fc(t(14, 3), 150), fc(t(14, 8, 59, 59), 175), fc(t(14, 15), 400)],
        [ac(180)],
    )
    assert r.forecast == 175
    assert r.forecast_publish_time == t(14, 8, 59, 59)
    assert r.included
    assert r.signed_error == -5  # forecast minus actual
    assert r.abs_error == 5


def test_cutoff_is_inclusive() -> None:
    r = run_one([fc(t(13, 21), 100), fc(CUTOFF, 200)], [ac(180)])
    assert r.forecast == 200
    assert r.forecast_publish_time == CUTOFF


def test_forecast_one_second_after_cutoff_is_never_used() -> None:
    r = run_one([fc(t(13, 21), 100), fc(t(14, 9, 0, 1), 999)], [ac(180)])
    assert r.forecast == 100  # the 999 forecast was not available at the cutoff


def test_only_forecasts_after_cutoff_excludes_interval_with_specific_reason() -> None:
    r = run_one([fc(t(14, 9, 0, 1), 999), fc(t(14, 20), 500)], [ac(180)])
    assert r.forecast is None
    assert r.reasons == (R.FORECAST_ONLY_AFTER_CUTOFF,)
    assert not r.included
    assert r.signed_error is None


def test_no_forecast_record_at_all() -> None:
    r = run_one([], [ac(180)])
    assert r.reasons == (R.NO_FORECAST_RECORD,)
    assert r.actual == 180  # the actual is still shown, just not matched


def test_latest_vintage_with_null_value_is_excluded_not_replaced_by_older_vintage() -> None:
    r = run_one([fc(t(14, 3), 150), fc(t(14, 8), None)], [ac(180)])
    assert r.forecast is None
    assert r.reasons == (R.INVALID_FORECAST,)
    assert r.forecast_publish_time == t(14, 8)  # we report which vintage was selected


def test_changing_cutoff_changes_selected_vintage() -> None:
    fcs = [fc(t(14, 3), 150), fc(t(14, 11), 170)]
    early = run_one(fcs, [ac(180)], CutoffPolicy())
    late = run_one(fcs, [ac(180)], CutoffPolicy(local_time=datetime(2026, 1, 1, 12, 0).time()))
    assert early.forecast == 150
    assert late.forecast == 170


def test_lead_time_policy_selection() -> None:
    fcs = [fc(t(14, 11, 59), 150), fc(t(14, 12, 30), 170)]  # lead 24h => cutoff 14 Jan 12:00
    r = run_one(fcs, [ac(180)], CutoffPolicy(mode="lead_time", lead_hours=24))
    assert r.forecast == 150


def test_select_forecast_helper_handles_missing_series() -> None:
    sel = select_forecast(None, CUTOFF)
    assert sel.entry is None
    assert sel.reason == R.NO_FORECAST_RECORD


# ---------------------------------------------------------------------- missing data


def test_missing_actual_is_flagged_not_zero() -> None:
    r = run_one([fc(t(14, 3), 150)], [])
    assert r.actual is None
    assert r.reasons == (R.MISSING_ACTUAL,)
    assert r.signed_error is None


def test_null_actual_is_invalid_not_zero() -> None:
    r = run_one([fc(t(14, 3), 150)], [ac(None, t(15, 12, 40))])
    assert r.actual is None
    assert r.reasons == (R.INVALID_ACTUAL,)


def test_both_missing_reports_both_reasons() -> None:
    r = run_one([], [])
    assert r.reasons == (R.MISSING_ACTUAL, R.NO_FORECAST_RECORD)


def test_zero_actual_is_a_legitimate_value() -> None:
    r = run_one([fc(t(14, 3), 40)], [ac(0.0, t(15, 12, 40))])
    assert r.included
    assert r.actual == 0.0
    assert r.signed_error == 40


# ------------------------------------------------------------------------ duplicates


def test_actual_latest_publish_time_wins() -> None:
    idx = build_actual_index([ac(100, t(15, 12, 40)), ac(110, t(15, 14, 0)), ac(90, t(15, 13, 0))])
    res = idx.by_start[START]
    assert res.value == 110
    assert not res.ambiguous
    assert idx.duplicate_groups == 1
    assert idx.duplicate_records_dropped == 2


def test_actual_missing_publish_time_ranks_lowest() -> None:
    idx = build_actual_index([ac(50, None), ac(60, t(15, 13))])
    assert idx.by_start[START].value == 60


def test_actual_identical_duplicates_collapse() -> None:
    idx = build_actual_index([ac(100, t(15, 13)), ac(100, t(15, 13))])
    assert idx.by_start[START].value == 100
    assert idx.conflicting_groups == 0
    assert idx.duplicate_records_dropped == 1


def test_actual_conflicting_duplicates_are_ambiguous_and_excluded() -> None:
    fcs = [fc(t(14, 3), 150)]
    acts = [ac(100, t(15, 13)), ac(120, t(15, 13))]
    r = run_one(fcs, acts)
    assert r.reasons == (R.AMBIGUOUS_ACTUAL,)
    assert r.actual is None
    assert build_actual_index(acts).conflicting_groups == 1


def test_forecast_identical_duplicates_collapse() -> None:
    idx = build_forecast_index([fc(t(14, 3), 150), fc(t(14, 3), 150)])
    assert idx.duplicate_records_dropped == 1
    assert idx.conflicting_groups == 0
    assert select_forecast(idx.by_start[START], CUTOFF).entry.value == 150  # type: ignore[union-attr]


def test_forecast_conflicting_duplicates_at_selected_vintage_are_ambiguous() -> None:
    r = run_one([fc(t(14, 3), 150), fc(t(14, 3), 160)], [ac(180)])
    assert r.reasons == (R.AMBIGUOUS_FORECAST,)
    assert r.forecast is None


def test_conflicting_duplicates_at_an_unselected_vintage_do_not_matter() -> None:
    r = run_one([fc(t(14, 3), 150), fc(t(14, 20), 1), fc(t(14, 20), 2)], [ac(180)])
    assert r.included
    assert r.forecast == 150


# ------------------------------------------------------------------- UTC matching + DST


def test_matching_is_on_utc_instant_not_wall_clock() -> None:
    from app.domain.timeutils import parse_timestamp

    summer_local, _ = parse_timestamp("2026-07-15T13:00:00+01:00")
    assert summer_local == datetime(2026, 7, 15, 12, 0, tzinfo=UTC)


def test_spring_forward_day_matches_46_intervals() -> None:
    d = date(2026, 3, 29)
    starts = expected_interval_starts(d, d)
    pub = datetime(2026, 3, 28, 6, 0, tzinfo=UTC)
    acts = [ActualRecord(s, None, 1000.0 + i) for i, s in enumerate(starts)]
    fcs = [ForecastRecord(s, pub, 1010.0 + i) for i, s in enumerate(starts)]
    res = build_intervals(starts, build_actual_index(acts), build_forecast_index(fcs), CutoffPolicy())
    assert len(res) == 46
    assert all(r.included for r in res)
    assert {r.signed_error for r in res} == {10.0}


def test_autumn_back_day_keeps_the_two_01_30_intervals_distinct() -> None:
    d = date(2026, 10, 25)
    starts = expected_interval_starts(d, d)
    assert len(starts) == 50
    pub = datetime(2026, 10, 24, 6, 0, tzinfo=UTC)  # before 08:00Z cutoff (09:00 BST)
    bst_0130 = datetime(2026, 10, 25, 0, 30, tzinfo=UTC)
    gmt_0130 = datetime(2026, 10, 25, 1, 30, tzinfo=UTC)
    acts = [ActualRecord(s, None, 100.0 if s == bst_0130 else 200.0) for s in starts]
    fcs = [ForecastRecord(s, pub, 110.0 if s == bst_0130 else 230.0) for s in starts]
    res = {
        r.start_time: r
        for r in build_intervals(starts, build_actual_index(acts), build_forecast_index(fcs), CutoffPolicy())
    }
    assert res[bst_0130].signed_error == 10.0
    assert res[gmt_0130].signed_error == 30.0
    assert all(r.included for r in res.values())


def test_forecast_published_across_dst_boundary_respects_utc_cutoff() -> None:
    # Delivery 30 Mar 2026 12:00Z (BST). D-1 09:00 BST = 08:00Z on 29 Mar.
    start = datetime(2026, 3, 30, 12, 0, tzinfo=UTC)
    ok = ForecastRecord(start, datetime(2026, 3, 29, 7, 59, tzinfo=UTC), 1.0)
    late = ForecastRecord(start, datetime(2026, 3, 29, 8, 1, tzinfo=UTC), 2.0)  # after 09:00 BST
    res = build_intervals(
        [start], build_actual_index([ActualRecord(start, None, 5.0)]), build_forecast_index([ok, late]), CutoffPolicy()
    )[0]
    assert res.cutoff == datetime(2026, 3, 29, 8, 0, tzinfo=UTC)
    assert res.forecast == 1.0


def test_hourly_forecast_product_marks_half_hours_as_resolution_gap() -> None:
    """Live WINDFOR has start times on the hour only; :30 intervals are excluded with their own reason."""
    from datetime import UTC, datetime, timedelta

    from app.domain.cutoff import CutoffPolicy
    from app.domain.parsing import ForecastRecord
    from app.domain.selection import ExclusionReason, build_actual_index, build_forecast_index, build_intervals

    t0 = datetime(2026, 1, 2, 0, 0, tzinfo=UTC)
    starts = [t0, t0 + timedelta(minutes=30)]
    fc = build_forecast_index([ForecastRecord(t0, datetime(2026, 1, 1, 6, 0, tzinfo=UTC), 1000.0)])
    res = build_intervals(starts, build_actual_index([]), fc, CutoffPolicy())
    assert fc.hourly_resolution
    assert ExclusionReason.FORECAST_HOURLY_RESOLUTION in res[1].reasons
    assert ExclusionReason.NO_FORECAST_RECORD not in res[1].reasons
    assert res[1].forecast is None  # never interpolated

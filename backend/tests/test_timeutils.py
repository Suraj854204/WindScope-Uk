"""TEST FIXTURES ONLY: timestamps below are synthetic and never used by the running app."""

from datetime import UTC, date, datetime, time

from app.domain.cutoff import CutoffPolicy
from app.domain.timeutils import (
    day_ahead_cutoff,
    expected_interval_starts,
    iso_z,
    london_midnight_utc,
    parse_timestamp,
    settlement_date_and_period,
)


def utc(y: int, mo: int, d: int, h: int = 0, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def test_normal_winter_day_has_48_intervals() -> None:
    assert len(expected_interval_starts(date(2026, 1, 15), date(2026, 1, 15))) == 48


def test_january_2026_has_1488_intervals_and_utc_equals_london() -> None:
    starts = expected_interval_starts(date(2026, 1, 1), date(2026, 1, 31))
    assert len(starts) == 31 * 48 == 1488
    assert starts[0] == utc(2026, 1, 1)
    assert starts[-1] == utc(2026, 1, 31, 23, 30)


def test_spring_forward_day_has_46_intervals() -> None:
    starts = expected_interval_starts(date(2026, 3, 29), date(2026, 3, 29))
    assert len(starts) == 46
    assert starts[0] == utc(2026, 3, 29, 0, 0)
    assert starts[-1] == utc(2026, 3, 29, 22, 30)  # 23:30 BST


def test_autumn_back_day_has_50_intervals() -> None:
    starts = expected_interval_starts(date(2026, 10, 25), date(2026, 10, 25))
    assert len(starts) == 50
    assert starts[0] == utc(2026, 10, 24, 23, 0)  # 00:00 BST
    assert starts[-1] == utc(2026, 10, 25, 23, 30)  # 23:30 GMT


def test_settlement_periods_across_spring_forward() -> None:
    assert settlement_date_and_period(utc(2026, 3, 29, 0, 0)) == (date(2026, 3, 29), 1)
    assert settlement_date_and_period(utc(2026, 3, 29, 0, 30)) == (date(2026, 3, 29), 2)
    # 01:00Z is 02:00 BST: local 01:00-02:00 never exists, so this is period 3
    assert settlement_date_and_period(utc(2026, 3, 29, 1, 0)) == (date(2026, 3, 29), 3)
    assert settlement_date_and_period(utc(2026, 3, 29, 22, 30)) == (date(2026, 3, 29), 46)


def test_settlement_periods_across_autumn_back() -> None:
    assert settlement_date_and_period(utc(2026, 10, 24, 23, 0)) == (date(2026, 10, 25), 1)
    # 00:30Z = 01:30 BST (first 01:30), 01:30Z = 01:30 GMT (second 01:30): distinct periods
    assert settlement_date_and_period(utc(2026, 10, 25, 0, 30)) == (date(2026, 10, 25), 4)
    assert settlement_date_and_period(utc(2026, 10, 25, 1, 30)) == (date(2026, 10, 25), 6)
    assert settlement_date_and_period(utc(2026, 10, 25, 23, 30)) == (date(2026, 10, 25), 50)


def test_london_midnight_offsets() -> None:
    assert london_midnight_utc(date(2026, 1, 10)) == utc(2026, 1, 10)
    assert london_midnight_utc(date(2026, 7, 10)) == utc(2026, 7, 9, 23)  # BST = UTC+1


def test_day_ahead_cutoff_winter_and_summer() -> None:
    assert day_ahead_cutoff(date(2026, 1, 15), 1, time(9, 0)) == utc(2026, 1, 14, 9)
    assert day_ahead_cutoff(date(2026, 7, 15), 1, time(9, 0)) == utc(2026, 7, 14, 8)


def test_day_ahead_cutoff_around_dst_changes() -> None:
    # delivery 30 Mar (BST); D-1 = 29 Mar 09:00 BST = 08:00Z
    assert day_ahead_cutoff(date(2026, 3, 30), 1, time(9, 0)) == utc(2026, 3, 29, 8)
    # delivery 29 Mar; D-1 = 28 Mar 09:00 GMT
    assert day_ahead_cutoff(date(2026, 3, 29), 1, time(9, 0)) == utc(2026, 3, 28, 9)
    # delivery 26 Oct (GMT); D-1 = 25 Oct 09:00 GMT
    assert day_ahead_cutoff(date(2026, 10, 26), 1, time(9, 0)) == utc(2026, 10, 25, 9)
    # delivery 25 Oct; D-1 = 24 Oct 09:00 BST
    assert day_ahead_cutoff(date(2026, 10, 25), 1, time(9, 0)) == utc(2026, 10, 24, 8)


def test_ambiguous_and_nonexistent_local_times_do_not_raise() -> None:
    # 01:30 on 25 Oct occurs twice: first occurrence (BST) is used
    assert day_ahead_cutoff(date(2026, 10, 26), 1, time(1, 30)) == utc(2026, 10, 25, 0, 30)
    # 01:30 on 29 Mar does not exist: pre-transition (GMT) offset is used
    assert day_ahead_cutoff(date(2026, 3, 30), 1, time(1, 30)) == utc(2026, 3, 29, 1, 30)


def test_all_intervals_of_a_london_day_share_one_cutoff_even_on_dst_day() -> None:
    policy = CutoffPolicy()
    for d in (date(2026, 3, 29), date(2026, 10, 25), date(2026, 1, 15)):
        cutoffs = {policy.cutoff_for(s) for s in expected_interval_starts(d, d)}
        assert len(cutoffs) == 1


def test_lead_time_policy() -> None:
    policy = CutoffPolicy(mode="lead_time", lead_hours=24)
    assert policy.cutoff_for(utc(2026, 1, 15, 12, 30)) == utc(2026, 1, 14, 12, 30)


def test_parse_timestamp_variants() -> None:
    assert parse_timestamp("2026-01-01T00:00:00Z") == (utc(2026, 1, 1), False)
    assert parse_timestamp("2026-07-01T01:00:00+01:00") == (utc(2026, 7, 1, 0), False)
    assert parse_timestamp("2026-01-01T00:00:00") == (utc(2026, 1, 1), True)  # naive -> UTC, flagged
    assert parse_timestamp("2026-01-01T00:00:00.000Z")[0] == utc(2026, 1, 1)
    assert parse_timestamp("not a date") == (None, False)
    assert parse_timestamp(None) == (None, False)
    assert parse_timestamp(12345) == (None, False)
    assert parse_timestamp("") == (None, False)


def test_iso_z() -> None:
    assert iso_z(utc(2026, 1, 1, 9, 5)) == "2026-01-01T09:05:00Z"

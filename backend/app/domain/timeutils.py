"""Timestamp normalisation and Europe/London <-> UTC helpers.

Every instant used for matching is a timezone-aware UTC datetime. Europe/London
local dates are only used to (a) define delivery days / settlement dates and
(b) compute the day-ahead decision cutoff, so daylight-saving transitions are
handled by the IANA tz database (zoneinfo), never by fixed offsets.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
HALF_HOUR = timedelta(minutes=30)


def parse_timestamp(value: object) -> tuple[datetime | None, bool]:
    """Parse an ISO-8601 string into UTC.

    Returns ``(utc_datetime_or_None, was_naive)``. A timestamp without an offset is
    assumed to be UTC (Elexon returns ``Z``-suffixed values) and flagged via ``was_naive``.
    """
    if not isinstance(value, str) or not value.strip():
        return None, False
    text = value.strip()
    if text[-1] in ("Z", "z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None, False
    naive = dt.tzinfo is None
    if naive:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC), naive


def london_midnight_utc(d: date) -> datetime:
    """UTC instant of 00:00 Europe/London on the given local date."""
    return datetime.combine(d, time.min, tzinfo=LONDON).astimezone(UTC)


def london_date(dt_utc: datetime) -> date:
    return dt_utc.astimezone(LONDON).date()


def to_london(dt_utc: datetime) -> datetime:
    return dt_utc.astimezone(LONDON)


def is_half_hour_aligned(dt: datetime) -> bool:
    return dt.minute in (0, 30) and dt.second == 0 and dt.microsecond == 0


def expected_interval_starts(d_from: date, d_to: date) -> list[datetime]:
    """All half-hourly delivery-interval starts (UTC) covering London dates d_from..d_to.

    A normal day has 48 intervals; the spring-forward day has 46 and the
    autumn-back day has 50.
    """
    start = london_midnight_utc(d_from)
    end = london_midnight_utc(d_to + timedelta(days=1))
    out: list[datetime] = []
    cur = start
    while cur < end:
        out.append(cur)
        cur += HALF_HOUR
    return out


def settlement_date_and_period(start_utc: datetime) -> tuple[date, int]:
    """Settlement date and 1-based settlement period implied by a half-hour start."""
    d = london_date(start_utc)
    idx = int((start_utc - london_midnight_utc(d)) / HALF_HOUR)
    return d, idx + 1


def day_ahead_cutoff(delivery_date: date, days_before: int, local_time: time) -> datetime:
    """UTC instant of ``local_time`` Europe/London on ``delivery_date - days_before``.

    Ambiguous local times (clocks going back) resolve to the first occurrence; local times
    skipped by the spring-forward gap use the pre-transition offset (zoneinfo fold=0 rules).
    """
    local_date = delivery_date - timedelta(days=days_before)
    return datetime.combine(local_date, local_time, tzinfo=LONDON).astimezone(UTC)


def iso_z(dt: datetime) -> str:
    """Format a UTC datetime as ``YYYY-MM-DDTHH:MM:SSZ``."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

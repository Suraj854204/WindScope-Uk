"""Filtering, sorting and CSV export of interval rows."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Literal

from app.domain.selection import IntervalResult
from app.domain.timeutils import iso_z, settlement_date_and_period, to_london

SortKey = Literal["start_time", "actual_mw", "forecast_mw", "signed_error_mw", "abs_error_mw", "forecast_publish_time"]
Direction = Literal["all", "over", "under", "exact"]


@dataclass(frozen=True, slots=True)
class IntervalQuery:
    q: str = ""
    status: str = "all"  # all | matched | excluded | <exclusion reason value>
    direction: Direction = "all"
    sort_by: SortKey = "start_time"
    sort_desc: bool = False


def _haystack(i: IntervalResult) -> str:
    s_date, period = settlement_date_and_period(i.start_time)
    return " ".join(
        (
            iso_z(i.start_time).lower(),
            to_london(i.start_time).strftime("%Y-%m-%d %H:%M").lower(),
            s_date.isoformat(),
            f"p{period}",
            str(period),
        )
    )


def _sort_value(i: IntervalResult, key: SortKey) -> float | None:
    if key == "start_time":
        return i.start_time.timestamp()
    if key == "actual_mw":
        return i.actual
    if key == "forecast_mw":
        return i.forecast
    if key == "signed_error_mw":
        return i.signed_error
    if key == "abs_error_mw":
        return i.abs_error
    return i.forecast_publish_time.timestamp() if i.forecast_publish_time else None


def apply_query(intervals: Sequence[IntervalResult], query: IntervalQuery) -> list[IntervalResult]:
    out = list(intervals)

    if query.status == "matched":
        out = [i for i in out if i.included]
    elif query.status == "excluded":
        out = [i for i in out if not i.included]
    elif query.status != "all":
        out = [i for i in out if any(r.value == query.status for r in i.reasons)]

    if query.direction != "all":

        def keep(i: IntervalResult) -> bool:
            e = i.signed_error
            if e is None:
                return False
            return (
                (query.direction == "over" and e > 0)
                or (query.direction == "under" and e < 0)
                or (query.direction == "exact" and e == 0)
            )

        out = [i for i in out if keep(i)]

    tokens = query.q.lower().split()
    if tokens:
        hay = {id(i): _haystack(i) for i in out}
        out = [i for i in out if all(t in hay[id(i)] for t in tokens)]

    present = [(v, i) for i in out if (v := _sort_value(i, query.sort_by)) is not None]
    absent = [i for i in out if _sort_value(i, query.sort_by) is None]
    present.sort(key=lambda p: (p[0], p[1].start_time), reverse=query.sort_desc)
    return [i for _, i in present] + absent  # missing values always last


CSV_COLUMNS = [
    "start_time_utc",
    "start_time_europe_london",
    "settlement_date",
    "settlement_period",
    "actual_mw",
    "forecast_mw",
    "signed_error_mw",
    "abs_error_mw",
    "forecast_publish_time_utc",
    "decision_cutoff_utc",
    "status",
    "exclusion_reasons",
]


def _num(v: float | None) -> str:
    return "" if v is None else f"{v:.3f}".rstrip("0").rstrip(".")


def iter_csv(intervals: Sequence[IntervalResult]) -> Iterator[str]:
    """Yield CSV text. Missing values are EMPTY cells - never 0."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    yield buf.getvalue()
    for i in intervals:
        buf.seek(0)
        buf.truncate()
        s_date, period = settlement_date_and_period(i.start_time)
        writer.writerow(
            [
                iso_z(i.start_time),
                to_london(i.start_time).isoformat(),
                s_date.isoformat(),
                period,
                _num(i.actual),
                _num(i.forecast),
                _num(i.signed_error),
                _num(i.abs_error),
                iso_z(i.forecast_publish_time) if i.forecast_publish_time else "",
                iso_z(i.cutoff),
                "matched" if i.included else "excluded",
                ";".join(r.value for r in i.reasons),
            ]
        )
        yield buf.getvalue()

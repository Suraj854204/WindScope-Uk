"""Forecast-accuracy metrics (all errors are forecast minus actual, in MW).

    error_i  = forecast_i - actual_i
    MAE      = mean(|error_i|)
    RMSE     = sqrt(mean(error_i^2))
    Bias     = mean(error_i)             (positive = over-forecast, negative = under-forecast)
    WAPE     = sum(|error_i|) / sum(actual_i)   -- only when the denominator is valid

No per-interval percentage error is ever computed: actual wind output can be near zero.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

WapeStatus = Literal["ok", "no_data", "denominator_too_small"]


@dataclass(frozen=True, slots=True)
class MetricSet:
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None
    wape: float | None
    wape_status: WapeStatus
    mean_actual: float | None
    sum_actual: float | None
    median_abs_error: float | None
    p95_abs_error: float | None
    max_abs_error: float | None


def percentile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolation percentile (same as numpy's default). ``q`` in [0, 100]."""
    if not sorted_values:
        raise ValueError("percentile of empty sequence")
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q / 100.0
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_values[lo]
    frac = pos - lo
    return sorted_values[lo] * (1 - frac) + sorted_values[hi] * frac


def compute_metrics(pairs: Sequence[tuple[float, float]], wape_min_mean_actual: float) -> MetricSet:
    """``pairs`` are ``(forecast_mw, actual_mw)`` for matched intervals only."""
    n = len(pairs)
    if n == 0:
        return MetricSet(0, None, None, None, None, "no_data", None, None, None, None, None)

    errors = [f - a for f, a in pairs]
    abs_errors = sorted(abs(e) for e in errors)
    sum_actual = math.fsum(a for _, a in pairs)
    mean_actual = sum_actual / n
    sum_abs = math.fsum(abs_errors)

    if mean_actual >= wape_min_mean_actual and sum_actual > 0:
        wape: float | None = sum_abs / sum_actual
        status: WapeStatus = "ok"
    else:
        wape = None
        status = "denominator_too_small"

    return MetricSet(
        n=n,
        mae=sum_abs / n,
        rmse=math.sqrt(math.fsum(e * e for e in errors) / n),
        bias=math.fsum(errors) / n,
        wape=wape,
        wape_status=status,
        mean_actual=mean_actual,
        sum_actual=sum_actual,
        median_abs_error=percentile(abs_errors, 50),
        p95_abs_error=percentile(abs_errors, 95),
        max_abs_error=abs_errors[-1],
    )


_NICE_WIDTHS = (50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 2500.0, 5000.0)


def nice_bin_width(min_err: float, max_err: float, target_bins: int = 24) -> float:
    span = max(max_err - min_err, 1.0)
    for width in _NICE_WIDTHS:
        if span / width <= target_bins:
            return width
    return _NICE_WIDTHS[-1]


@dataclass(frozen=True, slots=True)
class HistogramBin:
    lower: float
    upper: float
    count: int


def error_histogram(errors: Sequence[float], bin_width: float | None = None) -> tuple[float, list[HistogramBin]]:
    """Fixed-width histogram of signed errors; bins are aligned to multiples of the width.

    Empty bins between the extremes are real zero *counts* (not missing generation)."""
    if not errors:
        return (bin_width or 500.0), []
    width = bin_width or nice_bin_width(min(errors), max(errors))
    lo_idx = math.floor(min(errors) / width)
    hi_idx = math.floor(max(errors) / width)
    counts = [0] * (hi_idx - lo_idx + 1)
    for e in errors:
        counts[math.floor(e / width) - lo_idx] += 1
    return width, [HistogramBin((lo_idx + i) * width, (lo_idx + i + 1) * width, c) for i, c in enumerate(counts)]

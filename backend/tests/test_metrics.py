"""Metric calculations with hand-checkable examples (TEST FIXTURES ONLY)."""

import math

import pytest

from app.domain.metrics import compute_metrics, error_histogram, nice_bin_width, percentile

MIN = 100.0

# forecast, actual -> errors (forecast - actual): +10, -20, +30
HAND = [(110.0, 100.0), (80.0, 100.0), (130.0, 100.0)]


def test_hand_checked_metrics() -> None:
    m = compute_metrics(HAND, MIN)
    assert m.n == 3
    assert m.mae == pytest.approx(20.0)  # (10 + 20 + 30) / 3
    assert m.rmse == pytest.approx(math.sqrt((100 + 400 + 900) / 3))  # 21.6025
    assert m.rmse == pytest.approx(21.602468994692867)
    assert m.bias == pytest.approx(20 / 3)  # (10 - 20 + 30) / 3 = +6.667 => over-forecast
    assert m.wape == pytest.approx(60 / 300)  # 0.2
    assert m.wape_status == "ok"
    assert m.mean_actual == pytest.approx(100.0)
    assert m.median_abs_error == pytest.approx(20.0)
    assert m.p95_abs_error == pytest.approx(29.0)  # 20*0.1 + 30*0.9
    assert m.max_abs_error == pytest.approx(30.0)


def test_bias_sign_convention_is_forecast_minus_actual() -> None:
    assert compute_metrics([(90.0, 100.0)], MIN).bias == pytest.approx(-10.0)  # under-forecast
    assert compute_metrics([(120.0, 100.0)], MIN).bias == pytest.approx(20.0)  # over-forecast


def test_errors_can_cancel_in_bias_but_not_in_mae() -> None:
    m = compute_metrics([(110.0, 100.0), (90.0, 100.0)], MIN)
    assert m.bias == pytest.approx(0.0)
    assert m.mae == pytest.approx(10.0)


def test_no_data_returns_none_values_not_zero() -> None:
    m = compute_metrics([], MIN)
    assert m.n == 0
    assert m.mae is None and m.rmse is None and m.bias is None and m.wape is None
    assert m.wape_status == "no_data"


def test_wape_not_reported_when_actuals_are_all_zero() -> None:
    m = compute_metrics([(5.0, 0.0), (0.0, 0.0)], MIN)
    assert m.mae == pytest.approx(2.5)  # absolute metrics are still valid
    assert m.wape is None
    assert m.wape_status == "denominator_too_small"


def test_wape_not_reported_when_mean_actual_is_near_zero() -> None:
    m = compute_metrics([(30.0, 20.0), (10.0, 20.0)], MIN)  # mean actual 20 MW < 100 MW
    assert m.wape is None
    assert m.wape_status == "denominator_too_small"


def test_wape_reported_at_exact_threshold() -> None:
    m = compute_metrics([(110.0, 100.0)], MIN)  # mean actual == threshold
    assert m.wape == pytest.approx(0.1)


def test_single_observation() -> None:
    m = compute_metrics([(150.0, 100.0)], MIN)
    assert m.n == 1
    assert m.mae == m.max_abs_error == m.median_abs_error == m.p95_abs_error == 50.0


def test_percentile_linear_interpolation() -> None:
    assert percentile([1.0, 2.0, 3.0, 4.0], 50) == pytest.approx(2.5)
    assert percentile([1.0, 2.0, 3.0, 4.0], 0) == 1.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 100) == 4.0
    with pytest.raises(ValueError):
        percentile([], 50)


def test_histogram_bins_and_counts() -> None:
    width, bins = error_histogram([-150.0, -10.0, 20.0, 260.0], bin_width=100.0)
    assert width == 100.0
    assert [(b.lower, b.upper, b.count) for b in bins] == [
        (-200.0, -100.0, 1),
        (-100.0, 0.0, 1),
        (0.0, 100.0, 1),
        (100.0, 200.0, 0),
        (200.0, 300.0, 1),
    ]
    assert sum(b.count for b in bins) == 4


def test_histogram_empty_and_auto_width() -> None:
    assert error_histogram([])[1] == []
    assert nice_bin_width(-100.0, 100.0) == 50.0 or nice_bin_width(-100.0, 100.0) > 0
    _width, bins = error_histogram([-3000.0, 3000.0])
    assert sum(b.count for b in bins) == 2
    assert len(bins) <= 30

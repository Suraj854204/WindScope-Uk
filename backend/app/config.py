"""Environment-driven configuration. All variables use the WINDSCOPE_ prefix."""

from __future__ import annotations

import re
from datetime import date
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WINDSCOPE_", env_file=".env", extra="ignore", case_sensitive=False)

    # --- runtime -----------------------------------------------------------------
    app_env: str = "development"
    log_level: str = "INFO"
    log_json: bool = True
    # Comma-separated list of allowed browser origins (exact match, no wildcards).
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    # --- Elexon Insights API -----------------------------------------------------
    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    elexon_timeout_connect_s: float = 10.0
    elexon_timeout_read_s: float = 90.0
    elexon_max_retries: int = 4
    elexon_backoff_base_s: float = 1.0
    elexon_backoff_max_s: float = 30.0
    elexon_max_concurrency: int = 2
    elexon_min_request_interval_s: float = 0.25
    elexon_max_response_bytes: int = 200 * 1024 * 1024

    # --- ingestion windows -------------------------------------------------------
    fuelhh_chunk_days: int = 7
    windfor_chunk_hours: int = 24
    # How many days before the first delivery date to start collecting forecast
    # publications (needed so the earliest intervals have a forecast vintage).
    windfor_lookback_days: int = 8
    auto_ingest_on_startup: bool = True
    # Minimum seconds between *forced* re-downloads (protects the upstream API from abuse).
    refresh_cooldown_s: int = 60

    # --- cache -------------------------------------------------------------------
    cache_dir: Path = Path("./.cache/windscope")
    # Cached data older than this is flagged "stale" in the UI (it is still used).
    cache_stale_after_hours: int = 168

    # --- analysis ----------------------------------------------------------------
    period_start: date = date(2026, 1, 1)
    period_end: date = date(2026, 1, 31)
    # Documented ASSUMPTION: purchase decision made at 09:00 Europe/London on D-1.
    default_cutoff_time: str = "09:00"
    default_days_before: int = 1
    default_lead_hours: float = 24.0
    # WAPE is only reported when mean actual generation over the matched sample is at
    # least this many MW (guards against zero / near-zero denominators).
    wape_min_mean_actual_mw: float = 100.0
    min_sample_warning: int = 48

    @field_validator("default_cutoff_time")
    @classmethod
    def _check_hhmm(cls, v: str) -> str:
        if not _HHMM.match(v):
            raise ValueError("default_cutoff_time must be HH:MM (24h)")
        return v

    @model_validator(mode="after")
    def _check_period(self) -> Settings:
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start")
        if not 0 <= self.default_days_before <= 14:
            raise ValueError("default_days_before must be between 0 and 14")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

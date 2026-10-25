"""Persistent per-request cache on local disk (gzip-compressed JSON, atomic writes).

Justification for a file cache rather than a database: the dataset is a bounded, immutable
historical month fetched in a few dozen idempotent requests, so a directory of compressed
envelopes (mountable as a Docker volume) is simpler, more transparent and fully reproducible.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class CachedChunk:
    key: str
    retrieved_at: datetime
    record_count: int
    records: list[Any]
    url: str | None
    http_status: int | None


class DiskCache:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
        return self.root / f"{safe}.json.gz"

    def read(self, key: str) -> CachedChunk | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                envelope = json.load(fh)
            if envelope.get("schema_version") != SCHEMA_VERSION:
                return None
            meta = envelope["meta"]
            records = envelope["records"]
            if not isinstance(records, list):
                raise ValueError("records is not a list")
            return CachedChunk(
                key=key,
                retrieved_at=datetime.fromisoformat(meta["retrieved_at"]),
                record_count=int(meta["record_count"]),
                records=records,
                url=meta.get("url"),
                http_status=meta.get("http_status"),
            )
        except (OSError, ValueError, KeyError, EOFError) as exc:
            log.warning("discarding unreadable cache file", extra={"path": str(path), "err": str(exc)})
            return None

    def write(
        self,
        key: str,
        records: list[Any],
        retrieved_at: datetime,
        url: str | None,
        http_status: int | None,
    ) -> None:
        envelope = {
            "schema_version": SCHEMA_VERSION,
            "meta": {
                "key": key,
                "retrieved_at": retrieved_at.isoformat(),
                "record_count": len(records),
                "url": url,
                "http_status": http_status,
            },
            "records": records,
        }
        path = self._path(key)
        fd, tmp = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb") as gz:
                gz.write(json.dumps(envelope, separators=(",", ":")).encode("utf-8"))
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def clear(self) -> None:
        for p in self.root.glob("*.json.gz"):
            p.unlink(missing_ok=True)

    # -- small JSON side-file used to remember the last ingestion attempt across restarts
    def read_state(self) -> dict[str, Any]:
        try:
            return dict(json.loads((self.root / "ingestion_state.json").read_text()))
        except (OSError, ValueError):
            return {}

    def write_state(self, state: dict[str, Any]) -> None:
        try:
            (self.root / "ingestion_state.json").write_text(json.dumps(state, default=str))
        except OSError as exc:
            log.warning("could not persist ingestion state", extra={"err": str(exc)})

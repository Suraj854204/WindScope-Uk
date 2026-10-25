"""Verify the live Elexon schema BEFORE trusting the app (run from a machine with internet).

    python scripts/inspect_api.py [--base-url https://data.elexon.co.uk/bmrs/api/v1]

Requests one settlement day of FUELHH (fuelType=WIND) and a 6-hour window of WINDFOR
publications, then prints status, rate-limit headers, record counts, field names, value types and
a sample record. Exits non-zero if the fields WindScope relies on are missing.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from typing import Any

import httpx

EXPECTED = {
    "FUELHH": {"startTime", "publishTime", "fuelType", "generation", "settlementDate", "settlementPeriod"},
    "WINDFOR": {"startTime", "publishTime", "generation"},
}


def probe(client: httpx.Client, base: str, dataset: str, params: dict[str, str]) -> bool:
    url = f"{base.rstrip('/')}/datasets/{dataset}/stream"
    print(f"\n=== {dataset}  GET {url}\n    params: {params}")
    try:
        resp = client.get(url, params=params, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        print(f"    REQUEST FAILED: {type(exc).__name__}: {exc}")
        return False
    print(f"    HTTP {resp.status_code}  content-type={resp.headers.get('content-type')}")
    for h in ("retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "ratelimit-limit", "ratelimit-remaining"):
        if h in resp.headers:
            print(f"    {h}: {resp.headers[h]}")
    if resp.status_code != 200:
        print(f"    body: {resp.text[:300]}")
        return False
    payload: Any = resp.json()
    records = payload if isinstance(payload, list) else payload.get("data", [])
    print(f"    records: {len(records)}")
    if not records:
        print("    (empty response)")
        return False
    keys: Counter[str] = Counter(k for r in records for k in r)
    types = {k: sorted({type(r.get(k)).__name__ for r in records}) for k in keys}
    print(f"    fields: {dict(keys)}")
    print(f"    value types: {types}")
    if dataset == "FUELHH":
        print(f"    fuelType values: {dict(Counter(r.get('fuelType') for r in records))}")
    if dataset == "WINDFOR":
        print(f"    distinct publishTime: {len({r.get('publishTime') for r in records})}")
        print(f"    startTime minute offsets: {dict(Counter(str(r.get('startTime'))[14:16] for r in records))}")
    print(f"    sample: {json.dumps(records[0])}")
    missing = EXPECTED[dataset] - set(keys)
    if missing:
        print(f"    MISSING EXPECTED FIELDS: {sorted(missing)}")
        return False
    print("    OK: all fields WindScope relies on are present")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="https://data.elexon.co.uk/bmrs/api/v1")
    args = ap.parse_args()
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        ok_a = probe(
            client,
            args.base_url,
            "FUELHH",
            {"settlementDateFrom": "2026-01-01", "settlementDateTo": "2026-01-01", "fuelType": "WIND"},
        )
        ok_f = probe(
            client,
            args.base_url,
            "WINDFOR",
            {"publishDateTimeFrom": "2025-12-31T00:00:00Z", "publishDateTimeTo": "2025-12-31T06:00:00Z"},
        )
    return 0 if ok_a and ok_f else 1


if __name__ == "__main__":
    sys.exit(main())

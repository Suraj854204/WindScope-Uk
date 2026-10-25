# WindScope UK

Day-ahead wind forecast accuracy for a UK utility's trading team. For every half-hour of **January 2026** it answers:
*what was the latest wind forecast available at the purchase-decision cutoff, and how far was it from actual national wind generation?*

- **Actuals:** Elexon Insights `FUELHH` (`fuelType=WIND`)
- **Forecasts:** Elexon Insights `WINDFOR`
- Nothing else is used: no demand, price, thermal or third-party data. WindScope measures wind-forecast uncertainty; it does **not** calculate procurement or volumes.

Pages: **Overview**, **Forecast Explorer** (filter / sort / paginate / CSV export), **Accuracy Analysis**, **Data Quality**, **Methodology**.

## The key assumption (please confirm)

The client has not stated an exact decision cutoff. The default is **09:00 Europe/London on the day before delivery (D-1)**, a conservative proxy for a day-ahead process. It is labelled "assumed" in the header and on every page, and can be changed in the header (or switched to a "N hours before interval start" rule). Metrics recompute for the chosen cutoff; the Accuracy page shows how results move across cutoffs.

For each delivery `startTime` the app picks the **latest WINDFOR record with `publishTime` at or before the cutoff**. Later forecasts are never used and there is no fallback to older ones beyond that rule; if none qualifies the interval is excluded with a stated reason. Matching is on normalised UTC, so DST days (46/50 half-hours) are handled. Duplicates are collapsed or, if they conflict, excluded as ambiguous. Metrics (MAE, RMSE, bias = forecast − actual, WAPE only when mean actual ≥ 100 MW) use matched intervals only, and coverage / missing counts are always reported.

## Architecture

```
frontend/  React 18 + TypeScript + Vite + Tailwind + Recharts + TanStack Query
backend/   FastAPI (Python 3.12) + Pydantic + httpx, gzip-JSON disk cache (no database)
docs/      openapi.json (generated API contract), DEPLOYMENT.md
```

Backend layers: `domain/` (pure logic: time, cutoff, selection, metrics) → `services/` (Elexon client with throttling, retries/backoff, size caps; chunked resumable ingestion; cache; analysis) → `routers/`. A disk cache is enough because the data is one month of immutable-ish history; a database would add operational weight without benefit.

Honest states: loading skeletons, empty, partial (some download chunks failed), stale (cache older than 168 h, or refresh failed and cached data served), and error states. Missing values render as "—", never 0. Retrieval time (when this app downloaded) is shown separately from source `publishTime`.

### Directory structure
```
windscope-uk/
├── README.md  .env.example  .gitignore
├── docker-compose.yml          # backend + frontend (nginx), health checks, cache volume
├── render.yaml                 # Render blueprint for the API
├── docs/                       # DEPLOYMENT.md, openapi.json
├── backend/
│   ├── Dockerfile  pyproject.toml  requirements*.txt
│   ├── app/
│   │   ├── main.py config.py deps.py errors.py schemas.py presenters.py logging_config.py
│   │   ├── domain/             # timeutils, cutoff, parsing, selection, metrics (pure logic)
│   │   ├── services/           # elexon_client, planning, cache, dataset_store, ingestion, analysis, intervals_query
│   │   └── routers/            # system.py, analysis.py
│   ├── scripts/                # inspect_api.py (live schema probe), export_openapi.py
│   └── tests/                  # 117 tests + synthetic fixtures (tests only)
└── frontend/
    ├── Dockerfile  nginx.conf.template  vercel.json  .env.example
    ├── package.json  vite.config.ts  tailwind.config.js  tsconfig.json  eslint.config.js
    └── src/
        ├── api/  lib/  state/  test/
        ├── components/ (ui, layout, charts)
        └── pages/              # Overview, Explorer, Accuracy, Quality, Methodology
```

### Data flow
Elexon FUELHH/WINDFOR → throttled, retrying client (chunked requests) → gzip-JSON disk cache → parse/normalise to UTC and de-duplicate → per-interval cutoff selection and matching → metrics → typed REST API (`/api/v1/...`) → React UI (react-query). Retrieval time is recorded separately from source `publishTime`.

## Run locally

Backend (Python 3.12 or newer is required; 3.11 is not supported), Linux/macOS:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000        # downloads Jan 2026 on startup, cached in ./.cache
```
Backend, Windows PowerShell:
```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```
Frontend (Node 20+; same commands on PowerShell and Linux/macOS):
```bash
cd frontend
npm install
npm run dev                                       # http://localhost:5173, proxies /api to :8000
```
Docker (Linux/macOS use `cp`, PowerShell use `Copy-Item .env.example .env`):
```bash
cp .env.example .env
docker compose up --build                         # http://localhost:8080 (API on :8000)
```

## Environment variables

Backend (prefix `WINDSCOPE_`, see `.env.example` and `backend/app/config.py` for all): `CORS_ORIGINS`, `CACHE_DIR`, `AUTO_INGEST_ON_STARTUP`, `PERIOD_START`, `PERIOD_END`, `LOG_LEVEL`, `ELEXON_*` (timeouts, retries, concurrency, min request interval), `DEFAULT_CUTOFF_TIME`, `DEFAULT_DAYS_BEFORE`, `WAPE_MIN_MEAN_ACTUAL_MW`.
Frontend: `VITE_API_BASE_URL` (empty = same-origin `/api`). The Elexon datasets used need no API key, so there are no secrets; `.env` is git-ignored regardless.

## Tests and checks

```bash
cd backend  && ruff check . && mypy app && pytest          # 117 tests
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```
Backend tests cover cutoff selection (inclusive boundary, no look-ahead), timestamp matching, DST (spring/autumn), duplicates, missing data, hand-checkable metrics, retry/failure handling and the API. Test data (`backend/tests/fixtures.py`) is synthetic and used **only** in tests.

To verify the live Elexon response shape on a networked machine: `cd backend && python scripts/inspect_api.py`.

## Deployment

Deployment URL: **NOT DEPLOYED. No live URL exists** (placeholder: `https://<your-frontend>.vercel.app`). Steps for the backend (Render/Docker host) and the Vercel frontend are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Verification status

Verified in the build sandbox: backend Ruff, strict mypy and 117 pytest tests; frontend `tsc`, ESLint (warnings only), 33 Vitest tests and production build; `docker compose config` validates; `vercel.json` and `render.yaml` parse; the full stack ran end to end with synthetic test fixtures standing in for Elexon.
**Verified by the user, not by me:** the live Elexon field names/types (output of `inspect_api.py` on their machine). **Not verified:** a full live ingestion through the app, and Docker image builds (a daemon started, but Docker Hub was unreachable, so no image was built or run). The nginx config has not been loaded by nginx.

## Limitations

- **WINDFOR is hourly, FUELHH is half-hourly** (confirmed against the live API on 2026-10-25). The `:30` half-hours have no forecast, are excluded with their own reason (`forecast_hourly_resolution`), and are never interpolated, so coverage is about 50% by construction. Comparing at hourly resolution (mean of the two actual half-hours vs the hourly forecast) is a possible extension; it is not implemented.
- Live schema check: the user ran `scripts/inspect_api.py` against the real Elexon API (2026-10-25); field names and types matched the parser for FUELHH and WINDFOR. A full month-long ingestion through the app has not been verified by me.
- The default cutoff is an assumption. WINDFOR resolution and FUELHH coverage may differ; unmatched intervals are reported, not imputed.
- Docker images were authored but never built or run (Docker Hub unreachable from the sandbox).
- No deployment has been performed; see `docs/DEPLOYMENT.md`.

## AI tools used

Built with Claude Code (Claude Sonnet 5.5, Anthropic) for design, implementation, tests and documentation, with human review expected before production use.

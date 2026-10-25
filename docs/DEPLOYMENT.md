# Deployment guide

Nothing here has been executed on your behalf; no live URL exists until you complete these steps.

## 1. Backend (Render, Fly.io, Railway or any Docker host)
1. Push the repo to Git (secrets are not needed; `.env` is ignored).
2. **Render:** New → Blueprint → select the repo (`render.yaml`). It builds `backend/Dockerfile`, mounts a 1 GB disk at `/data` and health-checks `/health`.
   Other hosts: build `backend/`, mount a persistent volume at `/data`, expose `$PORT`.
3. Set `WINDSCOPE_CORS_ORIGINS` to your frontend origin(s), comma-separated (e.g. `https://windscope.vercel.app`).
4. Verify: `curl https://<api-host>/health` → `{"status":"ok"}`, then `/api/v1/dataset/status` until `state` is `ready`.
   First start downloads January 2026 from Elexon (about 44 throttled requests); progress is visible in the Data Quality page.

## 2. Frontend (Vercel)
1. Import the repo, set **Root Directory** to `frontend`. Framework: Vite (build `npm run build`, output `dist`). `vercel.json` provides the SPA rewrite.
2. Environment variable: `VITE_API_BASE_URL=https://<api-host>` (no trailing slash). It is baked in at build time, so redeploy after changing it.
3. Open the Vercel URL and confirm the header shows a retrieval time, then check Overview, Explorer and CSV export.

## 3. Before sign-off
- Run `python backend/scripts/inspect_api.py` from a networked machine to confirm the Elexon schema assumptions.
- Confirm the real decision cutoff with the trading desk and set `WINDSCOPE_DEFAULT_CUTOFF_TIME` / `WINDSCOPE_DEFAULT_DAYS_BEFORE`.

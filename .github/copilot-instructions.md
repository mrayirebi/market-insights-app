# Copilot Instructions — Market Insights App

Purpose: automated market insights (ingestion, AI summaries, alerts, dashboards).
Current stack: Python 3.11, FastAPI, SQLite, pytest. CI via GitHub Actions.

## Layout (key files)
- `app/main.py` FastAPI app: `/health`, `/prices`, `/prices/{symbol}`, `POST /ingest/alpha_vantage`
- `app/db.py` SQLite helpers (schema: `prices` with unique (symbol, as_of, source))
- `ingest/alpha_vantage.py` Ingestes Global Quote and persists to SQLite
- `ingest/yahoo.py` Demo-only fetcher (not used in CI)
- `tests/` pytest suite; `pytest.ini` sets `pythonpath=.`
- `.github/workflows/ci.yml` CI on Windows/Ubuntu with Python 3.11

## Dev workflow (PowerShell)
- Create venv and install: `python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt`
- Run tests: `pytest -q`
- Run API: `uvicorn app.main:app --reload --port 8000`

## Config and data
- Env vars: `ALPHA_VANTAGE_API_KEY` (for ingest), optional `DB_PATH` (defaults to `./data/market.db`)
- `.env` is NOT auto-loaded; set env in shell or configure in hosting. `.env.example` provided.
- DB schema created on app startup; `app/print_prices.py` prints last rows.

## API patterns
- GET `/prices?limit=&symbol=&start=&end=` returns `{ items:[...], count }` (ISO8601 strings for `as_of`)
- GET `/prices/{symbol}` mirrors `/prices` but scoped to a symbol
- POST `/ingest/alpha_vantage` body `{ symbol, api_key? }`; uses env key if body key omitted; persists one row
- Response models use Pydantic; ingest response’s `created_at` is not read back from DB (blank in response) — query `/prices` to see persisted metadata

## Testing
- Network calls are mocked (e.g., Alpha Vantage) with `monkeypatch`
- SQLite in-memory or temp-file DBs used in tests; set `DB_PATH` via env
- Pytest config ensures `app/` and `ingest/` are importable from repo root

## CI
- Workflow: `.github/workflows/ci.yml` installs `requirements.txt` and runs `pytest -q` on push/PR to `main`

## Contribution rules
- Keep PRs small and runnable; update `README.md` with any new commands
- Don’t add dependencies or external services without confirming
- No secrets in repo; extend `.env.example` and docs when config changes

## Next likely steps (confirm before implementing)
- Periodic ingestion (scheduler or worker), additional data sources (Polygon/Twelve Data)
- API filters/pagination, typed request/response models for new endpoints
- Optional `.env` auto-load (propose `python-dotenv`) and typed settings
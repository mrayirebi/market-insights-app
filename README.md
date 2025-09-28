# market-insights-app
Automated market insights: data ingestion, AI summaries, alerts, and dashboards
This repository currently contains a minimal, runnable Python baseline to enable incremental development.

## Structure
- `app/` — Tiny FastAPI app exposing `/health`
- `app/db.py` — SQLite helpers (init/insert/query)
- `app/print_prices.py` — Print recent rows for local inspection
- `ingest/` — Minimal Yahoo Finance fetcher (demo only)
- `ingest/alpha_vantage.py` — Alpha Vantage ingest that writes to SQLite
- `tests/` — Pytest smoke tests for the API and ingest
- `requirements.txt` — Pinned dependencies
- `.env.example` — Example environment variables

## Quickstart (Windows PowerShell)
1. Create and activate a virtual environment
```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
```
2. Install dependencies
```powershell
pip install -r requirements.txt
```
3. Run tests
```powershell
pytest -q
```
4. Run the API locally
```powershell
uvicorn app.main:app --reload --port 8000
```
5. Try the health endpoint
```powershell
curl http://127.0.0.1:8000/health

### Ingest from Alpha Vantage (writes to SQLite)
1. Set your API key in PowerShell for the current session (or copy `.env.example` to `.env` and set it there):
```powershell
$env:ALPHA_VANTAGE_API_KEY = "<your_key>"
```
2. Run the ingest script (defaults to AAPL):
```powershell
python .\ingest\alpha_vantage.py AAPL
```
3. Inspect the last few rows:
```powershell
python .\app\print_prices.py
```

SQLite DB file location defaults to `.\data\market.db`. Override with `DB_PATH` in environment if desired.

### API examples
- List latest prices (optional filters: `symbol`, `start`, `end`, `limit`)
```powershell
curl "http://127.0.0.1:8000/prices?limit=5"
curl "http://127.0.0.1:8000/prices?symbol=AAPL&limit=5"
```
- List by symbol
```powershell
curl "http://127.0.0.1:8000/prices/AAPL?limit=5"
```
- Trigger Alpha Vantage ingest via API
```powershell
$env:ALPHA_VANTAGE_API_KEY = "<your_key>"
curl -X POST http://127.0.0.1:8000/ingest/alpha_vantage -H "Content-Type: application/json" -d '{"symbol":"AAPL"}'
```
```

## Notes
- The Yahoo fetcher (`ingest/yahoo.py`) uses a public endpoint for demonstration and may be rate-limited or change without notice.
- Copy `.env.example` to `.env` if/when you add settings. `.env` is ignored by git.
- See `.github/copilot-instructions.md` for agent guidelines and next steps for confirming the full architecture (data sources, storage, deployment).

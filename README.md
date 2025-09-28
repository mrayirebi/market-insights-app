# market-insights-app
Automated market insights: data ingestion, AI summaries, alerts, and dashboards
This repository currently contains a minimal, runnable Python baseline to enable incremental development.

## Structure
- `app/` — FastAPI app and DB helpers
	- `app/main.py` — API: prices, news, calendar, insights, journal, wealth (accounts/portfolios/transactions/positions)
	- `app/db.py` — SQLite schema and helpers (prices, journal, wealth)
	- `app/print_prices.py` — Print recent rows for local inspection
	- `app/seed_demo.py` — Seed fictional data for dashboard/journal/wealth demos
- `ingest/` — Ingestion helpers
	- `ingest/alpha_vantage.py` — Alpha Vantage (equities)
	- `ingest/alpha_vantage_fx.py` — Alpha Vantage (FX/metals)
- `static/` — Minimalist UI (Dashboard, Journal, Wealth)
- `tests/` — Pytest suite
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

### Demo data (optional)
Seed fictional prices, journal entries, and a sample portfolio with transactions:
```powershell
python .\app\seed_demo.py
```
Then open the app and explore the Dashboard (watchlist + quotes/news/calendar), Journal (stats/charts + AI Review), and Wealth (portfolios, transactions, positions) tabs.

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

## Next.js Web UI (optional)
A modern React frontend lives in `web/`. It uses Next.js + TailwindCSS + Framer Motion and talks to the FastAPI backend.

Setup:
```powershell
cd web
npm install
copy .env.example .env
npm run dev
```
Open http://localhost:3000 and ensure the API is running at http://localhost:8000 (configurable via `NEXT_PUBLIC_API_URL`).
The backend enables CORS for http://localhost:3000 by default (override with `FRONTEND_ORIGIN`).

## UI quick tour
- Dashboard
	- Add a symbol or pick from presets (FX/metals). Selecting a symbol ingests FX quotes (if configured) and refreshes Last Quote, News, Macro Calendar, and Recent Prices.
	- “Ask GPT” uses OPENAI_API_KEY to summarize outlook; otherwise returns a demo prompt.
- Journal
	- Log trades and see overview stats, equity curve, and PnL distribution. Use “Analyze Journal” for AI feedback if OPENAI_API_KEY is set.
	- Import/Export journal JSON supported.
- Wealth
	- Create/select portfolios, add transactions (BUY/SELL/DIV/CASH), and view computed positions. Market value uses the latest stored price for each symbol.

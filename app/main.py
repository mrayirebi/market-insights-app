from contextlib import asynccontextmanager
from typing import Optional, List

from fastapi import FastAPI, Query, Body, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.db import get_connection, init_db, list_prices, query_prices, get_price, upsert_journal, delete_journal, query_journal
from dotenv import load_dotenv, find_dotenv
import os


class HealthResponse(BaseModel):
    status: str = "ok"


class PriceItem(BaseModel):
    symbol: str
    price: float
    as_of: str
    currency: Optional[str] = None
    source: str
    created_at: str


class PricesResponse(BaseModel):
    items: List[PriceItem]
    count: int
    offset: int = 0
    next_offset: Optional[int] = None


class IngestRequest(BaseModel):
    symbol: str = Field(..., min_length=1)
    api_key: Optional[str] = Field(None, description="Optional override; falls back to ALPHA_VANTAGE_API_KEY env var")


class IngestResponse(BaseModel):
    saved: PriceItem


class FXIngestRequest(BaseModel):
    pair: str = Field(..., min_length=6, description="Currency pair e.g., EURUSD")
    api_key: Optional[str] = Field(None, description="Optional Alpha Vantage API key override")


class FXIngestResponse(BaseModel):
    saved: PriceItem


class NewsItem(BaseModel):
    title: str
    url: str
    source: Optional[str] = None
    published_at: Optional[str] = None
    impact: Optional[str] = Field(None, description="Low|Medium|High news impact (heuristic)")


class NewsResponse(BaseModel):
    items: List[NewsItem]


class CalendarItem(BaseModel):
    country: str
    event: str
    impact: Optional[str] = None
    time: Optional[str] = None


class CalendarResponse(BaseModel):
    items: List[CalendarItem]


class InsightsRequest(BaseModel):
    symbol: str
    horizon: str = Field("daily", description="daily|weekly")
    notes: Optional[str] = None


class InsightsResponse(BaseModel):
    summary: str


class InsightsStatus(BaseModel):
    enabled: bool


# Journal models
class JournalItem(BaseModel):
    id: Optional[int] = None
    symbol: str
    date: str
    direction: str
    qty: float
    entry: float
    stop: Optional[float] = None
    exit: Optional[float] = None
    fees: float = 0.0
    tags: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class JournalResponse(BaseModel):
    items: list[JournalItem]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    # Load .env robustly regardless of CWD and allow overriding pre-existing env vars in dev
    env_file = find_dotenv(usecwd=True)
    if not env_file:
        # Fallback to project root relative to this file: app/ -> repo/
        import pathlib
        env_file = str((pathlib.Path(__file__).resolve().parents[1] / ".env"))
    load_dotenv(dotenv_path=env_file, override=True)
    with get_connection() as conn:
        init_db(conn)
    # Simple startup diagnostics (does not print secrets)
    if os.getenv("OPENAI_API_KEY"):
        print("[startup] Insights: OPENAI_API_KEY detected")
    else:
        print("[startup] Insights: OPENAI_API_KEY not set (using fallback responses)")
    yield
    # Shutdown (nothing yet)


app = FastAPI(title="Market Insights App", lifespan=lifespan)

# Serve static frontend
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse("static/index.html")


# Journal API
@app.get("/journal", response_model=JournalResponse)
def list_journal(
    symbol: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
):
    with get_connection() as conn:
        init_db(conn)
        rows = query_journal(conn, symbol=symbol, direction=direction, start=start, end=end, tag=tag)
    items: list[JournalItem] = []
    for r in rows:
        (rid, s, d, dirn, q, e, st, x, f, tags, notes, ca, ua) = r
        items.append(JournalItem(id=rid, symbol=s, date=d, direction=dirn, qty=q, entry=e, stop=st, exit=x, fees=f, tags=tags, notes=notes, created_at=ca, updated_at=ua))
    return JournalResponse(items=items)


@app.post("/journal", response_model=JournalItem)
def save_journal(item: JournalItem = Body(...)):
    with get_connection() as conn:
        init_db(conn)
        rid = upsert_journal(conn, id=item.id, symbol=item.symbol, date=item.date, direction=item.direction, qty=item.qty, entry=item.entry, stop=item.stop, exit=item.exit, fees=item.fees, tags=item.tags, notes=item.notes)
        rows = query_journal(conn)
    # return the newly saved row
    for r in rows:
        if r[0] == rid:
            (rid, s, d, dirn, q, e, st, x, f, tags, notes, ca, ua) = r
            return JournalItem(id=rid, symbol=s, date=d, direction=dirn, qty=q, entry=e, stop=st, exit=x, fees=f, tags=tags, notes=notes, created_at=ca, updated_at=ua)
    raise HTTPException(status_code=500, detail="Saved journal row not found")


@app.delete("/journal/{rid}")
def delete_journal_row(rid: int):
    with get_connection() as conn:
        init_db(conn)
        n = delete_journal(conn, id=rid)
    if n == 0:
        raise HTTPException(status_code=404, detail="Journal row not found")
    return {"deleted": n}


@app.get("/health", response_model=HealthResponse)
def root():
    return {"status": "ok"}


@app.get("/prices", response_model=PricesResponse)
def get_prices(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    symbol: Optional[str] = Query(None),
    start: Optional[str] = Query(None, description="ISO8601 start, e.g., 2024-01-01T00:00:00Z or 2024-01-01"),
    end: Optional[str] = Query(None, description="ISO8601 end"),
):
    with get_connection() as conn:
        rows = query_prices(conn, symbol=symbol, start=start, end=end, limit=limit, offset=offset)
        items = [
            PriceItem(
                symbol=s,
                price=p,
                as_of=a,
                currency=c,
                source=src,
                created_at=cr,
            )
            for s, p, a, c, src, cr in rows
        ]
        next_off = offset + limit if len(items) == limit else None
        return PricesResponse(items=items, count=len(items), offset=offset, next_offset=next_off)


@app.get("/prices/{symbol}", response_model=PricesResponse)
def get_prices_for_symbol(symbol: str, limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0)):
    with get_connection() as conn:
        rows = query_prices(conn, symbol=symbol, limit=limit, offset=offset)
        items = [
            PriceItem(
                symbol=s,
                price=p,
                as_of=a,
                currency=c,
                source=src,
                created_at=cr,
            )
            for s, p, a, c, src, cr in rows
        ]
        next_off = offset + limit if len(items) == limit else None
        return PricesResponse(items=items, count=len(items), offset=offset, next_offset=next_off)


@app.post("/ingest/alpha_vantage", response_model=IngestResponse)
def ingest_alpha_vantage(payload: IngestRequest = Body(...)):
    from ingest.alpha_vantage import fetch_price  # local import to avoid circular deps
    import os

    api_key = payload.api_key or os.getenv("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing Alpha Vantage API key")
    data = fetch_price(payload.symbol, api_key)
    # Persist
    from app.db import insert_price
    with get_connection() as conn:
        init_db(conn)
        insert_price(
            conn,
            symbol=data["symbol"],
            price=data["price"],
            as_of=data["as_of"],
            currency=data.get("currency"),
            source="alpha_vantage",
        )
    # Read back to include created_at
    with get_connection() as conn:
        row = get_price(conn, symbol=data["symbol"], as_of=data["as_of"], source="alpha_vantage")
    if not row:
        raise HTTPException(status_code=500, detail="Saved row not found")
    s, p, a, c, src, cr = row
    item = PriceItem(symbol=s, price=p, as_of=a, currency=c, source=src, created_at=cr)
    return IngestResponse(saved=item)


@app.post("/ingest/fx", response_model=FXIngestResponse)
def ingest_fx(payload: FXIngestRequest = Body(...)):
    import os
    from ingest.alpha_vantage_fx import save_latest_fx

    api_key = payload.api_key or os.getenv("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing Alpha Vantage API key")

    try:
        item = save_latest_fx(payload.pair, api_key)
    except Exception as e:
        # Convert upstream/provider errors into a 502 to inform the client cleanly
        raise HTTPException(status_code=502, detail=f"FX ingest failed: {e}")
    # Ensure row exists even if mocked save didn't write; init schema and insert idempotently
    from app.db import insert_price
    with get_connection() as conn:
        init_db(conn)
        insert_price(
            conn,
            symbol=item["symbol"],
            price=item["price"],
            as_of=item["as_of"],
            currency=item.get("currency"),
            source="alpha_vantage_fx",
        )
        row = get_price(conn, symbol=item["symbol"], as_of=item["as_of"], source="alpha_vantage_fx")
    if not row:
        raise HTTPException(status_code=500, detail="Saved row not found")
    s, p, a, c, src, cr = row
    return FXIngestResponse(saved=PriceItem(symbol=s, price=p, as_of=a, currency=c, source=src, created_at=cr))


@app.get("/news", response_model=NewsResponse)
def get_news(symbol: Optional[str] = Query(None)):
    # Placeholder local demo response. In production, integrate a real news API (e.g., Finnhub, NewsAPI) and cache.
    raw_items = [
        {"title": "ECB commentary hints at path-dependent policy", "url": "#", "source": "DemoWire", "published_at": "2025-09-27T07:00:00Z"},
        {"title": "US labor data surprises markets", "url": "#", "source": "DemoWire", "published_at": "2025-09-27T06:30:00Z"},
    ]
    if symbol:
        raw_items.insert(0, {"title": f"{symbol}: Traders eye key levels into close", "url": "#", "source": "Desk", "published_at": "2025-09-27T08:00:00Z"})

    def score_impact(title: str) -> str:
        t = title.lower()
        high_kw = ["nfp", "nonfarm", "cpi", "inflation", "fomc", "rate", "ecb", "fed", "gdp", "payrolls"]
        med_kw = ["pmi", "retail", "claims", "confidence", "ppi", "ifo"]
        if any(k in t for k in high_kw):
            return "High"
        if any(k in t for k in med_kw):
            return "Medium"
        return "Low"

    items: list[NewsItem] = []
    for it in raw_items:
        items.append(NewsItem(**it, impact=score_impact(it["title"])) )
    return NewsResponse(items=items)


@app.get("/calendar", response_model=CalendarResponse)
def get_calendar(country: Optional[str] = Query(None)):
    # Placeholder macro calendar. Integrate Econ APIs (TradingEconomics, EconDB) in production.
    items = [
        CalendarItem(country="US", event="Nonfarm Payrolls", impact="High", time="2025-10-03T12:30:00Z"),
        CalendarItem(country="EU", event="CPI YoY (Flash)", impact="High", time="2025-10-01T09:00:00Z"),
    ]
    if country:
        items = [i for i in items if i.country.lower() == country.lower()]
    return CalendarResponse(items=items)


@app.post("/insights", response_model=InsightsResponse)
def get_insights(payload: InsightsRequest = Body(...)):
    import os
    import json
    import logging
    import requests

    key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    org = os.getenv("OPENAI_ORG_ID")
    project = os.getenv("OPENAI_PROJECT_ID")
    prompt = f"Provide a {payload.horizon} view for {payload.symbol} with risks and potential trade setups. {payload.notes or ''}".strip()
    if not key:
        return InsightsResponse(summary=("[Demo] " + prompt + "\n\nNote: Set OPENAI_API_KEY to enable live GPT insights."))

    try:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if org:
            headers["OpenAI-Organization"] = org
        if project:
            headers["OpenAI-Project"] = project
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are an FX and commodities strategist. Be concise and actionable."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.5,
                "max_tokens": 1000,
            },
            timeout=20,
        )
        if r.status_code != 200:
            # Log a safe summary; do not log the API key
            try:
                err = r.json()
                msg = err.get("error", {}).get("message", str(err))
            except Exception:
                msg = r.text[:300]
            logging.warning("OpenAI insights upstream error %s: %s", r.status_code, msg)
            from fastapi import HTTPException
            raise HTTPException(status_code=502, detail=f"OpenAI error {r.status_code}: {msg}")
        body = r.json()
        txt = body["choices"][0]["message"]["content"].strip()
        return InsightsResponse(summary=txt)
    except requests.RequestException as e:
        import traceback
        logging.warning("OpenAI insights network error: %s", str(e))
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="Network error calling OpenAI (check connectivity/firewall)")


@app.get("/insights/status", response_model=InsightsStatus)
def insights_status():
    return InsightsStatus(enabled=bool(os.getenv("OPENAI_API_KEY")))

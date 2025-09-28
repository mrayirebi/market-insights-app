from contextlib import asynccontextmanager
from typing import Optional, List

from fastapi import FastAPI, Query, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.db import (
    get_connection, init_db, list_prices, query_prices, get_price,
    upsert_journal, delete_journal, query_journal,
    upsert_account, list_accounts, delete_account,
    upsert_portfolio, list_portfolios, delete_portfolio,
    insert_transaction, list_transactions, delete_transaction, compute_positions,
    insert_entry_plan, list_entry_plans,
    ensure_user, insert_email_code, verify_email_code, create_session, get_session, delete_session,
)
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
    images: Optional[List[str]] = Field(None, description="Optional list of data URLs (image/*) to include for vision analysis")


class InsightsResponse(BaseModel):
    summary: str


class InsightsStatus(BaseModel):
    enabled: bool


class EntryPlan(BaseModel):
    id: Optional[int] = None
    symbol: str
    horizon: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    images: Optional[int] = 0
    text: str
    created_at: Optional[str] = None


class EntryPlanResponse(BaseModel):
    items: List[EntryPlan]


class EmailStartRequest(BaseModel):
    email: str


class EmailVerifyRequest(BaseModel):
    email: str
    code: str


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


# Wealth models
class Account(BaseModel):
    id: Optional[int] = None
    name: str
    type: Optional[str] = None
    currency: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AccountsResponse(BaseModel):
    items: list[Account]


class Portfolio(BaseModel):
    id: Optional[int] = None
    name: str
    base_currency: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PortfoliosResponse(BaseModel):
    items: list[Portfolio]


class Txn(BaseModel):
    id: Optional[int] = None
    portfolio_id: int
    date: str
    symbol: str
    type: str
    qty: float = 0.0
    price: float = 0.0
    fees: float = 0.0
    currency: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TxnResponse(BaseModel):
    items: list[Txn]


class Position(BaseModel):
    symbol: str
    qty: float
    avg_cost: float
    last: Optional[float] = None
    market_value: Optional[float] = None


class PositionsResponse(BaseModel):
    items: list[Position]


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

# CORS for local Next.js app (http://localhost:3000 by default)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_session_email(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    with get_connection() as conn:
        init_db(conn)
        row = get_session(conn, token=token)
        if not row:
            return None
        tok, email, expires_at = row
        # Check expiry
        cur = conn.execute("SELECT datetime('now') < ?", (expires_at,))
        if not bool(cur.fetchone()[0]):
            delete_session(conn, token=token)
            return None
        return str(email)


@app.get("/", include_in_schema=False)
def home(session: Optional[str] = Query(default=None)):
    # Try cookie first; fallback to query param for limited environments
    from fastapi import Request
    # This hack allows both cookie and query param inspection without a dep injection signature change
    # We'll read the cookie directly from the ASGI scope via a tiny request instance
    try:
        request = Request(scope={"type": "http", "headers": []})
    except Exception:
        request = None
    cookie_token = None
    if request is not None:
        try:
            cookie_token = request.cookies.get("session")
        except Exception:
            cookie_token = None
    token = cookie_token or session
    email = _get_session_email(token)
    if not email:
        return FileResponse("static/login.html")
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


# Wealth API
@app.get("/accounts", response_model=AccountsResponse)
def accounts_list():
    with get_connection() as conn:
        init_db(conn)
        rows = list_accounts(conn)
    items = [Account(id=r[0], name=r[1], type=r[2], currency=r[3], created_at=r[4], updated_at=r[5]) for r in rows]
    return AccountsResponse(items=items)


@app.post("/accounts", response_model=Account)
def accounts_save(item: Account = Body(...)):
    with get_connection() as conn:
        init_db(conn)
        rid = upsert_account(conn, id=item.id, name=item.name, type=item.type, currency=item.currency)
        rows = list_accounts(conn)
    for r in rows:
        if r[0] == rid:
            return Account(id=r[0], name=r[1], type=r[2], currency=r[3], created_at=r[4], updated_at=r[5])
    raise HTTPException(status_code=500, detail="Saved account not found")


@app.delete("/accounts/{rid}")
def accounts_delete(rid: int):
    with get_connection() as conn:
        init_db(conn)
        n = delete_account(conn, id=rid)
    if n == 0:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"deleted": n}


@app.get("/portfolios", response_model=PortfoliosResponse)
def portfolios_list():
    with get_connection() as conn:
        init_db(conn)
        rows = list_portfolios(conn)
    items = [Portfolio(id=r[0], name=r[1], base_currency=r[2], created_at=r[3], updated_at=r[4]) for r in rows]
    return PortfoliosResponse(items=items)


@app.post("/portfolios", response_model=Portfolio)
def portfolios_save(item: Portfolio = Body(...)):
    with get_connection() as conn:
        init_db(conn)
        rid = upsert_portfolio(conn, id=item.id, name=item.name, base_currency=item.base_currency)
        rows = list_portfolios(conn)
    for r in rows:
        if r[0] == rid:
            return Portfolio(id=r[0], name=r[1], base_currency=r[2], created_at=r[3], updated_at=r[4])
    raise HTTPException(status_code=500, detail="Saved portfolio not found")


@app.delete("/portfolios/{rid}")
def portfolios_delete(rid: int):
    with get_connection() as conn:
        init_db(conn)
        n = delete_portfolio(conn, id=rid)
    if n == 0:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return {"deleted": n}


@app.get("/portfolios/{pid}/transactions", response_model=TxnResponse)
def transactions_list(pid: int = 0):
    with get_connection() as conn:
        init_db(conn)
        rows = list_transactions(conn, portfolio_id=pid)
    items = [Txn(id=r[0], portfolio_id=r[1], date=r[2], symbol=r[3], type=r[4], qty=r[5], price=r[6], fees=r[7], currency=r[8], notes=r[9], created_at=r[10], updated_at=r[11]) for r in rows]
    return TxnResponse(items=items)


@app.post("/portfolios/{pid}/transactions", response_model=Txn)
def transactions_add(pid: int, item: Txn = Body(...)):
    with get_connection() as conn:
        init_db(conn)
        rid = insert_transaction(conn, portfolio_id=pid, date=item.date, symbol=item.symbol, type=item.type, qty=item.qty, price=item.price, fees=item.fees, currency=item.currency, notes=item.notes)
        rows = list_transactions(conn, portfolio_id=pid)
    for r in rows:
        if r[0] == rid:
            return Txn(id=r[0], portfolio_id=r[1], date=r[2], symbol=r[3], type=r[4], qty=r[5], price=r[6], fees=r[7], currency=r[8], notes=r[9], created_at=r[10], updated_at=r[11])
    raise HTTPException(status_code=500, detail="Saved transaction not found")


@app.delete("/transactions/{rid}")
def transactions_delete(rid: int):
    with get_connection() as conn:
        init_db(conn)
        n = delete_transaction(conn, id=rid)
    if n == 0:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"deleted": n}


@app.get("/portfolios/{pid}/positions", response_model=PositionsResponse)
def positions_list(pid: int):
    with get_connection() as conn:
        init_db(conn)
        items = [Position(**p) for p in compute_positions(conn, portfolio_id=pid)]
    return PositionsResponse(items=items)


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


# ===== Email magic-code authentication =====
@app.post("/auth/request_code")
def auth_request_code(payload: EmailStartRequest = Body(...)):
    import random
    import string
    import os
    import logging
    import smtplib
    from email.message import EmailMessage
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    code = "".join(random.choice(string.digits) for _ in range(6))
    with get_connection() as conn:
        init_db(conn)
        ensure_user(conn, email=email)
        insert_email_code(conn, email=email, code=code, ttl_minutes=10)
    # Try to send email via SMTP if configured
    host = os.getenv("SMTP_HOST"); port = int(os.getenv("SMTP_PORT") or 587)
    user = os.getenv("SMTP_USER"); pwd = os.getenv("SMTP_PASS")
    sender = os.getenv("SMTP_FROM") or "no-reply@localhost"
    use_tls = str(os.getenv("SMTP_TLS", "true")).lower() in ("1","true","yes","on")
    sent = False; error = None
    if host and sender:
        try:
            msg = EmailMessage()
            msg["Subject"] = "Your Market Insights sign-in code"
            msg["From"] = sender
            msg["To"] = email
            msg.set_content(f"Your sign-in code is: {code}\n\nThis code expires in 10 minutes.")
            if use_tls:
                with smtplib.SMTP(host, port, timeout=20) as s:
                    s.starttls()
                    if user and pwd:
                        s.login(user, pwd)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(host, port, timeout=20) as s:
                    if user and pwd:
                        s.login(user, pwd)
                    s.send_message(msg)
            sent = True
        except Exception as e:
            error = str(e)
            logging.warning("[auth] SMTP send failed: %s", error)
    if not sent:
        logging.info("[auth] Dev mode: code for %s is %s", email, code)
    # Return status; include dev_code only when not actually sent
    out = {"ok": True, "sent": sent}
    if not sent:
        out["dev_code"] = code
        if error:
            out["error"] = "smtp_failed"
    return out


@app.post("/auth/verify_code")
def auth_verify_code(payload: EmailVerifyRequest = Body(...)):
    import secrets
    email = payload.email.strip().lower()
    code = payload.code.strip()
    with get_connection() as conn:
        init_db(conn)
        if not verify_email_code(conn, email=email, code=code):
            raise HTTPException(status_code=400, detail="Invalid or expired code")
        token = secrets.token_urlsafe(32)
        create_session(conn, email=email, token=token, ttl_days=7)
    # Set cookie in a simple HTML response that redirects to /
    html = """
    <html><head><meta http-equiv='refresh' content='0; url=/'/></head><body>OK</body></html>
    """
    resp = HTMLResponse(content=html)
    resp.set_cookie("session", token, httponly=True, samesite="lax", max_age=7*24*3600)
    return resp


@app.post("/auth/logout")
def auth_logout(session: Optional[str] = Query(default=None)):
    # accept cookie or query param for simplicity
    from fastapi import Request
    try:
        request = Request(scope={"type": "http", "headers": []})
    except Exception:
        request = None
    cookie_token = None
    if request is not None:
        try:
            cookie_token = request.cookies.get("session")
        except Exception:
            cookie_token = None
    token = cookie_token or session
    if token:
        with get_connection() as conn:
            init_db(conn)
            delete_session(conn, token=token)
    resp = HTMLResponse(content="OK")
    resp.delete_cookie("session")
    return resp


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
        extra = "\n\n[Note] Vision inputs not processed in demo mode." if (payload.images and len(payload.images)>0) else ""
        return InsightsResponse(summary=("[Demo] " + prompt + "\n\nNote: Set OPENAI_API_KEY to enable live GPT insights." + extra))

    try:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if org:
            headers["OpenAI-Organization"] = org
        if project:
            headers["OpenAI-Project"] = project

        # Build a Chat Completions request; include images when provided
        url = "https://api.openai.com/v1/chat/completions"
        content = [{"type": "text", "text": prompt}]
        imgs = payload.images or []
        for u in imgs[:5]:  # cap to 5 images
            try:
                if isinstance(u, str) and u.startswith("data:image"):
                    content.append({"type": "image_url", "image_url": {"url": u}})
            except Exception:
                pass
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are an ICT trading mentor. Use ICT concepts (liquidity, displacement, PD arrays, OTE, FVG/OB, killzones) to craft concise, actionable plans."},
                {"role": "user", "content": content},
            ],
            "temperature": 0.4,
        }
        r = requests.post(url, headers=headers, json=body, timeout=60)
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
        # Do not auto-persist here; the client saves entry plans explicitly after generation
        return InsightsResponse(summary=txt)
    except requests.RequestException as e:
        import traceback
        logging.warning("OpenAI insights network error: %s", str(e))
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="Network error calling OpenAI (check connectivity/firewall)")


@app.get("/insights/status", response_model=InsightsStatus)
def insights_status():
    return InsightsStatus(enabled=bool(os.getenv("OPENAI_API_KEY")))


# Entry Plans API (persisted)
@app.get("/entry_plans", response_model=EntryPlanResponse)
def entry_plans_list(symbol: Optional[str] = Query(None), limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    with get_connection() as conn:
        init_db(conn)
        rows = list_entry_plans(conn, symbol=symbol, limit=limit, offset=offset)
    items: List[EntryPlan] = []
    for r in rows:
        rid, sym, text, horizon, source, notes, images, created_at = r
        items.append(EntryPlan(id=rid, symbol=sym, text=text, horizon=horizon, source=source, notes=notes, images=images, created_at=created_at))
    return EntryPlanResponse(items=items)


@app.post("/entry_plans", response_model=EntryPlan)
def entry_plan_save(item: EntryPlan = Body(...)):
    with get_connection() as conn:
        init_db(conn)
        rid = insert_entry_plan(conn, symbol=item.symbol, text=item.text, horizon=item.horizon, source=item.source, notes=item.notes, images=item.images or 0)
        rows = list_entry_plans(conn, symbol=item.symbol, limit=1, offset=0)
    if rows:
        rid, sym, text, horizon, source, notes, images, created_at = rows[0]
        return EntryPlan(id=rid, symbol=sym, text=text, horizon=horizon, source=source, notes=notes, images=images, created_at=created_at)
    raise HTTPException(status_code=500, detail="Saved entry plan not found")

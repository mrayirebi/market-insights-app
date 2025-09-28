from __future__ import annotations

import os
import sys
from typing import Dict, Any, Optional

import requests

from app.db import get_connection, init_db, insert_price


ALPHA_URL = "https://www.alphavantage.co/query"


def fetch_price(symbol: str, api_key: str) -> Dict[str, Any]:
    """
    Fetch latest quote for a symbol using Alpha Vantage GLOBAL_QUOTE.
    Returns a dict: {symbol, price, as_of, currency}
    Note: 'currency' is not provided by GLOBAL_QUOTE and will be None.
    """
    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": symbol,
        "apikey": api_key,
    }
    r = requests.get(ALPHA_URL, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    quote = data.get("Global Quote") or data.get("globalQuote") or {}
    if not quote:
        # Alpha Vantage sometimes returns {"Note": ...} when throttled; surface it
        msg = data.get("Note") or data.get("Information") or "No Global Quote in response"
        raise ValueError(msg)

    price_str: Optional[str] = quote.get("05. price") or quote.get("05_price")
    date_str: Optional[str] = quote.get("07. latest trading day") or quote.get("07_latest_trading_day")
    if not price_str:
        raise ValueError("Missing price in Global Quote")

    # as_of: normalize to ISO date with midnight Z if only a date is provided
    as_of = f"{date_str}T00:00:00Z" if date_str else None

    return {
        "symbol": quote.get("01. symbol") or quote.get("01_symbol") or symbol,
        "price": float(price_str),
        "as_of": as_of or quote.get("latestTradingDay") or quote.get("timestamp") or "",
        "currency": None,
    }


def save_latest(symbol: str, api_key: str) -> Dict[str, Any]:
    payload = fetch_price(symbol, api_key)
    with get_connection() as conn:
        init_db(conn)
        insert_price(
            conn,
            symbol=payload["symbol"],
            price=payload["price"],
            as_of=payload["as_of"],
            currency=payload.get("currency"),
            source="alpha_vantage",
        )
    return payload


if __name__ == "__main__":
    api_key = os.getenv("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        print("Error: set ALPHA_VANTAGE_API_KEY in environment or .env", file=sys.stderr)
        sys.exit(1)
    symbol = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    out = save_latest(symbol, api_key)
    print(out)

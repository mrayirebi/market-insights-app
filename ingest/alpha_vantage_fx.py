import os
import requests
from typing import Dict
from datetime import datetime, timezone

API_URL = "https://www.alphavantage.co/query"


def parse_pair(pair: str):
    pair = pair.replace("/", "").upper()
    if len(pair) != 6:
        raise ValueError("Pair must be 6 letters like EURUSD")
    return pair[:3], pair[3:]


def fetch_fx_rate(pair: str, api_key: str) -> Dict:
    base, quote = parse_pair(pair)
    params = {
        "function": "CURRENCY_EXCHANGE_RATE",
        "from_currency": base,
        "to_currency": quote,
        "apikey": api_key,
    }
    try:
        r = requests.get(API_URL, params=params, timeout=15)
        r.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f"Network error calling Alpha Vantage: {e}")
    body = r.json() or {}
    # Handle common Alpha Vantage non-data responses
    if isinstance(body, dict):
        if body.get("Note"):
            raise RuntimeError("Alpha Vantage rate limit: " + str(body.get("Note")))
        if body.get("Error Message"):
            raise RuntimeError("Alpha Vantage error: " + str(body.get("Error Message")))
    data = body.get("Realtime Currency Exchange Rate")
    if not data or not isinstance(data, dict):
        raise RuntimeError("Alpha Vantage FX response missing data")
    price_str = data.get("5. Exchange Rate") or data.get("Exchange Rate")
    if price_str is None:
        raise RuntimeError("Alpha Vantage FX response missing exchange rate")
    try:
        price = float(str(price_str))
    except Exception:
        raise RuntimeError("Alpha Vantage FX response invalid exchange rate")
    ts = (
        data.get("6. Last Refreshed")
        or body.get("Meta Data", {}).get("5. Last Refreshed")
    )
    if not ts:
        # Fallback to current UTC if API omits timestamp
        ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    else:
        # If the API returns without Z, append Z to mark UTC
        if ts.endswith("Z"):
            pass
        elif "T" in ts:
            ts = ts + ("Z" if not ts.endswith("Z") else "")
        else:
            # Handle "YYYY-MM-DD HH:MM:SS"
            ts = ts.replace(" ", "T") + "Z"
    return {"symbol": f"{base}{quote}", "price": price, "as_of": ts, "currency": quote}


def save_latest_fx(pair: str, api_key: str):
    from app.db import get_connection, init_db, insert_price

    item = fetch_fx_rate(pair, api_key)
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
    return item


if __name__ == "__main__":
    import sys
    pair = sys.argv[1] if len(sys.argv) > 1 else "EURUSD"
    key = os.getenv("ALPHA_VANTAGE_API_KEY")
    if not key:
        print("Set ALPHA_VANTAGE_API_KEY")
        sys.exit(1)
    out = save_latest_fx(pair, key)
    print(out)

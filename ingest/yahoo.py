import datetime as dt
from typing import Dict, Any

import requests


def fetch_price(symbol: str) -> Dict[str, Any]:
    """
    Fetch a simple current price for a symbol using Yahoo Finance chart API (unauthenticated).
    This is a minimal demo and not guaranteed for production reliability.
    """
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{symbol}?region=US&lang=en-US&range=1d&interval=1m&includePrePost=false"
    )
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    data = r.json()

    result = data.get("chart", {}).get("result", [])
    if not result:
        raise ValueError("No result in Yahoo response")

    meta = result[0].get("meta", {})
    timestamps = result[0].get("timestamp", [])
    closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])

    if not timestamps or not closes:
        raise ValueError("Missing timestamps or closes in Yahoo response")

    ts = timestamps[-1]
    price = closes[-1]
    if price is None:
        # find last non-null
        for p in reversed(closes):
            if p is not None:
                price = p
                break
    if price is None:
        raise ValueError("No valid close price found")

    return {
        "symbol": meta.get("symbol", symbol),
        "price": float(price),
        "as_of": dt.datetime.utcfromtimestamp(ts).isoformat() + "Z",
        "currency": meta.get("currency"),
    }


if __name__ == "__main__":
    print(fetch_price("AAPL"))

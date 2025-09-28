from __future__ import annotations

import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure repo root is on sys.path when running as a script
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import (
    get_connection,
    init_db,
    insert_price,
    upsert_journal,
    upsert_portfolio,
    list_portfolios,
    insert_transaction,
)


def iso(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def seed_prices() -> None:
    now = datetime.now(timezone.utc)
    symbols = {
        "EURUSD": 1.0850,
        "GBPUSD": 1.2750,
        "USDJPY": 149.30,
        "XAUUSD": 2350.0,
        "XAGUSD": 28.0,
        "AAPL": 192.0,
        "MSFT": 415.0,
    }
    with get_connection() as conn:
        init_db(conn)
        for sym, base in symbols.items():
            price = base
            for i in range(24, -1, -1):  # 25 hourly points
                ts = now - timedelta(hours=i)
                # random walk
                step = random.uniform(-0.001, 0.001) * (base if sym.isalpha() and len(sym) <= 4 else 1)
                price = max(0.0001, price + step)
                insert_price(
                    conn,
                    symbol=sym,
                    price=round(price, 5),
                    as_of=iso(ts),
                    currency="USD" if sym.startswith("X") or sym in ("AAPL", "MSFT") else None,
                    source="demo",
                )


def seed_journal(n: int = 40) -> None:
    now = datetime.now(timezone.utc)
    syms = ["EURUSD", "XAUUSD", "GBPUSD", "USDJPY"]
    with get_connection() as conn:
        init_db(conn)
        for i in range(n):
            sym = syms[i % len(syms)]
            dt = now - timedelta(days=n - i)
            direction = "Long" if i % 2 == 0 else "Short"
            qty = 1.0 if not sym.endswith("JPY") else 10000
            # synthetic price context
            base = {
                "EURUSD": 1.08,
                "XAUUSD": 2350.0,
                "GBPUSD": 1.27,
                "USDJPY": 149.0,
            }[sym]
            drift = random.uniform(-0.02, 0.02) * (base * 0.02 if sym.startswith("XA") else base * 0.01)
            entry = base + drift
            move = random.uniform(-0.006, 0.008) * (base * 0.02 if sym.startswith("XA") else base * 0.01)
            exit = entry + (move if direction == "Long" else -move)
            stop = entry - (abs(move) * 0.6 if direction == "Long" else -abs(move) * 0.6)
            fees = 0.0
            upsert_journal(
                conn,
                id=None,
                symbol=sym,
                date=iso(dt),
                direction=direction,
                qty=qty,
                entry=float(entry),
                stop=float(stop),
                exit=float(exit),
                fees=fees,
                tags="demo",
                notes="Demo trade",
            )


def seed_wealth() -> None:
    # Ensure a portfolio exists
    conn = get_connection()
    init_db(conn)
    pid = upsert_portfolio(conn, id=None, name="Demo Portfolio", base_currency="USD")
    # Some transactions
    txns = [
        ("2025-09-15", "AAPL", "BUY", 10, 190.0, 0.0),
        ("2025-09-20", "AAPL", "SELL", 5, 200.0, 0.0),
        ("2025-09-10", "XAUUSD", "BUY", 1.0, 2300.0, 0.0),
        ("2025-09-22", "EURUSD", "BUY", 10000, 1.0800, 0.0),
    ]
    for d, sym, typ, qty, price, fees in txns:
        insert_transaction(
            conn,
            portfolio_id=pid,
            date=f"{d}T00:00:00Z",
            symbol=sym,
            type=typ,
            qty=float(qty),
            price=float(price),
            fees=float(fees),
            currency="USD" if sym in ("AAPL", "XAUUSD") else None,
            notes="demo",
        )


def main() -> None:
    with get_connection() as conn:
        init_db(conn)
    seed_prices()
    seed_journal()
    seed_wealth()
    print("[demo] Seed complete. Open the app and explore Dashboard, Journal, and Wealth tabs.")


if __name__ == "__main__":
    main()

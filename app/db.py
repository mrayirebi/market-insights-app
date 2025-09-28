from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Iterable, Tuple, Optional, List, Any


DATA_DIR = Path("data")


def get_db_path() -> Path:
    env_path = os.getenv("DB_PATH")
    if env_path:
        return Path(env_path)
    return DATA_DIR / "market.db"


def ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Return a sqlite3 connection to the db; creates parent dir if needed."""
    if db_path is None:
        db_path = get_db_path()
    ensure_dir(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            price REAL NOT NULL,
            as_of TEXT NOT NULL,
            currency TEXT,
            source TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(symbol, as_of, source)
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            direction TEXT NOT NULL,
            qty REAL NOT NULL,
            entry REAL NOT NULL,
            stop REAL,
            exit REAL,
            fees REAL DEFAULT 0,
            tags TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    # Wealth management tables
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT,
            currency TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS portfolios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            base_currency TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            type TEXT NOT NULL, -- BUY, SELL, DIV, CASH, FX
            qty REAL DEFAULT 0,
            price REAL DEFAULT 0,
            fees REAL DEFAULT 0,
            currency TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
        );
        """
    )
    # Entry plans history
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS entry_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            horizon TEXT,
            source TEXT,
            notes TEXT,
            images INTEGER DEFAULT 0,
            text TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    # Prevent exact duplicate plans per symbol
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_entry_plans_symbol_text
        ON entry_plans(symbol, text);
        """
    )
    # Auth tables
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS email_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    conn.commit()


def upsert_journal(
    conn: sqlite3.Connection,
    *,
    id: Optional[int],
    symbol: str,
    date: str,
    direction: str,
    qty: float,
    entry: float,
    stop: Optional[float],
    exit: Optional[float],
    fees: float,
    tags: Optional[str],
    notes: Optional[str],
) -> int:
    if id:
        conn.execute(
            """
            UPDATE journal
            SET symbol=?, date=?, direction=?, qty=?, entry=?, stop=?, exit=?, fees=?, tags=?, notes=?, updated_at=datetime('now')
            WHERE id=?
            """,
            (symbol, date, direction, float(qty), float(entry), stop, exit, float(fees), tags, notes, int(id)),
        )
        conn.commit()
        return int(id)
    cur = conn.execute(
        """
        INSERT INTO journal(symbol, date, direction, qty, entry, stop, exit, fees, tags, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (symbol, date, direction, float(qty), float(entry), stop, exit, float(fees), tags, notes),
    )
    conn.commit()
    lid = cur.lastrowid if cur and cur.lastrowid is not None else 0
    return int(lid)


def delete_journal(conn: sqlite3.Connection, *, id: int) -> int:
    cur = conn.execute("DELETE FROM journal WHERE id=?", (int(id),))
    conn.commit()
    return cur.rowcount


def query_journal(
    conn: sqlite3.Connection,
    *,
    symbol: Optional[str] = None,
    direction: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    tag: Optional[str] = None,
) -> List[Tuple[Any, ...]]:
    clauses = []
    params: List[Any] = []
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
    if direction:
        clauses.append("direction = ?")
        params.append(direction)
    if start:
        clauses.append("date >= ?")
        params.append(start)
    if end:
        clauses.append("date <= ?")
        params.append(end)
    if tag:
        clauses.append("(tags LIKE ?)")
        params.append(f"%{tag}%")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = (
        "SELECT id, symbol, date, direction, qty, entry, stop, exit, fees, tags, notes, created_at, updated_at "
        f"FROM journal {where} ORDER BY date DESC, id DESC;"
    )
    return conn.execute(sql, tuple(params)).fetchall()


def insert_price(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    price: float,
    as_of: str,
    currency: Optional[str],
    source: str,
) -> int:
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO prices(symbol, price, as_of, currency, source)
        VALUES (?, ?, ?, ?, ?);
        """,
        (symbol, float(price), as_of, currency, source),
    )
    conn.commit()
    return cur.rowcount


def list_prices(conn: sqlite3.Connection, limit: int = 5) -> Iterable[Tuple]:
    return conn.execute(
        "SELECT symbol, price, as_of, currency, source, created_at FROM prices ORDER BY id DESC LIMIT ?;",
        (limit,),
    ).fetchall()


def query_prices(
    conn: sqlite3.Connection,
    *,
    symbol: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 10,
    offset: int = 0,
) -> List[Tuple[Any, ...]]:
    """
    Query prices with optional filters. as_of is stored as ISO8601 text, so lexical range works.
    Returns list of tuples like list_prices.
    """
    clauses = []
    params: List[Any] = []
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
    if start:
        clauses.append("as_of >= ?")
        params.append(start)
    if end:
        clauses.append("as_of <= ?")
        params.append(end)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = (
        "SELECT symbol, price, as_of, currency, source, created_at FROM prices "
        f"{where} ORDER BY as_of DESC, id DESC LIMIT ? OFFSET ?;"
    )
    params.append(int(limit))
    params.append(int(offset))
    return conn.execute(sql, tuple(params)).fetchall()


def get_price(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    as_of: str,
    source: str,
) -> Optional[Tuple[Any, ...]]:
    return conn.execute(
        """
        SELECT symbol, price, as_of, currency, source, created_at
        FROM prices
        WHERE symbol = ? AND as_of = ? AND source = ?
        ORDER BY id DESC
        LIMIT 1;
        """,
        (symbol, as_of, source),
    ).fetchone()


# Wealth helpers
def upsert_account(conn: sqlite3.Connection, *, id: Optional[int], name: str, type: Optional[str], currency: Optional[str]) -> int:
    if id:
        conn.execute("UPDATE accounts SET name=?, type=?, currency=?, updated_at=datetime('now') WHERE id=?", (name, type, currency, int(id)))
        conn.commit(); return int(id)
    cur = conn.execute("INSERT INTO accounts(name, type, currency) VALUES (?, ?, ?)", (name, type, currency))
    conn.commit(); return int(cur.lastrowid or 0)


def list_accounts(conn: sqlite3.Connection) -> List[Tuple[Any, ...]]:
    return conn.execute("SELECT id, name, type, currency, created_at, updated_at FROM accounts ORDER BY id DESC").fetchall()


def delete_account(conn: sqlite3.Connection, *, id: int) -> int:
    cur = conn.execute("DELETE FROM accounts WHERE id=?", (int(id),)); conn.commit(); return cur.rowcount


def upsert_portfolio(conn: sqlite3.Connection, *, id: Optional[int], name: str, base_currency: Optional[str]) -> int:
    if id:
        conn.execute("UPDATE portfolios SET name=?, base_currency=?, updated_at=datetime('now') WHERE id=?", (name, base_currency, int(id)))
        conn.commit(); return int(id)
    cur = conn.execute("INSERT INTO portfolios(name, base_currency) VALUES (?, ?)", (name, base_currency))
    conn.commit(); return int(cur.lastrowid or 0)


def list_portfolios(conn: sqlite3.Connection) -> List[Tuple[Any, ...]]:
    return conn.execute("SELECT id, name, base_currency, created_at, updated_at FROM portfolios ORDER BY id DESC").fetchall()


def delete_portfolio(conn: sqlite3.Connection, *, id: int) -> int:
    cur = conn.execute("DELETE FROM portfolios WHERE id=?", (int(id),)); conn.commit(); return cur.rowcount


def insert_transaction(
    conn: sqlite3.Connection,
    *,
    portfolio_id: int,
    date: str,
    symbol: str,
    type: str,
    qty: float,
    price: float,
    fees: float,
    currency: Optional[str],
    notes: Optional[str],
) -> int:
    cur = conn.execute(
        """
        INSERT INTO transactions(portfolio_id, date, symbol, type, qty, price, fees, currency, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (int(portfolio_id), date, symbol, type, float(qty), float(price), float(fees), currency, notes),
    )
    conn.commit(); return int(cur.lastrowid or 0)


def list_transactions(conn: sqlite3.Connection, *, portfolio_id: int) -> List[Tuple[Any, ...]]:
    return conn.execute(
        "SELECT id, portfolio_id, date, symbol, type, qty, price, fees, currency, notes, created_at, updated_at FROM transactions WHERE portfolio_id=? ORDER BY date DESC, id DESC",
        (int(portfolio_id),),
    ).fetchall()


def delete_transaction(conn: sqlite3.Connection, *, id: int) -> int:
    cur = conn.execute("DELETE FROM transactions WHERE id=?", (int(id),)); conn.commit(); return cur.rowcount


def get_latest_price(conn: sqlite3.Connection, *, symbol: str) -> Optional[float]:
    row = conn.execute(
        "SELECT price FROM prices WHERE symbol=? ORDER BY as_of DESC, id DESC LIMIT 1",
        (symbol,),
    ).fetchone()
    return float(row[0]) if row else None


def compute_positions(conn: sqlite3.Connection, *, portfolio_id: int) -> List[dict]:
    rows = conn.execute(
        "SELECT symbol, type, qty, price, fees FROM transactions WHERE portfolio_id=? ORDER BY date ASC, id ASC",
        (int(portfolio_id),),
    ).fetchall()
    # Aggregate by symbol
    agg: dict[str, dict] = {}
    for symbol, typ, qty, price, fees in rows:
        if symbol not in agg:
            agg[symbol] = {"qty": 0.0, "cost": 0.0, "fees": 0.0, "buys": 0.0}
        if typ.upper() == "BUY":
            agg[symbol]["qty"] += float(qty)
            agg[symbol]["cost"] += float(qty) * float(price)
            agg[symbol]["fees"] += float(fees)
            agg[symbol]["buys"] += float(qty)
        elif typ.upper() == "SELL":
            agg[symbol]["qty"] -= float(qty)
            agg[symbol]["fees"] += float(fees)
        # DIV/CASH/FX ignored in position qty
    out = []
    for sym, a in agg.items():
        qty = a["qty"]
        avg_cost = (a["cost"] / a["buys"]) if a["buys"] else 0.0
        last = get_latest_price(conn, symbol=sym)
        mkt = (last * qty) if (last is not None) else None
        out.append({"symbol": sym, "qty": qty, "avg_cost": avg_cost, "last": last, "market_value": mkt})
    return out


# Entry plan helpers
def insert_entry_plan(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    text: str,
    horizon: Optional[str] = None,
    source: Optional[str] = None,
    notes: Optional[str] = None,
    images: Optional[int] = 0,
) -> int:
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO entry_plans(symbol, text, horizon, source, notes, images)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (symbol, text, horizon, source, notes, int(images or 0)),
    )
    conn.commit(); return int(cur.lastrowid or 0)


def list_entry_plans(
    conn: sqlite3.Connection,
    *,
    symbol: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Tuple[Any, ...]]:
    if symbol:
        return conn.execute(
            """
            SELECT id, symbol, text, horizon, source, notes, images, created_at
            FROM entry_plans
            WHERE symbol = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (symbol, int(limit), int(offset)),
        ).fetchall()
    return conn.execute(
        """
        SELECT id, symbol, text, horizon, source, notes, images, created_at
        FROM entry_plans
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
        """,
        (int(limit), int(offset)),
    ).fetchall()

# ===== Auth helpers =====
def ensure_user(conn: sqlite3.Connection, *, email: str) -> None:
    conn.execute("INSERT OR IGNORE INTO users(email) VALUES (?)", (email.lower(),))
    conn.commit()


def insert_email_code(conn: sqlite3.Connection, *, email: str, code: str, ttl_minutes: int = 10) -> int:
    # expires_at = now + ttl
    cur = conn.execute(
        """
        INSERT INTO email_codes(email, code, expires_at)
        VALUES (?, ?, datetime('now', ?))
        """,
        (email.lower(), code, f"+{int(ttl_minutes)} minutes"),
    )
    conn.commit(); return int(cur.lastrowid or 0)


def verify_email_code(conn: sqlite3.Connection, *, email: str, code: str) -> bool:
    row = conn.execute(
        """
        SELECT id, expires_at, used FROM email_codes
        WHERE email=? AND code=?
        ORDER BY id DESC LIMIT 1
        """,
        (email.lower(), code),
    ).fetchone()
    if not row:
        return False
    rid, expires_at, used = row
    # Check expiry and not used
    cur = conn.execute("SELECT datetime('now') < ?", (expires_at,))
    still_valid = bool(cur.fetchone()[0])
    if not still_valid or used:
        return False
    conn.execute("UPDATE email_codes SET used=1 WHERE id=?", (rid,))
    conn.commit()
    return True


def create_session(conn: sqlite3.Connection, *, email: str, token: str, ttl_days: int = 7) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO sessions(token, email, expires_at)
        VALUES (?, ?, datetime('now', ?))
        """,
        (token, email.lower(), f"+{int(ttl_days)} days"),
    )
    conn.commit()


def get_session(conn: sqlite3.Connection, *, token: str) -> Optional[Tuple[Any, ...]]:
    return conn.execute(
        """
        SELECT token, email, expires_at FROM sessions WHERE token=? LIMIT 1
        """,
        (token,),
    ).fetchone()


def delete_session(conn: sqlite3.Connection, *, token: str) -> int:
    cur = conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    conn.commit(); return cur.rowcount

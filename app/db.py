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

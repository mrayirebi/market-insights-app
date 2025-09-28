import sqlite3

from app.db import init_db, insert_price, list_prices


def test_db_insert_and_list():
    conn = sqlite3.connect(":memory:")
    init_db(conn)
    rc = insert_price(
        conn,
        symbol="AAPL",
        price=150.5,
        as_of="2024-01-02T00:00:00Z",
        currency="USD",
        source="test",
    )
    assert rc in (0, 1)  # 1 on first insert, 0 if UNIQUE conflicts
    rows = list(list_prices(conn, limit=1))
    assert len(rows) == 1
    sym, price, as_of, currency, source, created_at = rows[0]
    assert sym == "AAPL"
    assert price == 150.5
    assert as_of.startswith("2024-01-02")
    assert currency == "USD"
    assert source == "test"

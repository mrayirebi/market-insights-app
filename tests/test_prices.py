import os
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_connection, init_db, insert_price


def test_prices_empty(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_path))

    # Ensure DB exists but with no rows
    with get_connection() as conn:
        init_db(conn)

    client = TestClient(app)
    r = client.get("/prices", params={"limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 0
    assert body["items"] == []


def test_prices_with_one_row(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_path))

    with get_connection() as conn:
        init_db(conn)
        insert_price(
            conn,
            symbol="AAPL",
            price=123.45,
            as_of="2024-01-02T00:00:00Z",
            currency="USD",
            source="test",
        )

    client = TestClient(app)
    r = client.get("/prices", params={"limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    top = body["items"][0]
    assert top["symbol"] == "AAPL"
    assert top["price"] == 123.45
    assert top["currency"] == "USD"
    assert top["source"] == "test"

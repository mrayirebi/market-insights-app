from fastapi.testclient import TestClient

from app.main import app
from app.db import get_connection, init_db, insert_price


def test_prices_filter_symbol(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    with get_connection() as conn:
        init_db(conn)
        insert_price(conn, symbol="AAPL", price=1.0, as_of="2024-01-01T00:00:00Z", currency="USD", source="test")
        insert_price(conn, symbol="MSFT", price=2.0, as_of="2024-01-02T00:00:00Z", currency="USD", source="test")

    c = TestClient(app)
    r = c.get("/prices", params={"symbol": "MSFT", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1
    assert body["items"][0]["symbol"] == "MSFT"


def test_ingest_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))

    # Mock fetch_price to avoid network
    def fake_fetch(symbol, api_key):
        return {"symbol": symbol, "price": 123.45, "as_of": "2024-01-03T00:00:00Z", "currency": None}

    import ingest.alpha_vantage as av
    monkeypatch.setattr(av, "fetch_price", fake_fetch)
    monkeypatch.setenv("ALPHA_VANTAGE_API_KEY", "dummy")

    c = TestClient(app)
    r = c.post("/ingest/alpha_vantage", json={"symbol": "AAPL"})
    assert r.status_code == 200
    body = r.json()
    assert body["saved"]["symbol"] == "AAPL"
    assert body["saved"]["price"] == 123.45
    assert body["saved"]["created_at"]


def test_pagination(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    with get_connection() as conn:
        init_db(conn)
        # Insert three rows for the same symbol with increasing as_of
        insert_price(conn, symbol="AAPL", price=1.0, as_of="2024-01-01T00:00:00Z", currency="USD", source="test")
        insert_price(conn, symbol="AAPL", price=2.0, as_of="2024-01-02T00:00:00Z", currency="USD", source="test")
        insert_price(conn, symbol="AAPL", price=3.0, as_of="2024-01-03T00:00:00Z", currency="USD", source="test")

    c = TestClient(app)
    r1 = c.get("/prices", params={"symbol": "AAPL", "limit": 2, "offset": 0})
    assert r1.status_code == 200
    b1 = r1.json()
    assert b1["count"] == 2
    assert b1["offset"] == 0
    assert b1["next_offset"] == 2
    # Next page
    r2 = c.get("/prices", params={"symbol": "AAPL", "limit": 2, "offset": 2})
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["count"] == 1
    assert b2["offset"] == 2
    assert b2["next_offset"] is None
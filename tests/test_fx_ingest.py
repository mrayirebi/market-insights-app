from fastapi.testclient import TestClient
from app.main import app
from app.db import get_connection, init_db

def test_ingest_fx_mocked(tmp_path, monkeypatch):
    # route uses alpha_vantage_fx.save_latest_fx; mock it to avoid network
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("ALPHA_VANTAGE_API_KEY", "dummy")

    def fake_save_latest_fx(pair, key):
        # simulate saved row shape returned by save_latest_fx
        return {"symbol": pair.replace("/", "").upper(), "price": 1.23456, "as_of": "2025-09-27T00:00:00Z", "currency": "USD"}

    import ingest.alpha_vantage_fx as mod
    monkeypatch.setattr(mod, "save_latest_fx", fake_save_latest_fx)

    c = TestClient(app)
    r = c.post("/ingest/fx", json={"pair": "EURUSD"})
    assert r.status_code == 200
    body = r.json()
    assert body["saved"]["symbol"] == "EURUSD"
    assert body["saved"]["price"] == 1.23456

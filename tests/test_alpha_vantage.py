from ingest.alpha_vantage import fetch_price


def test_fetch_price_parsing(monkeypatch):
    class DummyResp:
        def __init__(self, json_data):
            self._json = json_data
        def raise_for_status(self):
            return None
        def json(self):
            return self._json

    def fake_get(url, params=None, timeout=15):
        return DummyResp({
            "Global Quote": {
                "01. symbol": "AAPL",
                "05. price": "151.23",
                "07. latest trading day": "2024-01-02",
            }
        })

    import requests
    monkeypatch.setattr(requests, "get", fake_get)

    out = fetch_price("AAPL", api_key="dummy")
    assert out["symbol"] == "AAPL"
    assert out["price"] == 151.23
    assert out["as_of"].startswith("2024-01-02T00:00:00Z")
    assert out["currency"] is None

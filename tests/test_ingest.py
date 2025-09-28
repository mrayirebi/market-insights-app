from ingest.yahoo import fetch_price


def test_fetch_price_smoke(monkeypatch):
    class DummyResp:
        def __init__(self, json_data):
            self._json = json_data
            self.status_code = 200
        def raise_for_status(self):
            return None
        def json(self):
            return self._json

    def fake_get(url, timeout=10):
        return DummyResp({
            "chart": {
                "result": [{
                    "meta": {"symbol": "AAPL", "currency": "USD"},
                    "timestamp": [1000, 2000],
                    "indicators": {"quote": [{"close": [150.0, 151.0]}]}
                }]
            }
        })

    import requests
    monkeypatch.setattr(requests, "get", fake_get)

    out = fetch_price("AAPL")
    assert out["symbol"] == "AAPL"
    assert out["price"] == 151.0
    assert out["currency"] == "USD"

from fastapi.testclient import TestClient
from app.main import app

def test_insights_demo_without_key():
    c = TestClient(app)
    r = c.post('/insights', json={"symbol":"EURUSD","horizon":"daily"})
    assert r.status_code == 200
    data = r.json()
    assert 'summary' in data and isinstance(data['summary'], str) and len(data['summary']) > 0

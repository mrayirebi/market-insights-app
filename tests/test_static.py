from fastapi.testclient import TestClient

from app.main import app

def test_root_serves_index_html():
    c = TestClient(app)
    r = c.get("/")
    assert r.status_code == 200
    # fastapi FileResponse may set application/octet-stream unless static types are inferred; just check body
    assert b"Market Insights" in r.content

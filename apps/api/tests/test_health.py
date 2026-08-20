import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@pytest.fixture
def boom_client():
    """
    A client that lets the server's own 500 response through instead of
    re-raising, so the response the *browser* would receive can be
    asserted on. The route is registered once and left in place — it's
    only reachable at this hardcoded path.
    """

    @app.get("/__test_unhandled_error")
    def _boom() -> None:
        raise RuntimeError("unhandled")

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_unhandled_error_returns_a_generic_500_not_a_traceback(boom_client):
    res = boom_client.get("/__test_unhandled_error")
    assert res.status_code == 500
    assert res.json() == {"detail": "Internal server error"}
    assert "unhandled" not in res.text


def test_unhandled_error_still_carries_cors_headers(boom_client):
    """
    The catch-all runs in Starlette's ServerErrorMiddleware, outside
    CORSMiddleware — without explicit headers the browser rejects the
    response cross-origin and the web app sees an opaque network
    failure it can't report, instead of the 500 the API actually sent.
    """
    res = boom_client.get("/__test_unhandled_error", headers={"Origin": "http://localhost:3000"})
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert res.headers["access-control-allow-credentials"] == "true"


def test_unhandled_error_does_not_echo_an_unknown_origin(boom_client):
    res = boom_client.get("/__test_unhandled_error", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers

"""
Google Calendar OAuth connection: crypto round-trip, connect/callback/
disconnect/status routes. Every Google network call is mocked — these
tests never make a real HTTP request to Google.
"""

from urllib.parse import parse_qs, urlparse

import pytest

from app.core.crypto import CalendarEncryptionNotConfigured, decrypt_secret, encrypt_secret
from app.core.settings import settings
from app.integrations import google_calendar
from app.modules.calendar import connections as calendar_connections


def test_encrypt_decrypt_round_trip():
    ciphertext = encrypt_secret("a-refresh-token")
    assert ciphertext != "a-refresh-token"
    assert decrypt_secret(ciphertext) == "a-refresh-token"


def test_decrypt_with_wrong_key_returns_none(monkeypatch):
    ciphertext = encrypt_secret("a-refresh-token")
    # A different, still-valid Fernet key — simulates a rotated
    # CALENDAR_TOKEN_ENCRYPTION_KEY; decrypt_secret must degrade to None
    # rather than raise, per app/core/crypto.py's contract.
    monkeypatch.setattr(settings, "calendar_token_encryption_key", "AqrlWStLzGNzTxbpxRweaH--EaXJBWBJuMc0c_in7mA=")
    assert decrypt_secret(ciphertext) is None


def test_encrypt_secret_requires_configured_key(monkeypatch):
    monkeypatch.setattr(settings, "calendar_token_encryption_key", "")
    with pytest.raises(CalendarEncryptionNotConfigured):
        encrypt_secret("x")


def test_google_calendar_status_requires_auth(client):
    res = client.get("/api/v1/calendar/google/status")
    assert res.status_code == 401


def test_google_calendar_status_none_when_not_connected(authed_client):
    res = authed_client.get("/api/v1/calendar/google/status")
    assert res.status_code == 200
    assert res.json() is None


def test_connect_redirects_to_google_when_configured(authed_client):
    res = authed_client.get("/api/v1/calendar/google/connect", follow_redirects=False)
    assert res.status_code in (302, 307)
    location = res.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    params = parse_qs(urlparse(location).query)
    assert params["client_id"] == [settings.google_calendar_client_id]
    assert "calendar.events" in params["scope"][0]
    assert params["access_type"] == ["offline"]
    assert "state" in params


def test_connect_503_when_not_configured(authed_client, monkeypatch):
    monkeypatch.setattr(settings, "google_calendar_client_id", "")
    res = authed_client.get("/api/v1/calendar/google/connect", follow_redirects=False)
    assert res.status_code == 503


def test_callback_missing_or_invalid_state_redirects_to_error(authed_client):
    res = authed_client.get(
        "/api/v1/calendar/google/callback", params={"code": "abc"}, follow_redirects=False
    )
    assert res.status_code in (302, 307)
    assert "calendar=error" in res.headers["location"]

    res = authed_client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "abc", "state": "not-a-real-signed-state"},
        follow_redirects=False,
    )
    assert "calendar=error" in res.headers["location"]


def test_callback_state_bound_to_a_different_user_redirects_to_error(authed_client, member_user):
    # The state param is signed for a different user than whoever's
    # session cookie is on the request — must not silently connect the
    # calling user's account instead.
    other_state = calendar_connections._state_serializer().dumps({"user_id": str(member_user.id)})
    res = authed_client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "abc", "state": other_state},
        follow_redirects=False,
    )
    assert "calendar=error" in res.headers["location"]


def test_callback_completes_connection_happy_path(authed_client, monkeypatch):
    connect_res = authed_client.get("/api/v1/calendar/google/connect", follow_redirects=False)
    state = parse_qs(urlparse(connect_res.headers["location"]).query)["state"][0]

    monkeypatch.setattr(
        "app.modules.calendar.connections.google_calendar.exchange_code",
        lambda code: google_calendar.TokenSet(access_token="at", refresh_token="rt", expires_in=3600),
    )
    monkeypatch.setattr(
        "app.modules.calendar.connections.google_calendar.fetch_userinfo_email",
        lambda access_token: "operator@example.com",
    )

    res = authed_client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "a-real-code", "state": state},
        follow_redirects=False,
    )
    assert "calendar=connected" in res.headers["location"]

    status = authed_client.get("/api/v1/calendar/google/status").json()
    assert status["google_email"] == "operator@example.com"


def test_callback_google_denied_redirects_to_error(authed_client):
    res = authed_client.get(
        "/api/v1/calendar/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert "calendar=error" in res.headers["location"]


def test_disconnect_removes_connection(authed_client, admin_user, db_session, monkeypatch):
    from app.core.crypto import encrypt_secret
    from app.modules.calendar.models import CalendarConnection

    db_session.add(
        CalendarConnection(user_id=admin_user.id, encrypted_refresh_token=encrypt_secret("rt"))
    )
    db_session.commit()
    monkeypatch.setattr("app.modules.calendar.connections.google_calendar.revoke_token", lambda rt: None)

    assert authed_client.get("/api/v1/calendar/google/status").json() is not None

    res = authed_client.post("/api/v1/calendar/google/disconnect")
    assert res.status_code == 204
    assert authed_client.get("/api/v1/calendar/google/status").json() is None

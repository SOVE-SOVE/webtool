def test_login_wrong_password_fails(client, admin_user):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": admin_user.email, "password": "wrong"},
    )
    assert res.status_code == 401


def test_login_unknown_email_fails(client, admin_password):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "someone-else@example.com", "password": admin_password},
    )
    assert res.status_code == 401


def test_login_correct_password_succeeds(client, admin_user, admin_password):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": admin_user.email, "password": admin_password},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == admin_user.email
    assert body["role"] == "admin"
    assert body["workspace_id"] == str(admin_user.workspace_id)
    assert "wdos_session" in res.cookies


def test_me_requires_auth(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401


def test_me_with_session(client, admin_user, admin_password):
    client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": admin_password})
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == admin_user.email
    assert body["workspace_name"] == "Acme Web Design"


def test_logout_clears_session(client, admin_user, admin_password):
    client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": admin_password})
    logout_res = client.post("/api/v1/auth/logout")
    assert logout_res.status_code == 204

    me_res = client.get("/api/v1/auth/me")
    assert me_res.status_code == 401


def _reset_login_limiter():
    from app.core import rate_limit

    rate_limit._login_limiter._calls.clear()


def test_login_spends_a_password_hash_even_for_an_unknown_email(client, admin_user):
    """
    Unknown-email and wrong-password logins must take comparable time.
    Returning early for an unknown email skipped bcrypt entirely, which
    made "does this address have an account?" answerable by anyone,
    unauthenticated, despite the identical error body.
    """
    import statistics
    import time

    def median_ms(email: str) -> float:
        samples = []
        for _ in range(7):
            _reset_login_limiter()
            started = time.perf_counter()
            res = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
            samples.append((time.perf_counter() - started) * 1000)
            assert res.status_code == 401
        return statistics.median(samples)

    unknown = median_ms("nobody-here@example.com")
    known = median_ms(admin_user.email)

    assert min(unknown, known) > 10, "expected a real bcrypt verification on both paths"
    assert 0.5 < unknown / known < 2.0, f"timing leaks account existence: {unknown:.1f}ms vs {known:.1f}ms"


def test_repeated_failed_logins_are_rate_limited(client, admin_user):
    _reset_login_limiter()
    codes = [
        client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": f"wrong-{i}"}).status_code
        for i in range(12)
    ]
    assert 429 in codes, "brute-force guessing was never throttled"
    assert codes[0] == 401


def test_successful_login_clears_the_failure_counter(client, admin_user, admin_password):
    _reset_login_limiter()
    for i in range(5):
        client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": f"wrong-{i}"})

    assert client.post(
        "/api/v1/auth/login", json={"email": admin_user.email, "password": admin_password}
    ).status_code == 200

    # A legitimate sign-in resets the budget, so an operator who mistypes
    # a few times isn't locked out for the rest of the window.
    for i in range(5):
        assert client.post(
            "/api/v1/auth/login", json={"email": admin_user.email, "password": f"wrong-again-{i}"}
        ).status_code == 401
    _reset_login_limiter()

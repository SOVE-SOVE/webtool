"""
Guards every endpoint that triggers a paid LLM/search call (Sales Audit,
Outreach draft, Follow-up suggestion) — docs/06_SECURITY.md's "cost/rate
limits on paid APIs" control, added after the 2026-08-18 phase review
flagged it as missing. See docs/05_DECISIONS.md for why this is a
simple in-process limiter rather than something Redis-backed.
"""

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Depends, HTTPException, status

from app.core.auth import get_current_user
from app.core.settings import settings
from app.modules.users.models import User

_WINDOW_SECONDS = 60


class _InMemoryRateLimiter:
    """
    Sliding-window limiter, process-local. There's no Redis/task queue
    anywhere in this app (see docs/02_ARCHITECTURE.md) — this is scoped
    to a single API process and resets on restart, which is an
    acceptable trade-off for a first real cap on abuse. Revisit if this
    ever runs multiple worker processes behind a load balancer.
    """

    def __init__(self) -> None:
        self._calls: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, max_calls: int, window_seconds: int = _WINDOW_SECONDS) -> None:
        now = time.monotonic()
        with self._lock:
            calls = self._calls[key]
            while calls and now - calls[0] > window_seconds:
                calls.popleft()
            if len(calls) >= max_calls:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded — max {max_calls} AI generations per {window_seconds}s. Try again shortly.",
                )
            calls.append(now)

    def over_limit(self, key: str, max_calls: int, window_seconds: int) -> bool:
        now = time.monotonic()
        with self._lock:
            calls = self._calls[key]
            while calls and now - calls[0] > window_seconds:
                calls.popleft()
            return len(calls) >= max_calls

    def record(self, key: str) -> None:
        with self._lock:
            self._calls[key].append(time.monotonic())

    def clear(self, key: str) -> None:
        with self._lock:
            self._calls.pop(key, None)


_generation_limiter = _InMemoryRateLimiter()

# Failed logins only — a correct password clears the counter, so normal
# use never trips this and an operator can't be locked out by someone
# else guessing at their address. Two buckets: per-account stops a
# targeted guessing run, per-IP stops one host sweeping many addresses.
_login_limiter = _InMemoryRateLimiter()
_LOGIN_WINDOW_SECONDS = 15 * 60
_MAX_FAILURES_PER_ACCOUNT = 10
_MAX_FAILURES_PER_IP = 30


def _login_keys(email: str, client_ip: str) -> tuple[str, str]:
    return f"account:{email.lower()}:{client_ip}", f"ip:{client_ip}"


def login_attempt_blocked(email: str, client_ip: str) -> bool:
    account_key, ip_key = _login_keys(email, client_ip)
    return _login_limiter.over_limit(
        account_key, _MAX_FAILURES_PER_ACCOUNT, _LOGIN_WINDOW_SECONDS
    ) or _login_limiter.over_limit(ip_key, _MAX_FAILURES_PER_IP, _LOGIN_WINDOW_SECONDS)


def record_login_failure(email: str, client_ip: str) -> None:
    for key in _login_keys(email, client_ip):
        _login_limiter.record(key)


def clear_login_failures(email: str, client_ip: str) -> None:
    _login_limiter.clear(_login_keys(email, client_ip)[0])


def enforce_generation_rate_limit(current_user: User = Depends(get_current_user)) -> User:
    """
    Drop-in replacement for `Depends(get_current_user)` on any route
    that generates content via a paid API call. Keyed per user (not per
    workspace), so one runaway actor can't exhaust a whole team's shared
    budget while also not double-counting a team's combined usage
    against a single shared bucket — each member gets their own cap.
    Shared across all three generation features (sales audit, outreach,
    follow-up) rather than one bucket each, since the thing being
    protected is a single combined API budget either way.
    """
    _generation_limiter.check(str(current_user.id), settings.llm_rate_limit_per_minute)
    return current_user

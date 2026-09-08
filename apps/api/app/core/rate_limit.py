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


# Background jobs that spend a live Brave query (see
# jobs/handlers.py::handle_check_instagram_website) aren't attributable
# to one HTTP request/user the way enforce_generation_rate_limit's
# per-user budget is, and a job has no caller to 429 — it just waits.
# A separate, coarse, process-wide limiter for exactly that shape of
# work, distinct from the per-user HTTP budget above.
_background_job_limiter = _InMemoryRateLimiter()
MAX_BACKGROUND_BRAVE_CALLS_PER_MINUTE = 20


def background_brave_call_allowed(key: str) -> bool:
    """True if `key` (a bucket name, e.g. "instagram_website_check") has
    room in this minute's budget. Does not consume it — call
    `record_background_brave_call` only once the caller actually spends
    a live request, so a cache-hit or an early-exit never counts against
    the budget."""
    return not _background_job_limiter.over_limit(key, MAX_BACKGROUND_BRAVE_CALLS_PER_MINUTE, _WINDOW_SECONDS)


def record_background_brave_call(key: str) -> None:
    _background_job_limiter.record(key)


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

"""
The session cookie is a signed user id with no server-side state, so the
signing key is the whole of authentication: anyone holding it can mint a
session for any user without a password. These guard the three ways the
old default silently applied — no .env on the working directory, the
blank value .env.example ships, or a deploy that misses this one var.
"""

import pytest
from pydantic import ValidationError

from app.core.settings import Settings

_VALID = "s" * 40


@pytest.mark.parametrize(
    "secret",
    ["change-me-in-.env", "", "changeme", "secret", "short-but-not-a-placeholder"],
)
def test_unsafe_session_secret_refuses_to_start(secret):
    with pytest.raises(ValidationError, match="SESSION_SECRET"):
        Settings(session_secret=secret)


def test_a_real_session_secret_is_accepted():
    assert Settings(session_secret=_VALID).session_secret == _VALID

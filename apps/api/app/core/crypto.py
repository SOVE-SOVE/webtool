"""
Symmetric encryption for secrets that must be stored, not just hashed
(passwords are hashed via app/core/auth.py's bcrypt calls and never need
to be read back — OAuth refresh tokens do, to call the provider again
later, so they're encrypted rather than hashed). Used by
modules/calendar/service.py to store a Google Calendar refresh token —
docs/06_SECURITY.md requires it never sit in the database in plaintext.
"""

from cryptography.fernet import Fernet, InvalidToken

from app.core.settings import settings


class CalendarEncryptionNotConfigured(RuntimeError):
    pass


def _fernet() -> Fernet:
    if not settings.calendar_token_encryption_key:
        raise CalendarEncryptionNotConfigured(
            "CALENDAR_TOKEN_ENCRYPTION_KEY is not set — see .env.example."
        )
    return Fernet(settings.calendar_token_encryption_key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str | None:
    """None (not a raised error) on a bad/rotated key — callers treat
    this the same as "connection is no longer usable, reconnect"."""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return None

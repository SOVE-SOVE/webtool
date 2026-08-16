"""
One-off CLI to generate a password hash for .env — used for
SEED_ADMIN_PASSWORD_HASH (see app/core/seed.py) or when setting a
user's password_hash directly.

    python -m app.core.generate_password_hash
"""

from getpass import getpass

from app.core.auth import hash_password


def main() -> None:
    password = getpass("Password: ")
    confirm = getpass("Confirm: ")
    if password != confirm:
        raise SystemExit("Passwords did not match.")
    print(hash_password(password))


if __name__ == "__main__":
    main()

"""
One-off CLI to generate the OPERATOR_PASSWORD_HASH value for .env.

    python -m app.core.generate_password_hash
"""

from getpass import getpass

from app.core.auth import hash_password


def main() -> None:
    password = getpass("Operator password: ")
    confirm = getpass("Confirm: ")
    if password != confirm:
        raise SystemExit("Passwords did not match.")
    print(hash_password(password))


if __name__ == "__main__":
    main()

"""
One-off CLI to bootstrap the first workspace + admin user.

    python -m app.core.seed

Reads SEED_* settings from .env (see app/core/settings.py). Idempotent:
does nothing if any workspace already exists, so it's safe to run again
after the first real admin has been created through the app.
"""

from app.core.auth import hash_password
from app.core.settings import settings
from app.db.session import SessionLocal
from app.modules.users.models import User, UserRole
from app.modules.workspaces.models import Workspace


def main() -> None:
    db = SessionLocal()
    try:
        if db.query(Workspace).first() is not None:
            print("A workspace already exists — nothing to seed.")
            return

        if not settings.seed_admin_password_hash:
            raise SystemExit(
                "SEED_ADMIN_PASSWORD_HASH is not set. Generate one with "
                "`python -m app.core.generate_password_hash` and put it in .env first."
            )

        workspace = Workspace(name=settings.seed_workspace_name)
        db.add(workspace)
        db.flush()

        admin = User(
            workspace_id=workspace.id,
            name=settings.seed_admin_name,
            email=settings.seed_admin_email.lower(),
            role=UserRole.ADMIN,
            password_hash=settings.seed_admin_password_hash,
        )
        db.add(admin)
        db.commit()
        print(f"Created workspace {workspace.name!r} with admin {admin.email!r}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()

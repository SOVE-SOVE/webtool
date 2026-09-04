"""
Runs against a real Postgres test database (webdesignos_test — see
docker/postgres-init/01-create-test-db.sql), not SQLite or mocks. The
env vars below must be set before anything under app/ is imported, since
app.core.settings.settings is built once at import time.
"""

import os

# `setdefault`, not an unconditional assignment, so parallel test runs
# (e.g. several worktrees at once) can each point at their own database
# via DATABASE_URL and not truncate/drop each other's tables mid-run.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://webdesignos:webdesignos@localhost:5432/webdesignos_test"
)
# Long enough to satisfy the Settings validator's minimum — see
# app/core/settings.py; a short/placeholder secret now refuses to start.
os.environ["SESSION_SECRET"] = "test-session-secret-not-used-in-any-real-deployment"
# Blank regardless of what the developer's own .env has configured —
# tests that need a key set it themselves via monkeypatch, and the
# "key not configured" behavior needs to be reachable no matter what's
# in the local environment.
os.environ["BRAVE_SEARCH_API_KEY"] = ""
os.environ["LLM_API_KEY"] = ""
# A real (test-only) Fernet key so calendar-connection encryption tests
# can round-trip — tests that want the "not configured" path unset this
# themselves via monkeypatch.
os.environ["CALENDAR_TOKEN_ENCRYPTION_KEY"] = "wIxldGe6BcCKukNVkV38yTsovSsFyCIgvLFgeA8_Ho0="
os.environ["GOOGLE_CALENDAR_CLIENT_ID"] = "test-client-id"
os.environ["GOOGLE_CALENDAR_CLIENT_SECRET"] = "test-client-secret"

import pytest
from fastapi.testclient import TestClient

from app.core.auth import hash_password
from app.db import all_models  # noqa: F401 — registers every model on Base.metadata
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.main import app
from app.modules.users.models import User, UserRole
from app.modules.workspaces.models import Workspace

ADMIN_PASSWORD = "test-password"
MEMBER_PASSWORD = "member-password"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _clean_tables():
    yield
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db_session():
    """
    For writing rows that don't have CRUD routes yet (interactions,
    sales opportunities, meetings, users, workspaces) directly into the
    test database.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_workspace(db_session, name: str) -> Workspace:
    workspace = Workspace(name=name)
    db_session.add(workspace)
    db_session.commit()
    db_session.refresh(workspace)
    return workspace


def _make_user(db_session, workspace_id, name: str, email: str, password: str, role: UserRole) -> User:
    user = User(
        workspace_id=workspace_id,
        name=name,
        email=email,
        role=role,
        password_hash=hash_password(password),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def workspace(db_session) -> Workspace:
    return _make_workspace(db_session, "Acme Web Design")


@pytest.fixture
def admin_user(db_session, workspace) -> User:
    return _make_user(db_session, workspace.id, "Ada Admin", "admin@example.com", ADMIN_PASSWORD, UserRole.ADMIN)


@pytest.fixture
def member_user(db_session, workspace) -> User:
    return _make_user(
        db_session, workspace.id, "Mia Member", "member@example.com", MEMBER_PASSWORD, UserRole.MEMBER
    )


@pytest.fixture
def admin_password() -> str:
    return ADMIN_PASSWORD


@pytest.fixture
def member_password() -> str:
    return MEMBER_PASSWORD


@pytest.fixture
def authed_client(client: TestClient, admin_user: User) -> TestClient:
    """Logged in as an admin — the default actor for tests that don't care about role."""
    res = client.post(
        "/api/v1/auth/login",
        json={"email": admin_user.email, "password": ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    return client


@pytest.fixture
def member_client(member_user: User) -> TestClient:
    """
    A second, independent TestClient (own cookie jar) logged in as a
    MEMBER of the same workspace as `authed_client` — for role tests
    that need both an admin and a member session live at once.
    """
    with TestClient(app) as c:
        res = c.post(
            "/api/v1/auth/login",
            json={"email": member_user.email, "password": MEMBER_PASSWORD},
        )
        assert res.status_code == 200
        yield c


@pytest.fixture
def other_workspace(db_session) -> Workspace:
    return _make_workspace(db_session, "Other Business")


@pytest.fixture
def other_admin_user(db_session, other_workspace: Workspace) -> User:
    return _make_user(
        db_session,
        other_workspace.id,
        "Ollie Other",
        "other-admin@example.com",
        ADMIN_PASSWORD,
        UserRole.ADMIN,
    )


@pytest.fixture
def other_authed_client(other_admin_user: User) -> TestClient:
    """
    A second, independent TestClient logged in as an admin of a
    *different* workspace — for cross-workspace isolation tests.
    """
    with TestClient(app) as c:
        res = c.post(
            "/api/v1/auth/login",
            json={"email": other_admin_user.email, "password": ADMIN_PASSWORD},
        )
        assert res.status_code == 200
        yield c

"""
Runs against a real Postgres test database (webdesignos_test — see
docker/postgres-init/01-create-test-db.sql), not SQLite or mocks. The
env vars below must be set before anything under app/ is imported, since
app.core.settings.settings is built once at import time.
"""

import os

os.environ["DATABASE_URL"] = "postgresql+psycopg://webdesignos:webdesignos@localhost:5432/webdesignos_test"
os.environ["SESSION_SECRET"] = "test-session-secret"
os.environ["OPERATOR_EMAIL"] = "operator@example.com"

import pytest
from fastapi.testclient import TestClient

from app.core.auth import hash_password
from app.core.settings import settings
from app.db import all_models  # noqa: F401 — registers every model on Base.metadata
from app.db.base import Base
from app.db.session import engine
from app.main import app

OPERATOR_PASSWORD = "test-password"
settings.operator_password_hash = hash_password(OPERATOR_PASSWORD)


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
def operator_password() -> str:
    return OPERATOR_PASSWORD

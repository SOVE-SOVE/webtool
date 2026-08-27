from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.settings import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    # Without this, an unreachable host (wrong address, network
    # partition) falls back to the OS socket connect timeout — tens of
    # seconds to minutes — hanging the request thread. pool_pre_ping
    # already covers the more common "connection went stale" case.
    connect_args={"connect_timeout": 5},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

import logging

from app.core.settings import settings


def configure_logging() -> None:
    """Plain stdlib logging — no framework needed at this scale/volume."""
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    # uvicorn's own loggers already handle access/error logs; leave them alone.
    logging.getLogger("app").setLevel(settings.log_level)


logger = logging.getLogger("app")

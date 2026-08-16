from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.logging import configure_logging, logger
from app.core.settings import settings
from app.db import all_models  # noqa: F401 — registers every model before mappers configure
from app.modules.auth.routes import router as auth_router
from app.modules.businesses.routes import router as businesses_router
from app.modules.clients.routes import router as clients_router
from app.modules.dashboard.routes import router as dashboard_router
from app.modules.leads.routes import router as leads_router
from app.modules.projects.routes import router as projects_router
from app.modules.tasks.routes import router as tasks_router

configure_logging()

app = FastAPI(title="Web Design OS API")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all so an uncaught bug returns a generic error instead of a raw
    traceback, while still logging the real exception for the operator.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(businesses_router)
app.include_router(leads_router)
app.include_router(clients_router)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(dashboard_router)

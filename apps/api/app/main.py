from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.logging import configure_logging, logger
from app.core.settings import settings
from app.db import all_models  # noqa: F401 — registers every model before mappers configure
from app.modules.activity_log.routes import router as activity_router
from app.modules.auth.routes import router as auth_router
from app.modules.businesses.routes import router as businesses_router
from app.modules.calendar.routes import router as calendar_router
from app.modules.clients.routes import router as clients_router
from app.modules.creative_directions.routes import router as creative_directions_router
from app.modules.dashboard.routes import router as dashboard_router
from app.modules.design_briefs.routes import router as design_briefs_router
from app.modules.leads.routes import router as leads_router
from app.modules.meetings.routes import router as meetings_router
from app.modules.outreach.routes import router as outreach_router
from app.modules.projects.routes import router as projects_router
from app.modules.sales_audits.routes import router as sales_audits_router
from app.modules.sitemaps.routes import router as sitemaps_router
from app.modules.tasks.routes import router as tasks_router
from app.modules.users.routes import router as users_router
from app.modules.website_audits.routes import router as website_audits_router
from app.modules.websites.routes import router as websites_router
from app.modules.workspaces.routes import router as workspaces_router

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
app.include_router(users_router)
app.include_router(workspaces_router)
app.include_router(activity_router)
app.include_router(website_audits_router)
app.include_router(sales_audits_router)
app.include_router(outreach_router)
app.include_router(meetings_router)
app.include_router(calendar_router)
app.include_router(design_briefs_router)
app.include_router(creative_directions_router)
app.include_router(sitemaps_router)
app.include_router(websites_router)

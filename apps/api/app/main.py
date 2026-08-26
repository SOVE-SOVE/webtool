from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.logging import configure_logging, logger
from app.core.settings import settings
from app.db import all_models  # noqa: F401 — registers every model before mappers configure
from app.integrations.llm import LlmUnavailableError
from app.modules.activity_log.routes import router as activity_router
from app.modules.approvals.routes import router as approvals_router
from app.modules.auth.routes import router as auth_router
from app.modules.business_research.routes import router as business_research_router
from app.modules.businesses.routes import router as businesses_router
from app.modules.calendar.routes import router as calendar_router
from app.modules.clients.routes import router as clients_router
from app.modules.creative_directions.routes import router as creative_directions_router
from app.modules.dashboard.routes import router as dashboard_router
from app.modules.deployments.routes import router as deployments_router
from app.modules.design_briefs.routes import router as design_briefs_router
from app.modules.discovery.routes import discovered_businesses_router, router as discovery_router
from app.modules.jobs.routes import router as jobs_router, schedules_router as job_schedules_router
from app.modules.leads.routes import router as leads_router
from app.modules.meetings.routes import router as meetings_router
from app.modules.opportunity_scoring.routes import router as opportunity_scoring_router
from app.modules.outreach.routes import router as outreach_router
from app.modules.pipeline.routes import router as pipeline_router
from app.modules.previews.routes import router as previews_router
from app.modules.projects.routes import router as projects_router
from app.modules.qa_reports.routes import router as qa_reports_router
from app.modules.sales_audits.routes import router as sales_audits_router
from app.modules.sales_dashboard.routes import router as sales_dashboard_router
from app.modules.sales_opportunities.routes import router as sales_opportunities_router
from app.modules.sitemaps.routes import router as sitemaps_router
from app.modules.tasks.routes import router as tasks_router
from app.modules.users.routes import router as users_router
from app.modules.website_audits.routes import router as website_audits_router
from app.modules.website_feedback.routes import router as website_feedback_router
from app.modules.website_quality.routes import router as website_quality_router
from app.modules.websites.routes import router as websites_router
from app.modules.workspaces.routes import router as workspaces_router

configure_logging()

app = FastAPI(title="Web Design OS API")


@app.exception_handler(LlmUnavailableError)
async def llm_unavailable_handler(request: Request, exc: LlmUnavailableError) -> JSONResponse:
    """
    Every AI generation route (sales audit, outreach, follow-up, meeting
    brief, creative direction, sitemap) funnels its LLM failures here so
    the operator gets an actionable "couldn't generate, here's why"
    instead of a bare 500. Nothing partial is stored — the request's
    transaction rolls back untouched.
    """
    logger.warning("LLM unavailable on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def _with_cors(request: Request, response: JSONResponse) -> JSONResponse:
    """
    Starlette runs the bare-`Exception` handler in ServerErrorMiddleware,
    which sits *outside* CORSMiddleware — so without this the browser
    rejects a 500 as a cross-origin failure and the web app sees an
    opaque network error it can't report, instead of the error the API
    actually sent.
    """
    origin = request.headers.get("origin")
    if origin and origin in settings.allowed_origins_list:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all so an uncaught bug returns a generic error instead of a raw
    traceback, while still logging the real exception for the operator.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return _with_cors(request, JSONResponse(status_code=500, content={"detail": "Internal server error"}))

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
app.include_router(qa_reports_router)
app.include_router(deployments_router)
app.include_router(approvals_router)
app.include_router(discovery_router)
app.include_router(discovered_businesses_router)
app.include_router(jobs_router)
app.include_router(job_schedules_router)
app.include_router(business_research_router)
app.include_router(website_quality_router)
app.include_router(opportunity_scoring_router)
app.include_router(pipeline_router)
app.include_router(sales_opportunities_router)
app.include_router(sales_dashboard_router)
app.include_router(previews_router)
app.include_router(website_feedback_router)

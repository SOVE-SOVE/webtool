from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.settings import settings
from app.db import all_models  # noqa: F401 — registers every model before mappers configure
from app.modules.auth.routes import router as auth_router
from app.modules.businesses.routes import router as businesses_router

app = FastAPI(title="Web Design OS API")

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

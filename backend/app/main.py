import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.export_deploy import router as export_deploy_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.projects import router as projects_router
from app.api.routes.quality import router as quality_router
from app.api.routes.snapshots import router as snapshots_router
from app.api.routes.terminal import router as terminal_router
from app.api.routes.variants import router as variants_router
from app.core.config import CORS_ORIGINS

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="website-builder-agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(jobs_router)
app.include_router(terminal_router)
app.include_router(snapshots_router)
app.include_router(export_deploy_router)
app.include_router(quality_router)
app.include_router(variants_router)


@app.get("/")
def hello():
    return {"message": "Hello from website-builder-agent backend"}

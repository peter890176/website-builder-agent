from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.schemas.deploy import (
    DeployRequest,
    DeploymentListResponse,
    DeploymentRecord,
    GitHubExportRequest,
    GitHubExportResponse,
)
from app.services.deploy import deploy_project, export_to_github
from app.services.export import create_project_zip, load_deployments

router = APIRouter(prefix="/api/projects/{project_id}", tags=["export-deploy"])


@router.get("/export/zip")
def get_export_zip(project_id: str, build_output: bool = False) -> FileResponse:
    try:
        path = create_project_zip(project_id, build_output=build_output)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, filename=path.name, media_type="application/zip")


@router.post("/export/github", response_model=GitHubExportResponse)
def post_github_export(project_id: str, body: GitHubExportRequest) -> GitHubExportResponse:
    try:
        deployment, repo_url = export_to_github(project_id, body)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GitHubExportResponse(deployment=deployment, repository_url=repo_url)


@router.post("/deploy", response_model=DeploymentRecord)
def post_deploy(project_id: str, body: DeployRequest) -> DeploymentRecord:
    try:
        return deploy_project(
            project_id,
            body.provider,
            site_name=body.site_name,
            project_name=body.project_name,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/deployments", response_model=DeploymentListResponse)
def get_deployments(project_id: str) -> DeploymentListResponse:
    return DeploymentListResponse(
        deployments=[DeploymentRecord.model_validate(item) for item in load_deployments(project_id)]
    )

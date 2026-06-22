from fastapi import APIRouter, HTTPException

from app.schemas.job import JobCreateRequest, JobListResponse, ProjectJob
from app.services.jobs import create_job, get_job, list_jobs, request_cancel

router = APIRouter(prefix="/api/projects/{project_id}/jobs", tags=["jobs"])


@router.post("", response_model=ProjectJob)
def post_job(project_id: str, body: JobCreateRequest) -> ProjectJob:
    return create_job(project_id, body.type, title=body.title)


@router.get("", response_model=JobListResponse)
def get_jobs(project_id: str) -> JobListResponse:
    return JobListResponse(jobs=list_jobs(project_id))


@router.get("/{job_id}", response_model=ProjectJob)
def get_job_detail(project_id: str, job_id: str) -> ProjectJob:
    try:
        return get_job(project_id, job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@router.post("/{job_id}/cancel", response_model=ProjectJob)
def post_cancel_job(project_id: str, job_id: str) -> ProjectJob:
    try:
        return request_cancel(project_id, job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.schemas.job import JobArtifact, JobLogEntry, JobStatus, JobType, ProjectJob
from app.services.workspace import ensure_project_dir

BUILDER_DIR = ".builder"
JOBS_DIR = "jobs"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def jobs_dir(project_id: str) -> Path:
    path = ensure_project_dir(project_id) / BUILDER_DIR / JOBS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def job_path(project_id: str, job_id: str) -> Path:
    return jobs_dir(project_id) / f"{job_id}.json"


def create_job(project_id: str, job_type: JobType, *, title: str = "") -> ProjectJob:
    job = ProjectJob(
        id=uuid.uuid4().hex[:12],
        project_id=project_id,
        type=job_type,
        title=title or job_type.replace("_", " ").title(),
    )
    save_job(job)
    return job


def save_job(job: ProjectJob) -> ProjectJob:
    job.updated_at = _now()
    job_path(job.project_id, job.id).write_text(job.model_dump_json(indent=2), encoding="utf-8")
    return job


def get_job(project_id: str, job_id: str) -> ProjectJob:
    path = job_path(project_id, job_id)
    if not path.is_file():
        raise FileNotFoundError(job_id)
    return ProjectJob.model_validate_json(path.read_text(encoding="utf-8"))


def list_jobs(project_id: str) -> list[ProjectJob]:
    jobs: list[ProjectJob] = []
    for path in jobs_dir(project_id).glob("*.json"):
        try:
            jobs.append(ProjectJob.model_validate_json(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
    return sorted(jobs, key=lambda job: job.created_at, reverse=True)


def update_job(
    project_id: str,
    job_id: str,
    *,
    status: JobStatus | None = None,
    progress: int | None = None,
    error: str | None = None,
) -> ProjectJob:
    job = get_job(project_id, job_id)
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = max(0, min(100, progress))
    if error is not None:
        job.error = error
    return save_job(job)


def append_job_log(project_id: str, job_id: str, message: str, *, level: str = "info") -> ProjectJob:
    job = get_job(project_id, job_id)
    job.logs.append(JobLogEntry(level=level, message=message))
    return save_job(job)


def append_job_artifact(
    project_id: str,
    job_id: str,
    *,
    artifact_type: str,
    name: str,
    path: str = "",
    url: str | None = None,
    metadata: dict | None = None,
) -> ProjectJob:
    job = get_job(project_id, job_id)
    job.artifacts.append(
        JobArtifact(
            id=uuid.uuid4().hex[:10],
            type=artifact_type,
            name=name,
            path=path,
            url=url,
            metadata=metadata or {},
        )
    )
    return save_job(job)


def request_cancel(project_id: str, job_id: str) -> ProjectJob:
    job = get_job(project_id, job_id)
    job.cancel_requested = True
    if job.status in {"queued", "running"}:
        job.status = "cancelled"
        job.progress = 100
    return save_job(job)


def is_cancelled(project_id: str, job_id: str) -> bool:
    return get_job(project_id, job_id).cancel_requested
